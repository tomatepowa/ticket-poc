// Tests PostgreSQL de bout en bout : synchro EV -> base, puis source du portail
// (listes, filtres, stats, detail, actions) sur un faux EV en memoire.

const { before, beforeEach, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const F = require("./fabrique");
const { creerFauxEV } = require("./faux-ev");
const { preparer, testPg } = require("./base-test");

const { STATUT, TYPE } = F;
let base, cache, creerSynchro, creerSource, ErreurSource;

before(async () => {
  if (!(await preparer())) return;
  base = require("../sources/portail/base");
  cache = require("../sources/portail/cache");
  ({ creerSynchro } = require("../sources/portail/synchro"));
  ({ creerSource } = require("../sources/portail/source"));
  ({ ErreurSource } = require("../sources/erreurs"));
  await cache.initialiser();
});
beforeEach(async () => {
  if (cache) await cache.vider();
});
after(async () => {
  if (base) await base.fermer();
});

// Le controle de correspondance ecrit dans la console quand il trouve une anomalie :
// on le fait taire dans les tests qui en provoquent volontairement.
async function silencieux(fn) {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { warn, error });
  }
}

// ---------- Le "monde" de test : equipes, tickets, faux EV ----------

const EMP = {
  marc: F.employe(1, "Dubois, Marc"),
  karim: F.employe(2, "Benali, Karim"),
  julie: F.employe(3, "Lefèvre, Julie"),
  isabelle: F.employe(4, "Garnier, Isabelle"),
};
const N = { libre: F.incident(1), karim: F.incident(2), infra: F.incident(3), resolu: F.incident(4), closAncien: F.incident(5) };

// Faux EV avec ses equipes et 5 tickets, synchronise dans la base.
async function monde() {
  const ev = creerFauxEV({ groupes: [F.GROUPE_SD, F.GROUPE_INFRA, F.GROUPE_SUPERVISION, F.GROUPE_VALIDEURS] });
  ev.ajouterEmploye(EMP.marc, [F.GROUPE_SD]);
  ev.ajouterEmploye(EMP.karim, [F.GROUPE_SD]);
  ev.ajouterEmploye(EMP.julie, [F.GROUPE_INFRA]);
  ev.ajouterEmploye(EMP.isabelle, [F.GROUPE_SUPERVISION]);

  ev.ajouter(F.ticket(N.libre, STATUT.enCours), [F.action(TYPE.traitement)]);
  ev.ajouter(F.ticket(N.karim, STATUT.enCours), [F.action(TYPE.traitement, { faitPar: EMP.karim })]);
  ev.ajouter(F.ticket(N.infra, STATUT.enCours), [F.action(TYPE.traitement, { groupe: F.GROUPE_INFRA })]);
  ev.ajouter(F.ticket(N.resolu, STATUT.resolu), [F.action(TYPE.traitement, { faitPar: EMP.marc, fin: F.ilYa(1) })]);
  ev.ajouter(F.ticket(N.closAncien, STATUT.cloture || STATUT.refuse, { LAST_UPDATE: F.ilYa(40) }), [
    F.action(TYPE.traitement, { faitPar: EMP.marc, fin: F.ilYa(40), debut: F.ilYa(41) }),
  ]);

  const synchro = creerSynchro(ev, cache);
  await synchro.executer();
  const source = creerSource(ev);
  const u = {};
  for (const [nom, e] of Object.entries(EMP)) u[nom] = await source.getUtilisateur(e.EMPLOYEE_ID);
  return { ev, synchro, source, u };
}

const numeros = (tickets) => tickets.map((t) => t.numero).sort();
async function erreurDe(promesse) {
  try {
    await promesse;
  } catch (err) {
    return err;
  }
  assert.fail("une erreur était attendue");
}

// ---------- Synchronisation ----------

describe("synchronisation EV -> base", () => {
  testPg("première synchro (complète) : tout EV est copié, état à jour", async () => {
    const { synchro } = await monde();
    const etat = await synchro.etat();
    assert.equal(etat.nb_tickets, 5);
    assert.ok(etat.derniere_synchro);
    assert.equal(etat.derniere_complete, etat.derniere_synchro);
    assert.equal(etat.erreur, null);
    assert.deepEqual(etat.anomalies, []);
  });

  testPg("synchro suivante (incrémentale) : un ticket modifié dans EV est relu", async () => {
    const { ev, synchro } = await monde();
    const complete = (await synchro.etat()).derniere_complete;
    ev.modifier(N.libre, { TITLE: "Titre changé dans EV" });
    await synchro.executer();
    assert.equal((await cache.lire(N.libre)).req.TITLE, "Titre changé dans EV");
    assert.equal((await synchro.etat()).derniere_complete, complete, "pas de synchro complète");
  });

  testPg("incrémentale : une étape terminée sans que le ticket change est détectée", async () => {
    const { ev, synchro } = await monde();
    const [etape] = ev.actionsDe(N.libre);
    ev.action(etape.ACTION_ID).END_DATE_UT = new Date().toISOString(); // sans toucher LAST_UPDATE
    await synchro.executer();
    assert.ok(!(await cache.actionsEnCours()).has(N.libre));
  });

  testPg("synchro complète : un ticket supprimé dans EV disparaît de la base", async () => {
    const { ev, synchro } = await monde();
    ev.supprimer(N.infra);
    await synchro.executer({ complete: true });
    assert.equal(await cache.lire(N.infra), null);
    assert.equal(await cache.compter(), 4);
  });

  testPg("rétention : les tickets clos trop anciens sont purgés", async () => {
    const { ev } = await monde();
    await creerSynchro(ev, cache, { retentionJours: 30 }).executer({ complete: true });
    assert.equal(await cache.lire(N.closAncien), null);
    assert.ok(await cache.lire(N.resolu));
  });

  testPg("EV injoignable : erreur signalée, copie conservée, puis effacée au retour d'EV", async () => {
    const { ev, synchro } = await monde();
    ev.panne("EV en maintenance");
    await silencieux(() => synchro.executer());
    let etat = await synchro.etat();
    assert.equal(etat.erreur, "EV en maintenance");
    assert.ok(etat.erreur_depuis);
    assert.equal(etat.nb_tickets, 5, "la copie locale reste utilisable");

    ev.reparer();
    await synchro.executer();
    etat = await synchro.etat();
    assert.equal(etat.erreur, null);
    assert.equal(etat.erreur_depuis, null);
  });

  testPg("paramétrage EV inconnu : remonté dans l'état de la synchro", async () => {
    const { ev, synchro } = await monde();
    ev.modifier(N.libre, { STATUS: { STATUS_FR: "__statut_inconnu__" } });
    await silencieux(() => synchro.executer());
    const anomalies = (await synchro.etat()).anomalies;
    assert.deepEqual(anomalies.map((a) => [a.type, a.valeur]), [["statut", "__statut_inconnu__"]]);
  });
});

// ---------- Listes, filtres et stats ----------

describe("listes du portail (lues dans la base)", () => {
  testPg("intervenant : la file de ses groupes seulement", async () => {
    const { source, u } = await monde();
    const file = await source.listerTickets(u.marc, { vue: "groupes" });
    assert.deepEqual(numeros(file), [N.libre, N.karim].sort());
  });

  testPg("superviseur : tous les tickets, sauf les clos de plus de 30 jours", async () => {
    const { source, u } = await monde();
    const tout = await source.listerTickets(u.isabelle, { vue: "tout" });
    assert.deepEqual(numeros(tout), [N.libre, N.karim, N.infra, N.resolu].sort());
  });

  testPg("vues « non affectés » et « affectés à moi »", async () => {
    const { source, u } = await monde();
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "non_affectes" })), [N.libre]);
    assert.deepEqual(numeros(await source.listerTickets(u.karim, { vue: "moi" })), [N.karim]);
  });

  testPg("filtre d'affectation (légende de la liste) : à moi, à un autre, à personne", async () => {
    const { source, u } = await monde();
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "tout", affectation: "AUCUN" })), [N.libre, N.infra].sort());
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "groupes", affectation: "TIERS" })), [N.karim]);
    assert.deepEqual(numeros(await source.listerTickets(u.karim, { vue: "groupes", affectation: "MOI" })), [N.karim]);
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "groupes", affectation: "MOI" })), []);
    const s = await source.stats(u.isabelle, { vue: "tout", affectation: "AUCUN" });
    assert.equal(s.parFiltreStatut[""], 2, "les compteurs de statut suivent le filtre");
  });

  testPg("cartes de stats : plusieurs statuts à la fois, et tickets en retard", async () => {
    const { ev, synchro, source, u } = await monde();
    const enCours = await source.listerTickets(u.isabelle, { vue: "tout", statut: "OUVERT,EN_COURS" });
    assert.deepEqual(numeros(enCours), [N.libre, N.karim, N.infra].sort());

    ev.modifier(N.karim, { MAX_RESOLUTION_DATE_UT: F.ilYa(1) });
    ev.modifier(N.resolu, { MAX_RESOLUTION_DATE_UT: F.ilYa(1) }); // résolu : jamais « en retard »
    await synchro.executer();
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "tout", retard: "1" })), [N.karim]);
    const s = await source.stats(u.isabelle, { vue: "tout", retard: "1" });
    assert.equal(s.total, 1);
    assert.equal(s.en_retard, 1);
  });

  testPg("filtre de statut : « Actifs » exclut les résolus et clos, un statut précis ne garde que lui", async () => {
    const { source, u } = await monde();
    const actifs = await source.listerTickets(u.isabelle, { vue: "tout", statut: "ACTIFS" });
    assert.deepEqual(numeros(actifs), [N.libre, N.karim, N.infra].sort());
    const resolus = await source.listerTickets(u.isabelle, { vue: "tout", statut: "RESOLU" });
    assert.deepEqual(numeros(resolus), [N.resolu]);
  });

  testPg("recherche : par numéro ou par nom, sans tenir compte des accents", async () => {
    const { source, u } = await monde();
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "tout", q: N.infra })), [N.infra]);
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "tout", q: "benali" })), [N.karim]);
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "tout", q: "LEFEVRE" })), []);
  });

  testPg("vue non disponible pour ce profil : refusée", async () => {
    const { source, u } = await monde();
    const err = await erreurDe(source.listerTickets(u.marc, { vue: "tout" }));
    assert.ok(err instanceof ErreurSource);
    assert.equal(err.status, 400);
  });

  testPg("stats : les compteurs des boutons de statut correspondent aux listes", async () => {
    const { source, u } = await monde();
    const s = await source.stats(u.isabelle, { vue: "tout", statut: "ACTIFS" });
    assert.equal(s.total, 3);
    assert.equal(s.parFiltreStatut[""], 4);
    assert.equal(s.parFiltreStatut.ACTIFS, 3);
    assert.equal(s.parFiltreStatut.RESOLU, 1);
    assert.equal(s.parFiltreStatut.OUVERT, 2);
    const parGroupe = Object.fromEntries(s.parGroupe.map((g) => [g.groupe.id, g.n]));
    assert.deepEqual(parGroupe, { [F.GROUPE_SD.GROUP_ID]: 2, [F.GROUPE_INFRA.GROUP_ID]: 1 });
  });
});

// ---------- Detail et actions ----------

describe("détail d'un ticket et actions", () => {
  testPg("ticket d'un autre groupe : « introuvable » (son existence n'est pas révélée)", async () => {
    const { source, u } = await monde();
    const err = await erreurDe(source.getTicket(u.julie, N.libre));
    assert.equal(err.status, 404);
  });

  testPg("détail lu en direct dans EV, avec les boutons permis", async () => {
    const { source, u } = await monde();
    const t = await source.getTicket(u.marc, N.libre);
    assert.equal(t.fraicheur.origine, "ev");
    assert.ok(t.actions.some((a) => a.code === "PRENDRE" && !a.secondaire));
    const reaffecter = t.actions.find((a) => a.code === "REAFFECTER");
    assert.deepEqual(reaffecter.membres.map((m) => m.nom), ["Karim Benali"], "collègues du groupe, sans moi");
  });

  testPg("EV injoignable : détail servi depuis la base, sans aucun bouton", async () => {
    const { ev, source, u } = await monde();
    ev.panne();
    const t = await source.getTicket(u.marc, N.libre);
    assert.equal(t.fraicheur.origine, "cache");
    assert.ok(t.fraicheur.erreur_ev);
    assert.deepEqual(t.actions, []);
  });

  testPg("prendre en charge : transmis à EV, et la base est à jour sans attendre la synchro", async () => {
    const { ev, source, u } = await monde();
    await source.executerAction(u.marc, N.libre, { action: "PRENDRE" });
    assert.equal(ev.actionsDe(N.libre)[0].DONE_BY_ID, EMP.marc.EMPLOYEE_ID);
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "moi" })), [N.libre]);
  });

  testPg("réaffecter à un collègue : transmis à EV et tracé dans l'historique", async () => {
    const { ev, source, u } = await monde();
    await source.executerAction(u.marc, N.karim, { action: "REAFFECTER", membre_id: EMP.marc.EMPLOYEE_ID }).then(
      () => assert.fail("on ne se réaffecte pas à soi-même par ce bouton"),
      (err) => assert.equal(err.status, 400)
    );
    await source.executerAction(u.isabelle, N.karim, { action: "REAFFECTER", membre_id: EMP.marc.EMPLOYEE_ID });
    const [etape, trace] = ev.actionsDe(N.karim);
    assert.equal(etape.DONE_BY_ID, EMP.marc.EMPLOYEE_ID);
    assert.equal(trace.ACTION_TYPE.NAME_FR, F.cfg.typeCommentaire);
    assert.match(trace.COMMENT, /Réaffecté à Marc Dubois/);
  });

  testPg("action non permise à cette étape : refusée (403)", async () => {
    const { source, u } = await monde();
    const err = await erreurDe(source.executerAction(u.marc, N.libre, { action: "VALIDER" }));
    assert.equal(err.status, 403);
  });

  testPg("mettre en attente sans commentaire : refusé (400)", async () => {
    const { source, u } = await monde();
    const err = await erreurDe(source.executerAction(u.karim, N.karim, { action: "SUSPENDRE", commentaire: "  " }));
    assert.equal(err.status, 400);
  });

  testPg("EV injoignable : aucune action possible (503), rien n'est modifié", async () => {
    const { ev, source, u } = await monde();
    ev.panne();
    const err = await erreurDe(source.executerAction(u.marc, N.libre, { action: "PRENDRE" }));
    assert.equal(err.status, 503);
    ev.reparer();
    assert.equal(ev.actionsDe(N.libre)[0].DONE_BY_ID, null);
  });

  testPg("transférer vers un autre groupe : le ticket sort de ma file", async () => {
    const { source, u } = await monde();
    const res = await source.executerAction(u.marc, N.libre, { action: "TRANSFERER", groupe_id: F.GROUPE_INFRA.GROUP_ID, commentaire: "Pour l'infra" });
    assert.equal(res.masque, undefined, "je reste dans l'historique du ticket, je le vois encore");
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "groupes" })), [N.karim]);
    assert.deepEqual(numeros(await source.listerTickets(u.julie, { vue: "groupes" })), [N.libre, N.infra].sort());
  });

  testPg("en lot : remettre dans le groupe, résultat ticket par ticket", async () => {
    const { ev, source, u } = await monde();
    const res = await source.executerLot(u.marc, { action: "DESAFFECTER", numeros: [N.karim, N.infra] });
    assert.equal(res.reussis, 1);
    assert.deepEqual(res.resultats.map((r) => [r.numero, r.ok]), [[N.karim, true], [N.infra, false]]);
    assert.equal(ev.actionsDe(N.karim)[0].DONE_BY_ID, null);
  });

  testPg("en lot : action non prévue refusée", async () => {
    const { source, u } = await monde();
    const err = await erreurDe(source.executerLot(u.marc, { action: "TERMINER", numeros: [N.karim] }));
    assert.equal(err.status, 400);
  });
});
