<script setup>
// Liste des tickets. Un clic ouvre le detail ; Ctrl/Cmd/Maj + clic sur le n°
// laisse le navigateur ouvrir le lien direct dans un nouvel onglet.
// En-tetes cliquables : tri croissant, puis decroissant au deuxieme clic.
// Groupe, affectation et etablissement sont cliquables : ils appliquent le filtre
// correspondant (un second clic le retire) ; les pastilles d'affectation chargent
// la vue : a moi, a personne, a un autre.
import { computed, ref } from "vue";
import { PRIORITE_LABEL, formatCourt } from "../outils.js";

const props = defineProps({
  tickets: { type: Array, required: true },
  filtres: { type: Object, required: true },
  vues: { type: Array, required: true },
  profil: { type: String, required: true },
});
const emit = defineEmits(["ouvrir", "filtrer"]);

// ---------- Filtres depuis la liste ----------

const aVue = (code) => props.vues.some((v) => v.code === code);
const libelleVue = (code) => props.vues.find((v) => v.code === code)?.label || code;
const groupesCoches = computed(() => String(props.filtres.groupe || "").split(",").filter(Boolean).map(Number));
const etablissementsCoches = computed(() => String(props.filtres.etablissement || "").split(",").filter(Boolean).map(Number));

// Chaque filtre : possible pour ce profil ?, actif ?, changement qui l'active / le retire.
const FILTRES = {
  groupe: (t) => {
    const id = t.groupe?.id;
    const coches = groupesCoches.value;
    return {
      possible: props.profil !== "VALIDEUR" && Boolean(id),
      actif: coches.includes(id),
      activer: { groupe: [...coches, id].join(",") },
      retirer: { groupe: coches.filter((x) => x !== id).join(",") },
      libelle: `groupe « ${t.groupe?.nom} »`,
    };
  },
  // Affectation (légende et pastilles) : la vue correspondante, si ce profil l'a.
  MOI: () => filtreVue("moi"),
  AUCUN: () => filtreVue("non_affectes"),
  TIERS: () => filtreVue("autres"),
  // Un collègue : la recherche porte aussi sur le nom de l'intervenant.
  intervenant: (t) => ({
    possible: Boolean(t.intervenant?.nom),
    actif: props.filtres.q === t.intervenant?.nom,
    activer: { q: t.intervenant?.nom },
    retirer: { q: "" },
    libelle: `tickets de ${t.intervenant?.nom}`,
  }),
  etablissement: (t) => {
    const id = t.etablissement?.id;
    const coches = etablissementsCoches.value;
    return {
      possible: Boolean(id),
      actif: coches.includes(id),
      activer: { etablissement: [...coches, id].join(",") },
      retirer: { etablissement: coches.filter((x) => x !== id).join(",") },
      libelle: `établissement « ${t.etablissement?.nom} »`,
    };
  },
};

function filtreVue(vue) {
  return {
    possible: aVue(vue),
    actif: props.filtres.vue === vue,
    activer: { vue },
    retirer: { vue: props.vues[0].code },
    libelle: `vue « ${libelleVue(vue)} »`,
  };
}

const filtre = (type, t) => FILTRES[type](t);
const titreFiltre = (type, t) => {
  const f = filtre(type, t);
  return f.actif ? `Retirer le filtre : ${f.libelle}` : `Filtrer : ${f.libelle}`;
};

function appliquer(type, t) {
  const f = filtre(type, t);
  emit("filtrer", f.actif ? f.retirer : f.activer, f.actif ? `Filtre retiré : ${f.libelle}` : `Filtre : ${f.libelle}`);
}

// Affectation de l'etape en cours : [type de filtre, classe, texte affiche]
// (le nom d'un collegue filtre sur ce collegue)
const AFFECTATION = {
  MOI: ["MOI", "affecte-moi", () => "Moi"],
  TIERS: ["intervenant", "affecte-tiers", (t) => t.intervenant?.nom],
  AUCUN: ["AUCUN", "affecte-aucun", () => "Non affecté"],
};

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

function onClic(e, t) {
  if (e.target.closest(".filtre-cellule")) return;
  if (e.target.closest("a") && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;
  e.preventDefault();
  emit("ouvrir", t.id);
}
</script>

<template>
  <section class="table-wrap">
    <table class="tickets">
      <thead>
        <tr>
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
            <button
              v-if="filtre('etablissement', t).possible"
              type="button"
              class="sub filtre-cellule"
              :class="{ 'is-actif': filtre('etablissement', t).actif }"
              :title="titreFiltre('etablissement', t)"
              @click="appliquer('etablissement', t)"
            >{{ t.etablissement.nom }}</button>
          </td>
          <td class="two-lines">
            <button
              v-if="filtre('groupe', t).possible"
              type="button"
              class="badge-equipe filtre-cellule"
              :class="{ 'is-actif': filtre('groupe', t).actif }"
              :title="titreFiltre('groupe', t)"
              @click="appliquer('groupe', t)"
            >{{ t.groupe.nom }}</button>
            <span v-else-if="t.groupe" class="badge-equipe" :title="t.groupe.nom">{{ t.groupe.nom }}</span>
            <span v-else class="muted">—</span>
            <!-- Affectation de l'étape en cours : à moi / à un autre / personne -->
            <template v-if="AFFECTATION[t.affectation]">
              <button
                v-if="filtre(AFFECTATION[t.affectation][0], t).possible"
                type="button"
                class="affecte filtre-cellule"
                :class="[AFFECTATION[t.affectation][1], { 'is-actif': filtre(AFFECTATION[t.affectation][0], t).actif }]"
                :title="titreFiltre(AFFECTATION[t.affectation][0], t)"
                @click="appliquer(AFFECTATION[t.affectation][0], t)"
              >{{ AFFECTATION[t.affectation][2](t) }}</button>
              <span v-else class="affecte" :class="AFFECTATION[t.affectation][1]">{{ AFFECTATION[t.affectation][2](t) }}</span>
            </template>
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
