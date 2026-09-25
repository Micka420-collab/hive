import { describe, expect, it } from 'vitest';
import type { Categorie } from '../src/orchestrator/aiguillage.js';
import { registreGenomeDepuisEvenements } from '../src/shared/registre-genome.js';
import type { HiveEvent } from '../src/shared/types.js';

let id = 0;
const ev = (type: string, payload: Record<string, unknown>): HiveEvent => {
  id += 1;
  return { id, ts: 1_000 + id, type, payload };
};

const categories: Record<string, Categorie> = { t1: 'code', t2: 'correction', t3: 'code' };
const categorieDe = (taskId: string): Categorie | null => categories[taskId] ?? null;

describe('registre Genome', () => {
  it('garde séparés rendu, avis, revue humaine et durée — le coût reste inconnu', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'alpha' }),
        ev('task_done', { taskId: 't1', nodeId: 'n1', durationMs: 1_200 }),
        ev('contre_expertise_verdict', {
          source: 'hive_counter_review',
          taskId: 't1',
          conteste: false,
        }),
        ev('task_reviewed', { taskId: 't1', state: 'approved' }),
      ],
      categorieDe,
    );

    expect(registre.lignes).toEqual([
      {
        modele: 'alpha',
        categorie: 'code',
        affectations: 1,
        rendus: 1,
        reprises: 0,
        echecs: 0,
        refus: 0,
        interrompues: 0,
        corrections: 0,
        avis: { valides: 1, contestes: 0, modeleProuve: 0 },
        humain: { approuvees: 1, rejetees: 0 },
        dureeMedianeMs: 1_200,
        coutFournisseur: 'inconnu',
        dureeModele: 'inconnu',
        modelesExacts: [],
      },
    ]);
  });

  it('somme ce que le CLI déclare, par tentative rendue, et nomme les modèles exacts', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'sonnet' }),
        ev('task_retry', {
          taskId: 't1',
          nodeId: 'n1',
          fournisseur: { source: 'claude-code', coutUsd: 0.02, dureeApiMs: 800 },
        }),
        ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'sonnet' }),
        // Tentative sans déclaration : comptée dans la couverture, pas estimée.
        ev('task_failed', { taskId: 't1', nodeId: 'n1', attempts: 3 }),
        ev('task_assigned', { taskId: 't3', nodeId: 'n1', modele: 'sonnet' }),
        ev('task_done', {
          taskId: 't3',
          nodeId: 'n1',
          durationMs: 5_000,
          fournisseur: {
            source: 'claude-code',
            coutUsd: 0.05,
            dureeApiMs: 3_200,
            modeles: ['claude-sonnet-4-5-20250929'],
          },
        }),
      ],
      categorieDe,
    );

    expect(registre.lignes).toHaveLength(1);
    const [ligne] = registre.lignes;
    expect(ligne?.dureeModele).toEqual({ total: 4_000, declarees: 2, tentatives: 3 });
    expect(ligne?.coutFournisseur).toMatchObject({ declarees: 2, tentatives: 3 });
    expect(ligne?.coutFournisseur !== 'inconnu' && ligne?.coutFournisseur.total).toBeCloseTo(
      0.07,
      10,
    );
    expect(ligne?.modelesExacts).toEqual(['claude-sonnet-4-5-20250929']);
  });

  it('attribue la reprise au modèle en cours et la correction à la dernière production', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 't2', nodeId: 'n1', modele: 'alpha' }),
        ev('task_retry', { taskId: 't2', nodeId: 'n1', attempt: 1 }),
        ev('task_assigned', { taskId: 't2', nodeId: 'n2', modele: 'beta' }),
        ev('task_done', { taskId: 't2', nodeId: 'n2', durationMs: 400 }),
        ev('task_reviewed', { taskId: 't2', state: 'approved' }),
        ev('task_retry', { taskId: 't2', source: 'evaluator', decision: 'correction_required' }),
        ev('task_assigned', { taskId: 't2', nodeId: 'n2', modele: 'beta' }),
        ev('task_done', { taskId: 't2', nodeId: 'n2', durationMs: 600 }),
        ev('task_reviewed', { taskId: 't2', state: 'rejected' }),
      ],
      categorieDe,
    );
    const [alpha, beta] = registre.lignes;

    expect(alpha).toMatchObject({ modele: 'alpha', affectations: 1, reprises: 1, rendus: 0 });
    // L'approbation humaine de la première production a été effacée par la
    // correction : seule la revue de la production finale compte.
    expect(beta).toMatchObject({
      modele: 'beta',
      categorie: 'correction',
      affectations: 2,
      rendus: 2,
      corrections: 1,
      humain: { approuvees: 0, rejetees: 1 },
      dureeMedianeMs: 500,
    });
  });

  it('laisse l’absence absente : pas de modèle déclaré, pas de ligne inventée', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 't1', nodeId: 'n1' }),
        ev('task_done', { taskId: 't1', nodeId: 'n1', durationMs: 50 }),
        // Issue d'une affectation sortie de la fenêtre du journal.
        ev('task_done', { taskId: 't3', nodeId: 'n9', durationMs: 70 }),
        // Tâche disparue : sa catégorie est inconnue, l'événement est ignoré.
        ev('task_assigned', { taskId: 'disparue', nodeId: 'n1', modele: 'alpha' }),
      ],
      categorieDe,
    );

    expect(registre.lignes).toEqual([]);
    expect(registre.sansModele).toMatchObject({ affectations: 1, rendus: 1, dureeMedianeMs: 50 });
  });

  it('n’attribue pas l’issue d’un autre nœud à l’affectation en cours', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'alpha' }),
        ev('task_failed', { taskId: 't1', nodeId: 'n-ancien', attempts: 3 }),
      ],
      categorieDe,
    );

    expect(registre.lignes[0]).toMatchObject({ affectations: 1, echecs: 0 });
  });

  it('préfère le modèle prouvé par l’avis au modèle commandé', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'alpha' }),
        ev('task_done', { taskId: 't1', nodeId: 'n1', durationMs: 10 }),
        ev('contre_expertise_verdict', {
          source: 'hive_counter_review',
          taskId: 't1',
          producteurModele: 'alpha-2026-09',
          conteste: true,
        }),
        ev('contre_expertise_verdict', { source: 'autre', taskId: 't1', conteste: true }),
      ],
      categorieDe,
    );

    expect(registre.lignes.map((l) => [l.modele, l.avis])).toEqual([
      ['alpha', { valides: 0, contestes: 0, modeleProuve: 0 }],
      ['alpha-2026-09', { valides: 0, contestes: 1, modeleProuve: 1 }],
    ]);
  });

  it('sépare échec, refus et interruption', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'alpha' }),
        ev('task_rejected', { taskId: 't1', nodeId: 'n1', reason: 'busy' }),
        ev('task_assigned', { taskId: 't1', nodeId: 'n2', modele: 'alpha' }),
        ev('task_requeued', { taskId: 't1', nodeId: 'n2', reason: 'node_lost' }),
        ev('task_assigned', { taskId: 't1', nodeId: 'n3', modele: 'alpha' }),
        ev('task_cancelled', { taskId: 't1', nodeId: 'n3', reason: 'humain' }),
        ev('task_assigned', { taskId: 't3', nodeId: 'n1', modele: 'alpha' }),
        ev('task_failed', { taskId: 't3', nodeId: 'n1', attempts: 3 }),
      ],
      categorieDe,
    );

    expect(registre.lignes).toHaveLength(1);
    expect(registre.lignes[0]).toMatchObject({
      affectations: 4,
      refus: 1,
      interrompues: 2,
      echecs: 1,
      rendus: 0,
      dureeMedianeMs: null,
    });
  });

  it('trie par nom sans classer, et signale une fenêtre tronquée', () => {
    const evenements = [
      ev('task_assigned', { taskId: 't2', nodeId: 'n1', modele: 'zeta' }),
      ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'zeta' }),
      ev('task_assigned', { taskId: 't3', nodeId: 'n2', modele: 'alpha' }),
    ];
    const registre = registreGenomeDepuisEvenements(evenements, categorieDe, 3);

    expect(registre.lignes.map((l) => `${l.modele}/${l.categorie}`)).toEqual([
      'alpha/code',
      'zeta/code',
      'zeta/correction',
    ]);
    expect(registre.fenetre).toEqual({
      evenements: 3,
      depuis: evenements[0]!.ts,
      tronquee: true,
    });
    expect(registreGenomeDepuisEvenements([], categorieDe).fenetre).toEqual({
      evenements: 0,
      depuis: null,
      tronquee: false,
    });
  });
});
