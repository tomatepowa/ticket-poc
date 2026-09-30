// base.js — connexion PostgreSQL du portail et migrations du schema.
//
// DATABASE_URL : postgres://utilisateur:motdepasse@serveur:5432/base
// Les fichiers sql/NNN_*.sql sont appliques une seule fois, dans l'ordre, au
// demarrage (table portail.migrations). Ajouter une evolution = ajouter un
// fichier numerote, jamais modifier un fichier deja applique.

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DOSSIER_SQL = path.join(__dirname, "sql");

function lireUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL manquante (ex. postgres://portail:motdepasse@localhost:5432/portail) : voir installation/windows/INSTALLATION.md"
    );
  }
  return url;
}

const pool = new Pool({ connectionString: lireUrl(), max: 10 });
pool.on("error", (err) => console.error("PostgreSQL : connexion perdue", err.message));

async function migrer() {
  const client = await pool.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS portail");
    await client.query(
      "CREATE TABLE IF NOT EXISTS portail.migrations (fichier text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())"
    );
    const deja = new Set((await client.query("SELECT fichier FROM portail.migrations")).rows.map((r) => r.fichier));
    const fichiers = fs.readdirSync(DOSSIER_SQL).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    for (const f of fichiers) {
      if (deja.has(f)) continue;
      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(DOSSIER_SQL, f), "utf8"));
        await client.query("INSERT INTO portail.migrations (fichier) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log(`Base : migration ${f} appliquee`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${f} en echec : ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

// Execute fn(client) dans une transaction.
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, migrer, transaction, requete: (sql, params) => pool.query(sql, params), fermer: () => pool.end() };
