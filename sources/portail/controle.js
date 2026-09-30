// controle.js — la correspondance EV -> portail est-elle toujours complete ?
//
// correspondance.js reference des statuts, types d'action et groupes EV. Si
// l'admin EV en cree ou en renomme, le portail les interpreterait mal sans le
// dire (etape inconnue, profil perdu). Ce controle, lance apres chaque synchro,
// liste ce qui manque pour que les superviseurs le voient le jour meme.

const cfg = require("./correspondance");
const M = require("./modele");

// contextes : [{ req, actions }] (tickets du cache) ; groupesEV : GET /groups
function verifierCorrespondance(contextes, groupesEV) {
  const anomalies = new Map();
  const signaler = (type, valeur, rfc) => {
    const cle = `${type}:${valeur}`;
    const a = anomalies.get(cle) || { type, valeur, nb_tickets: 0, exemple: rfc };
    a.nb_tickets++;
    anomalies.set(cle, a);
  };
  const horsWorkflow = cfg.typesActionHorsWorkflow.map(String);

  for (const { req, actions } of contextes) {
    if (!M.statutConnu(req)) signaler("statut", M.nomStatut(req) || req.STATUS?.STATUS_GUID || "?", req.RFC_NUMBER);
    for (const a of actions) {
      if (a.END_DATE_UT || M.etapeWorkflow(a)) continue;
      const nom = M.nomType(a);
      if (horsWorkflow.includes(nom) || horsWorkflow.includes(String(M.idTypeAction(a)))) continue;
      signaler("type_action", nom || `#${M.idTypeAction(a)}`, req.RFC_NUMBER);
    }
  }

  // Groupes qui donnent un profil : s'ils disparaissent ou sont renommes dans EV,
  // les superviseurs / valideurs perdent leur acces.
  const groupes = groupesEV.map((g) => ({ id: String(g.GROUP_ID), nom: g.GROUP_FR || g.GROUP_EN }));
  for (const ref of [...cfg.groupesSuperviseurs, ...cfg.groupesValideurs].map(String)) {
    if (!groupes.some((g) => g.id === ref || g.nom === ref)) signaler("groupe", ref, null);
  }

  return [...anomalies.values()].sort((a, b) => b.nb_tickets - a.nb_tickets);
}

module.exports = { verifierCorrespondance };
