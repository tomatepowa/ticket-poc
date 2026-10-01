// Tests de texte.js : descriptions EV en HTML (captures collees) ou en texte simple.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { texteSeul, alleger, estHtml } = require("../sources/portail/texte");

const IMAGE = "data:image/png;base64," + "iVBORw0KGgo".repeat(2000);

test("texte simple : inchangé (sauf espaces autour)", () => {
  assert.equal(texteSeul("  Écran noir\nau poste 3  "), "Écran noir\nau poste 3");
  assert.equal(estHtml("prix < 500 et > 100"), false);
});

test("HTML : balises retirées, blocs en lignes, entités décodées", () => {
  const html = "<p>Bonjour,</p><p>L&#39;imprimante affiche&nbsp;: <b>Erreur&nbsp;50</b> &amp; s&eacute;rie</p><ul><li>2e étage</li><li>Bureau 12</li></ul>";
  assert.equal(texteSeul(html), "Bonjour,\nL'imprimante affiche : Erreur 50 & série\n- 2e étage\n- Bureau 12");
});

test("captures collées : remplacées par [image] dans le texte", () => {
  const html = `<p>Voici l'erreur :</p><p><img src="${IMAGE}" alt="capture"></p><p>Merci</p>`;
  assert.equal(texteSeul(html), "Voici l'erreur :\n[image]\nMerci");
});

test("alléger : images intégrées retirées, mise en page et liens conservés", () => {
  const html = `<p>Avant</p><img src="${IMAGE}" width="400"><img src='https://ev.example/image.png'><p>Après</p>`;
  const leger = alleger(html);
  assert.ok(leger.length < 200, `trop long : ${leger.length}`);
  assert.match(leger, /<img src="" data-image-retiree="1" width="400">/);
  assert.match(leger, /https:\/\/ev\.example\/image\.png/, "les images hébergées (liens) restent");
  assert.equal(alleger("Sans image"), "Sans image");
  assert.equal(alleger(null), null);
});

test("script ou style : jamais dans le texte", () => {
  assert.equal(texteSeul("<p>A</p><script>alert(1)</script><style>p{}</style><p>B</p>"), "A\nB");
});
