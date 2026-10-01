// volume.js — tickets de demonstration EN NOMBRE pour le faux EasyVista.
//
// En plus des tickets ecrits a la main (demo.js), genere DEMO_TICKETS tickets
// (1300 par defaut) sur les 90 derniers jours, au meme format que demo.js : ils
// passent par le workflow du faux EV comme de vrais tickets.
//
// Pour chaque ticket, on tire un scenario complet (prise en charge, attente,
// transfert, resolution, confirmation ou reouverture, validation ou refus,
// annulation...) avec des delais realistes ; les etapes qui tomberaient dans le
// futur ne sont pas jouees. Les tickets anciens sont donc presque tous clos et
// les recents encore en cours, naturellement.
// Tirage pseudo-aleatoire a graine fixe : meme jeu a chaque `npm run reset-demo`.

const D = require("./donnees");

const NB_TICKETS = Number(process.env.DEMO_TICKETS ?? 1300);
const JOURS = 90;

// ---------- Hasard reproductible ----------

function generateur(graine) {
  let s = graine >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entre = (min, max) => min + r() * (max - min);
  const choix = (liste) => liste[Math.floor(r() * liste.length)];
  // { valeur: poids }
  const pondere = (poids) => {
    const entrees = Object.entries(poids);
    let x = r() * entrees.reduce((s, [, p]) => s + p, 0);
    for (const [v, p] of entrees) if ((x -= p) < 0) return v;
    return entrees[entrees.length - 1][0];
  };
  return { r, entre, choix, pondere, proba: (p) => r() < p };
}

// ---------- Contenu des tickets, par entree de catalogue ----------
// [titre, description]

const SUJETS = {
  101: [
    ["Outlook ne s'ouvre plus", "Message « impossible de démarrer Outlook » à chaque ouverture."],
    ["Mails bloqués dans la boîte d'envoi", "Les messages restent dans la boîte d'envoi depuis ce matin."],
    ["Boîte partagée du service inaccessible", "La boîte du secrétariat n'apparaît plus dans Outlook."],
    ["Calendrier partagé non synchronisé", "Les rendez-vous saisis par les collègues n'apparaissent pas."],
    ["Pièces jointes impossibles à ouvrir", "Erreur à l'ouverture des PDF reçus par mail."],
  ],
  102: [
    ["PC très lent au démarrage", "Plus de 10 minutes pour ouvrir la session."],
    ["Écran qui clignote", "L'écran du poste de soins clignote par intermittence."],
    ["Clavier qui ne répond plus", "Certaines touches ne fonctionnent plus."],
    ["PC qui redémarre tout seul", "Redémarrages plusieurs fois par jour, perte du travail en cours."],
    ["Lecteur de carte Vitale non reconnu", "Le lecteur n'est plus détecté au poste d'accueil."],
    ["Douchette code-barres inopérante", "Impossible de scanner les bracelets patients."],
  ],
  103: [
    ["Imprimante hors ligne", "L'imprimante du service apparaît hors ligne sur tous les postes."],
    ["Impressions bloquées en file d'attente", "Les documents restent en attente sans sortir."],
    ["Étiquettes patients impossibles à imprimer", "L'imprimante d'étiquettes ne répond plus."],
    ["Scan vers mail ne fonctionne plus", "Le copieur n'envoie plus les numérisations."],
    ["Toner vide non détecté", "Impressions très pâles malgré un toner neuf."],
  ],
  104: [
    ["Pas d'accès internet dans le service", "Aucun site ne s'ouvre, le réseau interne fonctionne."],
    ["VPN impossible depuis le domicile", "Connexion VPN refusée, erreur d'authentification."],
    ["Wifi indisponible en chambres", "Les patients et le personnel n'ont plus de wifi au 1er étage."],
    ["Prise réseau inactive", "Prise murale du bureau sans connexion."],
    ["Coupures réseau intermittentes", "Déconnexions de quelques secondes plusieurs fois par heure."],
  ],
  105: [
    ["DECT sans réseau", "Le DECT affiche « hors couverture » dans tout le service."],
    ["Pas de tonalité sur le poste fixe", "Poste du bureau infirmier sans tonalité."],
    ["Messagerie vocale inaccessible", "Code refusé à l'accès à la messagerie vocale."],
    ["Mobile pro ne reçoit plus les appels", "Appels directement basculés sur messagerie."],
  ],
  106: [
    ["Intranet inaccessible", "Page d'erreur pour tous les agents de l'établissement."],
    ["Lecteur réseau partagé indisponible", "Le lecteur S: n'est plus accessible au service."],
    ["Logiciel de rendez-vous inaccessible", "Tout le secrétariat est bloqué."],
  ],
  107: [
    ["Compte Windows verrouillé", "Compte bloqué après plusieurs essais."],
    ["Mot de passe expiré", "Impossible de changer le mot de passe à l'ouverture de session."],
    ["Compte DPI bloqué", "Accès DPI refusé après changement de mot de passe."],
    ["Téléphone d'authentification perdu", "Plus de code de double authentification."],
  ],
  108: [
    ["DPI : prescription impossible à valider", "Le bouton de validation reste grisé."],
    ["DPI : lenteurs à l'ouverture des dossiers", "Plus d'une minute par dossier patient."],
    ["DPI : résultats de laboratoire non affichés", "Les résultats du jour n'apparaissent pas."],
    ["DPI : erreur à l'impression du dossier de soins", "Message d'erreur à chaque impression."],
    ["DPI : plan de soins vide", "Le plan de soins de l'unité ne s'affiche plus."],
  ],
  109: [
    ["Programme opératoire non mis à jour", "Les modifications de la veille n'apparaissent pas."],
    ["Logiciel bloc : saisie des temps impossible", "Erreur à l'enregistrement des horaires d'intervention."],
  ],
  110: [
    ["Logiciel pharmacie : stock erroné", "Les quantités ne correspondent plus à l'inventaire."],
    ["Dispensation nominative bloquée", "Impossible de valider les dispensations du jour."],
  ],
  111: [
    ["Planning : heures supplémentaires non comptées", "Les heures sup du mois dernier n'apparaissent pas."],
    ["Bulletin de paie illisible dans le portail RH", "PDF vide au téléchargement."],
    ["Badgeuse : pointages absents du planning", "Les pointages de la semaine sont manquants."],
  ],
  112: [
    ["Résultats de labo non transmis au DPI", "Interface laboratoire en erreur depuis la nuit."],
    ["Admissions non remontées en facturation", "Les admissions du jour manquent dans le logiciel de facturation."],
    ["Comptes rendus d'imagerie absents du DPI", "Les comptes rendus de radiologie n'arrivent plus."],
  ],
  113: [
    ["Taux d'occupation faux dans le rapport mensuel", "Écart important avec les chiffres du service."],
    ["Tableau de bord des urgences non actualisé", "Données figées à la semaine dernière."],
    ["Doublons dans l'export des séjours", "Certains séjours apparaissent deux fois."],
  ],
  114: [
    ["Moniteur de surveillance déconnecté", "Le moniteur n'envoie plus les constantes à la centrale."],
    ["Pompe à perfusion : alarme de communication", "Alarme réseau répétée sur plusieurs pompes."],
    ["ECG : examens non transférés", "Les ECG restent sur l'appareil."],
  ],
  115: [
    ["Mail d'hameçonnage reçu", "Mail se faisant passer pour la direction, demandant un virement."],
    ["Clic sur un lien suspect", "Un agent a saisi son mot de passe sur une page inconnue."],
    ["Alerte antivirus sur un poste", "L'antivirus signale une menace mise en quarantaine."],
    ["Clé USB inconnue trouvée dans le service", "Clé trouvée dans la salle de pause."],
  ],
  116: [
    ["Message d'erreur inconnu au démarrage", "Fenêtre d'erreur à chaque ouverture de session."],
    ["Demande de rappel du support", "Souhaite être rappelé, problème difficile à décrire."],
    ["Problème sur le poste de l'accueil", "Le poste se fige régulièrement."],
  ],
  201: [
    ["Installer Adobe Acrobat Reader", "Pour ouvrir les documents des fournisseurs."],
    ["Installer Office sur un poste partagé", "Poste partagé de la salle de réunion."],
    ["Installer un lecteur de PDF sur le poste d'accueil", ""],
  ],
  203: [
    ["Créer un compte pour un intérimaire", "Mission de trois semaines dans le service."],
    ["Supprimer le compte d'un agent parti", "Départ en fin de mois."],
    ["Compte temporaire pour un stagiaire", "Stage de deux mois."],
  ],
  204: [
    ["Accès au logiciel de planning", "Nouvelle référente planning du service."],
    ["Accès en lecture au logiciel pharmacie", "Pour le suivi des commandes du service."],
    ["Habilitation DPI pour un nouvel infirmier", "Prise de poste lundi."],
  ],
  205: [
    ["Ajouter un protocole de soins dans le DPI", "Nouveau protocole validé par la CME."],
    ["Modifier un modèle de courrier de sortie", "Ajout des coordonnées du service."],
  ],
  206: [
    ["Formation DPI pour une nouvelle équipe", "Quatre infirmiers arrivent le mois prochain."],
    ["Formation Excel pour les secrétaires", "Niveau débutant, demi-journée."],
  ],
  207: [
    ["Tableau de bord des délais de prise en charge", "Suivi mensuel par service."],
    ["Rapport mensuel des consultations", "Par praticien et par type de consultation."],
  ],
  208: [
    ["Extraction des séjours de l'année", "Pour le rapport d'activité."],
    ["Liste des patients de plus de 75 ans hospitalisés", "Pour l'enquête régionale."],
  ],
  209: [
    ["Logiciel de gestion des chambres", "Suivi du bionettoyage et des disponibilités."],
    ["Dématérialisation des bons de transport", "Projet avec les ambulanciers partenaires."],
  ],
  210: [
    ["Montée de version du logiciel de bloc", "Nouvelle version imposée par l'éditeur."],
    ["Migration de la messagerie du service", "Passage sur la messagerie du groupe."],
  ],
  212: [
    ["Nouvelle ligne pour le bureau des admissions", "Création d'un deuxième poste d'accueil."],
    ["Poste DECT supplémentaire", "Pour l'infirmière de nuit."],
  ],
};

// Frequence relative des entrees de catalogue (les incidents courants dominent).
const FREQUENCE = {
  101: 8, 102: 10, 103: 9, 104: 5, 105: 4, 106: 2, 107: 10, 108: 7, 109: 2, 110: 2, 111: 4, 112: 3, 113: 2, 114: 3,
  115: 3, 116: 4, 201: 5, 203: 4, 204: 5, 205: 2, 206: 2, 207: 2, 208: 2, 209: 1, 210: 1, 212: 2,
};

const COMMENTAIRES = {
  resolution: [
    "Redémarrage du service, fonctionnement rétabli.",
    "Paramétrage corrigé, vérifié avec l'utilisateur.",
    "Matériel remplacé.",
    "Mise à jour appliquée, test concluant.",
    "Droits corrigés.",
    "Contournement communiqué, correctif éditeur appliqué.",
    "Cache et profil réinitialisés, OK.",
    "Corrigé par l'éditeur.",
    "Câble remplacé.",
  ],
  realisation: [
    "Réalisé.",
    "Installé et testé avec l'utilisateur.",
    "Accès créés, identifiants transmis.",
    "Livré et validé avec le demandeur.",
    "Paramétrage effectué en recette puis en production.",
  ],
  suspension: [
    "En attente de retour de l'utilisateur.",
    "Pièce commandée chez le fournisseur.",
    "Ticket ouvert chez l'éditeur.",
    "Intervention planifiée sur site.",
    "Utilisateur absent, rappel prévu.",
  ],
  suivi: [
    "Utilisateur rappelé, diagnostic en cours.",
    "Prise en main à distance effectuée.",
    "Analyse des journaux en cours.",
    "Reproduit sur un poste de test.",
  ],
  refus: [
    "Non prioritaire cette année.",
    "Besoin déjà couvert par l'outil existant.",
    "À revoir avec le cadre du service.",
    "Budget non disponible.",
  ],
  validation: ["", "", "Validé.", "OK pour moi.", "Validé en réunion de service."],
  rouverture: ["Le problème est revenu.", "Toujours pas résolu.", "Ça a refonctionné une journée seulement."],
  annulation: ["Doublon d'un autre ticket.", "Résolu par l'utilisateur lui-même.", "Demande retirée par le service."],
};

// Groupe de transfert depuis le Service Desk, selon le sujet.
const TRANSFERTS = { 102: 11, 103: 11, 104: 2, 106: 2, 116: 2 };

// ---------- Generation ----------

function genererVolume(nombre = NB_TICKETS) {
  const H = generateur(20261001);
  const login = (id) => D.EMPLOYEES.find((e) => e.EMPLOYEE_ID === id).IDENTIFICATION;
  const actifs = (e) => !e.DEPARTURE_DATE;
  const membres = (groupeId) =>
    D.GROUPS.find((g) => g.GROUP_ID === groupeId).MEMBERS.map((id) => D.EMPLOYEES.find((e) => e.EMPLOYEE_ID === id)).filter(actifs);
  const demandeurs = D.EMPLOYEES.filter((e) => !e.GROUPES.length && actifs(e));
  const catalogue = (id) => D.CATALOG.find((c) => c.SD_CATALOG_ID === Number(id));
  const tickets = [];

  for (let n = 0; n < nombre; n++) {
    // Anciennete : plus de tickets recents que d'anciens.
    const heures = Math.round((0.2 + JOURS * 24 * Math.pow(H.r(), 1.6)) * 10) / 10;
    const cat = catalogue(H.pondere(FREQUENCE));
    const incident = cat.CATALOG_REQUEST_PATH.startsWith("Incidents/");
    const [titre, description] = H.choix(SUJETS[cat.SD_CATALOG_ID]);
    const dem = H.choix(demandeurs);
    const t = { catalogue: cat.SD_CATALOG_ID, titre, description, demandeur: dem.IDENTIFICATION, heures, etapes: [] };
    if (incident) {
      t.urgence = Number(H.pondere({ 1: 3, 3: 7 }));
      t.impact = Number(H.pondere({ 1: 1, 2: 3, 3: 6 }));
    }

    // Les etapes sont jouees tant qu'elles restent dans le passe.
    let h = heures;
    let fini = false;
    const etape = (delaiMin, delaiMax, ...op) => {
      if (fini) return false;
      h -= H.entre(delaiMin, delaiMax);
      if (h < 0.05) return !(fini = true);
      t.etapes.push([op[0], op[1], Math.round(h * 100) / 100, ...op.slice(2)]);
      return true;
    };

    // Validation hierarchique (demandes concernees) : le manager du demandeur, sinon la supervision.
    if (!incident && cat.VALIDATION === true) {
      const valideur = dem.MANAGER_LOGIN || login(D.GROUPS.find((g) => g.GROUP_ID === D.GROUPE_SUPERVISION).MEMBERS[0]);
      if (H.proba(0.15)) {
        etape(2, 72, "terminer", valideur, H.choix(COMMENTAIRES.refus), "0");
        tickets.push(t);
        continue;
      }
      if (!etape(2, 72, "terminer", valideur, H.choix(COMMENTAIRES.validation), "1")) {
        tickets.push(t);
        continue;
      }
    }

    // Transfert eventuel par le Service Desk vers le bon groupe.
    let groupe = cat.GROUP_ID;
    if (TRANSFERTS[cat.SD_CATALOG_ID] && H.proba(0.2)) {
      const cible = TRANSFERTS[cat.SD_CATALOG_ID];
      const nomCible = D.GROUPS.find((g) => g.GROUP_ID === cible).GROUP_FR;
      if (etape(0.2, 4, "transferer", login(H.choix(membres(groupe)).EMPLOYEE_ID), `Transféré vers ${nomCible}.`, cible)) groupe = cible;
    }

    // Quelques tickets oublies (jamais pris en charge, ou jamais resolus) : seulement
    // parmi les recents, sinon ils s'accumuleraient sur 90 jours.
    const oubliable = heures < 21 * 24;
    // Quelques tickets jamais pris en charge, quelques annulations.
    if (oubliable && H.proba(0.05)) {
      tickets.push(t);
      continue;
    }
    if (H.proba(0.03)) {
      etape(0.5, 48, "annuler", login(H.choix(membres(groupe)).EMPLOYEE_ID), H.choix(COMMENTAIRES.annulation));
      tickets.push(t);
      continue;
    }

    const tech = login(H.choix(membres(groupe)).EMPLOYEE_ID);
    // Urgent : pris tres vite ; sinon dans la journee.
    etape(0.05, t.urgence === 1 ? 1 : incident ? 8 : 30, "prendre", tech);
    if (H.proba(0.25)) etape(0.2, 6, "commenter", tech, H.choix(COMMENTAIRES.suivi));
    if (H.proba(0.25)) {
      etape(0.5, 24, "suspendre", tech, H.choix(COMMENTAIRES.suspension));
      etape(8, 96, "reprendre", tech, "Reprise du traitement.");
    }
    // Quelques tickets qui trainent (jamais resolus) : ils finissent en retard.
    if (oubliable && H.proba(0.06)) {
      tickets.push(t);
      continue;
    }
    const resolution = () =>
      etape(0.3, incident ? 24 : 60, "terminer", tech, H.choix(incident ? COMMENTAIRES.resolution : COMMENTAIRES.realisation));
    resolution();
    // Confirmation par le demandeur (parfois jamais faite : reste "Résolu").
    if (H.proba(0.06)) {
      tickets.push(t);
      continue;
    }
    if (H.proba(0.07)) {
      etape(2, 72, "terminer", dem.IDENTIFICATION, H.choix(COMMENTAIRES.rouverture), "0");
      resolution();
    }
    etape(2, 96, "terminer", dem.IDENTIFICATION, "", "1");
    tickets.push(t);
  }
  return tickets;
}

module.exports = { genererVolume };
