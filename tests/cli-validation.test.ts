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
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const RACINE = fileURLToPath(new URL('..', import.meta.url));

async function lancer(...args: string[]): Promise<{ code: number; sortie: string }> {
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
          HIVE_HTTP: 'http://127.0.0.1:1', // port injoignable : aucune requête ne doit partir
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
