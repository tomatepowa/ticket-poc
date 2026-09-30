<script setup>
// Detail d'un ticket : progression, actions proposees par le serveur, historique.
import { computed, ref } from "vue";
import { api } from "../api.js";
import { PRIORITE_LABEL, formatDateTime, formatHeure, lienTicket, toast } from "../outils.js";
import { champsManquants, reponsesVisibles } from "../formulaires.js";
import FormulaireEV from "./FormulaireEV.vue";

const props = defineProps({
  ticket: { type: Object, required: true },
  groupes: { type: Array, required: true },
});
const emit = defineEmits(["fermer", "fait", "actualiser"]);

// Le détail est lu en direct dans EasyVista ; si EV ne répond pas, on affiche
// la copie locale, sans proposer d'action.
const depuisCache = computed(() => props.ticket.fraicheur?.origine === "cache");

const commentaire = ref("");
const groupeId = ref("");
const erreur = ref("");
const enCours = ref(false);
const champCommentaire = ref(null);
const champGroupe = ref(null);

const t = computed(() => props.ticket);
const transfert = computed(() => t.value.actions.some((a) => a.parametre === "groupe"));
const autresGroupes = computed(() => props.groupes.filter((g) => g.id !== t.value.groupe?.id));
// La première action non secondaire est mise en avant.
const iPrincipale = computed(() => t.value.actions.findIndex((a) => !a.secondaire));

// Progression : parcours type du workflow, étape courante (-1 = sortie du parcours).
const sortie = computed(() => t.value.progression.position === -1);
const horsParcours = computed(() => !t.value.progression.parcours.some((s) => s.code === t.value.etape.code));
function classeEtape(i) {
  const position = t.value.progression.position;
  if (sortie.value) return "";
  return i < position ? "is-done" : i === position ? "is-current" : "";
}

// Étape qui demande un formulaire EV : on l'affiche d'abord, l'action part à la validation.
const actionFormulaire = ref(null);
const reponses = ref({});

function demander(action) {
  erreur.value = "";
  if (action.questionnaire) {
    actionFormulaire.value = action;
    reponses.value = {};
  } else {
    executer(action);
  }
}

function annulerFormulaire() {
  actionFormulaire.value = null;
  erreur.value = "";
}

async function executer(action) {
  erreur.value = "";
  if (action.questionnaire) {
    const manquants = champsManquants(action.questionnaire, reponses.value);
    if (manquants.length) {
      erreur.value = `Formulaire incomplet : ${manquants.join(", ")}.`;
      return;
    }
  }
  const texte = commentaire.value.trim();
  if (action.commentaire && !texte) {
    erreur.value = "Un commentaire est obligatoire pour cette action.";
    champCommentaire.value.focus();
    return;
  }
  const groupe_id = action.parametre === "groupe" ? Number(groupeId.value) : undefined;
  if (action.parametre === "groupe" && !groupe_id) {
    erreur.value = "Choisissez le groupe vers lequel transférer.";
    champGroupe.value.focus();
    return;
  }
  enCours.value = true;
  try {
    const resultat = await api(`/tickets/${encodeURIComponent(t.value.id)}/actions`, {
      method: "POST",
      body: JSON.stringify({
        action: action.code,
        commentaire: texte,
        groupe_id,
        ...(action.questionnaire ? { reponses: reponsesVisibles(action.questionnaire, reponses.value) } : {}),
      }),
    });
    emit("fait", { action, resultat });
  } catch (err) {
    erreur.value = err.message;
    enCours.value = false;
  }
}

async function copierLien() {
  const lien = lienTicket(t.value.id);
  try {
    await navigator.clipboard.writeText(lien);
  } catch {
    // Hors HTTPS, l'API presse-papiers peut être indisponible : repli classique.
    const champ = document.createElement("textarea");
    champ.value = lien;
    document.body.appendChild(champ);
    champ.select();
    document.execCommand("copy");
    champ.remove();
  }
  toast("Lien copié : collez-le dans un mail ou un message.");
}
</script>

<template>
  <aside class="panel panel-wide" aria-labelledby="detail-title">
    <div class="panel-head">
      <h2 id="detail-title" class="mono">{{ t.numero }}</h2>
      <div class="panel-head-actions">
        <button class="btn btn-small" type="button" @click="emit('actualiser')">Actualiser</button>
        <button class="btn btn-small" type="button" @click="copierLien">Copier le lien</button>
        <button class="panel-close" aria-label="Fermer" @click="emit('fermer')">✕</button>
      </div>
    </div>

    <div class="panel-body">
      <p v-if="t.fraicheur" class="fraicheur" :class="{ 'is-warn': depuisCache }">
        <template v-if="depuisCache">
          EasyVista ne répond pas : copie locale du {{ formatDateTime(t.fraicheur.lu_le) }}. Actions indisponibles.
        </template>
        <template v-else>Lu en direct dans EasyVista à {{ formatHeure(t.fraicheur.lu_le) }}</template>
      </p>

      <div class="detail-head">
        <div class="detail-tags">
          <span class="pill" :class="`statut-${t.statut}`">{{ t.etape.label }}</span>
          <span class="prio" :class="`prio-${t.priorite}`">P{{ t.priorite }} · {{ PRIORITE_LABEL[t.priorite] }}</span>
          <span class="badge-equipe">{{ t.type_label }}</span>
          <span v-if="t.en_retard" class="late">En retard</span>
        </div>
        <h3>{{ t.titre }}</h3>
      </div>

      <div class="field">
        <span class="section-label">Progression</span>
        <ol class="stepper" :class="{ 'is-exit': sortie }" aria-label="Progression du ticket">
          <li
            v-for="(s, i) in t.progression.parcours"
            :key="s.code"
            class="step"
            :class="classeEtape(i)"
            :aria-current="i === t.progression.position ? 'step' : undefined"
          >
            <span class="step-bar"></span>
            <span class="step-label">{{ s.label }}</span>
          </li>
        </ol>
        <p v-if="horsParcours" class="stepper-note">
          Étape actuelle : <span class="pill" :class="`statut-${t.statut}`">{{ t.etape.label }}</span>
        </p>
      </div>

      <p v-if="!t.actions.length && !depuisCache" class="done-note">Aucune action possible de votre part sur ce ticket.</p>
      <div v-else class="actions-box">
        <label class="section-label" for="action-comment">Votre action</label>
        <textarea
          id="action-comment"
          ref="champCommentaire"
          v-model="commentaire"
          rows="2"
          placeholder="Commentaire (obligatoire pour les actions marquées *)"
        ></textarea>
        <select v-if="transfert" ref="champGroupe" v-model="groupeId" aria-label="Groupe cible du transfert">
          <option value="">Transférer vers… (choisir un groupe)</option>
          <option v-for="g in autresGroupes" :key="g.id" :value="g.id">{{ g.nom }}</option>
        </select>
        <!-- Étape qui demande un formulaire EV : on le remplit, puis on valide l'action -->
        <template v-if="actionFormulaire">
          <FormulaireEV v-model="reponses" :questionnaire="actionFormulaire.questionnaire" prefixe="a-q" />
          <div class="status-actions">
            <button class="btn btn-primary" :disabled="enCours" @click="executer(actionFormulaire)">
              Valider : {{ actionFormulaire.label }}
            </button>
            <button class="btn" type="button" :disabled="enCours" @click="annulerFormulaire">Annuler</button>
          </div>
        </template>
        <div v-else class="status-actions">
          <button
            v-for="(action, i) in t.actions"
            :key="action.code"
            :class="i === iPrincipale ? 'btn btn-primary' : 'btn'"
            :disabled="enCours"
            @click="demander(action)"
          >
            {{ action.commentaire ? `${action.label} *` : action.label }}{{ action.questionnaire ? " (formulaire)" : "" }}
          </button>
        </div>
        <p class="form-error" role="alert">{{ erreur }}</p>
      </div>

      <p class="detail-desc" :class="{ 'is-empty': !t.description }">{{ t.description || "Pas de description." }}</p>

      <div v-if="t.formulaire" class="field">
        <span class="section-label">{{ t.formulaire.titre }}</span>
        <dl class="detail-grid reponses">
          <div v-for="(r, i) in t.formulaire.reponses" :key="i">
            <dt>{{ r.question }}</dt>
            <dd>{{ r.valeur }}</dd>
          </div>
        </dl>
      </div>

      <dl class="detail-grid">
        <div>
          <dt>Concerne</dt>
          <dd>{{ t.catalogue.libelle }}<span class="dd-sub">{{ t.catalogue.chemin }}</span></dd>
        </div>
        <div>
          <dt>Demandeur</dt>
          <dd>{{ t.demandeur?.nom || "—" }}<span class="dd-sub">{{ t.etablissement?.nom || "" }}</span></dd>
        </div>
        <div>
          <dt>Groupe</dt>
          <dd><template v-if="t.groupe">{{ t.groupe.nom }}</template><span v-else class="muted">—</span></dd>
        </div>
        <div>
          <dt>Affecté à</dt>
          <dd><template v-if="t.intervenant">{{ t.intervenant.nom }}</template><span v-else class="muted">Personne</span></dd>
        </div>
        <div v-if="t.valideur">
          <dt>Valideur</dt>
          <dd>{{ t.valideur.nom }}</dd>
        </div>
        <div><dt>Statut EasyVista</dt><dd>{{ t.statut_ev }}</dd></div>
        <div><dt>Échéance</dt><dd>{{ t.echeance ? formatDateTime(t.echeance) : "—" }}</dd></div>
        <div><dt>Créé le</dt><dd>{{ formatDateTime(t.date_creation) }}</dd></div>
        <div><dt>Mis à jour le</dt><dd>{{ formatDateTime(t.date_maj) }}</dd></div>
      </dl>

      <div class="field">
        <span class="section-label">Historique</span>
        <ol class="events">
          <li v-for="(h, i) in t.historique" :key="i" class="event" :class="{ 'is-current': h.en_cours }">
            <div class="event-head">
              <template v-if="h.auteur"><strong>{{ h.auteur.nom }}</strong> · </template>{{ h.action }}
              <span v-if="h.en_cours" class="event-step">en cours</span>
            </div>
            <div class="event-meta">{{ h.en_cours ? "Depuis le " : "" }}{{ formatDateTime(h.date) }}</div>
            <div v-if="h.message" class="event-msg">{{ h.message }}</div>
          </li>
        </ol>
      </div>
    </div>
  </aside>
</template>
