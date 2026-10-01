// Tests PostgreSQL : migrations, copie locale des tickets (cache.js), sessions
// et vues du pole BI. Les tickets entrent dans la base par le meme chemin qu'en
// vrai : lus dans un faux EV puis enregistres par la synchro (relireTicket).

const { before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const F = require("./fabrique");
const { creerFauxEV } = require("./faux-ev");
const { preparer, testPg } = require("./base-test");

const { STATUT, TYPE } = F;
let base, cache, creerSynchro;

before(async () => {
  if (!(await preparer())) return;
  // Requis apres preparer() : base.js lit DATABASE_URL a son chargement.
  base = require("../sources/portail/base");
  cache = require("../sources/portail/cache");
  ({ creerSynchro } = require("../sources/portail/synchro"));
  await cache.initialiser();
});
beforeEach(async () => {
  if (cache) await base.requete("TRUNCATE portail.actions, portail.tickets, portail.etat, portail.sessions");
});
after(async () => {
  if (base) await base.fermer();
});

const empMarc = F.employe(1, "Dubois, Marc");
const ev = creerFauxEV({ groupes: [F.GROUPE_SD, F.GROUPE_INFRA] });

// Met un ticket dans le faux EV puis dans la base, comme la synchro.
async function charger(req, actions = []) {
  ev.ajouter(req, actions);
  await creerSynchro(ev, cache).relireTicket(req.RFC_NUMBER);
}
const ligne = async (sql, params) => (await base.requete(sql, params)).rows[0];
const nombre = async (sql, params) => Number((await ligne(sql, params)).n);

// ---------- Migrations ----------

testPg("migrations : tous les fichiers sql/ appliqués, une seule fois", async () => {
  const fichiers = fs.readdirSync(path.join(__dirname, "../sources/portail/sql")).filter((f) => /^\d+_.*\.sql$/.test(f));
  assert.equal(await nombre("SELECT count(*) AS n FROM portail.migrations"), fichiers.length);
  await base.migrer(); // second demarrage : rien a refaire
  assert.equal(await nombre("SELECT count(*) AS n FROM portail.migrations"), fichiers.length);
});

testPg("migrations : tables du portail et vues BI présentes", async () => {
  const { rows } = await base.requete(
    "SELECT table_schema || '.' || table_name AS nom FROM information_schema.tables WHERE table_schema IN ('portail', 'bi')"
  );
  const noms = rows.map((r) => r.nom);
  for (const t of ["portail.tickets", "portail.actions", "portail.etat", "portail.sessions", "bi.tickets", "bi.actions", "bi.charge_groupes", "bi.synchro"]) {
    assert.ok(noms.includes(t), `${t} manquante`);
  }
});

// ---------- Tickets ----------

testPg("un ticket enregistré se relit à l'identique (ticket EV + actions dans l'ordre)", async () => {
  const req = F.ticket(F.incident(1), STATUT.enCours, { DESCRIPTION: "Écran noir — « urgent »" });
  const actions = [F.action(TYPE.traitement, { faitPar: empMarc, fin: F.ilYa(2) }), F.action(TYPE.traitement)];
  await charger(req, actions);
  const lu = await cache.lire(req.RFC_NUMBER);
  assert.equal(lu.req.DESCRIPTION, "Écran noir — « urgent »");
  assert.deepEqual(lu.actions.map((a) => a.ACTION_ID), actions.map((a) => a.ACTION_ID));
  assert.equal(await cache.lire("INCONNU"), null);
});

testPg("colonnes à plat calculées par le portail (statut, étape, groupe, intervenant)", async () => {
  await charger(F.ticket(F.incident(1), STATUT.enCours), [F.action(TYPE.traitement, { faitPar: empMarc })]);
  const t = await ligne("SELECT * FROM portail.tickets");
  assert.equal(t.statut, "EN_COURS");
  assert.equal(t.etape, F.TRAITEMENT.etape);
  assert.equal(t.groupe_id, F.GROUPE_SD.GROUP_ID);
  assert.equal(t.intervenant, "Marc Dubois");
  assert.equal(t.type, "INCIDENT");
  assert.equal(t.ferme, false);
});

testPg("ticket ré-enregistré : ses actions sont remplacées, pas ajoutées", async () => {
  const req = F.ticket(F.incident(1), STATUT.enCours);
  await charger(req, [F.action(TYPE.traitement), F.action(TYPE.commentaire, { fin: F.ilYa(1) })]);
  await charger(req, [F.action(TYPE.traitement)]);
  assert.equal(await nombre("SELECT count(*) AS n FROM portail.actions"), 1);
});

testPg("ticket supprimé : ses actions partent avec lui", async () => {
  await charger(F.ticket(F.incident(1), STATUT.enCours), [F.action(TYPE.traitement)]);
  await cache.supprimer(F.incident(1));
  assert.equal(await cache.compter(), 0);
  assert.equal(await nombre("SELECT count(*) AS n FROM portail.actions"), 0);
});

testPg("candidats d'une liste : par groupe, par personne affectée, ou tous", async () => {
  await charger(F.ticket(F.incident(1), STATUT.enCours), [F.action(TYPE.traitement, { groupe: F.GROUPE_SD })]);
  await charger(F.ticket(F.incident(2), STATUT.enCours), [F.action(TYPE.traitement, { groupe: F.GROUPE_INFRA })]);
  await charger(F.ticket(F.incident(3), STATUT.enCours), [F.action(TYPE.traitement, { groupe: F.GROUPE_INFRA, faitPar: empMarc })]);
  const depuisClos = F.ilYa(30);
  const numeros = async (opts) => (await cache.candidats({ depuisClos, ...opts })).map((c) => c.req.RFC_NUMBER).sort();

  assert.deepEqual(await numeros({ groupes: [F.GROUPE_SD.GROUP_ID] }), [F.incident(1)]);
  assert.deepEqual(await numeros({ groupes: [], personne: 1 }), [F.incident(3)]);
  assert.deepEqual(await numeros({ groupes: [F.GROUPE_SD.GROUP_ID], personne: 1 }), [F.incident(1), F.incident(3)]);
  assert.deepEqual(await numeros({ tous: true }), [F.incident(1), F.incident(2), F.incident(3)]);
});

testPg("candidats : les tickets clos anciens ne sont plus proposés, les ouverts toujours", async () => {
  const clos = STATUT.cloture || STATUT.refuse;
  await charger(F.ticket(F.incident(1), clos, { LAST_UPDATE: F.ilYa(40) }), [F.action(TYPE.traitement, { fin: F.ilYa(40) })]);
  await charger(F.ticket(F.incident(2), clos, { LAST_UPDATE: F.ilYa(5) }), [F.action(TYPE.traitement, { fin: F.ilYa(5) })]);
  await charger(F.ticket(F.incident(3), STATUT.enCours, { SUBMIT_DATE_UT: F.ilYa(200), LAST_UPDATE: F.ilYa(200) }), [F.action(TYPE.traitement)]);
  const numeros = (await cache.candidats({ tous: true, depuisClos: F.ilYa(30) })).map((c) => c.req.RFC_NUMBER).sort();
  assert.deepEqual(numeros, [F.incident(2), F.incident(3)]);
});

testPg("versions et actions en cours, pour comparer avec EV", async () => {
  const req = F.ticket(F.incident(1), STATUT.enCours);
  const enCours = F.action(TYPE.traitement);
  await charger(req, [F.action(TYPE.commentaire, { fin: F.ilYa(1) }), enCours]);
  assert.equal((await cache.versions()).get(req.RFC_NUMBER), req.LAST_UPDATE);
  assert.deepEqual([...(await cache.actionsEnCours()).get(req.RFC_NUMBER)], [String(enCours.ACTION_ID)]);
});

testPg("purge : tickets clos avant la date supprimés, tickets ouverts conservés même anciens", async () => {
  const clos = STATUT.cloture || STATUT.refuse;
  await charger(F.ticket(F.incident(1), clos, { LAST_UPDATE: F.ilYa(400) }));
  await charger(F.ticket(F.incident(2), STATUT.enCours, { LAST_UPDATE: F.ilYa(400) }), [F.action(TYPE.traitement)]);
  assert.equal(await cache.purger(F.ilYa(365)), 1);
  assert.deepEqual([...(await cache.versions()).keys()], [F.incident(2)]);
});

testPg("état de la synchro : écrire, remplacer, effacer", async () => {
  assert.equal(await cache.lireEtat("erreur"), null);
  await cache.ecrireEtat("erreur", "EV injoignable");
  await cache.ecrireEtat("erreur", "EV toujours injoignable");
  assert.equal(await cache.lireEtat("erreur"), "EV toujours injoignable");
  await cache.ecrireEtat("erreur", null);
  assert.equal(await cache.lireEtat("erreur"), null);
});

// ---------- Sessions ----------

testPg("sessions : ouverte, lue, expirée, fermée", async () => {
  const dans = (ms) => new Date(Date.now() + ms);
  await cache.sessions.creer("jeton-valide", 1, dans(3600e3));
  await cache.sessions.creer("jeton-expire", 2, dans(-1000));
  assert.deepEqual(await cache.sessions.lire("jeton-valide"), { utilisateurId: 1 });
  assert.equal(await cache.sessions.lire("jeton-expire"), null, "une session expirée ne connecte plus");
  assert.equal(await cache.sessions.lire("jeton-inconnu"), null);

  await cache.sessions.purger();
  assert.equal(await nombre("SELECT count(*) AS n FROM portail.sessions"), 1);
  await cache.sessions.supprimer("jeton-valide");
  assert.equal(await cache.sessions.lire("jeton-valide"), null);
});

// ---------- Vues du pole BI ----------

testPg("bi.tickets : retard, durée de traitement, description", async () => {
  await charger(F.ticket(F.incident(1), STATUT.enCours, { MAX_RESOLUTION_DATE_UT: F.ilYa(1), DESCRIPTION: "Imprimante" }), [
    F.action(TYPE.traitement),
  ]);
  await charger(F.ticket(F.incident(2), STATUT.resolu, { SUBMIT_DATE_UT: F.ilYa(2), LAST_UPDATE: F.ilYa(1), DESCRIPTION: "" }), [
    F.action(TYPE.traitement, { fin: F.ilYa(1) }),
  ]);
  const retard = await ligne("SELECT * FROM bi.tickets WHERE numero = $1", [F.incident(1)]);
  assert.equal(retard.en_retard, true);
  assert.equal(retard.clos, false);
  assert.equal(retard.duree_heures, null);
  assert.equal(retard.description, "Imprimante");

  const resolu = await ligne("SELECT * FROM bi.tickets WHERE numero = $1", [F.incident(2)]);
  assert.equal(Number(resolu.duree_heures), 24);
  assert.equal(resolu.description, null, "description vide : NULL");
});

testPg("bi.actions : décision, durée et commentaire", async () => {
  const debut = F.ilYa(2);
  const fin = new Date(new Date(debut).getTime() + 90 * 60e3).toISOString();
  await charger(F.ticket(F.demande(1), STATUT.enCours), [
    { ...F.action(TYPE.validation || TYPE.traitement, { debut, fin, choix: "0" }), COMMENT: "Pas de budget" },
  ]);
  const a = await ligne("SELECT * FROM bi.actions");
  assert.equal(a.decision, "refuse");
  assert.equal(Number(a.duree_minutes), 90);
  assert.equal(a.commentaire, "Pas de budget");
});

testPg("bi.charge_groupes : tickets non clos par groupe et statut", async () => {
  await charger(F.ticket(F.incident(1), STATUT.enCours), [F.action(TYPE.traitement)]);
  await charger(F.ticket(F.incident(2), STATUT.enCours), [F.action(TYPE.traitement)]);
  await charger(F.ticket(F.incident(3), STATUT.enCours), [F.action(TYPE.traitement, { faitPar: empMarc })]);
  const { rows } = await base.requete("SELECT groupe, statut, nb_tickets FROM bi.charge_groupes ORDER BY statut");
  assert.deepEqual(
    rows.map((r) => [r.groupe, r.statut, Number(r.nb_tickets)]),
    [
      [F.GROUPE_SD.GROUP_FR, "EN_COURS", 1],
      [F.GROUPE_SD.GROUP_FR, "OUVERT", 2],
    ]
  );
});

testPg("bi.synchro : date de la dernière synchro et nombre de tickets", async () => {
  await charger(F.ticket(F.incident(1), STATUT.enCours), [F.action(TYPE.traitement)]);
  const quand = new Date().toISOString();
  await cache.ecrireEtat("derniere_synchro", quand);
  const s = await ligne("SELECT * FROM bi.synchro");
  assert.equal(s.derniere_synchro.toISOString(), quand);
  assert.equal(Number(s.nb_tickets), 1);
  assert.equal(s.erreur_en_cours, null);
});
