<script setup>
// Ecran de connexion. Mode developpement : choix d'un compte EV fictif.
import { computed, onMounted, ref } from "vue";
import { api } from "../api.js";
import { PROFIL_LABEL_PLURIEL, initiales, ticketDansUrl, toast } from "../outils.js";

const props = defineProps({ config: { type: Object, required: true } });
const emit = defineEmits(["connecte"]);

const comptes = ref([]);
const cible = ticketDansUrl();

const groupesComptes = computed(() =>
  ["INTERVENANT", "VALIDEUR", "SUPERVISEUR"]
    .map((profil) => ({ profil, comptes: comptes.value.filter((c) => c.profil === profil) }))
    .filter((g) => g.comptes.length)
);

onMounted(async () => {
  if (props.config.mode === "dev") comptes.value = await api("/auth/comptes-dev");
});

async function choisir(compte) {
  try {
    const utilisateur = await api("/auth/login-dev", {
      method: "POST",
      body: JSON.stringify({ utilisateur_id: compte.id }),
    });
    emit("connecte", utilisateur);
  } catch (err) {
    toast(err.message);
  }
}
</script>

<template>
  <section class="login">
    <div class="login-card">
      <div class="rail-brand login-brand">
        <span class="rail-logo" aria-hidden="true">OS</span>
        <div>
          <div class="rail-brand-name">Groupe Exemple</div>
          <div class="login-sub">Portail tickets IT</div>
        </div>
      </div>
      <h1>Connexion</h1>

      <p v-if="config.mode !== 'dev'" class="login-note">Connexion via votre compte Windows (SSO)…</p>
      <template v-else>
        <p class="login-note">
          <template v-if="cible">Connectez-vous pour ouvrir le ticket {{ cible }}. </template>
          Outil des équipes support et des cadres valideurs. Mode simulation : choisissez un compte
          EasyVista fictif. En production, la connexion se fera automatiquement avec votre compte Windows (SSO).
        </p>
        <div class="login-list">
          <div v-for="g in groupesComptes" :key="g.profil" class="login-group">
            <div class="login-group-title">{{ PROFIL_LABEL_PLURIEL[g.profil] }}</div>
            <button v-for="c in g.comptes" :key="c.id" class="login-account" @click="choisir(c)">
              <span class="avatar">{{ initiales(c) }}</span>
              <span class="login-account-info">
                <span class="login-account-name">{{ c.nom_complet }}</span>
                <span class="login-account-sub">
                  {{ c.fonction }}<template v-if="c.groupes.length"> · {{ c.groupes.map((x) => x.nom).join(", ") }}</template>
                </span>
              </span>
            </button>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
