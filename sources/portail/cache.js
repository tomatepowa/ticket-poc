// cache.js — copie locale (SQLite) des tickets EasyVista.
//
// Cache JETABLE : EasyVista reste la seule reference. On y stocke les tickets
// et leurs actions tels que renvoyes par l'API (JSON brut), pour que les listes,
// filtres et stats du portail ne sollicitent pas EV a chaque affichage.
// Supprimer le fichier data/cache-portail.db est sans risque : la synchro le reconstruit.
//
// Donnees potentiellement sensibles (descriptions de tickets) : le fichier est
// soumis aux memes regles que le serveur (acces, sauvegardes, chiffrement),
// et les tickets clos anciens sont purges (voir purger()).

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "cache-portail.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    rfc TEXT PRIMARY KEY,
    last_update TEXT,
    submit_date TEXT,
    ferme INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    synchro TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS actions (
    action_id TEXT PRIMARY KEY,
    rfc TEXT NOT NULL,
    en_cours INTEGER NOT NULL,
    group_id INTEGER,
    done_by_id INTEGER,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_actions_rfc ON actions(rfc);
  CREATE INDEX IF NOT EXISTS idx_actions_groupe ON actions(group_id);
  CREATE INDEX IF NOT EXISTS idx_actions_auteur ON actions(done_by_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_maj ON tickets(last_update);
  CREATE TABLE IF NOT EXISTS etat (cle TEXT PRIMARY KEY, valeur TEXT);
`);

// Requetes preparees une seule fois (reutilisees a chaque appel).
const q = {
  upsertTicket: db.prepare(`
    INSERT INTO tickets (rfc, last_update, submit_date, ferme, data, synchro)
    VALUES (@rfc, @last_update, @submit_date, @ferme, @data, @synchro)
    ON CONFLICT(rfc) DO UPDATE SET last_update = excluded.last_update, submit_date = excluded.submit_date,
      ferme = excluded.ferme, data = excluded.data, synchro = excluded.synchro
  `),
  supprimerActions: db.prepare("DELETE FROM actions WHERE rfc = ?"),
  insererAction: db.prepare(
    "INSERT OR REPLACE INTO actions (action_id, rfc, en_cours, group_id, done_by_id, data) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  supprimerTicket: db.prepare("DELETE FROM tickets WHERE rfc = ?"),
  ticket: db.prepare("SELECT * FROM tickets WHERE rfc = ?"),
  actionsDe: db.prepare("SELECT data FROM actions WHERE rfc = ? ORDER BY CAST(action_id AS INTEGER), action_id"),
  versions: db.prepare("SELECT rfc, last_update FROM tickets"),
  enCours: db.prepare("SELECT rfc, action_id FROM actions WHERE en_cours = 1"),
  compter: db.prepare("SELECT COUNT(*) n FROM tickets"),
  lireEtat: db.prepare("SELECT valeur FROM etat WHERE cle = ?"),
  ecrireEtat: db.prepare("INSERT INTO etat (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur"),
  purger: db.prepare("DELETE FROM tickets WHERE ferme = 1 AND last_update < ?"),
  purgerActions: db.prepare("DELETE FROM actions WHERE rfc NOT IN (SELECT rfc FROM tickets)"),
};

const idGroupe = (a) => Number(a.GROUP?.GROUP_ID ?? a.GROUP_ID) || null;
const idAuteur = (a) => Number(a.DONE_BY_ID ?? a.DONE_BY?.EMPLOYEE_ID) || null;

// Enregistre (ou remplace) un ticket et TOUTES ses actions. `ferme` est calcule
// par l'appelant (statut portail CLOTURE) pour limiter les listes aux tickets utiles.
const enregistrer = db.transaction((req, actions, ferme, date = new Date()) => {
  q.upsertTicket.run({
    rfc: req.RFC_NUMBER,
    last_update: req.LAST_UPDATE || req.SUBMIT_DATE_UT || null,
    submit_date: req.SUBMIT_DATE_UT || null,
    ferme: ferme ? 1 : 0,
    data: JSON.stringify(req),
    synchro: date.toISOString(),
  });
  q.supprimerActions.run(req.RFC_NUMBER);
  for (const a of actions) {
    q.insererAction.run(String(a.ACTION_ID), req.RFC_NUMBER, a.END_DATE_UT ? 0 : 1, idGroupe(a), idAuteur(a), JSON.stringify(a));
  }
});

const supprimer = db.transaction((rfc) => {
  q.supprimerTicket.run(rfc);
  q.supprimerActions.run(rfc);
});

function lire(rfc) {
  const t = q.ticket.get(rfc);
  if (!t) return null;
  return { req: JSON.parse(t.data), actions: q.actionsDe.all(rfc).map((a) => JSON.parse(a.data)), synchro: t.synchro };
}

// Tickets candidats pour une liste : tous (superviseur) ou ceux ayant touche mes
// groupes / m'ayant ete affectes. Tickets ouverts + clos recemment (depuisClos).
function candidats({ tous = false, groupes = [], personne = null, depuisClos, limite = 2000 }) {
  const conditions = ["(t.ferme = 0 OR t.last_update >= @depuisClos)"];
  const params = { depuisClos, limite };
  if (!tous) {
    const idsGroupes = groupes.map(Number).filter(Number.isFinite);
    const liens = [];
    if (idsGroupes.length) liens.push(`a.group_id IN (${idsGroupes.join(",")})`);
    if (personne) {
      liens.push("a.done_by_id = @personne");
      params.personne = Number(personne);
    }
    if (!liens.length) return [];
    conditions.push(`t.rfc IN (SELECT a.rfc FROM actions a WHERE ${liens.join(" OR ")})`);
  }
  const lignes = db
    .prepare(`SELECT t.rfc, t.data, t.synchro FROM tickets t WHERE ${conditions.join(" AND ")} ORDER BY t.submit_date DESC LIMIT @limite`)
    .all(params);
  return lignes.map((t) => ({ req: JSON.parse(t.data), actions: q.actionsDe.all(t.rfc).map((a) => JSON.parse(a.data)), synchro: t.synchro }));
}

// { rfc: last_update } pour comparer avec EV.
const versions = () => new Map(q.versions.all().map((r) => [r.rfc, r.last_update]));

// Actions en cours connues du cache, par ticket : { rfc: Set(action_id) }.
function actionsEnCours() {
  const parRfc = new Map();
  for (const { rfc, action_id } of q.enCours.all()) {
    if (!parRfc.has(rfc)) parRfc.set(rfc, new Set());
    parRfc.get(rfc).add(String(action_id));
  }
  return parRfc;
}

const lireEtat = (cle) => q.lireEtat.get(cle)?.valeur ?? null;
const ecrireEtat = (cle, valeur) => q.ecrireEtat.run(cle, valeur == null ? null : String(valeur));
const compter = () => q.compter.get().n;

// Minimisation des donnees : on ne garde pas les tickets clos au-dela de la retention.
const purger = db.transaction((avant) => {
  const n = q.purger.run(avant).changes;
  q.purgerActions.run();
  return n;
});

function vider() {
  db.exec("DELETE FROM actions; DELETE FROM tickets; DELETE FROM etat;");
}

module.exports = {
  enregistrer,
  supprimer,
  lire,
  candidats,
  versions,
  actionsEnCours,
  lireEtat,
  ecrireEtat,
  compter,
  purger,
  vider,
  fermer: () => db.close(),
};
