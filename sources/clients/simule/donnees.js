// donnees.js — parametrage du FAUX EasyVista (clients/simule).
//
// Imite ce qu'une instance EV contient : employes, groupes, localisations,
// catalogue, statuts, types d'action et workflows. Tout est fictif.
// Le portail n'y accede jamais directement : il passe par l'API simulee,
// exactement comme il passera par la vraie API.

const LOCATIONS = Array.from({ length: 25 }, (_, i) => ({
  LOCATION_ID: i + 1,
  LOCATION_FR: `Etablissement ${String(i + 1).padStart(2, "0")}`,
}));

// LAST_NAME au format EV "Nom, Prenom". MANAGER_ID sert au workflow de validation.
const EMPLOYEES = [
  { EMPLOYEE_ID: 1, LAST_NAME: "Martin, Claire", IDENTIFICATION: "cmartin", JOB_TITLE: "Cadre de santé", LOCATION_ID: 1, MANAGER_ID: null },
  { EMPLOYEE_ID: 2, LAST_NAME: "Roux, Julien", IDENTIFICATION: "jroux", JOB_TITLE: "Secrétaire médical", LOCATION_ID: 1, MANAGER_ID: 1 },
  { EMPLOYEE_ID: 3, LAST_NAME: "Bernard, Sophie", IDENTIFICATION: "sbernard", JOB_TITLE: "Médecin", LOCATION_ID: 3, MANAGER_ID: null },
  { EMPLOYEE_ID: 4, LAST_NAME: "Dubois, Marc", IDENTIFICATION: "mdubois", JOB_TITLE: "Technicien support", LOCATION_ID: 1, MANAGER_ID: 8 },
  { EMPLOYEE_ID: 5, LAST_NAME: "Haddad, Nadia", IDENTIFICATION: "nhaddad", JOB_TITLE: "Ingénieure systèmes et réseaux", LOCATION_ID: 1, MANAGER_ID: 8 },
  { EMPLOYEE_ID: 6, LAST_NAME: "Petit, Thomas", IDENTIFICATION: "tpetit", JOB_TITLE: "Référent applications métier", LOCATION_ID: 2, MANAGER_ID: 8 },
  { EMPLOYEE_ID: 7, LAST_NAME: "Moreau, Léa", IDENTIFICATION: "lmoreau", JOB_TITLE: "Cheffe de projet BI", LOCATION_ID: 1, MANAGER_ID: 8 },
  { EMPLOYEE_ID: 8, LAST_NAME: "Garnier, Isabelle", IDENTIFICATION: "igarnier", JOB_TITLE: "Responsable support IT", LOCATION_ID: 1, MANAGER_ID: null },
].map((e) => ({ ...e, E_MAIL: `${e.IDENTIFICATION}@exemple.test` }));

// Groupes EV et leurs membres. "Supervision support" ne traite pas de
// tickets : c'est le groupe qui donne le profil superviseur dans le portail.
const GROUPS = [
  { GROUP_ID: 1, GROUP_FR: "Support Infra N1", MEMBERS: [4, 5] },
  { GROUP_ID: 2, GROUP_FR: "Support Infra N2", MEMBERS: [5] },
  { GROUP_ID: 3, GROUP_FR: "Applications métier", MEMBERS: [6] },
  { GROUP_ID: 4, GROUP_FR: "Projets ITO", MEMBERS: [7] },
  { GROUP_ID: 5, GROUP_FR: "BI & Data", MEMBERS: [7] },
  { GROUP_ID: 9, GROUP_FR: "Supervision support", MEMBERS: [8] },
];
const GROUPE_SUPERVISION = 9;

const guid = (n) => `{00000000-0000-0000-0000-${String(n).padStart(12, "0")}}`;
const STATUSES = [
  "Nouveau",
  "En cours",
  "En attente de validation",
  "Suspendu",
  "Résolu",
  "Clôturé",
  "Refusé",
  "Annulé",
].map((s, i) => ({ STATUS_ID: i + 1, STATUS_GUID: guid(i + 1), STATUS_FR: s }));
const S = Object.fromEntries(STATUSES.map((s) => [s.STATUS_FR, s.STATUS_ID]));

const ACTION_TYPES = [
  "Traitement incident",
  "Réalisation demande",
  "Validation hiérarchique",
  "Confirmation demandeur",
  "Commentaire",
  "Suspension",
  "Reprise",
  "Clôture",
].map((n, i) => ({ ACTION_TYPE_ID: i + 1, NAME_FR: n }));
const T = Object.fromEntries(ACTION_TYPES.map((t) => [t.NAME_FR, t.ACTION_TYPE_ID]));

// Catalogue : le chemin commence par "Incidents/" ou "Demandes/".
// GROUP_ID et VALIDATION sont le parametrage du workflow dans ce faux EV.
const CATALOG = [
  [101, "Messagerie (Outlook / MDaemon)", "Incidents/Infrastructure/Messagerie", 1],
  [102, "PC, écran ou périphérique en panne", "Incidents/Infrastructure/Poste de travail", 1],
  [103, "Imprimante", "Incidents/Infrastructure/Poste de travail", 1],
  [104, "Wifi, VPN ou réseau", "Incidents/Infrastructure/Réseau", 2],
  [105, "Téléphone fixe ou mobile pro", "Incidents/Infrastructure/Téléphonie", 1],
  [106, "Application inaccessible pour tout un service", "Incidents/Infrastructure/Serveurs", 2],
  [107, "Mot de passe ou compte bloqué", "Incidents/Infrastructure/Comptes", 1],
  [108, "Dossier Patient Informatisé (DPI)", "Incidents/Métier/DPI", 3],
  [109, "Logiciel bloc opératoire", "Incidents/Métier/Logiciels spécifiques", 3],
  [110, "Logiciel pharmacie", "Incidents/Métier/Logiciels spécifiques", 3],
  [111, "Logiciel paie / RH", "Incidents/Métier/Logiciels spécifiques", 3],
  [112, "Données non transmises entre deux logiciels", "Incidents/Métier/Interfaces", 3],
  [113, "Chiffres faux dans un rapport", "Incidents/BI/Qualité des données", 5],
  [114, "Autre / je ne sais pas", "Incidents/Support/À qualifier", 1],
  [201, "Installer un logiciel standard (Office, PDF…)", "Demandes/Infrastructure/Poste de travail", 1, false],
  [202, "Nouveau matériel (PC, écran, téléphone)", "Demandes/Infrastructure/Matériel", 1, true],
  [203, "Créer ou supprimer un compte utilisateur", "Demandes/Infrastructure/Comptes", 1, true],
  [204, "Accès à un logiciel métier", "Demandes/Métier/Habilitations", 3, true],
  [205, "Paramétrage du DPI", "Demandes/Métier/DPI", 3, true],
  [206, "Formation à un logiciel", "Demandes/Métier/Formation", 3, false],
  [207, "Nouveau rapport ou tableau de bord", "Demandes/BI/Reporting", 5, true],
  [208, "Extraction de données", "Demandes/BI/Données", 5, true],
  [209, "Nouveau projet ou nouveau logiciel", "Demandes/Projets/Nouveau projet", 4, true],
  [210, "Montée de version ou migration", "Demandes/Projets/Évolution", 4, true],
].map(([id, titre, chemin, groupe, validation = false]) => ({
  SD_CATALOG_ID: id,
  CODE: String(id),
  TITLE_FR: titre,
  CATALOG_REQUEST_PATH: `${chemin}/${titre}`,
  GROUP_ID: groupe,
  VALIDATION: validation,
}));

// Urgence et impact (severity) EV : ids 1 = le plus fort.
//   urgence : 1 = haute (bloque), 3 = basse
//   impact  : 1 = etablissement, 2 = service, 3 = une personne
const PRIORITE = { 1: { 1: 1, 3: 2 }, 2: { 1: 2, 3: 3 }, 3: { 1: 3, 3: 4 } }; // [impact][urgence]
const DELAI_HEURES = { 1: 4, 2: 8, 3: 72, 4: 120 };

module.exports = {
  LOCATIONS,
  EMPLOYEES,
  GROUPS,
  GROUPE_SUPERVISION,
  STATUSES,
  S,
  ACTION_TYPES,
  T,
  CATALOG,
  PRIORITE,
  DELAI_HEURES,
};
