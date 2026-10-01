// Tests de controle.js : detection des statuts, types d'action et groupes EV
// que correspondance.js ne connait pas (parametrage EV modifie).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifierCorrespondance } = require("../sources/portail/controle");
const M = require("../sources/portail/modele");
const F = require("./fabrique");

const groupesEV = [F.GROUPE_SD, F.GROUPE_SUPERVISION, F.GROUPE_VALIDEURS];

test("paramétrage connu : aucune anomalie", () => {
  const contextes = [
    { req: F.ticket("I1", "En cours"), actions: [F.action("Traitement incident"), F.action("Commentaire")] },
  ];
  assert.deepEqual(verifierCorrespondance(contextes, groupesEV), []);
});

test("statut et type d'action inconnus : signalés et comptés par ticket", () => {
  const contextes = [
    { req: F.ticket("I1", "En diagnostic"), actions: [F.action("Escalade éditeur")] },
    { req: F.ticket("I2", "En diagnostic"), actions: [] },
  ];
  const anomalies = verifierCorrespondance(contextes, groupesEV);
  assert.deepEqual(anomalies[0], { type: "statut", valeur: "En diagnostic", nb_tickets: 2, exemple: "I1" });
  assert.deepEqual(anomalies[1], { type: "type_action", valeur: "Escalade éditeur", nb_tickets: 1, exemple: "I1" });
});

test("action terminée de type inconnu : ignorée (seules les étapes en cours comptent)", () => {
  const contextes = [{ req: F.ticket("I1", "Clôturé"), actions: [F.action("Ancienne étape", { fin: "2026-01-01T00:00:00Z" })] }];
  assert.deepEqual(verifierCorrespondance(contextes, groupesEV), []);
});

test("groupe de superviseurs renommé dans EV : signalé (les superviseurs perdraient leur accès)", () => {
  const anomalies = verifierCorrespondance([], [F.GROUPE_SD, F.GROUPE_VALIDEURS]);
  assert.deepEqual(anomalies, [{ type: "groupe", valeur: "Supervision support", nb_tickets: 1, exemple: null }]);
});

test("tous les statuts EV connus correspondent à un statut du portail", () => {
  const statutsPortail = ["OUVERT", "EN_COURS", "EN_ATTENTE", "RESOLU", "CLOTURE"];
  for (const s of Object.values(require("../sources/portail/correspondance").statuts)) {
    assert.ok(statutsPortail.includes(s), `statut portail inconnu : ${s}`);
  }
  assert.equal(M.statutConnu(F.ticket("I1", "Nouveau")), "OUVERT");
});
