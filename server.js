// server.js — portail tickets : affichage simplifie d'EasyVista.
//
// Le portail n'a pas de donnees propres : tout est lu et ecrit via une
// "source" (sources/index.js), aujourd'hui un EasyVista simule, demain la
// vraie API EV. Les droits sont appliques par la source ; ce fichier ne fait
// que l'authentification, le routage HTTP et la gestion des erreurs.
// Le front (Vue, dossier web/) est servi par Vite en developpement, et depuis
// son build (dist/, `npm run build`) en production.

const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const source = require("./sources");
const { creerAuth } = require("./auth");
const { ErreurSource } = require("./sources/erreurs");

const app = express();
const serveur = http.createServer(app);
const PORT = process.env.PORT || 3000;
const PRODUCTION = process.env.NODE_ENV === "production";

// Express 4 ne rattrape pas les erreurs des handlers async : on les renvoie a next().
const envelopper = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use(express.json());

const auth = creerAuth(source);
auth.routes(app, envelopper);

// ---------- API (utilisateur connecte obligatoire) ----------

const api = express.Router();
api.use(auth.exiger);

api.get(
  "/moi",
  envelopper(async (req, res) => {
    res.json({ utilisateur: req.user, vues: await source.vues(req.user) });
  })
);

api.get(
  "/referentiels",
  envelopper(async (req, res) => {
    const [etablissements, groupes, catalogue] = await Promise.all([
      source.listerEtablissements(),
      source.listerGroupes(),
      source.listerCatalogue(req.user),
    ]);
    res.json({ etablissements, groupes, catalogue });
  })
);

api.get(
  "/tickets",
  envelopper(async (req, res) => {
    const { vue, q, etablissement, groupe, statut } = req.query;
    res.json(await source.listerTickets(req.user, { vue, q, etablissement, groupe, statut }));
  })
);

api.get(
  "/tickets/:id",
  envelopper(async (req, res) => {
    res.json(await source.getTicket(req.user, req.params.id));
  })
);

api.post(
  "/tickets",
  envelopper(async (req, res) => {
    res.status(201).json(await source.creerTicket(req.user, req.body || {}));
  })
);

api.post(
  "/tickets/:id/actions",
  envelopper(async (req, res) => {
    res.json(await source.executerAction(req.user, req.params.id, req.body || {}));
  })
);

// Formulaire EV (questionnaire) d'une entree de catalogue, au format du portail.
api.get(
  "/questionnaires/:id",
  envelopper(async (req, res) => {
    res.json(await source.getQuestionnaire(req.user, req.params.id));
  })
);

api.get(
  "/employes",
  envelopper(async (req, res) => {
    res.json(await source.chercherEmployes(req.query.q));
  })
);

// Etat de la copie locale des donnees EV (date de derniere synchro, erreur eventuelle).
api.get(
  "/synchro",
  envelopper(async (req, res) => {
    res.json(await source.etatSynchro());
  })
);

// Bouton "Rafraichir" : lance une synchro immediate.
api.post(
  "/synchro",
  envelopper(async (req, res) => {
    res.json(await source.synchroniser());
  })
);

api.get(
  "/stats",
  envelopper(async (req, res) => {
    // Memes filtres que la liste : les stats decrivent toujours ce qui est affiche.
    const { vue, q, etablissement, groupe, statut } = req.query;
    res.json(await source.stats(req.user, { vue, q, etablissement, groupe, statut }));
  })
);

app.use("/api", api);

// ---------- Front ----------
// Toute autre adresse sert la page du portail, y compris les liens directs vers
// un ticket (/t/I260927_000006) : il s'ouvre apres connexion, les droits
// restant verifies par l'API.

async function monterFront() {
  if (!PRODUCTION) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: path.join(__dirname, "vite.config.mjs"),
      server: { middlewareMode: true, hmr: { server: serveur } },
      appType: "spa",
    });
    app.use(vite.middlewares);
    return "Vite (developpement, rechargement a chaud)";
  }
  const dist = path.join(__dirname, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    throw new Error("Front non construit : lancer `npm run build` avant de demarrer en production.");
  }
  app.use(express.static(dist));
  app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
  return "dist/ (build de production)";
}

async function demarrer() {
  app.use("/api", (req, res) => res.status(404).json({ error: "Route inconnue" }));
  // Base PostgreSQL : schema a jour (migrations) avant toute requete.
  await source.initialiser();
  const front = await monterFront();
  app.use(gererErreurs);
  serveur.listen(PORT, () => {
    console.log(`Portail tickets en ecoute sur http://localhost:${PORT}`);
    console.log(`Source : ${source.nom} | Authentification : ${auth.mode} | Front : ${front}`);
    // Copie locale des donnees EV : premiere synchro immediate, puis a intervalle regulier.
    source.demarrerSynchro();
    if (auth.mode === "dev") {
      console.warn("ATTENTION : connexion de developpement active (sans mot de passe). Ne pas exposer.");
    }
  });
}

// ---------- Erreurs ----------

function gererErreurs(err, req, res, next) {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Corps de requete JSON invalide" });
  }
  // Erreurs metier de la source (droits, validation, EV injoignable) : message transmis tel quel.
  if (err instanceof ErreurSource && err.status !== 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur" });
}

demarrer().catch((err) => {
  console.error(err);
  process.exit(1);
});
