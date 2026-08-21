// Bancs du résumé de journal Chambre (activity panel).

import { describe, expect, it } from 'vitest';
import { resumerEvenementChambre } from '../src/orchestrator/chambre-journal.js';

describe('resumerEvenementChambre', () => {
  it('montre outil + chemin constatés', () => {
    const l = resumerEvenementChambre('tool', { outil: 'Edit', chemin: 'src/a.ts', taskId: 't1' });
    expect(l.resume).toBe('Edit · src/a.ts');
    expect(l.detail).toBe('t1');
  });

  it('échec : quoi + pourquoi, sans inventer', () => {
    const l = resumerEvenementChambre(
      'task_failed',
      { title: 'Pont MCP', error: 'timeout' },
      'fr',
    );
    expect(l.resume).toBe('Pont MCP');
    expect(l.detail).toContain('timeout');
  });

  it('sans payload utile : type seul', () => {
    const l = resumerEvenementChambre('tick', {});
    expect(l.resume).toBe('tick');
    expect(l.detail).toBeNull();
  });
});
