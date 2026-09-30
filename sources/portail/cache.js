// cache.js — copie locale (PostgreSQL, schema "portail") des tickets EasyVista.
//
// Cache JETABLE : EasyVista reste la seule reference. On y stocke les tickets
// et leurs actions (JSON EV brut + colonnes a plat calculees par le portail),
// pour que les listes, filtres et stats ne sollicitent pas EV a chaque
// affichage, et pour que le pole BI puisse interroger les vues du schema "bi".
// Vider ces tables est sans risque : la synchro les reconstruit.
//
// Donnees potentiellement sensibles (descriptions de tickets) : la base suit
// les regles de securite du serveur (acces, sauvegardes, chiffrement, HDS), et
// les tickets clos anciens sont purges (voir purger()).

const base = require("./base");
const M = require("./modele");

const date = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);
const nomPersonne = (ref) => {
  if (!ref?.LAST_NAME) return null;
  const [nom, prenom = ""] = String(ref.LAST_NAME).split(/,\s*/);
  return prenom ? `${prenom} ${nom}` : nom;
};

async function initialiser() {
  await base.migrer();
}

// Enregistre (ou remplace) un ticket et TOUTES ses actions.
// resume : colonnes a plat calculees par le portail (voir synchro.resumer()).
async function enregistrer(req, actions, resume, maintenant = new Date()) {
  await base.transaction(async (c) => {
    await c.query(
      `INSERT INTO portail.tickets (numero, request_id, type, titre, statut, statut_ev, etape, priorite, catalogue,
         catalogue_chemin, etablissement_id, etablissement, groupe_id, groupe, intervenant_id, intervenant,
         demandeur_id, demandeur, valideur, date_creation, date_maj, echeance, ferme, data, synchro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       ON CONFLICT (numero) DO UPDATE SET request_id = EXCLUDED.request_id, type = EXCLUDED.type,
         titre = EXCLUDED.titre, statut = EXCLUDED.statut, statut_ev = EXCLUDED.statut_ev, etape = EXCLUDED.etape,
         priorite = EXCLUDED.priorite, catalogue = EXCLUDED.catalogue, catalogue_chemin = EXCLUDED.catalogue_chemin,
         etablissement_id = EXCLUDED.etablissement_id, etablissement = EXCLUDED.etablissement,
         groupe_id = EXCLUDED.groupe_id, groupe = EXCLUDED.groupe, intervenant_id = EXCLUDED.intervenant_id,
         intervenant = EXCLUDED.intervenant, demandeur_id = EXCLUDED.demandeur_id, demandeur = EXCLUDED.demandeur,
         valideur = EXCLUDED.valideur, date_creation = EXCLUDED.date_creation, date_maj = EXCLUDED.date_maj,
         echeance = EXCLUDED.echeance, ferme = EXCLUDED.ferme, data = EXCLUDED.data, synchro = EXCLUDED.synchro`,
      [
        req.RFC_NUMBER,
        req.REQUEST_ID ?? null,
        resume.type,
        resume.titre,
        resume.statut,
        resume.statut_ev,
        resume.etape,
        resume.priorite,
        resume.catalogue,
        resume.catalogue_chemin,
        resume.etablissement?.id ?? null,
        resume.etablissement?.nom ?? null,
        resume.groupe?.id ?? null,
        resume.groupe?.nom ?? null,
        resume.intervenant?.id ?? null,
        resume.intervenant?.nom ?? null,
        resume.demandeur?.id ?? null,
        resume.demandeur?.nom ?? null,
        resume.valideur?.nom ?? null,
        date(resume.date_creation),
        date(resume.date_maj),
        date(resume.echeance),
        resume.ferme,
        req,
        maintenant.toISOString(),
      ]
    );
    await c.query("DELETE FROM portail.actions WHERE numero = $1", [req.RFC_NUMBER]);
    for (const a of actions) {
      await c.query(
        `INSERT INTO portail.actions (action_id, numero, type_action, en_cours, group_id, groupe, done_by_id, auteur,
           debut, fin, choix, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (action_id) DO UPDATE SET numero = EXCLUDED.numero, type_action = EXCLUDED.type_action,
           en_cours = EXCLUDED.en_cours, group_id = EXCLUDED.group_id, groupe = EXCLUDED.groupe,
           done_by_id = EXCLUDED.done_by_id, auteur = EXCLUDED.auteur, debut = EXCLUDED.debut, fin = EXCLUDED.fin,
           choix = EXCLUDED.choix, data = EXCLUDED.data`,
        [
          String(a.ACTION_ID),
          req.RFC_NUMBER,
          M.nomType(a) || null,
          !a.END_DATE_UT,
          M.idGroupe(a),
          a.GROUP?.GROUP_FR || a.GROUP?.GROUP_EN || null,
          M.idAuteur(a),
          nomPersonne(a.DONE_BY),
          date(a.START_DATE_UT),
          date(a.END_DATE_UT),
          a.CHOICE ?? null,
          a,
        ]
      );
    }
  });
}

async function supprimer(rfc) {
  // Les actions suivent (ON DELETE CASCADE).
  await base.requete("DELETE FROM portail.tickets WHERE numero = $1", [rfc]);
}

// Regroupe les actions de plusieurs tickets, triees par identifiant.
async function actionsDe(rfcs) {
  if (!rfcs.length) return new Map();
  const { rows } = await base.requete(
    "SELECT numero, data FROM portail.actions WHERE numero = ANY($1) ORDER BY numero, length(action_id), action_id",
    [rfcs]
  );
  const parRfc = new Map(rfcs.map((r) => [r, []]));
  for (const r of rows) parRfc.get(r.numero).push(r.data);
  return parRfc;
}

async function lire(rfc) {
  const { rows } = await base.requete("SELECT data, synchro FROM portail.tickets WHERE numero = $1", [rfc]);
  if (!rows.length) return null;
  return { req: rows[0].data, actions: (await actionsDe([rfc])).get(rfc), synchro: rows[0].synchro.toISOString() };
}

// Tickets candidats pour une liste : tous (superviseur) ou ceux ayant touche mes
// groupes / m'ayant ete affectes. Tickets ouverts + clos recemment (depuisClos).
async function candidats({ tous = false, groupes = [], personne = null, depuisClos, limite = 2000 }) {
  const params = [depuisClos, limite];
  let filtre = "";
  if (!tous) {
    params.push(groupes.map(Number).filter(Number.isFinite), personne == null ? null : Number(personne));
    filtre = `AND t.numero IN (SELECT a.numero FROM portail.actions a WHERE a.group_id = ANY($3) OR a.done_by_id = $4)`;
  }
  const { rows } = await base.requete(
    `SELECT t.numero, t.data, t.synchro FROM portail.tickets t
     WHERE (NOT t.ferme OR t.date_maj >= $1) ${filtre}
     ORDER BY t.date_creation DESC LIMIT $2`,
    params
  );
  const actions = await actionsDe(rows.map((r) => r.numero));
  return rows.map((r) => ({ req: r.data, actions: actions.get(r.numero), synchro: r.synchro.toISOString() }));
}

// { numero: LAST_UPDATE EV tel quel } pour comparer avec EV.
async function versions() {
  const { rows } = await base.requete("SELECT numero, data->>'LAST_UPDATE' AS maj FROM portail.tickets");
  return new Map(rows.map((r) => [r.numero, r.maj]));
}

// Actions en cours connues du cache, par ticket : { numero: Set(action_id) }.
async function actionsEnCours() {
  const { rows } = await base.requete("SELECT numero, action_id FROM portail.actions WHERE en_cours");
  const parRfc = new Map();
  for (const { numero, action_id } of rows) {
    if (!parRfc.has(numero)) parRfc.set(numero, new Set());
    parRfc.get(numero).add(String(action_id));
  }
  return parRfc;
}

async function lireEtat(cle) {
  const { rows } = await base.requete("SELECT valeur FROM portail.etat WHERE cle = $1", [cle]);
  return rows[0]?.valeur ?? null;
}

async function ecrireEtat(cle, valeur) {
  await base.requete(
    "INSERT INTO portail.etat (cle, valeur) VALUES ($1, $2) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur",
    [cle, valeur == null ? null : String(valeur)]
  );
}

async function compter() {
  return Number((await base.requete("SELECT count(*) AS n FROM portail.tickets")).rows[0].n);
}

// Minimisation des donnees : on ne garde pas les tickets clos au-dela de la retention.
async function purger(avant) {
  return (await base.requete("DELETE FROM portail.tickets WHERE ferme AND date_maj < $1", [avant])).rowCount;
}

async function vider() {
  await base.requete("TRUNCATE portail.actions, portail.tickets, portail.etat");
}

// ---------- Sessions de connexion ----------

const sessions = {
  async creer(jeton, utilisateurId, expire) {
    await base.requete("INSERT INTO portail.sessions (jeton, utilisateur_id, expire) VALUES ($1, $2, $3)", [
      jeton,
      utilisateurId,
      expire.toISOString(),
    ]);
  },
  async lire(jeton) {
    const { rows } = await base.requete(
      "SELECT utilisateur_id FROM portail.sessions WHERE jeton = $1 AND expire > now()",
      [jeton]
    );
    return rows[0] ? { utilisateurId: rows[0].utilisateur_id } : null;
  },
  async supprimer(jeton) {
    await base.requete("DELETE FROM portail.sessions WHERE jeton = $1", [jeton]);
  },
  async purger() {
    await base.requete("DELETE FROM portail.sessions WHERE expire <= now()");
  },
};

module.exports = {
  initialiser,
  enregistrer,
  supprimer,
  lire,
  candidats,
  versions,
  actionsEnCours,
  lireEtat,
  ecrireEtat,
  compter,
  purger,
  vider,
  sessions,
  fermer: () => base.fermer(),
};
