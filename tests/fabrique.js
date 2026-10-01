// fabrique.js — petits constructeurs de donnees au format de l'API EV, pour les tests.
// Les noms (statuts, types d'action, groupes) sont ceux de correspondance.js.

const GROUPE_SD = { GROUP_ID: 10, GROUP_FR: "Service Desk" };
const GROUPE_INFRA = { GROUP_ID: 20, GROUP_FR: "Infrastructure N2" };
const GROUPE_SUPERVISION = { GROUP_ID: 90, GROUP_FR: "Supervision support" };
const GROUPE_VALIDEURS = { GROUP_ID: 91, GROUP_FR: "Cadres valideurs" };

const employe = (id, nomEV, extra = {}) => ({ EMPLOYEE_ID: id, LAST_NAME: nomEV, E_MAIL: `${id}@test`, ...extra });

// Ticket EV : numero (I... incident, S... demande) et statut EV.
const ticket = (numero, statut, extra = {}) => ({
  RFC_NUMBER: numero,
  TITLE: `Ticket ${numero}`,
  STATUS: { STATUS_FR: statut },
  REQUESTOR: employe(500, "Roux, Julien"),
  SUBMIT_DATE_UT: "2026-09-01T08:00:00Z",
  ...extra,
});

// Action EV : type (libelle), groupe, intervenant affecte (DONE_BY) eventuel.
let prochainId = 1;
const action = (type, { groupe = GROUPE_SD, faitPar = null, fin = null, choix, debut = "2026-09-01T09:00:00Z" } = {}) => ({
  ACTION_ID: prochainId++,
  ACTION_TYPE: { NAME_FR: type },
  GROUP: groupe,
  DONE_BY_ID: faitPar ? faitPar.EMPLOYEE_ID : null,
  DONE_BY: faitPar,
  START_DATE_UT: debut,
  END_DATE_UT: fin,
  CHOICE: choix,
});

module.exports = { GROUPE_SD, GROUPE_INFRA, GROUPE_SUPERVISION, GROUPE_VALIDEURS, employe, ticket, action };
