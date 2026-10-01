// faux-ev.js — un EasyVista en memoire, minimal, pour les tests PostgreSQL.
//
// Meme interface que les clients du portail (sources/clients/http.js) pour les
// routes dont la synchro et la source ont besoin. Les tests le pilotent
// directement (ajouter, modifier, panne...) puis verifient ce que le portail
// en a fait dans sa base.

const cfg = require("../sources/portail/correspondance");
const F = require("./fabrique");

function creerFauxEV({ groupes = [] } = {}) {
  const tickets = new Map(); // RFC_NUMBER -> ticket EV
  let actions = []; // actions EV, avec REQUEST.RFC_NUMBER
  const employes = new Map(); // EMPLOYEE_ID -> { employe, groupes }
  let enPanne = null;
  let prochainId = 100000;
  let dernier = 0;

  const copie = (x) => structuredClone(x);
  const verifier = () => {
    if (enPanne) throw new Error(enPanne);
  };
  const introuvable = (quoi) => Object.assign(new Error(`${quoi} introuvable`), { status: 404 });
  // Horodatage strictement croissant : deux modifications ne partagent jamais le meme LAST_UPDATE.
  const maintenant = () => new Date((dernier = Math.max(Date.now(), dernier + 1))).toISOString();
  const toucher = (rfc) => (tickets.get(rfc).LAST_UPDATE = maintenant());
  const page = (liste, { max_rows = 100, offset = 0 } = {}) => ({ records: copie(liste.slice(offset, offset + max_rows)) });
  const trouverAction = (id) => {
    const a = actions.find((x) => String(x.ACTION_ID) === String(id));
    if (!a) throw introuvable(`Action ${id}`);
    return a;
  };
  const personne = (id) => (id ? employes.get(Number(id))?.employe || null : null);

  return {
    nom: "faux-ev",

    // ---------- Pilotage par les tests ----------

    ajouter(req, acts = []) {
      tickets.set(req.RFC_NUMBER, copie(req));
      actions = actions.filter((a) => a.REQUEST.RFC_NUMBER !== req.RFC_NUMBER);
      for (const a of acts) actions.push({ ...copie(a), REQUEST: { RFC_NUMBER: req.RFC_NUMBER } });
    },
    ajouterEmploye(employe, groupesEmploye) {
      employes.set(Number(employe.EMPLOYEE_ID), { employe, groupes: groupesEmploye });
    },
    modifier(rfc, champs) {
      Object.assign(tickets.get(rfc), champs);
      toucher(rfc);
    },
    supprimer(rfc) {
      tickets.delete(rfc);
      actions = actions.filter((a) => a.REQUEST.RFC_NUMBER !== rfc);
    },
    // Acces direct a une action (modification "silencieuse", sans toucher le ticket).
    action: (id) => trouverAction(id),
    actionsDe: (rfc) => actions.filter((a) => a.REQUEST.RFC_NUMBER === rfc),
    panne(message = "EasyVista injoignable (test)") {
      enPanne = message;
    },
    reparer() {
      enPanne = null;
    },

    // ---------- API EV (lecture) ----------

    async getRequests(opts) {
      verifier();
      const liste = [...tickets.values()].sort((a, b) => String(b.LAST_UPDATE).localeCompare(String(a.LAST_UPDATE)));
      return page(liste, opts);
    },
    async getRequest(rfc) {
      verifier();
      if (!tickets.has(rfc)) throw introuvable(`Ticket ${rfc}`);
      return copie(tickets.get(rfc));
    },
    async getActions({ search = "", ...opts } = {}) {
      verifier();
      const parTicket = search.match(/request\.rfc_number:"(.+)"/);
      let liste = actions;
      if (parTicket) liste = actions.filter((a) => a.REQUEST.RFC_NUMBER === parTicket[1]);
      else if (search.includes("end_date_ut")) liste = actions.filter((a) => !a.END_DATE_UT);
      else liste = [...actions].sort((a, b) => String(b.START_DATE_UT).localeCompare(String(a.START_DATE_UT)));
      return page(liste, opts);
    },
    async getGroups() {
      verifier();
      return { records: copie(groupes) };
    },
    async getCatalog() {
      return { records: [] };
    },
    async getLocations() {
      return { records: [] };
    },
    async getEmployee(id) {
      verifier();
      const e = employes.get(Number(id));
      if (!e) throw introuvable(`Employé ${id}`);
      return copie(e.employe);
    },
    async getEmployees() {
      return { records: [...employes.values()].map((e) => copie(e.employe)) };
    },
    async getEmployeeGroups(id) {
      return { records: copie(employes.get(Number(id))?.groupes || []) };
    },
    async getGroupEmployees(groupeId) {
      const membres = [...employes.values()].filter((e) => e.groupes.some((g) => g.GROUP_ID === Number(groupeId)));
      return { records: membres.map((e) => copie(e.employe)) };
    },

    // ---------- API EV (ecriture) ----------

    async updateAction(id, champs) {
      verifier();
      const a = trouverAction(id);
      if ("done_by_id" in champs) {
        a.DONE_BY_ID = champs.done_by_id;
        a.DONE_BY = personne(champs.done_by_id);
      }
      if (champs.group_id) a.GROUP = groupes.find((g) => g.GROUP_ID === Number(champs.group_id));
      toucher(a.REQUEST.RFC_NUMBER);
    },
    async endAction(rfc, { end_action }) {
      verifier();
      const a = trouverAction(end_action.action_id);
      Object.assign(a, { END_DATE_UT: maintenant(), CHOICE: end_action.choice, COMMENT: end_action.comment });
      toucher(rfc);
    },
    async createAction(rfc, { action }) {
      verifier();
      const date = maintenant();
      actions.push({
        ACTION_ID: prochainId++,
        ACTION_TYPE: { NAME_FR: action.action_type_name },
        GROUP: groupes.find((g) => g.GROUP_ID === Number(action.group_id)) || null,
        DONE_BY_ID: action.done_by_id,
        DONE_BY: personne(action.done_by_id),
        START_DATE_UT: date,
        END_DATE_UT: date,
        COMMENT: action.comment,
        REQUEST: { RFC_NUMBER: rfc },
      });
      toucher(rfc);
    },
    async updateRequest(rfc, demande) {
      verifier();
      const req = tickets.get(rfc);
      if (demande.suspended) req.STATUS = { STATUS_FR: cfg.statutSuspendu };
      if (demande.restarted) req.STATUS = { STATUS_FR: F.STATUT.enCours };
      toucher(rfc);
    },
  };
}

module.exports = { creerFauxEV };
