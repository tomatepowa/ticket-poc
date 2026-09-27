// clients/simule — FAUX EasyVista, qui parle comme l'API REST EV.
//
// Meme interface que clients/http.js (une methode par route REST utilisee),
// memes formes de reponse (champs en MAJUSCULES, { records: [...] }, HREF),
// meme syntaxe de recherche (search=champ:"valeur",...). Il fait aussi
// tourner des workflows simples, comme EV le fait de son cote.
//
// Comme la vraie API appelee avec un compte de service, il n'applique AUCUN
// droit utilisateur : c'est le portail (sources/portail) qui s'en charge.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const D = require("./donnees");
const DEMO = require("./demo");
const { ErreurSource } = require("../../erreurs");

const BASE = "https://ev-simule.local/api/v1/50004";
const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "ev-simule.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    request_id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfc_number TEXT UNIQUE NOT NULL,
    catalog_id INTEGER NOT NULL,
    requestor_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    location_id INTEGER,
    status_id INTEGER NOT NULL,
    status_avant_suspension INTEGER,
    title TEXT,
    description TEXT,
    urgency_id INTEGER,
    severity_id INTEGER,
    submit_date TEXT NOT NULL,
    last_update TEXT NOT NULL,
    max_resolution_date TEXT
  );
  CREATE TABLE IF NOT EXISTS actions (
    action_id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(request_id),
    action_type_id INTEGER NOT NULL,
    group_id INTEGER,
    done_by_id INTEGER,
    start_date TEXT NOT NULL,
    end_date TEXT,
    comment TEXT,
    choice TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_actions_request ON actions(request_id);
`);

// ---------- Referentiels ----------

const trouver = (liste, champ, valeur) => liste.find((x) => String(x[champ]) === String(valeur)) || null;
const employe = (id) => trouver(D.EMPLOYEES, "EMPLOYEE_ID", id);
const groupe = (id) => trouver(D.GROUPS, "GROUP_ID", id);
const statut = (id) => trouver(D.STATUSES, "STATUS_ID", id);
const typeAction = (id) => trouver(D.ACTION_TYPES, "ACTION_TYPE_ID", id);
const catalogue = (id) => trouver(D.CATALOG, "SD_CATALOG_ID", id);
const location = (id) => trouver(D.LOCATIONS, "LOCATION_ID", id);

function employeDepuis({ id, mail, identification, name }) {
  if (id != null && id !== "") return employe(id);
  if (mail) return D.EMPLOYEES.find((e) => e.E_MAIL.toLowerCase() === String(mail).toLowerCase()) || null;
  if (identification) return trouver(D.EMPLOYEES, "IDENTIFICATION", identification);
  if (name) return trouver(D.EMPLOYEES, "LAST_NAME", name);
  return null;
}

// ---------- Mise au format EV ----------

const refEmploye = (e) =>
  e && { HREF: `${BASE}/employees/${e.EMPLOYEE_ID}`, EMPLOYEE_ID: e.EMPLOYEE_ID, LAST_NAME: e.LAST_NAME, E_MAIL: e.E_MAIL };

function formatEmploye(e) {
  const { MANAGER_ID, ...public_ } = e;
  return { HREF: `${BASE}/employees/${e.EMPLOYEE_ID}`, ...public_, LOCATION: location(e.LOCATION_ID) };
}

function formatGroupe(g) {
  return { HREF: `${BASE}/groups/${g.GROUP_ID}`, GROUP_ID: g.GROUP_ID, GROUP_FR: g.GROUP_FR };
}

function formatRequest(r) {
  const s = statut(r.status_id);
  const cat = catalogue(r.catalog_id);
  const loc = location(r.location_id);
  return {
    HREF: `${BASE}/requests/${r.rfc_number}`,
    REQUEST_ID: r.request_id,
    RFC_NUMBER: r.rfc_number,
    TITLE: r.title,
    DESCRIPTION: r.description,
    SUBMIT_DATE_UT: r.submit_date,
    LAST_UPDATE: r.last_update,
    MAX_RESOLUTION_DATE_UT: r.max_resolution_date,
    STATUS: { STATUS_ID: s.STATUS_ID, STATUS_GUID: s.STATUS_GUID, STATUS_FR: s.STATUS_FR },
    SD_CATALOG_ID: cat.SD_CATALOG_ID,
    SD_CATALOG_PATH: cat.CATALOG_REQUEST_PATH,
    REQUESTOR: refEmploye(employe(r.requestor_id)),
    RECIPIENT: refEmploye(employe(r.recipient_id)),
    LOCATION: loc && { LOCATION_ID: loc.LOCATION_ID, LOCATION_FR: loc.LOCATION_FR },
    URGENCY_ID: r.urgency_id,
    SEVERITY_ID: r.severity_id,
  };
}

function formatAction(a) {
  const r = db.prepare("SELECT * FROM requests WHERE request_id = ?").get(a.request_id);
  const t = typeAction(a.action_type_id);
  const g = a.group_id ? groupe(a.group_id) : null;
  return {
    HREF: `${BASE}/actions/${a.action_id}`,
    ACTION_ID: a.action_id,
    ACTION_TYPE: { ACTION_TYPE_ID: t.ACTION_TYPE_ID, NAME_FR: t.NAME_FR },
    GROUP: g && { GROUP_ID: g.GROUP_ID, GROUP_FR: g.GROUP_FR },
    DONE_BY_ID: a.done_by_id,
    DONE_BY: refEmploye(a.done_by_id ? employe(a.done_by_id) : null),
    START_DATE_UT: a.start_date,
    END_DATE_UT: a.end_date,
    COMMENT: a.comment,
    CHOICE: a.choice,
    REQUEST: {
      HREF: `${BASE}/requests/${r.rfc_number}`,
      RFC_NUMBER: r.rfc_number,
      SUBMIT_DATE_UT: r.submit_date,
      MAX_RESOLUTION_DATE_UT: r.max_resolution_date,
    },
  };
}

// ---------- Recherche facon EV : search=champ:"valeur",champ2:"valeur" ----------
// Meme champ repete = OU ; champs differents = ET. Valeurs speciales is_null / is_not_null.

function criteres(search) {
  const parChamp = {};
  for (const t of String(search || "").match(/[\w.]+:"[^"]*"/g) || []) {
    const [, champ, val] = t.match(/^([\w.]+):"([^"]*)"$/);
    (parChamp[champ.toLowerCase()] ||= []).push(val);
  }
  return Object.entries(parChamp);
}

function valeur(rec, chemin) {
  return chemin.split(".").reduce((o, k) => {
    if (o == null) return undefined;
    const cle = Object.keys(o).find((x) => x.toLowerCase() === k);
    return cle === undefined ? undefined : o[cle];
  }, rec);
}

function correspond(rec, crit) {
  const vide = (x) => x == null || x === "";
  return crit.every(([champ, vals]) =>
    vals.some((v) => {
      const x = valeur(rec, champ);
      if (v === "is_null") return vide(x);
      if (v === "is_not_null") return !vide(x);
      return !vide(x) && String(x).toLowerCase() === v.toLowerCase();
    })
  );
}

function liste(records, { search, max_rows = 100, offset = 0, sort } = {}) {
  let res = records.filter((r) => correspond(r, criteres(search)));
  if (sort) {
    const [champ, sens] = sort.split(/[+ ]/);
    res = [...res].sort((a, b) => String(valeur(a, champ.toLowerCase()) ?? "").localeCompare(String(valeur(b, champ.toLowerCase()) ?? "")));
    if (sens === "desc") res.reverse();
  }
  const page = res.slice(Number(offset), Number(offset) + Number(max_rows));
  return { record_count: page.length, total_record_count: res.length, records: page };
}

const minuscules = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));

// ---------- Moteur de workflow (cote "serveur EV") ----------

const ligneRequest = (rfc) => {
  const r = db.prepare("SELECT * FROM requests WHERE rfc_number = ?").get(rfc);
  if (!r) throw new ErreurSource(404, `Ticket ${rfc} introuvable`);
  return r;
};
const actionsEnCours = (r) =>
  db.prepare("SELECT * FROM actions WHERE request_id = ? AND end_date IS NULL ORDER BY action_id").all(r.request_id);

function majRequest(r, champs, date) {
  const affectations = [...Object.keys(champs).map((c) => `${c} = @${c}`), "last_update = @d"];
  db.prepare(`UPDATE requests SET ${affectations.join(", ")} WHERE request_id = @id`).run({
    ...champs,
    d: date.toISOString(),
    id: r.request_id,
  });
}

function ajouterAction(r, typeId, { group_id = null, done_by_id = null, comment = null, date, terminee = false }) {
  const iso = date.toISOString();
  return db
    .prepare(
      "INSERT INTO actions (request_id, action_type_id, group_id, done_by_id, start_date, end_date, comment) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(r.request_id, typeId, group_id, done_by_id, iso, terminee ? iso : null, comment).lastInsertRowid;
}

const estIncident = (r) => r.rfc_number.startsWith("I");
const typeTraitement = (r) => (estIncident(r) ? D.T["Traitement incident"] : D.T["Réalisation demande"]);

function demarrerWorkflow(r, date) {
  const cat = catalogue(r.catalog_id);
  if (!estIncident(r) && cat.VALIDATION) {
    const dem = employe(r.requestor_id);
    const valideur = dem.MANAGER_ID || D.GROUPS.find((g) => g.GROUP_ID === D.GROUPE_SUPERVISION).MEMBERS[0];
    ajouterAction(r, D.T["Validation hiérarchique"], { group_id: D.GROUPE_SUPERVISION, done_by_id: valideur, date });
    majRequest(r, { status_id: D.S["En attente de validation"] }, date);
  } else {
    ajouterAction(r, typeTraitement(r), { group_id: cat.GROUP_ID, date });
    majRequest(r, { status_id: D.S["Nouveau"] }, date);
  }
}

function apresFinAction(r, a, choix, date) {
  const t = typeAction(a.action_type_id).NAME_FR;
  if (t === "Traitement incident" || t === "Réalisation demande") {
    ajouterAction(r, D.T["Confirmation demandeur"], { group_id: a.group_id, done_by_id: r.requestor_id, date });
    majRequest(r, { status_id: D.S["Résolu"] }, date);
  } else if (t === "Validation hiérarchique") {
    if (choix === "0") return majRequest(r, { status_id: D.S["Refusé"] }, date);
    ajouterAction(r, D.T["Réalisation demande"], { group_id: catalogue(r.catalog_id).GROUP_ID, date });
    majRequest(r, { status_id: D.S["Nouveau"] }, date);
  } else if (t === "Confirmation demandeur") {
    if (choix === "0") {
      // Rouvert : retour au dernier intervenant
      const dernier = db
        .prepare("SELECT * FROM actions WHERE request_id = ? AND action_type_id = ? ORDER BY action_id DESC")
        .get(r.request_id, typeTraitement(r));
      ajouterAction(r, typeTraitement(r), { group_id: a.group_id, done_by_id: dernier?.done_by_id, date });
      return majRequest(r, { status_id: D.S["En cours"] }, date);
    }
    majRequest(r, { status_id: D.S["Clôturé"] }, date);
  }
}

// ---------- Operations (avec date, pour pouvoir rejouer la demo) ----------

function numero(prefixe, date) {
  const jour = date.toISOString().slice(2, 10).replace(/-/g, "");
  const { m } = db
    .prepare("SELECT MAX(CAST(substr(rfc_number, 9) AS INTEGER)) m FROM requests WHERE rfc_number LIKE ?")
    .get(`${prefixe}%`);
  return `${prefixe}${jour}_${String((m || 0) + 1).padStart(6, "0")}`;
}

function opCreerRequest(body, date) {
  const b = minuscules((body.requests || [])[0] || body.request || body);
  const cat =
    trouver(D.CATALOG, "CODE", b.catalog_code) ||
    trouver(D.CATALOG, "SD_CATALOG_ID", b.catalog_id) ||
    null;
  if (!cat) throw new ErreurSource(400, "Catalog entry not found");
  const dem = employeDepuis({ mail: b.requestor_mail, identification: b.requestor_identification, name: b.requestor_name });
  if (!dem) throw new ErreurSource(400, "Requestor not found");
  const benef =
    employeDepuis({ id: b.recipient_id, mail: b.recipient_mail, identification: b.recipient_identification, name: b.recipient_name }) || dem;

  const incident = cat.CATALOG_REQUEST_PATH.startsWith("Incidents/");
  const urgence = Number(b.urgency_id) || null;
  const impact = Number(b.severity_id || b.impact_id) || null;
  const prio = incident ? D.PRIORITE[impact]?.[urgence] || 3 : 3;
  const iso = date.toISOString();
  const rfc = numero(incident ? "I" : "S", date);
  db.prepare(
    `INSERT INTO requests (rfc_number, catalog_id, requestor_id, recipient_id, location_id, status_id, title, description,
       urgency_id, severity_id, submit_date, last_update, max_resolution_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rfc,
    cat.SD_CATALOG_ID,
    dem.EMPLOYEE_ID,
    benef.EMPLOYEE_ID,
    Number(b.location_id) || dem.LOCATION_ID,
    D.S["Nouveau"],
    b.title || null,
    b.description || null,
    urgence,
    impact,
    iso,
    iso,
    new Date(date.getTime() + D.DELAI_HEURES[prio] * 3600e3).toISOString()
  );
  demarrerWorkflow(ligneRequest(rfc), date);
  return { HREF: `${BASE}/requests/${rfc}` };
}

function opCreerAction(rfc, body, date) {
  const r = ligneRequest(rfc);
  const b = minuscules(body.action || body);
  const t = trouver(D.ACTION_TYPES, "ACTION_TYPE_ID", b.action_type_id) || trouver(D.ACTION_TYPES, "NAME_FR", b.action_type_name);
  if (!t) throw new ErreurSource(400, "Action type not found");
  const g = trouver(D.GROUPS, "GROUP_ID", b.group_id) || trouver(D.GROUPS, "GROUP_FR", b.group_name);
  if (!g) throw new ErreurSource(400, "group_id, group_mail or group_name is mandatory");
  const auteur = employeDepuis({ id: b.done_by_id, mail: b.doneby_mail, identification: b.doneby_identification, name: b.doneby_name });
  // Un commentaire est une action immediatement terminee.
  const id = ajouterAction(r, t.ACTION_TYPE_ID, {
    group_id: g.GROUP_ID,
    done_by_id: auteur?.EMPLOYEE_ID ?? null,
    comment: b.comment || null,
    date,
    terminee: t.NAME_FR === "Commentaire",
  });
  majRequest(r, {}, date);
  return { HREF: `${BASE}/actions/${id}` };
}

function opTerminerAction(rfc, body, date) {
  const r = ligneRequest(rfc);
  const b = minuscules(body.end_action || body);
  const auteur = employeDepuis({ mail: b.doneby_mail, identification: b.doneby_identification, name: b.doneby_name });
  const cibles = actionsEnCours(r).filter((a) => !b.action_id || String(a.action_id) === String(b.action_id));
  if (!cibles.length) throw new ErreurSource(404, "No ongoing action found");
  const choix = b.choice != null ? String(b.choice) : null;
  for (const a of cibles) {
    db.prepare("UPDATE actions SET end_date = ?, done_by_id = COALESCE(?, done_by_id), comment = COALESCE(?, comment), choice = ? WHERE action_id = ?").run(
      date.toISOString(),
      auteur?.EMPLOYEE_ID ?? null,
      b.comment || null,
      choix,
      a.action_id
    );
    apresFinAction(ligneRequest(rfc), a, choix, date);
  }
  return { HREF: `${BASE}/actions/${rfc}` };
}

function opMajAction(actionId, body, date) {
  const a = db.prepare("SELECT * FROM actions WHERE action_id = ?").get(actionId);
  if (!a) throw new ErreurSource(404, "Action not found");
  const b = minuscules(body);
  const champs = {};
  if ("done_by_id" in b) champs.done_by_id = b.done_by_id == null || b.done_by_id === "" ? null : Number(b.done_by_id);
  if ("group_id" in b) champs.group_id = Number(b.group_id);
  if ("comment" in b) champs.comment = b.comment;
  if (!Object.keys(champs).length) throw new ErreurSource(400, "At least one field is required");
  db.prepare(`UPDATE actions SET ${Object.keys(champs).map((c) => `${c} = @${c}`).join(", ")} WHERE action_id = @id`).run({
    ...champs,
    id: actionId,
  });
  const r = db.prepare("SELECT * FROM requests WHERE request_id = ?").get(a.request_id);
  // Affectation d'un intervenant : le ticket passe "En cours".
  if (champs.done_by_id && r.status_id === D.S["Nouveau"]) majRequest(r, { status_id: D.S["En cours"] }, date);
  else if ("done_by_id" in champs && !champs.done_by_id && r.status_id === D.S["En cours"]) majRequest(r, { status_id: D.S["Nouveau"] }, date);
  else majRequest(r, {}, date);
  return { HREF: `${BASE}/actions/${actionId}` };
}

function opMajRequest(rfc, body, date) {
  const r = ligneRequest(rfc);
  const b = minuscules(body);
  const auteurId = (o) => employeDepuis({ id: o.done_by_id })?.EMPLOYEE_ID ?? null;
  const groupeCourant = actionsEnCours(r)[0]?.group_id ?? catalogue(r.catalog_id).GROUP_ID;

  if (b.suspended) {
    const s = minuscules(b.suspended);
    if (r.status_id === D.S["Suspendu"]) throw new ErreurSource(400, "The request is already suspended. Operation aborted.");
    ajouterAction(r, D.T["Suspension"], { group_id: groupeCourant, done_by_id: auteurId(s), comment: s.comment, date, terminee: true });
    majRequest(r, { status_id: D.S["Suspendu"], status_avant_suspension: r.status_id }, date);
  } else if (b.restarted) {
    const s = minuscules(b.restarted);
    if (r.status_id !== D.S["Suspendu"]) throw new ErreurSource(400, "The request is not suspended. Operation aborted.");
    ajouterAction(r, D.T["Reprise"], { group_id: groupeCourant, done_by_id: auteurId(s), comment: s.comment, date, terminee: true });
    majRequest(r, { status_id: r.status_avant_suspension || D.S["En cours"], status_avant_suspension: null }, date);
  } else if (b.closed) {
    const s = minuscules(b.closed);
    const st = trouver(D.STATUSES, "STATUS_GUID", s.status_guid) || statut(D.S["Clôturé"]);
    const iso = date.toISOString();
    if (Number(s.delete_actions)) db.prepare("DELETE FROM actions WHERE request_id = ? AND end_date IS NULL").run(r.request_id);
    else db.prepare("UPDATE actions SET end_date = ? WHERE request_id = ? AND end_date IS NULL").run(iso, r.request_id);
    ajouterAction(r, D.T["Clôture"], { group_id: groupeCourant, done_by_id: auteurId(s), comment: s.comment, date, terminee: true });
    majRequest(r, { status_id: st.STATUS_ID }, date);
  } else {
    const champs = {};
    if ("title" in b) champs.title = b.title;
    if ("description" in b) champs.description = b.description;
    if (!Object.keys(champs).length) throw new ErreurSource(400, "Nothing to update");
    majRequest(r, champs, date);
  }
  return { HREF: `${BASE}/requests/${rfc}` };
}

const enTransaction = (fn) => (...args) => db.transaction(() => fn(...args))();

// ---------- Donnees de demo ----------

function seedDemo() {
  if (db.prepare("SELECT COUNT(*) n FROM requests").get().n > 0) return;
  const maintenant = Date.now();
  const ilYa = (h) => new Date(maintenant - h * 3600e3);
  const parLogin = (l) => trouver(D.EMPLOYEES, "IDENTIFICATION", l);

  db.transaction(() => {
    [...DEMO].sort((a, b) => b.heures - a.heures).forEach((d) => {
      const dem = parLogin(d.demandeur);
      const { HREF } = opCreerRequest(
        {
          requests: [
            {
              catalog_code: String(d.catalogue),
              requestor_mail: dem.E_MAIL,
              title: d.titre,
              description: d.description,
              urgency_id: d.urgence,
              severity_id: d.impact,
            },
          ],
        },
        ilYa(d.heures)
      );
      const rfc = HREF.split("/").pop();
      d.etapes.forEach(([op, login, h, commentaire, choix]) => {
        const e = parLogin(login);
        const date = ilYa(h);
        const enCours = actionsEnCours(ligneRequest(rfc))[0];
        if (op === "prendre") opMajAction(enCours.action_id, { done_by_id: e.EMPLOYEE_ID }, date);
        if (op === "terminer")
          opTerminerAction(rfc, { end_action: { action_id: enCours.action_id, doneby_mail: e.E_MAIL, comment: commentaire, choice: choix } }, date);
        if (op === "suspendre") opMajRequest(rfc, { suspended: { comment: commentaire, done_by_id: e.EMPLOYEE_ID } }, date);
        if (op === "commenter")
          opCreerAction(rfc, { action: { action_type_name: "Commentaire", group_id: enCours.group_id, done_by_id: e.EMPLOYEE_ID, comment: commentaire } }, date);
      });
    });
  })();
}
seedDemo();

// ---------- Interface client (miroir des routes REST utilisees) ----------

module.exports = {
  nom: "simulation",

  async getRequests(params) {
    return liste(db.prepare("SELECT * FROM requests").all().map(formatRequest), { sort: "submit_date_ut+desc", ...params });
  },
  async getRequest(rfc) {
    return formatRequest(ligneRequest(rfc));
  },
  async getActions(params) {
    return liste(db.prepare("SELECT * FROM actions ORDER BY action_id").all().map(formatAction), params);
  },
  async getEmployees(params) {
    return liste(D.EMPLOYEES.map(formatEmploye), params);
  },
  async getEmployee(id) {
    const e = employe(id);
    if (!e) throw new ErreurSource(404, "Employee not found");
    return formatEmploye(e);
  },
  async getEmployeeGroups(id) {
    return liste(D.GROUPS.filter((g) => g.MEMBERS.includes(Number(id))).map(formatGroupe));
  },
  async getGroups(params) {
    return liste(D.GROUPS.map(formatGroupe), { max_rows: 1000, ...params });
  },
  async getLocations(params) {
    return liste(D.LOCATIONS, { max_rows: 1000, ...params });
  },
  async getCatalog(params) {
    return liste(
      D.CATALOG.map(({ VALIDATION, GROUP_ID, ...c }) => ({ HREF: `${BASE}/catalog-requests/${c.SD_CATALOG_ID}`, ...c })),
      { max_rows: 1000, ...params }
    );
  },
  async getStatuses(params) {
    return liste(D.STATUSES, { max_rows: 1000, ...params });
  },

  async createRequest(body) {
    return enTransaction(opCreerRequest)(body, new Date());
  },
  async createAction(rfc, body) {
    return enTransaction(opCreerAction)(rfc, body, new Date());
  },
  async endAction(rfc, body) {
    return enTransaction(opTerminerAction)(rfc, body, new Date());
  },
  async updateAction(actionId, body) {
    return enTransaction(opMajAction)(actionId, body, new Date());
  },
  async updateRequest(rfc, body) {
    return enTransaction(opMajRequest)(rfc, body, new Date());
  },

  // Propre a la simulation (hors interface EV)
  reinitialiserDemo() {
    db.exec("DELETE FROM actions; DELETE FROM requests; DELETE FROM sqlite_sequence;");
    seedDemo();
  },
  fermer() {
    db.close();
  },
};
