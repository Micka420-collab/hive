// La Dérive : ce qui fait pourrir un projet sous autonomie longue.
//
// Ce module ARRÊTE la ruche. Les deux erreurs coûtent, et pas de la même façon :
//
//   · un faux NÉGATIF laisse un projet se dégrader pendant des semaines ;
//   · un faux POSITIF interrompt un travail légitime — et, pire, apprend à
//     l'humain à ignorer l'alarme, ce qui détruit le faux négatif suivant.
//
// Les tests couvrent donc les deux en proportion égale, et vérifient
// explicitement qu'une ruche saine mais DIFFICILE n'est pas arrêtée.

import { describe, expect, it } from 'vitest';
import {
  DIVERSITE_MIN,
  ECHANTILLON_MIN,
  FENETRE,
  HAUSSE_FAUTIVE,
  PART_SUPPRESSIONS_MIN,
  SOLITUDE_JOURS,
  compterLignes,
  mesurerDerive,
  mesurerEntropie,
  mesurerQualite,
  mesurerRepetition,
  mesurerSolitude,
} from '../src/orchestrator/derive.js';
import type { ProductionObservee } from '../src/orchestrator/derive.js';
import type { Verdict } from '../src/orchestrator/gardiennes.js';

const JOUR = 86_400_000;
const NOW = 1_800_000_000_000;

/** Une production, par défaut irréprochable et équilibrée. */
function prod(p: Partial<ProductionObservee> = {}): ProductionObservee {
  return {
    verdict: 'clean',
    ajouts: 10,
    suppressions: 3,
    signature: '',
    createdAt: NOW,
    ...p,
  };
}

/** `n` productions identiques. */
function lot(n: number, p: Partial<ProductionObservee> = {}): ProductionObservee[] {
  return Array.from({ length: n }, () => prod(p));
}

describe('dérive — compter un diff', () => {
  it('ignore les en-têtes de fichier', () => {
    // Sans ça, chaque fichier ajouterait un faux « +1 / −1 » — assez, sur une
    // fenêtre de petits diffs, pour faire passer un cliquet pour un travail sain.
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      '-vieux',
      '+neuf',
      '+encore',
    ].join('\n');
    expect(compterLignes(diff)).toEqual({ ajouts: 2, suppressions: 1 });
  });

  it('rend zéro sur un diff vide', () => {
    expect(compterLignes('')).toEqual({ ajouts: 0, suppressions: 0 });
  });
});

describe('dérive — la qualité glisse', () => {
  it('ne se prononce pas sous l’échantillon minimal', () => {
    // Sur dix productions, une seule mauvaise ferait bouger le taux de dix
    // points : on arrêterait une ruche saine sur du bruit.
    const i = mesurerQualite(lot(ECHANTILLON_MIN - 1));
    expect(i.etat).toBe('indeterminee');
    expect(i.constat).toMatch(new RegExp(`${ECHANTILLON_MIN} nécessaires`));
  });

  it('une ruche stable est saine', () => {
    expect(mesurerQualite(lot(40)).etat).toBe('saine');
  });

  it('attrape une qualité qui se dégrade entre les deux moitiés', () => {
    // 0 % de fautives puis 40 % : une pente franche.
    const productions = [
      ...lot(20, { verdict: 'clean' }),
      ...lot(8, { verdict: 'hollow' }),
      ...lot(12, { verdict: 'clean' }),
    ];
    const i = mesurerQualite(productions);
    expect(i.etat).toBe('degradee');
    expect(i.constat).toMatch(/0 % → 40 %/);
  });

  it('ne punit PAS un projet durablement difficile', () => {
    // 30 % de productions suspectes du début à la fin : le NIVEAU est haut,
    // la PENTE est nulle. Juger le niveau punirait les projets durs et
    // laisserait filer les projets faciles qui s'effondrent lentement.
    const dur = [
      ...Array.from({ length: 40 }, (_, k) =>
        prod({ verdict: (k % 10 < 3 ? 'suspect' : 'clean') as Verdict }),
      ),
    ];
    const i = mesurerQualite(dur);
    expect(i.etat).toBe('saine');
  });

  it('une amélioration n’est jamais une dégradation', () => {
    const productions = [...lot(20, { verdict: 'hollow' }), ...lot(20, { verdict: 'clean' })];
    expect(mesurerQualite(productions).etat).toBe('saine');
  });

  it('le seuil se franchit là où il est annoncé', () => {
    // Exactement HAUSSE_FAUTIVE de hausse : 0 % → 15 %.
    const productions = [
      ...lot(20, { verdict: 'clean' }),
      ...lot(3, { verdict: 'hollow' }),
      ...lot(17, { verdict: 'clean' }),
    ];
    const i = mesurerQualite(productions);
    expect(i.valeur).toBeCloseTo(HAUSSE_FAUTIVE * 100, 5);
    expect(i.etat).toBe('degradee');
  });
});

describe('dérive — le cliquet de complexité', () => {
  it('un travail qui supprime autant qu’il ajoute est sain', () => {
    expect(mesurerEntropie(lot(30, { ajouts: 10, suppressions: 10 })).etat).toBe('saine');
  });

  it('attrape un dépôt où plus rien n’est jamais retiré', () => {
    // Chaque commit est défendable ; la somme ne l'est pas.
    const i = mesurerEntropie(lot(30, { ajouts: 100, suppressions: 0 }));
    expect(i.etat).toBe('degradee');
    expect(i.constat).toMatch(/0 % de suppressions/);
  });

  it('un peu de suppression suffit à sortir du rouge', () => {
    // Le seuil est BAS exprès : on n'impose pas un ratio vertueux, on attrape
    // le cas où plus rien n'est retiré.
    const i = mesurerEntropie(lot(30, { ajouts: 100, suppressions: 20 }));
    expect(i.etat).toBe('saine');
    expect(i.valeur).toBeGreaterThan(PART_SUPPRESSIONS_MIN);
  });

  it('ignore les productions sans diff', () => {
    // Un échec ou une tâche d'analyse n'a pas d'avis sur le cliquet ; les
    // inclure diluerait le signal jusqu'à l'effacer.
    const productions = [
      ...lot(30, { ajouts: 100, suppressions: 0 }),
      ...lot(200, { ajouts: 0, suppressions: 0 }),
    ];
    expect(mesurerEntropie(productions).etat).toBe('degradee');
  });

  it('ne se prononce pas sur trop peu de diffs', () => {
    expect(mesurerEntropie(lot(5, { ajouts: 100, suppressions: 0 })).etat).toBe('indeterminee');
  });
});

describe('dérive — la ruche tourne en rond', () => {
  it('des échecs variés ne sont pas une boucle', () => {
    const productions = Array.from({ length: 20 }, (_, k) => prod({ signature: `erreur ${k}` }));
    expect(mesurerRepetition(productions).etat).toBe('saine');
  });

  it('attrape la même erreur répétée sans fin', () => {
    // Le mode d'échec le plus coûteux : du temps-machine réel pour zéro.
    const i = mesurerRepetition(lot(20, { signature: 'toujours la meme' }));
    expect(i.etat).toBe('degradee');
    expect(i.constat).toMatch(/1 cause\(s\) distincte\(s\) pour 20 échec\(s\)/);
  });

  it('peu d’échecs est une bonne nouvelle, pas une indétermination', () => {
    // On ne peut rien dire de la diversité de ce qui n'existe pas — mais
    // « presque aucun échec » ne doit surtout pas arrêter la ruche.
    const i = mesurerRepetition([...lot(50), prod({ signature: 'un seul' })]);
    expect(i.etat).toBe('saine');
  });

  it('le seuil se lit sur les signatures distinctes', () => {
    // 6 causes pour 20 échecs = 30 %, exactement DIVERSITE_MIN.
    const productions = Array.from({ length: 20 }, (_, k) => prod({ signature: `e${k % 6}` }));
    const i = mesurerRepetition(productions);
    expect(i.valeur).toBeCloseTo(DIVERSITE_MIN, 2);
    expect(i.etat).not.toBe('degradee');
  });
});

describe('dérive — la solitude', () => {
  it('un humain récent : rien à signaler', () => {
    expect(mesurerSolitude(NOW - 2 * JOUR, NOW).etat).toBe('saine');
  });

  it('un long silence met sous surveillance, JAMAIS en dégradation', () => {
    // L'utilisateur veut des semaines d'autonomie : le silence n'est pas une
    // faute. Il resserre la surveillance, il ne condamne pas.
    const i = mesurerSolitude(NOW - 30 * JOUR, NOW);
    expect(i.etat).toBe('a_surveiller');
    expect(i.valeur).toBe(30);
  });

  it('aucun apport connu vaut surveillance', () => {
    expect(mesurerSolitude(null, NOW).etat).toBe('a_surveiller');
  });

  it('le seuil est celui annoncé', () => {
    expect(mesurerSolitude(NOW - (SOLITUDE_JOURS - 1) * JOUR, NOW).etat).toBe('saine');
    expect(mesurerSolitude(NOW - SOLITUDE_JOURS * JOUR, NOW).etat).toBe('a_surveiller');
  });
});

describe('dérive — le verdict d’ensemble', () => {
  const sain = { productions: lot(60), dernierApportHumain: NOW - JOUR, now: NOW };

  it('une ruche saine reste saine', () => {
    const d = mesurerDerive(sain);
    expect(d.etat).toBe('saine');
    expect(d.motif).toBe('');
  });

  it('UN SEUL indicateur rouge prononce la dégradation', () => {
    // Pas de moyenne : un score composite laisserait un voyant rouge se cacher
    // derrière trois verts.
    const d = mesurerDerive({
      ...sain,
      productions: lot(60, { ajouts: 100, suppressions: 0 }),
    });
    expect(d.etat).toBe('degradee');
    expect(d.motif).toMatch(/suppressions/);
    // Les autres indicateurs sont bien verts : c'est le point du test.
    const verts = d.indicateurs.filter((i) => i.etat === 'saine').length;
    expect(verts).toBeGreaterThanOrEqual(2);
  });

  it('EN SOLITUDE, un simple doute suffit', () => {
    // Un doute au bout de trois jours se lève au prochain passage d'un humain ;
    // un doute au bout de six semaines ne se lèvera pas tout seul.
    const douteux = [
      ...lot(20, { verdict: 'clean' }),
      ...lot(2, { verdict: 'suspect' }),
      ...lot(18, { verdict: 'clean' }),
    ];
    // Avec un humain récent : simple surveillance.
    expect(
      mesurerDerive({ productions: douteux, dernierApportHumain: NOW - JOUR, now: NOW }).etat,
    ).toBe('a_surveiller');
    // Après un mois de silence : dégradation.
    const isole = mesurerDerive({
      productions: douteux,
      dernierApportHumain: NOW - 30 * JOUR,
      now: NOW,
    });
    expect(isole.etat).toBe('degradee');
    expect(isole.motif).toMatch(/seuil resserré/);
  });

  it('la solitude SEULE n’arrête jamais une ruche saine', () => {
    // Six semaines d'autonomie impeccable doivent rester possibles : c'est la
    // demande, et le module ne doit pas la trahir par excès de prudence.
    const d = mesurerDerive({
      productions: lot(200),
      dernierApportHumain: NOW - 42 * JOUR,
      now: NOW,
    });
    expect(d.etat).toBe('saine');
    expect(d.solitudeJours).toBe(42);
  });

  it('ne pas pouvoir mesurer n’est PAS être sain', () => {
    // Une ruche qui perdrait ses Gardiennes verrait sinon sa dérive devenir
    // invisible juste au moment où elle devient possible.
    const d = mesurerDerive({ productions: lot(3), dernierApportHumain: NOW, now: NOW });
    expect(d.etat).toBe('indeterminee');
    expect(d.etat).not.toBe('saine');
  });

  it('une fenêtre vide est indéterminée, jamais saine', () => {
    const d = mesurerDerive({ productions: [], dernierApportHumain: null, now: NOW });
    expect(d.etat).toBe('indeterminee');
  });

  it('la fenêtre est bornée et retient les productions RÉCENTES', () => {
    // Un historique de plusieurs semaines ne doit ni faire exploser le calcul,
    // ni laisser un passé lointain masquer une dégradation d'aujourd'hui.
    const productions = [
      ...lot(FENETRE, { ajouts: 10, suppressions: 10 }),
      ...lot(FENETRE, { ajouts: 100, suppressions: 0 }),
    ];
    const d = mesurerDerive({ ...sain, productions });
    expect(d.echantillon).toBe(FENETRE);
    expect(d.etat).toBe('degradee');
  });

  it('rend les quatre indicateurs, toujours', () => {
    // L'humain doit pouvoir comprendre un arrêt sans lire le code.
    const d = mesurerDerive(sain);
    expect(d.indicateurs.map((i) => i.cle).sort()).toEqual([
      'entropie',
      'qualite',
      'repetition',
      'solitude',
    ]);
    for (const i of d.indicateurs) expect(i.constat.length).toBeGreaterThan(0);
  });

  it('le verdict est REJOUABLE : même entrée, même sortie', () => {
    // Une ruche autonome dont on ne peut pas rejouer les arrêts est une ruche
    // dont on ne peut pas expliquer les actes.
    const a = mesurerDerive(sain);
    const b = mesurerDerive(sain);
    expect(a).toEqual(b);
  });
});
