// base-test.js — base PostgreSQL des tests.
//
// TEST_DATABASE_URL : base DEDIEE aux tests (son nom doit contenir "test", car
// les tests la vident). Sur un poste de dev, elle peut etre dans .env ; la base
// est creee si elle n'existe pas. Sans TEST_DATABASE_URL ou si PostgreSQL ne
// repond pas, les tests PostgreSQL sont sautes (avec la raison), SAUF en CI
// (variable CI, posee par GitHub Actions) ou ils echouent.

const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const fichierEnv = path.join(__dirname, "..", ".env");
if (!process.env.TEST_DATABASE_URL && fs.existsSync(fichierEnv)) process.loadEnvFile(fichierEnv);

let raison = null; // pourquoi les tests PostgreSQL sont sautes

async function creerBaseSiAbsente(url, nom) {
  const essai = new Client({ connectionString: url });
  try {
    await essai.connect();
    return;
  } catch (err) {
    if (err.code !== "3D000") throw err; // 3D000 : la base n'existe pas
  } finally {
    await essai.end().catch(() => {});
  }
  const adresse = new URL(url);
  adresse.pathname = "/postgres";
  const admin = new Client({ connectionString: adresse.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${nom.replace(/"/g, '""')}"`).catch((err) => {
      // Creee entre-temps par une autre execution : rien a faire.
      if (!/already exists|duplicate key/.test(err.message)) throw err;
    });
  } finally {
    await admin.end();
  }
}

// A appeler dans before() : prepare une base vide et y fait pointer DATABASE_URL.
// Renvoie true si les tests PostgreSQL peuvent tourner.
async function preparer() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    raison = "TEST_DATABASE_URL absente : tests PostgreSQL ignorés (voir README, section Tests)";
  } else {
    const nom = decodeURIComponent(new URL(url).pathname.slice(1));
    if (!/test/i.test(nom)) {
      throw new Error(`TEST_DATABASE_URL : la base "${nom}" doit contenir "test" dans son nom (les tests la vident).`);
    }
    try {
      await creerBaseSiAbsente(url, nom);
    } catch (err) {
      raison =
        err.code === "42501" // droit refuse : l'utilisateur ne peut pas creer de base
          ? `Base « ${nom} » absente et non créable par cet utilisateur : la créer une fois en administrateur (CREATE DATABASE ${nom} OWNER <utilisateur>). Tests PostgreSQL ignorés`
          : `PostgreSQL injoignable (${err.message || err.code}) : tests PostgreSQL ignorés. Démarrer la base (npm run dev la démarre)`;
    }
  }
  if (raison && process.env.CI) throw new Error(raison);
  if (raison) return false;

  // Schema neuf : les migrations repartent de zero a chaque execution.
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS bi CASCADE; DROP SCHEMA IF EXISTS portail CASCADE");
  await c.end();
  process.env.DATABASE_URL = url;
  return true;
}

// Comme test(), mais saute si PostgreSQL n'est pas disponible.
const testPg = (nom, fn) =>
  test(nom, async (t) => {
    if (raison) return t.skip(raison);
    await fn(t);
  });

module.exports = { preparer, testPg };
