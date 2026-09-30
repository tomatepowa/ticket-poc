<script setup>
// Fraicheur des donnees : les listes viennent d'une copie locale d'EasyVista,
// synchronisee regulierement. On affiche son age, on previent si EV ne repond
// plus, et on permet de forcer une synchro. Emet "nouvelles-donnees" quand la
// copie a change, pour que la liste se recharge.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api.js";
import { formatDepuis, formatHeure, toast } from "../outils.js";

const props = defineProps({ profil: { type: String, required: true } });
const emit = defineEmits(["nouvelles-donnees"]);

// Correspondance EV -> portail incomplete (statut, type d'action ou groupe
// inconnu) : signalee aux superviseurs, qui font le lien avec l'admin EV.
const TYPE_ANOMALIE = { statut: "Statut", type_action: "Type d'action", groupe: "Groupe de profil introuvable" };
const anomalies = computed(() => (props.profil === "SUPERVISEUR" ? etat.value?.anomalies || [] : []));

const etat = ref(null);
const maintenant = ref(Date.now());
const enCours = ref(false);
let minuterieEtat;
let minuterieHorloge;

// Au-dela de 3 intervalles sans synchro reussie, les donnees sont "anciennes".
const perimee = computed(() => {
  const e = etat.value;
  if (!e?.derniere_synchro) return true;
  return maintenant.value - new Date(e.derniere_synchro).getTime() > 3 * e.intervalle_s * 1000;
});
const texte = computed(() => {
  const e = etat.value;
  if (!e) return "";
  if (!e.derniere_synchro) return e.en_cours ? "Première synchronisation avec EasyVista en cours…" : "Données EasyVista pas encore synchronisées";
  return `Données EasyVista ${formatDepuis(e.derniere_synchro, maintenant.value)} (${formatHeure(e.derniere_synchro)})`;
});

async function lireEtat() {
  try {
    const precedent = etat.value?.derniere_synchro;
    etat.value = await api("/synchro");
    if (precedent && etat.value.derniere_synchro !== precedent) emit("nouvelles-donnees");
  } catch {
    // Silencieux : le bandeau garde le dernier etat connu.
  }
}

async function rafraichir() {
  enCours.value = true;
  try {
    const precedent = etat.value?.derniere_synchro;
    etat.value = await api("/synchro", { method: "POST" });
    if (etat.value.erreur) toast(`EasyVista ne répond pas : ${etat.value.erreur}`);
    else if (etat.value.derniere_synchro !== precedent) emit("nouvelles-donnees");
  } catch (err) {
    toast(err.message);
  } finally {
    enCours.value = false;
  }
}

onMounted(() => {
  lireEtat();
  minuterieEtat = setInterval(lireEtat, 15000);
  minuterieHorloge = setInterval(() => (maintenant.value = Date.now()), 5000);
});
onBeforeUnmount(() => {
  clearInterval(minuterieEtat);
  clearInterval(minuterieHorloge);
});
</script>

<template>
  <div v-if="etat" class="synchro" :class="{ 'is-warn': etat.erreur || perimee }" role="status">
    <span class="synchro-dot" aria-hidden="true"></span>
    <span class="synchro-texte">
      {{ texte }}
      <template v-if="etat.erreur">
        — EasyVista ne répond pas depuis {{ formatHeure(etat.erreur_depuis) }}, affichage de la dernière copie
      </template>
    </span>
    <button class="btn btn-small" type="button" :disabled="enCours || etat.en_cours" @click="rafraichir">
      {{ enCours || etat.en_cours ? "Synchronisation…" : "Rafraîchir" }}
    </button>
  </div>
  <div v-if="anomalies.length" class="anomalies" role="alert">
    <strong>Correspondance EasyVista à compléter</strong> (sources/portail/correspondance.js) :
    <ul>
      <li v-for="a in anomalies" :key="a.type + a.valeur">
        {{ TYPE_ANOMALIE[a.type] || a.type }} « {{ a.valeur }} »
        <template v-if="a.exemple">— {{ a.nb_tickets }} ticket{{ a.nb_tickets > 1 ? "s" : "" }}, ex. {{ a.exemple }}</template>
      </li>
    </ul>
  </div>
</template>
