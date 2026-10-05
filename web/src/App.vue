<script setup>
// Racine du portail : session, filtres, liste et panneaux, liens directs /t/<n°>.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { api, NonConnecte } from "./api.js";
import { marque, messageToast, ticketDansUrl, toast } from "./outils.js";
import EcranConnexion from "./components/EcranConnexion.vue";
import RailFiltres from "./components/RailFiltres.vue";
import StatsTickets from "./components/StatsTickets.vue";
import TableTickets from "./components/TableTickets.vue";
import PanneauCreation from "./components/PanneauCreation.vue";
import PanneauDetail from "./components/PanneauDetail.vue";
import BandeauSynchro from "./components/BandeauSynchro.vue";
import FiltresActifs from "./components/FiltresActifs.vue";

const TITRE_PAGE = document.title;

const etat = ref("chargement"); // chargement | connexion | portail | erreur
const erreurFatale = ref("");
const config = ref(null);
const moi = ref(null);
const vues = ref([]);
const referentiels = ref({ etablissements: [], groupes: [], catalogue: [] });
const filtres = reactive({ vue: "", q: "", etablissement: "", groupe: "", statut: "" });
// Préférences de l'utilisateur (vue et statut à l'ouverture), enregistrées côté serveur.
const preferences = ref({ vue_defaut: "", statut_defaut: "ACTIFS" });
// Filtres par défaut : ceux choisis par l'utilisateur (sinon première vue, tickets actifs).
const DEFAUTS = computed(() => ({
  vue: preferences.value.vue_defaut || vues.value[0]?.code || "",
  statut: preferences.value.statut_defaut ?? "ACTIFS",
}));
const tickets = ref([]);
const stats = ref(null);
const panneau = ref(null); // null | "creation" | "detail"
const ticket = ref(null);
// Incremente a chaque ouverture du detail : le panneau repart de zero (commentaire vide...).
const versionDetail = ref(0);
// Idem pour la saisie : apres un ticket resolu en direct, formulaire vide pour l'appel suivant.
const versionCreation = ref(0);
const brouillon = ref(false); // saisie en cours dans le panneau de creation

const titreVue = computed(() => vues.value.find((v) => v.code === filtres.vue)?.label || "Tickets");
const compteVisible = computed(() => {
  const n = tickets.value.length;
  const avecFiltres = filtres.q || filtres.etablissement || filtres.groupe || filtres.statut;
  return `${n} ticket${n > 1 ? "s" : ""}` + (avecFiltres ? " correspondant aux filtres" : "");
});

// ---------- Démarrage / connexion ----------

onMounted(async () => {
  window.addEventListener("popstate", onPopstate);
  document.addEventListener("keydown", onKeydown);
  try {
    config.value = await api("/auth/config");
    if (config.value.organisation) document.title = `${marque(config.value).nom} — Portail tickets IT`;
    try {
      const { utilisateur, vues, preferences } = await api("/moi");
      await entrer(utilisateur, vues, preferences);
    } catch (err) {
      if (!(err instanceof NonConnecte)) throw err;
      etat.value = "connexion";
    }
  } catch (err) {
    console.error(err);
    erreurFatale.value = err.message;
    etat.value = "erreur";
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", onPopstate);
  document.removeEventListener("keydown", onKeydown);
});

async function onConnecte(utilisateur) {
  const { vues, preferences } = await api("/moi");
  await entrer(utilisateur, vues, preferences);
}

async function entrer(utilisateur, vuesDisponibles, prefs) {
  referentiels.value = await api("/referentiels");
  moi.value = utilisateur;
  vues.value = vuesDisponibles;
  preferences.value = prefs || { vue_defaut: "", statut_defaut: "ACTIFS" };
  Object.assign(filtres, { q: "", etablissement: "", groupe: "", ...DEFAUTS.value });
  etat.value = "portail";
  await rafraichir();

  // Arrivée par un lien direct : on ouvre le ticket demandé.
  const cible = ticketDansUrl();
  if (cible) await ouvrirDepuisLien(cible);
}

async function deconnecter() {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  fermerPanneaux();
  moi.value = null;
  etat.value = "connexion";
}

// ---------- Liste + stats ----------

let derniereRequete = 0;

async function rafraichir() {
  // Seule la réponse à la dernière requête est affichée (frappe rapide dans la recherche...).
  const n = ++derniereRequete;
  const params = new URLSearchParams();
  Object.entries(filtres).forEach(([k, v]) => v && params.set(k, v));
  const [t, s] = await Promise.all([
    api(`/tickets?${params}`),
    // Mêmes paramètres : les indicateurs suivent toujours les filtres.
    api(`/stats?${params}`),
  ]);
  if (n !== derniereRequete) return;
  tickets.value = t;
  stats.value = s;
}

// message : confirmation affichée quand le filtre vient d'un clic dans la liste.
// Vue ou statut à l'ouverture (coches du rail) : { vue_defaut } ou { statut_defaut }, et son libellé.
async function choisirDefaut(choix, libelle) {
  try {
    preferences.value = await api("/preferences", { method: "PUT", body: JSON.stringify(choix) });
    toast(`À l'ouverture : « ${libelle} »`);
  } catch (err) {
    toast(err.message);
  }
}

function filtrer(changements, message) {
  Object.assign(filtres, changements);
  if (message) toast(message);
  rafraichir().catch((err) => toast(err.message));
}

// ---------- Panneaux ----------

async function ouvrirDetail(id, { majUrl = true } = {}) {
  const t = await api(`/tickets/${encodeURIComponent(id)}`);
  // L'adresse reflète le ticket ouvert : elle peut être copiée ou mise en favori.
  if (majUrl && ticketDansUrl() !== t.id) history.pushState(null, "", `/t/${encodeURIComponent(t.id)}`);
  document.title = `${t.numero} — ${t.titre}`;
  ticket.value = t;
  versionDetail.value++;
  panneau.value = "detail";
}

async function ouvrirDepuisLien(id) {
  try {
    await ouvrirDetail(id, { majUrl: false });
  } catch (err) {
    if (err instanceof NonConnecte) throw err;
    history.replaceState(null, "", "/");
    // Même message que le ticket existe ou non : on ne révèle pas son existence.
    toast(`Ticket ${id} introuvable, ou vous n'y avez pas accès.`);
  }
}

function ouvrirDepuisListe(id) {
  ouvrirDetail(id).catch((err) => toast(err.message));
}

function ouvrirCreation() {
  ticket.value = null;
  panneau.value = "creation";
}

function fermerPanneaux({ majUrl = true } = {}) {
  panneau.value = null;
  brouillon.value = false;
  ticket.value = null;
  document.title = TITRE_PAGE;
  if (majUrl && ticketDansUrl()) history.pushState(null, "", "/");
}

// Clic à côté du panneau : ne ferme pas une saisie en cours (notes d'appel perdues).
function clicOverlay() {
  if (panneau.value === "creation" && brouillon.value) return;
  fermerPanneaux();
}

async function onCree(cree) {
  const direct = cree.resolution_directe;
  // Résolu en direct (hotline) : formulaire vide, prêt pour l'appel suivant.
  if (direct?.resolu) {
    toast(`Ticket ${cree.numero} ${direct.message}.`);
    versionCreation.value++;
    brouillon.value = false;
    rafraichir().catch((err) => toast(err.message));
    return;
  }
  toast(direct ? `Ticket ${cree.numero} ${direct.message}.` : `Ticket ${cree.numero} créé.`);
  try {
    await rafraichir();
    await ouvrirDetail(cree.id);
  } catch (err) {
    toast(err.message);
  }
}

async function onActionFaite({ action, resultat }) {
  try {
    if (resultat.masque) {
      fermerPanneaux();
      toast(resultat.message);
    } else {
      toast(`${action.label} : fait.`);
      await ouvrirDetail(ticket.value.id);
    }
    await rafraichir();
  } catch (err) {
    toast(err.message);
  }
}

// La copie locale d'EV a été mise à jour : on recharge la liste sans rien interrompre.
function onNouvellesDonnees() {
  rafraichir().catch(() => {});
}

// Bouton "Actualiser" du détail : relecture en direct dans EasyVista.
async function actualiserDetail() {
  try {
    await ouvrirDetail(ticket.value.id, { majUrl: false });
    toast("Ticket relu dans EasyVista.");
  } catch (err) {
    toast(err.message);
  }
}

function onPopstate() {
  if (!moi.value) return;
  const id = ticketDansUrl();
  if (id) ouvrirDepuisLien(id);
  else fermerPanneaux({ majUrl: false });
}

function onKeydown(e) {
  if (e.key === "Escape" && panneau.value) clicOverlay();
}
</script>

<template>
  <p v-if="etat === 'erreur'" class="erreur-fatale">Erreur de chargement : {{ erreurFatale }}</p>

  <EcranConnexion v-else-if="etat === 'connexion'" :config="config" @connecte="onConnecte" />

  <div v-else-if="etat === 'portail'" class="shell">
    <RailFiltres
      :moi="moi"
      :vues="vues"
      :referentiels="referentiels"
      :filtres="filtres"
      :config="config"
      :stats="stats"
      :defauts="DEFAUTS"
      @filtrer="filtrer"
      @defaut="choisirDefaut"
      @deconnecter="deconnecter"
    />

    <main class="main">
      <header class="main-head">
        <div>
          <h1>{{ titreVue }}</h1>
          <p class="main-sub">{{ compteVisible }}</p>
        </div>
        <button v-if="moi.profil !== 'VALIDEUR'" class="btn btn-primary" @click="ouvrirCreation">
          <span aria-hidden="true">+</span> Nouveau ticket
        </button>
      </header>

      <FiltresActifs :filtres="filtres" :referentiels="referentiels" :vues="vues" :defauts="DEFAUTS" @filtrer="filtrer" />

      <BandeauSynchro :profil="moi.profil" @nouvelles-donnees="onNouvellesDonnees" />

      <StatsTickets v-if="stats" :stats="stats" :profil="moi.profil" :filtres="filtres" :vues="vues" @filtrer="filtrer" />
      <TableTickets
        :tickets="tickets"
        :filtres="filtres"
        :vues="vues"
        :profil="moi.profil"
        @ouvrir="ouvrirDepuisListe"
        @filtrer="filtrer"
      />
    </main>
  </div>

  <template v-if="panneau">
    <div class="overlay" @click="clicOverlay"></div>
    <PanneauCreation
      v-if="panneau === 'creation'"
      :key="versionCreation"
      :referentiels="referentiels"
      @fermer="fermerPanneaux()"
      @cree="onCree"
      @brouillon="(v) => (brouillon = v)"
    />
    <PanneauDetail
      v-else-if="panneau === 'detail'"
      :key="versionDetail"
      :ticket="ticket"
      :groupes="referentiels.groupes"
      @fermer="fermerPanneaux()"
      @fait="onActionFaite"
      @actualiser="actualiserDetail"
    />
  </template>

  <div v-if="messageToast" class="toast" role="status">{{ messageToast }}</div>
</template>
