// questionnaires.js — formulaires EasyVista, lus et controles par le portail.
//
// Le portail n'a AUCUN formulaire code en dur : il affiche les questionnaires
// definis dans EV (entree de catalogue, ou fin d'une etape de workflow) avec un
// composant generique, et controle ici les reponses avant de les envoyer a EV.
//
// Format EV lu (A VERIFIER sur la vraie instance, via /questionnaires et
// /questions-questionnaire) : QUESTION_ID, QUESTION_FR, QUESTION_TYPE,
// MANDATORY, ANSWERS (choix), HELP_FR, CONDITION { QUESTION_ID, VALUES }.
// Seule lireQuestionnaire() est a ajuster si les noms different.

const { ErreurSource } = require("../erreurs");

const TYPES = {
  TEXT: "texte",
  MEMO: "texte_long",
  NUMBER: "nombre",
  DATE: "date",
  LIST: "choix",
  MULTI: "choix_multiples",
  BOOLEAN: "oui_non",
};

// Format EV -> modele du portail
function lireQuestionnaire(q) {
  return {
    id: Number(q.QUESTIONNAIRE_ID),
    titre: q.NAME_FR || q.NAME_EN || "Formulaire",
    questions: (q.QUESTIONS || []).map((x) => ({
      id: Number(x.QUESTION_ID),
      libelle: x.QUESTION_FR || x.QUESTION_EN || `Question ${x.QUESTION_ID}`,
      type: TYPES[String(x.QUESTION_TYPE).toUpperCase()] || "texte",
      obligatoire: Boolean(x.MANDATORY),
      choix: (x.ANSWERS || []).map(String),
      aide: x.HELP_FR || x.HELP_EN || "",
      condition: x.CONDITION
        ? { question: Number(x.CONDITION.QUESTION_ID), valeurs: (x.CONDITION.VALUES || []).map(String) }
        : null,
    })),
  };
}

const estVide = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

// Une question conditionnelle n'est visible que si la question dont elle depend
// (elle-meme visible) a l'une des valeurs attendues.
function estVisible(questionnaire, question, reponses) {
  if (!question.condition) return true;
  const parent = questionnaire.questions.find((q) => q.id === question.condition.question);
  if (!parent || !estVisible(questionnaire, parent, reponses)) return false;
  const v = reponses[parent.id];
  const valeurs = Array.isArray(v) ? v.map(String) : [String(v)];
  return valeurs.some((x) => question.condition.valeurs.includes(x));
}

// Controle et normalise les reponses. Les questions masquees sont ignorees.
// Renvoie { questionId: valeur } pret a envoyer a EV, ou leve une ErreurSource 400.
function validerReponses(questionnaire, reponses = {}) {
  const erreurs = [];
  const propres = {};
  for (const q of questionnaire.questions) {
    if (!estVisible(questionnaire, q, reponses)) continue;
    let v = reponses[q.id];
    if (typeof v === "string") v = v.trim();
    if (estVide(v)) {
      if (q.obligatoire) erreurs.push(`« ${q.libelle} » est obligatoire`);
      continue;
    }
    switch (q.type) {
      case "nombre":
        if (!Number.isFinite(Number(v))) erreurs.push(`« ${q.libelle} » doit être un nombre`);
        else propres[q.id] = Number(v);
        break;
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(new Date(v).getTime())) {
          erreurs.push(`« ${q.libelle} » doit être une date`);
        } else propres[q.id] = String(v);
        break;
      case "choix":
        if (!q.choix.includes(String(v))) erreurs.push(`« ${q.libelle} » : choix invalide`);
        else propres[q.id] = String(v);
        break;
      case "choix_multiples": {
        const liste = (Array.isArray(v) ? v : [v]).map(String);
        if (liste.some((x) => !q.choix.includes(x))) erreurs.push(`« ${q.libelle} » : choix invalide`);
        else propres[q.id] = liste;
        break;
      }
      case "oui_non":
        if (v !== true && v !== false && v !== "true" && v !== "false") erreurs.push(`« ${q.libelle} » : répondez oui ou non`);
        else propres[q.id] = v === true || v === "true";
        break;
      default:
        propres[q.id] = String(v);
    }
  }
  if (erreurs.length) throw new ErreurSource(400, `Formulaire incomplet : ${erreurs.join(" ; ")}`);
  return propres;
}

// Valeur a envoyer a EV : les choix multiples sont joints par "|" (A VERIFIER),
// oui/non en "1"/"0".
function versValeurEV(v) {
  if (Array.isArray(v)) return v.join("|");
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

// Reponses EV d'un ticket -> lignes lisibles pour le detail.
function reponsesLisibles(questionnaire, resultatsEV) {
  const parId = new Map((questionnaire?.questions || []).map((q) => [q.id, q]));
  return resultatsEV.map((r) => {
    const q = parId.get(Number(r.QUESTION_ID));
    const brut = r.VALUE ?? "";
    let valeur = String(brut);
    if (q?.type === "oui_non") valeur = ["1", "true"].includes(valeur) ? "Oui" : "Non";
    else if (q?.type === "choix_multiples") valeur = valeur.split("|").filter(Boolean).join(", ");
    // Date : d'apres le type, ou d'apres la forme pour une question hors du
    // questionnaire du catalogue (formulaire de fin d'etape, par exemple).
    else if ((q?.type === "date" || (!q && /^\d{4}-\d{2}-\d{2}$/.test(valeur))) && /^\d{4}-\d{2}-\d{2}/.test(valeur)) {
      valeur = new Date(valeur).toLocaleDateString("fr-FR", { timeZone: "UTC" });
    }
    return { question: q?.libelle || r.QUESTION_FR || `Question ${r.QUESTION_ID}`, valeur };
  });
}

module.exports = { lireQuestionnaire, estVisible, validerReponses, versValeurEV, reponsesLisibles };
