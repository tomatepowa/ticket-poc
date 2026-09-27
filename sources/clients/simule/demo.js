// demo.js — tickets de demonstration du faux EasyVista.
// Dates relatives au seed (en heures). Chaque etape est une operation EV :
//   ["prendre", login, heures]                      affecte l'action en cours
//   ["terminer", login, heures, commentaire, choix] termine l'action en cours (choix 1/0 pour une validation)
//   ["suspendre", login, heures, commentaire]
//   ["commenter", login, heures, commentaire]
// urgence / impact : ids EV (1 = le plus fort), voir donnees.js.

module.exports = [
  {
    catalogue: 101, titre: "Boîte mail pleine, plus de réception", demandeur: "jroux", urgence: 1, impact: 3, heures: 5,
    description: "Je n'arrive plus à recevoir de mails depuis ce matin, message « boîte pleine ».",
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
      ["prendre", "mdubois", 24],
      ["suspendre", "mdubois", 23, "Pouvez-vous m'indiquer le numéro inscrit sur l'étiquette de l'imprimante ?"],
    ],
  },
  {
    catalogue: 104, titre: "Wifi instable en salle de réunion", demandeur: "cmartin", urgence: 3, impact: 2, heures: 50,
    description: "Coupures toutes les 10 minutes environ.",
    etapes: [
      ["prendre", "nhaddad", 47],
      ["suspendre", "nhaddad", 30, "Borne défectueuse, remplacement commandé chez le prestataire réseau."],
    ],
  },
  {
    catalogue: 105, titre: "Téléphone du secrétariat sans tonalité", demandeur: "jroux", urgence: 1, impact: 3, heures: 72,
    description: "Plus de tonalité sur le poste fixe.",
    etapes: [
      ["prendre", "mdubois", 70],
      ["terminer", "mdubois", 66, "Combiné remplacé, tonalité OK."],
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
    catalogue: 201, titre: "Installation Office pour un nouvel arrivant", demandeur: "jroux", heures: 2,
    description: "Nouveau poste au secrétariat, arrivée lundi prochain.",
    etapes: [],
  },
  {
    catalogue: 202, titre: "Écran supplémentaire pour le secrétariat", demandeur: "jroux", heures: 20,
    description: "Un second écran pour consulter le planning en parallèle.",
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
    catalogue: 209, titre: "Déploiement d'un logiciel de planning", demandeur: "sbernard", heures: 120,
    description: "Besoin d'un outil de planning des gardes pour le service.",
    etapes: [["terminer", "igarnier", 100, "Validé en comité du lundi.", "1"]],
  },
  {
    catalogue: 204, titre: "Accès au logiciel paie", demandeur: "jroux", heures: 60,
    description: "Pour consulter les plannings de paie.",
    etapes: [["terminer", "cmartin", 55, "Pas nécessaire pour ce poste, les plannings sont transmis par les RH.", "0"]],
  },
];
