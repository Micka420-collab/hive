// Réquisitions — genre fermé, store, pas de secret (ADR 0010 lot 7).

import { describe, expect, it } from 'vitest';
import {
  GENRES_REQUISITION,
  VERSION_REQUISITION,
  expliquerRefusRequisition,
  libelleGenreRequisition,
  validerGenreRequisition,
  validerLibelleRequisition,
} from '../src/orchestrator/requisition.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('réquisition — forme', () => {
  it('version et liste fermée', () => {
    expect(VERSION_REQUISITION).toBe(1);
    expect([...GENRES_REQUISITION]).toEqual(['cle_api', 'mcp', 'binaire', 'atelier', 'logiciel']);
  });

  it('valide genre et libellé', () => {
    expect(validerGenreRequisition('mcp')).toEqual({ ok: true, genre: 'mcp' });
    expect(validerGenreRequisition('seedance')).toEqual({ ok: false, motif: 'genre_inconnu' });
    expect(validerLibelleRequisition('  Clé Seedance  ')).toEqual({
      ok: true,
      libelle: 'Clé Seedance',
    });
    expect(validerLibelleRequisition('')).toEqual({ ok: false, motif: 'vide' });
  });

  it('libellés FR/EN', () => {
    expect(libelleGenreRequisition('cle_api', 'fr')).toMatch(/Clé/i);
    expect(libelleGenreRequisition('cle_api', 'en')).toMatch(/API/i);
    expect(expliquerRefusRequisition('deja_close', 'fr')).toMatch(/déjà/i);
  });
});

describe('HiveStore — réquisitions', () => {
  function noeud(store: HiveStore, id: string): void {
    store.registerNode({
      nodeId: id,
      name: id,
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
  }

  it('ouvre, liste, répond, refuse double réponse', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n1');
    const o = store.ouvrirRequisition('n1', 'cle_api', 'Clé Seedance', 'pour vidéo');
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(store.listerRequisitions({ statut: 'ouverte' })).toHaveLength(1);
    expect(store.repondreRequisition(o.id, 'accordee')).toEqual({
      ok: true,
      statut: 'accordee',
    });
    expect(store.repondreRequisition(o.id, 'refusee')).toEqual({
      ok: false,
      motif: 'deja_close',
    });
    expect(store.pruneRequisitions(1, Date.now() + 10)).toBe(1);
  });

  it('exemple Seedance : cle_api → Accorder — sans stocker de secret', () => {
    // Parcours produit (ADR 0010 lot 7) : l’ouvrière demande une clé ; l’humain
    // accorde depuis la Chambre ; le secret vit dans l’env Queen, jamais ici.
    const store = new HiveStore(':memory:');
    noeud(store, 'n-capucine');
    const o = store.ouvrirRequisition(
      'n-capucine',
      'cle_api',
      'Clé Seedance',
      'Pour le pont vidéo',
    );
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const ouvertes = store.listerRequisitions({ nodeId: 'n-capucine', statut: 'ouverte' });
    expect(ouvertes[0]?.libelle).toBe('Clé Seedance');
    expect(ouvertes[0]?.detail).toMatch(/vidéo/);
    expect(JSON.stringify(ouvertes)).not.toMatch(/sk-|secret|SEEDANCE_KEY/i);
    expect(store.repondreRequisition(o.id, 'accordee')).toEqual({
      ok: true,
      statut: 'accordee',
    });
    expect(store.listerRequisitions({ statut: 'ouverte' })).toHaveLength(0);
  });

  it('refuse nœud inconnu et genre inventé', () => {
    const store = new HiveStore(':memory:');
    expect(store.ouvrirRequisition('x', 'mcp', 'x')).toEqual({
      ok: false,
      motif: 'noeud_inconnu',
    });
    noeud(store, 'n1');
    expect(store.ouvrirRequisition('n1', 'seedance', 'x')).toEqual({
      ok: false,
      motif: 'genre_inconnu',
    });
  });
});
