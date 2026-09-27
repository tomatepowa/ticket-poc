<script setup>
// Creation de ticket : l'utilisateur choisit dans le catalogue, jamais le groupe.
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";
import { MATRICE_PRIORITE, PRIORITE_LABEL } from "../outils.js";

const props = defineProps({
  moi: { type: Object, required: true },
  referentiels: { type: Object, required: true },
});
const emit = defineEmits(["fermer", "cree"]);

const type = ref("INCIDENT");
const catalogueId = ref("");
const titre = ref("");
const description = ref("");
const impact = ref(1);
const urgence = ref(1);
const etablissementId = ref(props.moi.site?.id ?? "");
const erreur = ref("");
const enCours = ref(false);
const champCatalogue = ref(null);

const catalogueDuType = computed(() => props.referentiels.catalogue.filter((c) => c.type === type.value));
const catalogueChoisi = computed(() => props.referentiels.catalogue.find((c) => c.id === catalogueId.value));
const priorite = computed(() => MATRICE_PRIORITE[impact.value][urgence.value]);

watch(type, () => (catalogueId.value = ""));
onMounted(() => champCatalogue.value.focus());

async function creer() {
  erreur.value = "";
  const payload = {
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
      <fieldset class="field type-choice">
        <legend>De quoi s'agit-il ?</legend>
        <label class="type-card">
          <input v-model="type" type="radio" name="c-type" value="INCIDENT" />
          <span class="type-card-title">Quelque chose ne fonctionne pas</span>
          <span class="type-card-sub">Panne, erreur, lenteur…</span>
        </label>
        <label class="type-card">
          <input v-model="type" type="radio" name="c-type" value="DEMANDE" />
          <span class="type-card-title">J'ai besoin de quelque chose</span>
          <span class="type-card-sub">Matériel, accès, installation…</span>
        </label>
      </fieldset>

      <div class="field">
        <label for="c-catalogue">Qu'est-ce qui est concerné ?</label>
        <select id="c-catalogue" ref="champCatalogue" v-model="catalogueId" required>
          <option value="">Sélectionner…</option>
          <option v-for="c in catalogueDuType" :key="c.id" :value="c.id">{{ c.libelle }}</option>
        </select>
        <p v-if="catalogueChoisi" class="route-hint">
          → {{ catalogueChoisi.chemin ? catalogueChoisi.chemin + " : " : "" }}votre ticket sera orienté
          automatiquement vers la bonne équipe.
        </p>
      </div>

      <div class="field">
        <label for="c-titre">Titre</label>
        <input id="c-titre" v-model="titre" type="text" required placeholder="Ex : Plus de réception des mails" />
      </div>

      <div class="field">
        <label for="c-description">Description</label>
        <textarea id="c-description" v-model="description" rows="4" placeholder="Détails, depuis quand, contexte…"></textarea>
      </div>

      <template v-if="type === 'INCIDENT'">
        <div class="field-row">
          <div class="field">
            <label for="c-impact">Qui est touché ?</label>
            <select id="c-impact" v-model="impact">
              <option :value="1">Moi seul</option>
              <option :value="2">Plusieurs personnes / un service</option>
              <option :value="3">Tout l'établissement</option>
            </select>
          </div>
          <div class="field">
            <label for="c-urgence">Pouvez-vous travailler ?</label>
            <select id="c-urgence" v-model="urgence">
              <option :value="1">Oui, avec une gêne</option>
              <option :value="2">Non, je suis bloqué</option>
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

      <p class="field-hint">Demandeur : {{ moi.nom_complet }} (vous)</p>
      <p class="form-error" role="alert">{{ erreur }}</p>
      <button type="submit" class="btn btn-primary btn-block" :disabled="enCours">Créer le ticket</button>
    </form>
  </aside>
</template>
