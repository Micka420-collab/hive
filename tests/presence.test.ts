// Présence Rayon — chemins / outils constatés, jamais inventés (ADR 0010).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHEMIN_PRESENCE_MAX,
  OUTILS_PRESENCE,
  VERSION_PRESENCE,
  cheminDepuisInput,
  expliquerRefusPresence,
  jugerCheminPresence,
  outilPresenceDe,
  presenceCorrespondAuRayon,
  validerOutilPresence,
} from '../src/shared/presence.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('présence — forme', () => {
  it('version figée', () => {
    expect(VERSION_PRESENCE).toBe(1);
  });

  it('liste fermée d’outils', () => {
    expect([...OUTILS_PRESENCE]).toEqual(['Read', 'Edit', 'Write']);
    expect(outilPresenceDe('Bash')).toBeNull();
    expect(outilPresenceDe('Task')).toBeNull();
    expect(outilPresenceDe('StrReplace')).toBe('Edit');
    expect(outilPresenceDe('read')).toBe('Read');
    expect(validerOutilPresence('Write')).toEqual({ ok: true, outil: 'Write' });
    expect(validerOutilPresence('Bash')).toEqual({ ok: false, motif: 'outil_inconnu' });
  });

  it('juge les chemins — relatif, absolu, refus traversal', () => {
    expect(jugerCheminPresence('src/a.ts')).toEqual({ ok: true, chemin: 'src/a.ts' });
    expect(jugerCheminPresence('/tmp/w/src/a.ts')).toEqual({
      ok: true,
      chemin: '/tmp/w/src/a.ts',
    });
    expect(jugerCheminPresence('a/./b.ts')).toEqual({ ok: true, chemin: 'a/b.ts' });
    expect(jugerCheminPresence('../etc/passwd')).toEqual({ ok: false, motif: 'traversee' });
    expect(jugerCheminPresence('a/../../b')).toEqual({ ok: false, motif: 'traversee' });
    expect(jugerCheminPresence('')).toEqual({ ok: false, motif: 'vide' });
    expect(jugerCheminPresence('x'.repeat(CHEMIN_PRESENCE_MAX + 1))).toEqual({
      ok: false,
      motif: 'trop_long',
    });
    expect(jugerCheminPresence('a\0b')).toEqual({ ok: false, motif: 'octet_nul' });
  });

  it('extrait file_path / path / target_file', () => {
    expect(cheminDepuisInput({ file_path: 'x.ts' })).toEqual({ ok: true, chemin: 'x.ts' });
    expect(cheminDepuisInput({ path: 'y.ts' })).toEqual({ ok: true, chemin: 'y.ts' });
    expect(cheminDepuisInput({ target_file: 'z.ts' })).toEqual({ ok: true, chemin: 'z.ts' });
    expect(cheminDepuisInput({})).toEqual({ ok: false, motif: 'vide' });
  });

  it('explique FR/EN', () => {
    expect(expliquerRefusPresence('traversee', 'fr')).toMatch(/\.\./);
    expect(expliquerRefusPresence('traversee', 'en')).toMatch(/traversal/i);
  });
});

describe('présence — pas d’auto-déclaration d’identité dans le protocole', () => {
  it('presences est un snapshot d’observation, pas un baptême/métier', () => {
    const protocole = readFileSync(
      fileURLToPath(new URL('../src/shared/protocol.ts', import.meta.url)),
      'utf8',
    );
    // Le champ `presences` existe (observation) — baptême/métier n’y sont pas.
    expect(protocole).toMatch(/\bpresences\b/);
    expect(protocole).not.toMatch(/\bbapteme\b/i);
    expect(protocole).not.toMatch(/\bmetierCycle\b/);
  });
});

describe('HiveStore — présences Rayon', () => {
  function noeud(store: HiveStore, id: string): void {
    store.registerNode({
      nodeId: id,
      name: id,
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
  }

  it('sans observation, lire renvoie vide', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n1');
    expect(store.lirePresences('n1')).toEqual([]);
  });

  it('remplace le snapshot et efface sur vide', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n1');
    const r = store.remplacerPresences(
      'n1',
      [{ toolUseId: 'toolu_a', chemin: 'src/a.ts', outil: 'Edit' }],
      'task-1',
      1000,
    );
    expect(r).toEqual({ ok: true });
    expect(store.lirePresences('n1')).toEqual([
      {
        toolUseId: 'toolu_a',
        chemin: 'src/a.ts',
        outil: 'Edit',
        taskId: 'task-1',
        constateA: 1000,
      },
    ]);
    store.remplacerPresences('n1', [], 'task-1', 2000);
    expect(store.lirePresences('n1')).toEqual([]);
  });

  it('refuse nœud inconnu ; prune les vieilles', () => {
    const store = new HiveStore(':memory:');
    expect(store.remplacerPresences('ghost', [])).toEqual({
      ok: false,
      motif: 'noeud_inconnu',
    });
    noeud(store, 'n1');
    store.remplacerPresences('n1', [{ toolUseId: 't1', chemin: 'a.ts', outil: 'Read' }], null, 100);
    expect(store.prunePresences(50, 200)).toBe(1);
    expect(store.lirePresences('n1')).toEqual([]);
  });

  it('efface par tâche et par nœud', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n1');
    store.remplacerPresences('n1', [{ toolUseId: 't1', chemin: 'a.ts', outil: 'Write' }], 'tk', 1);
    expect(store.effacerPresencesTache('tk')).toBe(1);
    store.remplacerPresences('n1', [{ toolUseId: 't2', chemin: 'b.ts', outil: 'Read' }], 'tk2', 2);
    expect(store.effacerPresencesNoeud('n1')).toBe(1);
  });

  it('presenceCorrespondAuRayon matche relatif et suffixe absolu', () => {
    expect(presenceCorrespondAuRayon('src/a.ts', 'src/a.ts')).toBe(true);
    expect(presenceCorrespondAuRayon('/tmp/w/src/a.ts', 'src/a.ts')).toBe(true);
    expect(presenceCorrespondAuRayon('foosrc/a.ts', 'src/a.ts')).toBe(false);
    expect(presenceCorrespondAuRayon('../x', 'src/a.ts')).toBe(false);
  });
});
