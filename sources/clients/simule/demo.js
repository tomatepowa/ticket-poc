// demo.js — tickets de demonstration du faux EasyVista.
// Dates relatives au seed (en heures). Chaque etape est une operation EV :
//   ["prendre", login, heures]                      affecte l'action en cours
//   ["terminer", login, heures, commentaire, choix] termine l'action en cours (choix 1/0 pour une validation)
//   ["suspendre", login, heures, commentaire]
//   ["commenter", login, heures, commentaire]
// urgence / impact : ids EV (1 = le plus fort), voir donnees.js.
// Le ticket est cree dans l'etablissement du demandeur.
// reponses : { id_question: valeur } -> creation sans workflow, reponses, puis demarrage.
//   ["intervention", login, heures, commentaire] : action "Intervention sur site" (type inconnu du portail)

module.exports = [
  {
    catalogue: 101, titre: "Boîte mail pleine, plus de réception", demandeur: "jroux", urgence: 1, impact: 3, heures: 5,
    description: "N'arrive plus à recevoir de mails depuis ce matin, message « boîte pleine ».",
    etapes: [["prendre", "mdubois", 4]],
  },
  {
    catalogue: 108, titre: "DPI très lent à l'ouverture des dossiers", demandeur: "sbernard", urgence: 1, impact: 1, heures: 6,
    description: "Lenteur importante depuis hier soir, plusieurs services impactés.",
    etapes: [],
  },
  {
    catalogue: 103, titre: "Imprimante du 2e étage bloquée", demandeur: "cmartin", urgence: 3, impact: 2, heures: 26,
    description: "Bourrage papier permanent, voyant orange.",
    etapes: [
      ["prendre", "kbenali", 24],
      ["suspendre", "kbenali", 23, "Demandé au service le numéro inscrit sur l'étiquette de l'imprimante."],
    ],
  },
  {
    catalogue: 104, titre: "Wifi instable en salle de soins", demandeur: "nfaure", urgence: 3, impact: 2, heures: 50,
    description: "Coupures toutes les 10 minutes environ, chariots de soins déconnectés.",
    etapes: [
      ["prendre", "nhaddad", 47],
      ["suspendre", "nhaddad", 30, "Borne défectueuse, remplacement commandé chez le prestataire réseau."],
    ],
  },
  {
    catalogue: 105, titre: "DECT du service sans tonalité", demandeur: "jroux", urgence: 1, impact: 3, heures: 72,
    description: "Plus de tonalité sur le DECT de l'accueil.",
    etapes: [
      ["prendre", "jlefevre", 70],
      ["terminer", "jlefevre", 66, "Batterie remplacée, tonalité OK."],
    ],
  },
  {
    catalogue: 107, titre: "Mot de passe expiré", demandeur: "sbernard", urgence: 1, impact: 3, heures: 170,
    description: "",
    etapes: [
      ["prendre", "mdubois", 169],
      ["terminer", "mdubois", 168, "Mot de passe réinitialisé."],
      ["terminer", "sbernard", 160, "", "1"],
    ],
  },
  {
    catalogue: 114, titre: "Pousse-seringue connecté ne remonte plus les données", demandeur: "nfaure", urgence: 1, impact: 2, heures: 3,
    description: "Service de psychiatrie adulte, chambre 12.",
    etapes: [
      ["prendre", "pfabre", 2.5],
      ["intervention", "pfabre", 2, "Déplacement du prestataire prévu à 14h."],
    ],
  },
  {
    catalogue: 115, titre: "Mail suspect reçu par plusieurs agents", demandeur: "arobert", urgence: 1, impact: 2, heures: 1,
    description: "Faux mail de la paie demandant de se reconnecter à un lien externe.",
    etapes: [["prendre", "ymercier", 0.5]],
  },
  {
    catalogue: 111, titre: "Planning RH : heures de nuit mal calculées", demandeur: "arobert", urgence: 3, impact: 2, heures: 30,
    description: "Les majorations de nuit ne s'appliquent plus depuis la mise à jour.",
    etapes: [
      ["prendre", "sblanc", 28],
      ["commenter", "sblanc", 27, "Ticket ouvert chez l'éditeur, référence ED-4471."],
    ],
  },
  {
    catalogue: 201, titre: "Installation Office pour un nouvel arrivant", demandeur: "jroux", heures: 2,
    description: "Nouveau poste au secrétariat, arrivée lundi prochain.",
    etapes: [],
  },
  {
    catalogue: 202, titre: "Écran supplémentaire pour le secrétariat", demandeur: "jroux", heures: 20,
    description: "Un second écran pour consulter le planning en parallèle.",
    reponses: { 1: "Écran", 3: 650, 4: "Écran 32 pouces pour le planning du bloc, consulté en continu.", 5: "2026-10-15" },
    etapes: [],
  },
  {
    catalogue: 202, titre: "Clavier et souris pour le poste d'accueil", demandeur: "bgarcia", heures: 7,
    description: "Clavier cassé.",
    reponses: { 1: "Autre", 2: "Clavier + souris filaires", 3: 45, 4: "Remplacement de matériel défectueux." },
    etapes: [["prendre", "evidal", 6]],
  },
  {
    catalogue: 211, titre: "Arrivée d'une aide-soignante le 1er du mois", demandeur: "arobert", heures: 8,
    description: "Création des comptes (session, DPI, planning) et badge.",
    reponses: {
      10: "Arrivée", 11: "Inès Laurent", 12: "2026-11-01", 13: "EHPAD — unité Alzheimer",
      14: ["Session Windows", "DPI", "Planning", "Badge"],
    },
    etapes: [],
  },
  {
    catalogue: 207, titre: "Tableau de bord d'occupation des lits", demandeur: "cmartin", heures: 96,
    description: "Suivi hebdomadaire par service, exportable Excel.",
    etapes: [
      ["terminer", "igarnier", 90, "", "1"],
      ["prendre", "lmoreau", 80],
      ["commenter", "lmoreau", 20, "Première version disponible en recette, retour attendu vendredi."],
    ],
  },
  {
    catalogue: 209, titre: "Déploiement d'un logiciel de planning des gardes", demandeur: "sbernard", heures: 120,
    description: "Besoin d'un outil de planning des gardes pour le service.",
    etapes: [["terminer", "igarnier", 100, "Validé en comité du lundi.", "1"]],
  },
  {
    catalogue: 204, titre: "Accès au logiciel de paie", demandeur: "jroux", heures: 60,
    description: "Pour consulter les plannings de paie.",
    etapes: [["terminer", "cmartin", 55, "Pas nécessaire pour ce poste, les plannings sont transmis par les RH.", "0"]],
  },
  {
    catalogue: 102, titre: "Écran noir au poste de soins", demandeur: "bgarcia", urgence: 3, impact: 3, heures: 150,
    description: "",
    etapes: [
      ["prendre", "kbenali", 149],
      ["terminer", "kbenali", 148, "Câble d'alimentation débranché."],
    ],
  },
];
