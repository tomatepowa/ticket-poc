// sources/index.js — la source de donnees du portail.
//
// Le portail n'a PAS de donnees propres : EasyVista est maitre des tickets,
// des etapes, de l'historique et des referentiels. La source (portail/source.js)
// traduit les besoins du portail en appels a l'API REST EV, via un client :
//
//   SOURCE=simulation (defaut) : clients/simule, un faux EV qui parle comme l'API
//   SOURCE=easyvista           : clients/http, la vraie API (EV_URL, EV_ACCOUNT, EV_TOKEN)
//
// Interface exposee au serveur (toutes les methodes sont async) :
//
//   nom                                  "simulation" | "easyvista"
//   listerComptesDev()                   comptes proposes a la connexion de dev
//   getUtilisateur(id)                   utilisateur du portail (id = EMPLOYEE_ID EV), ou null
//   vues(user)                           vues de liste disponibles pour cet utilisateur
//   preferences(user)                    { vue_defaut } : preferences d'affichage
//   definirPreferences(user, prefs)      enregistre { vue_defaut }
//   listerEtablissements()               [{ id, nom }]
//   listerGroupes()                      [{ id, nom }] groupes d'intervenants
//   listerCatalogue(user)                [{ id, type, libelle, chemin }]
//   listerTickets(user, filtres)         tickets VISIBLES par l'utilisateur
//                                        filtres : vue, q, etablissement, groupe,
//                                        statut ("" tous | ACTIFS | INACTIFS = resolus et clos)
//   getTicket(user, rfc)                 ticket + historique + actions permises + progression
//                                        action : { code, label, commentaire, parametre, secondaire }
//   creerTicket(user, data)              cree le ticket au nom de l'utilisateur
//   executerAction(user, rfc, data)      { action, commentaire, groupe_id }
//   stats(user, filtres)                 compteurs pour le bandeau
//
// Les droits de chaque utilisateur sont appliques par la source (portail/modele.js),
// jamais par le front. En cas de refus, elle leve une ErreurSource (erreurs.js).

const { creerSource } = require("./portail/source");

const nom = process.env.SOURCE || "simulation";

let client;
if (nom === "simulation") {
  // better-sqlite3 (dependance optionnelle) ne sert qu'au faux EV de demonstration.
  try {
    require.resolve("better-sqlite3");
  } catch {
    throw new Error("SOURCE=simulation demande le module better-sqlite3 (npm install). En production : SOURCE=easyvista.");
  }
  client = require("./clients/simule");
}
else if (nom === "easyvista") client = require("./clients/http");
else throw new Error(`SOURCE inconnue : ${nom} (attendu : simulation ou easyvista)`);

module.exports = creerSource(client);
