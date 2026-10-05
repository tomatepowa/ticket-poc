// Client de la vraie API EV (clients/http.js) : mode lecture seule.
// Un petit serveur HTTP local tient lieu d'EasyVista et note les requetes recues.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

let serveur;
let recues = [];

before(async () => {
  serveur = http.createServer((req, res) => {
    recues.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ records: [{ STATUS_ID: 1, STATUS_FR: "Nouveau" }] }));
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
});
after(() => serveur.close());

function client(lectureSeule) {
  Object.assign(process.env, {
    EV_URL: `http://127.0.0.1:${serveur.address().port}`,
    EV_ACCOUNT: "50000",
    EV_TOKEN: "jeton-de-test",
    EV_LECTURE_SEULE: lectureSeule ? "1" : "",
  });
  delete require.cache[require.resolve("../sources/clients/http")];
  return require("../sources/clients/http");
}

test("lecture seule : les lectures passent", async () => {
  recues = [];
  const ev = client(true);
  const { records } = await ev.getStatuses();
  assert.equal(records[0].STATUS_FR, "Nouveau");
  assert.deepEqual(recues, ["GET /api/v1/50000/status?max_rows=1000"]);
});

test("lecture seule : aucune écriture n'est envoyée à EV", async () => {
  recues = [];
  const ev = client(true);
  for (const ecriture of [
    () => ev.createRequest({ requests: [{}] }),
    () => ev.createAction("I1", { action: {} }),
    () => ev.endAction("I1", { end_action: {} }),
    () => ev.updateAction(1, { done_by_id: 2 }),
    () => ev.updateRequest("I1", { closed: {} }),
    () => ev.startWorkflow("I1"),
    () => ev.createQuestionResult(1, 2, {}),
  ]) {
    await assert.rejects(ecriture, (err) => err.status === 403 && /lecture seule/i.test(err.message));
  }
  assert.deepEqual(recues, []);
});

test("hors lecture seule : les écritures partent", async () => {
  recues = [];
  const ev = client(false);
  await ev.updateRequest("I1", { closed: {} });
  assert.deepEqual(recues, ["PUT /api/v1/50000/requests/I1"]);
});
