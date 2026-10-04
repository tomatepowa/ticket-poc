// npm run captures : captures d'écran de la documentation (docs/captures/).
//
// Pilote un Chrome sans interface (protocole DevTools) sur le portail qui tourne
// déjà (npm run dev), en démo : faux EasyVista et connexion de développement,
// comptes fictifs. Régénérer après une évolution de l'écran, puis committer.
//
//   npm run captures                       portail sur http://localhost:3000
//   PORTAIL=http://localhost:3010 npm run captures
//   CHROME="C:\...\chrome.exe" npm run captures   si Chrome n'est pas trouvé
//
// Node 22 ou plus (WebSocket intégré). Ne modifie rien dans les tickets : seules des
// sessions de connexion sont ouvertes (profil Chrome temporaire).

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORTAIL = (process.env.PORTAIL || "http://localhost:3000").replace(/\/$/, "");
const SORTIE = path.join(__dirname, "..", "docs", "captures");
const LARGEUR = 1440;
const HAUTEUR = 900;
const PORT_DEBUG = 9333;

const CHROMES = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const arreter = (m) => {
  console.error(`[captures] ${m}`);
  process.exit(1);
};

async function main() {
  if (typeof WebSocket === "undefined") arreter("Node 22 ou plus requis (WebSocket intégré).");
  const chromeExe = CHROMES.find((c) => fs.existsSync(c));
  if (!chromeExe) arreter("Chrome introuvable : indiquer son chemin dans CHROME.");
  try {
    const config = await (await fetch(`${PORTAIL}/api/auth/config`)).json();
    if (config.mode !== "dev") arreter("le portail doit tourner en connexion de développement (AUTH_MODE=dev).");
  } catch {
    arreter(`portail injoignable sur ${PORTAIL} : lancer npm run dev.`);
  }
  fs.mkdirSync(SORTIE, { recursive: true });

  const profil = fs.mkdtempSync(path.join(os.tmpdir(), "captures-portail-"));
  const chrome = spawn(chromeExe, [
    "--headless=new",
    `--remote-debugging-port=${PORT_DEBUG}`,
    `--user-data-dir=${profil}`,
    `--window-size=${LARGEUR},${HAUTEUR}`,
    "--hide-scrollbars",
    "about:blank",
  ]);
  try {
    await scenes(await connecterCdp());
  } finally {
    chrome.kill();
    await pause(500);
    fs.rmSync(profil, { recursive: true, force: true });
  }
}

// Sous Windows, un fichier tout juste écrit peut être verrouillé un instant (antivirus,
// indexation) : quelques tentatives avant d'abandonner.
async function ecrire(fichier, contenu) {
  for (let essai = 1; ; essai++) {
    try {
      return fs.writeFileSync(fichier, contenu);
    } catch (err) {
      if (essai >= 10) throw err;
      await pause(500);
    }
  }
}

// ---------- Protocole DevTools ----------

async function connecterCdp() {
  let cible;
  for (let i = 0; i < 40 && !cible; i++) {
    await pause(250);
    try {
      cible = (await (await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!cible) arreter("Chrome ne répond pas.");
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const attente = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) {
      attente.get(m.id)(m);
      attente.delete(m.id);
    }
  });
  const cdp = (method, params = {}) =>
    new Promise((r) => {
      attente.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || expression);
    return r.result?.result?.value;
  };
  await cdp("Emulation.setDeviceMetricsOverride", { width: LARGEUR, height: HAUTEUR, deviceScaleFactor: 1, mobile: false });
  return { cdp, js };
}

// ---------- Scènes ----------

async function scenes({ cdp, js }) {
  const aller = async (chemin) => {
    await cdp("Page.navigate", { url: PORTAIL + chemin });
    await pause(1500);
  };
  const attendre = async (selecteur) => {
    for (let i = 0; i < 40; i++) {
      if (await js(`Boolean(document.querySelector(${JSON.stringify(selecteur)}))`)) return;
      await pause(250);
    }
    throw new Error(`élément introuvable : ${selecteur}`);
  };
  const capture = async (nom) => {
    await pause(600);
    const { result } = await cdp("Page.captureScreenshot", { format: "png" });
    await ecrire(path.join(SORTIE, nom), Buffer.from(result.data, "base64"));
    console.log(`[captures] docs/captures/${nom}`);
  };
  // Connexion avec un compte fictif (par son nom), thème choisi, puis page demandée.
  const connecter = async (nom, { theme = "light", chemin = "/" } = {}) => {
    await aller("/");
    const comptes = await js(`fetch("/api/auth/comptes-dev").then((r) => r.json())`);
    const compte = comptes.find((c) => c.nom_complet === nom);
    if (!compte) throw new Error(`compte de démo introuvable : ${nom}`);
    await js(`fetch("/api/auth/login-dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ utilisateur_id: ${compte.id} }) }).then((r) => r.status)`);
    await js(`localStorage.setItem("theme", ${JSON.stringify(theme)})`);
    await aller(chemin);
    await attendre(".shell");
  };
  const premierTicket = (requete) => js(`fetch("/api/tickets?${requete}").then((r) => r.json()).then((l) => l[0]?.id)`);

  // 1. Connexion de développement
  await aller("/");
  await js(`fetch("/api/auth/logout", { method: "POST" })`);
  await js(`localStorage.setItem("theme", "light")`);
  await aller("/");
  await attendre(".login-card");
  await capture("01-connexion.png");

  // 2. Liste d'un intervenant : ses groupes, tickets actifs
  await connecter("Marc Dubois");
  await attendre("table.tickets tbody tr");
  await capture("02-liste.png");

  // 3. Filtres : superviseure, deux établissements et un groupe cochés
  await connecter("Isabelle Garnier");
  await attendre(".etab-item input");
  await js(`document.querySelectorAll(".etab-item input")[0].click()`);
  await pause(900);
  await js(`document.querySelectorAll(".etab-item input")[1].click()`);
  await pause(900);
  await js(`[...document.querySelectorAll("#l-groupes ~ * .etab-item input, [aria-labelledby=l-groupes] .etab-item input")][0]?.click()`);
  await pause(1200);
  await capture("03-filtres.png");

  // 4. Détail d'un ticket affecté à l'intervenant : actions attendues, autres repliées
  await connecter("Marc Dubois");
  const aMoi = await premierTicket("vue=moi&statut=ACTIFS");
  await aller(`/t/${encodeURIComponent(aMoi)}`);
  await attendre(".panel .actions-box");
  await js(`document.querySelector(".autres-actions")?.setAttribute("open", "")`);
  await capture("04-detail.png");

  // 5. Captures d'écran collées et pièce jointe (ticket « DPI très lent »)
  await connecter("Isabelle Garnier");
  const dpi = await premierTicket("vue=groupes&statut=&q=DPI%20tr%C3%A8s%20lent");
  await aller(`/t/${encodeURIComponent(dpi)}`);
  await attendre(".panel .contenu-riche img");
  // Fenêtre haute : le ticket entier (captures collées, pièces jointes, historique).
  await cdp("Emulation.setDeviceMetricsOverride", { width: LARGEUR, height: 1700, deviceScaleFactor: 1, mobile: false });
  await capture("05-captures-pieces-jointes.png");
  await cdp("Emulation.setDeviceMetricsOverride", { width: LARGEUR, height: HAUTEUR, deviceScaleFactor: 1, mobile: false });

  // 6. Capture agrandie
  await js(`document.querySelector(".panel .contenu-riche img").click()`);
  await attendre(".apercu-image");
  await capture("06-capture-agrandie.png");

  // 7. Saisie d'un ticket pour un demandeur
  await connecter("Marc Dubois");
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Nouveau ticket")).click()`);
  await attendre(".panel");
  // Saisie en hotline : appel réglé au téléphone, solution notée -> « Créer et clôturer ».
  const saisir = (sel, valeur) =>
    js(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); c.value = ${JSON.stringify(valeur)}; c.dispatchEvent(new Event(c.tagName === "SELECT" ? "change" : "input")); })()`);
  await saisir("#c-demandeur", "roux");
  await attendre(".suggestions button");
  await js(`document.querySelector(".suggestions button").click()`);
  await pause(200);
  await saisir("#c-catalogue", "107");
  await saisir("#c-description", "Compte bloqué après trois essais, à la prise de poste.\nMessage « compte verrouillé » sur tous les postes.");
  await saisir("#c-solution", "Compte déverrouillé dans l'AD.\nMot de passe changé avec l'appelant, connexion vérifiée.");
  await js(`document.querySelector(".panel-body").scrollTop = 1e6`);
  await pause(300);
  await capture("07-saisie.png");

  // 8. Thème sombre
  await connecter("Marc Dubois", { theme: "dark" });
  await attendre("table.tickets tbody tr");
  await capture("08-theme-sombre.png");

  // 9. Cadre valideur
  await connecter("Claire Martin");
  await capture("09-valideur.png");

  // On referme la dernière session ouverte.
  await js(`fetch("/api/auth/logout", { method: "POST" })`);
}

main().catch((err) => arreter(err.message));
