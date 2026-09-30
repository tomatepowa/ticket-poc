<script setup>
// Saisie d'un ticket par le support, pour le compte d'un demandeur (appel,
// passage, mail...). On choisit dans le catalogue, jamais le groupe : c'est
// EasyVista qui oriente le ticket.
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";
import { MATRICE_PRIORITE, PRIORITE_LABEL, debounce } from "../outils.js";

const props = defineProps({
  referentiels: { type: Object, required: true },
});
const emit = defineEmits(["fermer", "cree"]);

const ORIGINES = ["Appel téléphonique", "Mail", "Passage au support", "Teams / messagerie", "Autre"];

const recherche = ref("");
const resultats = ref([]);
const demandeur = ref(null);
const origine = ref(ORIGINES[0]);
const type = ref("INCIDENT");
const catalogueId = ref("");
const titre = ref("");
const description = ref("");
const impact = ref(1);
const urgence = ref(1);
const etablissementId = ref("");
const erreur = ref("");
const enCours = ref(false);
const champDemandeur = ref(null);

const catalogueDuType = computed(() => props.referentiels.catalogue.filter((c) => c.type === type.value));
const catalogueChoisi = computed(() => props.referentiels.catalogue.find((c) => c.id === catalogueId.value));
const priorite = computed(() => MATRICE_PRIORITE[impact.value][urgence.value]);

watch(type, () => (catalogueId.value = ""));
onMounted(() => champDemandeur.value.focus());

const chercher = debounce(async (texte) => {
  if (texte.trim().length < 2) {
    resultats.value = [];
    return;
  }
  try {
    resultats.value = await api(`/employes?q=${encodeURIComponent(texte)}`);
  } catch (err) {
    erreur.value = err.message;
  }
}, 250);

function choisirDemandeur(e) {
  demandeur.value = e;
  resultats.value = [];
  recherche.value = "";
  // Par défaut, le ticket est rattaché à l'établissement du demandeur.
  if (e.site) etablissementId.value = e.site.id;
}

async function creer() {
  erreur.value = "";
  if (!demandeur.value) {
    erreur.value = "Choisissez le demandeur.";
    champDemandeur.value?.focus();
    return;
  }
  const payload = {
    demandeur_id: demandeur.value.id,
    origine: origine.value,
    catalogue_id: Number(catalogueId.value),
    titre: titre.value,
    description: description.value,
    etablissement_id: Number(etablissementId.value),
    ...(type.value === "INCIDENT" ? { impact: impact.value, urgence: urgence.value } : {}),
  };
  enCours.value = true;
  try {
    const cree = await api("/tickets", { method: "POST", body: JSON.stringify(payload) });
    emit("cree", cree);
  } catch (err) {
    erreur.value = `Impossible de créer le ticket : ${err.message}`;
    enCours.value = false;
  }
}
</script>

<template>
  <aside class="panel" aria-labelledby="create-title">
    <div class="panel-head">
      <h2 id="create-title">Nouveau ticket</h2>
      <button class="panel-close" aria-label="Fermer" @click="emit('fermer')">✕</button>
    </div>

    <form class="panel-body" @submit.prevent="creer">
      <div class="field">
        <label for="c-demandeur">Pour qui ?</label>
        <div v-if="demandeur" class="demandeur-choisi">
          <span>
            <strong>{{ demandeur.nom }}</strong>
            <span class="dd-sub">{{ demandeur.fonction }}<template v-if="demandeur.site"> · {{ demandeur.site.nom }}</template></span>
          </span>
          <button class="btn btn-small" type="button" @click="demandeur = null">Changer</button>
        </div>
        <template v-else>
          <input
            id="c-demandeur"
            ref="champDemandeur"
            v-model="recherche"
            type="search"
            autocomplete="off"
            placeholder="Nom du demandeur (2 lettres minimum)"
            @input="chercher(recherche)"
          />
          <ul v-if="resultats.length" class="suggestions" role="listbox" aria-label="Demandeurs trouvés">
            <li v-for="e in resultats" :key="e.id">
              <button type="button" @click="choisirDemandeur(e)">
                <strong>{{ e.nom }}</strong>
                <span class="dd-sub">{{ e.fonction }}<template v-if="e.site"> · {{ e.site.nom }}</template></span>
              </button>
            </li>
          </ul>
          <p v-else-if="recherche.trim().length >= 2" class="field-hint">Aucun employé trouvé dans EasyVista.</p>
        </template>
      </div>

      <div class="field">
        <label for="c-origine">Origine de la demande</label>
        <select id="c-origine" v-model="origine">
          <option v-for="o in ORIGINES" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>

      <fieldset class="field type-choice">
        <legend>Type</legend>
        <label class="type-card">
          <input v-model="type" type="radio" name="c-type" value="INCIDENT" />
          <span class="type-card-title">Incident</span>
          <span class="type-card-sub">Panne, erreur, lenteur…</span>
        </label>
        <label class="type-card">
          <input v-model="type" type="radio" name="c-type" value="DEMANDE" />
          <span class="type-card-title">Demande</span>
          <span class="type-card-sub">Matériel, accès, installation…</span>
        </label>
      </fieldset>

      <div class="field">
        <label for="c-catalogue">Catalogue</label>
        <select id="c-catalogue" v-model="catalogueId" required>
          <option value="">Sélectionner…</option>
          <option v-for="c in catalogueDuType" :key="c.id" :value="c.id">{{ c.libelle }}</option>
        </select>
        <p v-if="catalogueChoisi" class="route-hint">
          → {{ catalogueChoisi.chemin ? catalogueChoisi.chemin + " : " : "" }}EasyVista orientera le ticket vers le
          groupe prévu par son workflow.
        </p>
      </div>

      <div class="field">
        <label for="c-titre">Titre</label>
        <input id="c-titre" v-model="titre" type="text" required placeholder="Ex : Plus de réception des mails" />
      </div>

      <div class="field">
        <label for="c-description">Description</label>
        <textarea id="c-description" v-model="description" rows="4" placeholder="Symptômes, depuis quand, contexte…"></textarea>
      </div>

      <template v-if="type === 'INCIDENT'">
        <div class="field-row">
          <div class="field">
            <label for="c-impact">Impact</label>
            <select id="c-impact" v-model="impact">
              <option :value="1">Une personne</option>
              <option :value="2">Plusieurs personnes / un service</option>
              <option :value="3">Tout l'établissement</option>
            </select>
          </div>
          <div class="field">
            <label for="c-urgence">Urgence</label>
            <select id="c-urgence" v-model="urgence">
              <option :value="1">Gêne, travail possible</option>
              <option :value="2">Bloquant</option>
            </select>
          </div>
        </div>
        <p class="field-hint">
          Priorité calculée : <span class="prio" :class="`prio-${priorite}`">P{{ priorite }} · {{ PRIORITE_LABEL[priorite] }}</span>
        </p>
      </template>

      <div class="field">
        <label for="c-etablissement">Établissement</label>
        <select id="c-etablissement" v-model="etablissementId" required>
          <option value="">Sélectionner…</option>
          <option v-for="e in referentiels.etablissements" :key="e.id" :value="e.id">{{ e.nom }}</option>
        </select>
      </div>

      <p class="form-error" role="alert">{{ erreur }}</p>
      <button type="submit" class="btn btn-primary btn-block" :disabled="enCours">Créer le ticket</button>
    </form>
  </aside>
</template>
