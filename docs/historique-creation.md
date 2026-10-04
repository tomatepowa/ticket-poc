# Création du portail tickets-poc : les étapes

Portail tickets IT : un **affichage simplifié d'EasyVista** pour les
équipes support et les cadres valideurs. EasyVista reste maître des tickets,
des étapes, des droits et de l'historique ; le portail affiche et transmet.

Du 27/09/2026 au 05/10/2026, 36 commits.

## 1. Le socle (27/09)

- Backend Express + front Vue 3 / Vite.
- Deux sources possibles : l'API REST EasyVista réelle, ou un **faux EV** qui
  parle comme elle (l'API et l'AD n'étant pas encore accessibles).
- Droits et connexion de développement avec des comptes fictifs.

## 2. Recentrage : un outil pour le support (30/09)

- Le portail devient l'**outil des équipes support** : pas de front office
  pour les utilisateurs finaux, le support **saisit le ticket pour le
  compte du demandeur** (appel, passage, mail).
- Profils déduits des groupes EV : intervenant, superviseur, valideur. Les
  autres employés n'ont pas accès, et les cadres valideurs ne font que
  valider ou refuser.
- **Copie locale synchronisée** d'EV (d'abord SQLite) : synchro par
  différence toutes les N secondes, complète toutes les 24 h, purge des
  vieux tickets clos. Les listes lisent la copie ; le détail est lu en
  direct dans EV. Si EV est injoignable : lecture seule avec avertissement.
- Faux EV peuplé aux couleurs d'un groupe fictif de cliniques privées : établissements, 11 groupes
  support, cadres valideurs, catalogue.

## 3. Rester générique vis-à-vis d'EasyVista (01/10)

- **Formulaires EV génériques** : aucun formulaire codé en dur, le portail
  affiche n'importe quel questionnaire EV (questions conditionnelles,
  champs obligatoires, contrôle côté serveur).
- Référentiels désactivés masqués (établissements, catalogue, employés
  partis).
- **Contrôle de correspondance** : statuts, types d'action ou groupes
  inconnus signalés aux superviseurs.

## 4. Production et pôle BI (01/10)

- Passage à **PostgreSQL** : copie locale, sessions persistantes, migrations
  SQL appliquées au démarrage.
- **Schéma `bi`** de vues stables en lecture seule pour le pôle BI, sans
  accès à la base native d'EV. Descriptions et commentaires ajoutés ensuite,
  après la décision de ne pas saisir de données de santé dans les tickets.
- **Installation Windows native** (sans Linux ni Docker) : script
  PowerShell, service Windows, IIS pour le HTTPS, sauvegardes.

## 5. Le travail quotidien du support (01/10)

- **Vues** : file de mes groupes, non affectés, affectés à moi, attendent
  mon action.
- **Affectation visible** dans la liste (moi / un autre / personne).
- **Réaffecter** à un collègue, **remettre dans le groupe**, y compris en
  lot, avec trace dans l'historique EV.
- Liste **triable** par colonne, sélection multiple, tenue sans défilement
  horizontal sur un écran 1366 px.

## 6. Outillage et qualité (01/10)

- `npm run dev` : une commande lance Docker, PostgreSQL et le portail, avec
  redémarrage automatique du serveur.
- **Tests automatisés** (`npm test`) et intégration continue GitHub Actions,
  dont des tests PostgreSQL de bout en bout, indépendants du paramétrage EV.
- **Démo en volume** : environ 1 300 tickets générés sur 90 jours.

## 7. Ergonomie : itérations rapides (01/10)

Une série de retouches guidées par l'usage :

- Filtres en **un clic** depuis la liste (groupe, établissement,
  affectation, demandeur), cartes de stats cliquables.
- Statut « Actifs » par défaut, compteurs par statut et par établissement
  qui suivent la vue.
- **Vue et statut par défaut mémorisés par utilisateur**.
- Résumé des **filtres actifs** en haut, avec retrait d'un clic.
- Rail réorganisé : recherche en haut, établissements puis groupes en
  listes à cocher, charge par groupe intégrée au filtre Groupe.
- Simplifications : retrait des doublons (légende, cartes de vues), détail
  d'un ticket allégé avec l'historique remonté.
- Liste rechargée seulement quand la synchro a réellement changé des
  tickets.
- Contraste du thème clair revu ; thème sombre disponible.

## 8. Contenu des tickets et documentation (01/10)

- **Captures d'écran collées** et **pièces jointes** visibles dans le
  détail, agrandissables.
- Nom du demandeur cliquable : tous ses tickets.
- Documentation remise en ordre : README, guide d'installation, captures
  d'écran régénérables (`npm run captures`).

## 9. Tickets non affectés plus visibles (02/10)

- **Tickets non affectés plus visibles**, surtout en thème clair : badge
  plein rose (même couleur que la carte de stats « Non affectés ») et barre
  rose à gauche de la ligne.

## 10. Démo plus réaliste pour tester la lisibilité (04/10)

- Même volume (environ 1 300 tickets), mais un **contenu plus riche** :
  descriptions sur plusieurs lignes (texte simple ou HTML de l'éditeur EV,
  « déjà essayé », signature), commentaires détaillés.
- **Échanges qui se suivent** entre intervenant et demandeur : question,
  réponse, précision, relances pendant une mise en attente.

## 11. Saisie en hotline (05/10)

- Au téléphone, la solution est souvent trouvée pendant l'appel : un champ
  **« Solution apportée »** permet de créer, prendre, résoudre et clôturer
  le ticket **en un seul envoi** (bouton ou Ctrl+Entrée).
- Pas de raccourci par rapport à EV : le portail **enchaîne les boutons du
  détail**, avec les mêmes droits. Si EV oriente le ticket vers un autre
  groupe ou vers une validation, il suit son cours et la solution est gardée
  en commentaire.
- Saisie rapide : demandeur au clavier, titre facultatif (libellé du
  catalogue par défaut), établissement prérempli, bouton d'envoi toujours
  visible, notes protégées d'une fermeture par erreur, formulaire vidé pour
  l'appel suivant.

## Principes tenus tout au long

- **EasyVista est maître** : le portail n'invente ni étape, ni droit, ni
  contenu ; toute action est transmise à EV puis relue.
- **Copie locale jetable** : elle sert à l'affichage rapide et au BI, et
  peut être reconstruite à tout moment.
- **Rien de codé en dur** côté paramétrage EV (formulaires, statuts,
  groupes), avec signalement de ce qui ne correspond pas.
- **Simplicité** : chaque ajout d'ergonomie a été suivi d'un retrait des
  doublons.

## Reste à faire

- Brancher la vraie API EasyVista et l'annuaire AD.
- Vérifier sur une instance réelle les routes encore supposées
  (questionnaires, format des captures et pièces jointes).
- Vérifier que le compte de service peut terminer les actions des groupes
  support (indispensable à la clôture directe en hotline).
