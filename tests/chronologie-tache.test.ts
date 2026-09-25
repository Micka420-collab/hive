// Où est passé le temps d'une tâche — phases relues dans le journal, rien
// d'estimé : un bord manquant rend la phase `null`, la latence du modèle et le
// coût fournisseur restent `inconnu`.

import { describe, expect, it } from 'vitest';
import { chronologieDepuisEvenements } from '../src/shared/chronologie-tache.js';
import type { HiveEvent } from '../src/shared/types.js';

let prochainId = 1;
const ev = (ts: number, type: string, payload: Record<string, unknown> = {}): HiveEvent => ({
  id: prochainId++,
  ts,
  type,
  payload: { taskId: 't', ...payload },
});

describe('chronologieDepuisEvenements — les phases d’une tâche', () => {
  it('SÉPARE LES PHASES D’UNE TÂCHE SIMPLE — attente, démarrage, exécution, total', () => {
    const c = chronologieDepuisEvenements(1_000, [
      ev(1_000, 'task_ready'),
      ev(1_400, 'task_assigned', { nodeId: 'n1' }),
      ev(1_500, 'task_started', { nodeId: 'n1' }),
      ev(4_500, 'task_done', { nodeId: 'n1', durationMs: 2_900 }),
    ]);
    expect(c).toMatchObject({
      attenteDependancesMs: 0,
      attenteWorkerMs: 400,
      demarrageMs: 100,
      dureeWorkerTotaleMs: 2_900,
      reprises: 0,
      totalMs: 3_500,
      terminee: true,
    });
    expect(c.tentatives).toEqual([{ issue: 'reussie', dureeWorkerMs: 2_900 }]);
  });

  it('DISTINGUE L’ATTENTE DES DÉPENDANCES DE L’ATTENTE D’UN WORKER', () => {
    const c = chronologieDepuisEvenements(0, [
      ev(5_000, 'task_ready'),
      ev(5_200, 'task_assigned', { nodeId: 'n1' }),
    ]);
    expect(c.attenteDependancesMs, 'le temps passé à attendre les dépendances').toBe(5_000);
    expect(c.attenteWorkerMs, 'puis le temps à attendre un Worker libre').toBe(200);
  });

  it('COMPTE LES REPRISES ET ADDITIONNE LES DURÉES CONNUES — l’échec d’infra reste sans durée', () => {
    const c = chronologieDepuisEvenements(0, [
      ev(10, 'task_assigned', { nodeId: 'n1' }),
      ev(20, 'task_started', { nodeId: 'n1' }),
      ev(1_000, 'task_retry', { nodeId: 'n1', attempt: 1, durationMs: 900 }),
      ev(1_100, 'task_requeued', { reason: 'node_lost' }),
      ev(3_000, 'task_retry', { nodeId: 'n2', attempt: 2, durationMs: 1_500 }),
      ev(3_100, 'task_failed', { reason: 'no_working_agent' }),
    ]);
    expect(c.reprises, 'deux nouveaux essais et une remise en file').toBe(3);
    expect(c.tentatives.map((t) => t.issue)).toEqual(['reprise', 'reprise', 'echec']);
    expect(c.tentatives[2]?.dureeWorkerMs, 'un refus d’infra n’a pas de durée').toBeNull();
    expect(c.dureeWorkerTotaleMs, 'seules les durées connues s’additionnent').toBe(2_400);
    expect(c.terminee).toBe(true);
  });

  it('MESURE LA REVUE CROISÉE — du lancement au verdict, et seulement si elle a eu lieu', () => {
    const avecRevue = chronologieDepuisEvenements(0, [
      ev(100, 'task_done', { durationMs: 50 }),
      ev(200, 'contre_expertise', { possible: true }),
      ev(900, 'contre_expertise_verdict', {}),
    ]);
    expect(avecRevue.revueMs).toBe(700);
    const impossible = chronologieDepuisEvenements(0, [
      ev(100, 'task_done', { durationMs: 50 }),
      ev(200, 'contre_expertise', { possible: false }),
    ]);
    expect(impossible.revueMs, 'une revue impossible n’a pas de durée').toBeNull();
  });

  it('UN RENVOI DE L’EVALUATOR EST UNE CORRECTION, PAS UN ÉCHEC DU WORKER', () => {
    // La boucle V2 : production réussie → contre-revue insuffisante → renvoi en
    // correction → seconde production. Le renvoi ne porte pas de durée Worker et
    // ne doit pas se lire comme une tentative ratée.
    const c = chronologieDepuisEvenements(0, [
      ev(1_000, 'task_done', { nodeId: 'n1', durationMs: 800 }),
      ev(1_100, 'contre_expertise', { possible: true }),
      ev(1_600, 'contre_expertise_verdict', {}),
      ev(1_700, 'task_retry', { source: 'evaluator', decision: 'refaire', attempt: 1 }),
      ev(3_000, 'task_done', { nodeId: 'n1', durationMs: 1_200 }),
      ev(3_100, 'contre_expertise', { possible: true }),
      ev(3_300, 'contre_expertise_verdict', {}),
      ev(3_400, 'contre_expertise_verdict', {}),
    ]);
    expect(c.corrections).toBe(1);
    expect(c.reprises, 'aucun échec du Worker').toBe(0);
    expect(c.tentatives.map((t) => t.issue)).toEqual(['reussie', 'reussie']);
    expect(c.dureeWorkerTotaleMs).toBe(2_000);
    // Deux fenêtres de revue : 500 ms puis 300 ms (jusqu'au DERNIER verdict).
    expect(c.revueMs).toBe(800);
  });

  it('UNE TÂCHE EN COURS N’A NI TOTAL NI DURÉE INVENTÉS', () => {
    const c = chronologieDepuisEvenements(0, [ev(10, 'task_assigned', { nodeId: 'n1' })]);
    expect(c.terminee).toBe(false);
    expect(c.totalMs).toBeNull();
    expect(c.demarrageMs, 'pas encore démarrée').toBeNull();
    expect(c.dureeWorkerTotaleMs).toBeNull();
  });

  it('LA LATENCE DU MODÈLE ET LE COÛT FOURNISSEUR SONT « INCONNU » — jamais déduits du temps Worker', () => {
    const c = chronologieDepuisEvenements(0, [ev(1_000, 'task_done', { durationMs: 900 })]);
    expect(c.dureeModele).toBe('inconnu');
    expect(c.coutFournisseur).toBe('inconnu');
  });

  it('UNE DURÉE ILLISIBLE N’EST PAS UNE DURÉE — négative, texte ou infinie', () => {
    const c = chronologieDepuisEvenements(0, [
      ev(1, 'task_retry', { durationMs: -5 }),
      ev(2, 'task_retry', { durationMs: '900' }),
      ev(3, 'task_done', { durationMs: Number.POSITIVE_INFINITY }),
    ]);
    expect(c.tentatives.map((t) => t.dureeWorkerMs)).toEqual([null, null, null]);
    expect(c.dureeWorkerTotaleMs).toBeNull();
  });
});
