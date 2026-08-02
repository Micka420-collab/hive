// LE GARDE-BADGE, ÉPROUVÉ — y compris sur ce qui l'aurait rendu creux.
//
// L'outil compare le compte réel de la suite au chiffre des badges. Ses deux
// façons de mentir dans le sens rassurant sont ici :
//
//   · un rapport tronqué rend `undefined`, `Number(undefined)` rend `NaN`, et
//     `NaN !== n` est vrai pour tout n — sans garde, un rapport illisible
//     passerait pour « badges à jour » ;
//   · un README sans badge rend `null`, qu'il ne faut surtout pas confondre
//     avec « ce README annonce zéro test ».

import { describe, expect, it } from 'vitest';
import {
  READMES,
  badgeCorrige,
  compteReel,
  nombreDuBadge,
  verdict,
} from '../scripts/compte-tests.mjs';

const BADGE = (n) =>
  `![Tests](https://img.shields.io/badge/tests-${n}%20passing-F6C445?labelColor=17130C)`;

describe('LE CHIFFRE LU DANS UN BADGE', () => {
  it('se lit dans la forme réellement employée par les READMEs', () => {
    expect(nombreDuBadge(BADGE(2821))).toBe(2821);
  });

  it('rend null — et non zéro — quand le badge est absent', () => {
    // Zéro ferait passer un README mutilé pour un README en retard : l'outil
    // « corrigerait » alors un fichier dont la forme est cassée.
    expect(nombreDuBadge('# Hive\n\nAucun badge ici.')).toBeNull();
  });

  it('ne se laisse pas prendre par un autre badge du même README', () => {
    const doc = `![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-F6C445)\n${BADGE(1234)}`;
    expect(nombreDuBadge(doc)).toBe(1234);
  });

  it('la correction ne touche QUE le chiffre', () => {
    const avant = `${BADGE(1)}\n\nDu texte avec 2820 dedans.\n`;
    const apres = badgeCorrige(avant, 999);
    expect(apres).toContain('tests-999%20passing');
    expect(apres, 'la prose a été touchée').toContain('Du texte avec 2820 dedans.');
    expect(apres, 'la couleur du badge a été perdue').toContain('F6C445');
  });
});

describe('LE COMPTE RÉEL LU DANS LE RAPPORT', () => {
  it('se lit quand il est là', () => {
    expect(compteReel({ numTotalTests: 2821 })).toBe(2821);
  });

  it.each([
    ['rapport vide', {}],
    ['champ absent', { numPassedTests: 12 }],
    ['zéro test', { numTotalTests: 0 }],
    ['pas un entier', { numTotalTests: 12.5 }],
    ['pas un nombre', { numTotalTests: 'beaucoup' }],
    ['rapport nul', null],
  ])('rend null sur : %s', (_, rapport) => {
    // C'est CETTE ligne qui empêche le faux vert : sans elle, `NaN` remonterait
    // jusqu'à la comparaison, où toute inégalité est vraie et toute égalité
    // fausse — l'outil dirait « à corriger » ou « à jour » au hasard.
    expect(compteReel(rapport)).toBeNull();
  });
});

describe('LE VERDICT', () => {
  const b = (nom, annonce) => ({ nom, annonce });

  it('est vert quand les deux badges portent le compte réel', () => {
    const v = verdict(2821, [b('README.md', 2821), b('README.en.md', 2821)]);
    expect(v.ok).toBe(true);
    expect(v.aCorriger).toEqual([]);
    expect(v.message).toContain('2821');
  });

  it('REFUSE un rapport illisible plutôt que de conclure', () => {
    const v = verdict(null, [b('README.md', 2821), b('README.en.md', 2821)]);
    expect(v.ok, 'un rapport illisible a été pris pour un accord').toBe(false);
    expect(v.aCorriger, 'on a proposé de corriger sur un compte inconnu').toEqual([]);
    expect(v.message).toMatch(/numTotalTests/);
  });

  it('REFUSE de corriger un README dont le badge a disparu', () => {
    // Corriger ici voudrait dire réinventer une ligne de badge dont on ne
    // connaît ni la place ni la forme. On constate, on n'invente pas.
    const v = verdict(2821, [b('README.md', 2821), b('README.en.md', null)]);
    expect(v.ok).toBe(false);
    expect(v.aCorriger).toEqual([]);
    expect(v.message).toContain('README.en.md');
  });

  it('ne désigne QUE les README réellement en retard', () => {
    const v = verdict(2821, [b('README.md', 2730), b('README.en.md', 2821)]);
    expect(v.ok).toBe(false);
    expect(v.aCorriger, 'un README à jour a été désigné à la correction').toEqual(['README.md']);
    expect(v.message).toContain('README.md → 2730');
  });

  it('désigne les deux quand les deux sont en retard — le cas réel', () => {
    // C'est ce qui s'est produit deux fois : les deux badges d'accord, et faux
    // ensemble. La garde qui les compare l'un à l'autre ne pouvait rien y voir.
    const v = verdict(2821, [b('README.md', 2730), b('README.en.md', 2730)]);
    expect(v.aCorriger).toEqual(['README.md', 'README.en.md']);
  });
});

describe('LES DEUX README SONT BIEN CEUX DU DÉPÔT', () => {
  it('la liste ne s’est pas vidée', () => {
    // Une liste vide rendrait tous les verdicts verts sans rien avoir regardé.
    expect(READMES).toEqual(['README.md', 'README.en.md']);
  });
});
