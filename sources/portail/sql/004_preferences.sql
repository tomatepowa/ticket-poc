-- 004_preferences.sql — préférences d'affichage de chaque utilisateur du portail.
--
-- Données propres au portail (pas à EasyVista) : vue affichée à l'ouverture...
-- Une ligne par utilisateur et par préférence. Non vidée par la remise à zéro
-- de la copie locale (ce n'est pas un cache).

CREATE TABLE portail.preferences (
  utilisateur_id  integer NOT NULL,              -- EMPLOYEE_ID EV
  cle             text NOT NULL,                 -- ex. vue_defaut
  valeur          text,
  PRIMARY KEY (utilisateur_id, cle)
);
