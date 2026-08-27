// Métier de cycle — orthogonal à la caste ; jamais déclaré par le nœud (ADR 0010).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  METIERS,
  VERSION_METIER,
  estMetier,
  expliquerRefusMetier,
  libelleMetier,
  validerMetier,
} from '../src/orchestrator/metier.js';
import { CASTES } from '../src/orchestrator/polyethisme.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('métier de cycle — liste fermée', () => {
  it('version figée', () => {
    expect(VERSION_METIER).toBe(1);
  });

  it('les sept métiers sont exactement ceux de l’ADR', () => {
    expect([...METIERS]).toEqual([
      'planifie',
      'edite',
      'relit',
      'teste',
      'filme',
      'sculpte',
      'outille',
    ]);
  });

  it('accepte chaque littéral, refuse le reste', () => {
    for (const m of METIERS) {
      expect(validerMetier(m)).toEqual({ ok: true, metier: m });
      expect(estMetier(m)).toBe(true);
    }
    expect(validerMetier('')).toEqual({ ok: false, motif: 'vide' });
    expect(validerMetier('butineuse')).toEqual({ ok: false, motif: 'inconnu' });
    expect(validerMetier('architecte')).toEqual({ ok: false, motif: 'inconnu' });
  });

  it('normalise la casse, pas le vocabulaire', () => {
    expect(validerMetier('  EDITE  ')).toEqual({ ok: true, metier: 'edite' });
  });

  it('libellés FR/EN pour chaque métier', () => {
    expect(libelleMetier('relit', 'fr')).toBe('Relit');
    expect(libelleMetier('relit', 'en')).toBe('Reviews');
    expect(expliquerRefusMetier('inconnu', 'fr')).toMatch(/planifie/);
  });

  it('aucun métier n’est une caste — les deux axes restent distincts', () => {
    for (const c of CASTES) {
      expect(estMetier(c), `caste « ${c} » passée pour un métier`).toBe(false);
    }
    for (const m of METIERS) {
      expect((CASTES as readonly string[]).includes(m), `métier « ${m} » dans CASTES`).toBe(false);
    }
  });
});

describe('métier — aucune auto-déclaration par le protocole', () => {
  it('protocol.ts et types.ts n’offrent aucun champ métier / metierCycle', () => {
    const sansCommentaires = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
        .join('\n');

    const protocole = readFileSync(
      fileURLToPath(new URL('../src/shared/protocol.ts', import.meta.url)),
      'utf8',
    );
    const types = readFileSync(
      fileURLToPath(new URL('../src/shared/types.ts', import.meta.url)),
      'utf8',
    );
    for (const source of [protocole, types]) {
      // Identifiants de champ — y compris dans les commentaires interdits :
      // un commentaire « TODO: ajouter metier » serait déjà trop.
      expect(source).not.toMatch(/\bmetierCycle\b/i);
      expect(source).not.toMatch(/\bcycleRole\b/i);
      expect(source).not.toMatch(/\bmetier\s*[?:]/i);
      expect(source).not.toMatch(/\bmétier\s*[?:]/i);

      // Les littéraux de métier ne doivent pas être des VALEURS de protocole
      // (hors commentaires FR où « relit » peut apparaître en prose).
      const code = sansCommentaires(source);
      for (const m of METIERS) {
        expect(code).not.toMatch(new RegExp(`['"\`]${m}['"\`]`));
        expect(code).not.toMatch(new RegExp(`\\b${m}\\s*:`));
      }
    }
  });
});

describe('HiveStore — métiers de cycle', () => {
  function noeud(store: HiveStore, id: string): void {
    store.registerNode({
      nodeId: id,
      name: id,
      ownerName: 'hôte',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
  }

  it('sans métier, lire renvoie null', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-1');
    expect(store.lireMetier('n-1')).toBeNull();
  });

  it('assigne, lit, réassigne, retire', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-1');
    expect(store.assignerMetier('n-1', 'edite', 100)).toEqual({ ok: true, metier: 'edite' });
    expect(store.lireMetier('n-1')).toEqual({ metier: 'edite', assigneA: 100 });
    expect(store.assignerMetier('n-1', 'teste', 200).ok).toBe(true);
    expect(store.lireMetier('n-1')?.metier).toBe('teste');
    expect(store.retirerMetier('n-1')).toBe(true);
    expect(store.lireMetier('n-1')).toBeNull();
  });

  it('refuse nœud inconnu et métier inventé', () => {
    const store = new HiveStore(':memory:');
    expect(store.assignerMetier('fantome', 'edite')).toEqual({
      ok: false,
      motif: 'noeud_inconnu',
    });
    noeud(store, 'n-1');
    expect(store.assignerMetier('n-1', 'pilote')).toEqual({ ok: false, motif: 'inconnu' });
  });
});
