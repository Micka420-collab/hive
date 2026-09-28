// LA BOUCLE HIVE → HIVE (V3), SUR VOTRE RUCHE — le coureur.
//
//   npm run boucle:v3 -- --racine <dossier de la ruche> --mission "<ce que Hive doit améliorer>"
//   npm run boucle:v3 -- --racine <dossier> --mission "…" --oui        (confie la mission)
//   npm run boucle:v3 -- --racine <dossier> --reprendre <projet> --oui  (après une validation)
//
// Options :
//   --depot <url>    le dépôt GitHub de Hive à améliorer (défaut : le dépôt
//                    officiel ; un fork de Hive convient — la porte des
//                    changements sensibles connaît les chemins de HIVE). Une
//                    reprise vise le dépôt de son projet : inutile de le
//                    redire, et le contredire est refusé.
//   --patience <s>   attente maximale d'une phase (1800 s)
//
// Codes de sortie : 0 PR ouverte avec son rapport (ou plan, sans --oui) ;
// 1 échec ; 64 mal appelé ; 75 arrêt à la porte — une validation humaine est
// attendue, puis `--reprendre` (75, EX_TEMPFAIL : « réessayez plus tard »).
//
// Ce fichier ne porte QUE le transport : la séquence, la porte et le rapport
// sont dans `boucle.ts`, `garde.ts` et `rapport.ts`, jugés sans processus.
// Le transport est volontairement ÉTROIT — cinq routes de la Reine et un
// commentaire GitHub. Un banc (`tests/boucle-v3.test.ts`) relit ce fichier :
// aucune route de fusion, de revue, d'autonomie, ni `forcer`, ne doit y entrer.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as attendre } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { creerCaviardeur, valeursSecretes } from '../shared/caviardage.js';
import { API_DEFAUT, entetes } from '../orchestrator/github.js';
import { argumentsDeLaBoucle, menerLaBoucle } from './boucle.js';
import type { GithubBoucle, Reponse, RucheBoucle } from './boucle.js';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;
const VALIDATION_ATTENDUE = 75;

const USAGE =
  'usage : npm run boucle:v3 -- --racine <dossier de la ruche> ' +
  '(--mission "<texte>" | --reprendre <projet>) [--oui] [--depot <url>] [--patience <s>]';

/** La vraie ruche, au-dessus de `fetch` ; une panne de transport devient un statut 0. */
function rucheReelle(base: string, jeton: string): RucheBoucle {
  const demander = async (chemin: string, init: RequestInit = {}): Promise<Reponse> => {
    try {
      const r = await fetch(base + chemin, init);
      const texte = await r.text();
      let corps: unknown = null;
      try {
        corps = JSON.parse(texte);
      } catch {
        corps = null;
      }
      return { status: r.status, corps, texte };
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code ?? String(e);
      return { status: 0, corps: null, texte: `la ruche ne répond plus (${chemin}) — ${cause}` };
    }
  };
  const lire = (chemin: string) => demander(chemin, { headers: { 'x-hive-token': jeton } });
  const poster = (chemin: string, corps: unknown) =>
    demander(chemin, {
      method: 'POST',
      headers: { 'x-hive-token': jeton, 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    });
  return {
    instantane: () => lire('/api/state'),
    lire,
    creerProjet: (corps) => poster('/api/projects', corps),
    creerTache: (projetId, tache) =>
      poster(`/api/projects/${encodeURIComponent(projetId)}/tasks`, { tasks: [tache] }),
    livrer: (taskId, resultId) => poster('/api/livraison', { taskId, resultId }),
    patienter: (ms) => attendre(ms),
  };
}

/** Le commentaire de la PR — la seule écriture GitHub de la boucle, avec la clé de l'hôte. */
function githubReel(api: string, jeton: string): GithubBoucle {
  return {
    async commenter(depot, pr, corps) {
      try {
        const r = await fetch(`${api}/repos/${depot}/issues/${pr}/comments`, {
          method: 'POST',
          headers: { ...entetes(jeton), 'content-type': 'application/json' },
          body: JSON.stringify({ body: corps }),
        });
        return { status: r.status };
      } catch {
        return { status: 0 };
      }
    },
  };
}

async function principal(): Promise<number> {
  const options = argumentsDeLaBoucle(process.argv.slice(2));
  if ('erreur' in options) {
    console.error(`✘ ${options.erreur}\n${USAGE}`);
    return MAL_APPELE;
  }
  let env: Record<string, string | undefined>;
  try {
    env = parseEnv(readFileSync(path.join(options.racine, '.env'), 'utf8'));
  } catch {
    console.error(`✘ aucun .env lisible dans ${options.racine}`);
    return ECHEC;
  }
  const jeton = env.HIVE_TOKEN ?? '';
  if (!jeton) {
    console.error('✘ .env sans HIVE_TOKEN : la boucle ne peut pas parler à la ruche');
    return ECHEC;
  }
  // Le jeton GitHub de l'HÔTE — celui de la Reine. Il ne sert qu'au
  // commentaire du rapport, et n'est jamais affiché.
  const jetonGithub = process.env.HIVE_GITHUB_TOKEN || env.HIVE_GITHUB_TOKEN || '';
  const api = process.env.HIVE_GITHUB_API || env.HIVE_GITHUB_API || API_DEFAUT;
  const caviardeur = creerCaviardeur(valeursSecretes({ ...env, HIVE_GITHUB_TOKEN: jetonGithub }));

  const issue = await menerLaBoucle(
    rucheReelle(`http://127.0.0.1:${env.HIVE_PORT ?? '7777'}`, jeton),
    jetonGithub ? githubReel(api, jetonGithub) : null,
    caviardeur,
    options,
  );
  // Tout ce qui s'imprime a pu citer une ouvrière : caviardé comme le rapport.
  const dire = (texte: string) => caviardeur.texte(texte);
  switch (issue.issue) {
    case 'plan':
      console.log(`… ${dire(issue.message)}`);
      return OK;
    case 'echec':
      console.error(`✘ ${dire(issue.raison)}`);
      return ECHEC;
    case 'refus_humain':
      console.error(`✘ ${dire(issue.message)}`);
      return ECHEC;
    case 'validation_requise':
      console.error(`⏸ ${dire(issue.message)}`);
      return VALIDATION_ATTENDUE;
    case 'livree':
      console.log(
        `${issue.rapport}\n\n✔ PR #${issue.pr} ouverte : ${issue.urlPr}\n${issue.detail}`,
      );
      return issue.commentaire === 'attache' ? OK : ECHEC;
  }
}

// `process.exitCode`, jamais `process.exit()` : sous Windows, couper la boucle
// avec un `fetch` en vol fait abandonner libuv (cf. scripts/essai-travail.mjs).
process.exitCode = await principal();
