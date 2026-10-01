// Tests de modele.js : comment le portail lit un ticket EV, et qui a le droit de faire quoi.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../sources/portail/modele");
const F = require("./fabrique");

// Utilisateurs du portail, construits comme en vrai depuis l'employe EV et ses groupes.
const marc = M.versUtilisateur(F.employe(1, "Dubois, Marc"), [F.GROUPE_SD]);
const karim = M.versUtilisateur(F.employe(2, "Benali, Karim"), [F.GROUPE_SD]);
const julie = M.versUtilisateur(F.employe(3, "Lefèvre, Julie"), [F.GROUPE_INFRA]);
const isabelle = M.versUtilisateur(F.employe(4, "Garnier, Isabelle"), [F.GROUPE_SUPERVISION]);
const claire = M.versUtilisateur(F.employe(5, "Martin, Claire"), [F.GROUPE_VALIDEURS]);
const empMarc = F.employe(1, "Dubois, Marc");
const empKarim = F.employe(2, "Benali, Karim");
const empClaire = F.employe(5, "Martin, Claire");

const codes = (u, ctx) => M.actionsPossibles(u, ctx).map((a) => a.code);
const principales = (u, ctx) => M.actionsPossibles(u, ctx).filter((a) => !a.secondaire).map((a) => a.code);

describe("profil de l'utilisateur (d'après ses groupes EV)", () => {
  test("membre d'un groupe d'intervenants : INTERVENANT", () => {
    assert.equal(marc.profil, "INTERVENANT");
    assert.equal(marc.nom_complet, "Marc Dubois");
  });

  test("groupe Supervision support : SUPERVISEUR", () => {
    assert.equal(isabelle.profil, "SUPERVISEUR");
  });

  test("groupe Cadres valideurs seul : VALIDEUR", () => {
    assert.equal(claire.profil, "VALIDEUR");
  });

  test("aucun groupe support : pas d'accès (AUCUN)", () => {
    assert.equal(M.versUtilisateur(F.employe(9, "Roux, Julien"), []).profil, "AUCUN");
  });

  test("employé parti (date de départ passée) : plus d'accès, même avec ses groupes", () => {
    const parti = F.employe(9, "Ancien, Paul", { DEPARTURE_DATE: "2020-01-01T00:00:00Z" });
    assert.equal(M.versUtilisateur(parti, [F.GROUPE_SUPERVISION]).profil, "AUCUN");
  });

  test("les groupes techniques (supervision, valideurs) ne comptent pas comme groupes de traitement", () => {
    const u = M.versUtilisateur(F.employe(6, "Blanc, Sandrine"), [F.GROUPE_SD, F.GROUPE_VALIDEURS]);
    assert.equal(u.profil, "INTERVENANT");
    assert.deepEqual(u.groupes.map((g) => g.nom), ["Service Desk"]);
  });
});

describe("étape et statut affichés", () => {
  test("incident non affecté : OUVERT, « À prendre en charge »", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident")]);
    assert.equal(ctx.statut, "OUVERT");
    assert.equal(ctx.etape.code, "A_TRAITER");
    assert.equal(ctx.etape.label, "À prendre en charge");
  });

  test("incident affecté : EN_COURS, « Pris en charge »", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident", { faitPar: empMarc })]);
    assert.equal(ctx.statut, "EN_COURS");
    assert.equal(ctx.etape.code, "PRIS_EN_CHARGE");
    assert.equal(ctx.intervenant.nom, "Marc Dubois");
  });

  test("ticket suspendu : étape « En attente »", () => {
    const ctx = M.analyser(F.ticket("I1", "Suspendu"), [F.action("Traitement incident", { faitPar: empMarc })]);
    assert.equal(ctx.statut, "EN_ATTENTE");
    assert.equal(ctx.etape.code, "SUSPENDU");
  });

  test("ticket clôturé : CLOTURE", () => {
    const ctx = M.analyser(F.ticket("I1", "Clôturé"), [F.action("Traitement incident", { faitPar: empMarc, fin: "2026-09-02T10:00:00Z" })]);
    assert.equal(ctx.statut, "CLOTURE");
    assert.equal(ctx.etape.code, "CLOTURE");
  });

  test("demande refusée : close, mais hors parcours (barre grisée)", () => {
    const ctx = M.analyser(F.ticket("S1", "Refusé"), []);
    assert.equal(ctx.statut, "CLOTURE");
    assert.equal(ctx.etape.code, "HORS_PARCOURS");
  });

  test("le type vient du préfixe du numéro EV", () => {
    assert.equal(M.analyser(F.ticket("I260927_000006", "Nouveau"), []).type, "INCIDENT");
    assert.equal(M.analyser(F.ticket("S260927_000006", "Nouveau"), []).type, "DEMANDE");
  });

  test("le groupe affiché ignore le groupe de la validation", () => {
    const ctx = M.analyser(F.ticket("S1", "En attente de validation"), [
      F.action("Réalisation demande", { groupe: F.GROUPE_INFRA, fin: "2026-09-01T09:30:00Z" }),
      F.action("Validation hiérarchique", { groupe: F.GROUPE_VALIDEURS, faitPar: empClaire }),
    ]);
    assert.equal(ctx.groupe.nom, "Infrastructure N2");
    assert.equal(ctx.valideur.nom, "Claire Martin");
  });
});

describe("qui voit le ticket", () => {
  const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident")]);

  test("un membre du groupe le voit", () => assert.ok(M.peutVoir(marc, ctx)));
  test("un intervenant d'un autre groupe ne le voit pas", () => assert.ok(!M.peutVoir(julie, ctx)));
  test("le superviseur voit tout", () => assert.ok(M.peutVoir(isabelle, ctx)));

  test("le valideur voit la demande qu'il doit valider", () => {
    const ctxV = M.analyser(F.ticket("S1", "En attente de validation"), [
      F.action("Validation hiérarchique", { groupe: F.GROUPE_VALIDEURS, faitPar: empClaire }),
    ]);
    assert.ok(M.peutVoir(claire, ctxV));
    assert.ok(!M.peutVoir(claire, ctx));
  });
});

describe("boutons proposés", () => {
  test("ticket non affecté : « Prendre en charge » est l'action attendue du groupe", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident")]);
    assert.deepEqual(principales(marc, ctx), ["PRENDRE"]);
    assert.ok(codes(marc, ctx).includes("TRANSFERER"));
    assert.ok(!codes(marc, ctx).includes("DESAFFECTER"), "rien à désaffecter");
    assert.ok(M.attendMonAction(marc, ctx));
  });

  test("ticket qui m'est affecté : résoudre et mettre en attente sont attendus de moi", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident", { faitPar: empMarc })]);
    assert.deepEqual(principales(marc, ctx), ["TERMINER", "SUSPENDRE"]);
    assert.ok(codes(marc, ctx).includes("DESAFFECTER"));
    assert.ok(codes(marc, ctx).includes("REAFFECTER"));
  });

  test("ticket d'un collègue : je peux agir, mais rien n'est « attendu » de moi", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident", { faitPar: empKarim })]);
    assert.deepEqual(principales(marc, ctx), []);
    assert.ok(codes(marc, ctx).includes("PRENDRE"));
    assert.ok(!M.attendMonAction(marc, ctx));
  });

  test("intervenant d'un autre groupe : aucun bouton de traitement", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident")]);
    assert.deepEqual(codes(julie, ctx), ["COMMENTER"]);
  });

  test("ticket clôturé : aucun bouton", () => {
    const ctx = M.analyser(F.ticket("I1", "Clôturé"), [F.action("Traitement incident", { faitPar: empMarc })]);
    assert.deepEqual(codes(marc, ctx), []);
    assert.deepEqual(codes(isabelle, ctx), []);
  });

  test("ticket en attente : reprendre, réaffecter ou remettre dans le groupe", () => {
    const ctx = M.analyser(F.ticket("I1", "Suspendu"), [F.action("Traitement incident", { faitPar: empMarc })]);
    assert.deepEqual(principales(marc, ctx), ["REPRENDRE"]);
    assert.ok(codes(karim, ctx).includes("REAFFECTER"), "un collègue peut débloquer un ticket en attente");
    assert.ok(codes(karim, ctx).includes("DESAFFECTER"));
  });

  test("validation : seul le valideur désigné (ou le superviseur) valide ou refuse", () => {
    const ctx = M.analyser(F.ticket("S1", "En attente de validation"), [
      F.action("Validation hiérarchique", { groupe: F.GROUPE_VALIDEURS, faitPar: empClaire }),
    ]);
    assert.deepEqual(principales(claire, ctx), ["VALIDER", "REFUSER"]);
    assert.ok(codes(isabelle, ctx).includes("VALIDER"));
    assert.ok(!codes(marc, ctx).includes("VALIDER"));
  });

  test("confirmation : clôturer est attendu de celui qui a résolu", () => {
    const ctx = M.analyser(F.ticket("I1", "Résolu"), [
      F.action("Traitement incident", { faitPar: empMarc, fin: "2026-09-02T10:00:00Z" }),
      F.action("Confirmation demandeur"),
    ]);
    assert.deepEqual(principales(marc, ctx), ["CLOTURER", "ROUVRIR"]);
    assert.deepEqual(principales(karim, ctx), [], "pour un collègue, c'est secondaire");
  });

  test("les boutons envoyés au front ne contiennent pas l'appel EV", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident")]);
    for (const a of M.actionsPossibles(marc, ctx).map(M.versActionPublique)) {
      assert.equal(a.op, undefined);
    }
  });
});

describe("mise en forme pour le front", () => {
  test("priorité : bloqué + tout l'établissement = critique (1)", () => {
    const ctx = M.analyser(F.ticket("I1", "Nouveau", { URGENCY_ID: 1, SEVERITY_ID: 1 }), []);
    assert.equal(M.versTicket(ctx, marc).priorite, 1);
  });

  test("priorité : peut travailler + moi seul = basse (4)", () => {
    const ctx = M.analyser(F.ticket("I1", "Nouveau", { URGENCY_ID: 3, SEVERITY_ID: 3 }), []);
    assert.equal(M.versTicket(ctx, marc).priorite, 4);
  });

  test("en retard : échéance passée et ticket non terminé", () => {
    const passe = "2020-01-01T00:00:00Z";
    const ouvert = M.analyser(F.ticket("I1", "En cours", { MAX_RESOLUTION_DATE_UT: passe }), []);
    const resolu = M.analyser(F.ticket("I1", "Résolu", { MAX_RESOLUTION_DATE_UT: passe }), []);
    assert.equal(M.versTicket(ouvert, marc).en_retard, true);
    assert.equal(M.versTicket(resolu, marc).en_retard, false);
  });

  test("affectation vue par l'utilisateur : MOI / TIERS / AUCUN", () => {
    const ctx = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident", { faitPar: empMarc })]);
    assert.equal(M.versTicket(ctx, marc).affectation, "MOI");
    assert.equal(M.versTicket(ctx, karim).affectation, "TIERS");
    const libre = M.analyser(F.ticket("I1", "En cours"), [F.action("Traitement incident")]);
    assert.equal(M.versTicket(libre, marc).affectation, "AUCUN");
  });

  test("chemin de catalogue : libellé et chemin lisible, même si le titre contient un /", () => {
    assert.deepEqual(M.lireCatalogue("Incidents/Infrastructure/Messagerie/Messagerie (Outlook)"), {
      libelle: "Messagerie (Outlook)",
      chemin: "Infrastructure › Messagerie",
    });
    assert.deepEqual(M.lireCatalogue("Demandes/Accès/Accès VPN / télétravail", "Accès VPN / télétravail"), {
      libelle: "Accès VPN / télétravail",
      chemin: "Accès",
    });
  });

  test("progression : l'étape « En validation » n'apparaît que si la demande en a une", () => {
    const sans = M.analyser(F.ticket("S1", "En cours"), [F.action("Réalisation demande")]);
    const avec = M.analyser(F.ticket("S1", "En attente de validation"), [
      F.action("Validation hiérarchique", { groupe: F.GROUPE_VALIDEURS, faitPar: empClaire }),
    ]);
    assert.ok(!M.progression(sans).parcours.some((s) => s.code === "EN_VALIDATION"));
    assert.equal(M.progression(sans).position, 0, "« À traiter », première étape");
    assert.equal(M.progression(avec).parcours[0].code, "EN_VALIDATION");
    assert.equal(M.progression(avec).position, 0);
  });

  test("historique : création en premier, trié par date", () => {
    const ctx = M.analyser(F.ticket("I1", "Résolu"), [
      F.action("Traitement incident", { faitPar: empMarc, fin: "2026-09-02T10:00:00Z" }),
      F.action("Confirmation demandeur", { debut: "2026-09-02T10:00:01Z" }),
    ]);
    const h = M.historique(ctx);
    assert.equal(h[0].action, "Création");
    assert.equal(h[1].action, "Résoudre");
    assert.equal(h[2].en_cours, true);
  });
});
