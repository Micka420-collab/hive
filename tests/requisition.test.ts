// Réquisitions — genre fermé, store, pas de secret (ADR 0010 lot 7).

import { describe, expect, it } from 'vitest';
import {
  GENRES_REQUISITION,
  VERSION_REQUISITION,
  expliquerRefusRequisition,
  libelleGenreRequisition,
  messageAccordBinaire,
  suiteAccordRequisition,
  validerGenreRequisition,
  validerLibelleRequisition,
} from '../src/orchestrator/requisition.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('réquisition — forme', () => {
  it('version et liste fermée', () => {
    expect(VERSION_REQUISITION).toBe(2);
    expect([...GENRES_REQUISITION]).toEqual([
      'cle_api',
      'mcp',
      'binaire',
      'atelier',
      'logiciel',
      'action',
    ]);
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

  it('suiteAccordRequisition : Accorder n’est plus un no-op hors cle_api', () => {
    expect(suiteAccordRequisition('cle_api')).toEqual({ action: 'modal_cle' });
    expect(suiteAccordRequisition('atelier')).toEqual({ action: 'atelier' });
    expect(suiteAccordRequisition('mcp')).toEqual({
      action: 'fabrique',
      genreFabrique: 'mcp',
    });
    expect(suiteAccordRequisition('logiciel')).toEqual({
      action: 'fabrique',
      genreFabrique: 'script_npm',
    });
    expect(suiteAccordRequisition('binaire')).toEqual({ action: 'hint_binaire' });
    // `action` (G12) : le relais au nœud est déjà fait par le POST repondre.
    expect(suiteAccordRequisition('action')).toEqual({ action: 'relais_noeud' });
  });

  it('messageAccordBinaire nomme l’outil du libellé', () => {
    expect(messageAccordBinaire('Binaire claude', 'fr')).toMatch(/« claude »/);
    expect(messageAccordBinaire('Binaire / CLI (Claude Code)', 'en')).toMatch(/Claude Code/);
    expect(messageAccordBinaire('Binaire claude', 'fr')).toMatch(/Accordez à nouveau/);
    expect(messageAccordBinaire('Binaire claude', 'en')).toMatch(/Grant again/);
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

  it('échéance (G12) : seule une ouverte échue expire, et l’élagage emporte son échéance', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n1');
    const t0 = 1_000_000;
    const avecEcheance = store.ouvrirRequisition(
      'n1',
      'action',
      'git push',
      null,
      't1',
      t0,
      t0 + 100,
    );
    const sansEcheance = store.ouvrirRequisition('n1', 'cle_api', 'Clé', null, null, t0);
    expect(avecEcheance.ok && sansEcheance.ok).toBe(true);
    if (!avecEcheance.ok || !sansEcheance.ok) return;
    // L'échéance VOYAGE avec la réquisition (jointure latérale) : c'est elle
    // que GET /api/requisitions sert au badge de la Chambre (revue G12).
    const listees = store.listerRequisitions({ statut: 'ouverte' });
    expect(listees.find((r) => r.id === avecEcheance.id)?.expiresAt).toBe(t0 + 100);
    expect(listees.find((r) => r.id === sansEcheance.id)?.expiresAt).toBeNull();
    // Avant l'échéance : rien n'expire.
    expect(store.expirerRequisitions(t0 + 50)).toEqual([]);
    // Après : SEULE la réquisition d'action échue bascule, avec ses faits.
    expect(store.expirerRequisitions(t0 + 101)).toEqual([
      { id: avecEcheance.id, nodeId: 'n1', genre: 'action', libelle: 'git push', taskId: 't1' },
    ]);
    // Idempotent : une expirée ne ré-expire pas.
    expect(store.expirerRequisitions(t0 + 200)).toEqual([]);
    expect(store.lireRequisition(avecEcheance.id)?.statut).toBe('expiree');
    expect(store.listerRequisitions({ statut: 'expiree' })).toHaveLength(1);
    // Close par expiration = close : répondre est refusé.
    expect(store.repondreRequisition(avecEcheance.id, 'accordee')).toEqual({
      ok: false,
      motif: 'deja_close',
    });
    // L'ouverte SANS échéance reste ouverte, jamais élaguée ; l'expirée part
    // avec son échéance latérale (clé étrangère : la fille d'abord).
    expect(store.pruneRequisitions(1, t0 + 10_000)).toBe(1);
    expect(store.lireRequisition(sansEcheance.id)?.statut).toBe('ouverte');
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
