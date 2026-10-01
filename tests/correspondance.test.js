// Garde-fous sur correspondance.js : le fichier a adapter a la vraie instance EV.
// Une faute de frappe ou un oubli en l'adaptant fait echouer ces tests, avec
// un message qui dit quoi corriger, au lieu d'un portail qui affiche mal.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const cfg = require("../sources/portail/correspondance");

const STATUTS_PORTAIL = ["OUVERT", "EN_COURS", "EN_ATTENTE", "RESOLU", "CLOTURE"];
const NATURES = ["TRAITEMENT", "VALIDATION", "CONFIRMATION"];
const TYPES_TICKET = ["INCIDENT", "DEMANDE"];
const cles = (o) => Object.keys(o);

test("statuts : chaque statut EV correspond à un statut du portail", () => {
  assert.ok(cles(cfg.statuts).length, "statuts vide");
  for (const [ev, portail] of Object.entries(cfg.statuts)) {
    assert.ok(STATUTS_PORTAIL.includes(portail), `statuts["${ev}"] = "${portail}" : attendu ${STATUTS_PORTAIL.join(", ")}`);
  }
  for (const s of ["EN_COURS", "RESOLU", "CLOTURE"]) {
    assert.ok(Object.values(cfg.statuts).includes(s), `aucun statut EV ne correspond à ${s}`);
  }
});

test("statuts particuliers : déclarés dans statuts, avec le bon statut portail", () => {
  assert.equal(cfg.statuts[cfg.statutSuspendu], "EN_ATTENTE", `statutSuspendu "${cfg.statutSuspendu}" doit valoir EN_ATTENTE dans statuts`);
  assert.equal(cfg.statuts[cfg.statutAnnulation], "CLOTURE", `statutAnnulation "${cfg.statutAnnulation}" doit valoir CLOTURE dans statuts`);
  for (const s of cfg.statutsSortie) {
    assert.equal(cfg.statuts[s], "CLOTURE", `statutsSortie : "${s}" doit valoir CLOTURE dans statuts`);
  }
});

test("types d'action : nature connue et libellés complets", () => {
  const types = Object.entries(cfg.typesAction);
  assert.ok(types.some(([, t]) => t.nature === "TRAITEMENT"), "au moins une étape de TRAITEMENT est nécessaire");
  for (const [nom, t] of types) {
    assert.ok(NATURES.includes(t.nature), `typesAction["${nom}"].nature = "${t.nature}" : attendu ${NATURES.join(", ")}`);
    const champs = t.nature === "TRAITEMENT" ? ["code", "etape", "codeNonAffecte", "etapeNonAffectee", "terminer"] : ["code", "etape"];
    for (const c of champs) assert.ok(t[c], `typesAction["${nom}"].${c} manquant`);
  }
});

test("types d'action : une étape de workflow n'est pas aussi déclarée hors workflow", () => {
  for (const nom of cfg.typesActionHorsWorkflow) {
    assert.ok(!(nom in cfg.typesAction), `"${nom}" est à la fois dans typesAction et typesActionHorsWorkflow`);
  }
  assert.ok(cfg.typesActionHorsWorkflow.includes(cfg.typeCommentaire), "typeCommentaire doit figurer dans typesActionHorsWorkflow");
});

test("parcours : chaque étape de la barre de progression existe", () => {
  const codes = new Set(["CLOTURE"]);
  for (const t of Object.values(cfg.typesAction)) [t.code, t.codeNonAffecte].filter(Boolean).forEach((c) => codes.add(c));
  for (const [type, etapes] of Object.entries(cfg.parcours)) {
    assert.ok(TYPES_TICKET.includes(type), `parcours.${type} : type inconnu`);
    for (const [code, label] of etapes) {
      assert.ok(codes.has(code), `parcours.${type} : étape "${code}" (${label}) ne correspond à aucun code de typesAction`);
    }
  }
});

test("types de ticket : préfixes de numéro et chemins de catalogue", () => {
  for (const v of [...Object.values(cfg.typeDepuisNumero), ...Object.values(cfg.typeDepuisCheminCatalogue)]) {
    assert.ok(TYPES_TICKET.includes(v), `type "${v}" : attendu INCIDENT ou DEMANDE`);
  }
  for (const t of TYPES_TICKET) {
    assert.ok(Object.values(cfg.typeDepuisNumero).includes(t), `aucun préfixe de numéro pour ${t}`);
  }
});

test("urgence, impact et matrice de priorité : toutes les combinaisons du formulaire sont couvertes", () => {
  assert.deepEqual(cles(cfg.urgenceEV).sort(), ["1", "2"], "urgenceEV : niveaux 1 et 2 du formulaire");
  assert.deepEqual(cles(cfg.impactEV).sort(), ["1", "2", "3"], "impactEV : niveaux 1, 2 et 3 du formulaire");
  for (const impact of cles(cfg.impactEV)) {
    for (const urgence of cles(cfg.urgenceEV)) {
      const p = cfg.matricePriorite[impact]?.[urgence];
      assert.ok([1, 2, 3, 4].includes(p), `matricePriorite[${impact}][${urgence}] = ${p} : attendu 1 à 4`);
    }
  }
});

test("groupes de profil : au moins un groupe superviseur et un groupe valideur", () => {
  assert.ok(cfg.groupesSuperviseurs.length, "groupesSuperviseurs vide : personne ne serait superviseur");
  assert.ok(cfg.groupesValideurs.length, "groupesValideurs vide : personne ne pourrait valider");
});

test("champs de fin (éléments désactivés dans EV) renseignés", () => {
  for (const c of ["etablissement", "catalogue", "employe"]) assert.ok(cfg.champsFin[c], `champsFin.${c} manquant`);
});
