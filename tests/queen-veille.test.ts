import { describe, expect, it } from 'vitest';
import { conseilVeilleBrief } from '../src/orchestrator/queen-veille.js';

describe('queen-veille', () => {
  it('silence sur un brief sans signal de recherche', () => {
    expect(conseilVeilleBrief('Créer une API REST CRUD')).toBeNull();
  });

  it('conseille la veille quand le brief le demande', () => {
    const c = conseilVeilleBrief('Faire une recherche sur les alternatives open source');
    expect(c).toMatch(/VEILLE TECHNO/);
    expect(c).toMatch(/OpenAlex/);
  });
});
