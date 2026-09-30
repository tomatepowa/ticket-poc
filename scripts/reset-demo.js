// npm run reset-demo : recree les tickets de demo du faux EasyVista et vide la
// copie locale (PostgreSQL), qui sera resynchronisee au prochain demarrage.
// Necessite DATABASE_URL, comme le portail.

const ev = require("../sources/clients/simule");
const cache = require("../sources/portail/cache");

(async () => {
  ev.reinitialiserDemo();
  ev.fermer();
  await cache.initialiser();
  await cache.vider();
  await cache.fermer();
  console.log("Demo de l'EV simule recreee, copie locale videe (resynchronisee au demarrage).");
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
