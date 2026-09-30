// modele.js — interpretation des donnees EasyVista par le portail.
//
// Fonctions pures : a partir d'un ticket EV et de ses actions (format de
// l'API REST), on calcule l'etape affichee, les droits de l'utilisateur et
// les boutons qu'il peut utiliser. L'API EV s'appelle avec un compte de
// service (pas d'appel "au nom de" l'utilisateur) : c'est donc ICI que les
// droits de chaque utilisateur sont appliques, d'apres ses groupes EV et son
// role sur le ticket.

const cfg = require("./correspondance");

// ---------- Lecture des champs EV ----------

function decouperNom(lastName) {
  // EV stocke "Nom, Prenom"
  const [nom, prenom = ""] = String(lastName || "").split(/,\s*/);
  return { nom, prenom };
}
const nomComplet = (lastName) => {
  const { nom, prenom } = decouperNom(lastName);
  return prenom ? `${prenom} ${nom}` : nom;
};
const personne = (ref) => (ref && ref.EMPLOYEE_ID ? { id: Number(ref.EMPLOYEE_ID), nom: nomComplet(ref.LAST_NAME) } : null);

const nomType = (a) => a.ACTION_TYPE?.NAME_FR || a.ACTION_TYPE?.NAME_EN || "";
const idGroupe = (a) => Number(a.GROUP?.GROUP_ID ?? a.GROUP_ID) || null;
const nomGroupe = (a) => a.GROUP?.GROUP_FR || a.GROUP?.GROUP_EN || null;
const idAuteur = (a) => Number(a.DONE_BY_ID ?? a.DONE_BY?.EMPLOYEE_ID) || null;
const rfcAction = (a) => a.REQUEST?.RFC_NUMBER;
// Correspondance : on cherche par identifiant EV d'abord, puis par libelle.
const valeurs = (...cles) => cles.filter((k) => k != null && k !== "").map(String);
function chercher(table, ...cles) {
  for (const k of valeurs(...cles)) if (table[k] !== undefined) return table[k];
  return undefined;
}
const dansListe = (liste, ...cles) => valeurs(...cles).some((k) => liste.map(String).includes(k));

const idTypeAction = (a) => a.ACTION_TYPE?.ACTION_TYPE_ID ?? a.ACTION_TYPE_ID;
const etapeWorkflow = (a) => chercher(cfg.typesAction, idTypeAction(a), nomType(a)) || null;
const nomStatut = (req) => req.STATUS?.STATUS_FR || req.STATUS?.STATUS_EN || "";
const clesStatut = (req) => [req.STATUS?.STATUS_GUID, req.STATUS?.STATUS_ID, nomStatut(req)];
const statutConnu = (req) => chercher(cfg.statuts, ...clesStatut(req));
const estStatut = (req, ...refs) => refs.some((ref) => valeurs(...clesStatut(req)).includes(String(ref)));
// g = { id, nom } d'un groupe EV
const estSuperviseurGroupe = (g) => dansListe(cfg.groupesSuperviseurs, g.id, g.nom);
const estValideurGroupe = (g) => dansListe(cfg.groupesValideurs, g.id, g.nom);
// Groupes qui donnent un profil mais ne traitent pas de tickets.
const estGroupeTechnique = (g) => estSuperviseurGroupe(g) || estValideurGroupe(g);

// Element desactive dans EV : date de fin / de depart passee.
function estInactif(rec, champ) {
  const v = champ ? rec?.[champ] : null;
  return Boolean(v) && new Date(v).getTime() <= Date.now();
}

function typeDepuisChemin(chemin) {
  const entree = Object.entries(cfg.typeDepuisCheminCatalogue).find(([prefixe]) => String(chemin || "").startsWith(prefixe));
  return entree ? entree[1] : "INCIDENT";
}

// "Incidents/Infrastructure/Messagerie/Messagerie (Outlook)" -> libelle + chemin lisible
function lireCatalogue(chemin, titre) {
  let c = String(chemin || "");
  // Le titre peut lui-meme contenir un "/" : on le retire du chemin avant de decouper.
  if (titre && c.endsWith(`/${titre}`)) c = c.slice(0, -titre.length - 1);
  const segments = c.split("/").filter(Boolean);
  const libelle = titre || segments.pop() || "";
  return { libelle, chemin: segments.slice(1).join(" › ") };
}

const inverser = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [String(v), Number(k)]));
const NIVEAU_URGENCE = inverser(cfg.urgenceEV);
const NIVEAU_IMPACT = inverser(cfg.impactEV);

function priorite(req) {
  const u = NIVEAU_URGENCE[String(req.URGENCY_ID ?? req.URGENCY?.URGENCY_ID)];
  const i = NIVEAU_IMPACT[String(req.SEVERITY_ID ?? req.SEVERITY?.SEVERITY_ID ?? req.IMPACT_ID)];
  return cfg.matricePriorite[i]?.[u] || 3;
}

// ---------- Utilisateur ----------

function versUtilisateur(employe, groupesEV) {
  const { nom, prenom } = decouperNom(employe.LAST_NAME);
  const groupes = groupesEV.map((g) => ({ id: Number(g.GROUP_ID), nom: g.GROUP_FR || g.GROUP_EN }));
  const intervention = groupes.filter((g) => !estGroupeTechnique(g));
  const profil = estInactif(employe, cfg.champsFin.employe)
    ? "AUCUN" // parti : plus d'acces, quels que soient ses groupes
    : groupes.some((g) => estSuperviseurGroupe(g))
    ? "SUPERVISEUR"
    : intervention.length
      ? "INTERVENANT"
      : groupes.some((g) => estValideurGroupe(g))
        ? "VALIDEUR"
        : "AUCUN"; // pas d'acces au portail
  return {
    id: Number(employe.EMPLOYEE_ID),
    prenom,
    nom,
    nom_complet: prenom ? `${prenom} ${nom}` : nom,
    e_mail: employe.E_MAIL,
    fonction: employe.JOB_TITLE || "",
    profil,
    site: employe.LOCATION?.LOCATION_ID
      ? { id: Number(employe.LOCATION.LOCATION_ID), nom: employe.LOCATION.LOCATION_FR || employe.LOCATION.LOCATION_EN }
      : null,
    groupes: intervention,
  };
}

// ---------- Analyse d'un ticket ----------

// `actions` : toutes les actions connues du ticket (au minimum celles en cours).
function analyser(req, actions) {
  const workflow = actions.filter((a) => !a.END_DATE_UT && etapeWorkflow(a));
  const principale = workflow[0] || null;
  const tc = principale ? etapeWorkflow(principale) : null;
  const statutEV = nomStatut(req);
  const suspendu = estStatut(req, cfg.statutSuspendu);
  const affecte = principale ? idAuteur(principale) : null;

  let statut = statutConnu(req) || "EN_COURS";
  if (!suspendu && tc?.nature === "TRAITEMENT" && !affecte && statut === "EN_COURS") statut = "OUVERT";

  let etape;
  if (tc) {
    etape = tc.nature === "TRAITEMENT" && !affecte
      ? { code: tc.codeNonAffecte, label: tc.etapeNonAffectee }
      : { code: tc.code, label: tc.etape };
  } else {
    const fin = statut === "CLOTURE" && !estStatut(req, ...cfg.statutsSortie);
    etape = { code: fin ? "CLOTURE" : "HORS_PARCOURS", label: statutEV || "Inconnu" };
  }

  // Groupe affiche : celui du traitement en cours, sinon le dernier groupe d'intervenants connu
  // (le groupe porteur d'une validation n'a pas de sens pour l'utilisateur).
  const avecGroupe = [...actions].reverse().find((a) => idGroupe(a) && !estGroupeTechnique({ id: idGroupe(a), nom: nomGroupe(a) }));
  const refGroupe = (tc?.nature === "TRAITEMENT" ? principale : null) || avecGroupe;
  const validation = actions.find((a) => etapeWorkflow(a)?.nature === "VALIDATION");

  return {
    req,
    actions,
    principale,
    tc,
    statutEV,
    suspendu,
    statut,
    etapeSousJacente: etape,
    etape: suspendu ? { code: "SUSPENDU", label: "En attente" } : etape,
    groupe: refGroupe && idGroupe(refGroupe) ? { id: idGroupe(refGroupe), nom: nomGroupe(refGroupe) } : null,
    intervenant: principale ? personne(principale.DONE_BY) : null,
    valideur: validation ? personne(validation.DONE_BY) : null,
    type: cfg.typeDepuisNumero[String(req.RFC_NUMBER)[0]] || "INCIDENT",
  };
}

// ---------- Droits ----------

function roles(u, ctx) {
  const superviseur = u.profil === "SUPERVISEUR";
  const mesGroupes = new Set(u.groupes.map((g) => g.id));
  const demandeur = [ctx.req.REQUESTOR, ctx.req.RECIPIENT].some((p) => p && Number(p.EMPLOYEE_ID) === u.id);
  return {
    superviseur,
    demandeur,
    dansGroupe: (a) => superviseur || mesGroupes.has(idGroupe(a)),
    assigne: (a) => idAuteur(a) === u.id,
    mesGroupes,
  };
}

// Outil reserve aux equipes : on voit un ticket si l'un de ses groupes (passe ou
// present) est le sien, s'il nous a ete affecte (y compris une validation), ou si
// on est superviseur.
function peutVoir(u, ctx) {
  const r = roles(u, ctx);
  return r.superviseur || ctx.actions.some((a) => r.mesGroupes.has(idGroupe(a)) || idAuteur(a) === u.id);
}

// Boutons proposes a l'utilisateur. `op` decrit l'appel EV a faire (reste cote serveur).
// Pas d'action "demandeur" : le support agit pour le compte de l'utilisateur
// (reprise apres reponse, cloture apres confirmation, reouverture).
function actionsPossibles(u, ctx) {
  const r = roles(u, ctx);
  const p = ctx.principale;
  const intervenant = u.profil === "INTERVENANT" || u.profil === "SUPERVISEUR";
  const res = [];
  if (ctx.statut === "CLOTURE") return res;

  if (ctx.suspendu) {
    if (intervenant && (p ? r.dansGroupe(p) : r.superviseur)) {
      res.push({ code: "REPRENDRE", label: "Reprendre le traitement", op: { type: "REPRENDRE" } });
    }
  } else if (p) {
    const tc = ctx.tc;
    const id = p.ACTION_ID;
    if (tc.nature === "TRAITEMENT" && intervenant && r.dansGroupe(p)) {
      if (!r.assigne(p)) {
        res.push({ code: "PRENDRE", label: idAuteur(p) ? "M'affecter le ticket" : "Prendre en charge", op: { type: "AFFECTER", action_id: id } });
      }
      if (idAuteur(p)) {
        res.push({ code: "TERMINER", label: tc.terminer, commentaire: true, op: { type: "TERMINER", action_id: id } });
        res.push({ code: "SUSPENDRE", label: "Mettre en attente", commentaire: true, op: { type: "SUSPENDRE" } });
      }
      res.push({ code: "TRANSFERER", label: "Transférer", commentaire: true, parametre: "groupe", op: { type: "TRANSFERER", action_id: id } });
    }
    if (tc.nature === "VALIDATION" && (r.assigne(p) || r.superviseur)) {
      res.push({ code: "VALIDER", label: "Valider la demande", op: { type: "TERMINER", action_id: id, choice: "1" } });
      res.push({ code: "REFUSER", label: "Refuser", commentaire: true, op: { type: "TERMINER", action_id: id, choice: "0" } });
    }
    if (tc.nature === "CONFIRMATION" && intervenant && r.dansGroupe(p)) {
      res.push({ code: "CLOTURER", label: "Clôturer (résolution confirmée)", op: { type: "TERMINER", action_id: id, choice: "1" } });
      res.push({ code: "ROUVRIR", label: "Rouvrir (pas résolu)", commentaire: true, op: { type: "TERMINER", action_id: id, choice: "0" } });
    }
  }

  // Action "secondaire" : toujours possible, mais pas attendue.
  if (intervenant || (p && r.assigne(p))) {
    res.push({ code: "COMMENTER", label: "Ajouter un commentaire", commentaire: true, secondaire: true, op: { type: "COMMENTER" } });
  }
  return res;
}

const attendMonAction = (u, ctx) => actionsPossibles(u, ctx).some((a) => !a.secondaire);

// A qui est l'etape en cours, du point de vue de l'utilisateur :
//   "MOI" (affectee a moi), "TIERS" (a quelqu'un d'autre), "AUCUN" (personne), null (ticket sans etape en cours)
function affectation(u, ctx) {
  if (!ctx.principale) return null;
  const auteur = idAuteur(ctx.principale);
  if (!auteur) return "AUCUN";
  return auteur === u.id ? "MOI" : "TIERS";
}

// ---------- Mise en forme pour le front ----------

// titresCatalogue : Map SD_CATALOG_ID -> titre, pour decouper correctement le chemin.
function versTicket(ctx, u, titresCatalogue = new Map()) {
  const { req } = ctx;
  const statutTermine = ctx.statut === "RESOLU" || ctx.statut === "CLOTURE";
  return {
    id: req.RFC_NUMBER,
    numero: req.RFC_NUMBER,
    type: ctx.type,
    type_label: ctx.type === "INCIDENT" ? "Incident" : "Demande",
    titre: req.TITLE || String(req.DESCRIPTION || "").slice(0, 80) || req.RFC_NUMBER,
    description: req.DESCRIPTION || "",
    etape: ctx.etape,
    statut: ctx.statut,
    statut_ev: ctx.statutEV,
    priorite: priorite(req),
    catalogue: lireCatalogue(req.SD_CATALOG_PATH, titresCatalogue.get(String(req.SD_CATALOG_ID))),
    etablissement: req.LOCATION?.LOCATION_ID
      ? { id: Number(req.LOCATION.LOCATION_ID), nom: req.LOCATION.LOCATION_FR || req.LOCATION.LOCATION_EN }
      : null,
    groupe: ctx.groupe,
    intervenant: ctx.intervenant,
    demandeur: personne(req.REQUESTOR),
    valideur: ctx.valideur,
    date_creation: req.SUBMIT_DATE_UT,
    date_maj: req.LAST_UPDATE || req.SUBMIT_DATE_UT,
    echeance: req.MAX_RESOLUTION_DATE_UT || null,
    en_retard: !statutTermine && Boolean(req.MAX_RESOLUTION_DATE_UT) && new Date(req.MAX_RESOLUTION_DATE_UT) < new Date(),
    attend_mon_action: attendMonAction(u, ctx),
    affectation: affectation(u, ctx),
  };
}

function libelleActionTerminee(a) {
  const tc = etapeWorkflow(a);
  if (!tc) return nomType(a);
  if (tc.nature === "VALIDATION") return a.CHOICE === "0" ? "Demande refusée" : "Demande validée";
  if (tc.nature === "CONFIRMATION") return a.CHOICE === "0" ? "Résolution contestée" : "Résolution confirmée";
  return tc.terminer;
}

function historique(ctx) {
  const entrees = [
    { date: ctx.req.SUBMIT_DATE_UT, auteur: personne(ctx.req.REQUESTOR), action: "Création", message: null },
  ];
  for (const a of ctx.actions) {
    if (a.END_DATE_UT) {
      entrees.push({ date: a.END_DATE_UT, auteur: personne(a.DONE_BY), action: libelleActionTerminee(a), message: a.COMMENT || null });
    } else if (etapeWorkflow(a)) {
      const tc = etapeWorkflow(a);
      entrees.push({
        date: a.START_DATE_UT,
        auteur: personne(a.DONE_BY),
        action: `${idAuteur(a) || tc.nature !== "TRAITEMENT" ? tc.etape : tc.etapeNonAffectee}${nomGroupe(a) ? ` (${nomGroupe(a)})` : ""}`,
        message: null,
        en_cours: true,
      });
    }
  }
  return entrees.sort((x, y) => String(x.date).localeCompare(String(y.date)));
}

function progression(ctx) {
  const avecValidation = ctx.actions.some((a) => etapeWorkflow(a)?.nature === "VALIDATION");
  const parcours = (cfg.parcours[ctx.type] || [])
    .filter(([code]) => code !== "EN_VALIDATION" || avecValidation)
    .map(([code, label]) => ({ code, label }));
  return { parcours, position: parcours.findIndex((s) => s.code === ctx.etapeSousJacente.code) };
}

function versActionPublique(a) {
  return {
    code: a.code,
    label: a.label,
    commentaire: Boolean(a.commentaire),
    parametre: a.parametre || null,
    secondaire: Boolean(a.secondaire),
  };
}

module.exports = {
  analyser,
  roles,
  peutVoir,
  actionsPossibles,
  attendMonAction,
  versTicket,
  versUtilisateur,
  versActionPublique,
  historique,
  progression,
  lireCatalogue,
  typeDepuisChemin,
  etapeWorkflow,
  statutConnu,
  nomStatut,
  nomType,
  idTypeAction,
  estInactif,
  idGroupe,
  idAuteur,
  rfcAction,
  estSuperviseurGroupe,
  estGroupeTechnique,
};
