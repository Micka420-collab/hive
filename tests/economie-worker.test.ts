// L'ÉCONOMIE ET LA QUALITÉ D'UN WORKER — ce que ses tentatives ont coûté, et
// ce que l'Evaluator a fait de ses productions.
//
// ─── CE QUE CE BANC DÉFEND ───────────────────────────────────────────────────
//
//   · une tentative est une EXÉCUTION rendue sur un nœud nommé : un renvoi de
//     l'Evaluator, un drone perdu, un échec sans nœud n'en sont pas — les
//     compter ferait baisser une couverture que personne ne pouvait remplir ;
//   · un coût est une somme DÉCLARÉE avec sa couverture : « ≥ » dès qu'une
//     tentative s'est tue, `inconnu` sans aucune — jamais extrapolé ;
//   · une tentative va au Worker que NOMME son issue, et au modèle que
//     l'Aiguillage a commandé à CE nœud : jamais à un modèle deviné ;
//   · la qualité, ce sont DEUX mesures séparées, et une part n'est dite qu'à
//     partir de trois productions tranchées.

import { describe, expect, it } from 'vitest';
import {
  bilanEconomique,
  fenetreLue,
  tentativeRendue,
  tentativesDepuisEvenements,
} from '../src/shared/economie.js';
import {
  SEUIL_QUALITE_WORKER,
  economieParWorker,
  projeterWorkers,
  qualiteDesProductions,
} from '../src/orchestrator/workers.js';
import type { ProductionJugee } from '../src/orchestrator/workers.js';
import type { HiveEvent, HiveNode } from '../src/shared/types.js';

let seq = 0;
const ev = (type: string, payload: Record<string, unknown>, ts = 1_000 + seq): HiveEvent => {
  seq += 1;
  return { id: seq, ts, type, payload };
};

const fournisseur = (coutUsd?: number, dureeApiMs?: number) => ({
  fournisseur: {
    ...(coutUsd === undefined ? {} : { coutUsd }),
    ...(dureeApiMs === undefined ? {} : { dureeApiMs }),
  },
});

describe('une tentative rendue', () => {
  it('est une exécution qui a rendu une issue, sur un nœud nommé — et rien d’autre', () => {
    const lues = [
      ev('task_done', { taskId: 't', nodeId: 'n', durationMs: 10 }),
      ev('task_retry', { taskId: 't', nodeId: 'n', durationMs: 5 }),
      ev('task_failed', { taskId: 't', nodeId: 'n', durationMs: 7 }),
      ev('drone_failed', { taskId: 't', nodeId: 'n' }),
    ].map(tentativeRendue);
    expect(lues.map((t) => t?.reussie)).toEqual([true, false, false, false]);

    // Un renvoi de l'Evaluator relance une production RÉUSSIE : aucune
    // exécution n'a eu lieu. Un drone perdu n'a pas d'issue. Un échec sans
    // nœud (« aucun agent qui fonctionne ») n'est l'exécution de personne.
    expect(
      tentativeRendue(ev('task_retry', { taskId: 't', nodeId: 'n', source: 'evaluator' })),
    ).toBeNull();
    expect(
      tentativeRendue(ev('drone_failed', { taskId: 't', nodeId: 'n', reason: 'node_lost' })),
    ).toBeNull();
    expect(
      tentativeRendue(ev('task_failed', { taskId: 't', reason: 'no_working_agent' })),
    ).toBeNull();
    expect(tentativeRendue(ev('task_rejected', { taskId: 't', nodeId: 'n' }))).toBeNull();
  });
});

describe('le bilan économique', () => {
  it('somme ce qui est DÉCLARÉ, avec sa couverture, et prend la médiane des seules réussites', () => {
    const bilan = bilanEconomique(
      tentativesDepuisEvenements([
        ev('task_done', { taskId: 'a', nodeId: 'n', durationMs: 100, ...fournisseur(0.5, 40) }),
        ev('task_retry', { taskId: 'b', nodeId: 'n', durationMs: 900 }),
        ev('task_done', { taskId: 'b', nodeId: 'n', durationMs: 300, ...fournisseur(0.25) }),
        ev('task_done', { taskId: 'c', nodeId: 'n', durationMs: 200 }),
      ]),
    );
    expect(bilan.tentatives).toBe(4);
    expect(bilan.reussies).toBe(3);
    // Deux tentatives sur quatre déclarent un coût : c'est « au moins » 0,75 $.
    expect(bilan.coutFournisseur).toEqual({ total: 0.75, declarees: 2, tentatives: 4 });
    expect(bilan.dureeModele).toEqual({ total: 40, declarees: 1, tentatives: 4 });
    expect(bilan.dureeWorker).toEqual({ totalMs: 1_500, mesurees: 4 });
    // L'échec de 900 ms n'entre pas dans la médiane d'une réussite.
    expect(bilan.dureeMedianeMs).toBe(200);
  });

  it('sans aucune déclaration, le coût est INCONNU — jamais zéro', () => {
    const bilan = bilanEconomique(
      tentativesDepuisEvenements([ev('task_done', { taskId: 'a', nodeId: 'n', durationMs: 5 })]),
    );
    expect(bilan.coutFournisseur).toBe('inconnu');
    expect(bilan.dureeModele).toBe('inconnu');
    expect(bilanEconomique([])).toMatchObject({
      tentatives: 0,
      coutFournisseur: 'inconnu',
      dureeWorker: null,
      dureeMedianeMs: null,
    });
  });

  it('dit sa fenêtre, et qu’elle a pu perdre des faits', () => {
    const lus = [ev('task_done', { taskId: 'a', nodeId: 'n' }, 50), ev('task_done', {}, 20)];
    expect(fenetreLue(lus, 10, false)).toEqual({ evenements: 2, depuis: 20, tronquee: false });
    expect(fenetreLue(lus, 2, false).tronquee).toBe(true);
    expect(fenetreLue(lus, 10, true).tronquee).toBe(true);
  });
});

describe('l’économie par Worker et par modèle', () => {
  it('va au Worker que nomme l’issue, et au modèle COMMANDÉ à ce nœud', () => {
    const economies = economieParWorker([
      ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'opus' }),
      ev('task_retry', { taskId: 't1', nodeId: 'n1', durationMs: 10, ...fournisseur(1) }),
      // Reprise ailleurs, sur un autre modèle : ni l'un ni l'autre ne se mélangent.
      ev('task_assigned', { taskId: 't1', nodeId: 'n2', modele: 'gpt' }),
      ev('task_done', { taskId: 't1', nodeId: 'n2', durationMs: 20, ...fournisseur(2) }),
    ]);
    expect(economies.get('n1')?.total.coutFournisseur).toEqual({
      total: 1,
      declarees: 1,
      tentatives: 1,
    });
    expect([...(economies.get('n1')?.parModele.keys() ?? [])]).toEqual(['opus']);
    expect(economies.get('n2')?.parModele.get('gpt')?.reussies).toBe(1);
    expect(economies.get('n2')?.parModele.has('opus')).toBe(false);
  });

  it('lit le modèle de CHAQUE drone d’une course, pas celui du primaire', () => {
    const economies = economieParWorker([
      ev('drone_race_started', {
        taskId: 't',
        drones: ['n1', 'n2'],
        modeles: { n1: 'opus', n2: 'sonnet' },
      }),
      ev('task_assigned', { taskId: 't', nodeId: 'n1', modele: 'opus' }),
      ev('drone_failed', { taskId: 't', nodeId: 'n2', ...fournisseur(0.1) }),
      ev('task_done', { taskId: 't', nodeId: 'n1', ...fournisseur(0.3) }),
    ]);
    expect(economies.get('n2')?.parModele.get('sonnet')?.tentatives).toBe(1);
    expect(economies.get('n2')?.parModele.has('opus')).toBe(false);
    expect(economies.get('n1')?.parModele.get('opus')?.reussies).toBe(1);
  });

  it('une issue sans affectation connue compte pour le Worker, pour AUCUN modèle', () => {
    const economies = economieParWorker([
      ev('task_done', { taskId: 't', nodeId: 'n1', ...fournisseur(1) }),
    ]);
    expect(economies.get('n1')?.total.tentatives).toBe(1);
    expect(economies.get('n1')?.parModele.size).toBe(0);
  });

  it('la projection porte le bilan — à zéro pour un Worker sans tentative, absent sans lecture', () => {
    const noeud = (id: string): HiveNode => ({
      id,
      name: id,
      ownerName: 'micka',
      agentType: 'claude-code',
      maxConcurrency: 1,
      running: 0,
      status: 'online',
      lastSeen: 1,
      modeles: ['opus'],
    });
    const economies = economieParWorker([
      ev('task_assigned', { taskId: 't', nodeId: 'actif', modele: 'opus' }),
      ev('task_done', { taskId: 't', nodeId: 'actif', durationMs: 42, ...fournisseur(0.2) }),
    ]);
    const [actif, repos] = projeterWorkers(
      [noeud('actif'), noeud('repos')],
      { verdicts: [], enVol: [] },
      [],
      new Map(),
      new Map(),
      economies,
    );
    expect(actif?.economie?.dureeMedianeMs).toBe(42);
    expect(actif?.modeles?.[0]?.economie?.coutFournisseur).toEqual({
      total: 0.2,
      declarees: 1,
      tentatives: 1,
    });
    expect(repos?.economie).toMatchObject({ tentatives: 0, coutFournisseur: 'inconnu' });
    expect(repos?.modeles?.[0]?.economie?.tentatives).toBe(0);
    const sansLecture = projeterWorkers([noeud('actif')], { verdicts: [], enVol: [] })[0];
    expect(sansLecture?.economie).toBeUndefined();
    expect(sansLecture?.modeles?.[0]?.economie).toBeUndefined();
  });
});

describe('la qualité d’un Worker', () => {
  const p = (decision: ProductionJugee['decision'], corrigee = false): ProductionJugee => ({
    resultId: ++seq,
    decision,
    corrigee,
  });

  it('sous trois productions TRANCHÉES, la part acceptée est inconnue — ses comptes restent dits', () => {
    const q = qualiteDesProductions([p('accepted'), p('accepted')]);
    expect(SEUIL_QUALITE_WORKER).toBe(3);
    expect(q).toMatchObject({ jugees: 2, acceptees: 2, partAcceptee: 'inconnu' });
    expect(q.tauxCorrection).toBe('inconnu');
  });

  it('une production en attente de preuve ou d’un humain n’est pas jugée', () => {
    const q = qualiteDesProductions([
      p('accepted'),
      p('correction_required', true),
      p('rejected', true),
      p('additional_test_required'),
      p('human_review_required'),
      p(null),
    ]);
    expect(q.productions).toBe(6);
    expect(q.jugees).toBe(3);
    expect(q.partAcceptee).toBeCloseTo(1 / 3);
    // Deux mesures séparées : le taux de correction se lit sur les productions
    // au sort CONNU — celle dont personne n'a lu le sort n'est pas « non corrigée ».
    expect(q.sortConnu).toBe(5);
    expect(q.corrigees).toBe(2);
    expect(q.tauxCorrection).toBeCloseTo(2 / 5);
    expect(q.bornee).toBeNull();
  });

  it('des productions au sort inconnu ne suffisent pas à dire un taux de correction', () => {
    const q = qualiteDesProductions([p('accepted'), p(null), p(null), p(null)], 100);
    expect(q.productions).toBe(4);
    expect(q.sortConnu).toBe(1);
    expect(q.tauxCorrection).toBe('inconnu');
    expect(q.bornee).toBe(100);
  });

  it('pile au seuil, la part se dit', () => {
    const q = qualiteDesProductions([p('accepted'), p('accepted'), p('correction_required', true)]);
    expect(q.partAcceptee).toBeCloseTo(2 / 3);
    expect(q.tauxCorrection).toBeCloseTo(1 / 3);
  });
});
