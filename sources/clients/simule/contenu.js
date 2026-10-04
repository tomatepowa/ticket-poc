// contenu.js — textes des tickets generes (volume.js) : descriptions et echanges
// sur plusieurs lignes, comme les ecrivent vraiment demandeurs et intervenants.
//
// Melange volontaire des formats rencontres dans EV : texte simple avec retours a
// la ligne (saisie par mail ou formulaire), HTML de l'editeur riche (paragraphes,
// listes, gras), et quelques textes tres courts. But : eprouver la lisibilite du
// detail d'un ticket avec des contenus longs et des echanges qui s'enchainent.
//
// Chaque fonction recoit le generateur pseudo-aleatoire H (voir volume.js).

const { echapper } = require("./fichiers");

// Famille de sujet, pour adapter le « deja essaye » et les diagnostics.
const FAMILLE = {
  101: "messagerie", 102: "poste", 103: "impression", 104: "reseau", 105: "telephonie", 106: "reseau", 107: "compte",
  108: "logiciel", 109: "logiciel", 110: "logiciel", 111: "logiciel", 112: "interface", 113: "donnees", 114: "biomed",
  115: "securite", 116: "poste",
};

const prenomNom = (e) => {
  const [nom, prenom = ""] = String(e.LAST_NAME).split(/,\s*/);
  return prenom ? `${prenom} ${nom}` : nom;
};
const prenom = (e) => String(e.LAST_NAME).split(/,\s*/)[1] || "";

// Tire k elements distincts.
function plusieurs(H, liste, k) {
  const reste = [...liste];
  const out = [];
  while (out.length < k && reste.length) out.push(reste.splice(Math.floor(H.r() * reste.length), 1)[0]);
  return out;
}

// ---------- Description (demandeur) ----------

const DEPUIS = [
  "Depuis ce matin à la prise de poste.",
  "Depuis hier après-midi, vers 15 h.",
  "Ça a commencé lundi, d'abord de temps en temps, maintenant tout le temps.",
  "Depuis la mise à jour de la semaine dernière.",
  "Constaté par l'équipe de nuit, signalé à la relève.",
  "Depuis le retour de congés de ma collègue, on ne sait pas si c'est lié.",
];

const ESSAYE = {
  messagerie: ["Fermé et rouvert Outlook", "Redémarré le poste", "Vérifié sur le webmail : même chose", "Vidé la corbeille et les éléments envoyés"],
  poste: ["Redémarré le poste (deux fois)", "Débranché et rebranché les câbles", "Essayé sur le poste voisin : ça fonctionne là-bas", "Fermé toutes les applications"],
  impression: ["Éteint et rallumé l'imprimante", "Vérifié le papier et le toner", "Essayé depuis un autre poste : même problème", "Supprimé les documents en attente"],
  reseau: ["Débranché / rebranché le câble réseau", "Redémarré le poste", "Testé avec un collègue : lui non plus n'a pas accès", "Essayé en wifi et en filaire"],
  telephonie: ["Retiré et remis la batterie", "Essayé un autre combiné : même chose", "Redémarré la base"],
  compte: ["Attendu 15 minutes avant de réessayer", "Vérifié que le verrouillage majuscules n'était pas actif", "Essayé sur un autre poste"],
  logiciel: ["Fermé et relancé le logiciel", "Essayé avec un autre compte du service : même problème", "Vidé le cache comme indiqué sur l'intranet"],
  interface: ["Vérifié dans le logiciel source : les données y sont", "Relancé l'envoi manuellement, sans effet"],
  donnees: ["Comparé avec l'export du mois précédent", "Vérifié les filtres du rapport"],
  biomed: ["Redémarré l'appareil", "Vérifié le câble réseau de l'appareil", "Vérifié sur un autre appareil du service : même chose"],
  securite: ["Rien ouvert d'autre", "Prévenu les collègues de ne pas cliquer", "Laissé le poste allumé sans y toucher"],
};

const IMPACT_INCIDENT = [
  "Toute l'équipe est gênée, on travaille sur papier en attendant.",
  "Ça ralentit beaucoup les admissions, la file d'attente s'allonge.",
  "Pas bloquant mais très pénible au quotidien.",
  "Gênant surtout pour l'équipe de nuit, seule à ce moment-là.",
  "Bloquant pour les sorties de l'après-midi.",
];

const BESOIN = [
  "Le besoin a été validé avec le cadre du service.",
  "Il nous faudrait ça si possible avant la fin du mois.",
  "Pas urgent, mais à prévoir pour le prochain trimestre.",
  "Plusieurs collègues sont concernés (cinq ou six personnes).",
  "C'est une demande récurrente de l'équipe depuis plusieurs mois.",
];

const DETAILS_DEMANDE = [
  "Je reste disponible pour en discuter.",
  "Je peux vous envoyer plus de détails si besoin.",
  "Le cadre de santé est au courant et d'accord.",
];

const SALUT = ["Bonjour,", "Bonjour,", "Bonjour à tous,", "Bonjour le support,", ""];
const FIN = ["Merci d'avance,", "Merci pour votre aide,", "Bonne journée,", "Cordialement,", "Merci !"];

// Une description sur plusieurs lignes, texte simple ou HTML, signee du demandeur.
function description(H, { catalogue, titre, resume, demandeur, incident }) {
  const forme = H.pondere({ texte: 6, html: 3, court: 1 });
  if (forme === "court") return resume;

  const salut = H.choix(SALUT);
  const contexte = incident ? H.choix(DEPUIS) : H.choix(BESOIN);
  const essais = incident ? plusieurs(H, ESSAYE[FAMILLE[catalogue]] || ESSAYE.poste, 1 + Math.floor(H.r() * 3)) : [];
  const precision = H.choix(incident ? IMPACT_INCIDENT : DETAILS_DEMANDE);
  const signature = [H.choix(FIN), prenomNom(demandeur), demandeur.JOB_TITLE ? `${demandeur.JOB_TITLE}` : null].filter(Boolean);

  if (forme === "html") {
    const p = (s) => `<p>${echapper(s)}</p>`;
    return [
      salut && p(salut),
      `<p><b>${echapper(resume || titre)}</b></p>`,
      p(contexte),
      essais.length ? `<p>Ce que j'ai déjà essayé :</p><ul>${essais.map((e) => `<li>${echapper(e)}</li>`).join("")}</ul>` : "",
      p(precision),
      `<p>${signature.map(echapper).join("<br>")}</p>`,
    ].filter(Boolean).join("");
  }
  return [
    salut,
    salut ? "" : null,
    [resume || titre, contexte].join("\n"),
    "",
    essais.length ? `Déjà essayé :\n${essais.map((e) => `- ${e}`).join("\n")}\n` : null,
    precision,
    "",
    signature.join("\n"),
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- Commentaires (intervenants et demandeur) ----------

const DIAGNOSTIC = {
  messagerie: ["Profil Outlook corrompu sur le poste.", "Boîte au-delà du quota (49,8 Go sur 50).", "Règle de transfert automatique en boucle."],
  poste: ["Disque presque plein (2 Go libres).", "Mise à jour Windows bloquée à 87 %.", "Pilote graphique en erreur dans l'observateur d'événements."],
  impression: ["File d'impression bloquée sur le serveur.", "Adresse IP de l'imprimante changée après une coupure.", "Pilote obsolète sur les postes du service."],
  reseau: ["Port du commutateur désactivé après une alerte de sécurité.", "Borne wifi saturée aux heures de pointe.", "Bail DHCP expiré, plus d'adresse disponible sur le VLAN."],
  telephonie: ["Combiné non réenregistré après la coupure électrique.", "Batterie hors d'usage."],
  compte: ["Compte verrouillé par un ancien mot de passe resté enregistré sur le DECT.", "Mot de passe expiré, synchronisation en échec."],
  logiciel: ["Erreur côté serveur applicatif (délai d'attente dépassé).", "Droits du profil incomplets depuis la dernière montée de version.", "Paramètre manquant dans la configuration du service."],
  interface: ["Flux HL7 en erreur, messages rejetés depuis 2 h 14.", "Certificat de l'interface expiré."],
  donnees: ["Filtre de période mal calculé sur les mois à 31 jours.", "Jointure en double sur les mutations de séjour."],
  biomed: ["Appareil sorti du VLAN biomédical après remplacement de la prise.", "Passerelle de la centrale saturée."],
  securite: ["Mail d'hameçonnage confirmé, campagne en cours sur plusieurs établissements.", "Menace bloquée par l'antivirus, aucune exécution constatée."],
};

// Echanges intervenant / demandeur : [question, reponses possibles], coherents entre eux.
const ECHANGES_INCIDENT = [
  ["Pouvez-vous me donner le numéro inscrit sur l'étiquette du poste (format PC-XXXX) ?", [
    "Le numéro est PC-{n}.\nC'est le poste à côté de la fenêtre, dans le bureau infirmier.",
    "PC-{n}.\nAttention il y a deux postes presque identiques dans le bureau, c'est celui de gauche.",
  ]],
  ["Le problème touche-t-il tous les postes du service ou seulement le vôtre ?", [
    "Seulement le mien, les collègues n'ont pas le souci.\nPar contre ma collègue de nuit l'a eu aussi hier soir sur le même poste.",
    "Tout le service est touché, au moins quatre postes.\nLes collègues de l'étage du dessous aussi, je crois.",
  ]],
  ["Avez-vous un message d'erreur exact ? Une capture d'écran serait idéale.", [
    "Le message dit « Erreur inattendue, contactez votre administrateur » puis un code : {n}.\nJe n'ai pas pu faire de capture, il disparaît tout de suite.",
    "Pas de message, ça se fige simplement.\nIl faut attendre deux ou trois minutes pour que ça reparte.",
  ]],
  ["À quelle heure environ le problème s'est-il produit la dernière fois ?", [
    "La dernière fois c'était vers 10 h 30, juste après la relève.\nAvant ça, hier vers 16 h.",
    "Je ne sais pas trop, c'est ma collègue qui l'a remarqué.\nJe lui demande et je reviens vers vous.",
  ]],
  ["Êtes-vous disponible cet après-midi pour une prise en main à distance ?", [
    "Oui je suis là jusqu'à 17 h.\nAppelez-moi sur le poste {n}, sinon sur le DECT du service.",
    "Pas cet après-midi, on a un pic d'entrées.\nDemain matin entre 9 h et 10 h ce serait parfait.",
  ]],
];

const ECHANGES_DEMANDE = [
  ["Pour combien de personnes, et à partir de quelle date ?", [
    "Pour trois personnes : moi et deux collègues.\nIdéalement à partir du 1er du mois prochain.",
    "Une seule personne pour l'instant.\nD'autres suivront peut-être en janvier.",
  ]],
  ["Le cadre du service est-il informé de la demande ?", [
    "Oui, c'est le cadre qui m'a demandé de faire le ticket.\nJe le mets en copie du prochain mail.",
    "Pas encore, je lui en parle demain à la réunion de service.",
  ]],
  ["Pouvez-vous préciser l'usage attendu ? Cela nous aidera à choisir la bonne solution.", [
    "C'est pour préparer les plannings du mois.\nAujourd'hui on fait tout sur papier puis on ressaisit, on perd beaucoup de temps.",
    "Surtout pour consulter, pas pour modifier.\nUn accès en lecture suffirait largement.",
  ]],
  ["Avez-vous un créneau la semaine prochaine pour en discuter 15 minutes ?", [
    "Mardi ou jeudi après 14 h.\nDans mon bureau, au 2e étage, ou par téléphone au {n}.",
    "La semaine prochaine c'est compliqué.\nPlutôt celle d'après, n'importe quel matin.",
  ]],
];

const RELANCES = [
  "Bonjour,\nEst-ce qu'il y a du nouveau ? On est toujours bloqués.\nMerci",
  "Bonjour,\nJe me permets de relancer : l'équipe de nuit a encore eu le problème cette nuit.",
  "Le problème est revenu ce matin, même message qu'avant.",
];
const RELANCES_DEMANDE = [
  "Bonjour,\nOù en est la demande ? L'équipe me pose la question.\nMerci",
  "Bonjour,\nJe relance cette demande : la date approche.",
];

const PRECISIONS_TECH = [
  "Merci pour ces éléments.\nJe regarde de mon côté et je reviens vers vous dans la journée.",
  "Bien reçu.\nC'est cohérent avec ce que je vois dans les journaux, je continue l'analyse.",
  "Merci, je vous appelle dans le quart d'heure.",
  "OK, je passe dans le service en fin de matinée pour voir sur place.",
];
const PRECISIONS_DEMANDE = [
  "Merci, c'est noté.\nJe prépare la suite et je reviens vers vous.",
  "Très clair, merci.\nJe vous propose une première version d'ici la fin de semaine.",
];

const signeTech = (H, e) => (H.proba(0.4) ? `\n\n${prenom(e)} — Support informatique` : "");
const rempli = (H, s) => s.replace(/\{n\}/g, () => String(1000 + Math.floor(H.r() * 9000)));

// Echange complet : question de l'intervenant, reponse du demandeur, precision.
function echange(H, { tech, demandeur, incident }) {
  const [q, reponses] = H.choix(incident ? ECHANGES_INCIDENT : ECHANGES_DEMANDE);
  return {
    question: `Bonjour ${prenom(demandeur)},\n${q}${signeTech(H, tech)}`,
    reponse: rempli(H, H.choix(reponses)),
    precision: H.choix(incident ? PRECISIONS_TECH : PRECISIONS_DEMANDE) + signeTech(H, tech),
  };
}
const relance = (H, incident) => H.choix(incident ? RELANCES : RELANCES_DEMANDE);

function suivi(H, catalogue, tech, incident) {
  if (!incident) {
    return H.choix([
      "Étude en cours avec l'équipe projet.\nPoint prévu avec le demandeur la semaine prochaine.",
      "Devis demandé au fournisseur.\nDélai de réponse annoncé : 10 jours.",
      "Prérequis vérifiés :\n- licences disponibles ;\n- poste compatible.\nOn peut avancer.",
    ]) + signeTech(H, tech);
  }
  const diag = H.choix(DIAGNOSTIC[FAMILLE[catalogue]] || DIAGNOSTIC.poste);
  return H.choix([
    `Prise en main à distance effectuée.\nConstat : ${diag}\nJe continue l'analyse.`,
    `Analyse des journaux :\n- ${diag}\n- Aucune autre anomalie relevée sur la période.\nProchaine étape : correction et test avec l'utilisateur.`,
    `Reproduit sur un poste de test.\n${diag}`,
  ]) + signeTech(H, tech);
}

const ATTENTES = [
  "En attente de retour de l'utilisateur.\nSans nouvelles sous 5 jours, le ticket sera résolu.",
  "Pièce commandée chez le fournisseur.\nLivraison annoncée sous 3 à 5 jours ouvrés.",
  "Ticket ouvert chez l'éditeur, référence ED-{n}.\nOn attend leur analyse avant d'aller plus loin.",
  "Intervention planifiée sur site.\nCréneau proposé au service, en attente de confirmation du cadre.",
  "Utilisateur absent (repos), rappel prévu à son retour.",
];

const REPRISES = [
  "Reprise du traitement.",
  "Retour de l'éditeur reçu, reprise du traitement.\nCorrectif à appliquer en préproduction d'abord.",
  "Pièce reçue, intervention ce jour.",
  "Utilisateur joint, on reprend.",
];

function resolution(H, catalogue, incident) {
  if (!incident) {
    return H.choix([
      "Réalisé.",
      "Installé et testé avec l'utilisateur.\nRaccourci ajouté sur le bureau.",
      "Accès créés.\nIdentifiants transmis par mail au cadre du service (le mot de passe sera à changer à la première connexion).",
      "Livré et validé avec le demandeur.\n\nPour toute évolution, merci de faire une nouvelle demande.",
      "Paramétrage effectué :\n- en recette le mardi, validé par le service ;\n- en production le jeudi.\nAucun impact constaté.",
    ]);
  }
  const diag = H.choix(DIAGNOSTIC[FAMILLE[catalogue]] || DIAGNOSTIC.poste);
  return H.choix([
    "Redémarrage du service, fonctionnement rétabli.",
    `Cause : ${diag}\nCorrection appliquée, vérifié avec l'utilisateur.\n\nN'hésitez pas à rouvrir si le problème revient.`,
    `Cause identifiée :\n${diag}\n\nActions réalisées :\n- correction du paramétrage ;\n- test avec l'utilisateur ;\n- surveillance pendant 24 h, sans nouvel incident.`,
    "Matériel remplacé.\nL'ancien est reparti en atelier pour diagnostic.",
    "Contournement communiqué le matin, correctif éditeur appliqué le soir.\nTout fonctionne normalement.",
    "Câble remplacé.",
  ]);
}

const REFUS = [
  "Non prioritaire cette année.",
  "Besoin déjà couvert par l'outil existant.\nVoir avec le référent du service pour une formation sur cette fonction.",
  "À revoir avec le cadre du service : la demande doit passer par la réunion d'encadrement.",
  "Budget non disponible sur l'exercice en cours.\nÀ représenter au prochain arbitrage budgétaire (janvier).",
];
const VALIDATIONS = ["", "", "Validé.", "OK pour moi.", "Validé en réunion de service.\nPriorité moyenne, pas avant la fin du mois."];
const ROUVERTURES = [
  "Le problème est revenu.",
  "Toujours pas résolu.\nMême message d'erreur ce matin, sur le même poste.",
  "Ça a refonctionné une journée seulement.\nDepuis hier soir c'est reparti comme avant, et cette fois sur deux postes.",
];
const ANNULATIONS = [
  "Doublon d'un autre ticket.",
  "Résolu par l'utilisateur lui-même (redémarrage).\nTicket annulé à sa demande.",
  "Demande retirée par le service.",
];

module.exports = {
  description,
  echange,
  relance,
  suivi,
  resolution,
  attente: (H) => rempli(H, H.choix(ATTENTES)),
  reprise: (H) => H.choix(REPRISES),
  refus: (H) => H.choix(REFUS),
  validation: (H) => H.choix(VALIDATIONS),
  rouverture: (H) => H.choix(ROUVERTURES),
  annulation: (H) => H.choix(ANNULATIONS),
};
