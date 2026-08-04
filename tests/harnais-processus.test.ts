// LE HARNAIS QUI REPREND LES PROCESSUS — éprouvé sur de vrais processus.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Un relevé pris cette nuit sur le conteneur : 40 processus node survivants,
// jusqu'à 1 070 s d'âge — orchestrateurs de ruche, clients de nœud, serveurs
// `vite` — plusieurs à 35-40 % de CPU. Charge 13,18 sur 4 cœurs. Personne ne
// les avait lancés depuis dix-sept minutes.
//
// Ils venaient des trois bancs qui lancent de VRAIS processus. Ceux-ci tuent
// le processus lancé en SIGKILL — le signal qui ne lui laisse aucune chance de
// reprendre SA propre descendance —, et bornaient leurs attentes par des
// minuteurs `unref()`, qui ne se déclenchent jamais si le worker s'éteint
// d'abord. Le filet était posé à l'endroit exact où il ne pouvait pas servir.
//
// ─── POURQUOI CES TESTS EXISTENT, ET PAS SEULEMENT LE CORRECTIF ──────────────
//
// Le carnet le dit (§ 2 sexdecies) : une correction appliquée partout n'est pas
// une correction TENUE. Sans banc, rien n'empêche le quatrième fichier qui
// lancera un processus de le faire au `spawn` nu — et la fuite reviendrait,
// invisible, en dégradant la suite entière au lieu de faire rougir un test.
//
// Le petit-enfant est le cœur de l'affaire : c'est LUI qui survivait. Les tests
// ci-dessous en fabriquent donc un vrai, et vérifient qu'il meurt.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupesRetenus, lancerBorne, reprendreTous, tuerGroupe } from './harnais-processus.js';

const POSIX = process.platform !== 'win32';

let racine = '';
afterEach(() => {
  reprendreTous();
  if (racine) rmSync(racine, { recursive: true, force: true });
  racine = '';
});

/**
 * Un père qui engendre un fils, puis annonce les deux pid et ne meurt jamais.
 *
 * C'est la forme exacte du lanceur de la ruche : il démarre un hub, un nœud et
 * un `vite`, puis attend. Tuer le père seul laissait le fils tourner.
 */
function pereEtFils(): string {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-harnais-'));
  const fils = path.join(racine, 'fils.mjs');
  writeFileSync(
    fils,
    `setInterval(() => {}, 1000);\nconsole.log('FILS ' + process.pid);\n`,
    'utf8',
  );
  const pere = path.join(racine, 'pere.mjs');
  writeFileSync(
    pere,
    `import { spawn } from 'node:child_process';\n` +
      `const f = spawn(process.execPath, [${JSON.stringify(fils)}], { stdio: 'inherit' });\n` +
      `console.log('PERE ' + process.pid);\n` +
      `setInterval(() => {}, 1000);\n`,
    'utf8',
  );
  return pere;
}

/** Ce pid est-il encore vivant ? (le signal 0 ne tue pas, il interroge) */
function vivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Attend que la condition tienne, ou rend faux — jamais d'attente non bornée. */
async function jusqua(condition: () => boolean, msMax = 5_000): Promise<boolean> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return condition();
}

/** Lance le père, attend les deux annonces, rend les deux pid. */
async function deuxGenerations(): Promise<{
  proc: ReturnType<typeof lancerBorne>;
  pere: number;
  fils: number;
}> {
  const proc = lancerBorne(process.execPath, [pereEtFils()], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let vu = '';
  proc.stdout?.on('data', (m: Buffer) => (vu += m.toString('utf8')));
  proc.stderr?.on('data', (m: Buffer) => (vu += m.toString('utf8')));
  const pret = await jusqua(() => /PERE \d+/.test(vu) && /FILS \d+/.test(vu), 20_000);
  expect(pret, `les deux générations doivent s’annoncer :\n${vu}`).toBe(true);
  return {
    proc,
    pere: Number(/PERE (\d+)/.exec(vu)?.[1]),
    fils: Number(/FILS (\d+)/.exec(vu)?.[1]),
  };
}

describe('reprendre ce qu’un banc a lancé', () => {
  it.runIf(POSIX)(
    'TUER LE GROUPE EMPORTE LE PETIT-ENFANT — c’est LUI qui survivait',
    async () => {
      const { proc, pere, fils } = await deuxGenerations();
      expect(vivant(pere), 'le père vit').toBe(true);
      expect(vivant(fils), 'le fils vit').toBe(true);
      expect(fils, 'ce sont bien deux processus distincts').not.toBe(pere);

      tuerGroupe(proc);

      expect(await jusqua(() => !vivant(pere)), 'le père meurt').toBe(true);
      // LA garde. Un `proc.kill()` ordinaire laisserait celui-ci tourner pour
      // toujours — c'est exactement ce qui remplissait le conteneur.
      expect(await jusqua(() => !vivant(fils)), 'et le fils AUSSI').toBe(true);
    },
    30_000,
  );

  it.runIf(POSIX)(
    'LE FILET DE FIN DE TEST REPREND CE QUE PERSONNE N’A TUÉ',
    async () => {
      // Le cas réel : un test échoue ou laisse sa promesse pendante, donc
      // aucun `tuerGroupe` n'est appelé. `reprendreTous`, lui, est posé en
      // `afterEach` sans condition.
      const { pere, fils } = await deuxGenerations();
      expect(groupesRetenus(), 'le harnais retient ce groupe').toBeGreaterThan(0);

      reprendreTous();

      expect(await jusqua(() => !vivant(pere)), 'le père est repris').toBe(true);
      expect(await jusqua(() => !vivant(fils)), 'le fils est repris').toBe(true);
      expect(groupesRetenus(), 'et le harnais ne retient plus rien').toBe(0);
    },
    30_000,
  );

  it.runIf(POSIX)(
    'UN PROCESSUS QUI MEURT SEUL EST OUBLIÉ — le harnais ne s’accumule pas',
    async () => {
      // Sans cet oubli, `reprendreTous` finirait par signaler des pid recyclés
      // par le système : on tuerait un processus étranger. Le remède serait
      // pire que la fuite.
      const avant = groupesRetenus();
      const proc = lancerBorne(process.execPath, ['-e', 'process.exit(0)']);
      await new Promise((r) => proc.on('close', r));
      expect(await jusqua(() => groupesRetenus() === avant), 'le compte revient').toBe(true);
    },
    30_000,
  );

  it.runIf(POSIX)(
    'UN PÈRE QUI MEURT SEUL N’EMPORTE PAS SON FILS — le harnais balaie quand même',
    async () => {
      // C'est LA panne, dans sa forme la plus pure : le père s'en va, le fils
      // reste. Si le harnais oubliait le groupe à la mort du chef — le réflexe
      // évident — il rouvrirait le trou qu'il existe pour boucher, et ce banc
      // serait le seul à le voir.
      racine = mkdtempSync(path.join(os.tmpdir(), 'hive-harnais-'));
      const fils = path.join(racine, 'fils.mjs');
      writeFileSync(
        fils,
        `setInterval(() => {}, 1000);\nconsole.log('FILS ' + process.pid);\n`,
        'utf8',
      );
      const pere = path.join(racine, 'pere-fugace.mjs');
      writeFileSync(
        pere,
        `import { spawn } from 'node:child_process';\n` +
          `spawn(process.execPath, [${JSON.stringify(fils)}], { stdio: 'inherit' });\n` +
          // Le père s'efface après avoir engendré : sa mort est NORMALE, elle
          // ne doit pas valoir quitus pour sa descendance.
          `setTimeout(() => process.exit(0), 300);\n`,
        'utf8',
      );

      const proc = lancerBorne(process.execPath, [pere], { stdio: ['ignore', 'pipe', 'pipe'] });
      let vu = '';
      proc.stdout?.on('data', (m: Buffer) => (vu += m.toString('utf8')));
      expect(await jusqua(() => /FILS \d+/.test(vu), 20_000), `le fils s’annonce :\n${vu}`).toBe(
        true,
      );
      const pidFils = Number(/FILS (\d+)/.exec(vu)?.[1]);

      // On attend la mort NATURELLE du père — personne ne l'a tué.
      await new Promise((r) => proc.on('close', r));

      expect(await jusqua(() => !vivant(pidFils)), 'le fils est balayé malgré tout').toBe(true);
      expect(groupesRetenus(), 'et le groupe n’est plus retenu (pas d’accumulation)').toBe(0);
    },
    30_000,
  );

  it('REPRENDRE QUAND IL N’Y A RIEN NE LÈVE PAS — un filet ne doit jamais casser la fin d’un test', () => {
    reprendreTous();
    expect(() => reprendreTous()).not.toThrow();
    expect(groupesRetenus()).toBe(0);
  });

  it.runIf(POSIX)(
    'TUER DEUX FOIS NE LÈVE PAS — le second geste tombe sur un groupe déjà éteint',
    async () => {
      const { proc, pere } = await deuxGenerations();
      tuerGroupe(proc);
      expect(await jusqua(() => !vivant(pere))).toBe(true);
      expect(() => tuerGroupe(proc), 'le second coup est sans effet, pas une erreur').not.toThrow();
    },
    30_000,
  );
});
