// LES NOMS QUE WINDOWS RÉSERVE — refusés dans une archive, remappés en chemin.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// Le dossier d'un nœud se tirait de son nom en ne gardant que `[A-Za-z0-9_-]` :
// un poste nommé `aux`, `nul` ou `com1` y gardait son nom, et sous Windows
// `.hive-work\aux` désigne le port auxiliaire — ni dossier, ni identité, le
// nœud ne démarre pas. Les identifiants du protocole (tâche, merge, chantier,
// projet) passent `ID_PATTERN` sous ces mêmes noms, et devenaient des dossiers
// (`tasks/nul`) ou des fichiers (`aux.patch`). La règle existait déjà — pour les
// archives seulement (`deballage.ts`).
//
// Chaque cas se juge par `path.win32` : la règle doit tenir pour Windows, où
// qu'on la calcule.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  racineDeTravailParDefaut,
  refusRacineDeTravail,
} from '../src/node-client/identite-noeud.js';
import { prepareWorkspace } from '../src/node-client/workspace.js';
import { jugerEntrees } from '../src/shared/deballage.js';
import { nomReserveWindows, segmentSur } from '../src/shared/noms-windows.js';
import { ID_PATTERN } from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

const dossiers: string[] = [];
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

/** Le nom que Windows verrait au bout d'un chemin — son dernier segment. */
const feuilleWindows = (chemin: string): string => path.win32.basename(chemin);

describe('nomReserveWindows — la règle de Microsoft, pas une approximation', () => {
  it.each([
    'con',
    'CON',
    'Prn',
    'aux',
    'nul',
    'NUL.txt',
    'nul.tar.gz',
    'com1',
    'COM9',
    'lpt1',
    'lpt9.log',
    'com¹',
    'LPT³',
    'fichier.',
    'fichier ',
  ])('« %s » est réécrit par Windows', (nom) => {
    expect(nomReserveWindows(nom)).toBe(true);
  });

  it.each(['console', 'auxiliaire', 'nul_', 'aux-1234abcd', 'com10', 'lpt0', 'com', '.env', 'x.y'])(
    '« %s » est un nom ordinaire',
    (nom) => {
      expect(nomReserveWindows(nom)).toBe(false);
    },
  );

  it('les archives refusent toujours ces noms, exposant compris', () => {
    const verdict = jugerEntrees([{ chemin: 'src/COM¹', sorte: 'fichier', octets: 1 }]);
    expect(verdict.ok).toBe(false);
  });
});

describe('segmentSur — un chemin que Windows écrit tel qu’on le nomme', () => {
  it.each([
    ['aux', 'aux~'],
    ['NUL', 'NUL~'],
    ['com1', 'com1~'],
    ['aux.patch', 'aux~.patch'],
    ['fichier.', 'fichier.~'],
    ['tache-ordinaire', 'tache-ordinaire'],
  ])('« %s » → « %s »', (brut, sur) => {
    expect(segmentSur(brut)).toBe(sur);
    expect(nomReserveWindows(segmentSur(brut))).toBe(false);
  });

  it('un identifiant réservé, suivi d’une extension, ne vise plus un périphérique', () => {
    // Le cas du merge : `<taskId>.patch`, écrit dans un dossier temporaire.
    const chemin = path.win32.join('C:\\Temp\\hive-merge-x', `${segmentSur('aux')}.patch`);
    expect(nomReserveWindows(feuilleWindows(chemin))).toBe(false);
  });

  it('INJECTIF sur les identifiants : deux ids distincts ne partagent jamais un dossier', () => {
    // `aux_` est un identifiant VALIDE : un remappage en `_` l'aurait confondu
    // avec `aux`. Le `~` est hors de l'alphabet des identifiants.
    const ids = ['aux', 'aux_', 'aux-', 'AUX', 'nul', 'nul_', 'com1', 'com1_', 'tache'];
    for (const id of ids) expect(ID_PATTERN.test(id), id).toBe(true);
    expect(new Set(ids.map(segmentSur)).size).toBe(ids.length);
  });
});

describe('le dossier d’un nœud, tiré de son nom', () => {
  it.each([
    ['aux', 'aux~'],
    ['NUL', 'NUL~'],
    ['com1', 'com1~'],
    ['mon poste.', 'mon_poste_'],
    ['poste-de-léa', 'poste-de-l_a'],
  ])('sous Windows, « %s » → .hive-work/%s', (nom, dossier) => {
    const racine = racineDeTravailParDefaut(nom, 'win32');
    expect(racine).toBe(path.join('.hive-work', dossier));
    expect(nomReserveWindows(feuilleWindows(racine.replaceAll(path.sep, '\\')))).toBe(false);
  });

  it.each(['linux', 'darwin'] as const)(
    'sous %s, un poste nommé `aux` GARDE son dossier — donc son identité',
    (plateforme) => {
      // Remappé partout, `.hive-work/aux` devenait `aux~` à la mise à jour :
      // une nouvelle identité, et l'ancienne en fantôme « hors ligne » dans la
      // ruche. Hors Windows, `aux` est un dossier ordinaire.
      expect(racineDeTravailParDefaut('aux', plateforme)).toBe(path.join('.hive-work', 'aux'));
    },
  );
});

describe('une racine de travail DONNÉE (`HIVE_WORKDIR`)', () => {
  it.each(['C:\\hive\\aux', 'D:\\travail\\nul.', 'C:/hive/COM1/x', 'poste '])(
    'sous Windows, « %s » est refusée en nommant le segment fautif',
    (racine) => {
      const refus = refusRacineDeTravail(racine, 'win32');
      expect(refus).toMatch(/HIVE_WORKDIR/);
      expect(refus).toMatch(/« (aux|nul\.|COM1|poste ) »/);
    },
  );

  it.each(['C:\\hive\\travail', '.\\hive-work\\..\\x', '\\\\?\\C:\\hive', '.hive-work/join'])(
    'sous Windows, « %s » passe',
    (racine) => {
      expect(refusRacineDeTravail(racine, 'win32')).toBeNull();
    },
  );

  it('hors Windows, rien n’est refusé : `aux` y est un dossier ordinaire', () => {
    expect(refusRacineDeTravail('/srv/hive/aux', 'linux')).toBeNull();
  });
});

describe('le répertoire d’une tâche dont l’id est un nom réservé', () => {
  it('`nul` sans suffixe d’instance devient `nul~` — un dossier, pas un périphérique', async () => {
    const workRoot = mkdtempSync(path.join(os.tmpdir(), 'hive-noms-'));
    dossiers.push(workRoot);
    const tache = { id: 'nul', title: 't', prompt: 'p' } as Task;
    const ws = await prepareWorkspace(workRoot, tache, null, [], '');
    try {
      expect(path.basename(ws.cwd)).toBe('nul~');
      expect(nomReserveWindows(path.basename(ws.cwd))).toBe(false);
      // Et ce qui vit à côté — TEMP, registre git — ne retombe pas sur `nul.tmp`.
      expect(nomReserveWindows(path.basename(ws.env.TEMP ?? ''))).toBe(false);
    } finally {
      ws.cleanup();
    }
  });
});
