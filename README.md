# POC — Portail tickets IT

L'outil de travail des **équipes support** (Service Desk, infra, téléphonie,
applications métier, DPI, ITO, BI, SIRH, sécurité SI, biomédical, logistique
IT) et des **cadres valideurs**, en affichage simplifié d'EasyVista. Pas de
front office pour les utilisateurs finaux : le support saisit les tickets pour
leur compte (appel, passage, mail…).

**EasyVista est maître** : les tickets, les étapes de workflow, l'historique et
les référentiels viennent d'EV. Le portail garde seulement une **copie locale
jetable** pour afficher vite les listes, et transmet toutes les actions à EV.

Tant que l'API EV et l'AD ne sont pas accessibles, le portail tourne sur un
**faux EasyVista** qui parle comme la vraie API REST, et une **connexion de
développement**.

## Lancer le POC

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000 et choisir un compte fictif :

| Compte | Profil (d'après ses groupes EV) | Pour tester |
|---|---|---|
| Marc Dubois, Karim Benali | Intervenants Service Desk (N1) | Prendre en charge, saisir un ticket pour un demandeur, mettre en attente, résoudre, transférer |
| Nadia Haddad | Intervenante Service Desk + Infra N2 | Plusieurs groupes |
| Julie Lefèvre, Thomas Petit, Camille Girard, Hugo Lambert, Léa Moreau, Sandrine Blanc, Yanis Mercier, Paul Fabre, Élodie Vidal | Téléphonie, applications métier, DPI, ITO, BI, SIRH, sécurité SI, biomédical, logistique IT | File de leur(s) groupe(s) |
| Claire Martin, Philippe Roche, Martine Leroy | Cadres valideurs | Valider / refuser les demandes de leurs équipes, rien d'autre |
| Isabelle Garnier | Superviseure (groupe « Supervision support ») | Voit tout, valide quand il n'y a pas de manager |

Les demandeurs (Julien Roux, Sophie Bernard…) existent dans EV mais n'ont pas
accès au portail.

`npm run reset-demo` remet les tickets de démonstration à zéro et vide la copie locale.

**Liens directs** : chaque ticket a son adresse, `http://<portail>/t/<numéro EV>`
(bouton « Copier le lien » dans le détail, ou Ctrl+clic sur le n° dans la
liste). Un lien ouvert sans être connecté passe par la connexion puis ouvre le
ticket ; les droits restent appliqués (« introuvable ou pas d'accès » sinon).

En local, `npm start` sert le front via Vite (rechargement à chaud des fichiers
de `web/`). En production (`NODE_ENV=production`), le serveur sert le build :
lancer `npm run build` avant (l'image Docker le fait).

Avec Docker : `docker compose up --build` (variables dans `docker-compose.yml`).

## Architecture

```
server.js                     API HTTP : authentification, routes, erreurs. Aucune règle métier.
auth.js                       Session : connexion de dev aujourd'hui, SSO demain. Refuse les non-support.
sources/index.js              Choix du client EV + description de l'interface de la source.
sources/portail/              Logique du portail, identique en simulation et sur le vrai EV :
  correspondance.js             comment lire VOTRE EV (statuts, types d'action, groupes, urgence/impact)
  modele.js                     profils, étape affichée, droits de chaque utilisateur, boutons proposés
  source.js                     besoins du portail -> lecture du cache ou appels REST EV
  cache.js                      copie locale SQLite des tickets EV (data/cache-portail.db)
  synchro.js                    alimentation du cache : par différence chaque minute, complète chaque jour
sources/clients/http.js       Client de la vraie API REST EV (à valider sur une instance).
sources/clients/simule/       Faux EV : mêmes routes, mêmes réponses JSON, workflows simples,
                              établissements d'un groupe fictif de cliniques privées.
web/                          Front Vue 3 (build Vite -> dist/, config dans vite.config.mjs) :
  src/App.vue                   session, filtres, panneaux, liens directs /t/<n°>
  src/components/               connexion, rail de filtres, fraîcheur des données, stats, liste, saisie, détail
  src/api.js, src/outils.js     appels /api, libellés, formats, notification
```

Brancher le vrai EasyVista = passer `SOURCE=easyvista` et adapter
`sources/portail/correspondance.js` aux noms de votre paramétrage. Le front
et la logique du portail ne changent pas.

## Copie locale et synchronisation

Pour ne pas solliciter EV à chaque affichage (plusieurs centaines d'agents
connectés), les listes, filtres et stats sont lus dans une copie locale SQLite :

- **Synchro par différence** toutes les `SYNCHRO_SECONDES` (60 s) : tickets triés
  par date de mise à jour jusqu'à la synchro précédente, plus comparaison des
  actions en cours ; seuls les tickets modifiés sont relus.
- **Synchro complète** au premier démarrage puis toutes les 24 h : tout est
  relu, ce qui a disparu d'EV est retiré, les tickets clos au-delà de
  `RETENTION_JOURS` (365 j) sont purgés.
- **Détail d'un ticket** : toujours lu **en direct** dans EV (et la copie est
  mise à jour au passage). Bouton « Actualiser » pour le relire.
- **Actions et saisies** : envoyées à EV, puis le ticket est relu : le résultat
  est visible immédiatement.
- **Affichage** : l'âge des données est indiqué au-dessus de la liste
  (« Données EasyVista il y a 40 s »), avec un bouton « Rafraîchir ».
- **EV injoignable** : la liste et le détail s'affichent depuis la copie, avec
  un avertissement ; aucune action n'est proposée tant qu'EV ne répond pas.

Supprimer `data/cache-portail.db` est sans risque : la synchro le reconstruit.
Le fichier contient des descriptions de tickets : il suit les mêmes règles de
sécurité que le serveur (accès, sauvegardes, chiffrement, HDS).

## Comment le portail lit EasyVista

D'après la [documentation de l'API REST](https://docs.easyvista.com/docs/webservice-rest) :

- **Pas d'appel « au nom de » l'utilisateur** : l'API s'utilise avec un
  compte de service. Le portail applique donc lui-même les droits de chaque
  agent, à partir des données EV : ses groupes (`/employees/{id}/groups`) et
  les groupes / personnes des actions du ticket.
- **Profils** : déduits des groupes EV (`correspondance.js`) — superviseur,
  intervenant, cadre valideur. Un employé sans ces groupes n'a pas accès.
- **Traçabilité** : chaque action transmise à EV porte l'auteur réel
  (`done_by_id`, `doneby_mail`). Une saisie porte le demandeur
  (`requestor_mail`) et un commentaire « Ticket saisi par X pour Y (origine) ».
- **Étape du ticket** = ses actions en cours
  (`/actions?search=request.rfc_number:"…",end_date_ut:"is_null"`), traduites
  par `correspondance.js`. EV n'expose pas le schéma des workflows : les
  boutons dépendent de la nature de l'action en cours.

| Bouton du portail | Appel EV |
|---|---|
| Prendre en charge | `PUT /actions/{id}` `{ done_by_id }` |
| Résoudre, Valider, Refuser, Clôturer, Rouvrir | `PUT /actions/{rfc}` `{ end_action: { action_id, doneby_mail, choice } }` |
| Mettre en attente / Reprendre | `PUT /requests/{rfc}` `{ suspended }` / `{ restarted }` |
| Transférer | `PUT /actions/{id}` `{ group_id }` + commentaire |
| Ajouter un commentaire | `POST /requests/{rfc}/actions` (type « Commentaire ») |
| Saisir un ticket | `POST /requests` (catalogue, demandeur, urgence, impact) + commentaire de saisie |
| Chercher un demandeur | `GET /employees?search=last_name~"*…*"` |
| Synchronisation | `GET /requests?sort=last_update+desc&max_rows&offset`, `GET /actions` |

### À vérifier sur une vraie instance

Signalé par `A VERIFIER` dans `sources/clients/http.js` et `sources/portail/synchro.js` :
- les champs renvoyés par défaut par `/actions` (groupe, auteur, dates, commentaire) ;
- la forme exacte de la réponse de `/employees/{id}/groups` (EV 2023.2+) ;
- la possibilité de réaffecter une action (groupe, intervenant) par `PUT /actions/{id}` ;
- l'acceptation d'un commentaire dans `end_action` ;
- le tri par `last_update` / `start_date_ut` et la pagination par `offset` (EV 2024.3+) ;
- les droits du compte de service : la doc indique que seuls les membres du
  groupe d'une action peuvent la terminer ;
- une éventuelle limite du nombre d'appels à l'API.

## Variables d'environnement

| Variable | Valeurs | Défaut |
|---|---|---|
| `SOURCE` | `simulation`, `easyvista` | `simulation` |
| `EV_URL`, `EV_ACCOUNT`, `EV_TOKEN` | accès à l'API EV | requis si `SOURCE=easyvista` |
| `SYNCHRO_SECONDES` | intervalle de la synchro par différence | `60` |
| `RETENTION_JOURS` | durée de conservation des tickets clos dans la copie locale | `365` |
| `DEV_COMPTES` | e-mails proposés à la connexion de dev sur le vrai EV | 100 premiers employés ayant un profil |
| `AUTH_MODE` | `dev`, `sso` | `dev` en local, **obligatoire** en production |
| `PORT` | | `3000` |

`AUTH_MODE=dev` permet de se connecter sans mot de passe : à réserver à un
poste ou un réseau de test.

## Prochaines étapes

1. **Accès de test à l'API EV** : version d'EV, compte de service ou jeton
   (et ses groupes), liste des statuts, types d'action et groupes de vos
   workflows. Adapter `correspondance.js`, puis lever les points « à vérifier ».
2. **SSO** (Entra ID ou ADFS) : brancher `AUTH_MODE=sso` dans `auth.js` et
   retrouver l'employé EV par son e-mail.
3. **Référentiels réels** : établissements (localisations EV), groupes et
   catalogue lus dans EV remplacent ceux du faux EV.
