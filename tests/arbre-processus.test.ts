// L'ARBRE D'UN AGENT — arrêté en entier, sur les trois systèmes.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// `runCommand` (le seul `spawn` des adaptateurs d'agents) ne tuait que l'enfant
// DIRECT : `child.kill()` au délai, le `signal` de `spawn` à l'annulation. Or un
// agent lance des processus — ses serveurs MCP, ses shells, les commandes qu'il
// exécute. Mesuré ici, avant correctif :
//
//   · une tâche ANNULÉE laissait l'agent (s'il ignorait SIGTERM) et son
//     petit-enfant tourner, et rendait `infra: true` avec « échec du lancement
//     de … » — le nœud y lisait un binaire absent et ouvrait une réquisition
//     « Binaire … introuvable » pour une tâche qu'un humain venait d'annuler ;
//   · une tâche EXPIRÉE dont l'agent ignorait SIGTERM ne rendait jamais la
//     main ;
//   · un agent SORTI en laissant un descendant sur sa sortie gardait la tâche
//     pendue aussi longtemps que ce descendant vivait.
//
// ─── POURQUOI SUR LES TROIS SYSTÈMES ─────────────────────────────────────────
//
// Les deux mécanismes n'ont rien en commun : un groupe de processus et
// `kill(-pid)` sous POSIX, `taskkill /T /F` sous Windows. Un banc réservé à
// Linux prouverait le premier et laisserait le second sur parole. Aucun cas
// n'est donc filtré par plateforme, sauf ce que Windows ne PEUT pas faire — et
// ce cas-là est dit, pas tu (voir le troisième).

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LIGNE_ANNULATION, runCommand } from '../src/adapters/exec.js';
import type { AdapterContext } from '../src/adapters/index.js';
import type { AdapterResult } from '../src/adapters/index.js';
import { arbresEteints, GRACE_ARRET_MS, lancerArbre } from '../src/shared/arbre-processus.js';
import { processusVivant, reprendreTous, retenirPid } from './harnais-processus.js';

const POSIX = process.platform !== 'win32';
/** Au-delà : la borne n'a pas tenu. Large devant la grâce, petit devant la vie du témoin. */
const MARGE_MS = 8_000;

const dossiers: string[] = [];
afterEach(() => {
  // Le filet D'ABORD, sans condition : c'est quand un cas échoue que l'agent
  // ou son petit-enfant survit — exactement le défaut que le banc chasse. Les
  // pid annoncés sont relus ici : un cas qui a échoué avant de les lire ne
  // laisse pas son témoin tourner.
  for (const d of dossiers) pids(d);
  reprendreTous();
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

/**
 * Un faux agent : il écrit son pid, lance un PETIT-ENFANT qui écrit le sien et
 * hérite de la sortie (c'est lui qui tenait les tubes), puis travaille « pour
 * toujours ». `ignoreSigterm` : comme un runner mal élevé — seul SIGKILL (ou
 * `taskkill /F`) l'arrête. `sortir` : il rend la main aussitôt, en laissant son
 * petit-enfant derrière lui.
 */
function fauxAgent(opts: { ignoreSigterm?: boolean; sortir?: boolean }): {
  dossier: string;
  script: string;
} {
  const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-arbre-'));
  dossiers.push(dossier);
  const trace = (prefixe: string): string =>
    `require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(dossier)}, ` +
    `'${prefixe}-' + process.pid), '');`;
  const petit = `${trace('petit')} setInterval(() => {}, 1000);`;
  // Sorti, l'agent n'attend pas son petit-enfant (`unref`) — mais il attend
  // qu'il se soit ANNONCÉ : sinon le banc ne saurait pas qui surveiller.
  const sortie =
    'const attente = setInterval(() => {' +
    `  if (require('node:fs').readdirSync(${JSON.stringify(dossier)}).some((n) => n.startsWith('petit-'))) {` +
    "    clearInterval(attente); console.log('fini');" +
    '  }' +
    '}, 20);';
  const script =
    `${trace('agent')}` +
    "const petit = require('node:child_process').spawn(process.execPath, " +
    `['-e', ${JSON.stringify(petit)}], { stdio: 'inherit' });` +
    (opts.ignoreSigterm ? " process.on('SIGTERM', () => {});" : '') +
    (opts.sortir ? ` petit.unref(); ${sortie}` : ' setInterval(() => {}, 1000);');
  return { dossier, script };
}

/** Les pid qu'un faux agent a écrits, retenus pour le filet dès qu'ils paraissent. */
function pids(dossier: string): { agent: number[]; petit: number[] } {
  const noms = readdirSync(dossier);
  const lire = (prefixe: string): number[] =>
    noms.filter((n) => n.startsWith(`${prefixe}-`)).map((n) => Number(n.slice(prefixe.length + 1)));
  const r = { agent: lire('agent'), petit: lire('petit') };
  for (const pid of [...r.agent, ...r.petit]) retenirPid(pid);
  return r;
}

/** Scrute une condition jusqu'à l'échéance — l'asynchrone s'attend, il ne s'affirme pas. */
async function jusqua(condition: () => boolean, msMax: number): Promise<boolean> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return condition();
}

/** La promesse, ou `null` à l'échéance : un banc qui pend ne dit rien. */
function borne<T>(promesse: Promise<T>, msMax: number): Promise<T | null> {
  return Promise.race([
    promesse,
    new Promise<null>((r) => setTimeout(() => r(null), msMax).unref()),
  ]);
}

/** Le strict nécessaire : sous Windows, Node veut `SYSTEMROOT`. */
function ctx(signal: AbortSignal): AdapterContext {
  return {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
    attempt: 1,
    signal,
    onProgress: () => {},
  };
}

async function lancementComplet(dossier: string): Promise<{ agent: number[]; petit: number[] }> {
  const vu = await jusqua(() => {
    const p = pids(dossier);
    return p.agent.length === 1 && p.petit.length === 1;
  }, 20_000);
  expect(vu, 'le faux agent et son petit-enfant auraient dû démarrer').toBe(true);
  return pids(dossier);
}

describe('runCommand — l’arbre de l’agent, pas seulement l’agent', () => {
  it('une ANNULATION arrête l’agent ET son petit-enfant, et n’est pas une panne d’infrastructure', async () => {
    const { dossier, script } = fauxAgent({ ignoreSigterm: true });
    const ctrl = new AbortController();
    const course = runCommand(process.execPath, ['-e', script], ctx(ctrl.signal), 60_000);
    const { agent, petit } = await lancementComplet(dossier);

    const debut = Date.now();
    ctrl.abort();
    const r = await borne(course, 2 * GRACE_ARRET_MS + MARGE_MS);
    expect(r, 'la tâche annulée n’a jamais rendu la main').not.toBeNull();
    expect(Date.now() - debut).toBeLessThan(2 * GRACE_ARRET_MS + MARGE_MS);
    const res = r as AdapterResult;
    expect(res.success).toBe(false);
    // Une annulation n'est ni un binaire absent, ni une panne d'identifiants :
    // lue comme telle, elle ouvrait une réquisition dans la Chambre.
    expect(res.infra, res.logs).toBeUndefined();
    expect(res.logs).toContain(LIGNE_ANNULATION);
    expect(res.logs).not.toContain('échec du lancement');

    const eteints = await jusqua(() => ![...agent, ...petit].some(processusVivant), 5_000);
    expect(
      eteints,
      `survivants après l’annulation : agent ${agent.filter(processusVivant).join(',')} ` +
        `petit-enfant ${petit.filter(processusVivant).join(',')}`,
    ).toBe(true);
  }, 60_000);

  it('un DÉLAI dépassé arrête tout l’arbre — même ce qui ignore SIGTERM — et rend la main', async () => {
    const { dossier, script } = fauxAgent({ ignoreSigterm: true });
    const ctrl = new AbortController();
    const debut = Date.now();
    const course = runCommand(process.execPath, ['-e', script], ctx(ctrl.signal), 3_000);
    const { agent, petit } = await lancementComplet(dossier);

    const r = await borne(course, 3_000 + 2 * GRACE_ARRET_MS + MARGE_MS);
    expect(r, 'la tâche expirée n’a jamais rendu la main').not.toBeNull();
    expect(Date.now() - debut).toBeLessThan(3_000 + 2 * GRACE_ARRET_MS + MARGE_MS);
    const res = r as AdapterResult;
    expect(res.success).toBe(false);
    expect(res.logs).toContain('[hive] timeout après 3000 ms');
    const eteints = await jusqua(() => ![...agent, ...petit].some(processusVivant), 5_000);
    expect(eteints, 'un processus de l’arbre a survécu au délai').toBe(true);
  }, 60_000);

  it('un agent SORTI qui laisse un descendant sur sa sortie rend la main avec son vrai code', async () => {
    const { dossier, script } = fauxAgent({ sortir: true });
    const debut = Date.now();
    const r = await borne(
      runCommand(process.execPath, ['-e', script], ctx(new AbortController().signal), 60_000),
      GRACE_ARRET_MS + MARGE_MS,
    );
    expect(r, 'la tâche attendait la mort du petit-enfant').not.toBeNull();
    expect(Date.now() - debut).toBeLessThan(GRACE_ARRET_MS + MARGE_MS);
    const res = r as AdapterResult;
    // Sa réussite est la sienne : rien ne l'a arrêté.
    expect(res.success, res.logs).toBe(true);
    expect(res.logs).toContain('fini');

    const { petit } = pids(dossier);
    expect(petit).toHaveLength(1);
    if (POSIX) {
      // Sous POSIX, le groupe survit à son chef : ce qu'il laisse n'a plus de
      // propriétaire, et part avec lui.
      const eteint = await jusqua(() => !petit.some(processusVivant), 5_000);
      expect(eteint, 'le petit-enfant d’un agent sorti a survécu').toBe(true);
    } else {
      // Sous Windows, le pid d'un agent sorti est libéré : `taskkill /T`
      // abattrait l'arbre d'un inconnu. On cesse d'attendre, on ne tue rien —
      // la limite est dite (`arbre-processus.ts`), et le filet reprend le témoin.
      expect(res.logs).toContain('la sortie est restée ouverte');
    }
  }, 60_000);

  it('une tâche déjà annulée ne lance rien', async () => {
    const { dossier, script } = fauxAgent({});
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await runCommand(process.execPath, ['-e', script], ctx(ctrl.signal), 60_000);
    expect(r.success).toBe(false);
    expect(r.infra).toBeUndefined();
    expect(r.logs).toBe(LIGNE_ANNULATION);
    await new Promise((res) => setTimeout(res, 500));
    expect(readdirSync(dossier), 'un processus est parti pour une tâche déjà annulée').toEqual([]);
  });
});

describe('arbresEteints — l’attente bornée d’un nœud qui s’arrête', () => {
  it('rend la main dès que le dernier arbre s’éteint, bien avant sa borne', async () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-arbre-'));
    dossiers.push(dossier);
    const ctrl = new AbortController();
    const fini = new Promise<void>((resolve) => {
      lancerArbre(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        {
          cwd: dossier,
          env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
          stdio: 'ignore',
        },
        { delaiMs: 60_000, signal: ctrl.signal },
        () => resolve(),
      );
    });
    const debut = Date.now();
    const attente = arbresEteints(30_000);
    ctrl.abort();
    await attente;
    // Arrêté par SIGTERM (POSIX) ou `taskkill /F` : il s'éteint vite, et
    // l'attente le sait sans courir jusqu'à ses 30 s.
    expect(Date.now() - debut).toBeLessThan(GRACE_ARRET_MS + MARGE_MS);
    await fini;
  }, 40_000);

  it('sans arbre vivant, rend la main aussitôt', async () => {
    const debut = Date.now();
    await arbresEteints(30_000);
    expect(Date.now() - debut).toBeLessThan(1_000);
  });
});
