// Logique des formulaires EV cote front (affichage conditionnel, champs manquants).
// Le serveur refait tous les controles (sources/portail/questionnaires.js) : ici,
// c'est seulement pour guider la saisie.

// Une question conditionnelle n'est visible que si la question dont elle depend
// (elle-meme visible) a l'une des valeurs attendues.
export function estVisible(questionnaire, question, reponses) {
  if (!question.condition) return true;
  const parent = questionnaire.questions.find((q) => q.id === question.condition.question);
  if (!parent || !estVisible(questionnaire, parent, reponses)) return false;
  const v = reponses[parent.id];
  const valeurs = Array.isArray(v) ? v.map(String) : [String(v)];
  return valeurs.some((x) => question.condition.valeurs.includes(x));
}

const estVide = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

// Libelles des questions obligatoires visibles et non remplies.
export function champsManquants(questionnaire, reponses) {
  if (!questionnaire) return [];
  return questionnaire.questions
    .filter((q) => q.obligatoire && estVisible(questionnaire, q, reponses) && estVide(reponses[q.id]))
    .map((q) => q.libelle);
}

// Reponses des seules questions visibles (celles masquees ne sont pas envoyees).
export function reponsesVisibles(questionnaire, reponses) {
  const res = {};
  for (const q of questionnaire?.questions || []) {
    if (estVisible(questionnaire, q, reponses) && !estVide(reponses[q.id])) res[q.id] = reponses[q.id];
  }
  return res;
}
