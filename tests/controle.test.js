// Tests de controle.js : detection des statuts, types d'action et groupes EV
// que correspondance.js ne connait pas (parametrage EV modifie).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifierCorrespondance } = require("../sources/portail/controle");
const F = require("./fabrique");

const { cfg, STATUT, TYPE } = F;
const groupesEV = [F.GROUPE_SD, F.GROUPE_SUPERVISION, F.GROUPE_VALIDEURS];

test("paramétrage connu : aucune anomalie", () => {
  const contextes = [
    { req: F.ticket(F.incident(1), STATUT.enCours), actions: [F.action(TYPE.traitement), F.action(TYPE.commentaire)] },
  ];
  assert.deepEqual(verifierCorrespondance(contextes, groupesEV), []);
});

test("types d'action hors workflow déclarés : pas d'alerte", () => {
  const actions = cfg.typesActionHorsWorkflow.map((t) => F.action(t));
  assert.deepEqual(verifierCorrespondance([{ req: F.ticket(F.incident(1), STATUT.enCours), actions }], groupesEV), []);
});

test("statut et type d'action inconnus : signalés et comptés par ticket", () => {
  const contextes = [
    { req: F.ticket(F.incident(1), "__statut_inconnu__"), actions: [F.action(TYPE.inconnu)] },
    { req: F.ticket(F.incident(2), "__statut_inconnu__"), actions: [] },
  ];
  const anomalies = verifierCorrespondance(contextes, groupesEV);
  assert.deepEqual(anomalies[0], { type: "statut", valeur: "__statut_inconnu__", nb_tickets: 2, exemple: F.incident(1) });
  assert.deepEqual(anomalies[1], { type: "type_action", valeur: TYPE.inconnu, nb_tickets: 1, exemple: F.incident(1) });
});

test("action terminée de type inconnu : ignorée (seules les étapes en cours comptent)", () => {
  const contextes = [{ req: F.ticket(F.incident(1), STATUT.enCours), actions: [F.action(TYPE.inconnu, { fin: F.ilYa(1) })] }];
  assert.deepEqual(verifierCorrespondance(contextes, groupesEV), []);
});

test("groupe de superviseurs disparu d'EV : signalé (les superviseurs perdraient leur accès)", () => {
  const anomalies = verifierCorrespondance([], [F.GROUPE_SD, F.GROUPE_VALIDEURS]);
  assert.deepEqual(anomalies, [{ type: "groupe", valeur: String(cfg.groupesSuperviseurs[0]), nb_tickets: 1, exemple: null }]);
});
