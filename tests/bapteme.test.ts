// Baptême — la Reine nomme ; le nœud ne s'auto-nomme pas (ADR 0010).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NOM_BAPTEME_MAX,
  NOM_BAPTEME_MIN,
  NOMS_TECHNIQUES_REFUSES,
  VERSION_BAPTEME,
  collisionBapteme,
  expliquerRefusBapteme,
  jugerBapteme,
  normaliserNomBapteme,
  validerNomBapteme,
} from '../src/orchestrator/bapteme.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('baptême — forme', () => {
  it('version figée (cliquet de corpus)', () => {
    expect(VERSION_BAPTEME).toBe(1);
  });

  it('normalise les espaces sans changer la casse', () => {
    expect(normaliserNomBapteme('  Marie   Claire  ')).toBe('Marie Claire');
    expect(normaliserNomBapteme('Léa')).toBe('Léa');
  });

  it('refuse le vide et le trop court', () => {
    expect(validerNomBapteme('')).toEqual({ ok: false, motif: 'vide' });
    expect(validerNomBapteme('   ')).toEqual({ ok: false, motif: 'vide' });
    expect(validerNomBapteme('A')).toEqual({ ok: false, motif: 'trop_court' });
    expect(NOM_BAPTEME_MIN).toBe(2);
  });

  it('refuse le trop long', () => {
    expect(validerNomBapteme('x'.repeat(NOM_BAPTEME_MAX + 1))).toEqual({
      ok: false,
      motif: 'trop_long',
    });
    expect(validerNomBapteme('x'.repeat(NOM_BAPTEME_MAX))).toEqual({
      ok: true,
      nom: 'x'.repeat(NOM_BAPTEME_MAX),
    });
  });

  it('refuse les caractères hors alphabet utile', () => {
    expect(validerNomBapteme('a@b')).toEqual({ ok: false, motif: 'caracteres' });
    expect(validerNomBapteme('a/b')).toEqual({ ok: false, motif: 'caracteres' });
    expect(validerNomBapteme('ok!')).toEqual({ ok: false, motif: 'caracteres' });
  });

  it('accepte lettres accentuées, tiret, apostrophe', () => {
    expect(validerNomBapteme('Marie-Claire')).toEqual({ ok: true, nom: 'Marie-Claire' });
    expect(validerNomBapteme("L'Abeille")).toEqual({ ok: true, nom: "L'Abeille" });
    expect(validerNomBapteme('Élodie')).toEqual({ ok: true, nom: 'Élodie' });
  });

  it('refuse les identifiants techniques d’agent', () => {
    for (const n of ['claude-code', 'Codex', 'SHELL', 'simulation', 'queen']) {
      expect(validerNomBapteme(n), n).toEqual({ ok: false, motif: 'technique' });
    }
    expect(NOMS_TECHNIQUES_REFUSES).toContain('claude-code');
  });
});

describe('baptême — collision', () => {
  it('détecte sans regarder la casse', () => {
    expect(collisionBapteme('Léa', ['léa', 'Marc'])).toBe(true);
    expect(collisionBapteme('Léa', ['Marc'])).toBe(false);
  });

  it('juger combine forme et collision', () => {
    expect(jugerBapteme('Léa', ['Marc'])).toEqual({ ok: true, nom: 'Léa' });
    expect(jugerBapteme('Léa', ['léa'])).toEqual({ ok: false, motif: 'collision' });
    expect(jugerBapteme('claude-code', [])).toEqual({ ok: false, motif: 'technique' });
  });

  it('expliquerRefus parle FR et EN', () => {
    expect(expliquerRefusBapteme('collision', 'fr')).toMatch(/déjà/);
    expect(expliquerRefusBapteme('collision', 'en')).toMatch(/already/i);
  });
});

describe('baptême — aucune auto-nomination par le protocole', () => {
  it('le protocole n’offre aucun champ baptême / métier de cycle', () => {
    // Même famille que polyéthisme « aucune caste ne se déclare » : un nœud
    // hostile qui poserait son prénom contournerait la Reine.
    const protocole = readFileSync(
      fileURLToPath(new URL('../src/shared/protocol.ts', import.meta.url)),
      'utf8',
    );
    expect(protocole).not.toMatch(/\bbapt[eê]me\b/i);
    expect(protocole).not.toMatch(/\bbaptis/i);
    expect(protocole).not.toMatch(/\bmetier\b/i);
    expect(protocole).not.toMatch(/\bmétier\b/i);
  });
});

describe('HiveStore — baptêmes', () => {
  function noeud(store: HiveStore, id: string, name = id): void {
    store.registerNode({
      nodeId: id,
      name,
      ownerName: 'hôte',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
  }

  it('sans baptême, lire renvoie null — on n’invente rien', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-1');
    expect(store.lireBapteme('n-1')).toBeNull();
  });

  it('baptise, lit, résout par nom', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-1', 'claude-code');
    const v = store.baptiser('n-1', '  Capucine  ', 1_700_000_000_000);
    expect(v).toEqual({ ok: true, nom: 'Capucine' });
    expect(store.lireBapteme('n-1')).toEqual({
      nom: 'Capucine',
      baptiseA: 1_700_000_000_000,
    });
    expect(store.nodeIdParBapteme('capucine')).toBe('n-1');
  });

  it('refuse la collision entre deux ouvrières', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-1');
    noeud(store, 'n-2');
    expect(store.baptiser('n-1', 'Iris').ok).toBe(true);
    expect(store.baptiser('n-2', 'iris')).toEqual({ ok: false, motif: 'collision' });
  });

  it('autorise le rebaptême de la MÊME ouvrière', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-1');
    expect(store.baptiser('n-1', 'Iris').ok).toBe(true);
    expect(store.baptiser('n-1', 'Violette').ok).toBe(true);
    expect(store.lireBapteme('n-1')?.nom).toBe('Violette');
    expect(store.nodeIdParBapteme('Iris')).toBeNull();
  });

  it('refuse un nœud inconnu et un nom technique', () => {
    const store = new HiveStore(':memory:');
    expect(store.baptiser('fantome', 'Léa')).toEqual({ ok: false, motif: 'noeud_inconnu' });
    noeud(store, 'n-1');
    expect(store.baptiser('n-1', 'claude-code')).toEqual({ ok: false, motif: 'technique' });
  });

  it('débaptiser efface sans inventer de remplaçant', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-1');
    store.baptiser('n-1', 'Capucine');
    expect(store.debaptiser('n-1')).toBe(true);
    expect(store.lireBapteme('n-1')).toBeNull();
    expect(store.debaptiser('n-1')).toBe(false);
  });

  it('listerBaptemes est ordonné et complet', () => {
    const store = new HiveStore(':memory:');
    noeud(store, 'n-a');
    noeud(store, 'n-b');
    store.baptiser('n-b', 'Zoé');
    store.baptiser('n-a', 'Ana');
    expect(store.listerBaptemes().map((b) => b.nom)).toEqual(['Ana', 'Zoé']);
  });
});
