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
  if (!cache) return;
  await cache.vider();
  await base.requete("TRUNCATE portail.preferences");
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
  testPg("« Tickets de mes groupes » : en cours et terminés de mes groupes, pas ceux des autres", async () => {
    const { source, u } = await monde();
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "groupes" })), [N.libre, N.karim, N.resolu].sort());
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "groupes", statut: "ACTIFS" })), [N.libre, N.karim].sort());
  });

  testPg("superviseur : tous les tickets, sauf les clos de plus de 30 jours", async () => {
    const { source, u } = await monde();
    const tout = await source.listerTickets(u.isabelle, { vue: "groupes" });
    assert.deepEqual(numeros(tout), [N.libre, N.karim, N.infra, N.resolu].sort());
  });

  testPg("« Mes tickets », « Non affectés », « Affectés à un autre »", async () => {
    const { source, u } = await monde();
    const vue = async (qui, code, statut = "") => numeros(await source.listerTickets(u[qui], { vue: code, statut }));
    assert.deepEqual(await vue("marc", "non_affectes"), [N.libre]);
    assert.deepEqual(await vue("karim", "moi"), [N.karim]);
    // Ticket résolu : reste dans « Mes tickets » de celui qui l'a traité.
    assert.deepEqual(await vue("marc", "moi"), [N.resolu]);
    assert.deepEqual(await vue("marc", "moi", "ACTIFS"), []);
    assert.deepEqual(await vue("marc", "autres"), [N.karim]);
    assert.deepEqual(await vue("karim", "autres"), [N.resolu]);
    assert.deepEqual(await vue("isabelle", "non_affectes"), [N.libre, N.infra].sort());
  });

  testPg("statuts : tous, actifs, inactifs (résolus et clôturés)", async () => {
    const { source, u } = await monde();
    const statut = async (code) => numeros(await source.listerTickets(u.isabelle, { vue: "groupes", statut: code }));
    assert.deepEqual(await statut("ACTIFS"), [N.libre, N.karim, N.infra].sort());
    assert.deepEqual(await statut("INACTIFS"), [N.resolu]);
    assert.equal((await statut("")).length, 4);
  });

  testPg("groupes : un ou plusieurs cochés, compteurs à moi / total par groupe", async () => {
    const { source, u } = await monde();
    const SD = F.GROUPE_SD.GROUP_ID;
    const INFRA = F.GROUPE_INFRA.GROUP_ID;
    const liste = async (groupe) => numeros(await source.listerTickets(u.isabelle, { vue: "groupes", statut: "ACTIFS", groupe }));
    assert.deepEqual(await liste(String(INFRA)), [N.infra]);
    assert.deepEqual(await liste(`${SD},${INFRA}`), [N.libre, N.karim, N.infra].sort());
    // Les compteurs ignorent la sélection de groupes (sinon les autres tomberaient à 0).
    const s = await source.stats(u.karim, { vue: "groupes", statut: "ACTIFS", groupe: String(INFRA) });
    assert.deepEqual(s.parGroupe.find((g) => g.groupe.id === SD), { groupe: { id: SD, nom: F.GROUPE_SD.GROUP_FR }, moi: 1, total: 2 });
  });

  testPg("recherche : par numéro ou par nom, sans tenir compte des accents", async () => {
    const { source, u } = await monde();
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "groupes", q: N.infra })), [N.infra]);
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "groupes", q: "benali" })), [N.karim]);
    assert.deepEqual(numeros(await source.listerTickets(u.isabelle, { vue: "groupes", q: "LEFEVRE" })), []);
  });

  testPg("vue non disponible pour ce profil : refusée", async () => {
    const { source, u } = await monde();
    const err = await erreurDe(source.listerTickets(u.marc, { vue: "a_valider" }));
    assert.ok(err instanceof ErreurSource);
    assert.equal(err.status, 400);
  });

  testPg("stats : compteurs des statuts et des vues, cohérents avec les listes", async () => {
    const { source, u } = await monde();
    const s = await source.stats(u.marc, { vue: "groupes", statut: "ACTIFS" });
    assert.equal(s.total, 2);
    assert.deepEqual(s.parFiltreStatut, { "": 3, ACTIFS: 2, INACTIFS: 1 });
    // Chaque vue compte avec les mêmes filtres (ici : actifs), quelle que soit la vue affichée.
    assert.deepEqual(s.parVue, { groupes: 2, moi: 0, non_affectes: 1, autres: 1 });
    for (const [code, n] of Object.entries(s.parVue)) {
      assert.equal((await source.listerTickets(u.marc, { vue: code, statut: "ACTIFS" })).length, n, `vue ${code}`);
    }
    const parGroupe = Object.fromEntries((await source.stats(u.isabelle, { vue: "groupes", statut: "ACTIFS" })).parGroupe.map((g) => [g.groupe.id, g.total]));
    assert.deepEqual(parGroupe, { [F.GROUPE_SD.GROUP_ID]: 2, [F.GROUPE_INFRA.GROUP_ID]: 1 });
  });
});

// ---------- Detail et actions ----------

describe("préférences et compteurs par établissement", () => {
  testPg("vue et statut par défaut : choisis par l'utilisateur, gardés pour lui seul", async () => {
    const { ev, source, u } = await monde();
    const defaut = { vue_defaut: "groupes", statut_defaut: "ACTIFS" };
    assert.deepEqual(await source.preferences(u.marc), defaut);
    assert.deepEqual(await source.definirPreferences(u.marc, { vue_defaut: "moi" }), { ...defaut, vue_defaut: "moi" });
    // « Tous » (statut vide) est un choix possible, distinct de « rien de choisi ».
    assert.deepEqual(await source.definirPreferences(u.marc, { statut_defaut: "" }), { vue_defaut: "moi", statut_defaut: "" });
    // Enregistrées en base : une autre instance du portail les retrouve.
    assert.deepEqual(await creerSource(ev).preferences(u.marc), { vue_defaut: "moi", statut_defaut: "" });
    assert.deepEqual(await source.preferences(u.karim), defaut, "propres à chaque utilisateur");
    assert.equal((await erreurDe(source.definirPreferences(u.marc, { vue_defaut: "a_valider" }))).status, 400);
    assert.equal((await erreurDe(source.definirPreferences(u.marc, { statut_defaut: "RESOLU" }))).status, 400);
  });

  testPg("compteurs par établissement : à moi / total de la vue affichée, avec les filtres", async () => {
    const { ev, synchro, source, u } = await monde();
    const clinique = { LOCATION_ID: 7, LOCATION_FR: "Clinique test" };
    for (const n of [N.libre, N.karim, N.resolu]) ev.modifier(n, { LOCATION: clinique });
    await synchro.executer();
    const compte = async (filtres) =>
      (await source.stats(u.karim, filtres)).parEtablissement.find((e) => e.id === 7) || { id: 7, moi: 0, total: 0 };
    assert.deepEqual(await compte({ vue: "groupes", statut: "ACTIFS" }), { id: 7, moi: 1, total: 2 });
    assert.deepEqual(await compte({ vue: "groupes", statut: "" }), { id: 7, moi: 1, total: 3 });
    assert.deepEqual(await compte({ vue: "non_affectes", statut: "ACTIFS" }), { id: 7, moi: 0, total: 1 });
    // La sélection d'établissements ne change pas les compteurs (sinon les non-cochés tomberaient à 0).
    assert.deepEqual(await compte({ vue: "groupes", statut: "ACTIFS", etablissement: "99" }), { id: 7, moi: 1, total: 2 });
  });
});

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

  testPg("pièces jointes : listées dans le détail, téléchargées avec les droits du ticket", async () => {
    const { ev, source, u } = await monde();
    ev.joindre(N.libre, { id: "40000_capture", nom: "Capture écran.PNG", contenu: "octets-png" });
    ev.joindre(N.libre, { id: "40000_journal", nom: "journal.log", contenu: "ligne 1" });
    const t = await source.getTicket(u.marc, N.libre);
    assert.deepEqual(t.pieces_jointes, [
      { id: "40000_capture", nom: "Capture écran.PNG", type: "image/png" },
      { id: "40000_journal", nom: "journal.log", type: "text/plain" },
    ]);
    const fichier = await source.getPieceJointe(u.marc, N.libre, "40000_capture");
    assert.equal(fichier.nom, "Capture écran.PNG");
    assert.equal(fichier.type, "image/png", "type déduit du nom quand EV ne le donne pas");
    assert.equal(fichier.contenu.toString(), "octets-png");
    // Mêmes droits que le ticket : pas de pièce jointe d'un ticket qu'on ne voit pas.
    assert.equal((await erreurDe(source.getPieceJointe(u.julie, N.libre, "40000_capture"))).status, 404);
    assert.equal((await erreurDe(source.getPieceJointe(u.marc, N.libre, "40000_inconnu"))).status, 404);
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
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "moi", statut: "ACTIFS" })), [N.libre]);
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
    assert.deepEqual(numeros(await source.listerTickets(u.marc, { vue: "groupes", statut: "ACTIFS" })), [N.karim]);
    assert.deepEqual(numeros(await source.listerTickets(u.julie, { vue: "groupes", statut: "ACTIFS" })), [N.libre, N.infra].sort());
  });

});
