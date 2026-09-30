-- 001_portail.sql — copie locale des tickets EasyVista et sessions du portail.
--
-- Cache JETABLE : EasyVista reste la seule reference. Tout ce schema peut etre
-- vide sans risque, la synchro le reconstruit. Les colonnes "a plat" (statut,
-- groupe, dates...) sont calculees par le portail a chaque synchro, pour les
-- listes et pour le pole BI ; "data" garde le JSON EV brut (usage portail).

CREATE SCHEMA IF NOT EXISTS portail;

CREATE TABLE portail.tickets (
  numero            text PRIMARY KEY,          -- RFC_NUMBER EV (I260930_000012)
  request_id        bigint,                    -- REQUEST_ID EV
  type              text,                      -- INCIDENT / DEMANDE
  titre             text,
  statut            text,                      -- statut portail : OUVERT, EN_COURS, EN_ATTENTE, RESOLU, CLOTURE
  statut_ev         text,                      -- libelle du statut dans EV
  etape             text,                      -- etape affichee (A prendre en charge, En validation...)
  priorite          smallint,                  -- 1 (critique) a 4 (basse)
  catalogue         text,
  catalogue_chemin  text,
  etablissement_id  integer,
  etablissement     text,
  groupe_id         integer,
  groupe            text,
  intervenant_id    integer,
  intervenant       text,
  demandeur_id      integer,
  demandeur         text,
  valideur          text,
  date_creation     timestamptz,
  date_maj          timestamptz,
  echeance          timestamptz,
  ferme             boolean NOT NULL DEFAULT false,
  data              jsonb NOT NULL,            -- ticket EV brut
  synchro           timestamptz NOT NULL
);
CREATE INDEX tickets_maj_idx ON portail.tickets (date_maj);
CREATE INDEX tickets_ferme_idx ON portail.tickets (ferme);

CREATE TABLE portail.actions (
  action_id    text PRIMARY KEY,
  numero       text NOT NULL REFERENCES portail.tickets (numero) ON DELETE CASCADE,
  type_action  text,
  en_cours     boolean NOT NULL,
  group_id     integer,
  groupe       text,
  done_by_id   integer,
  auteur       text,
  debut        timestamptz,
  fin          timestamptz,
  choix        text,                           -- resultat d'une validation / confirmation (1 / 0)
  data         jsonb NOT NULL                  -- action EV brute
);
CREATE INDEX actions_numero_idx ON portail.actions (numero);
CREATE INDEX actions_groupe_idx ON portail.actions (group_id);
CREATE INDEX actions_auteur_idx ON portail.actions (done_by_id);
CREATE INDEX actions_en_cours_idx ON portail.actions (en_cours) WHERE en_cours;

-- Etat de la synchro (derniere synchro, erreur, anomalies de correspondance...)
CREATE TABLE portail.etat (
  cle     text PRIMARY KEY,
  valeur  text
);

-- Sessions de connexion : en base, elles survivent a un redemarrage du service.
CREATE TABLE portail.sessions (
  jeton           text PRIMARY KEY,
  utilisateur_id  integer NOT NULL,
  expire          timestamptz NOT NULL
);
CREATE INDEX sessions_expire_idx ON portail.sessions (expire);
