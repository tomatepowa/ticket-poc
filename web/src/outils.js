// Libelles, formats, liens directs et notification : partages par les composants.
import { ref } from "vue";

export const PROFIL_LABEL = { UTILISATEUR: "Utilisateur", INTERVENANT: "Intervenant", SUPERVISEUR: "Superviseur" };
export const PRIORITE_LABEL = { 1: "Critique", 2: "Haute", 3: "Normale", 4: "Basse" };
// Priorite d'un incident : MATRICE_PRIORITE[impact][urgence]
export const MATRICE_PRIORITE = { 3: { 2: 1, 1: 2 }, 2: { 2: 2, 1: 3 }, 1: { 2: 3, 1: 4 } };

export function initiales(u) {
  return `${u.prenom[0]}${u.nom[0]}`.toUpperCase();
}

// Format compact pour la liste : "30/09 14:00"
export function formatCourt(iso) {
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ---------- Liens directs vers un ticket (/t/<numéro EV>) ----------

export function ticketDansUrl() {
  const m = location.pathname.match(/^\/t\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function lienTicket(id) {
  return `${location.origin}/t/${encodeURIComponent(id)}`;
}

// ---------- Notification ----------

export const messageToast = ref("");
let timerToast;

export function toast(message) {
  messageToast.value = message;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (messageToast.value = ""), 4000);
}
