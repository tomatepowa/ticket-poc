<script setup>
// Rail de gauche : vues, filtres, utilisateur connecte, theme.
import { ref } from "vue";
import { PROFIL_LABEL, debounce, initiales } from "../outils.js";

const props = defineProps({
  moi: { type: Object, required: true },
  vues: { type: Array, required: true },
  referentiels: { type: Object, required: true },
  filtres: { type: Object, required: true },
  config: { type: Object, required: true },
});
const emit = defineEmits(["filtrer", "deconnecter"]);

const STATUTS = [
  { code: "", label: "Tous" },
  { code: "OUVERT", label: "À traiter" },
  { code: "EN_COURS", label: "En cours" },
  { code: "EN_ATTENTE", label: "En attente" },
  { code: "RESOLU", label: "Résolu" },
  { code: "CLOTURE", label: "Clôturé" },
];

const recherche = ref(props.filtres.q);
const filtrerRecherche = debounce((q) => emit("filtrer", { q }), 250);

// ---------- Thème clair / sombre ----------
// "auto" suit la préférence du système ; le choix est mémorisé dans le navigateur.

const THEMES = ["auto", "light", "dark"];
const THEME_LABEL = { auto: "Thème : auto", light: "Thème : clair", dark: "Thème : sombre" };
const theme = ref(document.documentElement.dataset.theme || "auto");

function changerTheme() {
  theme.value = THEMES[(THEMES.indexOf(theme.value) + 1) % THEMES.length];
  if (theme.value === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme.value;
  try {
    if (theme.value === "auto") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme.value);
  } catch (e) {}
}
</script>

<template>
  <aside class="rail">
    <div class="rail-brand">
      <span class="rail-logo" aria-hidden="true">OS</span>
      <div>
        <div class="rail-brand-name">Groupe Exemple</div>
        <div class="rail-brand-sub">Portail tickets IT</div>
      </div>
    </div>

    <nav class="rail-filters" aria-label="Filtres">
      <div class="rail-group">
        <span class="rail-label" id="l-vue">Vue</span>
        <div class="vue-list" role="group" aria-labelledby="l-vue">
          <button
            v-for="v in vues"
            :key="v.code"
            class="vue-item"
            :aria-pressed="v.code === filtres.vue"
            @click="emit('filtrer', { vue: v.code })"
          >
            {{ v.label }}
          </button>
        </div>
      </div>

      <div class="rail-group">
        <label for="f-recherche">Recherche</label>
        <input
          id="f-recherche"
          v-model="recherche"
          type="search"
          placeholder="N°, titre, demandeur…"
          @input="filtrerRecherche(recherche)"
        />
      </div>

      <div class="rail-group">
        <label for="f-etablissement">Établissement</label>
        <select
          id="f-etablissement"
          :value="filtres.etablissement"
          @change="emit('filtrer', { etablissement: $event.target.value })"
        >
          <option value="">Tous</option>
          <option v-for="e in referentiels.etablissements" :key="e.id" :value="String(e.id)">{{ e.nom }}</option>
        </select>
      </div>

      <div v-if="moi.profil !== 'VALIDEUR'" class="rail-group">
        <label for="f-groupe">Groupe</label>
        <select id="f-groupe" :value="filtres.groupe" @change="emit('filtrer', { groupe: $event.target.value })">
          <option value="">Tous</option>
          <option v-for="g in referentiels.groupes" :key="g.id" :value="String(g.id)">{{ g.nom }}</option>
        </select>
      </div>

      <div class="rail-group">
        <span class="rail-label" id="l-statut">Statut</span>
        <div class="chip-set" role="group" aria-labelledby="l-statut">
          <button
            v-for="s in STATUTS"
            :key="s.code"
            class="chip"
            :aria-pressed="s.code === filtres.statut"
            @click="emit('filtrer', { statut: s.code })"
          >
            {{ s.label }}
          </button>
        </div>
      </div>
    </nav>

    <div class="rail-foot">
      <div class="user-card">
        <span class="avatar" aria-hidden="true">{{ initiales(moi) }}</span>
        <div class="user-info">
          <div class="user-name">{{ moi.nom_complet }}</div>
          <div class="user-role">
            {{ PROFIL_LABEL[moi.profil] }}<template v-if="moi.groupes.length"> · {{ moi.groupes.map((g) => g.nom).join(", ") }}</template>
          </div>
        </div>
      </div>
      <div class="rail-foot-actions">
        <button class="theme-toggle" type="button" @click="emit('deconnecter')">Changer d'utilisateur</button>
        <button class="theme-toggle" type="button" @click="changerTheme">{{ THEME_LABEL[theme] }}</button>
      </div>
      <span>{{ config.source === "simulation" ? "Données simulées — non connecté à EasyVista" : "Connecté à EasyVista" }}</span>
    </div>
  </aside>
</template>
