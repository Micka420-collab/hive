// L'EMPREINTE DE L'IMAGE DES AGENTS — posée à la construction, relue par le nœud.
//
// ─── LE DÉFAUT QUE CE FICHIER FERME ──────────────────────────────────────────
//
// L'image par défaut du bac se construit sur le nœud (`npm run bac:image`). Une
// mise à jour de Hive qui change `docker/agents/Dockerfile` ne la reconstruit
// pas : le nœud gardait l'image d'avant, son preflight y passait, et rien ne le
// disait — le correctif de l'image n'atteignait aucun membre déjà installé.
//
// Ce qui est éprouvé ici : l'empreinte (un seul calcul, stable et sensible à
// ses entrées), le script de construction qui la pose — lancé pour de vrai,
// sans tsx, devant un faux moteur —, et la règle qui juge une image présente.
// Le vrai Docker et le vrai Podman la relisent dans le job image de la CI
// (`tests/isolement-runtime.integration.test.ts`).

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  empreinteAttendue,
  empreinteImage,
  ENTREES_IMAGE,
  ETIQUETTE_EMPREINTE,
  raisonPeremption,
} from '../src/node-client/empreinte-image.js';
import { fraicheurImage, IMAGE_DEFAUT } from '../src/node-client/isolement.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

let copie = '';
beforeEach(() => {
  copie = mkdtempSync(path.join(os.tmpdir(), 'hive-empreinte-'));
  for (const entree of ENTREES_IMAGE) {
    mkdirSync(path.dirname(path.join(copie, entree)), { recursive: true });
    cpSync(path.join(RACINE, entree), path.join(copie, entree));
  }
});
afterEach(() => {
  rmSync(copie, { recursive: true, force: true });
});

/** Réécrit une entrée de la copie. */
const ecrire = (entree: string, contenu: string): void =>
  writeFileSync(path.join(copie, entree), contenu);

describe('l’empreinte des entrées de l’image', () => {
  it('celle du dépôt existe, et c’est celle que le nœud attend', () => {
    const empreinte = empreinteImage(RACINE);
    expect(empreinte).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(empreinteAttendue()).toBe(empreinte);
    // Une copie fidèle des entrées, ailleurs : la même empreinte.
    expect(empreinteImage(copie)).toBe(empreinte);
  });

  it.each(ENTREES_IMAGE)('un octet changé dans %s la change', (entree) => {
    const avant = empreinteImage(copie);
    ecrire(entree, `${readFileSync(path.join(copie, entree), 'utf8')}\n`);
    expect(empreinteImage(copie)).not.toBe(avant);
  });

  it('un contenu déplacé d’une entrée à l’autre la change aussi', () => {
    const avant = empreinteImage(copie);
    const [a, b] = ['docker/agents/package.json', 'docker/agents/package-lock.json'];
    const contenuA = readFileSync(path.join(copie, a), 'utf8');
    ecrire(a, readFileSync(path.join(copie, b), 'utf8'));
    ecrire(b, contenuA);
    expect(empreinteImage(copie)).not.toBe(avant);
  });

  it('un clone Windows (CRLF) construit la même image : même empreinte', () => {
    const avant = empreinteImage(copie);
    for (const entree of ENTREES_IMAGE) {
      const lf = readFileSync(path.join(copie, entree), 'utf8').replaceAll('\r\n', '\n');
      ecrire(entree, lf.replaceAll('\n', '\r\n'));
    }
    expect(empreinteImage(copie)).toBe(avant);
  });

  it('une entrée manquante : aucune empreinte, jamais une valeur inventée', () => {
    rmSync(path.join(copie, 'docker/agents/package-lock.json'));
    expect(empreinteImage(copie)).toBeNull();
    // L'installation sans `docker/agents` (paquet npm, application de bureau).
    expect(empreinteImage(path.join(copie, 'ailleurs'))).toBeNull();
  });

  it('compte TOUT ce que le Dockerfile copie : sans quoi une image d’autres entrées passerait pour à jour', () => {
    const dockerfile = readFileSync(path.join(RACINE, 'docker/agents/Dockerfile'), 'utf8');
    const sources = dockerfile
      .split('\n')
      .filter((l) => /^\s*(COPY|ADD)\s/i.test(l) && !l.includes('--from='))
      // Ni l'instruction, ni ses options, ni la destination (le dernier mot).
      .flatMap((l) =>
        l
          .trim()
          .split(/\s+/)
          .slice(1, -1)
          .filter((mot) => !mot.startsWith('--')),
      );
    expect(sources.length, 'le Dockerfile ne copie plus rien ?').toBeGreaterThan(0);
    expect([...ENTREES_IMAGE].sort()).toEqual(
      [...new Set(['docker/agents/Dockerfile', ...sources])].sort(),
    );
  });
});

describe('la construction pose l’empreinte que le nœud relira', () => {
  /** `PATH` seul : ni tsx, ni chargeur hérité de vitest — ce que lance `npm run bac:image`. */
  const envNu = (chemin = process.env.PATH ?? ''): NodeJS.ProcessEnv => ({
    PATH: chemin,
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  });

  it('le script charge le module de l’empreinte sans tsx', () => {
    // Un `--moteur` invalide est refusé APRÈS le chargement des imports : un
    // module devenu illisible pour Node seul (un import `.js`, un `enum`)
    // ferait mourir le script avant, sur ERR_MODULE_NOT_FOUND ou une erreur de
    // syntaxe — et `npm run bac:image` avec lui, chez chaque membre.
    const r = spawnSync(process.execPath, ['scripts/image-agents.mjs', '--moteur', 'aucun'], {
      cwd: RACINE,
      env: envNu(),
      encoding: 'utf8',
    });
    expect(r.stderr).toContain('--moteur attend podman ou docker');
    expect(r.status).toBe(2);
  });

  it.skipIf(process.platform === 'win32')(
    'le moteur reçoit l’étiquette, avec l’empreinte des entrées du dépôt',
    () => {
      // Un faux `docker`, premier dans le PATH, qui consigne ce qu'on lui demande.
      const bin = path.join(copie, 'bin');
      const journal = path.join(copie, 'docker.log');
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, 'docker'),
        `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(journal)}\nexit 0\n`,
        { mode: 0o755 },
      );
      const r = spawnSync(process.execPath, ['scripts/image-agents.mjs', '--moteur', 'docker'], {
        cwd: RACINE,
        env: envNu(`${bin}${path.delimiter}${process.env.PATH ?? ''}`),
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      const args = readFileSync(journal, 'utf8').trim().split('\n');
      const etiquette = `${ETIQUETTE_EMPREINTE}=${empreinteAttendue()}`;
      expect(args[0]).toBe('build');
      expect(args[args.indexOf('--label') + 1]).toBe(etiquette);
      expect(args[args.indexOf('--tag') + 1]).toBe(IMAGE_DEFAUT);
      // …et l'humain la voit : c'est elle que `hive doctor` comparera.
      expect(r.stdout).toContain(etiquette);
    },
  );
});

describe('la fraîcheur d’une image présente', () => {
  const ATTENDUE = 'sha256:' + 'a'.repeat(64);

  it('l’image par défaut, construite de ces entrées : à jour', () => {
    expect(fraicheurImage(IMAGE_DEFAUT, ATTENDUE, ATTENDUE)).toEqual({ etat: 'a_jour' });
  });

  it('sans étiquette — construite par une version antérieure : périmée', () => {
    expect(fraicheurImage(IMAGE_DEFAUT, null, ATTENDUE)).toEqual({
      etat: 'perimee',
      lue: null,
      attendue: ATTENDUE,
    });
  });

  it('une autre empreinte — d’autres entrées : périmée', () => {
    const lue = 'sha256:' + 'b'.repeat(64);
    expect(fraicheurImage(IMAGE_DEFAUT, lue, ATTENDUE)).toEqual({
      etat: 'perimee',
      lue,
      attendue: ATTENDUE,
    });
  });

  it('une image NOMMÉE n’est jamais périmée, même avec notre étiquette héritée', () => {
    for (const lue of [null, ATTENDUE, 'sha256:autre']) {
      expect(fraicheurImage('ghcr.io/x/agent:1', lue, ATTENDUE)).toEqual({ etat: 'non_geree' });
    }
  });

  it('une installation sans les entrées de l’image ne conclut rien', () => {
    expect(fraicheurImage(IMAGE_DEFAUT, ATTENDUE, null)).toEqual({ etat: 'inconnue' });
    expect(fraicheurImage(IMAGE_DEFAUT, null, null)).toEqual({ etat: 'inconnue' });
  });

  it('la raison se lit sans ouvrir le code', () => {
    expect(raisonPeremption({ lue: null, attendue: ATTENDUE })).toBe(
      'sans empreinte : construite par une version antérieure de Hive',
    );
    const autre = raisonPeremption({ lue: 'sha256:' + 'b'.repeat(64), attendue: ATTENDUE });
    expect(autre).toContain('sha256:bbbbbbbbbbbb…');
    expect(autre).toContain('sha256:aaaaaaaaaaaa…');
    expect(autre).not.toContain('b'.repeat(13));
  });
});
