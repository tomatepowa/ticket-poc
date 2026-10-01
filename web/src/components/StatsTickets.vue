<script setup>
// Indicateurs au-dessus de la liste : une carte par vue (mes groupes, mes tickets,
// non affectés, affectés à un autre) avec son nombre de tickets, selon les filtres
// du rail. Un clic charge la vue. (Le nombre de tickets par groupe est dans le
// filtre Groupe du rail.)
import { computed } from "vue";

const props = defineProps({
  stats: { type: Object, required: true },
  profil: { type: String, required: true },
  filtres: { type: Object, required: true },
  vues: { type: Array, required: true },
});
const emit = defineEmits(["filtrer"]);

// Couleur du chiffre par vue (les autres restent neutres).
const COULEUR = { moi: "is-accent", non_affectes: "is-rose", autres: "is-slate" };

const cartes = computed(() =>
  props.vues.map((v) => ({
    code: v.code,
    label: v.label,
    valeur: props.stats.parVue?.[v.code] ?? 0,
    actif: props.filtres.vue === v.code,
    cls: COULEUR[v.code] || "",
  }))
);

function choisirVue(c) {
  if (!c.actif) emit("filtrer", { vue: c.code });
}
</script>

<template>
  <section class="stats stats-4" aria-label="Vues">
    <button
      v-for="c in cartes"
      :key="c.code"
      type="button"
      class="stat stat-filtre"
      :class="{ 'is-actif': c.actif }"
      :aria-pressed="c.actif"
      :title="c.actif ? c.label : `Afficher : ${c.label}`"
      @click="choisirVue(c)"
    >
      <span class="stat-label">{{ c.label }}</span>
      <span class="stat-value" :class="c.cls">{{ c.valeur }}</span>
    </button>
  </section>
</template>
