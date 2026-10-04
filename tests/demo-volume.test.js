// Tickets de demo generes en nombre (sources/clients/simule/volume.js) :
// scenarios coherents et jeu identique a chaque reset-demo.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../sources/clients/simule/donnees");
const { genererVolume } = require("../sources/clients/simule/volume");

const parLogin = new Map(D.EMPLOYEES.map((e) => [e.IDENTIFICATION, e]));
const tickets = genererVolume(900);

test("reproductible : même jeu à chaque génération", () => {
  assert.deepEqual(genererVolume(900), tickets);
});

test("chaque ticket vise une entrée de catalogue active et un demandeur présent", () => {
  for (const t of tickets) {
    const cat = D.CATALOG.find((c) => c.SD_CATALOG_ID === t.catalogue);
    assert.ok(cat && !cat.END_DATE, `catalogue ${t.catalogue}`);
    const dem = parLogin.get(t.demandeur);
    assert.ok(dem && !dem.DEPARTURE_DATE && !dem.GROUPES.length, `demandeur ${t.demandeur}`);
    assert.ok(t.heures > 0 && t.heures <= 90 * 24 + 1);
  }
});

test("étapes dans l'ordre chronologique, toutes dans le passé", () => {
  for (const t of tickets) {
    let avant = t.heures;
    for (const [op, , h] of t.etapes) {
      assert.ok(h > 0 && h < avant, `${t.titre} : étape ${op} à ${h} h (précédente ${avant} h)`);
      avant = h;
    }
  }
});

test("chaque étape est faite par quelqu'un d'actif et habilité", () => {
  for (const t of tickets) {
    const dem = parLogin.get(t.demandeur);
    let groupe = D.CATALOG.find((c) => c.SD_CATALOG_ID === t.catalogue).GROUP_ID;
    for (const [op, login, , , choix] of t.etapes) {
      const e = parLogin.get(login);
      assert.ok(e && !e.DEPARTURE_DATE, `${op} par ${login}`);
      if (op === "transferer") {
        assert.ok(e.GROUPES.includes(groupe), `transfert par ${login} hors du groupe ${groupe}`);
        groupe = choix;
      } else if (op === "commenter" && login === t.demandeur) {
        // Le demandeur repond ou relance (commentaire saisi dans EV).
      } else if (["prendre", "suspendre", "reprendre", "commenter", "annuler"].includes(op)) {
        assert.ok(e.GROUPES.includes(groupe), `${op} par ${login}, pas membre du groupe ${groupe}`);
      } else if (op === "terminer") {
        // Traitement (intervenant du groupe), validation (manager / supervision) ou confirmation (demandeur).
        const valideur = e.EMPLOYEE_ID === dem.MANAGER_ID || e.GROUPES.includes(D.GROUPE_SUPERVISION);
        assert.ok(e.GROUPES.includes(groupe) || valideur || login === t.demandeur, `terminer par ${login}`);
      } else {
        assert.fail(`opération inconnue : ${op}`);
      }
    }
  }
});

test("volume varié : incidents et demandes, refus, annulations, attentes, transferts", () => {
  const ops = tickets.flatMap((t) => t.etapes.map((e) => e[0]));
  const nb = (op) => ops.filter((o) => o === op).length;
  assert.ok(tickets.some((t) => t.urgence) && tickets.some((t) => !t.urgence), "incidents et demandes");
  for (const op of ["prendre", "terminer", "suspendre", "reprendre", "transferer", "annuler", "commenter"]) {
    assert.ok(nb(op) >= 5, `peu d'étapes « ${op} » (${nb(op)})`);
  }
  assert.ok(tickets.some((t) => t.etapes.some((e) => e[0] === "terminer" && e[4] === "0")), "au moins un refus / une réouverture");
});

test("contenu riche : descriptions et échanges sur plusieurs lignes", () => {
  const multiligne = (s) => /\n|<\/p>\s*<p|<br|<li/.test(s || "");
  const desc = tickets.filter((t) => multiligne(t.description)).length;
  assert.ok(desc > tickets.length * 0.7, `descriptions multilignes : ${desc} / ${tickets.length}`);
  const commentaires = tickets.flatMap((t) => t.etapes.filter((e) => e[3]).map((e) => e[3]));
  assert.ok(commentaires.filter(multiligne).length > commentaires.length * 0.4, "commentaires multilignes");
  // Des échanges : un message du demandeur entre deux messages d'intervenant.
  const echanges = tickets.filter((t) => {
    const auteurs = t.etapes.filter((e) => e[0] === "commenter").map((e) => e[1] === t.demandeur);
    return auteurs.some((d, i) => i > 0 && d && !auteurs[i - 1]);
  });
  assert.ok(echanges.length > tickets.length * 0.15, `échanges : ${echanges.length}`);
});
