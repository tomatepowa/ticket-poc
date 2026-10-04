// source.js — la source du portail, construite sur un client EasyVista.
//
// Le meme code tourne sur le faux EV (clients/simule) et sur la vraie API
// (clients/http) : seul le client change.
//
// Lecture / ecriture :
//  - listes, filtres, stats : lus dans le cache local (cache.js), alimente par
//    la synchro (synchro.js) -> aucun appel EV par affichage de liste ;
//  - detail d'un ticket : lu EN DIRECT dans EV (repli sur le cache si EV est
//    injoignable), et le cache est mis a jour au passage ;
//  - actions et creations : envoyees a EV, puis le ticket est relu dans EV et
//    le cache mis a jour, pour que l'utilisateur voie tout de suite le resultat.
// Les droits de chaque utilisateur sont appliques ici (modele.js).
//
// Portail reserve aux equipes : intervenants, superviseurs, et cadres valideurs.

const cfg = require("./correspondance");
const M = require("./modele");
const Q = require("./questionnaires");
const cache = require("./cache");
const { creerSynchro } = require("./synchro");
const { ErreurSource } = require("../erreurs");

const TERMINES = ["RESOLU", "CLOTURE"];
// Type MIME d'apres l'extension (pieces jointes : l'API EV ne le donne pas).
const TYPES_FICHIER = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
  pdf: "application/pdf", txt: "text/plain", log: "text/plain", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  msg: "application/vnd.ms-outlook", eml: "message/rfc822", zip: "application/zip",
};
const typeFichier = (nom) => TYPES_FICHIER[String(nom || "").split(".").pop().toLowerCase()] || "application/octet-stream";
// Filtres de statut de la liste : "" (tous), actifs, inactifs (résolus et clos).
const STATUTS_LISTE = ["", "ACTIFS", "INACTIFS"];
const JOURS_CLOS_AFFICHES = 30; // tickets clos visibles dans les listes
const normaliser = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function creerSource(client) {
  const synchro = creerSynchro(client, cache, {
    intervalleMs: (Number(process.env.SYNCHRO_SECONDES) || 60) * 1000,
    retentionJours: Number(process.env.RETENTION_JOURS) || 365,
    titresCatalogue: () => titresCatalogue(),
  });

  // ---------- Caches memoire des referentiels (ils changent rarement) ----------
  const memoire = new Map();
  async function memo(cle, ttlMs, fn) {
    const c = memoire.get(cle);
    if (c && c.expire > Date.now()) return c.valeur;
    const valeur = await fn();
    memoire.set(cle, { valeur, expire: Date.now() + ttlMs });
    return valeur;
  }
  const CINQ_MIN = 5 * 60e3;
  const groupesEV = () => memo("groupes", CINQ_MIN, async () => (await client.getGroups()).records);
  const catalogueEV = () => memo("catalogue", CINQ_MIN, async () => (await client.getCatalog()).records);
  const locationsEV = () => memo("locations", CINQ_MIN, async () => (await client.getLocations()).records);

  // Referentiels sans les elements desactives dans EV (date de fin passee).
  const actifs = (liste, champ) => liste.filter((x) => !M.estInactif(x, champ));

  async function questionnaire(id) {
    return memo(`questionnaire:${id}`, CINQ_MIN, async () => Q.lireQuestionnaire(await client.getQuestionnaire(id)));
  }

  // Questionnaire associe a une entree de catalogue EV, ou null.
  async function questionnaireDuCatalogue(catalogueId) {
    const cat = (await catalogueEV()).find((c) => String(c.SD_CATALOG_ID) === String(catalogueId));
    const id = cat?.[cfg.champQuestionnaireCatalogue];
    return id ? questionnaire(id) : null;
  }

  // Questionnaire demande a la fin de l'action en cours, ou null (EV 2023.4+).
  async function questionnaireAction(ctx, actionId) {
    if (!client.getActionQuestionnaire) return null;
    const a = ctx.actions.find((x) => String(x.ACTION_ID) === String(actionId));
    const brut = await client.getActionQuestionnaire(ctx.req.RFC_NUMBER, actionId, a && M.idTypeAction(a));
    return brut ? Q.lireQuestionnaire(brut) : null;
  }

  // Enregistre des reponses deja controlees sur le ticket (POST /questions-result/...).
  async function enregistrerReponses(requestId, reponses) {
    for (const [questionId, valeur] of Object.entries(reponses)) {
      await client.createQuestionResult(requestId, questionId, { value: Q.versValeurEV(valeur) });
    }
  }

  async function titresCatalogue() {
    return new Map((await catalogueEV()).map((c) => [String(c.SD_CATALOG_ID), c.TITLE_FR || c.TITLE_EN]));
  }

  async function groupesIntervention() {
    return (await groupesEV())
      .map((g) => ({ id: Number(g.GROUP_ID), nom: g.GROUP_FR || g.GROUP_EN }))
      .filter((g) => !M.estGroupeTechnique(g));
  }

  async function chargerUtilisateur(id) {
    let employe;
    try {
      employe = await client.getEmployee(id);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
    const groupes = (await client.getEmployeeGroups(id)).records;
    return M.versUtilisateur(employe, groupes);
  }

  // Lecture en direct dans EV + mise a jour du cache. Repli sur le cache si EV ne repond pas.
  async function contexteDirect(rfc) {
    try {
      const lu = await synchro.relireTicket(rfc);
      if (!lu) throw new ErreurSource(404, "Ticket introuvable");
      return { ctx: M.analyser(lu.req, lu.actions), origine: "ev", lu_le: new Date().toISOString() };
    } catch (err) {
      if (err.status === 404) throw new ErreurSource(404, "Ticket introuvable");
      const copie = await cache.lire(rfc);
      if (!copie) throw err;
      return { ctx: M.analyser(copie.req, copie.actions), origine: "cache", lu_le: copie.synchro, erreur_ev: err.message };
    }
  }

  async function contexteVisible(u, rfc) {
    const res = await contexteDirect(rfc);
    // 404 aussi quand le ticket existe mais n'est pas visible : on ne revele pas son existence.
    if (!M.peutVoir(u, res.ctx)) throw new ErreurSource(404, "Ticket introuvable");
    return res;
  }

  // Vues des equipes : les tickets de mes groupes (tous pour un superviseur),
  // decoupes par affectation : a moi, a personne, a un autre.
  const VUES_EQUIPES = (premiere) => [
    { code: "groupes", label: premiere },
    { code: "moi", label: "Mes tickets" },
    { code: "non_affectes", label: "Non affectés" },
    { code: "autres", label: "Affectés à un autre" },
  ];

  function vuesPour(u) {
    const vues = {
      INTERVENANT: VUES_EQUIPES("Mes groupes"),
      SUPERVISEUR: VUES_EQUIPES("Tous les tickets"),
      VALIDEUR: [
        { code: "a_valider", label: "À valider" },
        { code: "tout", label: "Mes validations" },
      ],
    }[u.profil];
    if (!vues) throw new ErreurSource(403, "Portail réservé aux équipes support et aux valideurs");
    return vues;
  }

  // Intervenant d'un ticket : celui de l'etape en cours ; pour un ticket resolu ou
  // clos (plus d'etape en cours), celui qui l'a traite en dernier.
  function intervenantDe(ctx) {
    if (ctx.principale) return M.idAuteur(ctx.principale);
    const traite = [...ctx.actions].reverse().find((a) => M.etapeWorkflow(a)?.nature === "TRAITEMENT" && M.idAuteur(a));
    return traite ? M.idAuteur(traite) : null;
  }

  function filtreVue(u, ctx, vue) {
    const r = M.roles(u, ctx);
    const p = ctx.principale;
    // Groupe du ticket (traitement en cours, sinon dernier groupe intervenu) parmi les miens.
    const dansMesGroupes = r.superviseur || (ctx.groupe && r.mesGroupes.has(ctx.groupe.id));
    const intervenant = intervenantDe(ctx);
    switch (vue) {
      case "tout":
        return true;
      case "groupes":
        return Boolean(dansMesGroupes);
      case "moi":
        return intervenant === u.id;
      case "non_affectes":
        // Traitement en attente de prise en charge, dans mes groupes (tous pour un superviseur).
        return (
          ctx.tc?.nature === "TRAITEMENT" &&
          !M.idAuteur(p) &&
          (r.superviseur || r.mesGroupes.has(M.idGroupe(p)))
        );
      case "autres":
        return Boolean(dansMesGroupes) && Boolean(intervenant) && intervenant !== u.id;
      case "a_valider":
        return ctx.tc?.nature === "VALIDATION" && (r.assigne(p) || r.superviseur);
      default:
        return false;
    }
  }

  // Filtres du rail (recherche, etablissements, groupe, statut) appliques a des
  // tickets deja mis en forme. ignorerEtablissements : pour les compteurs par
  // etablissement, qui doivent rester comparables quelle que soit la selection.
  function filtrerTickets(tickets, filtres, { ignorerEtablissements = false } = {}) {
    const q = filtres.q ? normaliser(filtres.q) : null;
    // groupe : un ou plusieurs ids ("2,7"), comme les etablissements.
    const groupes = String(filtres.groupe || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const etablissements = ignorerEtablissements
      ? []
      : String(filtres.etablissement || "")
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0);
    return tickets
      .filter((t) => !etablissements.length || etablissements.includes(t.etablissement?.id))
      .filter((t) => !groupes.length || groupes.includes(t.groupe?.id))
      .filter((t) => avecStatut(t, filtres.statut))
      .filter((t) => !q || normaliser(`${t.numero} ${t.titre} ${t.demandeur?.nom} ${t.intervenant?.nom || ""}`).includes(q));
  }

  // Statut de la liste : "" tous, "ACTIFS" (en cours), "INACTIFS" (resolus et clos).
  // Un statut precis du portail (OUVERT...) reste accepte par l'API.
  function avecStatut(t, statut) {
    if (!statut) return true;
    if (statut === "ACTIFS") return !TERMINES.includes(t.statut);
    if (statut === "INACTIFS") return TERMINES.includes(t.statut);
    return t.statut === statut;
  }

  // Tickets visibles, analyses ET mis en forme : [{ ctx, t }].
  async function ticketsVisibles(u) {
    const titres = await titresCatalogue();
    return (await contextesVisibles(u)).map((ctx) => ({ ctx, t: M.versTicket(ctx, u, titres) }));
  }

  // Tickets du cache visibles par l'utilisateur, analyses.
  async function contextesVisibles(u) {
    const depuisClos = new Date(Date.now() - JOURS_CLOS_AFFICHES * 86400e3).toISOString();
    const candidats = await cache.candidats({
      tous: u.profil === "SUPERVISEUR",
      groupes: u.groupes.map((g) => g.id),
      personne: u.id,
      depuisClos,
    });
    return candidats.map(({ req, actions }) => M.analyser(req, actions)).filter((ctx) => M.peutVoir(u, ctx));
  }

  // Membres actifs d'un groupe EV : [{ id, nom }] (GET /groups/{id}/employees).
  async function membresDuGroupe(groupeId) {
    if (!groupeId || !client.getGroupEmployees) return [];
    return memo(`membres:${groupeId}`, CINQ_MIN, async () =>
      actifs((await client.getGroupEmployees(groupeId)).records, cfg.champsFin.employe)
        .map((e) => {
          const [nom, prenom = ""] = String(e.LAST_NAME).split(/,\s*/);
          return { id: Number(e.EMPLOYEE_ID), nom: prenom ? `${prenom} ${nom}` : nom };
        })
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
    );
  }

  // Collegues a qui reaffecter : membres du groupe, sauf moi et l'intervenant actuel.
  async function collegues(u, ctx, groupeId) {
    const actuel = ctx.principale ? M.idAuteur(ctx.principale) : null;
    return (await membresDuGroupe(groupeId)).filter((m) => m.id !== u.id && m.id !== actuel);
  }

  // Trace dans l'historique EV : modifier l'intervenant d'une action n'en laisse pas.
  async function tracer(u, rfc, groupeId, texte) {
    await client.createAction(rfc, {
      action: { action_type_name: cfg.typeCommentaire, group_id: groupeId || u.groupes[0]?.id, done_by_id: u.id, comment: texte },
    });
  }

  // Pièces jointes d'un ticket (lues dans EV) : [{ id, nom, type }]. Le type est
  // deviné d'après l'extension (l'API EV ne le donne pas dans la liste).
  async function piecesJointes(rfc) {
    if (!client.getDocuments) return [];
    const { records } = await client.getDocuments(rfc);
    return records.map((d) => ({ id: String(d.DOCUMENT_ID), nom: d.DOCUMENT || d.NAME || "Pièce jointe", type: typeFichier(d.DOCUMENT) }));
  }

  async function ticketComplet(u, { ctx, origine, lu_le, erreur_ev }) {
    let actions = [];
    let formulaire = null;
    let pieces = [];
    // Si EV est injoignable, on affiche la copie mais on ne propose aucune action.
    if (origine === "ev") {
      actions = await Promise.all(
        M.actionsPossibles(u, ctx).map(async (a) => ({
          ...M.versActionPublique(a),
          // Formulaire EV a remplir pour terminer cette etape
          questionnaire: a.op.type === "TERMINER" ? await questionnaireAction(ctx, a.op.action_id) : null,
          // Collegues proposes pour une reaffectation
          ...(a.parametre === "membre" ? { membres: await collegues(u, ctx, a.op.group_id) } : {}),
        }))
      );
      // Une pièce jointe illisible ne doit pas empêcher d'afficher le ticket.
      pieces = await piecesJointes(ctx.req.RFC_NUMBER).catch(() => []);
      if (client.getQuestionResults) {
        const resultats = (await client.getQuestionResults(ctx.req.REQUEST_ID)).records;
        if (resultats.length) {
          const q = await questionnaireDuCatalogue(ctx.req.SD_CATALOG_ID);
          formulaire = { titre: q?.titre || "Formulaire", reponses: Q.reponsesLisibles(q, resultats) };
        }
      }
    }
    // Pas de reaffectation proposee quand personne d'autre n'est dans le groupe.
    actions = actions.filter((a) => a.parametre !== "membre" || a.membres.length);
    return {
      ...M.versTicket(ctx, u, await titresCatalogue()),
      formulaire,
      pieces_jointes: pieces,
      historique: M.historique(ctx),
      actions,
      progression: M.progression(ctx),
      fraicheur: { origine, lu_le, erreur_ev: erreur_ev || null },
    };
  }

  return {
    nom: client.nom,

    // Schema de la base (migrations) : a attendre avant de servir des requetes.
    async initialiser() {
      await cache.initialiser();
    },

    demarrerSynchro() {
      synchro.demarrer();
    },

    // Sessions de connexion, stockees en base (utilisees par auth.js).
    sessions: cache.sessions,

    // ---------- Synchronisation ----------

    async etatSynchro() {
      return synchro.etat();
    },

    // Rafraichissement demande par un utilisateur : on attend la synchro au plus quelques secondes.
    async synchroniser() {
      const encours = synchro.executer();
      await Promise.race([encours, new Promise((r) => setTimeout(r, 15000))]);
      return synchro.etat();
    },

    // ---------- Utilisateurs ----------

    async listerComptesDev() {
      // En simulation : les employes ayant acces au portail. Sur le vrai EV : DEV_COMPTES (e-mails).
      const mails = (process.env.DEV_COMPTES || "").split(",").map((m) => m.trim()).filter(Boolean);
      const employes = mails.length
        ? (await client.getEmployees({ search: mails.map((m) => `e_mail:"${m}"`).join(","), max_rows: 50 })).records
        : (await client.getEmployees({ max_rows: 100 })).records;
      const utilisateurs = await Promise.all(employes.map((e) => this.getUtilisateur(e.EMPLOYEE_ID)));
      return utilisateurs.filter((x) => x && x.profil !== "AUCUN");
    },

    async getUtilisateur(id) {
      if (id == null) return null;
      return memo(`utilisateur:${id}`, 60e3, () => chargerUtilisateur(id));
    },

    // Recherche d'un demandeur (saisie d'un ticket pour son compte).
    async chercherEmployes(texte) {
      const motif = String(texte || "").replace(/["*~]/g, "").trim();
      if (motif.length < 2) return [];
      const { records } = await client.getEmployees({ search: `last_name~"*${motif}*"`, max_rows: 15 });
      return actifs(records, cfg.champsFin.employe).map((e) => {
        const [nom, prenom = ""] = String(e.LAST_NAME).split(/,\s*/);
        return {
          id: Number(e.EMPLOYEE_ID),
          nom: prenom ? `${prenom} ${nom}` : nom,
          fonction: e.JOB_TITLE || "",
          e_mail: e.E_MAIL,
          site: e.LOCATION?.LOCATION_ID ? { id: Number(e.LOCATION.LOCATION_ID), nom: e.LOCATION.LOCATION_FR } : null,
        };
      });
    },

    async vues(u) {
      return vuesPour(u);
    },

    // ---------- Préférences d'affichage ----------

    // { vue_defaut, statut_defaut } : vue et statut à l'ouverture du portail
    // (la première vue et « Actifs » si rien n'est choisi, ou si le choix
    // n'existe plus pour ce profil).
    async preferences(u) {
      const p = await cache.preferences.lire(u.id);
      const vues = vuesPour(u);
      return {
        vue_defaut: vues.some((v) => v.code === p.vue_defaut) ? p.vue_defaut : vues[0].code,
        statut_defaut: STATUTS_LISTE.includes(p.statut_defaut) ? p.statut_defaut : "ACTIFS",
      };
    },

    async definirPreferences(u, { vue_defaut, statut_defaut } = {}) {
      if (vue_defaut !== undefined) {
        if (!vuesPour(u).some((v) => v.code === vue_defaut)) throw new ErreurSource(400, "Vue inconnue");
        await cache.preferences.ecrire(u.id, "vue_defaut", vue_defaut);
      }
      if (statut_defaut !== undefined) {
        if (!STATUTS_LISTE.includes(statut_defaut)) throw new ErreurSource(400, "Statut inconnu");
        await cache.preferences.ecrire(u.id, "statut_defaut", statut_defaut);
      }
      return this.preferences(u);
    },

    // ---------- Referentiels ----------

    async listerEtablissements() {
      return actifs(await locationsEV(), cfg.champsFin.etablissement)
        .map((l) => ({ id: Number(l.LOCATION_ID), nom: l.LOCATION_FR || l.LOCATION_EN }))
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    },

    async listerGroupes() {
      return groupesIntervention();
    },

    async listerCatalogue() {
      return actifs(await catalogueEV(), cfg.champsFin.catalogue).map((c) => ({
        id: Number(c.SD_CATALOG_ID),
        type: M.typeDepuisChemin(c.CATALOG_REQUEST_PATH),
        ...M.lireCatalogue(c.CATALOG_REQUEST_PATH, c.TITLE_FR || c.TITLE_EN),
        questionnaire_id: c[cfg.champQuestionnaireCatalogue] ? Number(c[cfg.champQuestionnaireCatalogue]) : null,
      }));
    },

    async getQuestionnaire(u, id) {
      try {
        return await questionnaire(id);
      } catch (err) {
        if (err.status === 404) throw new ErreurSource(404, "Formulaire introuvable");
        throw err;
      }
    },

    // ---------- Tickets ----------

    async listerTickets(u, filtres = {}) {
      const vues = vuesPour(u);
      const vue = filtres.vue || vues[0].code;
      if (!vues.some((v) => v.code === vue)) throw new ErreurSource(400, "Vue non disponible");
      const tickets = (await ticketsVisibles(u)).filter(({ ctx }) => filtreVue(u, ctx, vue)).map(({ t }) => t);
      return filtrerTickets(tickets, filtres).sort((a, b) => String(b.date_creation).localeCompare(String(a.date_creation)));
    },

    async getTicket(u, rfc) {
      return ticketComplet(u, await contexteVisible(u, rfc));
    },

    // Fichier d'une pièce jointe, mêmes droits que le ticket : { nom, type, contenu }.
    async getPieceJointe(u, rfc, documentId) {
      await contexteVisible(u, rfc);
      if (!client.getDocument) throw new ErreurSource(404, "Pièce jointe introuvable");
      const doc = await client.getDocument(rfc, documentId);
      const nom = doc.nom || (await piecesJointes(rfc)).find((p) => p.id === String(documentId))?.nom || "piece-jointe";
      // Type deduit du nom si EV ne le donne pas (ou le donne generique).
      const type = doc.type && doc.type !== "application/octet-stream" ? doc.type : typeFichier(nom);
      return { nom, type, contenu: doc.contenu };
    },

    // Saisie par le support, pour le compte d'un demandeur (appel, passage, mail...).
    async creerTicket(u, data) {
      if (u.profil === "VALIDEUR") throw new ErreurSource(403, "La saisie de tickets est réservée aux équipes support");
      const cat = (await catalogueEV()).find((c) => String(c.SD_CATALOG_ID) === String(data.catalogue_id));
      if (!cat || M.estInactif(cat, cfg.champsFin.catalogue)) {
        throw new ErreurSource(400, "Choisissez ce qui est concerné dans le catalogue");
      }

      let demandeur;
      try {
        demandeur = await client.getEmployee(data.demandeur_id);
      } catch (err) {
        if (err.status === 404) throw new ErreurSource(400, "Choisissez le demandeur");
        throw err;
      }
      if (!demandeur?.E_MAIL) throw new ErreurSource(400, "Ce demandeur n'a pas d'adresse e-mail dans EasyVista");
      if (M.estInactif(demandeur, cfg.champsFin.employe)) throw new ErreurSource(400, "Ce demandeur a quitté l'établissement");

      const locations = await locationsEV();
      if (!actifs(locations, cfg.champsFin.etablissement).some((l) => String(l.LOCATION_ID) === String(data.etablissement_id))) {
        throw new ErreurSource(400, "Établissement inconnu");
      }
      // Titre facultatif (saisie en hotline) : a defaut, le libelle du catalogue.
      const titre = String(data.titre || "").trim() || M.lireCatalogue(cat.CATALOG_REQUEST_PATH, cat.TITLE_FR || cat.TITLE_EN).libelle;
      if (!titre) throw new ErreurSource(400, "Le titre est obligatoire");

      const demande = {
        requestor_mail: demandeur.E_MAIL,
        recipient_mail: demandeur.E_MAIL,
        location_id: Number(data.etablissement_id),
        title: titre,
        description: String(data.description || "").trim(),
      };
      if (cat.CODE) demande.catalog_code = cat.CODE;
      else if (cat.CATALOG_GUID) demande.catalog_guid = cat.CATALOG_GUID;
      else throw new ErreurSource(500, "Entrée de catalogue sans code ni GUID");

      if (M.typeDepuisChemin(cat.CATALOG_REQUEST_PATH) === "INCIDENT") {
        const impact = Number(data.impact);
        const urgence = Number(data.urgence);
        if (!cfg.impactEV[impact] || !cfg.urgenceEV[urgence]) throw new ErreurSource(400, "Indiquez l'impact et l'urgence");
        demande.urgency_id = cfg.urgenceEV[urgence];
        demande.severity_id = cfg.impactEV[impact];
      }

      // Formulaire du catalogue : reponses controlees AVANT toute creation.
      const formulaire = await questionnaireDuCatalogue(cat.SD_CATALOG_ID);
      const reponses = formulaire ? Q.validerReponses(formulaire, data.reponses) : {};

      // Avec formulaire : creation sans workflow, reponses, puis demarrage du
      // workflow (EV 2026.1+), pour qu'une etape qui depend d'une reponse la voie.
      const sansWorkflow = Boolean(formulaire) && cfg.creationSansWorkflow && Boolean(client.createRequestWithoutWorkflow);
      const { HREF } = sansWorkflow
        ? await client.createRequestWithoutWorkflow({ requests: [demande] })
        : await client.createRequest({ requests: [demande] });
      const rfc = String(HREF).split("/").pop();
      if (formulaire) {
        const { REQUEST_ID } = await client.getRequest(rfc);
        await enregistrerReponses(REQUEST_ID, reponses);
        if (sansWorkflow) await client.startWorkflow(rfc);
      }

      // Trace de la saisie : EV voit le compte de service comme createur.
      const cree = await synchro.relireTicket(rfc);
      const groupeId = cree ? M.analyser(cree.req, cree.actions).groupe?.id : null;
      const [nom, prenom = ""] = String(demandeur.LAST_NAME).split(/,\s*/);
      const origine = String(data.origine || "").trim();
      await client.createAction(rfc, {
        action: {
          action_type_name: cfg.typeCommentaire,
          group_id: groupeId || u.groupes[0]?.id,
          done_by_id: u.id,
          comment: `Ticket saisi par ${u.nom_complet} pour ${prenom ? `${prenom} ${nom}` : nom}${origine ? ` (${origine})` : ""}.`,
        },
      });

      // Hotline : solution trouvee pendant l'appel -> resolu (et clos) dans la foulee.
      const solution = String(data.solution || "").trim();
      if (!solution) return ticketComplet(u, await contexteDirect(rfc));
      const direct = await this.resoudreEnDirect(u, rfc, solution, { cloturer: data.cloturer !== false });
      return { ...(await ticketComplet(u, await contexteDirect(rfc))), resolution_directe: direct };
    },

    // Resolution « en direct » d'un ticket qu'on vient de saisir : prendre en charge,
    // resoudre avec la solution, puis cloturer (l'appelant a confirme au telephone).
    // Les memes boutons que dans le detail, enchaines : memes droits, meme workflow
    // EV. Si une etape n'est pas permise (validation prealable, groupe dont je ne
    // suis pas membre, formulaire de fin a remplir...), on s'arrete la et la
    // solution est gardee en commentaire : rien n'est perdu, le ticket suit son cours.
    async resoudreEnDirect(u, rfc, solution, { cloturer = true } = {}) {
      let resolu = false;
      let clos = false;
      let blocage = null;
      try {
        for (let i = 0; i < 4 && !clos; i++) {
          const { ctx } = await contexteDirect(rfc);
          // Seulement ce qu'on attend de MOI : jamais prendre le ticket d'un collegue.
          const possibles = new Set(M.actionsPossibles(u, ctx).filter((a) => !a.secondaire).map((a) => a.code));
          if (!resolu && possibles.has("TERMINER")) {
            await this.executerAction(u, rfc, { action: "TERMINER", commentaire: solution });
            resolu = true;
          } else if (!resolu && possibles.has("PRENDRE")) {
            await this.executerAction(u, rfc, { action: "PRENDRE" });
          } else if (resolu && cloturer && possibles.has("CLOTURER")) {
            await this.executerAction(u, rfc, { action: "CLOTURER" });
            clos = true;
          } else {
            const autreGroupe = ctx.groupe && !u.groupes.some((g) => g.id === ctx.groupe.id);
            if (!resolu) blocage = autreGroupe ? `EasyVista l'a orienté vers ${ctx.groupe.nom}` : `étape « ${ctx.etape.label} »`;
            break;
          }
        }
      } catch (err) {
        blocage = err.message;
      }
      if (!resolu) {
        const { ctx } = await contexteDirect(rfc);
        await tracer(u, rfc, ctx.groupe?.id, `Solution apportée pendant l'appel :\n${solution}`);
      }
      const message = clos
        ? "résolu et clôturé"
        : resolu
          ? "résolu, en attente de confirmation"
          : `créé mais pas résolu (${blocage || "étape inattendue"}) : solution notée en commentaire`;
      return { resolu, clos, message };
    },

    async executerAction(u, rfc, { action, commentaire, groupe_id, membre_id, reponses } = {}) {
      const { ctx, origine } = await contexteVisible(u, rfc);
      if (origine !== "ev") throw new ErreurSource(503, "EasyVista est injoignable : action impossible pour le moment");
      const a = M.actionsPossibles(u, ctx).find((x) => x.code === action);
      if (!a) throw new ErreurSource(403, "Cette action ne vous est pas permise à cette étape");
      const message = String(commentaire || "").trim();
      if (a.commentaire && !message) throw new ErreurSource(400, "Un commentaire est obligatoire pour cette action");

      const op = a.op;
      switch (op.type) {
        case "AFFECTER":
          await client.updateAction(op.action_id, { done_by_id: u.id });
          break;
        case "TERMINER": {
          // Formulaire de fin d'etape : reponses controlees et enregistrees avant de terminer.
          const formulaire = await questionnaireAction(ctx, op.action_id);
          if (formulaire) await enregistrerReponses(ctx.req.REQUEST_ID, Q.validerReponses(formulaire, reponses));
          await client.endAction(rfc, {
            end_action: {
              action_id: op.action_id,
              doneby_mail: u.e_mail,
              ...(op.choice != null ? { choice: op.choice } : {}),
              ...(message ? { comment: message } : {}),
            },
          });
          break;
        }
        case "SUSPENDRE":
          await client.updateRequest(rfc, { suspended: { comment: message, done_by_id: u.id } });
          break;
        case "REPRENDRE":
          // Le commentaire est obligatoire cote EV pour une reprise.
          await client.updateRequest(rfc, { restarted: { comment: message || "Reprise du traitement", done_by_id: u.id } });
          break;
        case "REAFFECTER": {
          const membre = (await collegues(u, ctx, op.group_id)).find((m) => m.id === Number(membre_id));
          if (!membre) throw new ErreurSource(400, "Choisissez le collègue à qui réaffecter le ticket");
          await client.updateAction(op.action_id, { done_by_id: membre.id });
          await tracer(u, rfc, op.group_id, `Réaffecté à ${membre.nom} par ${u.nom_complet}.${message ? `\n${message}` : ""}`);
          break;
        }
        case "DESAFFECTER": {
          const ancien = ctx.intervenant?.nom;
          await client.updateAction(op.action_id, { done_by_id: null });
          await tracer(
            u,
            rfc,
            ctx.groupe?.id,
            `Remis dans le groupe ${ctx.groupe?.nom || ""} (non affecté) par ${u.nom_complet}${ancien ? `, était affecté à ${ancien}` : ""}.${message ? `\n${message}` : ""}`
          );
          break;
        }
        case "TRANSFERER": {
          const g = (await groupesIntervention()).find((x) => x.id === Number(groupe_id));
          if (!g) throw new ErreurSource(400, "Choisissez le groupe vers lequel transférer");
          if (g.id === ctx.groupe?.id) throw new ErreurSource(400, "Le ticket est déjà affecté à ce groupe");
          await client.updateAction(op.action_id, { group_id: g.id, done_by_id: null });
          await client.createAction(rfc, {
            action: {
              action_type_name: cfg.typeCommentaire,
              group_id: g.id,
              done_by_id: u.id,
              comment: `Transféré vers ${g.nom}.\n${message}`,
            },
          });
          break;
        }
        case "COMMENTER": {
          const groupeId = ctx.groupe?.id || u.groupes[0]?.id || (await groupesIntervention())[0]?.id;
          await client.createAction(rfc, {
            action: { action_type_name: cfg.typeCommentaire, group_id: groupeId, done_by_id: u.id, comment: message },
          });
          break;
        }
        default:
          throw new ErreurSource(500, `Operation inconnue : ${op.type}`);
      }

      // Relecture EV (et mise a jour du cache) ; apres un transfert, l'utilisateur
      // peut ne plus avoir acces au ticket.
      const apres = await contexteDirect(rfc);
      if (!M.peutVoir(u, apres.ctx)) {
        return { id: rfc, masque: true, message: "Action enregistrée. Ce ticket ne fait plus partie de vos tickets." };
      }
      return ticketComplet(u, apres);
    },

    async stats(u, filtres = {}) {
      const visibles = await ticketsVisibles(u);

      // Compteurs par etablissement (a moi / total) : les tickets de la vue affichee,
      // avec les memes filtres, SAUF la selection d'etablissements (sinon les
      // non-coches tomberaient a 0).
      const parEtablissement = new Map();
      const vueAffichee = filtres.vue || vuesPour(u)[0].code;
      const horsGroupe = filtrerTickets(
        visibles.filter(({ ctx }) => filtreVue(u, ctx, vueAffichee)).map(({ t }) => t),
        { ...filtres, groupe: "" }
      );
      const deLaVue = visibles.filter(({ ctx }) => filtreVue(u, ctx, vueAffichee)).map(({ t }) => t);
      for (const t of filtrerTickets(deLaVue, filtres, { ignorerEtablissements: true })) {
        if (!t.etablissement) continue;
        const e = parEtablissement.get(t.etablissement.id) || { id: t.etablissement.id, moi: 0, total: 0 };
        if (t.affectation === "MOI") e.moi++;
        e.total++;
        parEtablissement.set(e.id, e);
      }

      const tickets = await this.listerTickets(u, filtres);

      // Compteurs des boutons de statut : meme vue et memes filtres, SAUF le statut
      // (sinon tous les autres boutons afficheraient 0).
      const sansStatut = await this.listerTickets(u, { ...filtres, statut: "" });
      const parFiltreStatut = {
        "": sansStatut.length,
        ACTIFS: sansStatut.filter((t) => avecStatut(t, "ACTIFS")).length,
        INACTIFS: sansStatut.filter((t) => avecStatut(t, "INACTIFS")).length,
      };

      // Compteurs des vues (rail et cartes) : memes filtres, chaque vue.
      const filtresHorsVue = filtrerTickets(visibles.map(({ t }) => t), filtres);
      const retenus = new Set(filtresHorsVue.map((t) => t.id));
      const parVue = {};
      for (const v of vuesPour(u)) {
        parVue[v.code] = visibles.filter(({ ctx, t }) => retenus.has(t.id) && filtreVue(u, ctx, v.code)).length;
      }
      const parStatut = {};
      tickets.forEach((t) => (parStatut[t.statut] = (parStatut[t.statut] || 0) + 1));
      return {
        total: tickets.length,
        parStatut,
        en_retard: tickets.filter((t) => t.en_retard).length,
        attendent_mon_action: tickets.filter((t) => t.attend_mon_action).length,
        parEtablissement: [...parEtablissement.values()],
        parFiltreStatut,
        parVue,
        // Tickets par groupe (à moi / total), comme les établissements : vue et
        // filtres affichés, sauf la sélection de groupes (sinon les autres tomberaient à 0).
        parGroupe: (await groupesIntervention()).map((g) => {
          const duGroupe = horsGroupe.filter((t) => t.groupe?.id === g.id);
          return { groupe: g, moi: duGroupe.filter((t) => t.affectation === "MOI").length, total: duGroupe.length };
        }),
      };
    },
  };
}

module.exports = { creerSource };
