-- 002_bi.sql — vues pour le pole BI (tableaux de bord).
--
-- Le pole BI interroge ces vues avec le role en lecture seule "bi_lecteur"
-- (cree a l'installation) : pas besoin d'acces a la base native d'EasyVista.
-- Ce sont des vues "contrat" : leurs colonnes restent stables meme si les
-- tables du portail evoluent.
--
-- DONNEES DE SANTE : les descriptions et commentaires (texte libre, qui peut
-- contenir des informations patient) ne sont PAS exposes. Le titre l'est :
-- a valider avec le DPO.
--
-- Perimetre : la copie locale garde les tickets ouverts et les tickets clos
-- depuis moins de RETENTION_JOURS (365 j par defaut).

CREATE SCHEMA IF NOT EXISTS bi;

COMMENT ON SCHEMA bi IS 'Vues de lecture pour le pole BI, alimentees par la synchro du portail avec EasyVista';

-- Un ticket par ligne.
CREATE VIEW bi.tickets AS
SELECT
  t.numero,
  t.type,
  t.titre,
  t.statut,
  t.statut_ev,
  t.etape,
  t.priorite,
  t.catalogue,
  t.catalogue_chemin,
  t.etablissement,
  t.groupe,
  t.intervenant,
  t.demandeur,
  t.valideur,
  t.date_creation,
  t.date_maj,
  t.echeance,
  t.ferme AS clos,
  (NOT t.ferme AND t.statut <> 'RESOLU' AND t.echeance < now()) AS en_retard,
  -- Duree de traitement (tickets resolus ou clos) : creation -> derniere mise a jour
  CASE WHEN t.statut IN ('RESOLU', 'CLOTURE')
       THEN round(extract(epoch FROM (t.date_maj - t.date_creation)) / 3600.0, 1) END AS duree_heures,
  t.synchro AS donnees_du
FROM portail.tickets t;

COMMENT ON VIEW bi.tickets IS 'Tickets EV (ouverts + clos recents), sans description ni commentaire';

-- Historique : une ligne par action EV (etapes, prises en charge, validations...).
CREATE VIEW bi.actions AS
SELECT
  a.numero,
  a.type_action,
  a.groupe,
  a.auteur,
  a.debut,
  a.fin,
  a.en_cours,
  CASE WHEN a.fin IS NOT NULL THEN round(extract(epoch FROM (a.fin - a.debut)) / 60.0) END AS duree_minutes,
  CASE a.choix WHEN '1' THEN 'accepte' WHEN '0' THEN 'refuse' END AS decision
FROM portail.actions a;

COMMENT ON VIEW bi.actions IS 'Actions EV des tickets (sans commentaire)';

-- Charge en cours par groupe et par statut.
CREATE VIEW bi.charge_groupes AS
SELECT
  coalesce(t.groupe, '(sans groupe)') AS groupe,
  t.statut,
  count(*) AS nb_tickets,
  count(*) FILTER (WHERE t.echeance < now() AND t.statut <> 'RESOLU') AS nb_en_retard
FROM portail.tickets t
WHERE NOT t.ferme
GROUP BY 1, 2;

COMMENT ON VIEW bi.charge_groupes IS 'Tickets non clos par groupe et statut';

-- Fraicheur des donnees, a afficher dans les tableaux de bord.
CREATE VIEW bi.synchro AS
SELECT
  (SELECT valeur::timestamptz FROM portail.etat WHERE cle = 'derniere_synchro') AS derniere_synchro,
  (SELECT valeur FROM portail.etat WHERE cle = 'erreur') AS erreur_en_cours,
  (SELECT count(*) FROM portail.tickets) AS nb_tickets;

COMMENT ON VIEW bi.synchro IS 'Date de la derniere synchronisation avec EasyVista';

-- Droits du role BI, s'il existe (cree par installation/windows/creer-base.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_lecteur') THEN
    GRANT USAGE ON SCHEMA bi TO bi_lecteur;
    GRANT SELECT ON ALL TABLES IN SCHEMA bi TO bi_lecteur;
  END IF;
END
$$;
