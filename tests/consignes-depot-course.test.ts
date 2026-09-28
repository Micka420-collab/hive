// La relecture des consignes ne suit pas un lien posé APRÈS son parcours.
//
// `consignesDuDepot` vérifie chaque composant du chemin par `lstat`, puis
// ouvre le fichier. Entre les deux, le chemin peut changer : un fichier
// ordinaire remplacé par un lien vers `~/.ssh/id_ed25519`. `openSync(…, 'r')`
// suivait ce lien et lisait le secret du membre, que le bloc envoyait au
// modèle. L'ouverture est maintenant `O_NOFOLLOW`, et c'est le descripteur
// ouvert qui doit être un fichier ordinaire.
//
// La course se simule sans minuterie : `lstatSync` rend, pour le chemin
// piégé, ce qu'il y AVAIT au parcours — un fichier ordinaire — alors que le
// lien est déjà là à l'ouverture. Fichier à part : `vi.mock` vaut pour tout le
// fichier de test.

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type * as Fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Les chemins dont `lstatSync` rend l'état d'AVANT l'échange : un fichier ordinaire. */
const echanges = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  const lstatSync = ((chemin: Fs.PathLike, ...reste: unknown[]) => {
    const avant = echanges.get(String(chemin));
    return avant === undefined
      ? (fs.lstatSync as (...a: unknown[]) => unknown)(chemin, ...reste)
      : fs.lstatSync(avant);
  }) as typeof fs.lstatSync;
  return { ...fs, default: { ...fs, lstatSync }, lstatSync };
});

const { CONSIGNES_CLAUDE, CONSIGNES_CODEX, consignesDuDepot } =
  await import('../src/adapters/consignes-depot.js');

const aNettoyer: string[] = [];
afterEach(() => {
  echanges.clear();
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossierJetable(prefixe: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefixe));
  aNettoyer.push(d);
  return d;
}

describe.runIf(process.platform !== 'win32')(
  'un lien posé entre le parcours et l’ouverture n’est pas suivi',
  () => {
    it.each([
      ['CLAUDE.md', CONSIGNES_CLAUDE],
      ['AGENTS.md', CONSIGNES_CODEX],
    ] as const)(
      '%s échangé contre un lien vers un secret du membre : rien ne part',
      (nom, sources) => {
        const depot = dossierJetable('hive-course-depot-');
        const membre = dossierJetable('hive-course-membre-');
        const secret = path.join(membre, 'id_ed25519');
        writeFileSync(secret, 'SECRET-DU-MEMBRE');
        // Ce que le parcours a vu : un fichier ordinaire, légitime.
        const vuAuParcours = path.join(membre, 'ordinaire.md');
        writeFileSync(vuAuParcours, 'consigne légitime');
        const chemin = path.join(depot, nom);
        symlinkSync(secret, chemin);
        echanges.set(chemin, vuAuParcours);

        expect(consignesDuDepot(depot, sources)).toBe('');
      },
    );
  },
);
