// fabrique.js — donnees de test au format de l'API EV.
//
// Les noms de statuts, types d'action et groupes ne sont PAS ecrits en dur : ils
// sont lus dans correspondance.js. Quand ce fichier sera adapte a la vraie
// instance EV, les tests suivront sans modification. Si une notion n'existe pas
// dans le parametrage (ex. pas d'etape de confirmation), `absent()` permet de
// sauter les tests qui en dependent.

const cfg = require("../sources/portail/correspondance");

const premiere = (table, test) => Object.keys(table).find((k) => test(table[k]));

// ---------- Statuts EV ----------

const sortie = cfg.statutsSortie.map(String);
const STATUT = {
  nouveau: premiere(cfg.statuts, (v) => v === "OUVERT") || premiere(cfg.statuts, (v) => v === "EN_COURS"),
  enCours: premiere(cfg.statuts, (v) => v === "EN_COURS"),
  enAttente: Object.keys(cfg.statuts).find((k) => cfg.statuts[k] === "EN_ATTENTE" && k !== String(cfg.statutSuspendu)),
  suspendu: cfg.statutSuspendu,
  resolu: premiere(cfg.statuts, (v) => v === "RESOLU"),
  cloture: Object.keys(cfg.statuts).find((k) => cfg.statuts[k] === "CLOTURE" && !sortie.includes(k)),
  refuse: cfg.statutsSortie[0],
};

// ---------- Types d'action EV (par nature d'etape) ----------

const typeDeNature = (nature) => premiere(cfg.typesAction, (t) => t.nature === nature);
const TYPE = {
  traitement: typeDeNature("TRAITEMENT"),
  validation: typeDeNature("VALIDATION"),
  confirmation: typeDeNature("CONFIRMATION"),
  commentaire: cfg.typeCommentaire,
  inconnu: "__type_action_inconnu_des_tests__",
};
// Parametrage de l'etape de traitement (libelles, codes, bouton "terminer").
const TRAITEMENT = cfg.typesAction[TYPE.traitement];

// ---------- Groupes EV ----------

// Un groupe de correspondance.js peut etre designe par son id ou par son libelle.
const groupeRef = (ref, idParDefaut, nomParDefaut) =>
  /^\d+$/.test(String(ref)) ? { GROUP_ID: Number(ref), GROUP_FR: nomParDefaut } : { GROUP_ID: idParDefaut, GROUP_FR: String(ref) };

const GROUPE_SUPERVISION = groupeRef(cfg.groupesSuperviseurs[0], 900090, "Supervision (test)");
const GROUPE_VALIDEURS = groupeRef(cfg.groupesValideurs[0], 900091, "Valideurs (test)");
// Groupes d'intervenants fictifs : ids hors de ceux de correspondance.js.
const GROUPE_SD = { GROUP_ID: 900010, GROUP_FR: "Groupe test A" };
const GROUPE_INFRA = { GROUP_ID: 900020, GROUP_FR: "Groupe test B" };

// ---------- Numeros de ticket ----------

const prefixe = (type) => Object.keys(cfg.typeDepuisNumero).find((p) => cfg.typeDepuisNumero[p] === type);
const PREFIXE = { incident: prefixe("INCIDENT"), demande: prefixe("DEMANDE") };
const incident = (n) => `${PREFIXE.incident}260901_${String(n).padStart(6, "0")}`;
const demande = (n) => `${PREFIXE.demande}260901_${String(n).padStart(6, "0")}`;

// ---------- Dates ----------

const ilYa = (jours, heures = 0) => new Date(Date.now() - jours * 86400e3 - heures * 3600e3).toISOString();

// ---------- Constructeurs ----------

const employe = (id, nomEV, extra = {}) => ({ EMPLOYEE_ID: id, LAST_NAME: nomEV, E_MAIL: `${id}@test`, ...extra });
const DEMANDEUR = employe(500, "Roux, Julien");

// Ticket EV : numero (voir incident() / demande()) et statut EV (voir STATUT).
const ticket = (numero, statut, extra = {}) => ({
  RFC_NUMBER: numero,
  TITLE: `Ticket ${numero}`,
  STATUS: { STATUS_FR: statut },
  REQUESTOR: DEMANDEUR,
  SUBMIT_DATE_UT: ilYa(3),
  LAST_UPDATE: ilYa(1),
  ...extra,
});

// Action EV : type, groupe, intervenant affecte (DONE_BY), fin et choix eventuels.
let prochainId = 1;
const action = (type, { groupe = GROUPE_SD, faitPar = null, fin = null, choix, debut = ilYa(3, -1) } = {}) => ({
  ACTION_ID: prochainId++,
  ACTION_TYPE: { NAME_FR: type },
  GROUP: groupe,
  DONE_BY_ID: faitPar ? faitPar.EMPLOYEE_ID : null,
  DONE_BY: faitPar,
  START_DATE_UT: debut,
  END_DATE_UT: fin,
  CHOICE: choix,
});

// Raison de sauter un test si une notion manque au parametrage EV, sinon false.
const absent = (valeur, notion) => (valeur ? false : `non paramétré dans correspondance.js : ${notion}`);

module.exports = {
  cfg,
  STATUT,
  TYPE,
  TRAITEMENT,
  GROUPE_SD,
  GROUPE_INFRA,
  GROUPE_SUPERVISION,
  GROUPE_VALIDEURS,
  PREFIXE,
  incident,
  demande,
  ilYa,
  employe,
  DEMANDEUR,
  ticket,
  action,
  absent,
};
