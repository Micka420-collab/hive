import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cheminPreferencesIA,
  ecrirePreferencesIA,
  lirePreferencesIA,
} from '../src/node-client/preferences-ia.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function racine(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-ia-'));
  dirs.push(dir);
  return path.join(dir, 'work');
}

describe('préférences IA locales du nœud', () => {
  it('mémorise application + modèles sans toucher au .env', () => {
    const work = racine();
    const fichier = ecrirePreferencesIA(work, {
      version: 1,
      agent: 'cursor',
      modeles: ['auto', 'composer-2'],
    });
    expect(fichier).toBe(cheminPreferencesIA(work));
    expect(lirePreferencesIA(work)).toEqual({
      version: 1,
      agent: 'cursor',
      modeles: ['auto', 'composer-2'],
    });
    if (process.platform !== 'win32') {
      expect(statSync(fichier).mode & 0o777).toBe(0o600);
    }
  });

  it('distingue le choix automatique d’une configuration absente', () => {
    const work = racine();
    expect(lirePreferencesIA(work)).toBeNull();
    ecrirePreferencesIA(work, { version: 1, agent: 'claude-code', modeles: null });
    expect(lirePreferencesIA(work)?.modeles).toBeNull();
  });

  it('ignore un agent inconnu ou un fichier corrompu', () => {
    const work = racine();
    const fichier = cheminPreferencesIA(work);
    ecrirePreferencesIA(work, { version: 1, agent: 'codex', modeles: null });
    writeFileSync(fichier, '{"version":1,"agent":"inconnu","modeles":null}');
    expect(lirePreferencesIA(work)).toBeNull();
    writeFileSync(fichier, '{cassé');
    expect(lirePreferencesIA(work)).toBeNull();
    expect(() => readFileSync(fichier)).not.toThrow();
  });
});
