-- 003_bi_texte_libre.sql — texte libre expose au pole BI.
--
-- Decision du 01/10/2026 : les descriptions de tickets et les commentaires des
-- actions sont ajoutes aux vues BI (les utilisateurs ne saisissent pas de
-- donnees de sante dans les tickets). A garder sous le regard du DPO.
--
-- Colonnes AJOUTEES A LA FIN des vues existantes (CREATE OR REPLACE VIEW ne
-- permet que ca) : les requetes et tableaux de bord existants ne changent pas.
-- Les droits du role bi_lecteur sont conserves.

CREATE OR REPLACE VIEW bi.tickets AS
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
  CASE WHEN t.statut IN ('RESOLU', 'CLOTURE')
       THEN round(extract(epoch FROM (t.date_maj - t.date_creation)) / 3600.0, 1) END AS duree_heures,
  t.synchro AS donnees_du,
  nullif(t.data->>'DESCRIPTION', '') AS description
FROM portail.tickets t;

COMMENT ON VIEW bi.tickets IS 'Tickets EV (ouverts + clos recents), description comprise';

CREATE OR REPLACE VIEW bi.actions AS
SELECT
  a.numero,
  a.type_action,
  a.groupe,
  a.auteur,
  a.debut,
  a.fin,
  a.en_cours,
  CASE WHEN a.fin IS NOT NULL THEN round(extract(epoch FROM (a.fin - a.debut)) / 60.0) END AS duree_minutes,
  CASE a.choix WHEN '1' THEN 'accepte' WHEN '0' THEN 'refuse' END AS decision,
  nullif(a.data->>'COMMENT', '') AS commentaire
FROM portail.actions a;

COMMENT ON VIEW bi.actions IS 'Actions EV des tickets, commentaire compris';
