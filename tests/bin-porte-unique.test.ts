// `hive` — le point d'entrée du paquet npm, jamais lancé par un test.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// `src/bin.ts` fait une chose inhabituelle et le déclare : il RÉÉCRIT
// `process.argv` avant de charger le script de la sous-commande — « le SEUL
// endroit du dépôt qui se permet ça ». Une promesse pareille se vérifie en
// PASSANT PAR LA PORTE : on lance `hive cli state` et on exige le comportement
// de `cli.ts` recevant `state`, pas celui de `cli.ts` recevant `cli state`.
// Les deux issues s'impriment différemment — c'est ce qui rend la réécriture
// mutable-détectable.
//
// Et la table des sous-commandes ↔ l'aide : deux sources maintenues à la main
// dans le même fichier, le couple exact qui diverge en silence (le dispatch du
// CLI avait le même défaut latent, et l'usage portait un crochet fautif que
// personne n'avait vu).

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { CODE } from '../src/codes-sortie.js';
import { nodeSuffisant } from '../src/installer.js';
import { portLibre } from './harnais-bouchon.js';

const execFileAsync = promisify(execFile);
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const BIN = path.join(RACINE, 'src', 'bin.ts');
const TSX = path.join(RACINE, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossier(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'ruche-bin-'));
  aNettoyer.push(d);
  return d;
}

/** Passe par la porte pour de vrai — cwd jetable, réseau condamné. */
async function lancer(...args: string[]): Promise<{ code: number; sortie: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1' };
  for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
  env.HIVE_TOKEN = 'jeton-de-test-suffisamment-long';
  env.HIVE_HTTP = 'http://127.0.0.1:1';
  env.HIVE_AGENT = 'shell';
  env.HIVE_ISOLEMENT = 'off';
  // Ce banc vérifie le dispatch `hive` → installeur, pas la porte 7777.
  // La laisser implicite le mettait en concurrence avec les tests qui
  // occupent volontairement le port par défaut : vert seul, rouge en suite.
  env.HIVE_PORT = String(await portLibre());
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [TSX, BIN, ...args], {
      cwd: dossier(),
      encoding: 'utf8',
      timeout: 60_000,
      env,
    });
    return { code: 0, sortie: `${stdout}${stderr}` };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('hive — la porte unique du paquet npm', () => {
  it('--help LISTE LES QUATRE SOUS-COMMANDES, et sort en 0', async () => {
    const r = await lancer('--help');
    expect(r.code).toBe(0);
    for (const c of ['join', 'install', 'node', 'cli']) {
      expect(r.sortie, `« hive ${c} » a disparu de l’aide`).toContain(`hive ${c}`);
    }
  });

  it('LA TABLE ET L’AIDE NE PEUVENT PAS DIVERGER — comptées, puis confrontées', async () => {
    // La table, parsée de la source (repère compté — § 2 duodecies) ; l'aide,
    // IMPRIMÉE par le vrai processus. Une sous-commande ajoutée à la table et
    // pas à l'aide devient une porte secrète ; l'inverse, une promesse morte.
    const source = readFileSync(BIN, 'utf8');
    const decl = /const SOUS_COMMANDES = \[([^\]]+)\]/.exec(source);
    expect(decl, 'la déclaration SOUS_COMMANDES a changé de forme — relire').not.toBeNull();
    const table = [...(decl?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string);
    expect(table.length, 'le parseur de la table ne voit plus rien').toBeGreaterThanOrEqual(4);

    const { sortie } = await lancer('--help');
    const annoncees = [...sortie.matchAll(/^ {2}hive ([a-z]+)/gm)].map((m) => m[1] as string);
    expect([...table].sort(), 'table ≠ aide — l’une des deux a bougé seule').toEqual(
      [...annoncees].sort(),
    );
  });

  it('UNE COMMANDE INCONNUE EST REFUSÉE EN LE DISANT — aide comprise, code 1', async () => {
    const r = await lancer('commande-inconnue');
    expect(r.code).toBe(1);
    expect(r.sortie).toContain('commande inconnue');
    expect(r.sortie, 'le refus doit embarquer l’aide').toContain('hive join');
  });

  it('LA RÉÉCRITURE D’ARGV EST RÉELLE : « hive cli state » atteint cli AVEC state', async () => {
    // ─── POURQUOI « state » ET PAS « cli » TOUT COURT ───────────────────────
    //
    // Sans réécriture, `cli.ts` recevrait `['cli', 'state']`, prendrait « cli »
    // pour la commande, ne la reconnaîtrait pas, et rendrait l'USAGE. Avec la
    // réécriture, il reçoit `['state']` et tente la requête — que le réseau
    // condamné transforme en « Ruche injoignable ». Les deux issues sont
    // disjointes : c'est le seul choix d'argument qui rend la réécriture
    // observable.
    //
    // L'ancre était « Erreur : » ; elle a bougé le jour où ce message est
    // devenu un vrai diagnostic (adresse visée, variable, cause). Ce qu'on
    // affirme n'a pas changé — cli a TENTÉ la requête au lieu d'imprimer
    // l'usage —, seul le mot qui le prouve a changé.
    const r = await lancer('cli', 'state');
    expect(r.code).toBe(1);
    expect(r.sortie, 'cli n’a pas reçu « state » — la réécriture d’argv a bougé').toContain(
      'Ruche injoignable',
    );
    expect(r.sortie, 'cli a pris « cli » pour la commande').not.toContain('Usage :');
  });

  it('« hive join <difforme> » atteint join avec l’argument', async () => {
    const r = await lancer('join', 'ceci-nest-pas-un-billet');
    expect(r.code).toBe(1);
    expect(r.sortie).toContain('Invitation invalide');
  });

  it('SANS SOUS-COMMANDE, LES DRAPEAUX VONT À L’INSTALLEUR — la promesse de l’aide', async () => {
    // « Sans argument, hive installe et configure » — et les drapeaux aussi :
    // `hive --dry-run` doit être `hive install --dry-run`. Sous un Node trop
    // vieux, l'installeur s'arrête à sa porte (code PREREQUIS) : c'est ENCORE
    // une preuve que l'installeur a été atteint, pas une excuse pour sauter.
    const r = await lancer('--dry-run');
    if (nodeSuffisant(process.version)) {
      expect(r.code, `sortie :\n${r.sortie}`).toBe(0);
      expect(r.sortie).toContain('rien n’a été écrit');
    } else {
      expect(r.code, 'l’installeur n’a pas été atteint').toBe(CODE.PREREQUIS);
      expect(r.sortie).toContain('minimum');
    }
  });
});
