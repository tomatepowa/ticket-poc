// auth.js — identification de l'utilisateur du portail.
//
// AUTH_MODE=dev : connexion de developpement, on choisit un compte dans une
//                 liste (fournie par la source). Aucun mot de passe : a ne
//                 JAMAIS exposer en dehors d'un poste ou d'un reseau de test.
// AUTH_MODE=sso : connexion via l'AD (OIDC avec Entra ID ou ADFS). A brancher
//                 quand le type d'AD sera connu : seule la fonction qui
//                 etablit la session changera, le reste du portail ne bouge pas.
//
// Par defaut : "dev" en local, et obligatoire a preciser en production.

const crypto = require("crypto");

const MODES = ["dev", "sso"];
const MESSAGE_RESERVE = "Portail réservé aux équipes support et aux cadres valideurs";
const COOKIE = "portail_session";
const DUREE_SESSION_MS = 12 * 3600e3;

function lireMode() {
  const mode = process.env.AUTH_MODE || (process.env.NODE_ENV === "production" ? null : "dev");
  if (!mode) throw new Error("AUTH_MODE doit etre defini en production (dev ou sso).");
  if (!MODES.includes(mode)) throw new Error(`AUTH_MODE inconnu : ${mode}`);
  if (mode === "sso") {
    throw new Error("Le SSO n'est pas encore branche (type d'AD a confirmer). Utilisez AUTH_MODE=dev.");
  }
  return mode;
}

function lireCookie(req, nom) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === nom) return decodeURIComponent(v.join("="));
  }
  return null;
}

function creerAuth(source) {
  const mode = lireMode();
  // Sessions stockees en base (source.sessions) : elles survivent a un
  // redemarrage du service et seraient partagees entre plusieurs instances.
  const sessions = source.sessions;

  async function ouvrirSession(res, utilisateurId) {
    const jeton = crypto.randomBytes(32).toString("hex");
    await sessions.creer(jeton, utilisateurId, new Date(Date.now() + DUREE_SESSION_MS));
    res.cookie(COOKIE, jeton, { httpOnly: true, sameSite: "lax", maxAge: DUREE_SESSION_MS });
  }

  // Session valide (non expiree) du cookie, ou null.
  async function sessionCourante(req) {
    const jeton = lireCookie(req, COOKIE);
    if (!jeton) return null;
    const s = await sessions.lire(jeton);
    return s ? { jeton, ...s } : null;
  }

  // Nom affiché dans le bandeau ; sans réglage, nom fictif pour la démo seulement.
  const ORGANISATION = process.env.ORGANISATION || (source.nom === "simulation" ? "Groupe Exemple" : "");

  function routes(app, envelopper) {
    app.get("/api/auth/config", (req, res) => res.json({ mode, source: source.nom, organisation: ORGANISATION }));

    app.get(
      "/api/auth/comptes-dev",
      envelopper(async (req, res) => {
        if (mode !== "dev") return res.status(404).json({ error: "Indisponible" });
        res.json(await source.listerComptesDev());
      })
    );

    app.post(
      "/api/auth/login-dev",
      envelopper(async (req, res) => {
        if (mode !== "dev") return res.status(404).json({ error: "Indisponible" });
        const utilisateur = await source.getUtilisateur(req.body?.utilisateur_id);
        if (!utilisateur) return res.status(400).json({ error: "Compte inconnu" });
        if (utilisateur.profil === "AUCUN") return res.status(403).json({ error: MESSAGE_RESERVE });
        await ouvrirSession(res, utilisateur.id);
        res.json(utilisateur);
      })
    );

    app.post(
      "/api/auth/logout",
      envelopper(async (req, res) => {
        const s = await sessionCourante(req);
        if (s) await sessions.supprimer(s.jeton);
        res.clearCookie(COOKIE);
        res.status(204).end();
      })
    );
  }

  // Middleware : rattache l'utilisateur connecte a req.user, sinon 401.
  const exiger = envelopperMiddleware(async (req, res, next) => {
    const s = await sessionCourante(req);
    const utilisateur = s && (await source.getUtilisateur(s.utilisateurId));
    if (!utilisateur) return res.status(401).json({ error: "Non connecte" });
    // Portail reserve aux equipes : un employe sans groupe support / valideur est refuse,
    // meme s'il a une session (ses groupes EV ont pu changer depuis la connexion).
    if (utilisateur.profil === "AUCUN") return res.status(403).json({ error: MESSAGE_RESERVE });
    req.user = utilisateur;
    next();
  });

  return { mode, routes, exiger };
}

function envelopperMiddleware(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { creerAuth };
