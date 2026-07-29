// Le Cerveau vu comme un graphe.
//
// ─── CE QUE CES TESTS GARDENT ────────────────────────────────────────────────
//
// Une vue en graphe est surtout de l'animation, et l'animation ne se teste pas.
// Ce qui se teste, ce sont les DÉCISIONS — et il y en a trois qui, si elles
// tombent, font MENTIR l'écran plutôt que de le casser :
//
//   1. un lien mort dessiné inventerait une note qui n'existe pas ;
//   2. un lien réciproque compté deux fois collerait deux notes l'une à
//      l'autre sans que rien ne l'explique ;
//   3. un ordre instable ferait sauter le graphe à chaque rafraîchissement,
//      donc « bouger » sans que le savoir ait bougé.

import { describe, expect, it } from 'vitest';
import type { Genre, Note } from '../src/shared/cerveau.js';
import { graphe } from '../src/shared/cerveau-graphe.js';

const JOUR = 86_400_000;
const MAINTENANT = 1_700_000_000_000;

/** Les dates d'une note sont des chaînes ISO — les fichiers s'éditent à la main. */
const iso = (ms: number): string => new Date(ms).toISOString();

const note = (id: string, o: Partial<Note> = {}): Note => ({
  id,
  genre: 'lecon' as Genre,
  titre: `titre de ${id}`,
  corps: '',
  etiquettes: [],
  creee: iso(MAINTENANT),
  recurrences: 1,
  ...o,
});

describe('LES ARÊTES', () => {
  it('UN LIEN MORT N’EST PAS UNE ARÊTE — il est compté à part', () => {
    // Le dessiner vers le vide inventerait à l'écran une note qui n'existe
    // pas, dans la vue même qui sert à repérer les trous.
    const g = graphe([note('a', { corps: 'voir [[fantome]]' })], MAINTENANT);
    expect(g.aretes).toEqual([]);
    expect(g.liensMorts).toEqual([{ de: 'a', vers: 'fantome' }]);
  });

  it('UN LIEN RÉCIPROQUE EST UNE SEULE ARÊTE', () => {
    // Deux arêtes doubleraient la raideur du ressort : deux notes qui se
    // citent mutuellement se colleraient sans raison visible.
    const g = graphe([note('a', { corps: '[[b]]' }), note('b', { corps: '[[a]]' })], MAINTENANT);
    expect(g.aretes).toHaveLength(1);
    expect(g.aretes[0]?.reciproque).toBe(true);
  });

  it('…et le degré ne compte cette relation qu’une fois de chaque côté', () => {
    const g = graphe([note('a', { corps: '[[b]]' }), note('b', { corps: '[[a]]' })], MAINTENANT);
    expect(g.noeuds.map((n) => n.degre)).toEqual([1, 1]);
  });

  it('une note qui SE cite elle-même ne produit pas d’arête', () => {
    // Ressort de longueur nulle sur lui-même : la simulation partirait à
    // l'infini ou resterait figée, selon l'ordre des opérations.
    const g = graphe([note('a', { corps: '[[a]]' })], MAINTENANT);
    expect(g.aretes).toEqual([]);
    expect(g.liensMorts).toEqual([]);
    expect(g.noeuds[0]?.degre).toBe(0);
  });

  it('L’ORDRE EST TOTAL — deux chargements donnent le même graphe', () => {
    // Sans cela, la simulation repart d'un autre état à chaque
    // rafraîchissement, et le graphe saute alors que rien n'a changé.
    const notes = [note('z', { corps: '[[a]]' }), note('a', { corps: '[[m]]' }), note('m')];
    const un = graphe(notes, MAINTENANT);
    const deux = graphe([...notes].reverse(), MAINTENANT);
    expect(un.noeuds.map((n) => n.id)).toEqual(deux.noeuds.map((n) => n.id));
    expect(un.aretes).toEqual(deux.aretes);
  });
});

describe('CE QUE LE GRAPHE DIT DE L’USAGE', () => {
  it('une note JAMAIS servie se distingue d’une note servie aujourd’hui', () => {
    // C'est toute la mesure d'usage : `null` (jamais) et `0` (aujourd'hui) ne
    // doivent pas se confondre, sinon du savoir dormant passerait pour actif.
    const g = graphe(
      [note('jamais'), note('aujourdhui', { serviLe: iso(MAINTENANT) })],
      MAINTENANT,
    );
    const par = new Map(g.noeuds.map((n) => [n.id, n.serviIlYaJours]));
    expect(par.get('jamais')).toBeNull();
    expect(par.get('aujourdhui')).toBe(0);
    expect(g.servies).toBe(1);
  });

  it('l’âge et l’ancienneté du service se comptent en jours', () => {
    const g = graphe(
      [
        note('vieille', {
          creee: iso(MAINTENANT - 10 * JOUR),
          serviLe: iso(MAINTENANT - 3 * JOUR),
        }),
      ],
      MAINTENANT,
    );
    expect(g.noeuds[0]?.ageJours).toBe(10);
    expect(g.noeuds[0]?.serviIlYaJours).toBe(3);
  });

  it('une horloge qui recule ne fabrique pas d’âge négatif', () => {
    // Un `serviLe` postérieur à `maintenant` arrive dès qu'une machine a
    // l'heure décalée. Un rayon négatif ferait disparaître le point.
    const g = graphe(
      [note('a', { creee: iso(MAINTENANT + 5 * JOUR), serviLe: iso(MAINTENANT + JOUR) })],
      MAINTENANT,
    );
    expect(g.noeuds[0]?.ageJours).toBe(0);
    expect(g.noeuds[0]?.serviIlYaJours).toBe(0);
  });

  it('les récurrences valent au moins 1 — un point de rayon nul est invisible', () => {
    const g = graphe([note('a', { recurrences: 0 })], MAINTENANT);
    expect(g.noeuds[0]?.recurrences).toBe(1);
  });
});

describe('LES DATES SONT ÉCRITES À LA MAIN, DONC PARFOIS FAUSSES', () => {
  it('UNE DATE ILLISIBLE NE FAIT PAS DISPARAÎTRE LA NOTE', () => {
    // ─── LE DÉFAUT QUE CE TEST FERME ───────────────────────────────────────
    //
    // Les notes s'éditent dans Obsidian. `Date.parse('hier')` rend `NaN`, et
    // `NaN` traverse tout : il serait devenu un rayon `NaN` côté canevas,
    // donc un point QUI NE SE DESSINE PAS. Une note invisible dans la vue
    // censée montrer tout le savoir est le pire résultat possible.
    const g = graphe([note('a', { creee: 'pas une date' })], MAINTENANT);
    expect(g.noeuds).toHaveLength(1);
    expect(g.noeuds[0]?.ageJours, 'un âge inventé vaut moins qu’un âge absent').toBeNull();
  });

  it('un `serviLe` illisible compte comme JAMAIS SERVI, pas comme servi', () => {
    // Le sens de l'erreur compte : on ne peut pas affirmer que la note a
    // servi, donc on ne l'affirme pas. L'inverse ferait passer du savoir
    // dormant pour actif dans l'écran fait pour le repérer.
    const g = graphe([note('a', { serviLe: '32 février' })], MAINTENANT);
    expect(g.noeuds[0]?.serviIlYaJours).toBeNull();
    expect(g.servies).toBe(0);
  });
});

describe('CE QUE LE GRAPHE DIT DE LA SANTÉ', () => {
  it('une note sans aucun lien est ORPHELINE', () => {
    const g = graphe([note('seule'), note('a', { corps: '[[b]]' }), note('b')], MAINTENANT);
    expect(g.orphelines).toEqual(['seule']);
  });

  it('une CARTE n’est jamais orpheline — son rôle est d’être un point d’entrée', () => {
    // Même exception que `sante()`, et pour la même raison : une carte qui
    // ne cite rien encore n'est pas un défaut, c'est une carte vide.
    const g = graphe([note('plan', { genre: 'carte' })], MAINTENANT);
    expect(g.orphelines).toEqual([]);
  });

  it('les genres sont comptés, y compris ceux à zéro', () => {
    // Un genre absent du compte ferait disparaître sa case de la légende, et
    // « aucun invariant » est justement ce qu'il faut voir.
    const g = graphe([note('a', { genre: 'invariant' })], MAINTENANT);
    expect(g.parGenre.invariant).toBe(1);
    expect(g.parGenre.episode).toBe(0);
    expect(Object.keys(g.parGenre)).toHaveLength(5);
  });
});

describe('CE QUI VIENT DES FICHIERS RESTE UNE DONNÉE', () => {
  it('un titre sur plusieurs lignes ne casse pas l’affichage', () => {
    // Les notes sont éditables à la main dans Obsidian : un titre avec un
    // retour à la ligne fabriquerait une fausse ligne dans la légende.
    const g = graphe([note('a', { titre: 'avant\napres' })], MAINTENANT);
    expect(g.noeuds[0]?.titre).toBe('avant apres');
  });

  it('un titre démesuré est borné', () => {
    const g = graphe([note('a', { titre: 'x'.repeat(1_000) })], MAINTENANT);
    expect(g.noeuds[0]?.titre.length).toBeLessThanOrEqual(120);
  });
});

describe('LE CAS VIDE', () => {
  it('un cerveau vide rend un graphe vide, pas une erreur', () => {
    // Premier démarrage : c'est l'état NORMAL, pas une panne.
    const g = graphe([], MAINTENANT);
    expect(g.total).toBe(0);
    expect(g.noeuds).toEqual([]);
    expect(g.aretes).toEqual([]);
    expect(g.servies).toBe(0);
  });
});
