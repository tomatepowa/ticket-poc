// clients/http.js — client de la VRAIE API REST EasyVista.
//
// Une methode par route utilisee, memes signatures que clients/simule.
// Routes et corps de requete d'apres la documentation officielle :
// https://docs.easyvista.com/docs/webservice-rest
//
// Configuration (variables d'environnement, jamais en dur) :
//   EV_URL      ex. https://mon-organisation.easyvista.com   (sans /api/v1)
//   EV_ACCOUNT  numero de compte EV, ex. 50004
//   EV_TOKEN    jeton d'acces du compte de service (Administration > Acces > Jetons)
//
// NON TESTE contre une vraie instance : a valider des qu'un acces est disponible.
// Points "A VERIFIER" signales en commentaire.

const { ErreurSource } = require("../erreurs");

function lireConfig() {
  const { EV_URL, EV_ACCOUNT, EV_TOKEN } = process.env;
  const manquants = Object.entries({ EV_URL, EV_ACCOUNT, EV_TOKEN })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (manquants.length) throw new Error(`Configuration EasyVista incomplete : ${manquants.join(", ")}`);
  return { base: `${EV_URL.replace(/\/$/, "")}/api/v1/${EV_ACCOUNT}`, token: EV_TOKEN };
}

const { base, token } = lireConfig();
const TIMEOUT_MS = 30000;

async function appel(methode, chemin, { query, body } = {}) {
  const url = new URL(base + chemin);
  Object.entries(query || {}).forEach(([k, v]) => v != null && v !== "" && url.searchParams.set(k, v));

  let res;
  try {
    res = await fetch(url, {
      method: methode,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ErreurSource(502, `EasyVista injoignable (${err.name === "TimeoutError" ? "delai depasse" : err.message})`);
  }

  const texte = await res.text();
  let json = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = { error: texte };
  }
  if (!res.ok) {
    const message = json?.error || json?.message || `HTTP ${res.status}`;
    if (res.status === 404) throw new ErreurSource(404, message);
    // 401/403 : probleme du compte de service, pas de l'utilisateur du portail -> 502
    throw new ErreurSource(502, `EasyVista a refuse l'operation : ${message}`);
  }
  return json;
}

// Les listes EV renvoient { records: [...] } ; on garantit toujours ce champ.
const enListe = (json) => ({ ...json, records: json?.records || [] });

module.exports = {
  nom: "easyvista",

  async getRequests(params = {}) {
    return enListe(await appel("GET", "/requests", { query: params }));
  },
  async getRequest(rfc) {
    return appel("GET", `/requests/${encodeURIComponent(rfc)}`);
  },
  async getActions(params = {}) {
    // A VERIFIER : que GROUP, DONE_BY, ACTION_TYPE, END_DATE_UT et COMMENT
    // sont renvoyes par defaut ; sinon ajouter le parametre `fields`.
    return enListe(await appel("GET", "/actions", { query: params }));
  },
  async getEmployees(params = {}) {
    return enListe(await appel("GET", "/employees", { query: params }));
  },
  async getEmployee(id) {
    return appel("GET", `/employees/${encodeURIComponent(id)}`);
  },
  async getEmployeeGroups(id) {
    // EV 2023.2+. A VERIFIER : forme exacte de la reponse (records de groupes).
    return enListe(await appel("GET", `/employees/${encodeURIComponent(id)}/groups`));
  },
  async getGroups(params = {}) {
    return enListe(await appel("GET", "/groups", { query: { max_rows: 1000, ...params } }));
  },
  async getLocations(params = {}) {
    return enListe(await appel("GET", "/locations", { query: { max_rows: 1000, ...params } }));
  },
  async getCatalog(params = {}) {
    return enListe(await appel("GET", "/catalog-requests", { query: { max_rows: 1000, ...params } }));
  },
  async getStatuses(params = {}) {
    return enListe(await appel("GET", "/status", { query: { max_rows: 1000, ...params } }));
  },

  // POST /requests  { requests: [{ catalog_code, requestor_mail, ... }] } -> { HREF }
  async createRequest(body) {
    return appel("POST", "/requests", { body });
  },
  // POST /requests/{rfc}/actions  { action: { action_type_name, group_id, done_by_id, comment } }
  async createAction(rfc, body) {
    return appel("POST", `/requests/${encodeURIComponent(rfc)}/actions`, { body });
  },
  // PUT /actions/{rfc}  { end_action: { action_id, doneby_mail, choice, comment } }
  // A VERIFIER : que `comment` est accepte dans end_action.
  async endAction(rfc, body) {
    return appel("PUT", `/actions/${encodeURIComponent(rfc)}`, { body });
  },
  // PUT /actions/{action_id}  { done_by_id } ou { group_id, done_by_id: null }
  // A VERIFIER : que GROUP_ID et DONE_BY_ID sont modifiables par cette route (reaffectation).
  async updateAction(actionId, body) {
    return appel("PUT", `/actions/${encodeURIComponent(actionId)}`, { body });
  },
  // PUT /requests/{rfc}  { suspended: {...} } | { restarted: {...} } | { closed: {...} }
  async updateRequest(rfc, body) {
    return appel("PUT", `/requests/${encodeURIComponent(rfc)}`, { body });
  },
};
