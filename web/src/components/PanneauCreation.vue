<script setup>
// Saisie d'un ticket par le support, pour le compte d'un demandeur (appel,
// passage, mail...). On choisit dans le catalogue, jamais le groupe : c'est
// EasyVista qui oriente le ticket.
// Hotline : la solution est souvent trouvée pendant l'appel. Si elle est notée,
// le ticket est créé, pris, résolu et clôturé en un seul envoi (Ctrl+Entrée).
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { api } from "../api.js";
import { MATRICE_PRIORITE, PRIORITE_LABEL, debounce } from "../outils.js";
import { champsManquants, reponsesVisibles } from "../formulaires.js";
import FormulaireEV from "./FormulaireEV.vue";

const props = defineProps({
  referentiels: { type: Object, required: true },
});
const emit = defineEmits(["fermer", "cree", "brouillon"]);

const ORIGINES = ["Appel téléphonique", "Mail", "Passage au support", "Teams / messagerie", "Autre"];

const recherche = ref("");
const resultats = ref([]);
const demandeur = ref(null);
const origine = ref(ORIGINES[0]);
const type = ref("INCIDENT");
const catalogueId = ref("");
const titre = ref("");
const description = ref("");
const solution = ref("");
const cloturer = ref(true);
const impact = ref(1);
const urgence = ref(1);
const etablissementId = ref("");
const erreur = ref("");
const enCours = ref(false);
const champDemandeur = ref(null);
const champCatalogue = ref(null);
const suggestion = ref(0); // suggestion de demandeur surlignée (clavier)

const catalogueDuType = computed(() => props.referentiels.catalogue.filter((c) => c.type === type.value));
const catalogueChoisi = computed(() => props.referentiels.catalogue.find((c) => c.id === catalogueId.value));
const priorite = computed(() => MATRICE_PRIORITE[impact.value][urgence.value]);
const resoudre = computed(() => Boolean(solution.value.trim()));
const libelleBouton = computed(() =>
  !resoudre.value ? "Créer le ticket" : cloturer.value ? "Créer et clôturer (résolu en direct)" : "Créer et résoudre"
);

// Saisie en cours : le panneau ne se ferme pas sur un clic à côté (notes d'appel perdues).
watch(
  () => Boolean(demandeur.value || titre.value.trim() || description.value.trim() || solution.value.trim()),
  (v) => emit("brouillon", v)
);

watch(type, () => (catalogueId.value = ""));

// Formulaire EV de l'entrée de catalogue choisie (s'il y en a un).
const questionnaire = ref(null);
const reponses = ref({});
watch(catalogueId, async () => {
  questionnaire.value = null;
  reponses.value = {};
  const id = catalogueChoisi.value?.questionnaire_id;
  if (!id) return;
  try {
    const q = await api(`/questionnaires/${id}`);
    // Le choix a pu changer pendant le chargement.
    if (catalogueChoisi.value?.questionnaire_id === id) questionnaire.value = q;
  } catch (err) {
    erreur.value = `Formulaire indisponible : ${err.message}`;
  }
});
onMounted(() => champDemandeur.value.focus());

const chercher = debounce(async (texte) => {
  if (texte.trim().length < 2) {
    resultats.value = [];
    return;
  }
  try {
    resultats.value = await api(`/employes?q=${encodeURIComponent(texte)}`);
    suggestion.value = 0;
  } catch (err) {
    erreur.value = err.message;
  }
}, 250);

// Clavier dans la recherche du demandeur : flèches pour choisir, Entrée pour valider.
function clavierDemandeur(e) {
  const n = resultats.value.length;
  if (!n) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    suggestion.value = (suggestion.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
  } else if (e.key === "Enter") {
    e.preventDefault();
    choisirDemandeur(resultats.value[suggestion.value]);
  }
}

function choisirDemandeur(e) {
  demandeur.value = e;
  resultats.value = [];
  recherche.value = "";
  // Par défaut, le ticket est rattaché à l'établissement du demandeur.
  if (e.site) etablissementId.value = e.site.id;
  // Suite de la saisie au clavier : le catalogue.
  nextTick(() => champCatalogue.value?.focus());
}

function changerDemandeur() {
  demandeur.value = null;
  nextTick(() => champDemandeur.value?.focus());
}

// Ctrl+Entrée (ou Cmd+Entrée) n'importe où dans le formulaire : envoyer.
function raccourci(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !enCours.value) {
    e.preventDefault();
    creer();
  }
}

async function creer() {
  erreur.value = "";
  if (!demandeur.value) {
    erreur.value = "Choisissez le demandeur.";
    champDemandeur.value?.focus();
    return;
  }
  const manquants = champsManquants(questionnaire.value, reponses.value);
  if (manquants.length) {
    erreur.value = `Formulaire incomplet : ${manquants.join(", ")}.`;
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
    ...(questionnaire.value ? { reponses: reponsesVisibles(questionnaire.value, reponses.value) } : {}),
    ...(resoudre.value ? { solution: solution.value, cloturer: cloturer.value } : {}),
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

    <form class="panel-body creation" @submit.prevent="creer" @keydown="raccourci">
      <div class="field">
        <label for="c-demandeur">Pour qui ?</label>
        <div v-if="demandeur" class="demandeur-choisi">
          <span>
            <strong>{{ demandeur.nom }}</strong>
            <span class="dd-sub">{{ demandeur.fonction }}<template v-if="demandeur.site"> · {{ demandeur.site.nom }}</template></span>
          </span>
          <button class="btn btn-small" type="button" @click="changerDemandeur">Changer</button>
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
            @keydown="clavierDemandeur"
          />
          <ul v-if="resultats.length" class="suggestions" role="listbox" aria-label="Demandeurs trouvés">
            <li v-for="(e, i) in resultats" :key="e.id">
              <button type="button" :class="{ active: i === suggestion }" @click="choisirDemandeur(e)">
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
        <select id="c-catalogue" ref="champCatalogue" v-model="catalogueId" required>
          <option value="">Sélectionner…</option>
          <option v-for="c in catalogueDuType" :key="c.id" :value="c.id">{{ c.libelle }}</option>
        </select>
        <p v-if="catalogueChoisi" class="route-hint">
          → {{ catalogueChoisi.chemin ? catalogueChoisi.chemin + " : " : "" }}EasyVista orientera le ticket vers le
          groupe prévu par son workflow.
        </p>
      </div>

      <FormulaireEV v-if="questionnaire" v-model="reponses" :questionnaire="questionnaire" prefixe="c-q" />

      <div class="field">
        <label for="c-titre">Titre <span class="optional">(facultatif)</span></label>
        <input
          id="c-titre"
          v-model="titre"
          type="text"
          :placeholder="catalogueChoisi ? `Par défaut : ${catalogueChoisi.libelle}` : 'Ex : Plus de réception des mails'"
        />
      </div>

      <div class="field">
        <label for="c-description">Problème signalé</label>
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

      <div class="field solution" :class="{ remplie: resoudre }">
        <label for="c-solution">Solution apportée pendant l'appel <span class="optional">(si réglé)</span></label>
        <textarea
          id="c-solution"
          v-model="solution"
          rows="3"
          placeholder="Ce qui a été fait. Rempli : le ticket est résolu dès sa création."
        ></textarea>
        <label v-if="resoudre" class="case">
          <input v-model="cloturer" type="checkbox" />
          L'appelant a confirmé que c'est réglé : clôturer directement
        </label>
      </div>

      <div class="creation-envoi">
        <p class="form-error" role="alert">{{ erreur }}</p>
        <button type="submit" class="btn btn-primary btn-block" :class="{ 'btn-resolu': resoudre }" :disabled="enCours">
          {{ enCours ? "Enregistrement dans EasyVista…" : libelleBouton }}
        </button>
        <p class="field-hint raccourci">Ctrl + Entrée pour envoyer</p>
      </div>
    </form>
  </aside>
</template>
