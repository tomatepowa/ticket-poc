<script setup>
// Résumé des filtres actifs, en haut de la liste : une pastille par filtre (✕ pour
// le retirer seul) et « Tout effacer » pour revenir aux filtres par défaut.
// Le statut est toujours affiché, même par défaut (« Actifs », sans ✕) : la liste
// n'est jamais filtrée sans qu'on le voie. Idem pour la vue (✕ : retour à la vue
// par défaut de l'utilisateur).
import { computed } from "vue";

const props = defineProps({
  filtres: { type: Object, required: true },
  referentiels: { type: Object, required: true },
  vues: { type: Array, required: true },
  // Valeurs par défaut : { vue, statut }.
  defauts: { type: Object, required: true },
});
const emit = defineEmits(["filtrer"]);

const LIBELLE_STATUT = { "": "Tous", ACTIFS: "Actifs", INACTIFS: "Inactifs" };
const nomEtablissement = (id) => props.referentiels.etablissements.find((e) => e.id === id)?.nom || `Établissement ${id}`;
const nomGroupe = (id) => props.referentiels.groupes.find((g) => String(g.id) === String(id))?.nom || `Groupe ${id}`;

const actifs = computed(() => {
  const f = props.filtres;
  const liste = [];
  // retirer null : filtre par défaut, affiché mais rien à retirer.
  liste.push({
    cle: "vue",
    type: "Vue",
    texte: props.vues.find((v) => v.code === f.vue)?.label || f.vue,
    retirer: f.vue === props.defauts.vue ? null : { vue: props.defauts.vue },
  });
  const statutDefaut = f.statut === props.defauts.statut;
  liste.push({
    cle: "statut",
    type: "Statut",
    texte: LIBELLE_STATUT[f.statut] ?? f.statut,
    retirer: statutDefaut ? null : { statut: props.defauts.statut },
  });
  if (f.q) liste.push({ cle: "q", type: "Recherche", texte: `« ${f.q} »`, retirer: { q: "" } });
  const groupes = String(f.groupe || "").split(",").filter(Boolean).map(Number);
  for (const id of groupes) {
    liste.push({
      cle: `groupe-${id}`,
      type: "Groupe",
      texte: nomGroupe(id),
      retirer: { groupe: groupes.filter((x) => x !== id).join(",") },
    });
  }
  const coches = String(f.etablissement || "").split(",").filter(Boolean).map(Number);
  for (const id of coches) {
    liste.push({
      cle: `etab-${id}`,
      type: "Établissement",
      texte: nomEtablissement(id),
      retirer: { etablissement: coches.filter((x) => x !== id).join(",") },
    });
  }
  return liste;
});

// Au moins un filtre différent des valeurs par défaut.
const modifies = computed(() => actifs.value.some((f) => f.retirer));

function retirer(filtre) {
  emit("filtrer", filtre.retirer, `Filtre retiré : ${filtre.type.toLowerCase()} ${filtre.texte}`);
}

function toutEffacer() {
  emit("filtrer", { vue: props.defauts.vue, statut: props.defauts.statut, q: "", groupe: "", etablissement: "" }, "Filtres effacés");
}
</script>

<template>
  <div class="filtres-actifs" :class="{ 'is-defaut': !modifies }" role="region" aria-label="Filtres actifs">
    <span class="filtres-actifs-titre">Filtres :</span>
    <span v-for="f in actifs" :key="f.cle" class="filtre-actif">
      <span class="filtre-actif-type">{{ f.type }}</span>
      <span class="filtre-actif-texte">{{ f.texte }}</span>
      <button
        v-if="f.retirer"
        type="button"
        class="filtre-actif-retirer"
        :aria-label="`Retirer le filtre ${f.type} ${f.texte}`"
        @click="retirer(f)"
      >✕</button>
      <span v-else class="filtre-actif-defaut">par défaut</span>
    </span>
    <button v-if="modifies" type="button" class="filtres-effacer" @click="toutEffacer">
      <span aria-hidden="true">⌫</span> Tout effacer
    </button>
  </div>
</template>
