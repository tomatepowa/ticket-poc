// Libelles, formats, liens directs et notification : partages par les composants.
import { ref } from "vue";

export const PROFIL_LABEL = { INTERVENANT: "Intervenant", VALIDEUR: "Valideur", SUPERVISEUR: "Superviseur" };
export const PROFIL_LABEL_PLURIEL = { INTERVENANT: "Intervenants", VALIDEUR: "Cadres valideurs", SUPERVISEUR: "Superviseurs" };
export const PRIORITE_LABEL = { 1: "Critique", 2: "Haute", 3: "Normale", 4: "Basse" };
// Priorite d'un incident : MATRICE_PRIORITE[impact][urgence]
export const MATRICE_PRIORITE = { 3: { 2: 1, 1: 2 }, 2: { 2: 2, 1: 3 }, 1: { 2: 3, 1: 4 } };

export function initiales(u) {
  return `${u.prenom[0]}${u.nom[0]}`.toUpperCase();
}

// Bandeau : nom de l'organisation (réglage ORGANISATION) et pastille d'initiales.
export function marque(config) {
  const nom = config?.organisation || "";
  const mots = nom.split(/[\s-]+/).filter((m) => /^\p{Lu}/u.test(m));
  return {
    nom: nom || "Portail tickets IT",
    sous: nom ? "Portail tickets IT" : "EasyVista",
    logo: nom ? (mots.length ? mots.slice(0, 2).map((m) => m[0]).join("") : nom.slice(0, 2).toUpperCase()) : "PT",
  };
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

export function formatHeure(iso) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Age relatif : "à l'instant", "il y a 40 s", "il y a 3 min", "il y a 2 h"
export function formatDepuis(iso, maintenant = Date.now()) {
  const s = Math.max(0, Math.round((maintenant - new Date(iso).getTime()) / 1000));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  return `il y a ${Math.floor(s / 3600)} h`;
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
