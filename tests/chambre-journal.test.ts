// Bancs du résumé de journal Chambre (activity panel).

import { describe, expect, it } from 'vitest';
import { resumerEvenementChambre } from '../src/orchestrator/chambre-journal.js';

describe('resumerEvenementChambre', () => {
  it('montre outil + chemin constatés', () => {
    const l = resumerEvenementChambre('tool', { outil: 'Edit', chemin: 'src/a.ts', taskId: 't1' });
    expect(l.resume).toBe('src/a.ts');
    expect(l.badge).toBe('EDIT');
    expect(l.detail).toBe('t1');
  });

  it('échec : quoi + pourquoi, sans inventer', () => {
    const l = resumerEvenementChambre('task_failed', { title: 'Pont MCP', error: 'timeout' }, 'fr');
    expect(l.resume).toBe('Pont MCP');
    expect(l.detail).toContain('timeout');
    expect(l.badge).toBe('ÉCHEC');
  });

  it('réquisition expirée (G12) : l’escalade dit quoi, pourquoi, dans les deux langues', () => {
    const payload = { libelle: 'git push (« git push origin main »)', motif: 'échéance dépassée' };
    const fr = resumerEvenementChambre('requisition_expiree', payload, 'fr');
    expect(fr.resume).toContain('git push');
    expect(fr.detail).toBe('échéance dépassée');
    expect(fr.badge).toBe('EXPIRÉ');
    const en = resumerEvenementChambre('requisition_expiree', {}, 'en');
    expect(en.resume).toBe('Requisition expired');
    expect(en.detail).toBe('no decision before the deadline');
    expect(en.badge).toBe('EXPIRED');
  });

  it('arrêt sur plafond : la borne a tenu — ni « ÉCHEC », ni accusation', () => {
    const l = resumerEvenementChambre(
      'task_failed',
      { title: 'Lot borné', taskId: 't1', arretBudgetaire: 'cout' },
      'fr',
    );
    expect(l).toEqual({
      resume: 'Lot borné',
      detail: 'son plafond de coût a tenu — ni échec, ni panne',
      badge: 'BUDGET',
    });
  });

  it('sans payload utile : type seul', () => {
    const l = resumerEvenementChambre('tick', {});
    expect(l.resume).toBe('tick');
    expect(l.detail).toBeNull();
    expect(l.badge).toBe('LOG');
  });
});
