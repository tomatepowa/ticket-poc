<script setup>
// Formulaire generique : affiche n'importe quel questionnaire EasyVista d'apres
// sa definition (types de questions, obligatoires, conditions). Aucun formulaire
// n'est code en dur dans le portail : un formulaire cree ou modifie dans EV
// s'affiche tel quel.
import { estVisible } from "../formulaires.js";

const props = defineProps({
  questionnaire: { type: Object, required: true },
  modelValue: { type: Object, required: true }, // { idQuestion: valeur }
  prefixe: { type: String, default: "q" }, // pour des id uniques si plusieurs formulaires
});
const emit = defineEmits(["update:modelValue"]);

function changer(id, valeur) {
  emit("update:modelValue", { ...props.modelValue, [id]: valeur });
}

function basculer(id, choix, coche) {
  const actuels = Array.isArray(props.modelValue[id]) ? props.modelValue[id] : [];
  changer(id, coche ? [...actuels, choix] : actuels.filter((x) => x !== choix));
}

const idChamp = (q) => `${props.prefixe}-${q.id}`;
</script>

<template>
  <fieldset class="formulaire-ev">
    <legend>{{ questionnaire.titre }}</legend>

    <template v-for="q in questionnaire.questions" :key="q.id">
      <div v-if="estVisible(questionnaire, q, modelValue)" class="field">
        <!-- Libellé : sur les groupes de cases / boutons, c'est une légende de groupe -->
        <span
          v-if="q.type === 'choix_multiples' || q.type === 'oui_non'"
          :id="`${idChamp(q)}-l`"
          class="formulaire-libelle"
        >
          {{ q.libelle }}<span v-if="q.obligatoire" class="obligatoire" aria-hidden="true"> *</span>
        </span>
        <label v-else :for="idChamp(q)">
          {{ q.libelle }}<span v-if="q.obligatoire" class="obligatoire" aria-hidden="true"> *</span>
        </label>

        <input
          v-if="q.type === 'texte'"
          :id="idChamp(q)"
          type="text"
          :required="q.obligatoire"
          :value="modelValue[q.id] ?? ''"
          @input="changer(q.id, $event.target.value)"
        />
        <textarea
          v-else-if="q.type === 'texte_long'"
          :id="idChamp(q)"
          rows="3"
          :required="q.obligatoire"
          :value="modelValue[q.id] ?? ''"
          @input="changer(q.id, $event.target.value)"
        ></textarea>
        <input
          v-else-if="q.type === 'nombre'"
          :id="idChamp(q)"
          type="number"
          step="any"
          :required="q.obligatoire"
          :value="modelValue[q.id] ?? ''"
          @input="changer(q.id, $event.target.value === '' ? '' : Number($event.target.value))"
        />
        <input
          v-else-if="q.type === 'date'"
          :id="idChamp(q)"
          type="date"
          :required="q.obligatoire"
          :value="modelValue[q.id] ?? ''"
          @input="changer(q.id, $event.target.value)"
        />
        <select
          v-else-if="q.type === 'choix'"
          :id="idChamp(q)"
          :required="q.obligatoire"
          :value="modelValue[q.id] ?? ''"
          @change="changer(q.id, $event.target.value)"
        >
          <option value="">Sélectionner…</option>
          <option v-for="c in q.choix" :key="c" :value="c">{{ c }}</option>
        </select>
        <div v-else-if="q.type === 'choix_multiples'" class="cases" role="group" :aria-labelledby="`${idChamp(q)}-l`">
          <label v-for="c in q.choix" :key="c" class="case">
            <input
              type="checkbox"
              :checked="(modelValue[q.id] || []).includes(c)"
              @change="basculer(q.id, c, $event.target.checked)"
            />
            {{ c }}
          </label>
        </div>
        <div v-else-if="q.type === 'oui_non'" class="cases" role="radiogroup" :aria-labelledby="`${idChamp(q)}-l`">
          <label class="case">
            <input type="radio" :name="idChamp(q)" :checked="modelValue[q.id] === true" @change="changer(q.id, true)" /> Oui
          </label>
          <label class="case">
            <input type="radio" :name="idChamp(q)" :checked="modelValue[q.id] === false" @change="changer(q.id, false)" /> Non
          </label>
        </div>

        <p v-if="q.aide" class="field-hint">{{ q.aide }}</p>
      </div>
    </template>
  </fieldset>
</template>
