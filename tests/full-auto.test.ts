// LE FULL AUTO, MODULE PUR : le geste lu dans la décision de l'Evaluator, et le
// bilan replié du journal.
//
// Deux propriétés valent le reste :
//
//   1. UN ROUGE QUI N'EST PAS DE LA FAUTE DE L'OUVRIÈRE N'EST NI APPROUVÉ NI
//      RENVOYÉ. Une panne du bac (`retryRecommended` faux) laissée à l'humain :
//      l'approuver validerait une production sans preuve, la renvoyer ferait
//      payer une tentative de plus pour une panne de machine.
//   2. LE BILAN NE COMPTE QUE CE PROJET, ET DEPUIS L'ACTIVATION. Un bilan qui
//      additionnerait les décisions d'un autre projet, ou d'une activation
//      précédente, ne dirait rien de ce que le mode fait ici et maintenant.

import { describe, expect, it } from 'vitest';
import { bilanFullAuto, gesteFullAuto } from '../src/orchestrator/full-auto.js';
import type { HiveEvent } from '../src/shared/types.js';

const ev = (
  id: number,
  type: string,
  payload: Record<string, unknown>,
  ts = id * 1000,
): HiveEvent => ({ id, ts, type, payload }) as HiveEvent;

describe('full auto — le geste', () => {
  it('rien de rouge : approuvée, même sans contre-revue ni preuve de tests', () => {
    for (const decision of [
      'accepted',
      'human_review_required',
      'additional_test_required',
    ] as const) {
      expect(gesteFullAuto({ decision, retryRecommended: false })).toBe('approuver');
    }
  });

  it('un rouge corrigeable : la tâche repart', () => {
    expect(gesteFullAuto({ decision: 'rejected', retryRecommended: true })).toBe('corriger');
    expect(gesteFullAuto({ decision: 'correction_required', retryRecommended: true })).toBe(
      'corriger',
    );
  });

  it('un rouge qui n’est pas de son fait : laissé à l’humain', () => {
    expect(gesteFullAuto({ decision: 'correction_required', retryRecommended: false })).toBe(
      'laisser',
    );
    expect(gesteFullAuto({ decision: 'rejected', retryRecommended: false })).toBe('laisser');
  });
});

describe('full auto — le bilan', () => {
  const taches = new Set(['t1', 't2', 't3']);

  it('compte chaque geste, et les corrections qui n’ont pas pu repartir', () => {
    const b = bilanFullAuto(
      [
        ev(1, 'full_auto_decision', { taskId: 't1', geste: 'approuver' }),
        ev(2, 'full_auto_decision', {
          taskId: 't2',
          geste: 'corriger',
          raison: 'production creuse',
        }),
        ev(3, 'evaluator_retry_skipped', {
          taskId: 't2',
          source: 'full_auto',
          reason: 'attempts_exhausted',
        }),
        ev(4, 'full_auto_decision', { taskId: 't3', geste: 'laisser', raison: 'panne du bac' }),
      ],
      taches,
      0,
    );
    expect([b.validees, b.corrigees, b.laissees, b.bloquees]).toEqual([1, 1, 1, 1]);
    expect(b.derniers.map((d) => [d.id, d.geste])).toEqual([
      [4, 'laisser'],
      [3, 'bloquee'],
      [2, 'corriger'],
      [1, 'approuver'],
    ]);
    expect(b.derniers[1]!.raison).toBe('attempts_exhausted');
  });

  it('ni un autre projet, ni un renvoi humain, ni avant l’activation', () => {
    const b = bilanFullAuto(
      [
        ev(1, 'full_auto_decision', { taskId: 't1', geste: 'approuver' }, 500),
        ev(2, 'full_auto_decision', { taskId: 'ailleurs', geste: 'approuver' }, 5_000),
        ev(
          3,
          'evaluator_retry_skipped',
          { taskId: 't1', source: 'revue_humaine', reason: 'x' },
          5_000,
        ),
        ev(4, 'full_auto_decision', { taskId: 't1', geste: 'inconnu' }, 5_000),
        ev(5, 'full_auto_decision', { taskId: 't2', geste: 'approuver' }, 5_000),
      ],
      taches,
      1_000,
    );
    expect([b.validees, b.corrigees, b.laissees, b.bloquees]).toEqual([1, 0, 0, 0]);
    expect(b.derniers.map((d) => d.taskId)).toEqual(['t2']);
  });
});
