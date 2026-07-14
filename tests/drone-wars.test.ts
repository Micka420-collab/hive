// Tests du moteur Drone Wars (palier 4) : redondance compétitive. Le moteur est
// pur — on vérifie l'enrôlement diversifié, la désignation du gagnant, l'annulation
// des perdants, l'idempotence après décision et le cas « tous échoué ».

import { describe, expect, it } from 'vitest';
import {
  clampFactor,
  createRace,
  enlistDrones,
  MAX_FACTOR,
  pickDiverseDrones,
  recordDroneResult,
  runningDrones,
} from '../src/orchestrator/drone-wars.js';
import type { DroneCandidate } from '../src/orchestrator/drone-wars.js';

const cand = (id: string, agentType: string): DroneCandidate => ({ id, agentType });

describe('clampFactor', () => {
  it('borne entre 1 et MAX_FACTOR et tronque', () => {
    expect(clampFactor(0)).toBe(1);
    expect(clampFactor(-3)).toBe(1);
    expect(clampFactor(2.9)).toBe(2);
    expect(clampFactor(999)).toBe(MAX_FACTOR);
    expect(clampFactor(NaN)).toBe(1);
  });
});

describe('pickDiverseDrones', () => {
  it('maximise la diversité des types d’agents', () => {
    const candidates = [
      cand('n1', 'claude-code'),
      cand('n2', 'claude-code'),
      cand('n3', 'codex'),
      cand('n4', 'custom'),
    ];
    // 3 drones : on veut 3 types différents plutôt que 2 claude-code.
    const picked = pickDiverseDrones(candidates, 3);
    expect(picked).toHaveLength(3);
    const types = picked.map((id) => candidates.find((c) => c.id === id)?.agentType);
    expect(new Set(types).size).toBe(3);
    expect(picked).toContain('n3');
    expect(picked).toContain('n4');
  });

  it('ne dépasse pas le nombre de candidats et ignore les doublons d’id', () => {
    expect(pickDiverseDrones([cand('n1', 'a'), cand('n1', 'a')], 3)).toEqual(['n1']);
    expect(pickDiverseDrones([], 2)).toEqual([]);
    expect(pickDiverseDrones([cand('n1', 'a')], 0)).toEqual([]);
  });

  it('à diversité égale, respecte l’ordre d’entrée (tri par charge du caller)', () => {
    const picked = pickDiverseDrones([cand('n1', 'a'), cand('n2', 'b'), cand('n3', 'c')], 2);
    expect(picked).toEqual(['n1', 'n2']);
  });
});

describe('enlistDrones', () => {
  it('enrôle jusqu’au facteur et signale les nœuds à lancer', () => {
    const race0 = createRace('t1', 3);
    const { race, launch } = enlistDrones(race0, [
      cand('n1', 'claude-code'),
      cand('n2', 'codex'),
      cand('n3', 'custom'),
      cand('n4', 'shell'),
    ]);
    expect(launch).toHaveLength(3);
    expect(race.drones).toHaveLength(3);
    expect(runningDrones(race)).toEqual(launch);
  });

  it('ne ré-enrôle pas un nœud déjà dans la course et complète le reste', () => {
    let race = createRace('t1', 3);
    ({ race } = enlistDrones(race, [cand('n1', 'a'), cand('n2', 'b')]));
    expect(race.drones).toHaveLength(2);
    // Deuxième vague : n1 déjà présent → seul n3 complète (facteur 3).
    const { race: race2, launch } = enlistDrones(race, [cand('n1', 'a'), cand('n3', 'c')]);
    expect(launch).toEqual(['n3']);
    expect(race2.drones.map((d) => d.nodeId).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('n’enrôle rien si la course est déjà tranchée', () => {
    let race = createRace('t1', 3);
    ({ race } = enlistDrones(race, [cand('n1', 'a')]));
    ({ race } = recordDroneResult(race, 'n1', true)); // n1 gagne → course tranchée
    const { launch } = enlistDrones(race, [cand('n9', 'z')]);
    expect(launch).toEqual([]);
  });
});

describe('recordDroneResult', () => {
  it('le 1er succès gagne et fait annuler les autres drones en vol', () => {
    let race = createRace('t1', 3);
    ({ race } = enlistDrones(race, [cand('n1', 'a'), cand('n2', 'b'), cand('n3', 'c')]));
    const { race: race2, decision } = recordDroneResult(race, 'n2', true);
    expect(decision.outcome).toBe('won');
    expect(race2.winner).toBe('n2');
    expect(race2.decided).toBe(true);
    expect(decision.cancel.sort()).toEqual(['n1', 'n3']);
  });

  it('un résultat arrivé après décision est ignoré (idempotence)', () => {
    let race = createRace('t1', 2);
    ({ race } = enlistDrones(race, [cand('n1', 'a'), cand('n2', 'b')]));
    ({ race } = recordDroneResult(race, 'n1', true)); // n1 gagne
    const late = recordDroneResult(race, 'n2', true); // n2 arrive trop tard
    expect(late.decision.outcome).toBe('lost');
    expect(late.decision.cancel).toEqual([]);
    expect(late.race.winner).toBe('n1');
  });

  it('échec d’un drone alors que d’autres courent → pending', () => {
    let race = createRace('t1', 3);
    ({ race } = enlistDrones(race, [cand('n1', 'a'), cand('n2', 'b'), cand('n3', 'c')]));
    const { race: race2, decision } = recordDroneResult(race, 'n1', false);
    expect(decision.outcome).toBe('pending');
    expect(runningDrones(race2).sort()).toEqual(['n2', 'n3']);
  });

  it('échec de tous les drones → all_failed', () => {
    let race = createRace('t1', 2);
    ({ race } = enlistDrones(race, [cand('n1', 'a'), cand('n2', 'b')]));
    ({ race } = recordDroneResult(race, 'n1', false));
    const { decision } = recordDroneResult(race, 'n2', false);
    expect(decision.outcome).toBe('all_failed');
  });

  it('échec partiel puis succès d’un survivant → won sans perdant à annuler', () => {
    let race = createRace('t1', 3);
    ({ race } = enlistDrones(race, [cand('n1', 'a'), cand('n2', 'b'), cand('n3', 'c')]));
    ({ race } = recordDroneResult(race, 'n1', false)); // n1 échoue
    const { race: race2, decision } = recordDroneResult(race, 'n2', true); // n2 gagne
    expect(decision.outcome).toBe('won');
    // n1 a déjà échoué (plus en vol) ; seul n3 est encore en vol → à annuler.
    expect(decision.cancel).toEqual(['n3']);
    expect(race2.winner).toBe('n2');
  });

  it('résultat d’un nœud inconnu de la course : sans effet', () => {
    let race = createRace('t1', 2);
    ({ race } = enlistDrones(race, [cand('n1', 'a')]));
    const { decision } = recordDroneResult(race, 'inconnu', true);
    expect(decision.outcome).toBe('lost');
    expect(decision.cancel).toEqual([]);
  });
});
