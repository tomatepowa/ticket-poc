// synchro.js — alimente le cache local a partir d'EasyVista.
//
//  - Synchro INCREMENTALE (toutes les SYNCHRO_SECONDES, 60 s par defaut) :
//      1. tickets tries par date de mise a jour decroissante, page par page,
//         jusqu'a retomber sur la date de la synchro precedente ;
//      2. liste des actions en cours, comparee au cache (detecte une action
//         terminee ou reaffectee sans que le ticket ait change) ;
//      3. relecture complete (ticket + actions) des seuls tickets modifies.
//  - Synchro COMPLETE (au premier demarrage, puis toutes les 24 h) : relit tous
//    les tickets et toutes les actions par pages, supprime ce qui a disparu d'EV,
//    purge les tickets clos au-dela de la retention.
//
// Uniquement des routes documentees (tri + max_rows + offset, EV 2024.3+ pour
// l'offset). A VERIFIER sur la vraie instance : les noms de champs de tri
// "last_update" et "start_date_ut".

const M = require("./modele");

const PAGE = 100;
const PAGE_ACTIONS = 1000;
const MARGE_MS = 2 * 60e3; // recouvrement entre deux synchros (horloges, transactions en cours)
const MAX_PAGES_INCREMENTALE = 50;

function creerSynchro(client, cache, { intervalleMs = 60e3, retentionJours = 365 } = {}) {
  let enCours = null;
  let minuterie = null;

  const estFerme = (req, actions) => M.analyser(req, actions).statut === "CLOTURE";

  async function relireTicket(rfc) {
    let req;
    try {
      req = await client.getRequest(rfc);
    } catch (err) {
      if (err.status === 404) {
        cache.supprimer(rfc);
        return null;
      }
      throw err;
    }
    const actions = (await client.getActions({ search: `request.rfc_number:"${rfc}"`, max_rows: 500 })).records;
    cache.enregistrer(req, actions, estFerme(req, actions));
    return { req, actions };
  }

  // Relit plusieurs tickets, 5 appels a la fois pour ne pas surcharger EV.
  async function relireTickets(rfcs) {
    const liste = [...rfcs];
    for (let i = 0; i < liste.length; i += 5) {
      await Promise.all(liste.slice(i, i + 5).map(relireTicket));
    }
  }

  async function incrementale() {
    const derniere = cache.lireEtat("derniere_synchro");
    const seuil = derniere ? new Date(new Date(derniere).getTime() - MARGE_MS).toISOString() : null;
    const versions = cache.versions();
    const aRelire = new Set();

    for (let page = 0; page < MAX_PAGES_INCREMENTALE; page++) {
      const { records } = await client.getRequests({ sort: "last_update+desc", max_rows: PAGE, offset: page * PAGE });
      let fini = records.length < PAGE;
      for (const r of records) {
        if (seuil && String(r.LAST_UPDATE) < seuil) {
          fini = true;
          break;
        }
        if (versions.get(r.RFC_NUMBER) !== r.LAST_UPDATE) aRelire.add(r.RFC_NUMBER);
      }
      if (fini) break;
    }

    // Actions en cours : ce que dit EV vs ce que dit le cache.
    const encoursEV = new Map();
    for (const a of (await client.getActions({ search: 'end_date_ut:"is_null"', max_rows: 5000 })).records) {
      const rfc = M.rfcAction(a);
      if (!encoursEV.has(rfc)) encoursEV.set(rfc, new Set());
      encoursEV.get(rfc).add(String(a.ACTION_ID));
    }
    const encoursCache = cache.actionsEnCours();
    const memes = (x = new Set(), y = new Set()) => x.size === y.size && [...x].every((v) => y.has(v));
    for (const rfc of new Set([...encoursEV.keys(), ...encoursCache.keys()])) {
      if (!memes(encoursEV.get(rfc), encoursCache.get(rfc))) aRelire.add(rfc);
    }

    await relireTickets(aRelire);
    return aRelire.size;
  }

  async function complete() {
    const limite = new Date(Date.now() - retentionJours * 86400e3).toISOString();

    // 1. Tous les tickets mis a jour dans la periode de retention.
    const requetes = new Map();
    for (let page = 0; ; page++) {
      const { records } = await client.getRequests({ sort: "last_update+desc", max_rows: PAGE, offset: page * PAGE });
      const utiles = records.filter((r) => String(r.LAST_UPDATE) >= limite);
      utiles.forEach((r) => requetes.set(r.RFC_NUMBER, r));
      if (records.length < PAGE || utiles.length < records.length) break;
    }

    // 2. Toutes les actions, par grosses pages, regroupees par ticket
    //    (bien moins d'appels qu'une requete d'actions par ticket).
    const actions = new Map();
    for (let page = 0; ; page++) {
      const { records } = await client.getActions({ sort: "start_date_ut+desc", max_rows: PAGE_ACTIONS, offset: page * PAGE_ACTIONS });
      for (const a of records) {
        const rfc = M.rfcAction(a);
        if (!requetes.has(rfc)) continue;
        if (!actions.has(rfc)) actions.set(rfc, []);
        actions.get(rfc).push(a);
      }
      if (records.length < PAGE_ACTIONS || records.every((a) => String(a.START_DATE_UT) < limite)) break;
    }

    // 3. Remplacement du cache, suppression de ce qui n'existe plus cote EV.
    for (const [rfc, req] of requetes) {
      const acts = (actions.get(rfc) || []).sort((a, b) => Number(a.ACTION_ID) - Number(b.ACTION_ID));
      cache.enregistrer(req, acts, estFerme(req, acts));
    }
    for (const rfc of cache.versions().keys()) if (!requetes.has(rfc)) cache.supprimer(rfc);
    cache.purger(limite);
    return requetes.size;
  }

  // Lance une synchro, ou renvoie celle deja en cours (jamais deux en parallele).
  function executer({ complete: forcerComplete = false } = {}) {
    if (enCours) return enCours;
    const debut = new Date();
    const derniereComplete = cache.lireEtat("derniere_complete");
    const faireComplete =
      forcerComplete || !derniereComplete || debut - new Date(derniereComplete) > 24 * 3600e3 || cache.compter() === 0;

    enCours = (async () => {
      try {
        const maj = faireComplete ? await complete() : await incrementale();
        cache.ecrireEtat("derniere_synchro", debut.toISOString());
        if (faireComplete) cache.ecrireEtat("derniere_complete", debut.toISOString());
        cache.ecrireEtat("derniere_duree_ms", Date.now() - debut);
        cache.ecrireEtat("derniere_maj", maj);
        cache.ecrireEtat("erreur", null);
        cache.ecrireEtat("erreur_depuis", null);
      } catch (err) {
        // EV injoignable : on garde le cache tel quel et on le signale.
        console.error("Synchro EasyVista en echec :", err.message);
        cache.ecrireEtat("erreur", err.message);
        if (!cache.lireEtat("erreur_depuis")) cache.ecrireEtat("erreur_depuis", debut.toISOString());
      }
    })().finally(() => {
      enCours = null;
    });
    return enCours;
  }

  function demarrer() {
    executer();
    minuterie = setInterval(() => executer(), intervalleMs);
    minuterie.unref?.();
  }

  function arreter() {
    clearInterval(minuterie);
  }

  function etat() {
    return {
      derniere_synchro: cache.lireEtat("derniere_synchro"),
      derniere_complete: cache.lireEtat("derniere_complete"),
      derniere_duree_ms: Number(cache.lireEtat("derniere_duree_ms")) || null,
      derniere_maj: Number(cache.lireEtat("derniere_maj")) || 0,
      erreur: cache.lireEtat("erreur"),
      erreur_depuis: cache.lireEtat("erreur_depuis"),
      en_cours: Boolean(enCours),
      intervalle_s: Math.round(intervalleMs / 1000),
      nb_tickets: cache.compter(),
    };
  }

  return { executer, demarrer, arreter, etat, relireTicket };
}

module.exports = { creerSynchro };
