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
//
// Même course, vers ce qui n'est pas un fichier : c'est là que servent les
// deux autres gardes de l'ouverture, que `O_NOFOLLOW` ne couvre pas — `fstat`
// sur le descripteur (un périphérique se lirait) et `O_NONBLOCK` (un tube sans
// écrivain bloquait `openSync`, donc le nœud, pour toujours).

import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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
const aTuer: ChildProcess[] = [];
afterEach(() => {
  echanges.clear();
  for (const p of aTuer.splice(0)) p.kill('SIGKILL');
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

describe.runIf(process.platform !== 'win32')(
  'ni un périphérique, ni un tube nommé posés entre le parcours et l’ouverture',
  () => {
    /** `AGENTS.md` du dépôt devenu un tube, que le parcours a vu fichier ordinaire. */
    function tubeEchange(): { depot: string; tube: string } {
      const depot = dossierJetable('hive-course-tube-');
      const vuAuParcours = path.join(dossierJetable('hive-course-vu-'), 'ordinaire.md');
      writeFileSync(vuAuParcours, 'consigne légitime');
      const tube = path.join(depot, 'AGENTS.md');
      execFileSync('mkfifo', [tube]);
      echanges.set(tube, vuAuParcours);
      return { depot, tube };
    }

    it('un périphérique n’est pas lu : c’est le DESCRIPTEUR qui doit être un fichier ordinaire', () => {
      // `/dev/zero` se lit sans fin : sans le `fstat` du descripteur, 32 Kio de
      // NUL entraient dans le bloc. (Un tube, lui, échoue déjà à la lecture
      // positionnée — ESPIPE — et ne prouverait rien ici.) Les sources sont
      // taillées pour viser `/dev`, que le parcours croit un fichier ordinaire.
      const vuAuParcours = path.join(dossierJetable('hive-course-dev-'), 'ordinaire.md');
      writeFileSync(vuAuParcours, 'consigne légitime');
      echanges.set('/dev/zero', vuAuParcours);
      const sources = { ...CONSIGNES_CODEX, fichiers: [['zero']] };
      expect(consignesDuDepot('/dev', sources)).toBe('');
    });

    it('un tube SANS écrivain ne bloque pas le nœud', { timeout: 30_000 }, () => {
      const { depot, tube } = tubeEchange();
      // Filet : sans `O_NONBLOCK`, l'ouverture attendrait un écrivain pour
      // toujours, et le test avec elle (l'appel est synchrone : aucune
      // minuterie de Vitest ne l'interrompt). Celui-ci arrive dans 10 s — ce
      // qui ne sert qu'à rendre la main, et fait échouer la mesure.
      const filet = spawn('sh', ['-c', 'sleep 10; printf x > "$0"', tube], { stdio: 'ignore' });
      aTuer.push(filet);
      const debut = Date.now();
      expect(consignesDuDepot(depot, CONSIGNES_CODEX)).toBe('');
      expect(Date.now() - debut, 'l’ouverture a attendu un écrivain').toBeLessThan(5_000);
    });
  },
);
