<script setup>
// Description ou commentaire EasyVista : texte simple, ou HTML de l'éditeur EV
// (mise en forme, captures d'écran collées). Le HTML est ASSAINI par DOMPurify avant
// affichage (ni script, ni gestionnaire d'événement, ni lien javascript:).
// Images : à la largeur du panneau, clic pour agrandir (événement « image »).
// Images non affichables remplacées par une mention :
//  - retirées de la copie locale (EV injoignable : seule la copie est affichée) ;
//  - hébergées dans EasyVista (lien) : le navigateur n'y a pas accès.
import DOMPurify from "dompurify";
import { computed } from "vue";

const props = defineProps({
  contenu: { type: String, default: "" },
  // Texte affiché si le contenu est vide (sinon rien).
  vide: { type: String, default: "" },
});
const emit = defineEmits(["image"]);

const estHtml = (s) => /<\/?[a-z][a-z0-9]*[\s>/]/i.test(s || "");
const html = computed(() => estHtml(props.contenu));

function mention(texte) {
  const span = document.createElement("span");
  span.className = "image-indisponible";
  span.textContent = texte;
  return span;
}

const propre = computed(() => {
  if (!html.value) return "";
  const fragment = DOMPurify.sanitize(props.contenu, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ["style", "form", "input", "button"] });
  for (const img of fragment.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (img.hasAttribute("data-image-retiree") || !src) {
      img.replaceWith(mention("Image non disponible : EasyVista ne répond pas"));
    } else if (!src.startsWith("data:image/")) {
      img.replaceWith(mention("Image hébergée dans EasyVista : à ouvrir dans EasyVista"));
    } else {
      img.removeAttribute("width");
      img.removeAttribute("height");
      img.setAttribute("tabindex", "0");
      img.setAttribute("title", "Agrandir");
    }
  }
  for (const a of fragment.querySelectorAll("a")) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  const conteneur = document.createElement("div");
  conteneur.appendChild(fragment);
  return conteneur.innerHTML;
});

function agrandir(e) {
  const img = e.target.closest("img");
  if (img) emit("image", { src: img.getAttribute("src"), nom: img.getAttribute("alt") || "Image" });
}
</script>

<template>
  <!-- Contenu assaini juste au-dessus : v-html sans risque -->
  <div
    v-if="html"
    class="contenu-riche"
    v-html="propre"
    @click="agrandir"
    @keydown.enter="agrandir"
  ></div>
  <div v-else-if="contenu" class="contenu-texte">{{ contenu }}</div>
  <div v-else-if="vide" class="contenu-texte is-empty">{{ vide }}</div>
</template>
