<script setup>
// Liste des tickets. Un clic ouvre le detail ; Ctrl/Cmd/Maj + clic sur le n°
// laisse le navigateur ouvrir le lien direct dans un nouvel onglet.
import { PRIORITE_LABEL, formatCourt } from "../outils.js";

defineProps({ tickets: { type: Array, required: true } });
const emit = defineEmits(["ouvrir"]);

function onClic(e, t) {
  if (e.target.closest("a") && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;
  e.preventDefault();
  emit("ouvrir", t.id);
}

const sansEcheance = (t) => t.statut === "RESOLU" || t.statut === "CLOTURE" || !t.echeance;
</script>

<template>
  <section class="table-wrap">
    <table class="tickets">
      <thead>
        <tr>
          <th class="col-prio">Prio.</th>
          <th>N°</th>
          <th>Ticket</th>
          <th>Demandeur</th>
          <th>Affectation</th>
          <th>Étape</th>
          <th>Échéance</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="t in tickets"
          :key="t.id"
          tabindex="0"
          :class="{ 'needs-action': t.attend_mon_action }"
          @click="onClic($event, t)"
          @keydown.enter="emit('ouvrir', t.id)"
        >
          <td>
            <span class="prio" :class="`prio-${t.priorite}`" :title="PRIORITE_LABEL[t.priorite]">P{{ t.priorite }}</span>
          </td>
          <td class="num">
            <a class="num-link" :href="`/t/${encodeURIComponent(t.id)}`" tabindex="-1">{{ t.numero }}</a>
          </td>
          <td class="titre-cell">
            <span class="titre">{{ t.titre }}</span>
            <span class="sub">{{ t.type_label }} · {{ t.catalogue.libelle }}</span>
          </td>
          <td class="two-lines">
            <span>{{ t.demandeur?.nom || "—" }}</span>
            <span class="sub">{{ t.etablissement?.nom || "" }}</span>
          </td>
          <td class="two-lines">
            <span v-if="t.groupe" class="badge-equipe">{{ t.groupe.nom }}</span>
            <span v-else class="muted">—</span>
            <span class="sub">{{ t.intervenant ? t.intervenant.nom : t.groupe ? "Non affecté" : "" }}</span>
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
