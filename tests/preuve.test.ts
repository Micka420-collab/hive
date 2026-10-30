// LA PREUVE EST UN COMPTE, PAS UNE OPINION.
//
// Ce qu'on prouve ici : `releverPreuve` compte production par production,
// jamais fait par fait — une production relue deux fois est relue UNE fois ;
// un verdict de la même famille ne vaut pas une relecture croisée ; un coût
// absent est « inconnu », jamais zéro ; un journal élagué le DIT. Et rien
// n'est pondéré : les nombres sont ceux qu'on peut recompter à la main.

import { describe, expect, it } from 'vitest';
import { releverPreuve, TYPES_PREUVE } from '../src/orchestrator/preuve.js';
import type { HiveEvent, HiveNode } from '../src/shared/types.js';

let seq = 0;
const ev = (type: string, payload: Record<string, unknown>, ts = 10_000 + seq): HiveEvent => {
  seq += 1;
  return { id: seq, ts, type, payload };
};

const noeud = (
  nodeId: string,
  status: HiveNode['status'],
  isolement?: HiveNode['isolement'],
): HiveNode =>
  ({
    nodeId,
    name: nodeId,
    ownerName: 'test',
    agentType: 'claude-code',
    maxConcurrency: 1,
    status,
    lastSeen: 0,
    ...(isolement ? { isolement } : {}),
  }) as HiveNode;

const rendue = (taskId: string, resultId: number, coutUsd?: number): HiveEvent =>
  ev('task_done', {
    taskId,
    nodeId: 'prod',
    resultId,
    durationMs: 1,
    ...(coutUsd === undefined ? {} : { fournisseur: { coutUsd } }),
  });

const verdict = (
  taskId: string,
  resultId: number,
  producteur: string,
  relecteur: string,
  conteste: boolean,
): HiveEvent =>
  ev('contre_expertise_verdict', {
    source: 'hive_counter_review',
    taskId,
    resultId,
    producteur,
    relecteur,
    conteste,
    objections: conteste ? ['un test manque'] : [],
  });

const validation = (taskId: string, resultId: number, etats: Record<string, string>): HiveEvent =>
  ev('validation_recorded', { source: 'hive_sandbox', taskId, resultId, validation: etats });

describe('releverPreuve — par production, jamais par fait', () => {
  it('compte les productions rendues par résultat distinct, et le journal vide reste vide', () => {
    const vide = releverPreuve([], [], false);
    expect(vide.productions.rendues).toBe(0);
    expect(vide.fenetre).toEqual({ depuis: null, evenements: 0, elague: false });
    expect(vide.familles).toEqual([]);

    // Deux résultats d'une même tâche (reprise) : deux productions ; le même
    // résultat journalisé deux fois : une seule.
    const p = releverPreuve(
      [rendue('t1', 1), rendue('t1', 2), rendue('t2', 7), rendue('t2', 7)],
      [],
      false,
    );
    expect(p.productions.rendues).toBe(3);
    expect(p.fenetre.evenements).toBe(4);
  });

  it('une relecture par une AUTRE famille compte une fois, même avec deux verdicts', () => {
    const p = releverPreuve(
      [
        rendue('t1', 1),
        verdict('t1', 1, 'claude-code', 'codex', false),
        verdict('t1', 1, 'claude-code', 'cursor', true),
        rendue('t2', 2),
        // La même famille des deux côtés : relue, mais pas croisée.
        verdict('t2', 2, 'codex', 'codex', false),
        rendue('t3', 3),
        // Sans relecture au journal : « sans relecture », pas « probablement relue ».
      ],
      [],
      false,
    );
    expect(p.productions).toEqual({
      rendues: 3,
      reluesParAutreFamille: 1,
      reluesParMemeFamille: 1,
      contestees: 1,
      reprisesApresRelecture: 0,
      relectureImpossible: 0,
    });
    // Les familles, par libellé lisible, triées et sans doublon.
    expect(p.familles).toHaveLength(3);
    expect(p.familles.join(' ')).toMatch(/Claude Code/);
  });

  it('une reprise après relecture est celle de l’Evaluator ; un retry du nœud ne l’est pas', () => {
    const p = releverPreuve(
      [
        rendue('t1', 1),
        ev('task_retry', { taskId: 't1', resultId: 1, source: 'evaluator', reason: 'contesté' }),
        ev('task_retry', { taskId: 't1', resultId: 1, source: 'evaluator', reason: 'encore' }),
        // Un retry « réseau » du nœud : pas une reprise après relecture, mais une
        // tentative dont le coût est inconnu.
        ev('task_retry', { taskId: 't2', nodeId: 'prod', error: 'timeout' }),
        ev('contre_expertise_impossible', {
          taskId: 't3',
          resultId: 9,
          motif: 'aucune_autre_famille',
        }),
      ],
      [],
      false,
    );
    expect(p.productions.reprisesApresRelecture).toBe(1);
    expect(p.productions.relectureImpossible).toBe(1);
    expect(p.cout.inconnues).toBe(2); // t1 rendue sans coût + le retry réseau
  });

  it('le bac : validée si un contrôle a TOURNÉ ; tout vert vs un rouge ; les portes', () => {
    const p = releverPreuve(
      [
        rendue('t1', 1),
        validation('t1', 1, {
          tests: 'passed',
          typecheck: 'passed',
          build: 'not_applicable',
          lint: 'missing',
        }),
        rendue('t2', 2),
        validation('t2', 2, {
          tests: 'failed',
          typecheck: 'passed',
          build: 'passed',
          lint: 'passed',
        }),
        rendue('t3', 3),
        // Rien n'a tourné : ce n'est PAS une validation.
        validation('t3', 3, {
          tests: 'missing',
          typecheck: 'not_applicable',
          build: 'missing',
          lint: 'missing',
        }),
        ev('security_gate_recorded', { taskId: 't1', resultId: 1, nodeId: 'prod' }),
        ev('security_gate_recorded', { taskId: 't1', resultId: 1, nodeId: 'prod' }),
      ],
      [],
      false,
    );
    expect(p.bac).toEqual({ validees: 2, toutPasse: 1, unEchec: 1, portes: 1 });
  });

  it('le coût : déclaré ou inconnu, sommé à 4 décimales, jamais estimé', () => {
    const p = releverPreuve(
      [
        rendue('t1', 1, 0.1234567),
        rendue('t2', 2, 0.2),
        rendue('t3', 3),
        ev('task_failed', { taskId: 't4', resultId: 4, fournisseur: { coutUsd: 0.05 } }),
        ev('task_failed', { taskId: 't5', resultId: 5 }),
      ],
      [],
      false,
    );
    expect(p.cout).toEqual({ declarees: 3, inconnues: 2, totalUsd: 0.3735 });
  });

  it('les humains, les nœuds isolés, la fenêtre et l’élagage', () => {
    const p = releverPreuve(
      [
        rendue('t1', 1, undefined),
        ev('council_decided', { taskId: 't1', decision: 'appliquer' }, 5_000),
        ev('council_decided', { taskId: 't2', decision: 'rejeter' }, 6_000),
      ],
      [
        noeud('a', 'online', { niveau: 'conteneur', fournisseur: 'podman' }),
        noeud('b', 'online', { niveau: 'processus' }),
        noeud('c', 'offline', { niveau: 'aucun' }),
        noeud('d', 'online'),
      ],
      true,
    );
    expect(p.decisionsHumaines).toBe(2);
    expect(p.noeuds).toEqual({ total: 4, enLigne: 3, isoles: 2, conteneur: 1 });
    expect(p.fenetre.depuis).toBe(5_000);
    expect(p.fenetre.elague).toBe(true);
  });

  it('ignore ce qui n’a pas de taskId, et ne lit que les types annoncés', () => {
    const p = releverPreuve(
      [
        ev('task_done', { nodeId: 'prod' }),
        ev('contre_expertise_verdict', { producteur: 'codex', relecteur: 'claude-code' }),
        ev('node_joined', { nodeId: 'x' }),
      ],
      [],
      false,
    );
    expect(p.productions.rendues).toBe(0);
    expect(p.productions.reluesParAutreFamille).toBe(0);
    expect(p.familles).toEqual([]);
    expect(TYPES_PREUVE).toContain('validation_recorded');
    expect(TYPES_PREUVE).not.toContain('node_joined');
  });
});
