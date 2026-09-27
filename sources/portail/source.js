// source.js — la source du portail, construite sur un client EasyVista.
//
// Le meme code tourne sur le faux EV (clients/simule) et sur la vraie API
// (clients/http) : seul le client change. Ce fichier traduit chaque besoin
// du portail en appels REST EV, et applique les droits via modele.js.

const cfg = require("./correspondance");
const M = require("./modele");
const { ErreurSource } = require("../erreurs");

const TERMINES = ["RESOLU", "CLOTURE"];
const normaliser = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function creerSource(client) {
  // ---------- Caches (les referentiels EV changent rarement) ----------
  const cache = new Map();
  async function memo(cle, ttlMs, fn) {
    const c = cache.get(cle);
    if (c && c.expire > Date.now()) return c.valeur;
    const valeur = await fn();
    cache.set(cle, { valeur, expire: Date.now() + ttlMs });
    return valeur;
  }
  const CINQ_MIN = 5 * 60e3;
  const statutsEV = () => memo("statuts", CINQ_MIN, async () => (await client.getStatuses()).records);
  const groupesEV = () => memo("groupes", CINQ_MIN, async () => (await client.getGroups()).records);
  const catalogueEV = () => memo("catalogue", CINQ_MIN, async () => (await client.getCatalog()).records);
  const locationsEV = () => memo("locations", CINQ_MIN, async () => (await client.getLocations()).records);

  async function titresCatalogue() {
    return new Map((await catalogueEV()).map((c) => [String(c.SD_CATALOG_ID), c.TITLE_FR || c.TITLE_EN]));
  }

  async function groupesIntervention() {
    return (await groupesEV())
      .map((g) => ({ id: Number(g.GROUP_ID), nom: g.GROUP_FR || g.GROUP_EN }))
      .filter((g) => !M.estSuperviseurGroupe(g.nom));
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

  async function contexte(rfc) {
    let req;
    try {
      req = await client.getRequest(rfc);
    } catch (err) {
      if (err.status === 404) throw new ErreurSource(404, "Ticket introuvable");
      throw err;
    }
    const actions = (await client.getActions({ search: `request.rfc_number:"${rfc}"`, max_rows: 500 })).records;
    return M.analyser(req, actions);
  }

  async function contexteVisible(u, rfc) {
    const ctx = await contexte(rfc);
    // 404 aussi quand le ticket existe mais n'est pas visible : on ne revele pas son existence.
    if (!M.peutVoir(u, ctx)) throw new ErreurSource(404, "Ticket introuvable");
    return ctx;
  }

  const actionsEnCours = async () =>
    (await client.getActions({ search: 'end_date_ut:"is_null"', max_rows: 2000 })).records;

  async function vuesPour(u) {
    const vues = {
      UTILISATEUR: [
        { code: "moi", label: "Mes demandes" },
        { code: "action", label: "Attendent mon action" },
      ],
      INTERVENANT: [
        { code: "groupes", label: "File de mes groupes" },
        { code: "moi", label: "Mes tickets" },
        { code: "action", label: "Attendent mon action" },
      ],
      SUPERVISEUR: [
        { code: "tout", label: "Tous les tickets" },
        { code: "moi", label: "Mes tickets" },
        { code: "action", label: "Attendent mon action" },
      ],
    }[u.profil];
    let valideur = u.profil === "SUPERVISEUR";
    if (!valideur) {
      const miennes = await client.getActions({ search: `end_date_ut:"is_null",done_by_id:"${u.id}"`, max_rows: 200 });
      valideur = miennes.records.some((a) => M.etapeWorkflow(a)?.nature === "VALIDATION");
    }
    if (valideur) vues.push({ code: "a_valider", label: "À valider" });
    return vues;
  }

  // Tickets candidats pour l'utilisateur, avec leurs actions en cours.
  async function ticketsCandidats(u) {
    const encours = await actionsEnCours();
    let requetes;
    if (u.profil === "SUPERVISEUR") {
      requetes = (await client.getRequests({ max_rows: 500, sort: "submit_date_ut+desc" })).records;
    } else {
      const mesGroupes = new Set(u.groupes.map((g) => g.id));
      const rfcs = new Set(
        encours.filter((a) => mesGroupes.has(M.idGroupe(a)) || M.idAuteur(a) === u.id).map(M.rfcAction)
      );
      const [commeDemandeur, commeBeneficiaire] = await Promise.all([
        client.getRequests({ search: `requestor.employee_id:"${u.id}"`, max_rows: 500 }),
        client.getRequests({ search: `recipient.employee_id:"${u.id}"`, max_rows: 500 }),
      ]);
      const connues = new Map([...commeDemandeur.records, ...commeBeneficiaire.records].map((r) => [r.RFC_NUMBER, r]));
      const manquants = [...rfcs].filter((rfc) => rfc && !connues.has(rfc));
      if (manquants.length) {
        // Meme champ repete = OU dans la syntaxe de recherche EV.
        const autres = await client.getRequests({
          search: manquants.map((rfc) => `rfc_number:"${rfc}"`).join(","),
          max_rows: manquants.length,
        });
        autres.records.forEach((r) => connues.set(r.RFC_NUMBER, r));
      }
      requetes = [...connues.values()];
    }
    const parRfc = {};
    encours.forEach((a) => (parRfc[M.rfcAction(a)] ||= []).push(a));
    return requetes.map((req) => M.analyser(req, parRfc[req.RFC_NUMBER] || []));
  }

  function filtreVue(u, ctx, vue) {
    const r = M.roles(u, ctx);
    const p = ctx.principale;
    switch (vue) {
      case "tout":
        return true;
      case "moi":
        return r.demandeur || (p && r.assigne(p));
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

  return {
    nom: client.nom,

    // ---------- Utilisateurs ----------

    async listerComptesDev() {
      // En simulation : tous les employes. Sur le vrai EV : DEV_COMPTES (e-mails separes par des virgules).
      const mails = (process.env.DEV_COMPTES || "").split(",").map((m) => m.trim()).filter(Boolean);
      const employes = mails.length
        ? (await client.getEmployees({ search: mails.map((m) => `e_mail:"${m}"`).join(","), max_rows: 50 })).records
        : (await client.getEmployees({ max_rows: 30 })).records;
      return Promise.all(employes.map((e) => this.getUtilisateur(e.EMPLOYEE_ID)));
    },

    async getUtilisateur(id) {
      if (id == null) return null;
      return memo(`utilisateur:${id}`, 60e3, () => chargerUtilisateur(id));
    },

    async vues(u) {
      return vuesPour(u);
    },

    // ---------- Referentiels ----------

    async listerEtablissements() {
      return (await locationsEV()).map((l) => ({ id: Number(l.LOCATION_ID), nom: l.LOCATION_FR || l.LOCATION_EN }));
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
      const vues = await vuesPour(u);
      const vue = filtres.vue || vues[0].code;
      if (!vues.some((v) => v.code === vue)) throw new ErreurSource(400, "Vue non disponible");
      const q = filtres.q ? normaliser(filtres.q) : null;
      const titres = await titresCatalogue();

      return (await ticketsCandidats(u))
        .filter((ctx) => filtreVue(u, ctx, vue))
        .map((ctx) => M.versTicket(ctx, u, titres))
        .filter((t) => !filtres.etablissement || t.etablissement?.id === Number(filtres.etablissement))
        .filter((t) => !filtres.groupe || t.groupe?.id === Number(filtres.groupe))
        .filter((t) => !filtres.statut || t.statut === filtres.statut)
        .filter((t) => !q || normaliser(`${t.numero} ${t.titre} ${t.demandeur?.nom}`).includes(q))
        .sort((a, b) => String(b.date_creation).localeCompare(String(a.date_creation)));
    },

    async getTicket(u, rfc) {
      const ctx = await contexteVisible(u, rfc);
      return {
        ...M.versTicket(ctx, u, await titresCatalogue()),
        historique: M.historique(ctx),
        actions: M.actionsPossibles(u, ctx).map(M.versActionPublique),
        progression: M.progression(ctx),
      };
    },

    async creerTicket(u, data) {
      const cat = (await catalogueEV()).find((c) => String(c.SD_CATALOG_ID) === String(data.catalogue_id));
      if (!cat) throw new ErreurSource(400, "Choisissez ce qui est concerné dans le catalogue");
      const locations = await locationsEV();
      if (!locations.some((l) => String(l.LOCATION_ID) === String(data.etablissement_id))) {
        throw new ErreurSource(400, "Établissement inconnu");
      }
      const titre = String(data.titre || "").trim();
      if (!titre) throw new ErreurSource(400, "Le titre est obligatoire");

      const demande = {
        requestor_mail: u.e_mail,
        recipient_mail: u.e_mail,
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
      return this.getTicket(u, rfc);
    },

    async executerAction(u, rfc, { action, commentaire, groupe_id } = {}) {
      const ctx = await contexteVisible(u, rfc);
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
        case "ANNULER": {
          const statut = (await statutsEV()).find((s) => (s.STATUS_FR || s.STATUS_EN) === cfg.statutAnnulation);
          await client.updateRequest(rfc, {
            closed: { ...(statut ? { status_guid: statut.STATUS_GUID } : {}), comment: message, done_by_id: u.id, delete_actions: 1 },
          });
          break;
        }
        default:
          throw new ErreurSource(500, `Operation inconnue : ${op.type}`);
      }

      // Apres un transfert, l'utilisateur peut ne plus avoir acces au ticket.
      if (!M.peutVoir(u, await contexte(rfc))) {
        return { id: rfc, masque: true, message: "Action enregistrée. Ce ticket ne fait plus partie de vos tickets." };
      }
      return this.getTicket(u, rfc);
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
