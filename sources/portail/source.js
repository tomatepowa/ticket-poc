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

  function vuesPour(u) {
    const vues = {
      INTERVENANT: [
        { code: "groupes", label: "File de mes groupes" },
        { code: "non_affectes", label: "Non affectés de mes groupes" },
        { code: "moi", label: "Affectés à moi" },
        { code: "action", label: "Attendent mon action" },
      ],
      SUPERVISEUR: [
        { code: "tout", label: "Tous les tickets" },
        { code: "non_affectes", label: "Non affectés" },
        { code: "moi", label: "Affectés à moi" },
        { code: "action", label: "Attendent mon action" },
        { code: "a_valider", label: "En attente de validation" },
      ],
      VALIDEUR: [
        { code: "a_valider", label: "À valider" },
        { code: "tout", label: "Mes validations" },
      ],
    }[u.profil];
    if (!vues) throw new ErreurSource(403, "Portail réservé aux équipes support et aux valideurs");
    return vues;
  }

  function filtreVue(u, ctx, vue) {
    const r = M.roles(u, ctx);
    const p = ctx.principale;
    switch (vue) {
      case "tout":
        return true;
      case "moi":
        return Boolean(p) && r.assigne(p);
      case "groupes":
        return Boolean(p) && r.mesGroupes.has(M.idGroupe(p));
      case "non_affectes":
        // Traitement en attente de prise en charge, dans mes groupes (tous pour un superviseur).
        return (
          ctx.tc?.nature === "TRAITEMENT" &&
          !M.idAuteur(p) &&
          (r.superviseur || r.mesGroupes.has(M.idGroupe(p)))
        );
      case "action":
        return M.attendMonAction(u, ctx);
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
    const etablissements = ignorerEtablissements
      ? []
      : String(filtres.etablissement || "")
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0);
    return tickets
      .filter((t) => !etablissements.length || etablissements.includes(t.etablissement?.id))
      .filter((t) => !filtres.groupe || t.groupe?.id === Number(filtres.groupe))
      .filter((t) => !filtres.statut || t.statut === filtres.statut)
      .filter((t) => !q || normaliser(`${t.numero} ${t.titre} ${t.demandeur?.nom}`).includes(q));
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

  async function ticketComplet(u, { ctx, origine, lu_le, erreur_ev }) {
    let actions = [];
    let formulaire = null;
    // Si EV est injoignable, on affiche la copie mais on ne propose aucune action.
    if (origine === "ev") {
      actions = await Promise.all(
        M.actionsPossibles(u, ctx).map(async (a) => ({
          ...M.versActionPublique(a),
          // Formulaire EV a remplir pour terminer cette etape
          questionnaire: a.op.type === "TERMINER" ? await questionnaireAction(ctx, a.op.action_id) : null,
        }))
      );
      if (client.getQuestionResults) {
        const resultats = (await client.getQuestionResults(ctx.req.REQUEST_ID)).records;
        if (resultats.length) {
          const q = await questionnaireDuCatalogue(ctx.req.SD_CATALOG_ID);
          formulaire = { titre: q?.titre || "Formulaire", reponses: Q.reponsesLisibles(q, resultats) };
        }
      }
    }
    return {
      ...M.versTicket(ctx, u, await titresCatalogue()),
      formulaire,
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
      const titres = await titresCatalogue();

      const tickets = (await contextesVisibles(u))
        .filter((ctx) => filtreVue(u, ctx, vue))
        .map((ctx) => M.versTicket(ctx, u, titres));
      return filtrerTickets(tickets, filtres).sort((a, b) => String(b.date_creation).localeCompare(String(a.date_creation)));
    },

    async getTicket(u, rfc) {
      return ticketComplet(u, await contexteVisible(u, rfc));
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
      const titre = String(data.titre || "").trim();
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
      return ticketComplet(u, await contexteDirect(rfc));
    },

    async executerAction(u, rfc, { action, commentaire, groupe_id, reponses } = {}) {
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

    // Stats de la liste affichee : memes vue et filtres que la liste.
    async stats(u, filtres = {}) {
      const titres = await titresCatalogue();
      const mesGroupes = new Set(u.groupes.map((g) => g.id));

      // Compteurs par etablissement (a moi / de mes groupes) : tous les tickets
      // visibles, filtres par recherche / groupe / statut mais PAS par la vue ni
      // par la selection d'etablissements (sinon les non-coches tomberaient a 0).
      // Sans filtre de statut : seulement les tickets en cours.
      const tous = (await contextesVisibles(u)).map((ctx) => M.versTicket(ctx, u, titres));
      const parEtablissement = new Map();
      for (const t of filtrerTickets(tous, filtres, { ignorerEtablissements: true })) {
        if (!filtres.statut && TERMINES.includes(t.statut)) continue;
        if (!t.etablissement) continue;
        const e = parEtablissement.get(t.etablissement.id) || { id: t.etablissement.id, moi: 0, groupes: 0 };
        if (t.affectation === "MOI") e.moi++;
        if (u.profil === "SUPERVISEUR" || (t.groupe && mesGroupes.has(t.groupe.id))) e.groupes++;
        parEtablissement.set(e.id, e);
      }

      const tickets = await this.listerTickets(u, filtres);
      const ouverts = tickets.filter((t) => !TERMINES.includes(t.statut));
      const parStatut = {};
      tickets.forEach((t) => (parStatut[t.statut] = (parStatut[t.statut] || 0) + 1));
      return {
        total: tickets.length,
        parStatut,
        en_retard: tickets.filter((t) => t.en_retard).length,
        attendent_mon_action: tickets.filter((t) => t.attend_mon_action).length,
        parEtablissement: [...parEtablissement.values()],
        parGroupe: (await groupesIntervention()).map((g) => ({
          groupe: g,
          n: ouverts.filter((t) => t.groupe?.id === g.id).length,
        })),
      };
    },
  };
}

module.exports = { creerSource };
