// Front du portail (Vue 3). Il n'affiche que ce que renvoie l'API : les droits,
// les etapes et les actions possibles sont decides cote serveur (par EasyVista,
// ou sa simulation).
import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

createApp(App).mount("#app");
