# POC — Portail tickets IT

Un affichage simplifié d'EasyVista. **EasyVista est maître** : les tickets,
les étapes de workflow, l'historique et les référentiels viennent d'EV. Le
portail n'a pas de données propres : il affiche plus simplement et transmet
les actions à EV.

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
| Julien Roux | Utilisateur | Ses demandes, répondre, confirmer ou contester une résolution, annuler |
| Claire Martin | Utilisateur, manager de Julien | Valider / refuser les demandes de Julien |
| Sophie Bernard | Utilisateur | Ne voit que ses propres tickets |
| Marc Dubois | Intervenant Support Infra N1 | Prendre en charge, mettre en attente, résoudre, transférer |
| Nadia Haddad | Intervenante Infra N1 + N2 | Plusieurs groupes |
| Thomas Petit | Intervenant Applications métier | |
| Léa Moreau | Intervenante BI & Data + Projets ITO | |
| Isabelle Garnier | Superviseure (groupe « Supervision support ») | Voit tout, valide quand il n'y a pas de manager |

`npm run reset-demo` remet les tickets de démonstration à zéro.

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
auth.js                       Session : connexion de dev aujourd'hui, SSO demain.
sources/index.js              Choix du client EV + description de l'interface de la source.
sources/portail/              Logique du portail, identique en simulation et sur le vrai EV :
  correspondance.js             comment lire VOTRE EV (statuts, types d'action, groupes, urgence/impact)
  modele.js                     étape affichée, droits de chaque utilisateur, boutons proposés
  source.js                     traduction des besoins du portail en appels REST EV
sources/clients/http.js       Client de la vraie API REST EV (à valider sur une instance).
sources/clients/simule/       Faux EV : mêmes routes, mêmes réponses JSON, workflows simples.
web/                          Front Vue 3 (build Vite -> dist/, config dans vite.config.mjs) :
  src/App.vue                   session, filtres, panneaux, liens directs /t/<n°>
  src/components/               connexion, rail de filtres, stats, liste, création, détail
  src/api.js, src/outils.js     appels /api, libellés, formats, notification
```

Brancher le vrai EasyVista = passer `SOURCE=easyvista` et adapter
`sources/portail/correspondance.js` aux noms de votre paramétrage. Le front
et la logique du portail ne changent pas.

## Comment le portail lit EasyVista

D'après la [documentation de l'API REST](https://docs.easyvista.com/docs/webservice-rest) :

- **Pas d'appel « au nom de » l'utilisateur** : l'API s'utilise avec un
  compte de service. Le portail applique donc lui-même les droits de chaque
  utilisateur, à partir des données EV : ses groupes (`/employees/{id}/groups`),
  son rôle sur le ticket (demandeur / bénéficiaire) et la personne ou le
  groupe de l'action en cours.
- **Traçabilité** : chaque action transmise à EV porte l'auteur réel
  (`done_by_id`, `doneby_mail`), la création porte le demandeur (`requestor_mail`).
- **Étape du ticket** = ses actions en cours
  (`/actions?search=request.rfc_number:"…",end_date_ut:"is_null"`), traduites
  par `correspondance.js`. EV n'expose pas le schéma des workflows : les
  boutons dépendent de la nature de l'action en cours.

| Bouton du portail | Appel EV |
|---|---|
| Prendre en charge | `PUT /actions/{id}` `{ done_by_id }` |
| Résoudre, Valider, Refuser, Confirmer, Contester | `PUT /actions/{rfc}` `{ end_action: { action_id, doneby_mail, choice } }` |
| Mettre en attente / Répondre, Reprendre | `PUT /requests/{rfc}` `{ suspended }` / `{ restarted }` |
| Transférer | `PUT /actions/{id}` `{ group_id }` + commentaire |
| Ajouter un commentaire | `POST /requests/{rfc}/actions` (type « Commentaire ») |
| Annuler ma demande | `PUT /requests/{rfc}` `{ closed: { status_guid } }` |
| Créer un ticket | `POST /requests` (catalogue, demandeur, urgence, impact) |

### À vérifier sur une vraie instance

Signalé par `A VERIFIER` dans `sources/clients/http.js` :
- les champs renvoyés par défaut par `/actions` (groupe, auteur, dates, commentaire) ;
- la forme exacte de la réponse de `/employees/{id}/groups` (EV 2023.2+) ;
- la possibilité de réaffecter une action (groupe, intervenant) par `PUT /actions/{id}` ;
- l'acceptation d'un commentaire dans `end_action` ;
- les droits du compte de service : la doc indique que seuls les membres du
  groupe d'une action peuvent la terminer.

## Variables d'environnement

| Variable | Valeurs | Défaut |
|---|---|---|
| `SOURCE` | `simulation`, `easyvista` | `simulation` |
| `EV_URL`, `EV_ACCOUNT`, `EV_TOKEN` | accès à l'API EV | requis si `SOURCE=easyvista` |
| `DEV_COMPTES` | e-mails proposés à la connexion de dev sur le vrai EV | 30 premiers employés |
| `AUTH_MODE` | `dev`, `sso` | `dev` en local, **obligatoire** en production |
| `PORT` | | `3000` |

`AUTH_MODE=dev` permet de se connecter sans mot de passe : à réserver à un
poste ou un réseau de test.

## Prochaines étapes

1. **Accès de test à l'API EV** : version d'EV, compte de service ou jeton
   (et ses groupes), liste des statuts et types d'action de vos workflows.
   Adapter `correspondance.js`, puis lever les points « à vérifier ».
2. **SSO** (Entra ID ou ADFS) : brancher `AUTH_MODE=sso` dans `auth.js` et
   retrouver l'employé EV par son e-mail.
