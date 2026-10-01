<script setup>
// Image en grand (capture collée ou pièce jointe), par-dessus le détail du ticket.
// Fermeture : clic, bouton ✕ ou Échap (sans fermer le détail derrière).
import { onBeforeUnmount, onMounted } from "vue";

defineProps({
  src: { type: String, required: true },
  nom: { type: String, default: "Image" },
  // Lien de téléchargement (pièce jointe), sinon rien.
  telechargement: { type: String, default: "" },
});
const emit = defineEmits(["fermer"]);

function touche(e) {
  if (e.key !== "Escape") return;
  e.stopPropagation(); // phase de capture : l'Échap du détail ne se déclenche pas
  emit("fermer");
}
onMounted(() => window.addEventListener("keydown", touche, true));
onBeforeUnmount(() => window.removeEventListener("keydown", touche, true));
</script>

<template>
  <div class="apercu" role="dialog" aria-modal="true" :aria-label="nom" @click.self="emit('fermer')">
    <div class="apercu-barre">
      <span class="apercu-nom">{{ nom }}</span>
      <a v-if="telechargement" class="btn btn-small" :href="telechargement">Télécharger</a>
      <button class="btn btn-small" type="button" @click="emit('fermer')">Fermer ✕</button>
    </div>
    <img class="apercu-image" :src="src" :alt="nom" @click="emit('fermer')" />
  </div>
</template>
