<script setup>
// Indicateurs au-dessus de la liste, et charge par groupe pour les intervenants.
import { computed } from "vue";

const props = defineProps({
  stats: { type: Object, required: true },
  profil: { type: String, required: true },
});

const cartes = computed(() => {
  const s = props.stats;
  const n = (...statuts) => statuts.reduce((a, st) => a + (s.parStatut[st] || 0), 0);
  return [
    { label: "Attendent mon action", valeur: s.attendent_mon_action, cls: s.attendent_mon_action ? "is-accent" : "" },
    { label: "À traiter ou en cours", valeur: n("OUVERT", "EN_COURS"), cls: "is-amber" },
    { label: "En attente", valeur: n("EN_ATTENTE"), cls: "is-slate" },
    { label: "En retard", valeur: s.en_retard, cls: s.en_retard ? "is-rose" : "" },
  ];
});

// Seuls les groupes ayant des tickets en cours, du plus chargé au moins chargé.
const groupesCharges = computed(() => props.stats.parGroupe.filter((r) => r.n > 0).sort((a, b) => b.n - a.n));
const voitGroupes = computed(() => props.profil !== "VALIDEUR" && groupesCharges.value.length > 0);
const maxGroupe = computed(() => Math.max(1, ...groupesCharges.value.map((r) => r.n)));
</script>

<template>
  <section class="stats" :class="{ 'stats-4': !voitGroupes }" aria-label="Indicateurs">
    <div v-for="c in cartes" :key="c.label" class="stat">
      <span class="stat-label">{{ c.label }}</span>
      <span class="stat-value" :class="c.cls">{{ c.valeur }}</span>
    </div>

    <div v-if="voitGroupes" class="stat stat-teams">
      <span class="stat-label">Charge en cours par groupe</span>
      <div class="teams">
        <div v-for="r in groupesCharges" :key="r.groupe.id" class="team-row">
          <span class="team-name" :title="r.groupe.nom">{{ r.groupe.nom }}</span>
          <span class="team-bar"><span :style="{ width: `${(r.n / maxGroupe) * 100}%` }"></span></span>
          <span class="team-n">{{ r.n }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
