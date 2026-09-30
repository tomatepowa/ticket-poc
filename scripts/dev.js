// npm run dev : lance le portail en developpement, en une seule commande.
//
//  1. lit le fichier .env (DATABASE_URL, DEV_CONTENEUR_PG...) ;
//  2. si DEV_CONTENEUR_PG est defini : lance Docker Desktop s'il est arrete,
//     puis demarre ce conteneur PostgreSQL ;
//  3. attend que la base reponde ;
//  4. demarre le portail (Ctrl+C pour l'arreter).
//
// En production, c'est "npm start" (service Windows) : ce script ne sert qu'aux postes de dev.

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const racine = path.join(__dirname, "..");
const DOCKER_DESKTOP = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const info = (m) => console.log(`[dev] ${m}`);
function arreter(m) {
  console.error(`[dev] ${m}`);
  process.exit(1);
}

// ---------- 1. Configuration ----------
const fichierEnv = path.join(racine, ".env");
if (fs.existsSync(fichierEnv)) process.loadEnvFile(fichierEnv);
if (!process.env.DATABASE_URL) {
  arreter("DATABASE_URL absente : copier .env.exemple en .env et l'adapter.");
}

const docker = (...args) => spawnSync("docker", args, { encoding: "utf8" });
const dockerPret = () => docker("info", "--format", "{{.ServerVersion}}").status === 0;

async function demarrerBase(conteneur) {
  // Docker Desktop
  if (!dockerPret()) {
    if (process.platform === "win32" && fs.existsSync(DOCKER_DESKTOP)) {
      info("Docker Desktop est arrêté : lancement (cela peut prendre une minute)…");
      spawn(DOCKER_DESKTOP, [], { detached: true, stdio: "ignore" }).unref();
    } else {
      arreter("Docker ne répond pas : lancer Docker, puis relancer npm run dev.");
    }
    for (let i = 0; i < 60 && !dockerPret(); i++) await pause(3000);
    if (!dockerPret()) arreter("Docker ne répond toujours pas après 3 minutes.");
    info("Docker est prêt.");
  }

  // Conteneur PostgreSQL
  const etat = docker("inspect", "-f", "{{.State.Status}}", conteneur);
  if (etat.status !== 0) {
    arreter(`Conteneur ${conteneur} introuvable. Pour une base neuve : docker compose up -d base (voir README).`);
  }
  if (etat.stdout.trim() !== "running") {
    info(`Démarrage du conteneur ${conteneur}…`);
    if (docker("start", conteneur).status !== 0) arreter(`Impossible de démarrer ${conteneur}.`);
  }
}

// ---------- 3. Attendre la base ----------
async function attendreBase() {
  const { Client } = require("pg");
  for (let i = 0; i < 30; i++) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => {});
      await pause(1000);
    }
  }
  arreter("La base ne répond pas (DATABASE_URL correcte ? conteneur démarré ?).");
}

(async () => {
  if (process.env.DEV_CONTENEUR_PG) await demarrerBase(process.env.DEV_CONTENEUR_PG);
  info("Connexion à la base…");
  await attendreBase();
  info(`Base prête. Portail : http://localhost:${process.env.PORT || 3000} (Ctrl+C pour arrêter)`);

  // ---------- 4. Portail ----------
  const portail = spawn(process.execPath, ["server.js"], { cwd: racine, stdio: "inherit", env: process.env });
  const stop = () => portail.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  portail.on("exit", (code) => process.exit(code ?? 0));
})().catch((err) => arreter(err.message));
