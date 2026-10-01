// Tests de questionnaires.js : controle des reponses aux formulaires EV avant envoi.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../sources/portail/questionnaires");
const { ErreurSource } = require("../sources/erreurs");

// Formulaire au format EV : un choix, une question conditionnelle, un nombre, une date, un oui/non.
const formulaire = Q.lireQuestionnaire({
  QUESTIONNAIRE_ID: 7,
  NAME_FR: "Nouvel arrivant",
  QUESTIONS: [
    { QUESTION_ID: 1, QUESTION_FR: "Type de poste", QUESTION_TYPE: "LIST", MANDATORY: true, ANSWERS: ["Fixe", "Portable"] },
    { QUESTION_ID: 2, QUESTION_FR: "Sacoche ?", QUESTION_TYPE: "BOOLEAN", MANDATORY: true, CONDITION: { QUESTION_ID: 1, VALUES: ["Portable"] } },
    { QUESTION_ID: 3, QUESTION_FR: "Nombre d'écrans", QUESTION_TYPE: "NUMBER" },
    { QUESTION_ID: 4, QUESTION_FR: "Date d'arrivée", QUESTION_TYPE: "DATE", MANDATORY: true },
    { QUESTION_ID: 5, QUESTION_FR: "Logiciels", QUESTION_TYPE: "MULTI", ANSWERS: ["Office", "DPI", "SIRH"] },
  ],
});

// Message d'erreur renvoye par validerReponses (ou null si accepte).
function erreur(reponses) {
  try {
    Q.validerReponses(formulaire, reponses);
    return null;
  } catch (e) {
    assert.ok(e instanceof ErreurSource);
    assert.equal(e.status, 400);
    return e.message;
  }
}

describe("lecture du format EV", () => {
  test("types et options traduits", () => {
    assert.equal(formulaire.titre, "Nouvel arrivant");
    assert.deepEqual(formulaire.questions.map((q) => q.type), ["choix", "oui_non", "nombre", "date", "choix_multiples"]);
    assert.deepEqual(formulaire.questions[1].condition, { question: 1, valeurs: ["Portable"] });
  });
});

describe("contrôle des réponses", () => {
  test("réponses complètes : acceptées et normalisées", () => {
    const r = Q.validerReponses(formulaire, { 1: "Portable", 2: "true", 3: "2", 4: "2026-10-15", 5: ["Office", "DPI"] });
    assert.deepEqual(r, { 1: "Portable", 2: true, 3: 2, 4: "2026-10-15", 5: ["Office", "DPI"] });
  });

  test("question obligatoire vide : refusée", () => {
    assert.match(erreur({ 1: "Fixe" }), /Date d'arrivée.*obligatoire/);
  });

  test("question conditionnelle masquée : ni exigée, ni envoyée", () => {
    const r = Q.validerReponses(formulaire, { 1: "Fixe", 2: true, 4: "2026-10-15" });
    assert.equal(r[2], undefined);
  });

  test("question conditionnelle visible : exigée", () => {
    assert.match(erreur({ 1: "Portable", 4: "2026-10-15" }), /Sacoche/);
  });

  test("choix hors liste : refusé", () => {
    assert.match(erreur({ 1: "Tablette", 4: "2026-10-15" }), /choix invalide/);
    assert.match(erreur({ 1: "Fixe", 4: "2026-10-15", 5: ["Office", "Jeux"] }), /choix invalide/);
  });

  test("nombre et date invalides : refusés", () => {
    assert.match(erreur({ 1: "Fixe", 3: "deux", 4: "2026-10-15" }), /nombre/);
    assert.match(erreur({ 1: "Fixe", 4: "15/10/2026" }), /date/);
  });

  test("toutes les erreurs sont listées ensemble", () => {
    const msg = erreur({});
    assert.match(msg, /Type de poste/);
    assert.match(msg, /Date d'arrivée/);
  });
});

describe("échange avec EV", () => {
  test("valeurs envoyées à EV", () => {
    assert.equal(Q.versValeurEV(["Office", "DPI"]), "Office|DPI");
    assert.equal(Q.versValeurEV(true), "1");
    assert.equal(Q.versValeurEV(false), "0");
    assert.equal(Q.versValeurEV(2), "2");
  });

  test("réponses EV relues de façon lisible", () => {
    const lignes = Q.reponsesLisibles(formulaire, [
      { QUESTION_ID: 2, VALUE: "1" },
      { QUESTION_ID: 4, VALUE: "2026-10-15" },
      { QUESTION_ID: 5, VALUE: "Office|DPI" },
    ]);
    assert.deepEqual(lignes.map((l) => l.valeur), ["Oui", "15/10/2026", "Office, DPI"]);
  });
});
