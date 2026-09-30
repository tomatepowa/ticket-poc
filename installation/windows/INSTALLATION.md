# Installation du portail tickets sur Windows Server

Installation 100 % Windows, sans Linux ni Docker : Node.js, PostgreSQL pour
Windows, et le portail tourné en **service Windows** (WinSW).

```
 Navigateurs des équipes ──HTTP(S)──> Service "PortailTickets" (Node.js, port 3000)
                                          │                    │
                                          │ SQL                │ HTTPS sortant
                                          ▼                    ▼
                                   PostgreSQL 16          API REST EasyVista
                                   base "portail"
                                          ▲
 Pôle BI (Power BI…) ──SQL, lecture seule─┘  (rôle bi_lecteur, schéma "bi")
```

La base PostgreSQL n'est qu'une **copie de travail** d'EasyVista (reconstruite
automatiquement si elle est vidée) plus les sessions de connexion.

## 1. Prérequis

| Élément | Version | Source |
|---|---|---|
| Windows Server | 2019 ou 2022 | — |
| Node.js | 22 LTS (ou 20 LTS), installeur `.msi` x64 | https://nodejs.org |
| PostgreSQL | 16, installeur Windows x64 | https://www.postgresql.org/download/windows/ |
| WinSW | 2.12, fichier `WinSW-x64.exe` | https://github.com/winsw/winsw/releases |

Accès réseau nécessaires :
- **sortant HTTPS** vers l'API EasyVista ;
- **sortant HTTPS** vers le registre npm (`registry.npmjs.org`) pendant
  l'installation — sinon, voir « Installation hors ligne » ;
- **entrant** sur le port du portail (3000 par défaut) depuis les postes des équipes ;
- **entrant** sur le port PostgreSQL (5432) depuis le poste ou serveur du pôle BI uniquement.

## 2. PostgreSQL

1. Lancer l'installeur PostgreSQL 16 (composants : serveur et outils en ligne
   de commande ; Stack Builder inutile). Noter le mot de passe du compte `postgres`.
   Le service Windows s'appelle `postgresql-x64-16`.
2. Créer la base et les deux comptes (remplacer les mots de passe) :

   ```powershell
   cd "C:\Program Files\PostgreSQL\16\bin"
   .\psql.exe -U postgres -v mdp_portail="<mot de passe du service>" -v mdp_bi="<mot de passe BI>" `
     -f C:\PortailTickets\installation\windows\creer-base.sql
   ```

   - `portail` : propriétaire de la base, utilisé par le service ;
   - `bi_lecteur` : lecture seule, limité au schéma `bi` (vues), requêtes limitées à 60 s.

Les tables et vues sont créées par le portail lui-même à son premier démarrage.

## 3. Portail

1. Copier le dossier du portail dans `C:\PortailTickets` (ou autre).
2. Télécharger `WinSW-x64.exe`.
3. Dans PowerShell **en tant qu'administrateur** :

   ```powershell
   cd C:\PortailTickets
   .\installation\windows\installer.ps1 -WinSW C:\Telechargements\WinSW-x64.exe -OuvrirPareFeu
   ```

   Au premier passage, le script crée `PortailTickets.xml` à la racine et s'arrête.
4. Compléter `PortailTickets.xml` (toutes les valeurs `A_COMPLETER`) :
   mot de passe du rôle `portail`, URL, compte et jeton de l'API EasyVista.
5. Relancer la même commande : dépendances, build, création et démarrage du service.
6. Ouvrir `http://<serveur>:3000`.

Le fichier `PortailTickets.xml` contient des secrets : le script en réserve la
lecture aux administrateurs et au compte SYSTEM.

**Compte du service** : par défaut, le service tourne sous `LocalSystem`. Pour
un compte de service dédié, ajouter dans `PortailTickets.xml` :
`<serviceaccount><domain>DOMAINE</domain><user>svc-portail</user><password>…</password><allowservicelogon>true</allowservicelogon></serviceaccount>`
(syntaxe WinSW 2.x)
(le compte doit pouvoir lire le dossier et écrire dans `journaux\`).

**Connexion** : `AUTH_MODE=dev` permet de se connecter **sans mot de passe** en
choisissant un compte : à réserver aux tests (limiter les comptes avec
`DEV_COMPTES`). La connexion SSO (AD) est la prochaine étape du projet.

## 4. Accès du pôle BI

1. Dans `C:\Program Files\PostgreSQL\16\data\postgresql.conf` : `listen_addresses = '*'`
   (ou l'adresse IP du serveur).
2. Dans `pg_hba.conf`, autoriser seulement le poste / serveur BI, seulement sur la base `portail` :

   ```
   host  portail  bi_lecteur  <IP du serveur BI>/32  scram-sha-256
   ```
3. Redémarrer le service `postgresql-x64-16`, ouvrir le port 5432 en entrée
   **pour cette seule adresse**.
4. Côté BI (Power BI : connecteur « Base de données PostgreSQL ») :
   serveur `<serveur>:5432`, base `portail`, utilisateur `bi_lecteur`.

Vues disponibles (schéma `bi`) :

| Vue | Contenu |
|---|---|
| `bi.tickets` | un ticket par ligne : type, statut, étape, priorité, catalogue, établissement, groupe, intervenant, demandeur, dates, échéance, retard, durée de traitement, description |
| `bi.actions` | historique : actions EV (type, groupe, auteur, début, fin, durée, décision de validation, commentaire) |
| `bi.charge_groupes` | tickets non clos par groupe et statut, dont en retard |
| `bi.synchro` | date de la dernière synchronisation avec EasyVista |

Les **descriptions et commentaires** (texte libre) sont exposés au pôle BI :
les utilisateurs ne saisissent pas de données de santé dans les tickets. Les
tableaux de bord et exports qui les reprennent suivent les mêmes règles de
diffusion que les tickets. Périmètre : tickets ouverts et tickets clos depuis
moins de `RETENTION_JOURS` (365 jours par défaut).

## 5. HTTPS (recommandé)

Le portail sert du HTTP. Pour du HTTPS avec le certificat de l'établissement,
placer IIS en frontal : modules **URL Rewrite** et **Application Request
Routing**, règle de proxy inverse vers `http://localhost:3000`, et ne plus
ouvrir le port 3000 qu'en local.

## 6. Mise à jour

1. Remplacer les fichiers du portail par la nouvelle version, **en gardant**
   `PortailTickets.exe`, `PortailTickets.xml` et `journaux\`.
2. Relancer `.\installation\windows\installer.ps1` (en administrateur) : le
   script arrête le service, reconstruit et le redémarre. Les évolutions de la
   base sont appliquées automatiquement au démarrage.

## 7. Installation hors ligne (serveur sans accès npm)

Sur un poste Windows x64 connecté, avec la même version de Node.js :

```powershell
npm ci
npm run build
npm prune --omit=dev
```

Copier tout le dossier (avec `node_modules` et `dist`) sur le serveur, puis :

```powershell
.\installation\windows\installer.ps1 -WinSW C:\Telechargements\WinSW-x64.exe -HorsLigne
```

## 8. Sauvegardes

La base est une copie reconstruite automatiquement depuis EasyVista : une perte
n'entraîne qu'une resynchronisation complète (et la reconnexion des
utilisateurs). Une sauvegarde n'est donc pas indispensable ; si la politique
d'exploitation l'exige : `pg_dump -U postgres -Fc portail > portail.dump` en
tâche planifiée. Les sauvegardes contiennent des données de tickets : même
protection que la base.

## 9. Dépannage

| Symptôme | Où regarder |
|---|---|
| Le service ne démarre pas | `journaux\PortailTickets.err.log` |
| `DATABASE_URL manquante` / connexion refusée | `PortailTickets.xml`, service `postgresql-x64-16` démarré, mot de passe du rôle `portail` |
| « Données EasyVista il y a … » qui vieillit, bandeau orange | accès sortant à l'API EV, jeton `EV_TOKEN` (journaux : « Synchro EasyVista en echec ») |
| « Correspondance EasyVista à compléter » (superviseurs) | statut / type d'action / groupe EV inconnu : adapter `sources\portail\correspondance.js` |
| Le pôle BI ne se connecte pas | `pg_hba.conf`, `listen_addresses`, pare-feu 5432 |

Commandes utiles : `Get-Service PortailTickets`, `Restart-Service PortailTickets`,
`.\PortailTickets.exe status`.
