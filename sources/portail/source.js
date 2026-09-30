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

  async function titresCatalogue() {
    return new Map((await catalogueEV()).map((c) => [String(c.SD_CATALOG_ID), c.TITLE_FR || c.TITLE_EN]));
  }

  async function groupesIntervention() {
    return (await groupesEV())
      .map((g) => ({ id: Number(g.GROUP_ID), nom: g.GROUP_FR || g.GROUP_EN }))
      .filter((g) => !M.estGroupeTechnique(g.nom));
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
      const copie = cache.lire(rfc);
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
        { code: "moi", label: "Affectés à moi" },
        { code: "action", label: "Attendent mon action" },
      ],
      SUPERVISEUR: [
        { code: "tout", label: "Tous les tickets" },
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
      case "action":
        return M.attendMonAction(u, ctx);
      case "a_valider":
        return ctx.tc?.nature === "VALIDATION" && (r.assigne(p) || r.superviseur);
      default:
        return false;
    }
  }

  // Tickets du cache visibles par l'utilisateur, analyses.
  function contextesVisibles(u) {
    const depuisClos = new Date(Date.now() - JOURS_CLOS_AFFICHES * 86400e3).toISOString();
    return cache
      .candidats({
        tous: u.profil === "SUPERVISEUR",
        groupes: u.groupes.map((g) => g.id),
        personne: u.id,
        depuisClos,
      })
      .map(({ req, actions }) => M.analyser(req, actions))
      .filter((ctx) => M.peutVoir(u, ctx));
  }

  async function ticketComplet(u, { ctx, origine, lu_le, erreur_ev }) {
    return {
      ...M.versTicket(ctx, u, await titresCatalogue()),
      historique: M.historique(ctx),
      // Si EV est injoignable, on affiche la copie mais on ne propose aucune action.
      actions: origine === "ev" ? M.actionsPossibles(u, ctx).map(M.versActionPublique) : [],
      progression: M.progression(ctx),
      fraicheur: { origine, lu_le, erreur_ev: erreur_ev || null },
    };
  }

  return {
    nom: client.nom,

    demarrerSynchro() {
      synchro.demarrer();
    },

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
      return records.map((e) => {
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
      return (await locationsEV())
        .map((l) => ({ id: Number(l.LOCATION_ID), nom: l.LOCATION_FR || l.LOCATION_EN }))
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    },

    async listerGroupes() {
      return groupesIntervention();
    },

    async listerCatalogue() {
      return (await catalogueEV()).map((c) => ({
        id: Number(c.SD_CATALOG_ID),
        type: M.typeDepuisChemin(c.CATALOG_REQUEST_PATH),
        ...M.lireCatalogue(c.CATALOG_REQUEST_PATH, c.TITLE_FR || c.TITLE_EN),
      }));
    },

    // ---------- Tickets ----------

    async listerTickets(u, filtres = {}) {
      const vues = vuesPour(u);
      const vue = filtres.vue || vues[0].code;
      if (!vues.some((v) => v.code === vue)) throw new ErreurSource(400, "Vue non disponible");
      const q = filtres.q ? normaliser(filtres.q) : null;
      const titres = await titresCatalogue();

      return contextesVisibles(u)
        .filter((ctx) => filtreVue(u, ctx, vue))
        .map((ctx) => M.versTicket(ctx, u, titres))
        .filter((t) => !filtres.etablissement || t.etablissement?.id === Number(filtres.etablissement))
        .filter((t) => !filtres.groupe || t.groupe?.id === Number(filtres.groupe))
        .filter((t) => !filtres.statut || t.statut === filtres.statut)
        .filter((t) => !q || normaliser(`${t.numero} ${t.titre} ${t.demandeur?.nom}`).includes(q))
        .sort((a, b) => String(b.date_creation).localeCompare(String(a.date_creation)));
    },

    async getTicket(u, rfc) {
      return ticketComplet(u, await contexteVisible(u, rfc));
    },

    // Saisie par le support, pour le compte d'un demandeur (appel, passage, mail...).
    async creerTicket(u, data) {
      if (u.profil === "VALIDEUR") throw new ErreurSource(403, "La saisie de tickets est réservée aux équipes support");
      const cat = (await catalogueEV()).find((c) => String(c.SD_CATALOG_ID) === String(data.catalogue_id));
      if (!cat) throw new ErreurSource(400, "Choisissez ce qui est concerné dans le catalogue");

      let demandeur;
      try {
        demandeur = await client.getEmployee(data.demandeur_id);
      } catch (err) {
        if (err.status === 404) throw new ErreurSource(400, "Choisissez le demandeur");
        throw err;
      }
      if (!demandeur?.E_MAIL) throw new ErreurSource(400, "Ce demandeur n'a pas d'adresse e-mail dans EasyVista");

      const locations = await locationsEV();
      if (!locations.some((l) => String(l.LOCATION_ID) === String(data.etablissement_id))) {
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

      const { HREF } = await client.createRequest({ requests: [demande] });
      const rfc = String(HREF).split("/").pop();

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

    async executerAction(u, rfc, { action, commentaire, groupe_id } = {}) {
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
        case "TERMINER":
          await client.endAction(rfc, {
            end_action: {
              action_id: op.action_id,
              doneby_mail: u.e_mail,
              ...(op.choice != null ? { choice: op.choice } : {}),
              ...(message ? { comment: message } : {}),
            },
          });
          break;
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

    async stats(u, filtres = {}) {
      const tickets = await this.listerTickets(u, { vue: filtres.vue });
      const ouverts = tickets.filter((t) => !TERMINES.includes(t.statut));
      const parStatut = {};
      tickets.forEach((t) => (parStatut[t.statut] = (parStatut[t.statut] || 0) + 1));
      return {
        total: tickets.length,
        parStatut,
        en_retard: tickets.filter((t) => t.en_retard).length,
        attendent_mon_action: tickets.filter((t) => t.attend_mon_action).length,
        parGroupe: (await groupesIntervention()).map((g) => ({
          groupe: g,
          n: ouverts.filter((t) => t.groupe?.id === g.id).length,
        })),
      };
    },
  };
}

module.exports = { creerSource };
