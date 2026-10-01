// texte.js — descriptions et commentaires EasyVista : HTML (editeur riche, images
// collees) ou texte simple.
//
//  - texteSeul(html)  : version texte lisible (titre de repli, recherche, pole BI) ;
//  - alleger(html)    : meme HTML sans les images integrees (data:...), pour la copie
//                       locale : les images restent dans EV, la base ne gonfle pas.
//
// Ce n'est PAS un filtre de securite : l'affichage du HTML est assaini dans le
// navigateur (DOMPurify, web/src/components/ContenuRiche.vue).

const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", euml: "ë", laquo: "«", raquo: "»", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", euro: "€", deg: "°" };

function decoderEntites(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : tout;
    }
    return ENTITES[e.toLowerCase()] ?? tout;
  });
}

// Le texte contient-il du HTML (au moins une balise) ?
const estHtml = (s) => /<\/?[a-z][a-z0-9]*[\s>/]/i.test(String(s || ""));

function texteSeul(contenu) {
  const s = String(contenu || "");
  if (!estHtml(s)) return s.trim();
  return decoderEntites(
    s
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<img\b[^>]*>/gi, " [image] ")
      // Fins de bloc et sauts de ligne -> retour a la ligne
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Images integrees (src="data:...") remplacees par une image vide marquee : la copie
// locale garde la mise en page, pas les octets.
function alleger(contenu) {
  const s = String(contenu ?? "");
  if (!s.includes("data:")) return contenu;
  return s.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:[^"']*\2/gi, '$1$2$2 data-image-retiree="1"');
}

module.exports = { texteSeul, alleger, estHtml };
