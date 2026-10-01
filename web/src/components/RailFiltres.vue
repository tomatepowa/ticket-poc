<script setup>
// Rail de gauche : vues, filtres, utilisateur connecte, theme.
import { computed, ref, watch } from "vue";
import { PROFIL_LABEL, debounce, initiales } from "../outils.js";

const props = defineProps({
  moi: { type: Object, required: true },
  vues: { type: Array, required: true },
  referentiels: { type: Object, required: true },
  filtres: { type: Object, required: true },
  config: { type: Object, required: true },
  stats: { type: Object, default: null },
});
const emit = defineEmits(["filtrer", "deconnecter"]);

const STATUTS = [
  { code: "", label: "Tous" },
  { code: "ACTIFS", label: "Actifs" }, // tout sauf résolu et clôturé
  { code: "INACTIFS", label: "Inactifs" }, // résolus et clôturés
];

const recherche = ref(props.filtres.q);
const filtrerRecherche = debounce((q) => emit("filtrer", { q }), 250);
// Recherche posée depuis la liste (clic sur un intervenant) : le champ suit.
watch(
  () => props.filtres.q,
  (q) => {
    if (q !== recherche.value) recherche.value = q;
  }
);

// ---------- Établissements : plusieurs cochés possibles, avec leur volume ----------
// filtres.etablissement = "1,3,12" (vide = tous).

const coches = computed(() => new Set(String(props.filtres.etablissement || "").split(",").filter(Boolean).map(Number)));

function basculerEtablissement(id) {
  const ids = new Set(coches.value);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  emit("filtrer", { etablissement: [...ids].join(",") });
}

// Tickets en cours par établissement : { moi, groupes } (tous les tickets pour un superviseur).
const volumes = computed(() => new Map((props.stats?.parEtablissement || []).map((e) => [e.id, e])));
const volume = (id) => volumes.value.get(id) || { moi: 0, groupes: 0 };
const libelleGroupes = computed(() => (props.moi.profil === "SUPERVISEUR" ? "en cours" : "de mes groupes"));

// Tri de la liste : par volume décroissant (mes groupes, ou à moi) ou alphabétique.
// Le choix est mémorisé dans le navigateur (simple confort).
const CLE_TRI = "tri-etablissements";
const tris = computed(() => [
  { code: "groupes", label: props.moi.profil === "SUPERVISEUR" ? "En cours" : "Mes groupes" },
  { code: "moi", label: "À moi" },
  { code: "alpha", label: "A → Z" },
]);
const tri = ref(lireTri());

function lireTri() {
  try {
    const t = localStorage.getItem(CLE_TRI);
    return ["groupes", "moi", "alpha"].includes(t) ? t : "groupes";
  } catch {
    return "groupes";
  }
}

function choisirTri(code) {
  tri.value = code;
  try {
    localStorage.setItem(CLE_TRI, code);
  } catch {}
}

// Les établissements cochés restent en tête de liste, pour voir d'un coup d'œil le filtre.
const etablissementsTries = computed(() => {
  const parNom = (a, b) => a.nom.localeCompare(b.nom, "fr");
  const cochesEnTete = (a, b) => coches.value.has(b.id) - coches.value.has(a.id);
  const liste = [...props.referentiels.etablissements];
  if (tri.value === "alpha") return liste.sort((a, b) => cochesEnTete(a, b) || parNom(a, b));
  // Volume décroissant ; à égalité, l'autre compteur puis le nom.
  const autre = tri.value === "moi" ? "groupes" : "moi";
  return liste.sort(
    (a, b) =>
      cochesEnTete(a, b) ||
      volume(b.id)[tri.value] - volume(a.id)[tri.value] ||
      volume(b.id)[autre] - volume(a.id)[autre] ||
      parNom(a, b)
  );
});

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
            <span>{{ v.label }}</span>
            <span v-if="stats?.parVue" class="vue-compte">{{ stats.parVue[v.code] ?? 0 }}</span>
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
        <span class="rail-label" id="l-statut">Statut</span>
        <div class="chip-set" role="group" aria-labelledby="l-statut">
          <button
            v-for="s in STATUTS"
            :key="s.code"
            class="chip"
            :aria-pressed="s.code === filtres.statut"
            @click="emit('filtrer', { statut: s.code })"
          >
            {{ s.label }}<span v-if="stats?.parFiltreStatut" class="chip-compte">({{ stats.parFiltreStatut[s.code] || 0 }})</span>
          </button>
        </div>
      </div>

      <div v-if="moi.profil !== 'VALIDEUR'" class="rail-group">
        <label for="f-groupe">Groupe</label>
        <select id="f-groupe" :value="filtres.groupe" @change="emit('filtrer', { groupe: $event.target.value })">
          <option value="">Tous</option>
          <option v-for="g in referentiels.groupes" :key="g.id" :value="String(g.id)">{{ g.nom }}</option>
        </select>
      </div>

      <div class="rail-group">
        <div class="rail-label-ligne">
          <span class="rail-label" id="l-etab">Établissements</span>
          <button v-if="coches.size" class="lien-rail" type="button" @click="emit('filtrer', { etablissement: '' })">
            Tout décocher ({{ coches.size }})
          </button>
        </div>
        <p class="etab-legende">Tickets {{ !filtres.statut || filtres.statut === "ACTIFS" ? "en cours " : "" }}: à moi / {{ libelleGroupes }}</p>
        <div class="etab-tri" role="group" aria-label="Trier les établissements">
          <button
            v-for="t in tris"
            :key="t.code"
            type="button"
            class="etab-tri-btn"
            :aria-pressed="tri === t.code"
            @click="choisirTri(t.code)"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="etab-liste" role="group" aria-labelledby="l-etab">
          <label
            v-for="e in etablissementsTries"
            :key="e.id"
            class="etab-item"
            :class="{ 'is-vide': !volume(e.id).groupes && !volume(e.id).moi, 'is-coche': coches.has(e.id) }"
          >
            <input type="checkbox" :checked="coches.has(e.id)" @change="basculerEtablissement(e.id)" />
            <span class="etab-nom" :title="e.nom">{{ e.nom }}</span>
            <span
              class="etab-compte"
              :title="`${volume(e.id).moi} affecté(s) à moi, ${volume(e.id).groupes} ${libelleGroupes}`"
            >({{ volume(e.id).moi }}/{{ volume(e.id).groupes }})</span>
          </label>
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
