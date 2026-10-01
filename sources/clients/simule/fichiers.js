// fichiers.js — fausses captures d'ecran et pieces jointes du faux EasyVista.
//
// Imite ce que les utilisateurs mettent dans leurs tickets : captures collees dans
// la description (image integree en data:...), et fichiers joints (capture, journal
// texte, PDF). Tout est genere ici, sans dependance : captures en SVG (fenetre
// d'application avec un message d'erreur), PDF d'une page ecrit a la main.

const echapper = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Capture d'ecran factice : fenetre « titre », boite d'erreur avec ses lignes.
function capture({ titre = "Application", message = "Une erreur est survenue.", details = [], couleur = "#2D6A6F", largeur = 640, hauteur = 360 }) {
  const lignes = [message, ...details].slice(0, 5);
  const texte = lignes
    .map((l, i) => `<text x="${largeur / 2 - 170}" y="${hauteur / 2 - 4 + i * 22}" font-size="${i ? 13 : 15}" font-weight="${i ? 400 : 700}" fill="#1f2a28">${echapper(l)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" font-family="Segoe UI, Arial, sans-serif">
<rect width="${largeur}" height="${hauteur}" fill="#eef1f0"/>
<rect width="${largeur}" height="34" fill="${couleur}"/>
<text x="14" y="22" font-size="14" fill="#fff">${echapper(titre)}</text>
<rect x="18" y="52" width="150" height="${hauteur - 70}" fill="#dde3e1"/>
<rect x="186" y="52" width="${largeur - 204}" height="18" fill="#dde3e1"/><rect x="186" y="80" width="${largeur - 260}" height="12" fill="#e4e9e7"/>
<rect x="${largeur / 2 - 190}" y="${hauteur / 2 - 62}" width="380" height="${84 + lignes.length * 22}" rx="6" fill="#fff" stroke="#b5c0bb"/>
<circle cx="${largeur / 2 - 160}" cy="${hauteur / 2 - 38}" r="11" fill="#c0392b"/><text x="${largeur / 2 - 164}" y="${hauteur / 2 - 33}" font-size="15" font-weight="700" fill="#fff">!</text>
<text x="${largeur / 2 - 140}" y="${hauteur / 2 - 33}" font-size="13" fill="#5f6a66">Erreur</text>
${texte}
</svg>`;
}

const versBase64 = (contenu) => Buffer.from(contenu).toString("base64");
const imageIntegree = (svg) => `data:image/svg+xml;base64,${versBase64(svg)}`;

// PDF d'une page, quelques lignes de texte (Helvetica) : assez pour s'ouvrir partout.
function pdf(titre, lignes) {
  const latin1 = (s) => String(s).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\xff]/g, "?");
  const flux = [`BT /F1 16 Tf 56 780 Td (${latin1(titre)}) Tj ET`, ...lignes.map((l, i) => `BT /F1 11 Tf 56 ${748 - i * 18} Td (${latin1(l)}) Tj ET`)].join("\n");
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(flux, "latin1")} >>\nstream\n${flux}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let sortie = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(sortie, "latin1"));
    sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(sortie, "latin1");
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(sortie, "latin1");
}

// Description HTML d'un ticket : paragraphes, puis une ou plusieurs captures collees.
function descriptionAvecCaptures(paragraphes, captures) {
  const html = paragraphes.map((p) => `<p>${echapper(p)}</p>`);
  for (const c of captures) html.push(`<p><img src="${imageIntegree(capture(c))}" alt="capture" width="${c.largeur || 640}"></p>`);
  return html.join("");
}

module.exports = { capture, imageIntegree, pdf, descriptionAvecCaptures, echapper };
