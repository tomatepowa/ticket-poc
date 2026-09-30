<script setup>
// Liste des tickets. Un clic ouvre le detail ; Ctrl/Cmd/Maj + clic sur le n°
// laisse le navigateur ouvrir le lien direct dans un nouvel onglet.
// En-tetes cliquables : tri croissant, puis decroissant au deuxieme clic.
// Selection multiple (equipes support) : remettre des tickets affectes dans leur groupe.
import { computed, ref, watch } from "vue";
import { PRIORITE_LABEL, formatCourt } from "../outils.js";

const props = defineProps({
  tickets: { type: Array, required: true },
  selectionnable: { type: Boolean, default: false },
});
const emit = defineEmits(["ouvrir", "desaffecter"]);

// ---------- Tri ----------

const sansEcheance = (t) => t.statut === "RESOLU" || t.statut === "CLOTURE" || !t.echeance;
const ORDRE_STATUT = { OUVERT: 0, EN_COURS: 1, EN_ATTENTE: 2, RESOLU: 3, CLOTURE: 4 };
const texte = (a, b) => String(a).localeCompare(String(b), "fr", { sensitivity: "base", numeric: true });

// Valeur de tri de chaque colonne ; null = vide, toujours en fin de liste.
const COLONNES = {
  priorite: { label: "Prio.", valeur: (t) => t.priorite ?? null },
  numero: { label: "N°", valeur: (t) => t.numero },
  creation: { label: "Créé le", valeur: (t) => t.date_creation || null },
  titre: { label: "Ticket", valeur: (t) => t.titre || null },
  demandeur: { label: "Demandeur", valeur: (t) => t.demandeur?.nom || null },
  // Par groupe, puis intervenant (non affecté en tête du groupe)
  affectation: { label: "Affectation", valeur: (t) => (t.groupe ? `${t.groupe.nom}\u0000${t.intervenant?.nom || ""}` : null) },
  // Dans l'ordre du cycle de vie, puis par étape
  etape: { label: "Étape", valeur: (t) => `${ORDRE_STATUT[t.statut] ?? 9}\u0000${t.etape.label}` },
  echeance: { label: "Échéance", valeur: (t) => (sansEcheance(t) ? null : t.echeance) },
};

const CLE_TRI = "tri-tickets";
const tri = ref(lireTri());

function lireTri() {
  try {
    const t = JSON.parse(localStorage.getItem(CLE_TRI));
    if (t && COLONNES[t.colonne] && ["asc", "desc"].includes(t.sens)) return t;
  } catch {}
  return { colonne: "creation", sens: "desc" }; // plus récents d'abord
}

// Premier clic : croissant ; clic suivant sur la même colonne : inverse.
function trier(colonne) {
  tri.value =
    tri.value.colonne === colonne
      ? { colonne, sens: tri.value.sens === "asc" ? "desc" : "asc" }
      : { colonne, sens: "asc" };
  try {
    localStorage.setItem(CLE_TRI, JSON.stringify(tri.value));
  } catch {}
}

const ticketsTries = computed(() => {
  const { colonne, sens } = tri.value;
  const valeur = COLONNES[colonne].valeur;
  const signe = sens === "asc" ? 1 : -1;
  return [...props.tickets].sort((a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    if (va == null && vb == null) return texte(a.numero, b.numero);
    if (va == null) return 1; // vides toujours en fin de liste
    if (vb == null) return -1;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : texte(va, vb);
    return c * signe || texte(a.numero, b.numero);
  });
});

const ariaSort = (colonne) =>
  tri.value.colonne === colonne ? (tri.value.sens === "asc" ? "ascending" : "descending") : "none";
const fleche = (colonne) => (tri.value.colonne === colonne ? (tri.value.sens === "asc" ? "▲" : "▼") : "");

// ---------- Sélection multiple ----------

// Seuls les tickets affectes a quelqu'un peuvent etre remis dans leur groupe.
const eligible = (t) => t.affectation === "MOI" || t.affectation === "TIERS";
const selection = ref(new Set());
const eligibles = computed(() => props.tickets.filter(eligible));
const toutCoche = computed(() => eligibles.value.length > 0 && eligibles.value.every((t) => selection.value.has(t.id)));

// La liste change (filtres, synchro) : on ne garde que les tickets encore affiches et eligibles.
watch(
  () => props.tickets,
  () => (selection.value = new Set(eligibles.value.filter((t) => selection.value.has(t.id)).map((t) => t.id)))
);

function basculer(t) {
  const s = new Set(selection.value);
  if (s.has(t.id)) s.delete(t.id);
  else s.add(t.id);
  selection.value = s;
}

function basculerTout() {
  selection.value = toutCoche.value ? new Set() : new Set(eligibles.value.map((t) => t.id));
}

function desaffecter() {
  emit("desaffecter", [...selection.value]);
  selection.value = new Set();
}

function onClic(e, t) {
  if (e.target.closest(".col-selection")) return;
  if (e.target.closest("a") && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;
  e.preventDefault();
  emit("ouvrir", t.id);
}
</script>

<template>
  <div class="barre-liste">
    <div v-if="selection.size" class="barre-selection" role="region" aria-label="Tickets sélectionnés">
      <strong>{{ selection.size }} ticket{{ selection.size > 1 ? "s" : "" }} sélectionné{{ selection.size > 1 ? "s" : "" }}</strong>
      <button class="btn btn-small btn-primary" type="button" @click="desaffecter">Remettre dans leur groupe (non affectés)</button>
      <button class="btn btn-small" type="button" @click="selection = new Set()">Annuler la sélection</button>
    </div>
    <p class="legende-affectation" aria-hidden="true">
      <span class="affecte affecte-aucun">Non affecté</span>
      <span class="affecte affecte-moi">Moi</span>
      <span class="affecte affecte-tiers">Affecté à un autre</span>
    </p>
  </div>
  <section class="table-wrap">
    <table class="tickets">
      <thead>
        <tr>
          <th v-if="selectionnable" class="col-selection">
            <input
              type="checkbox"
              :checked="toutCoche"
              :disabled="!eligibles.length"
              aria-label="Sélectionner tous les tickets affectés"
              @change="basculerTout"
            />
          </th>
          <th class="col-prio" :aria-sort="ariaSort('priorite')">
            <button type="button" class="tri" @click="trier('priorite')">Prio.<span class="fleche">{{ fleche("priorite") }}</span></button>
          </th>
          <!-- N° et date de création : deux tris dans la même colonne -->
          <th :aria-sort="tri.colonne === 'creation' ? ariaSort('creation') : ariaSort('numero')">
            <button type="button" class="tri" @click="trier('numero')">N°<span class="fleche">{{ fleche("numero") }}</span></button>
            <span class="tri-sep" aria-hidden="true">·</span>
            <button type="button" class="tri" @click="trier('creation')">Créé le<span class="fleche">{{ fleche("creation") }}</span></button>
          </th>
          <th v-for="c in ['titre', 'demandeur', 'affectation', 'etape', 'echeance']" :key="c" :aria-sort="ariaSort(c)">
            <button type="button" class="tri" @click="trier(c)">{{ COLONNES[c].label }}<span class="fleche">{{ fleche(c) }}</span></button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="t in ticketsTries"
          :key="t.id"
          tabindex="0"
          :class="{ 'needs-action': t.attend_mon_action, 'ligne-moi': t.affectation === 'MOI' }"
          @click="onClic($event, t)"
          @keydown.enter="emit('ouvrir', t.id)"
        >
          <td v-if="selectionnable" class="col-selection">
            <input
              v-if="eligible(t)"
              type="checkbox"
              :checked="selection.has(t.id)"
              :aria-label="`Sélectionner ${t.numero}`"
              @change="basculer(t)"
            />
          </td>
          <td>
            <span class="prio" :class="`prio-${t.priorite}`" :title="PRIORITE_LABEL[t.priorite]">P{{ t.priorite }}</span>
          </td>
          <td class="num two-lines">
            <a class="num-link" :href="`/t/${encodeURIComponent(t.id)}`" tabindex="-1">{{ t.numero }}</a>
            <span class="sub">{{ formatCourt(t.date_creation) }}</span>
          </td>
          <td class="titre-cell">
            <span class="titre">{{ t.titre }}</span>
            <span class="sub">{{ t.type_label }} · {{ t.catalogue.libelle }}</span>
          </td>
          <td class="two-lines">
            <span>{{ t.demandeur?.nom || "—" }}</span>
            <span class="sub" :title="t.etablissement?.nom">{{ t.etablissement?.nom || "" }}</span>
          </td>
          <td class="two-lines">
            <span v-if="t.groupe" class="badge-equipe" :title="t.groupe.nom">{{ t.groupe.nom }}</span>
            <span v-else class="muted">—</span>
            <!-- Affectation de l'étape en cours : à moi / à un autre / personne -->
            <span v-if="t.affectation === 'MOI'" class="affecte affecte-moi">Moi</span>
            <span v-else-if="t.affectation === 'TIERS'" class="affecte affecte-tiers">{{ t.intervenant?.nom }}</span>
            <span v-else-if="t.affectation === 'AUCUN'" class="affecte affecte-aucun">Non affecté</span>
          </td>
          <td>
            <span class="pill" :class="`statut-${t.statut}`">{{ t.etape.label }}</span>
          </td>
          <td class="nowrap">
            <span v-if="sansEcheance(t)" class="muted">—</span>
            <template v-else-if="t.en_retard">
              <span class="late">En retard</span><span class="sub">{{ formatCourt(t.echeance) }}</span>
            </template>
            <span v-else class="muted">{{ formatCourt(t.echeance) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!tickets.length" class="empty-state">
      <strong>Aucun ticket</strong>
      <span>Rien à afficher pour cette vue et ces filtres.</span>
    </div>
  </section>
</template>
