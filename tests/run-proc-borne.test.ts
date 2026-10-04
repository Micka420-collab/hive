// `runProc` — la borne de temps tient, même contre la descendance d'une commande.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// `runProc` ne se résolvait qu'au `close` de l'enfant, et `close` attend que
// TOUS les détenteurs des tubes de sortie les aient lâchés. Le délai et
// l'annulation ne tuaient que l'enfant direct. Un serveur de test lancé en
// `stdio: 'inherit'` et oublié, un `cmd &`, un runner qui ignore SIGTERM — ou,
// sous Windows, n'importe quel script lancé par npm — gardaient la promesse
// pendante aussi longtemps qu'ils vivaient. Le nœud, qui attend les
// validations avant d'envoyer `task_result`, gardait la tâche pour toujours et
// finissait par refuser tout travail (`noeud_sature`).
//
// Chaque cas mesure donc une DURÉE, bornée bien en deçà de la vie du
// descendant (30 s) : sur l'ancien code, ils attendent sa mort.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GRACE_ARRET_MS } from '../src/shared/arbre-processus.js';
import { runProc } from '../src/node-client/merge-runner.js';

const dossiers: string[] = [];
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

/**
 * Un descendant qui tient la sortie et laisse une TRACE s'il vit encore après
 * `apresMs` : l'arbre a-t-il vraiment été arrêté, ou seulement l'enfant direct ?
 */
function temoin(apresMs: number): { script: string; trace: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-runproc-'));
  dossiers.push(dir);
  const trace = path.join(dir, 'survivant');
  const corps =
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(trace)}, ''), ${apresMs});` +
    'setTimeout(() => {}, 30000);';
  const script =
    "require('node:child_process').spawn(process.execPath, " +
    `['-e', ${JSON.stringify(corps)}], { stdio: 'inherit' });`;
  return { script, trace };
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Un descendant qui hérite des tubes de sortie, puis vit 30 s de lui-même.
 * `unref` : son parent peut finir sans l'attendre — c'est tout le piège.
 */
const ORPHELIN =
  "require('node:child_process').spawn(process.execPath, " +
  "['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' }).unref();";

const node = (script: string): string[] => [process.execPath, '-e', script];
/** Le strict nécessaire : sous Windows, Node veut `SYSTEMROOT`. */
const ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT };

/** Au-delà : la borne n'a pas tenu. Large devant la grâce, petit devant 30 s. */
const MARGE_MS = 6_000;

async function chrono<T>(geste: () => Promise<T>): Promise<{ r: T; ms: number }> {
  const debut = Date.now();
  const r = await geste();
  return { r, ms: Date.now() - debut };
}

describe('runProc — une borne qui tient contre la descendance', () => {
  it('une commande SORTIE dont un descendant tient la sortie rend la main, avec son vrai code', async () => {
    const { r, ms } = await chrono(() =>
      runProc(node(`${ORPHELIN} console.log('fini');`), process.cwd(), ENV, 60_000),
    );

    expect(ms).toBeLessThan(GRACE_ARRET_MS + MARGE_MS);
    // Le code est celui de la commande : elle a fini d'elle-même, rien n'a
    // été arrêté — c'est un verdict, pas un `arret`.
    expect(r.code).toBe(0);
    expect(r.arret).toBeUndefined();
    expect(r.output).toContain('fini');
  }, 40_000);

  it('délai dépassé : TOUT l’arbre est arrêté, y compris ce qui ignore SIGTERM', async () => {
    const script = `${ORPHELIN} process.on('SIGTERM', () => {}); ` + 'setTimeout(() => {}, 30000);';
    const { r, ms } = await chrono(() => runProc(node(script), process.cwd(), ENV, 1_000));

    expect(ms).toBeLessThan(1_000 + 2 * GRACE_ARRET_MS + MARGE_MS);
    expect(r.arret).toBe('delai');
    expect(r.output).toContain('[hive] timeout après 1000 ms');
  }, 40_000);

  it('une annulation arrête TOUT l’arbre, pas seulement l’enfant direct', async () => {
    // L'ancien code rendait bien la main à l'annulation — en tuant npm seul.
    // Le runner qu'il avait lancé continuait sur la machine du membre, une
    // tâche annulée plus tard encore au travail : la trace le montre.
    const { script, trace } = temoin(3_000);
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 1_000);
    const { r, ms } = await chrono(() =>
      runProc(
        node(`${script} setTimeout(() => {}, 30000);`),
        process.cwd(),
        ENV,
        60_000,
        ctrl.signal,
      ),
    );
    clearTimeout(minuteur);

    expect(ms).toBeLessThan(1_000 + 2 * GRACE_ARRET_MS + MARGE_MS);
    expect(r.arret).toBe('annule');
    await attendre(3_500);
    expect(existsSync(trace), 'un descendant a survécu à l’annulation').toBe(false);
  }, 40_000);

  it('une sortie géante garde son DÉBUT et sa FIN — le résumé des échecs s’imprime en dernier', async () => {
    // ~1,2 Mo de lignes, au-delà des 512 Kio du plafond, puis un résumé.
    const script =
      "const l = 'x'.repeat(99) + '\\n'; " +
      "process.stdout.write('DEBUT\\n'); " +
      'for (let i = 0; i < 12000; i++) process.stdout.write(l); ' +
      "process.stdout.write('RESUME : 3 tests en échec\\n');";
    const r = await runProc(node(script), process.cwd(), ENV, 60_000);

    expect(r.code).toBe(0);
    expect(r.output.startsWith('DEBUT')).toBe(true);
    expect(r.output.trimEnd().endsWith('RESUME : 3 tests en échec')).toBe(true);
    expect(r.output).toMatch(/\[hive\] … \d+ caractères omis …/);
    expect(r.output.length).toBeLessThan(600 * 1024);
  }, 40_000);
});
