<script setup>
// Indicateurs au-dessus de la liste, et charge par groupe pour les intervenants.
// Chaque carte et chaque groupe est cliquable : il applique le filtre (ou la vue)
// correspondant ; un second clic le retire.
import { computed } from "vue";

const props = defineProps({
  stats: { type: Object, required: true },
  profil: { type: String, required: true },
  filtres: { type: Object, required: true },
  vues: { type: Array, required: true },
});
const emit = defineEmits(["filtrer"]);

const aVue = (code) => props.vues.some((v) => v.code === code);
const libelleVue = (code) => props.vues.find((v) => v.code === code)?.label || code;
// Statut par defaut de la liste : on y revient quand on retire un filtre de statut.
const STATUT_DEFAUT = "ACTIFS";

// Filtre d'une vue (ex. « Attendent mon action ») : null si le profil n'a pas cette vue.
function filtreVue(code) {
  if (!aVue(code)) return null;
  return {
    actif: props.filtres.vue === code,
    activer: { vue: code },
    retirer: { vue: props.vues[0].code },
    libelle: `vue « ${libelleVue(code)} »`,
  };
}
const filtreStatut = (statut, libelle) => ({
  actif: props.filtres.statut === statut,
  activer: { statut },
  retirer: { statut: STATUT_DEFAUT },
  libelle,
});

const cartes = computed(() => {
  const s = props.stats;
  const n = (...statuts) => statuts.reduce((a, st) => a + (s.parStatut[st] || 0), 0);
  return [
    {
      label: "Attendent mon action",
      valeur: s.attendent_mon_action,
      cls: s.attendent_mon_action ? "is-accent" : "",
      // Valideur : sa vue « À valider » joue ce rôle.
      filtre: filtreVue("action") || filtreVue("a_valider"),
    },
    {
      label: "À traiter ou en cours",
      valeur: n("OUVERT", "EN_COURS"),
      cls: "is-amber",
      filtre: filtreStatut("OUVERT,EN_COURS", "à traiter ou en cours"),
    },
    { label: "En attente", valeur: n("EN_ATTENTE"), cls: "is-slate", filtre: filtreStatut("EN_ATTENTE", "en attente") },
    {
      label: "En retard",
      valeur: s.en_retard,
      cls: s.en_retard ? "is-rose" : "",
      filtre: { actif: props.filtres.retard === "1", activer: { retard: "1" }, retirer: { retard: "" }, libelle: "en retard" },
    },
  ];
});

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
  <section class="stats" :class="{ 'stats-4': !voitGroupes }" aria-label="Indicateurs">
    <template v-for="c in cartes" :key="c.label">
      <button
        v-if="c.filtre"
        type="button"
        class="stat stat-filtre"
        :class="{ 'is-actif': c.filtre.actif }"
        :aria-pressed="c.filtre.actif"
        :title="titre(c.filtre)"
        @click="appliquer(c.filtre)"
      >
        <span class="stat-label">{{ c.label }}</span>
        <span class="stat-value" :class="c.cls">{{ c.valeur }}</span>
      </button>
      <div v-else class="stat">
        <span class="stat-label">{{ c.label }}</span>
        <span class="stat-value" :class="c.cls">{{ c.valeur }}</span>
      </div>
    </template>

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
