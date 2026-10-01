<script setup>
// Indicateurs au-dessus de la liste : une carte par vue (mes groupes, mes tickets,
// non affectés, affectés à un autre) avec son nombre de tickets, selon les filtres
// du rail. Un clic charge la vue. En dessous, la charge par groupe (clic : filtre).
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

// Seuls les groupes ayant des tickets en cours, du plus chargé au moins chargé.
const groupesCharges = computed(() => props.stats.parGroupe.filter((r) => r.n > 0).sort((a, b) => b.n - a.n));
const voitGroupes = computed(() => props.profil !== "VALIDEUR" && groupesCharges.value.length > 0);
const maxGroupe = computed(() => Math.max(1, ...groupesCharges.value.map((r) => r.n)));
const filtreGroupe = (g) => ({
  actif: props.filtres.groupe === String(g.id),
  activer: { groupe: String(g.id) },
  retirer: { groupe: "" },
  libelle: `groupe « ${g.nom} »`,
});

const titre = (f) => (f.actif ? `Retirer le filtre : ${f.libelle}` : `Filtrer : ${f.libelle}`);
function appliquer(f) {
  emit("filtrer", f.actif ? f.retirer : f.activer, f.actif ? `Filtre retiré : ${f.libelle}` : `Filtre : ${f.libelle}`);
}
</script>

<template>
  <section class="stats" :class="{ 'stats-4': !voitGroupes }" aria-label="Vues">
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

    <div v-if="voitGroupes" class="stat stat-teams">
      <span class="stat-label">Charge en cours par groupe</span>
      <div class="teams">
        <button
          v-for="r in groupesCharges"
          :key="r.groupe.id"
          type="button"
          class="team-row stat-filtre"
          :class="{ 'is-actif': filtreGroupe(r.groupe).actif }"
          :aria-pressed="filtreGroupe(r.groupe).actif"
          :title="titre(filtreGroupe(r.groupe))"
          @click="appliquer(filtreGroupe(r.groupe))"
        >
          <span class="team-name">{{ r.groupe.nom }}</span>
          <span class="team-bar"><span :style="{ width: `${(r.n / maxGroupe) * 100}%` }"></span></span>
          <span class="team-n">{{ r.n }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
