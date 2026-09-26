// LA PREUVE V2 ALPHA, SUR VOTRE RUCHE — une vraie mission, un vrai agent, et
// un rapport critère par critère de ce que la Reine a réellement consigné.
//
//   npm run preuve:v2-alpha -- --racine <dossier de la ruche>          (état des lieux)
//   npm run preuve:v2-alpha -- --racine <dossier de la ruche> --oui    (confie la mission)
//
// Options : `--patience <secondes>` (défaut 900).
//
// ─── CE QUE CE SCRIPT PROUVE, ET CE QU'IL NE PROUVE PAS ─────────────────────
//
// Il confie une petite tâche (une fonction et son test) à une ouvrière dont
// l'agent n'est pas une simulation, attend qu'elle finisse, puis relit par
// l'API : la production, le routage, la chronologie, l'évaluation, le Genome,
// la réputation. Chaque critère sort `✔ prouvé`, `? inconnu` ou `✘ échec`.
//
// Il ne prouve PAS la qualité du code produit, ni ce que la Reine ne peut pas
// constater : l'agent, le bac à sable et le coût sont DÉCLARÉS par le nœud ou
// par le CLI de l'agent, et le rapport le dit.
//
// Sans `--oui`, rien n'est créé : confier la mission fait travailler un vrai
// agent, donc consomme des crédits de son compte.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as attendre } from 'node:timers/promises';
import { lireEnv } from './premier-quart-heure.mjs';
import { racineDemandee } from './travail-fait.mjs';
import { PATIENCE_S, menerLaPreuve } from './preuve-v2-alpha-pas.mjs';
import { jugerV2Alpha, missionReelleProuvee, rapportV2Alpha } from './preuve-v2-alpha-verdict.mjs';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

const argv = process.argv.slice(2);
const racine = racineDemandee(argv);
const creer = argv.includes('--oui');
const iPatience = argv.indexOf('--patience');
const patienceS = iPatience >= 0 ? Number(argv[iPatience + 1]) : PATIENCE_S;

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
    creerTache: (projetId, mission) =>
      poster(`/api/projects/${encodeURIComponent(projetId)}/tasks`, { tasks: [mission] }),
    lire: (chemin) => demander(chemin, { headers: entetes }),
    patienter: (ms) => attendre(ms),
  };
}

async function principal() {
  if (racine === null || !Number.isFinite(patienceS) || patienceS <= 0) {
    console.error(
      'usage : npm run preuve:v2-alpha -- --racine <dossier de la ruche> [--oui] [--patience <s>]',
    );
    return MAL_APPELE;
  }
  let env;
  try {
    env = lireEnv(readFileSync(path.join(racine, '.env'), 'utf8'));
  } catch {
    console.error(`✘ aucun .env lisible dans ${racine}`);
    return ECHEC;
  }
  const port = env.HIVE_PORT ?? '7777';
  const jeton = env.HIVE_TOKEN ?? '';
  if (!jeton) {
    console.error('✘ .env sans HIVE_TOKEN : la preuve ne peut pas lire la ruche');
    return ECHEC;
  }

  const ruche = rucheReelle(`http://127.0.0.1:${port}`, { 'x-hive-token': jeton });
  const issue = await menerLaPreuve(ruche, { creer, patienceS });
  if (!issue.ok) {
    if (issue.plan) {
      console.log(`… ${issue.message}`);
      return OK;
    }
    console.error(`✘ ${issue.raison}`);
    return ECHEC;
  }

  const verdicts = jugerV2Alpha(issue.faits);
  console.log(`Preuve V2 Alpha — mission ${issue.taskId}\n`);
  console.log(rapportV2Alpha(verdicts));
  const reelle = missionReelleProuvee(verdicts);
  console.log(
    reelle
      ? '\n✔ Mission réelle prouvée : un agent réel a produit le travail demandé.'
      : '\n✘ Mission réelle NON prouvée — voir les lignes ✘ ci-dessus.',
  );
  // `process.exitCode`, jamais `process.exit()` : sous Windows, couper la
  // boucle avec un `fetch` en vol fait abandonner libuv (cf. essai-travail.mjs).
  return reelle ? OK : ECHEC;
}

process.exitCode = await principal();
