// Tests de modele.js : comment le portail lit un ticket EV, et qui a le droit de faire quoi.
// Les noms EV (statuts, types d'action, groupes) viennent de correspondance.js (voir fabrique.js).

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../sources/portail/modele");
const F = require("./fabrique");

const { cfg, STATUT, TYPE, TRAITEMENT } = F;

// Utilisateurs du portail, construits comme en vrai depuis l'employe EV et ses groupes.
const empMarc = F.employe(1, "Dubois, Marc");
const empKarim = F.employe(2, "Benali, Karim");
const empClaire = F.employe(5, "Martin, Claire");
const marc = M.versUtilisateur(empMarc, [F.GROUPE_SD]);
const karim = M.versUtilisateur(empKarim, [F.GROUPE_SD]);
const julie = M.versUtilisateur(F.employe(3, "Lefèvre, Julie"), [F.GROUPE_INFRA]);
const isabelle = M.versUtilisateur(F.employe(4, "Garnier, Isabelle"), [F.GROUPE_SUPERVISION]);
const claire = M.versUtilisateur(empClaire, [F.GROUPE_VALIDEURS]);

const codes = (u, ctx) => M.actionsPossibles(u, ctx).map((a) => a.code);
const principales = (u, ctx) => M.actionsPossibles(u, ctx).filter((a) => !a.secondaire).map((a) => a.code);

// Situations types
const I = F.incident(1);
const libre = () => M.analyser(F.ticket(I, STATUT.enCours), [F.action(TYPE.traitement)]);
const affecteA = (emp) => M.analyser(F.ticket(I, STATUT.enCours), [F.action(TYPE.traitement, { faitPar: emp })]);
const enValidation = () =>
  M.analyser(F.ticket(F.demande(1), STATUT.enAttente || STATUT.enCours), [
    F.action(TYPE.validation, { groupe: F.GROUPE_VALIDEURS, faitPar: empClaire }),
  ]);
const aConfirmer = () =>
  M.analyser(F.ticket(I, STATUT.resolu), [
    F.action(TYPE.traitement, { faitPar: empMarc, fin: F.ilYa(1) }),
    F.action(TYPE.confirmation, { debut: F.ilYa(1) }),
  ]);

const sansValidation = F.absent(TYPE.validation, "étape de validation");
const sansConfirmation = F.absent(TYPE.confirmation, "étape de confirmation");

describe("profil de l'utilisateur (d'après ses groupes EV)", () => {
  test("membre d'un groupe d'intervenants : INTERVENANT", () => {
    assert.equal(marc.profil, "INTERVENANT");
    assert.equal(marc.nom_complet, "Marc Dubois");
  });

  test("groupe des superviseurs : SUPERVISEUR", () => {
    assert.equal(isabelle.profil, "SUPERVISEUR");
  });

  test("groupe des valideurs seul : VALIDEUR", () => {
    assert.equal(claire.profil, "VALIDEUR");
  });

  test("aucun groupe support : pas d'accès (AUCUN)", () => {
    assert.equal(M.versUtilisateur(F.DEMANDEUR, []).profil, "AUCUN");
  });

  test("employé parti (date de départ passée) : plus d'accès, même avec ses groupes", () => {
    const parti = F.employe(9, "Ancien, Paul", { [cfg.champsFin.employe]: F.ilYa(30) });
    assert.equal(M.versUtilisateur(parti, [F.GROUPE_SUPERVISION]).profil, "AUCUN");
  });

  test("départ prévu dans le futur : accès conservé", () => {
    const partant = F.employe(9, "Futur, Paul", { [cfg.champsFin.employe]: F.ilYa(-30) });
    assert.equal(M.versUtilisateur(partant, [F.GROUPE_SD]).profil, "INTERVENANT");
  });

  test("les groupes techniques (supervision, valideurs) ne comptent pas comme groupes de traitement", () => {
    const u = M.versUtilisateur(F.employe(6, "Blanc, Sandrine"), [F.GROUPE_SD, F.GROUPE_VALIDEURS]);
    assert.equal(u.profil, "INTERVENANT");
    assert.deepEqual(u.groupes.map((g) => g.id), [F.GROUPE_SD.GROUP_ID]);
  });
});

describe("étape et statut affichés", () => {
  test("traitement non affecté : OUVERT, étape « non affectée »", () => {
    const ctx = libre();
    assert.equal(ctx.statut, "OUVERT");
    assert.equal(ctx.etape.code, TRAITEMENT.codeNonAffecte);
    assert.equal(ctx.etape.label, TRAITEMENT.etapeNonAffectee);
  });

  test("traitement affecté : EN_COURS, intervenant affiché", () => {
    const ctx = affecteA(empMarc);
    assert.equal(ctx.statut, "EN_COURS");
    assert.equal(ctx.etape.code, TRAITEMENT.code);
    assert.equal(ctx.intervenant.nom, "Marc Dubois");
  });

  test("ticket suspendu : étape « En attente »", () => {
    const ctx = M.analyser(F.ticket(I, STATUT.suspendu), [F.action(TYPE.traitement, { faitPar: empMarc })]);
    assert.equal(ctx.statut, "EN_ATTENTE");
    assert.equal(ctx.etape.code, "SUSPENDU");
  });

  test("ticket clôturé : CLOTURE", { skip: F.absent(STATUT.cloture, "statut de clôture normal") }, () => {
    const ctx = M.analyser(F.ticket(I, STATUT.cloture), [F.action(TYPE.traitement, { faitPar: empMarc, fin: F.ilYa(1) })]);
    assert.equal(ctx.statut, "CLOTURE");
    assert.equal(ctx.etape.code, "CLOTURE");
  });

  test("fin anticipée (refus, annulation) : close, mais hors parcours", { skip: F.absent(STATUT.refuse, "statut de sortie") }, () => {
    const ctx = M.analyser(F.ticket(F.demande(1), STATUT.refuse), []);
    assert.equal(ctx.statut, "CLOTURE");
    assert.equal(ctx.etape.code, "HORS_PARCOURS");
  });

  test("statut EV inconnu : traité comme en cours, sans planter", () => {
    const ctx = M.analyser(F.ticket(I, "__statut_inconnu__"), []);
    assert.equal(ctx.statut, "EN_COURS");
    assert.equal(ctx.etape.code, "HORS_PARCOURS");
  });

  test("le type vient du préfixe du numéro EV", () => {
    assert.equal(M.analyser(F.ticket(F.incident(6), STATUT.nouveau), []).type, "INCIDENT");
    assert.equal(M.analyser(F.ticket(F.demande(6), STATUT.nouveau), []).type, "DEMANDE");
  });

  test("le groupe affiché ignore le groupe de la validation", { skip: sansValidation }, () => {
    const ctx = M.analyser(F.ticket(F.demande(1), STATUT.enAttente || STATUT.enCours), [
      F.action(TYPE.traitement, { groupe: F.GROUPE_INFRA, fin: F.ilYa(2) }),
      F.action(TYPE.validation, { groupe: F.GROUPE_VALIDEURS, faitPar: empClaire }),
    ]);
    assert.equal(ctx.groupe.id, F.GROUPE_INFRA.GROUP_ID);
    assert.equal(ctx.valideur.nom, "Claire Martin");
  });
});

describe("qui voit le ticket", () => {
  test("un membre du groupe le voit", () => assert.ok(M.peutVoir(marc, libre())));
  test("un intervenant d'un autre groupe ne le voit pas", () => assert.ok(!M.peutVoir(julie, libre())));
  test("le superviseur voit tout", () => assert.ok(M.peutVoir(isabelle, libre())));

  test("le valideur ne voit que les demandes qu'il doit valider", { skip: sansValidation }, () => {
    assert.ok(M.peutVoir(claire, enValidation()));
    assert.ok(!M.peutVoir(claire, libre()));
  });
});

describe("boutons proposés", () => {
  test("ticket non affecté : « Prendre en charge » est l'action attendue du groupe", () => {
    const ctx = libre();
    assert.deepEqual(principales(marc, ctx), ["PRENDRE"]);
    assert.ok(codes(marc, ctx).includes("TRANSFERER"));
    assert.ok(!codes(marc, ctx).includes("DESAFFECTER"), "rien à désaffecter");
    assert.ok(M.attendMonAction(marc, ctx));
  });

  test("ticket qui m'est affecté : terminer et mettre en attente sont attendus de moi", () => {
    const ctx = affecteA(empMarc);
    assert.deepEqual(principales(marc, ctx), ["TERMINER", "SUSPENDRE"]);
    assert.equal(M.actionsPossibles(marc, ctx)[0].label, TRAITEMENT.terminer);
    assert.ok(codes(marc, ctx).includes("DESAFFECTER"));
    assert.ok(codes(marc, ctx).includes("REAFFECTER"));
  });

  test("ticket d'un collègue : je peux agir, mais rien n'est « attendu » de moi", () => {
    const ctx = affecteA(empKarim);
    assert.deepEqual(principales(marc, ctx), []);
    assert.ok(codes(marc, ctx).includes("PRENDRE"));
    assert.ok(!M.attendMonAction(marc, ctx));
  });

  test("intervenant d'un autre groupe : seulement commenter", () => {
    assert.deepEqual(codes(julie, libre()), ["COMMENTER"]);
  });

  test("ticket clôturé : aucun bouton, pour personne", { skip: F.absent(STATUT.cloture, "statut de clôture normal") }, () => {
    const ctx = M.analyser(F.ticket(I, STATUT.cloture), [F.action(TYPE.traitement, { faitPar: empMarc })]);
    assert.deepEqual(codes(marc, ctx), []);
    assert.deepEqual(codes(isabelle, ctx), []);
  });

  test("ticket en attente : reprendre, réaffecter ou remettre dans le groupe", () => {
    const ctx = M.analyser(F.ticket(I, STATUT.suspendu), [F.action(TYPE.traitement, { faitPar: empMarc })]);
    assert.deepEqual(principales(marc, ctx), ["REPRENDRE"]);
    assert.ok(codes(karim, ctx).includes("REAFFECTER"), "un collègue peut débloquer un ticket en attente");
    assert.ok(codes(karim, ctx).includes("DESAFFECTER"));
  });

  test("validation : seul le valideur désigné (ou le superviseur) valide ou refuse", { skip: sansValidation }, () => {
    const ctx = enValidation();
    assert.deepEqual(principales(claire, ctx), ["VALIDER", "REFUSER"]);
    assert.ok(codes(isabelle, ctx).includes("VALIDER"));
    assert.ok(!codes(marc, ctx).includes("VALIDER"));
  });

  test("le valideur ne peut ni traiter ni commenter un ticket qui ne lui est pas confié", () => {
    assert.deepEqual(codes(claire, libre()), []);
  });

  test("confirmation : clôturer est attendu de celui qui a résolu", { skip: sansConfirmation }, () => {
    const ctx = aConfirmer();
    assert.deepEqual(principales(marc, ctx), ["CLOTURER", "ROUVRIR"]);
    assert.deepEqual(principales(karim, ctx), [], "pour un collègue, c'est secondaire");
  });

  test("les boutons envoyés au front ne contiennent pas l'appel EV", () => {
    for (const a of M.actionsPossibles(marc, libre()).map(M.versActionPublique)) {
      assert.equal(a.op, undefined);
    }
  });
});

describe("mise en forme pour le front", () => {
  test("priorité : toutes les combinaisons urgence × impact suivent la matrice", () => {
    for (const [urgence, urgenceEV] of Object.entries(cfg.urgenceEV)) {
      for (const [impact, impactEV] of Object.entries(cfg.impactEV)) {
        const ctx = M.analyser(F.ticket(I, STATUT.nouveau, { URGENCY_ID: urgenceEV, SEVERITY_ID: impactEV }), []);
        assert.equal(M.versTicket(ctx, marc).priorite, cfg.matricePriorite[impact][urgence], `urgence ${urgence}, impact ${impact}`);
      }
    }
  });

  test("priorité inconnue (ticket créé dans EV sans urgence) : normale (3)", () => {
    assert.equal(M.versTicket(M.analyser(F.ticket(I, STATUT.nouveau), []), marc).priorite, 3);
  });

  test("en retard : échéance passée et ticket non terminé", () => {
    const passe = F.ilYa(1);
    const ouvert = M.analyser(F.ticket(I, STATUT.enCours, { MAX_RESOLUTION_DATE_UT: passe }), []);
    const resolu = M.analyser(F.ticket(I, STATUT.resolu, { MAX_RESOLUTION_DATE_UT: passe }), []);
    assert.equal(M.versTicket(ouvert, marc).en_retard, true);
    assert.equal(M.versTicket(resolu, marc).en_retard, false);
  });

  test("affectation vue par l'utilisateur : MOI / TIERS / AUCUN", () => {
    assert.equal(M.versTicket(affecteA(empMarc), marc).affectation, "MOI");
    assert.equal(M.versTicket(affecteA(empMarc), karim).affectation, "TIERS");
    assert.equal(M.versTicket(libre(), marc).affectation, "AUCUN");
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

  test("type d'une entrée de catalogue d'après son chemin", () => {
    for (const [debut, type] of Object.entries(cfg.typeDepuisCheminCatalogue)) {
      assert.equal(M.typeDepuisChemin(`${debut}Quelque chose/Feuille`), type);
    }
  });

  test("progression : position de l'étape en cours dans le parcours", () => {
    const { parcours, position } = M.progression(libre());
    assert.equal(parcours[position]?.code, TRAITEMENT.codeNonAffecte);
  });

  test("progression : l'étape « En validation » n'apparaît que si la demande en a une", { skip: sansValidation }, () => {
    const sans = M.analyser(F.ticket(F.demande(1), STATUT.enCours), [F.action(TYPE.traitement)]);
    assert.ok(!M.progression(sans).parcours.some((s) => s.code === "EN_VALIDATION"));
    const avec = M.progression(enValidation());
    assert.equal(avec.parcours[avec.position].code, cfg.typesAction[TYPE.validation].code);
  });

  test("historique : création en premier, trié par date, étape en cours à la fin", () => {
    const ctx = M.analyser(F.ticket(I, STATUT.enCours), [
      F.action(TYPE.traitement, { faitPar: empMarc, fin: F.ilYa(2), debut: F.ilYa(3, -1) }),
      F.action(TYPE.traitement, { groupe: F.GROUPE_INFRA, debut: F.ilYa(2, -1) }),
    ]);
    const h = M.historique(ctx);
    assert.equal(h[0].action, "Création");
    assert.equal(h[1].action, TRAITEMENT.terminer);
    assert.equal(h[2].en_cours, true);
    assert.ok(h[2].action.includes(F.GROUPE_INFRA.GROUP_FR));
  });
});
