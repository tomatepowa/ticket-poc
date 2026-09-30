// correspondance.js — comment le portail lit VOTRE EasyVista.
//
// L'API EV ne decrit pas les workflows : elle donne le statut du ticket et
// ses actions en cours. Ce fichier dit au portail comment les interpreter.
// C'est LE fichier a adapter a votre parametrage EV (noms exacts des statuts,
// des types d'action, des groupes, ids d'urgence et d'impact).
// Les valeurs ci-dessous correspondent a l'EV simule (sources/clients/simule).
//
// Cles des tables (statuts, typesAction, groupes...) : le LIBELLE EV, ou mieux
// son IDENTIFIANT (GUID de statut, ID de type d'action, ID de groupe) : avec
// l'identifiant, un renommage dans EV ne casse rien. Le portail essaie
// l'identifiant d'abord, puis le libelle. Tout statut ou type d'action rencontre
// mais absent d'ici est signale par le controle de correspondance (synchro).

module.exports = {
  // Statut EV (STATUS_FR) -> statut du portail (couleurs, filtres, stats).
  statuts: {
    "Nouveau": "OUVERT",
    "En cours": "EN_COURS",
    "En attente de validation": "EN_ATTENTE",
    "Suspendu": "EN_ATTENTE",
    "Résolu": "RESOLU",
    "Clôturé": "CLOTURE",
    "Refusé": "CLOTURE",
    "Annulé": "CLOTURE",
  },
  statutSuspendu: "Suspendu",
  statutAnnulation: "Annulé", // statut de cloture utilise quand le demandeur annule
  statutsSortie: ["Refusé", "Annulé"], // fins anticipees : barre de progression grisee

  // Type de ticket d'apres le prefixe du numero EV.
  typeDepuisNumero: { I: "INCIDENT", S: "DEMANDE" },
  // Type d'une entree de catalogue d'apres le debut de son chemin.
  typeDepuisCheminCatalogue: { "Incidents/": "INCIDENT", "Demandes/": "DEMANDE" },

  // Types d'action EV (ACTION_TYPE.NAME_FR) qui constituent une etape de workflow.
  //   TRAITEMENT   : tache d'un groupe d'intervenants (prise en charge, fin = "terminer")
  //   VALIDATION   : validation par la personne designee (choix 1 = accepte, 0 = refuse)
  //   CONFIRMATION : confirmation par le demandeur (choix 1 = confirme, 0 = rouvre)
  typesAction: {
    "Traitement incident": {
      nature: "TRAITEMENT",
      code: "PRIS_EN_CHARGE",
      etape: "Pris en charge",
      codeNonAffecte: "A_TRAITER",
      etapeNonAffectee: "À prendre en charge",
      terminer: "Résoudre",
    },
    "Réalisation demande": {
      nature: "TRAITEMENT",
      code: "EN_REALISATION",
      etape: "En réalisation",
      codeNonAffecte: "A_TRAITER",
      etapeNonAffectee: "À traiter",
      terminer: "Marquer comme réalisée",
    },
    "Validation hiérarchique": { nature: "VALIDATION", code: "EN_VALIDATION", etape: "En validation" },
    "Confirmation demandeur": { nature: "CONFIRMATION", code: "A_CONFIRMER", etape: "Résolu, à confirmer" },
  },

  // Type d'action EV utilise pour les commentaires ajoutes depuis le portail.
  typeCommentaire: "Commentaire",

  // Types d'action EV connus qui ne sont PAS des etapes de workflow (traces,
  // commentaires...) : ils ne declenchent pas d'alerte de correspondance.
  typesActionHorsWorkflow: ["Commentaire", "Suspension", "Reprise", "Clôture"],

  // Elements desactives dans EV (EV archive plutot que supprimer) : champ date
  // de fin / de depart. Un element dont la date est passee est masque.
  // A VERIFIER sur la vraie instance : noms exacts des champs.
  champsFin: {
    etablissement: "END_DATE",
    catalogue: "END_DATE",
    employe: "DEPARTURE_DATE",
  },

  // Questionnaires (formulaires) :
  //  - champ de l'entree de catalogue qui donne son questionnaire (A VERIFIER) ;
  //  - creationSansWorkflow : creer le ticket sans workflow, enregistrer les
  //    reponses, PUIS demarrer le workflow (EV 2026.1+). Indispensable si une
  //    etape depend d'une reponse. Sinon : creation classique puis reponses.
  champQuestionnaireCatalogue: "QUESTIONNAIRE_ID",
  creationSansWorkflow: true,

  // Profils du portail, deduits des groupes EV. Le portail est reserve aux equipes :
  //   SUPERVISEUR : membre d'un de ces groupes, voit et peut traiter tous les tickets
  //   INTERVENANT : membre d'au moins un autre groupe (groupe d'intervenants)
  //   VALIDEUR    : membre d'un groupe de valideurs (cadres), ne fait que valider / refuser
  // Un employe sans aucun de ces groupes n'a pas acces au portail.
  groupesSuperviseurs: ["Supervision support"],
  groupesValideurs: ["Cadres valideurs"],

  // Barre de progression par type de ticket : [code d'etape, libelle].
  parcours: {
    INCIDENT: [
      ["A_TRAITER", "Enregistré"],
      ["PRIS_EN_CHARGE", "Pris en charge"],
      ["A_CONFIRMER", "Résolu"],
      ["CLOTURE", "Clôturé"],
    ],
    DEMANDE: [
      ["EN_VALIDATION", "En validation"],
      ["A_TRAITER", "À traiter"],
      ["EN_REALISATION", "En réalisation"],
      ["A_CONFIRMER", "Réalisée"],
      ["CLOTURE", "Clôturée"],
    ],
  },

  // Formulaire du portail -> ids EV d'urgence et d'impact (severity).
  //   urgence : 1 = "je peux travailler", 2 = "je suis bloque"
  //   impact  : 1 = moi seul, 2 = un service, 3 = tout l'etablissement
  urgenceEV: { 1: 3, 2: 1 },
  impactEV: { 1: 3, 2: 2, 3: 1 },

  // Priorite affichee (1 a 4) a partir des niveaux du formulaire.
  matricePriorite: { 3: { 2: 1, 1: 2 }, 2: { 2: 2, 1: 3 }, 1: { 2: 3, 1: 4 } }, // [impact][urgence]
};
