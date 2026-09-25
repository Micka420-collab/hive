// L'annonce du mode simulation dit ce qui est vrai pour le jeton EN PLACE.

import { describe, expect, it } from 'vitest';
import { annonceSimulation } from '../src/shared/annonce-simulation.js';
import { DEFAULT_TOKEN } from '../src/shared/types.js';

describe('annonceSimulation', () => {
  it('UN JETON ALÉATOIRE N’EST PAS « LE JETON PAR DÉFAUT » — l’installeur vient d’en poser un', () => {
    const ligne = annonceSimulation('e82c2dcae7bbf2a78694c85306fb595e');
    expect(ligne).not.toMatch(/par défaut|trivial/);
    expect(ligne).toMatch(/simulation/);
  });

  it('le jeton par défaut ou trop court EST annoncé comme toléré', () => {
    expect(annonceSimulation(DEFAULT_TOKEN)).toMatch(/jeton trivial toléré/);
    expect(annonceSimulation('court')).toMatch(/jeton trivial toléré/);
  });
});
