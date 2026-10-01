-- 005_texte_seul.sql — descriptions et commentaires en texte seul.
--
-- Dans EasyVista, descriptions et commentaires peuvent être du HTML, avec des
-- captures d'écran collées dedans. La copie locale garde ce HTML sans les images
-- intégrées (elles restent dans EV), et une version texte seul, calculée par le
-- portail (sources/portail/texte.js) : c'est elle que voit le pôle BI.
--
-- Les lignes existantes sont complétées à la prochaine synchro (en attendant :
-- approximation SQL ci-dessous, balises retirées).

ALTER TABLE portail.tickets ADD COLUMN description_texte text;
ALTER TABLE portail.actions ADD COLUMN commentaire_texte text;

UPDATE portail.tickets SET description_texte = nullif(btrim(regexp_replace(data->>'DESCRIPTION', '<[^>]*>', ' ', 'g')), '');
UPDATE portail.actions SET commentaire_texte = nullif(btrim(regexp_replace(data->>'COMMENT', '<[^>]*>', ' ', 'g')), '');

-- Vues BI : mêmes colonnes, contenu en texte seul (CREATE OR REPLACE garde les
-- droits du rôle bi_lecteur et les tableaux de bord existants).
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
  t.description_texte AS description
FROM portail.tickets t;

COMMENT ON VIEW bi.tickets IS 'Tickets EV (ouverts + clos recents), description en texte seul';

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
  a.commentaire_texte AS commentaire
FROM portail.actions a;

COMMENT ON VIEW bi.actions IS 'Actions EV des tickets, commentaire en texte seul';
