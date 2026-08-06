// LA DÉSIGNATION DANS LE CERVEAU — ce qu'on attrape, ce qui reste allumé.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Deux gardes de la vue du Cerveau ont survécu au balayage par mutation, et
// toutes deux passaient pour intouchables : elles vivent dans la boucle de
// dessin d'un `<canvas>`, dont `getContext` rend `null` sous happy-dom.
//
// Le carnet des erreurs dit quoi faire de ce diagnostic (§ 2 quaterdecies) :
// « hors d'atteinte du banc » est presque toujours « au mauvais endroit ».
// Ni le test de proximité ni le calcul du halo ne touchent au contexte de
// dessin — ils prennent des nombres et des identifiants, et rendent une
// décision. Sortis dans `cerveau-designation.ts`, ils se jugent au point près.
//
// Ce que ces règles protègent :
//
//   · si `d < rayon(p.n) + MARGE` se mute en `>`, on attrape la note la PLUS
//     ÉLOIGNÉE du clic : l'écran répond, mais à côté — la panne qui ne
//     ressemble pas à une panne ;
//   · si `d < meilleur` se mute, deux notes qui se chevauchent rendent l'une
//     des deux inatteignable, et laquelle dépend de l'ordre d'un `Map` ;
//   · si le voisinage cesse d'être épargné, désigner une note éteint
//     précisément ce qu'on voulait voir : ses liens.

import { describe, expect, it } from 'vitest';
import {
  chaleur,
  corpsSousLePoint,
  estEteinte,
  estUnClic,
  FENETRE_CHALEUR_JOURS,
  MARGE_DOIGT,
  rayon,
  selectionAuRelacher,
  SEUIL_GLISSE,
  type CorpsPointable,
} from '../dashboard/src/views/cerveau-designation.js';

/** Une note posée en (x, y), avec la taille qu'on lui demande. */
function corps(id: string, x: number, y: number, recurrences = 0, degre = 0): CorpsPointable {
  return { id, x, y, n: { recurrences, degre } };
}

describe('le rayon d’une note', () => {
  it('LA RÉCURRENCE EST ÉCRASÉE PAR UNE RACINE — cinquante pannes ne font pas un disque cinquante fois plus large', () => {
    const seule = rayon({ recurrences: 1, degre: 0 });
    const cinquante = rayon({ recurrences: 50, degre: 0 });
    // Sans la racine, ce serait 50 fois. Avec, c'est moins de quatre fois :
    // la note dominante reste lisible SANS manger l'écran qu'elle explique.
    expect(cinquante / seule).toBeLessThan(4);
    expect(cinquante, 'et elle reste nettement plus grosse : l’information passe').toBeGreaterThan(
      seule * 2,
    );
  });

  it('LE DEGRÉ PLAFONNE À 7 POINTS — une note très reliée ne peut pas prendre toute la place', () => {
    const isolee = rayon({ recurrences: 0, degre: 0 });
    const reliee = rayon({ recurrences: 0, degre: 8 });
    const enorme = rayon({ recurrences: 0, degre: 400 });
    expect(reliee, 'huit liens : le plafond est atteint').toBe(isolee + 7);
    expect(enorme, 'quatre cents liens : pas un point de plus').toBe(reliee);
    expect(rayon({ recurrences: 0, degre: 4 }), 'sous le plafond, le degré compte').toBeCloseTo(
      isolee + 3.6,
      6,
    );
  });

  it('UNE NOTE NEUVE ET SEULE A QUAND MÊME UN DISQUE — jamais un point invisible', () => {
    expect(rayon({ recurrences: 0, degre: 0 })).toBe(5);
  });
});

describe('attraper la note qu’on vise', () => {
  it('LE POINT DOIT TOMBER SUR LA NOTE — la scène vide ne renvoie personne', () => {
    expect(corpsSousLePoint({ x: 0, y: 0 }, [])).toBeNull();
    // Une note à cent points du clic n'est pas « la plus proche » : elle est
    // hors cible. Le `null` est une réponse, pas un échec.
    expect(corpsSousLePoint({ x: 0, y: 0 }, [corps('loin', 100, 0)])).toBeNull();
  });

  it('LA BORNE DE LA CIBLE TOMBE PILE — touchée des deux côtés', () => {
    // Note neuve : rayon 5, plus la marge de confort au doigt.
    const p = corps('note', 0, 0);
    const limite = 5 + MARGE_DOIGT;
    expect(corpsSousLePoint({ x: limite - 0.001, y: 0 }, [p])?.id, 'juste dedans').toBe('note');
    expect(
      corpsSousLePoint({ x: limite, y: 0 }, [p]),
      'pile sur la borne : dehors (le disque est ouvert)',
    ).toBeNull();
    expect(corpsSousLePoint({ x: limite + 0.001, y: 0 }, [p]), 'juste dehors').toBeNull();
  });

  it('LA MARGE ÉLARGIT LA CIBLE SANS ÉLARGIR LE DESSIN', () => {
    // À 6 points du centre, on est HORS du disque (rayon 5) et pourtant on
    // attrape : viser 5 points à la souris serait un exercice d'adresse.
    const p = corps('petite', 0, 0);
    expect(6).toBeGreaterThan(rayon(p.n));
    expect(corpsSousLePoint({ x: 6, y: 0 }, [p])?.id).toBe('petite');
  });

  it('UNE GROSSE NOTE S’ATTRAPE DE PLUS LOIN — le rayon nourrit vraiment la cible', () => {
    // Si le test de proximité cessait de consulter `rayon`, ces deux notes
    // auraient la même zone d'attrape : la note qui occupe un tiers de
    // l'écran deviendrait aussi difficile à viser qu'un point.
    const grosse = corps('grosse', 0, 0, 100, 0);
    const petite = corps('petite', 0, 0);
    const distance = 40;
    expect(corpsSousLePoint({ x: distance, y: 0 }, [grosse])?.id).toBe('grosse');
    expect(corpsSousLePoint({ x: distance, y: 0 }, [petite])).toBeNull();
  });

  it('EN CAS DE CHEVAUCHEMENT, LA PLUS PROCHE GAGNE — quel que soit l’ordre de la collection', () => {
    // Le point est à 6 de A et à 4 de B, les deux à portée. La réponse ne
    // doit PAS dépendre de l'ordre d'itération d'un `Map` : sinon une note
    // devient inatteignable selon l'ordre où le graphe l'a insérée, et
    // l'utilisateur croit à une note morte.
    const a = corps('a', 0, 0);
    const b = corps('b', 10, 0);
    const point = { x: 6, y: 0 };
    expect(corpsSousLePoint(point, [a, b])?.id, 'A puis B').toBe('b');
    expect(corpsSousLePoint(point, [b, a])?.id, 'B puis A').toBe('b');
  });

  it('LE CORPS RENDU EST CELUI DE LA COLLECTION — pas une copie', () => {
    // La vue se sert de l'objet rendu pour l'attraper à la souris : rendre
    // une copie ferait glisser un fantôme pendant que la note reste sur place.
    const p = corps('note', 3, 4);
    expect(corpsSousLePoint({ x: 3, y: 4 }, [p])).toBe(p);
  });
});

describe('ce qui reste allumé', () => {
  const voisinage = new Set(['voisine']);

  it('AU REPOS, TOUT EST ALLUMÉ — un graphe qu’on ne désigne pas se lit en entier', () => {
    expect(estEteinte('n’importe laquelle', null, null)).toBe(false);
    expect(estEteinte('n’importe laquelle', null, voisinage)).toBe(false);
  });

  it('LA NOTE DÉSIGNÉE ET SES VOISINES RESTENT ALLUMÉES — le reste s’efface', () => {
    expect(estEteinte('choisie', 'choisie', voisinage), 'la désignée').toBe(false);
    expect(estEteinte('voisine', 'choisie', voisinage), 'sa voisine').toBe(false);
    expect(estEteinte('etrangere', 'choisie', voisinage), 'une inconnue').toBe(true);
  });

  it('AU SURVOL SIMPLE, SEULE LA NOTE SURVOLÉE RESTE — c’est l’aperçu', () => {
    // `voisinage` est null tant qu'on n'a rien CHOISI : le survol donne un
    // coup de projecteur, le clic ouvre le voisinage.
    expect(estEteinte('survolee', 'survolee', null)).toBe(false);
    expect(estEteinte('autre', 'survolee', null)).toBe(true);
  });

  it('UN VOISINAGE VIDE N’ÉPARGNE QUE LA DÉSIGNÉE', () => {
    // Une note sans aucun lien : elle seule s'allume, et l'écran dit ainsi
    // qu'elle est orpheline sans avoir besoin de l'écrire.
    const seule = new Set<string>();
    expect(estEteinte('choisie', 'choisie', seule)).toBe(false);
    expect(estEteinte('autre', 'choisie', seule)).toBe(true);
  });
});

describe('chaleur — le savoir dormant et le savoir vif ne se confondent pas', () => {
  it('JAMAIS SERVIE (null) VAUT 0 — c’est du savoir dormant, pas du savoir frais', () => {
    // LE cœur : `null` n'est pas « 0 jour ». Sans la garde, `null / 30 === 0`
    // rendrait 1, et une note jamais touchée brillerait comme une note servie à
    // l'instant — l'exact contraire de ce que l'écran veut montrer.
    expect(chaleur({ serviIlYaJours: null })).toBe(0);
  });

  it('SERVIE AUJOURD’HUI (0 jour) VAUT 1 — le maximum, à l’opposé de « jamais »', () => {
    expect(chaleur({ serviIlYaJours: 0 })).toBe(1);
  });

  it('DÉCROÎT LINÉAIREMENT sur la fenêtre — la moitié de la fenêtre vaut la moitié', () => {
    expect(chaleur({ serviIlYaJours: FENETRE_CHALEUR_JOURS / 2 })).toBeCloseTo(0.5, 10);
    expect(chaleur({ serviIlYaJours: FENETRE_CHALEUR_JOURS })).toBe(0);
  });

  it('AU-DELÀ DE LA FENÊTRE, PLANCHER À 0 — jamais de chaleur NÉGATIVE', () => {
    // Une ancienneté supérieure à la fenêtre (horloge en avance, ou note très
    // vieille) ne doit pas inverser le halo : `Math.max(0, …)` tient le plancher.
    expect(chaleur({ serviIlYaJours: FENETRE_CHALEUR_JOURS * 2 })).toBe(0);
  });
});

describe('estUnClic — départager le clic du glisser (extrait du canevas)', () => {
  // Cette règle vivait dans le `onMouseUp` du canevas, que happy-dom ne peut
  // pas jouer (`getContext` nul → aucun corps à saisir). Extraite en pur, elle
  // s'éprouve au pixel près plutôt que d'être simulée à travers un canevas muet.
  it('un relâcher SANS déplacement est un clic', () => {
    expect(estUnClic({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  it('un micro-tremblement (≤ SEUIL_GLISSE) reste un clic', () => {
    expect(estUnClic({ x: 0, y: 0 }, { x: 3, y: 0 }), 'trois pixels').toBe(true);
    // PILE au seuil : la frontière au pixel près — c'est elle qui meurt si `<=`
    // devient `<`, et un déplacement juste égal au seuil cesserait d'être un clic.
    expect(estUnClic({ x: 0, y: 0 }, { x: SEUIL_GLISSE, y: 0 }), 'pile au seuil').toBe(true);
  });

  it('au-delà du seuil, c’est un GLISSER — pas un clic', () => {
    expect(estUnClic({ x: 0, y: 0 }, { x: 5, y: 0 }), 'cinq pixels').toBe(false);
    // La distance est euclidienne : hypot(3, 4) = 5, au-delà du seuil de 4.
    expect(estUnClic({ x: 0, y: 0 }, { x: 3, y: 4 }), 'diagonale 3-4-5').toBe(false);
  });
});

describe('selectionAuRelacher — ce que le relâcher du canevas DÉCIDE', () => {
  // Le compagnon d'`estUnClic` : là où `onMouseUp` du canevas ne se joue pas
  // sous banc (`getContext` nul, aucun corps à saisir), la DÉCISION de sélection
  // est extraite en pur et s'éprouve ici. La tuyauterie qui reste dans le
  // canevas (retenir l'id sous le curseur, traîner le corps) est inerte sans elle.
  it('un clic sur une note la choisit', () => {
    expect(selectionAuRelacher({ x: 10, y: 10 }, { x: 11, y: 10 }, 'note')).toEqual({
      choisir: true,
      id: 'note',
    });
  });

  it('un clic dans le vide DÉSÉLECTIONNE — id null, mais c’est bien un choix', () => {
    expect(selectionAuRelacher({ x: 10, y: 10 }, { x: 12, y: 10 }, null)).toEqual({
      choisir: true,
      id: null,
    });
  });

  it('un GLISSER ne choisit RIEN, même relâché pile sur une note', () => {
    // Le cœur du départage : sans lui, déplacer une note l'isolerait au
    // relâcher. `choisir: false` laisse la sélection courante INTACTE — la note
    // sous le curseur (« note ») est ignorée, on ne renvoie pas `id: 'note'`.
    expect(selectionAuRelacher({ x: 0, y: 0 }, { x: 50, y: 0 }, 'note')).toEqual({
      choisir: false,
      id: null,
    });
  });

  it('pile au seuil, le relâcher reste un choix (frontière héritée d’estUnClic)', () => {
    expect(selectionAuRelacher({ x: 0, y: 0 }, { x: SEUIL_GLISSE, y: 0 }, 'note')).toEqual({
      choisir: true,
      id: 'note',
    });
  });
});
