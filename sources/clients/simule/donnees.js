// donnees.js — parametrage du FAUX EasyVista (clients/simule).
//
// Imite ce qu'une instance EV contient : localisations, employes, groupes,
// catalogue, statuts, types d'action. Le portail n'y accede jamais
// directement : il passe par l'API simulee, comme il passera par la vraie.
//
// Etablissements : groupe fictif de cliniques privees ("Groupe Exemple"), noms
// et villes inventes. Dans la vraie integration, la liste vient des localisations EV.
// Les personnes sont fictives.

const ETABLISSEMENTS = [
  // [nom, ville, type]
  ["Polyclinique du Parc", "Valmont", "MCO"],
  ["Clinique des Tilleuls", "Valmont", "MCO"],
  ["Clinique de l'Europe", "Valmont", "Médecine-Chirurgie"],
  ["Clinique Saint-Michel", "Beaulieu", "Médecine-Chirurgie"],
  ["Clinique du Lac", "Beaulieu", "Médecine-Chirurgie"],
  ["Clinique Les Cèdres", "Saint-Aubin", "SMR"],
  ["Clinique La Roseraie", "Valmont", "SMR"],
  ["Clinique Beausoleil", "Valmont", "SMR"],
  ["Clinique Les Pins", "Montclar", "SMR"],
  ["Clinique Les Jardins du Val", "", "Soins de longue durée"],
  ["Clinique Les Sources", "Belcastel", "Psychiatrie"],
  ["Clinique La Colline", "Port-Marin", "Psychiatrie"],
  ["Clinique Saint-Jean", "Fontaine", "Psychiatrie"],
  ["Clinique Le Moulin", "Montclar", "Psychiatrie"],
  ["Résidence Les Acacias", "Port-Marin", "EHPAD"],
  ["Résidence Les Hortensias", "Valmont", "EHPAD"],
  ["Résidence Les Magnolias", "Belcastel", "EHPAD"],
  ["Résidence Les Charmilles", "Saint-Aubin", "EHPAD"],
  ["Résidence La Pinède", "Fontaine", "EHPAD"],
  ["Résidence Le Clos Fleuri", "Beaulieu", "EHPAD"],
  ["Résidence La Bastide", "Port-Marin", "EHPAD"],
  ["Résidence Notre-Dame des Prés", "Saint-Aubin", "EHPAD"],
  ["Exemple Santé à Domicile", "Valmont", "HAD"],
  ["Les Terrasses des Hortensias", "Valmont", "Résidence seniors"],
  ["Les Terrasses des Prés", "Saint-Aubin", "Résidence seniors"],
  ["Exemple Services", "", "Services à la personne"],
  ["Centre Médical du Parc", "Valmont", "Centre médical"],
  ["Centre Médical de la Gare", "Valmont", "Centre médical"],
  ["Siège Groupe Exemple", "Valmont", "Siège"],
];

const LOCATIONS = ETABLISSEMENTS.map(([nom, ville, type], i) => ({
  LOCATION_ID: i + 1,
  LOCATION_FR: nom,
  CITY: ville,
  LOCATION_PATH: `${type}/${nom}`,
}));
const L = Object.fromEntries(LOCATIONS.map((l) => [l.LOCATION_FR, l.LOCATION_ID]));

// Groupes EV. Les deux derniers ne traitent pas de tickets :
// "Supervision support" donne le profil superviseur, "Cadres valideurs" le profil valideur.
const GROUPS = [
  { GROUP_ID: 1, GROUP_FR: "Service Desk (N1)" },
  { GROUP_ID: 2, GROUP_FR: "Infra systèmes & réseaux (N2)" },
  { GROUP_ID: 3, GROUP_FR: "Téléphonie" },
  { GROUP_ID: 4, GROUP_FR: "Applications métier" },
  { GROUP_ID: 5, GROUP_FR: "DPI" },
  { GROUP_ID: 6, GROUP_FR: "Projets ITO" },
  { GROUP_ID: 7, GROUP_FR: "BI & Data" },
  { GROUP_ID: 8, GROUP_FR: "SIRH (RH / paie)" },
  { GROUP_ID: 9, GROUP_FR: "Sécurité SI" },
  { GROUP_ID: 10, GROUP_FR: "Biomédical & équipements connectés" },
  { GROUP_ID: 11, GROUP_FR: "Logistique IT (matériel)" },
  { GROUP_ID: 90, GROUP_FR: "Supervision support" },
  { GROUP_ID: 91, GROUP_FR: "Cadres valideurs" },
];
const GROUPE_SUPERVISION = 90;
const GROUPE_VALIDEURS = 91;

// Employes EV : LAST_NAME au format "Nom, Prenom". GROUPES = appartenance aux groupes EV.
// MANAGER_ID sert au workflow de validation.
const PERSONNES = [
  // Equipes support
  ["mdubois", "Dubois, Marc", "Technicien Service Desk", "Siège Groupe Exemple", [1]],
  ["kbenali", "Benali, Karim", "Technicien Service Desk", "Siège Groupe Exemple", [1]],
  ["nhaddad", "Haddad, Nadia", "Ingénieure systèmes et réseaux", "Siège Groupe Exemple", [2, 1]],
  ["jlefevre", "Lefèvre, Julie", "Technicienne téléphonie", "Siège Groupe Exemple", [3]],
  ["tpetit", "Petit, Thomas", "Référent applications métier", "Polyclinique du Parc", [4]],
  ["cgirard", "Girard, Camille", "Référente DPI", "Clinique des Tilleuls", [5, 4]],
  ["hlambert", "Lambert, Hugo", "Chef de projet ITO", "Siège Groupe Exemple", [6]],
  ["lmoreau", "Moreau, Léa", "Cheffe de projet BI", "Siège Groupe Exemple", [7, 6]],
  ["sblanc", "Blanc, Sandrine", "Chargée SIRH", "Siège Groupe Exemple", [8]],
  ["ymercier", "Mercier, Yanis", "Responsable sécurité SI", "Siège Groupe Exemple", [9]],
  ["pfabre", "Fabre, Paul", "Ingénieur biomédical", "Clinique de l'Europe", [10]],
  ["evidal", "Vidal, Élodie", "Gestionnaire logistique IT", "Siège Groupe Exemple", [11]],
  ["igarnier", "Garnier, Isabelle", "Responsable support IT", "Siège Groupe Exemple", [90]],
  // Cadres valideurs
  ["cmartin", "Martin, Claire", "Cadre de santé", "Polyclinique du Parc", [91]],
  ["proche", "Roche, Philippe", "Directeur d'établissement", "Clinique Les Sources", [91]],
  ["mleroy", "Leroy, Martine", "Directrice d'EHPAD", "Résidence Les Hortensias", [91]],
  // Demandeurs (pas d'acces au portail)
  ["jroux", "Roux, Julien", "Secrétaire médical", "Polyclinique du Parc", [], "cmartin"],
  ["sbernard", "Bernard, Sophie", "Médecin", "Clinique des Tilleuls", [], null],
  ["nfaure", "Faure, Nicolas", "Infirmier", "Clinique Les Sources", [], "proche"],
  ["arobert", "Robert, Anne", "Assistante RH", "Résidence Les Hortensias", [], "mleroy"],
  ["bgarcia", "Garcia, Benoît", "Kinésithérapeute", "Clinique Les Cèdres", [], null],
];

const EMPLOYEES = PERSONNES.map(([login, nom, fonction, site, groupes, manager], i) => ({
  EMPLOYEE_ID: i + 1,
  LAST_NAME: nom,
  IDENTIFICATION: login,
  E_MAIL: `${login}@exemple.test`,
  JOB_TITLE: fonction,
  LOCATION_ID: L[site],
  GROUPES: groupes,
  MANAGER_LOGIN: manager || null,
}));
for (const e of EMPLOYEES) {
  e.MANAGER_ID = e.MANAGER_LOGIN ? EMPLOYEES.find((x) => x.IDENTIFICATION === e.MANAGER_LOGIN).EMPLOYEE_ID : null;
}
for (const g of GROUPS) g.MEMBERS = EMPLOYEES.filter((e) => e.GROUPES.includes(g.GROUP_ID)).map((e) => e.EMPLOYEE_ID);

const guid = (n) => `{00000000-0000-0000-0000-${String(n).padStart(12, "0")}}`;
const STATUSES = ["Nouveau", "En cours", "En attente de validation", "Suspendu", "Résolu", "Clôturé", "Refusé", "Annulé"].map(
  (s, i) => ({ STATUS_ID: i + 1, STATUS_GUID: guid(i + 1), STATUS_FR: s })
);
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

// Catalogue : [id, titre, chemin, groupe, validation]. Le chemin commence par "Incidents/" ou "Demandes/".
const CATALOG = [
  [101, "Messagerie (Outlook / MDaemon)", "Incidents/Infrastructure/Messagerie", 1],
  [102, "PC, écran ou périphérique en panne", "Incidents/Infrastructure/Poste de travail", 1],
  [103, "Imprimante", "Incidents/Infrastructure/Poste de travail", 1],
  [104, "Wifi, VPN ou réseau", "Incidents/Infrastructure/Réseau", 2],
  [105, "Téléphone fixe, DECT ou mobile pro", "Incidents/Téléphonie", 3],
  [106, "Application inaccessible pour tout un service", "Incidents/Infrastructure/Serveurs", 2],
  [107, "Mot de passe ou compte bloqué", "Incidents/Infrastructure/Comptes", 1],
  [108, "Dossier Patient Informatisé (DPI)", "Incidents/Métier/DPI", 5],
  [109, "Logiciel bloc opératoire", "Incidents/Métier/Logiciels spécifiques", 4],
  [110, "Logiciel pharmacie", "Incidents/Métier/Logiciels spécifiques", 4],
  [111, "Logiciel paie / planning RH", "Incidents/SIRH", 8],
  [112, "Données non transmises entre deux logiciels", "Incidents/Métier/Interfaces", 4],
  [113, "Chiffres faux dans un rapport", "Incidents/BI/Qualité des données", 7],
  [114, "Équipement biomédical connecté", "Incidents/Biomédical", 10],
  [115, "Mail suspect, virus ou hameçonnage", "Incidents/Sécurité", 9],
  [116, "Autre / à qualifier", "Incidents/Support/À qualifier", 1],
  [201, "Installer un logiciel standard (Office, PDF…)", "Demandes/Infrastructure/Poste de travail", 1, false],
  [202, "Nouveau matériel (PC, écran, périphérique)", "Demandes/Logistique/Matériel", 11, true],
  [203, "Créer ou supprimer un compte utilisateur", "Demandes/Infrastructure/Comptes", 1, true],
  [204, "Accès à un logiciel métier", "Demandes/Métier/Habilitations", 4, true],
  [205, "Paramétrage du DPI", "Demandes/Métier/DPI", 5, true],
  [206, "Formation à un logiciel", "Demandes/Métier/Formation", 4, false],
  [207, "Nouveau rapport ou tableau de bord", "Demandes/BI/Reporting", 7, true],
  [208, "Extraction de données", "Demandes/BI/Données", 7, true],
  [209, "Nouveau projet ou nouveau logiciel", "Demandes/Projets/Nouveau projet", 6, true],
  [210, "Montée de version ou migration", "Demandes/Projets/Évolution", 6, true],
  [211, "Arrivée ou départ d'un collaborateur", "Demandes/SIRH/Mouvements", 8, true],
  [212, "Nouvelle ligne ou nouveau poste téléphonique", "Demandes/Téléphonie", 3, true],
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
  GROUPE_VALIDEURS,
  STATUSES,
  S,
  ACTION_TYPES,
  T,
  CATALOG,
  PRIORITE,
  DELAI_HEURES,
};
