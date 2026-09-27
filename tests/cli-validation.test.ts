// Validation des arguments numériques du CLI — `replay` et `events`.
//
// ─── CE QUE CE FICHIER PROUVE, ET QUI NE SE DEVINE PAS ───────────────────────
//
// `cmdReplay` et `cmdEvents` convertissent `sinceId` via `Number()`. Si
// l'utilisateur tape `hive replay abc`, `Number('abc')` produit `NaN`, qui
// se retrouve dans l'URL (`?since=NaN`). Le serveur répond 400, et le CLI
// affiche une erreur cryptique au lieu d'un message clair.
//
// Ce test vérifie que le CLI valide `sinceId` AVANT d'appeler l'API : il
// affiche un message lisible et positionne `process.exitCode = 1` sans
// aucune requête réseau.

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const RACINE = fileURLToPath(new URL('..', import.meta.url));

async function lancer(...args: string[]): Promise<{ code: number; sortie: string }> {
  return lancerVers('http://127.0.0.1:1', ...args); // port injoignable : aucune requête ne doit partir
}

async function lancerVers(
  hiveHttp: string,
  ...args: string[]
): Promise<{ code: number; sortie: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', ...args],
      {
        cwd: RACINE,
        encoding: 'utf8',
        env: {
          ...process.env,
          NO_COLOR: '1',
          HIVE_TOKEN: 'jeton-test-suffisamment-long',
          HIVE_HTTP: hiveHttp,
        },
      },
    );
    return { code: 0, sortie: `${stdout}${stderr}` };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('CLI : validation des arguments numériques', () => {
  it("replay refuse un sinceId non numérique sans appeler l'API", async () => {
    const r = await lancer('replay', 'abc');
    expect(r.sortie).toMatch(/invalide/i);
    expect(r.sortie).not.toMatch(/ECONNREFUSED|fetch|NaN/i);
  });

  it('replay refuse un sinceId négatif', async () => {
    const r = await lancer('replay', '-5');
    expect(r.sortie).toMatch(/invalide/i);
    expect(r.sortie).not.toMatch(/ECONNREFUSED|fetch/i);
  });

  it("events refuse un sinceId non numérique sans appeler l'API", async () => {
    const r = await lancer('events', 'xyz');
    expect(r.sortie).toMatch(/invalide/i);
    expect(r.sortie).not.toMatch(/ECONNREFUSED|fetch|NaN/i);
  });

  it('replay accepte un sinceId numérique valide (0)', async () => {
    // sinceId=0 est valide : la requête partira, mais le port 1 est injoignable.
    // On vérifie juste que le CLI ne refuse PAS en local.
    const r = await lancer('replay', '0');
    expect(r.sortie).not.toMatch(/invalide/i);
  });
});

// ─── `--forcer` : la raison d'un geste qui passe outre l'Evaluator ───────────
//
// Seule la forme `--forcer=raison` était reconnue. `livrer T --forcer "x"`
// envoyait donc `--forcer` comme BRANCHE DE BASE de la pull request : GitHub
// échouait, et la livraison « échouée » rangée bloquait la tâche jusqu'à un
// nettoyage à la main. `fusionner P 12 --forcer "x"` retombait en `squash`
// sans forçage et reprenait le même 409, sans rien dire.
describe('CLI : --forcer, et rien d’autre', () => {
  it('--forcer sans raison, ou une option inconnue, est refusé AVANT d’appeler la ruche', async () => {
    for (const args of [
      ['livrer', 'T1', '--forcer'],
      ['livrer', 'T1', '--forcer', '--autre'],
      ['livrer', 'T1', '--base=dev'],
      ['fusionner', 'P1', '12', '--force=oui'],
    ]) {
      const r = await lancer(...args);
      expect(r.code, args.join(' ')).not.toBe(0);
      expect(r.sortie, args.join(' ')).toMatch(/--forcer attend une raison|option inconnue/);
      expect(r.sortie, args.join(' ')).not.toMatch(/injoignable|ECONNREFUSED|fetch failed/i);
    }
  });

  it('« --forcer raison » (avec une espace) part comme « --forcer=raison »', async () => {
    const corps: unknown[] = [];
    const faux = createServer((req, res) => {
      let brut = '';
      req.on('data', (c: Buffer) => (brut += c.toString('utf8')));
      req.on('end', () => {
        corps.push(JSON.parse(brut) as unknown);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            req.url === '/api/livraison'
              ? { pr: 3, urlPr: 'https://exemple.test/pr/3', branche: 'hive/T1', fichiers: [] }
              : { fusionnee: true, sha: 'abcdef0123456789' },
          ),
        );
      });
    });
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(faux.address() as { port: number }).port}`;
      const livrer = await lancerVers(url, 'livrer', 'T1', '--forcer', 'faux positif, relu');
      expect(livrer.code, livrer.sortie).toBe(0);
      const fusion = await lancerVers(url, 'fusionner', 'P1', '12', '--forcer', 'relue à la main');
      expect(fusion.code, fusion.sortie).toBe(0);
    } finally {
      await new Promise<void>((r) => faux.close(() => r()));
    }
    expect(corps).toEqual([
      { taskId: 'T1', forcer: { raison: 'faux positif, relu' } },
      { projectId: 'P1', pr: 12, methode: 'squash', forcer: { raison: 'relue à la main' } },
    ]);
  });
});
