// Le front recopie la matrice de priorite du serveur (affichage dans le formulaire
// de creation) : les deux doivent rester identiques.
// web/src/outils.js est un module du navigateur (import de vue) : on lit la
// ligne de la constante plutot que d'importer le fichier.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cfg = require("../sources/portail/correspondance");

test("matrice de priorité identique côté front et côté serveur", () => {
  const front = fs.readFileSync(path.join(__dirname, "../web/src/outils.js"), "utf8");
  const m = front.match(/export const MATRICE_PRIORITE = (\{.*\});/);
  assert.ok(m, "MATRICE_PRIORITE introuvable dans web/src/outils.js");
  assert.deepEqual(new Function(`return ${m[1]}`)(), cfg.matricePriorite);
});
