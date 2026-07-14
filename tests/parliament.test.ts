// Tests du Parlement des Agents (palier 4) : consensus par vote. Module pur —
// on vérifie la signature stable, le regroupement en factions, le quorum et le
// départage par diversité d'agents.

import { describe, expect, it } from 'vitest';
import { signatureOf, tally } from '../src/orchestrator/parliament.js';
import type { Ballot } from '../src/orchestrator/parliament.js';

const ballot = (nodeId: string, agentType: string, signature: string, success = true): Ballot => ({
  nodeId,
  agentType,
  success,
  signature,
});

describe('signatureOf', () => {
  it('ignore fins de ligne, espaces de fin et lignes vides de bord', () => {
    expect(signatureOf('a\r\nb')).toBe(signatureOf('a\nb'));
    expect(signatureOf('a  \nb\t')).toBe(signatureOf('a\nb'));
    expect(signatureOf('\n\na\nb\n\n')).toBe(signatureOf('a\nb'));
  });

  it('distingue des contenus réellement différents', () => {
    expect(signatureOf('diff A')).not.toBe(signatureOf('diff B'));
  });

  it('est déterministe et de forme hex 32 bits', () => {
    expect(signatureOf('x')).toBe(signatureOf('x'));
    expect(signatureOf('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('tally', () => {
  it('élit la faction majoritaire quand le quorum est atteint', () => {
    const v = tally([
      ballot('n1', 'claude-code', 'AAA'),
      ballot('n2', 'codex', 'AAA'),
      ballot('n3', 'custom', 'BBB'),
    ]);
    expect(v.outcome).toBe('elected');
    expect(v.winner?.signature).toBe('AAA');
    expect(v.winner?.votes).toBe(2);
    expect(v.winner?.diversity).toBe(2);
  });

  it('pas de consensus si aucune faction n’atteint le quorum', () => {
    const v = tally([ballot('n1', 'claude-code', 'AAA'), ballot('n2', 'codex', 'BBB')]);
    expect(v.outcome).toBe('no_quorum');
    expect(v.winner).toBeNull();
    expect(v.factions).toHaveLength(2);
  });

  it('ne compte que les succès (un échec ne vote pas)', () => {
    const v = tally([
      ballot('n1', 'claude-code', 'AAA'),
      ballot('n2', 'codex', 'AAA', false), // échec : ignoré
    ]);
    expect(v.outcome).toBe('no_quorum'); // une seule voix valide < quorum 2
    expect(v.factions[0]?.votes).toBe(1);
  });

  it('un même nœud ne pèse qu’une voix même s’il rend deux fois la même sortie', () => {
    const v = tally([ballot('n1', 'claude-code', 'AAA'), ballot('n1', 'claude-code', 'AAA')], {
      quorum: 1,
    });
    expect(v.factions[0]?.votes).toBe(1);
    expect(v.outcome).toBe('elected');
  });

  it('départage les égalités de voix par diversité d’agents', () => {
    // Deux factions à 2 voix : celle avec 2 types d'agents distincts l'emporte.
    const v = tally([
      ballot('n1', 'claude-code', 'AAA'),
      ballot('n2', 'claude-code', 'AAA'), // faction AAA : 2 voix, 1 type
      ballot('n3', 'claude-code', 'BBB'),
      ballot('n4', 'codex', 'BBB'), // faction BBB : 2 voix, 2 types
    ]);
    expect(v.factions[0]?.signature).toBe('BBB');
    expect(v.winner?.signature).toBe('BBB');
  });

  it('aucun bulletin valide → no_ballots', () => {
    expect(tally([]).outcome).toBe('no_ballots');
    expect(tally([ballot('n1', 'x', 'AAA', false)]).outcome).toBe('no_ballots');
  });

  it('respecte un quorum explicite', () => {
    const three = [ballot('n1', 'a', 'AAA'), ballot('n2', 'b', 'AAA'), ballot('n3', 'c', 'AAA')];
    expect(tally(three, { quorum: 3 }).outcome).toBe('elected');
    expect(tally(three.slice(0, 2), { quorum: 3 }).outcome).toBe('no_quorum');
  });
});
