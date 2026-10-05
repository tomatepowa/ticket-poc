// npm run explorer-ev : explore une VRAIE instance EasyVista, en lecture seule.
//
// Lit la structure (statuts, groupes, types d'action, catalogue, localisations)
// et quelques tickets, puis la compare a sources/portail/correspondance.js.
// Sert a adapter le portail a votre parametrage et a lever les « A VERIFIER ».
//
// Configuration : EV_URL, EV_ACCOUNT, EV_TOKEN dans .env (un jeton personnel
// suffit pour lire). Aucune ecriture possible : EV_LECTURE_SEULE est force.
//
// Resultats dans data/exploration-ev/ (ignore par git) :
//   rapport.md  structure seule (libelles, champs, compteurs) : sans contenu de
//               ticket ni nom de personne, partageable pour adapter le portail ;
//   brut/       reponses JSON completes : DONNEES REELLES, a garder sur ce poste.

const fs = require("fs");
const path = require("path");

const fichierEnv = path.join(__dirname, "..", ".env");
if (fs.existsSync(fichierEnv)) process.loadEnvFile(fichierEnv);
process.env.EV_LECTURE_SEULE = "1";

const correspondance = require("../sources/portail/correspondance");
const NB_TICKETS = Number(process.env.EXPLORER_TICKETS) || 5;
const dossier = path.join(__dirname, "..", "data", "exploration-ev");
const brut = path.join(dossier, "brut");

let ev;
try {
  ev = require("../sources/clients/http");
} catch (err) {
  console.error(`${err.message}\nRenseigner EV_URL, EV_ACCOUNT et EV_TOKEN dans .env (voir .env.exemple).`);
  process.exit(1);
}

const lignes = [];
const ecrire = (s = "") => lignes.push(s);

// Appel d'une route : enregistre la reponse brute, note l'echec sans s'arreter.
async function lire(nom, appel) {
  try {
    const r = await appel();
    fs.writeFileSync(path.join(brut, `${nom}.json`), JSON.stringify(r, null, 2));
    console.log(`  ok   ${nom}`);
    return r;
  } catch (err) {
    console.log(`  ECHEC ${nom} : ${err.message}`);
    ecrire(`- **${nom}** : échec (${err.status || "?"}) ${err.message}`);
    return null;
  }
}

// Noms des champs d'un enregistrement, sous-objets compris (STATUS.STATUS_FR...).
function champs(rec, prefixe = "") {
  if (!rec || typeof rec !== "object") return [];
  return Object.entries(rec).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? [`${prefixe}${k}`, ...champs(v, `${prefixe}${k}.`)] : [`${prefixe}${k}`]
  );
}
function unionChamps(records) {
  return [...new Set(records.flatMap((r) => champs(r)))].sort();
}

// Identifiants et libelles d'un referentiel (jamais de donnees de personnes ici).
const CLE_UTILE = /(_ID|_GUID|_FR|_EN|NAME|CODE|PATH|END_DATE)$/;
function resume(rec) {
  return Object.entries(rec || {})
    .filter(([k, v]) => CLE_UTILE.test(k) && v != null && typeof v !== "object")
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
}

function section(titre, records, { liste = true } = {}) {
  ecrire(`\n## ${titre} (${records.length})\n`);
  ecrire(`Champs : \`${unionChamps(records).join("`, `") || "aucun"}\`\n`);
  if (liste) records.forEach((r) => ecrire(`- ${resume(r)}`));
}

function absents(titre, trouves, connus) {
  const manquants = [...trouves].filter((x) => x && !connus.includes(x)).sort();
  ecrire(`\n### ${titre}\n`);
  ecrire(manquants.length ? manquants.map((x) => `- ${x}`).join("\n") : "Aucun : tout est connu de correspondance.js.");
}

(async () => {
  fs.mkdirSync(brut, { recursive: true });
  console.log(`Exploration (lecture seule) de ${process.env.EV_URL}, compte ${process.env.EV_ACCOUNT}`);
  ecrire("# Exploration EasyVista (lecture seule)\n");
  ecrire(`Date : ${new Date().toLocaleString("fr-FR")}. Visible avec les droits du jeton utilisé.\n`);
  ecrire("## Échecs\n");
  const debutEchecs = lignes.length;

  const statuts = (await lire("status", () => ev.getStatuses()))?.records || [];
  const groupes = (await lire("groups", () => ev.getGroups()))?.records || [];
  const locations = (await lire("locations", () => ev.getLocations()))?.records || [];
  const catalogue = (await lire("catalog-requests", () => ev.getCatalog()))?.records || [];
  const employes = (await lire("employees", () => ev.getEmployees({ max_rows: 5 })))?.records || [];
  const tickets = (await lire("requests", () => ev.getRequests({ sort: "last_update+desc", max_rows: NB_TICKETS })))?.records || [];
  await lire("requests-pagination", () => ev.getRequests({ sort: "last_update+desc", max_rows: 2, offset: 2 }));
  const enCours = (await lire("actions-en-cours", () => ev.getActions({ search: 'end_date_ut:"is_null"', max_rows: 500 })))?.records || [];

  const actions = [];
  for (const t of tickets) {
    const rfc = t.RFC_NUMBER;
    if (!rfc) continue;
    await lire(`ticket-${rfc}`, () => ev.getRequest(rfc));
    actions.push(...((await lire(`actions-${rfc}`, () => ev.getActions({ search: `request.rfc_number:"${rfc}"`, max_rows: 500 })))?.records || []));
    await lire(`documents-${rfc}`, () => ev.getDocuments(rfc));
    if (t.REQUEST_ID) await lire(`reponses-${rfc}`, () => ev.getQuestionResults(t.REQUEST_ID));
  }
  const avecQuestionnaire = catalogue.find((c) => c[correspondance.champQuestionnaireCatalogue]);
  if (avecQuestionnaire) {
    const id = avecQuestionnaire[correspondance.champQuestionnaireCatalogue];
    await lire(`questionnaire-${id}`, () => ev.getQuestionnaire(id));
  }
  if (lignes.length === debutEchecs) ecrire("Aucun.");

  section("Statuts", statuts);
  section("Groupes", groupes);
  section("Localisations (établissements)", locations);
  section("Catalogue", catalogue);
  section("Employés (5 premiers, champs seulement)", employes, { liste: false });
  section(`Tickets (${NB_TICKETS} derniers modifiés, champs seulement)`, tickets, { liste: false });
  const toutes = [...actions, ...enCours];
  section("Actions (champs seulement)", toutes, { liste: false });

  const typesAction = new Map();
  toutes.forEach((a) => {
    const nom = a.ACTION_TYPE?.NAME_FR || a.ACTION_TYPE?.NAME_EN;
    if (nom) typesAction.set(nom, a.ACTION_TYPE?.ACTION_TYPE_ID ?? a.ACTION_TYPE_ID);
  });
  ecrire(`\n## Types d'action rencontrés (${typesAction.size})\n`);
  [...typesAction].sort().forEach(([nom, id]) => ecrire(`- ${nom} (id ${id ?? "?"})`));

  const prefixes = new Set(tickets.map((t) => /^[A-Z]+/.exec(t.RFC_NUMBER || "")?.[0]).filter(Boolean));
  ecrire(`\n## Préfixes de numéro de ticket\n\n${[...prefixes].join(", ") || "aucun"}`);

  ecrire("\n## Écarts avec correspondance.js\n");
  absents("Statuts inconnus", statuts.map((s) => s.STATUS_FR || s.STATUS_EN), Object.keys(correspondance.statuts));
  absents("Types d'action inconnus", typesAction.keys(), [
    ...Object.keys(correspondance.typesAction),
    ...correspondance.typesActionHorsWorkflow,
  ]);
  absents("Préfixes de numéro inconnus", prefixes, Object.keys(correspondance.typeDepuisNumero));
  const nomsGroupes = groupes.map((g) => g.GROUP_FR || g.GROUP_EN);
  const profils = [...correspondance.groupesSuperviseurs, ...correspondance.groupesValideurs];
  ecrire("\n### Groupes de profils (superviseurs, valideurs) absents d'EV\n");
  const sansGroupe = profils.filter((g) => !nomsGroupes.includes(g));
  ecrire(sansGroupe.length ? sansGroupe.map((g) => `- ${g}`).join("\n") : "Aucun.");

  fs.writeFileSync(path.join(dossier, "rapport.md"), lignes.join("\n") + "\n");
  console.log(`\nRapport : ${path.relative(process.cwd(), path.join(dossier, "rapport.md"))}`);
  console.log(`Réponses brutes (données réelles, ne pas diffuser) : ${path.relative(process.cwd(), brut)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
