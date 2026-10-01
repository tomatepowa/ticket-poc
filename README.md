# POC — Portail tickets IT

L'outil de travail des **équipes support** (Service Desk, infra, téléphonie,
applications métier, DPI, ITO, BI, SIRH, sécurité SI, biomédical, logistique
IT) et des **cadres valideurs**, en affichage simplifié d'EasyVista. Pas de
front office pour les utilisateurs finaux : le support saisit les tickets pour
leur compte (appel, passage, mail…).

**EasyVista est maître** : les tickets, les étapes de workflow, l'historique et
les référentiels viennent d'EV. Le portail garde seulement une **copie locale
jetable** (PostgreSQL) pour afficher vite les listes, et transmet toutes les
actions à EV. Cette copie sert aussi au **pôle BI**, qui l'interroge en lecture
seule pour ses tableaux de bord, sans accès à la base native d'EasyVista.

**Installation en production (Windows Server, sans Linux ni Docker)** :
voir [installation/windows/INSTALLATION.md](installation/windows/INSTALLATION.md).

Tant que l'API EV et l'AD ne sont pas accessibles, le portail tourne sur un
**faux EasyVista** qui parle comme la vraie API REST, et une **connexion de
développement**.

## Lancer le POC (poste de développement)

```bash
npm run dev
```

Une seule commande : elle lance Docker Desktop s'il est arrêté, démarre le
conteneur PostgreSQL, attend la base, puis démarre le portail (Ctrl+C pour
l'arrêter). La configuration vient du fichier `.env` (ignoré par git).
Le portail redémarre tout seul quand le code serveur change (`server.js`,
`auth.js`, `sources/`) ; le front (`web/`) est rechargé à chaud dans le
navigateur.

Première fois sur un poste :

```bash
npm install
cp .env.exemple .env          # PowerShell : Copy-Item .env.exemple .env
docker compose up -d base     # crée la base PostgreSQL de démo (conteneur portail-tickets-base)
npm run dev
```

`npm start` lance le portail seul, sans rien démarrer d'autre : c'est la
commande de la production (service Windows), qui attend `DATABASE_URL` dans
son environnement.

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

**Volume de démo** : en plus d'une vingtaine de tickets écrits à la main
(`sources/clients/simule/demo.js`), le faux EV génère environ 1 300 tickets
sur les 90 derniers jours (`volume.js`), pour une cinquantaine de demandeurs
répartis dans tous les établissements : prises en charge, mises en attente
et reprises, transferts, validations et refus, réouvertures, annulations,
tickets en retard. À un instant donné, environ 150 tickets sont en cours et
les autres résolus ou clos (utiles aussi pour les vues du pôle BI). Le jeu
est identique à chaque remise à zéro ; `DEMO_TICKETS` (dans `.env`) change
le nombre de tickets générés (`DEMO_TICKETS=0` : seulement ceux de `demo.js`).
Comme dans la vraie vie, une partie des tickets a des captures d'écran
collées dans la description ou les commentaires, et des pièces jointes
(captures, journaux, PDF, mail) : voir `sources/clients/simule/fichiers.js`.

**Captures et pièces jointes** : descriptions et commentaires EasyVista
peuvent être du HTML (éditeur EV, images collées). Le détail d'un ticket
les affiche assainis (DOMPurify : ni script ni lien `javascript:`), images
à la largeur du panneau, clic pour agrandir. Les pièces jointes sont lues
dans EV (`GET /requests/{n°}/documents`) et servies par le portail avec les
mêmes droits que le ticket. La copie locale garde le HTML **sans** les
images intégrées (elles restent dans EV) et une version texte seul, utilisée
par le pôle BI (`bi.tickets.description`, `bi.actions.commentaire`). Les
images hébergées dans EV (liens) ne sont pas encore affichées : une mention
le signale. À vérifier sur la vraie instance : le format réel d'une capture
collée, et la réponse du téléchargement d'une pièce jointe.

`npm run reset-demo` remet les tickets de démonstration à zéro et vide la copie locale
(même `DATABASE_URL` que le portail). La première synchro qui suit prend
une dizaine de secondes.

**Liens directs** : chaque ticket a son adresse, `http://<portail>/t/<numéro EV>`
(bouton « Copier le lien » dans le détail, ou Ctrl+clic sur le n° dans la
liste). Un lien ouvert sans être connecté passe par la connexion puis ouvre le
ticket ; les droits restent appliqués (« introuvable ou pas d'accès » sinon).

En local, `npm start` sert le front via Vite (rechargement à chaud des fichiers
de `web/`). En production (`NODE_ENV=production`), le serveur sert le build :
lancer `npm run build` avant (l'image Docker le fait).

Démo complète sous Docker : `docker compose up --build` (portail + PostgreSQL).

## Tests

```bash
npm test
```

Lance les tests du dossier `tests/` (outil de test intégré à Node, rien à
installer). Deux familles :

- **Règles du portail**, sans base ni EV : profils d'après les groupes EV, qui
  voit quel ticket, boutons proposés à chacun, étapes et statuts affichés,
  contrôle des formulaires, détection d'un paramétrage EV inconnu, et
  garde-fous sur `correspondance.js` (`tests/correspondance.test.js`).
- **PostgreSQL** (`tests/postgres-*.test.js`) : migrations, copie locale des
  tickets, sessions, vues du pôle BI, synchro EV → base (incrémentale,
  complète, purge, panne d'EV), puis listes, filtres, stats et actions du
  portail de bout en bout, sur un faux EV en mémoire (`tests/faux-ev.js`).

Les tests PostgreSQL utilisent une base **dédiée**, `TEST_DATABASE_URL` (voir
`.env.exemple`), vidée à chaque exécution : son nom doit contenir « test »,
et elle est créée automatiquement dans le PostgreSQL du poste
(`docker compose up -d base`). Sans elle, ces tests sont ignorés avec un
message, les autres tournent.

**Adapter à la vraie instance EV** : les tests ne contiennent aucun nom de
statut, de type d'action ou de groupe ; ils les lisent dans
`correspondance.js` (`tests/fabrique.js`). Après l'adaptation, `npm test`
dit ce qui est incohérent dans le paramétrage ; une notion absente (par
exemple pas d'étape de confirmation) saute les tests concernés.

**Intégration continue** (`.github/workflows/ci.yml`) : à chaque push, GitHub
lance `npm test` (avec une base PostgreSQL jetable) et `npm run build` sous
Node 20 et 22. Résultat dans l'onglet « Actions » du dépôt, et en coche verte
/ croix rouge à côté de chaque commit. En CI, les tests PostgreSQL ne sont
jamais ignorés : base absente = échec.

## Architecture

```
server.js                     API HTTP : authentification, routes, erreurs. Aucune règle métier.
auth.js                       Session : connexion de dev aujourd'hui, SSO demain. Refuse les non-support.
sources/index.js              Choix du client EV + description de l'interface de la source.
sources/portail/              Logique du portail, identique en simulation et sur le vrai EV :
  correspondance.js             comment lire VOTRE EV (statuts, types d'action, groupes, urgence/impact)
  modele.js                     profils, étape affichée, droits de chaque utilisateur, boutons proposés
  source.js                     besoins du portail -> lecture du cache ou appels REST EV
  base.js                       connexion PostgreSQL (DATABASE_URL) et migrations au démarrage
  sql/                          schéma : 001 tables du portail, 002 vues du pôle BI
  questionnaires.js             formulaires EV : lecture, conditions, contrôle des réponses
  cache.js                      copie locale des tickets EV + sessions (schéma PostgreSQL "portail")
  synchro.js                    alimentation du cache : par différence chaque minute, complète chaque jour
  controle.js                   correspondance EV -> portail complète ? (après chaque synchro)
sources/clients/http.js       Client de la vraie API REST EV (à valider sur une instance).
sources/clients/simule/       Faux EV (démo, SQLite) : mêmes routes, mêmes réponses JSON,
                              workflows simples, établissements d'un groupe fictif de cliniques privées.
installation/windows/         Installation Windows : script, base, service WinSW, documentation.
scripts/reset-demo.js         Remise à zéro de la démo.
web/                          Front Vue 3 (build Vite -> dist/, config dans vite.config.mjs) :
  src/App.vue                   session, filtres, panneaux, liens directs /t/<n°>
  src/components/               connexion, rail de filtres, fraîcheur des données, stats, liste, saisie, détail,
                                FormulaireEV.vue (formulaire générique d'après un questionnaire EV)
  src/api.js, src/outils.js     appels /api, libellés, formats, notification
```

Brancher le vrai EasyVista = passer `SOURCE=easyvista` et adapter
`sources/portail/correspondance.js` aux noms de votre paramétrage. Le front
et la logique du portail ne changent pas.

## Copie locale et synchronisation

Pour ne pas solliciter EV à chaque affichage, les listes, filtres et stats sont
lus dans une copie locale PostgreSQL (schéma `portail`) :

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

Vider les tables du schéma `portail` est sans risque : la synchro les
reconstruit. Elles contiennent des descriptions de tickets : la base suit les
mêmes règles de sécurité que le serveur (accès, sauvegardes, chiffrement, HDS).
Les sessions de connexion sont aussi en base : elles survivent à un redémarrage.

## Pôle BI

Le rôle PostgreSQL `bi_lecteur` (lecture seule, requêtes limitées à 60 s) ne
voit que le schéma `bi`, fait de vues « contrat » aux colonnes stables :
`bi.tickets`, `bi.actions` (historique), `bi.charge_groupes`, `bi.synchro`
(fraîcheur). Les descriptions de tickets et commentaires d'actions y figurent
(décision du 01/10/2026 : pas de données de santé saisies dans les tickets ;
à garder sous le regard du DPO). Détail et connexion Power BI :
[INSTALLATION.md](installation/windows/INSTALLATION.md#4-accès-du-pôle-bi).

## Formulaires (questionnaires EV)

Aucun formulaire n'est codé dans le portail : un seul composant générique
(`FormulaireEV.vue`) affiche n'importe quel questionnaire défini dans EV.
Types gérés : texte, texte long, nombre, date, liste, choix multiples, oui/non ;
questions obligatoires et conditionnelles (affichées selon une autre réponse).
Un formulaire créé ou modifié dans EV apparaît tel quel.

- **À la saisie** : si l'entrée de catalogue a un questionnaire, il s'affiche.
  Les réponses sont contrôlées par le serveur, puis le ticket est créé **sans
  workflow**, les réponses enregistrées, et **seulement ensuite** le workflow
  démarré (EV 2026.1+, `creationSansWorkflow`). Indispensable quand une étape
  dépend d'une réponse — démo : une demande de matériel passe en validation
  au-delà de 500 €.
- **À la fin d'une étape** : si EV demande un formulaire pour terminer l'action
  en cours (démo : « Livraison du matériel »), il s'affiche avant la validation.
- **Dans le détail** : les réponses enregistrées sont affichées.

## Référentiels toujours à jour

- Établissements, catalogue, groupes et employés sont **lus dans EV** (cache
  mémoire de 5 min, employés en direct) : rien à maintenir dans le portail.
  Seul le faux EV a des listes en dur.
- **Éléments désactivés** (EV archive plutôt que supprimer) : un établissement
  ou une entrée de catalogue dont la date de fin est passée, un employé parti,
  sont masqués ; un employé parti perd son accès au portail. Champs réglés dans
  `correspondance.js` (`champsFin`, à vérifier sur la vraie instance).
- **Correspondance par identifiant** : dans `correspondance.js`, statuts,
  types d'action et groupes peuvent être référencés par leur identifiant EV
  (GUID, ID) plutôt que leur libellé : un renommage dans EV ne casse rien.
- **Contrôle de correspondance** après chaque synchro : tout statut ou type
  d'action rencontré mais inconnu, ou groupe de profil disparu d'EV, est
  journalisé et affiché aux superviseurs (« Correspondance EasyVista à
  compléter »). Démo : l'action « Intervention sur site ».

L'API EV ne permet pas de supprimer localisations, catalogue, employés ni
tickets (seulement les groupes et quelques liens) : c'est voulu, ces
référentiels s'administrent dans EV, pas dans le portail.

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
| Formulaire d'une entrée de catalogue | `GET /questionnaires/{id}` + `GET /questions-questionnaire/{id}` |
| Saisie avec formulaire | `POST /requests/without-workflow`, `POST /questions-result/{request_id}/{question_id}`, `PUT /requests/{rfc}/workflowstart` |
| Formulaire de fin d'étape | `GET /requests/{rfc}/actions/{action_id}/questionnaire`, puis réponses et fin d'action |
| Réponses d'un ticket | `GET /questions-result/{request_id}` |
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
- une éventuelle limite du nombre d'appels à l'API ;
- questionnaires : champ du catalogue qui donne le questionnaire, format des
  questions (type, obligatoire, choix, condition), format des réponses (choix
  multiples), usage de `without-workflow` / `workflowstart` hors agent virtuel ;
- champs de fin de validité (localisation, catalogue) et de départ (employé).

## Variables d'environnement

| Variable | Valeurs | Défaut |
|---|---|---|
| `DATABASE_URL` | `postgres://utilisateur:motdepasse@serveur:5432/base` | **obligatoire** |
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
