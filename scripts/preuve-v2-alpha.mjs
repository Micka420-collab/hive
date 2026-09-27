// LA PREUVE V2 ALPHA, SUR VOTRE RUCHE — une vraie mission, de vrais agents, et
// un rapport critère par critère de ce que la Reine a réellement consigné.
//
//   npm run preuve:v2-alpha -- --racine <dossier de la ruche>          (état des lieux)
//   npm run preuve:v2-alpha -- --racine <dossier de la ruche> --oui    (confie la mission)
//
// Options :
//   --patience <s>   attente maximale (900 s ; 1800 s avec --workers)
//   --exige-bac      chaque nœud qui exécute la mission (sous-tâches déléguées
//                    et relectures comprises) doit déclarer un bac conteneur
//                    (podman, docker ou bubblewrap) — sinon ✘
//   --workers <n>    l'ESSAIM : n ouvrières réelles de 2 familles au moins,
//                    dont une Claude Code ou Codex (seuls leurs adaptateurs
//                    savent déléguer), n tâches indépendantes et une qui
//                    délègue ; exigés en plus : parallélisme des tâches
//                    indépendantes, délégation vers une AUTRE ouvrière,
//                    relecture croisée ; la reprise après objection est dite,
//                    jamais exigée (une objection ne se provoque pas)
//   --depot <url>    la mission travaille sur ce dépôt GitHub (https), puis
//                    chaque production — sous-tâches déléguées comprises — est
//                    livrée en pull request ; l'URL et le jeton de la Reine
//                    (HIVE_GITHUB_TOKEN) sont vérifiés AVANT de dépenser
//
// ─── CE QUE CE SCRIPT PROUVE, ET CE QU'IL NE PROUVE PAS ─────────────────────
//
// Il confie une petite tâche (une fonction et son test) — ou un lot, avec
// `--workers` — à des ouvrières dont l'agent n'est pas une simulation, attend
// que chaque production soit RÉGLÉE (contre-revue rendue, aucun retry de
// l'Evaluator en attente), puis relit par l'API : la production, le routage,
// la chronologie, l'évaluation, le Genome, la réputation, et le journal.
// Chaque critère sort `✔ prouvé`, `? inconnu` ou `✘ échec`.
//
// Il ne prouve PAS la qualité du code produit, ni ce que la Reine ne peut pas
// constater : l'agent, le bac à sable et le coût sont DÉCLARÉS par le nœud ou
// par le CLI de l'agent, et le rapport le dit.
//
// Sans `--oui`, rien n'est créé : confier la mission fait travailler de vrais
// agents, donc consomme des crédits de leurs comptes. C'est le seul drapeau
// qui dépense.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as attendre } from 'node:timers/promises';
import { lireEnv } from './premier-quart-heure.mjs';
import { argumentsDeLaPreuve, menerLaPreuve } from './preuve-v2-alpha-pas.mjs';
import { conclurePreuve } from './preuve-v2-alpha-rapport.mjs';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

const USAGE =
  'usage : npm run preuve:v2-alpha -- --racine <dossier de la ruche> [--oui] ' +
  '[--patience <s>] [--exige-bac] [--workers <n>] [--depot <url>]';

/** La vraie ruche, au-dessus de `fetch` ; une panne de transport devient un statut 0. */
function rucheReelle(base, entetes) {
  const demander = async (chemin, options = {}) => {
    try {
      const r = await fetch(base + chemin, options);
      const texte = await r.text();
      let corps = null;
      try {
        corps = JSON.parse(texte);
      } catch {
        corps = null;
      }
      return { status: r.status, corps, texte };
    } catch (e) {
      const cause = e?.cause?.code ?? e?.message ?? String(e);
      return { status: 0, corps: null, texte: `la ruche ne répond plus (${chemin}) — ${cause}` };
    }
  };
  const poster = (chemin, corps) =>
    demander(chemin, {
      method: 'POST',
      headers: { ...entetes, 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    });
  return {
    instantane: () => demander('/api/state', { headers: entetes }),
    creerProjet: (corps) => poster('/api/projects', corps),
    creerTaches: (projetId, taches) =>
      poster(`/api/projects/${encodeURIComponent(projetId)}/tasks`, { tasks: taches }),
    livrer: (taskId) => poster('/api/livraison', { taskId }),
    lire: (chemin) => demander(chemin, { headers: entetes }),
    patienter: (ms) => attendre(ms),
  };
}

async function principal() {
  const options = argumentsDeLaPreuve(process.argv.slice(2));
  if ('erreur' in options) {
    console.error(`✘ ${options.erreur}\n${USAGE}`);
    return MAL_APPELE;
  }
  let env;
  try {
    env = lireEnv(readFileSync(path.join(options.racine, '.env'), 'utf8'));
  } catch {
    console.error(`✘ aucun .env lisible dans ${options.racine}`);
    return ECHEC;
  }
  const port = env.HIVE_PORT ?? '7777';
  const jeton = env.HIVE_TOKEN ?? '';
  if (!jeton) {
    console.error('✘ .env sans HIVE_TOKEN : la preuve ne peut pas lire la ruche');
    return ECHEC;
  }

  const ruche = rucheReelle(`http://127.0.0.1:${port}`, { 'x-hive-token': jeton });
  const issue = await menerLaPreuve(ruche, options);
  if (!issue.ok) {
    if (issue.plan) {
      console.log(`… ${issue.message}`);
      return OK;
    }
    console.error(`✘ ${issue.raison}`);
    return ECHEC;
  }

  const conclusion = conclurePreuve(issue, options);
  console.log(conclusion.texte);
  // `process.exitCode`, jamais `process.exit()` : sous Windows, couper la
  // boucle avec un `fetch` en vol fait abandonner libuv (cf. essai-travail.mjs).
  return conclusion.prouve ? OK : ECHEC;
}

process.exitCode = await principal();
