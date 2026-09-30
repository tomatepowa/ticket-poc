// synchro.js — alimente le cache local (PostgreSQL) a partir d'EasyVista.
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
// Chaque ticket enregistre recoit ses colonnes "a plat" (statut, etape, groupe,
// dates...) calculees par le portail : elles servent aux listes et au pole BI.
//
// Uniquement des routes documentees (tri + max_rows + offset, EV 2024.3+ pour
// l'offset). A VERIFIER sur la vraie instance : les noms de champs de tri
// "last_update" et "start_date_ut".

const M = require("./modele");
const { verifierCorrespondance } = require("./controle");

const PAGE = 100;
const PAGE_ACTIONS = 1000;
const MARGE_MS = 2 * 60e3; // recouvrement entre deux synchros (horloges, transactions en cours)
const MAX_PAGES_INCREMENTALE = 50;
// Utilisateur "neutre" pour calculer les colonnes d'un ticket hors de tout droit.
const PERSONNE = { id: -1, profil: "AUCUN", groupes: [] };

// titresCatalogue : () => Promise<Map id -> titre> (pour decouper le chemin du catalogue)
function creerSynchro(client, cache, { intervalleMs = 60e3, retentionJours = 365, titresCatalogue } = {}) {
  let enCours = null;
  let minuterie = null;

  // Colonnes a plat d'un ticket (portail.tickets), d'apres l'interpretation du portail.
  async function resumer(req, actions) {
    const ctx = M.analyser(req, actions);
    const t = M.versTicket(ctx, PERSONNE, titresCatalogue ? await titresCatalogue() : new Map());
    return {
      type: t.type,
      titre: t.titre,
      statut: t.statut,
      statut_ev: t.statut_ev,
      etape: t.etape.label,
      priorite: t.priorite,
      catalogue: t.catalogue.libelle,
      catalogue_chemin: t.catalogue.chemin,
      etablissement: t.etablissement,
      groupe: t.groupe,
      intervenant: t.intervenant,
      demandeur: t.demandeur,
      valideur: t.valideur,
      date_creation: t.date_creation,
      date_maj: t.date_maj,
      echeance: t.echeance,
      ferme: t.statut === "CLOTURE",
    };
  }

  async function enregistrer(req, actions) {
    await cache.enregistrer(req, actions, await resumer(req, actions));
  }

  async function relireTicket(rfc) {
    let req;
    try {
      req = await client.getRequest(rfc);
    } catch (err) {
      if (err.status === 404) {
        await cache.supprimer(rfc);
        return null;
      }
      throw err;
    }
    const actions = (await client.getActions({ search: `request.rfc_number:"${rfc}"`, max_rows: 500 })).records;
    await enregistrer(req, actions);
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
    const derniere = await cache.lireEtat("derniere_synchro");
    const seuil = derniere ? new Date(new Date(derniere).getTime() - MARGE_MS).toISOString() : null;
    const versions = await cache.versions();
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
    const encoursCache = await cache.actionsEnCours();
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
      await enregistrer(req, acts);
    }
    for (const rfc of (await cache.versions()).keys()) if (!requetes.has(rfc)) await cache.supprimer(rfc);
    await cache.purger(limite);
    await cache.sessions.purger();
    return requetes.size;
  }

  // Controle de correspondance sur les tickets ouverts ou clos depuis 30 jours.
  // Ne bloque jamais la synchro : une erreur ici est seulement journalisee.
  async function controler() {
    try {
      const depuisClos = new Date(Date.now() - 30 * 86400e3).toISOString();
      const anomalies = verifierCorrespondance(
        await cache.candidats({ tous: true, depuisClos, limite: 100000 }),
        (await client.getGroups()).records
      );
      const avant = await cache.lireEtat("anomalies");
      const apres = JSON.stringify(anomalies);
      if (anomalies.length && apres !== avant) {
        console.warn(
          "Correspondance EV incomplete :",
          anomalies.map((a) => `${a.type} "${a.valeur}" (${a.nb_tickets} ticket(s))`).join(", ")
        );
      }
      await cache.ecrireEtat("anomalies", apres);
    } catch (err) {
      console.error("Controle de correspondance en echec :", err.message);
    }
  }

  // Lance une synchro, ou renvoie celle deja en cours (jamais deux en parallele).
  function executer({ complete: forcerComplete = false } = {}) {
    if (enCours) return enCours;
    const debut = new Date();

    enCours = (async () => {
      try {
        const derniereComplete = await cache.lireEtat("derniere_complete");
        const faireComplete =
          forcerComplete ||
          !derniereComplete ||
          debut - new Date(derniereComplete) > 24 * 3600e3 ||
          (await cache.compter()) === 0;
        const maj = faireComplete ? await complete() : await incrementale();
        await cache.ecrireEtat("derniere_synchro", debut.toISOString());
        if (faireComplete) await cache.ecrireEtat("derniere_complete", debut.toISOString());
        await cache.ecrireEtat("derniere_duree_ms", Date.now() - debut);
        await cache.ecrireEtat("derniere_maj", maj);
        await cache.ecrireEtat("erreur", null);
        await cache.ecrireEtat("erreur_depuis", null);
        await controler();
      } catch (err) {
        // EV (ou la base) injoignable : on garde le cache tel quel et on le signale.
        console.error("Synchro EasyVista en echec :", err.message);
        try {
          await cache.ecrireEtat("erreur", err.message);
          if (!(await cache.lireEtat("erreur_depuis"))) await cache.ecrireEtat("erreur_depuis", debut.toISOString());
        } catch (errBase) {
          console.error("Base du portail injoignable :", errBase.message);
        }
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

  async function etat() {
    const lire = (cle) => cache.lireEtat(cle);
    return {
      derniere_synchro: await lire("derniere_synchro"),
      derniere_complete: await lire("derniere_complete"),
      derniere_duree_ms: Number(await lire("derniere_duree_ms")) || null,
      derniere_maj: Number(await lire("derniere_maj")) || 0,
      erreur: await lire("erreur"),
      erreur_depuis: await lire("erreur_depuis"),
      en_cours: Boolean(enCours),
      intervalle_s: Math.round(intervalleMs / 1000),
      nb_tickets: await cache.compter(),
      anomalies: JSON.parse((await lire("anomalies")) || "[]"),
    };
  }

  return { executer, demarrer, arreter, etat, relireTicket };
}

module.exports = { creerSynchro };
