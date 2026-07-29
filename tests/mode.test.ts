// Basculer de mode.
//
// Ce module décide ce que la ruche s'autorise à faire sans demander. Les deux
// choses qui comptent ici : on ne monte pas l'échelle par accident, et on ne
// descend pas en devant se justifier.

import { describe, expect, it } from 'vitest';
import {
  MENTION_PLEIN,
  MODES,
  PALIERS,
  type Mode,
  basculer,
  estMode,
  palierDe,
  rang,
} from '../src/shared/mode.js';
import { NIVEAUX } from '../src/orchestrator/essaim.js';

describe('L’ÉCHELLE', () => {
  it('EST EXACTEMENT CELLE D’`essaim.ts` — pas un second vocabulaire', () => {
    // Si les deux listes divergent, la CLI proposerait un mode que la route
    // refuse, ou tairait un mode qui existe. Un réglage persisté ne se
    // renomme pas pour le confort d’un affichage.
    expect([...MODES]).toEqual([...NIVEAUX]);
  });

  it('chaque mode a son palier, et réciproquement', () => {
    expect(PALIERS.map((p) => p.mode)).toEqual([...MODES]);
    for (const m of MODES) expect(palierDe(m), `palier de ${m}`).toBeDefined();
  });

  it('CHAQUE PALIER DIT AUSSI CE QU’IL NE FAIT PAS', () => {
    // La moitié qu'on oublie d'annoncer. « gouverne » sans « ne fusionne
    // jamais » se lit comme un blanc-seing.
    for (const p of PALIERS) {
      expect(p.fait.length, `${p.mode} : ce qu’il fait`).toBeGreaterThan(10);
      expect(p.neFaitPas.length, `${p.mode} : ce qu’il ne fait pas`).toBeGreaterThan(10);
    }
    expect(palierDe('gouverne').neFaitPas).toMatch(/fusionne/i);
  });

  it('l’ordre est un ordre — du plus prudent au plus autonome', () => {
    expect(rang('off')).toBeLessThan(rang('propose'));
    expect(rang('propose')).toBeLessThan(rang('gouverne'));
    expect(rang('gouverne')).toBeLessThan(rang('plein'));
  });

  it('un mot qui n’est pas un mode est reconnu comme tel', () => {
    expect(estMode('plein')).toBe(true);
    expect(estMode('PLEIN'), 'la casse compte').toBe(false);
    expect(estMode('autonome')).toBe(false);
    expect(estMode('')).toBe(false);
  });
});

describe('BASCULER', () => {
  it('MONTER DEMANDE UN ACCORD EXPLICITE', () => {
    // Monter autorise des actions qui n'auront pas de témoin.
    for (const [de, vers] of [
      ['off', 'propose'],
      ['propose', 'gouverne'],
      ['gouverne', 'plein'],
      ['off', 'plein'],
    ] as [Mode, Mode][]) {
      const r = basculer(de, vers);
      expect(r.genre, `${de} → ${vers}`).toBe('bascule');
      if (r.genre === 'bascule') {
        expect(r.confirmation, `${de} → ${vers} doit se confirmer`).toBeDefined();
        expect(r.elargit).toBe(true);
      }
    }
  });

  it('DESCENDRE NE SE CONFIRME PAS — reprendre la main est toujours sûr', () => {
    // Demander « êtes-vous sûr ? » pour retirer des droits est le meilleur
    // moyen d'apprendre aux gens à taper « oui » sans lire, donc de rendre la
    // confirmation inutile le jour où elle compte.
    for (const [de, vers] of [
      ['plein', 'gouverne'],
      ['gouverne', 'propose'],
      ['propose', 'off'],
      ['plein', 'off'],
    ] as [Mode, Mode][]) {
      const r = basculer(de, vers);
      expect(r.genre).toBe('bascule');
      if (r.genre === 'bascule') {
        expect(r.confirmation, `${de} → ${vers} ne doit RIEN demander`).toBeUndefined();
        expect(r.elargit).toBe(false);
      }
    }
  });

  it('avec l’accord donné, la montée passe', () => {
    const r = basculer('off', 'plein', true);
    expect(r.genre).toBe('bascule');
    if (r.genre === 'bascule') {
      expect(r.confirmation).toBeUndefined();
      expect(r.vers).toBe('plein');
      expect(r.elargit, 'ça reste un élargissement, même accordé').toBe(true);
    }
  });

  it('LA MONTÉE VERS `plein` DIT QUE LE NIVEAU NE SUFFIT PAS', () => {
    // Deux interrupteurs en série : le niveau, et l'inscription du dépôt.
    // Taire le second ferait croire qu'un mot suffit à déclencher une fusion.
    const r = basculer('gouverne', 'plein');
    expect(r.genre).toBe('bascule');
    if (r.genre === 'bascule') {
      expect(r.confirmation).toContain(MENTION_PLEIN);
      expect(r.confirmation).toMatch(/inscrit/);
    }
  });

  it('rester au même mode n’est ni une montée ni une demande', () => {
    const r = basculer('gouverne', 'gouverne');
    expect(r.genre).toBe('bascule');
    if (r.genre === 'bascule') {
      expect(r.elargit).toBe(false);
      expect(r.confirmation).toBeUndefined();
    }
  });

  it('un mode inconnu est REFUSÉ, et le refus nomme les quatre', () => {
    const r = basculer('off', 'autonome');
    expect(r.genre).toBe('refus');
    if (r.genre === 'refus') {
      for (const m of MODES) expect(r.motif, `le refus doit citer ${m}`).toContain(m);
    }
  });

  it('un accord donné ne rattrape PAS un mode inconnu', () => {
    // L'accord porte sur l'élargissement, jamais sur la validité du mot.
    expect(basculer('off', 'nimportequoi', true).genre).toBe('refus');
  });
});
