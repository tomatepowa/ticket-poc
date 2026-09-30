-- creer-base.sql — base PostgreSQL du portail tickets (a lancer UNE fois, en superutilisateur).
--
-- Utilisation (PowerShell, depuis le dossier bin de PostgreSQL ou avec psql dans le PATH) :
--   psql -U postgres -v mdp_portail="<mot de passe du service>" -v mdp_bi="<mot de passe BI>" -f creer-base.sql
--
-- Cree :
--   - le role "portail"    : proprietaire de la base, utilise par le service du portail ;
--   - le role "bi_lecteur" : lecture seule, limite aux vues du schema "bi" (pole BI) ;
--   - la base "portail" et ses schemas. Les tables et vues sont creees ensuite
--     par le portail lui-meme au demarrage (migrations).

\set ON_ERROR_STOP on

CREATE ROLE portail LOGIN PASSWORD :'mdp_portail';
CREATE ROLE bi_lecteur LOGIN PASSWORD :'mdp_bi';

CREATE DATABASE portail OWNER portail ENCODING 'UTF8' TEMPLATE template0;

\connect portail

-- Personne d'autre que ces deux roles ne se connecte ; rien dans "public".
REVOKE ALL ON DATABASE portail FROM PUBLIC;
GRANT CONNECT ON DATABASE portail TO portail, bi_lecteur;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Schemas du portail (tables) et du pole BI (vues).
CREATE SCHEMA portail AUTHORIZATION portail;
CREATE SCHEMA bi AUTHORIZATION portail;

-- Le role BI ne voit QUE le schema "bi" : les vues sont lisibles, les tables
-- du portail (qui contiennent les descriptions en texte libre) ne le sont pas.
GRANT USAGE ON SCHEMA bi TO bi_lecteur;
ALTER DEFAULT PRIVILEGES FOR ROLE portail IN SCHEMA bi GRANT SELECT ON TABLES TO bi_lecteur;

-- Garde-fous pour les requetes BI : lecture seule, requetes limitees a 60 s.
ALTER ROLE bi_lecteur SET default_transaction_read_only = on;
ALTER ROLE bi_lecteur SET statement_timeout = '60s';
