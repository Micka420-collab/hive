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
  deplacementDuGlisse,
  estCharpente,
  estEteinte,
  estUnClic,
  etiquettesPosees,
  policeEtiquette,
  FENETRE_CHALEUR_JOURS,
  MARGE_DOIGT,
  ordreDePose,
  porteSonNom,
  priseAuDoigt,
  rayon,
  seChevauchent,
  LIBELLE_GENRE,
  densiteEcran,
  mouvementReduit,
  noteCreuse,
  resumeDeNote,
  selectionAuRelacher,
  SEUIL_GLISSE,
  type Boite,
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

describe('priseAuDoigt — ce qu’un appui sur le canevas attrape', () => {
  it('un corps sous le doigt est SAISI (fond: false), pour être déplacé', () => {
    // `sousLeCurseur === null` muté en `!== null` : un corps réel serait pris
    // pour du vide, l'appui saisirait le FOND, et cliquer une note déplacerait
    // la vue au lieu de la note. Cette assertion mord sur ce défaut.
    expect(priseAuDoigt({ id: 'n1' }, 10, 20)).toEqual({ id: 'n1', fond: false, x: 10, y: 20 });
  });

  it('un appui dans le VIDE saisit le fond (fond: true), pour déplacer la vue', () => {
    // Le point d'appui (x, y) est reporté tel quel : c'est de là que le seuil
    // clic/glisser d'`estUnClic` mesurera, au relâcher, si c'était un glisser.
    expect(priseAuDoigt(null, 10, 20)).toEqual({ id: null, fond: true, x: 10, y: 20 });
  });
});

describe('deplacementDuGlisse — ce qu’un glisser accomplit selon la prise', () => {
  it('un corps saisi se TRAÎNE, et l’id ressort resserré à string', () => {
    // `prise.id !== null` muté en `=== null` : un corps réel ne serait plus
    // traîné (il tomberait en fond ou survol), et le glisser au-dessus du VIDE
    // croirait tenir un corps. Cette assertion mord sur ce défaut — le même
    // mutant survivait tant que la décision restait dans le canevas muet.
    expect(deplacementDuGlisse({ id: 'n1', fond: false })).toEqual({ traine: true, id: 'n1' });
  });

  it('un corps PRIME sur le fond : id non nul l’emporte même si fond est vrai', () => {
    // L'ordre des gardes : sans la priorité du corps, traîner une note
    // déplacerait la vue. `id` non nul doit gagner quoi qu'indique `fond`.
    expect(deplacementDuGlisse({ id: 'n1', fond: true })).toEqual({ traine: true, id: 'n1' });
  });

  it('le FOND saisi (id nul, fond vrai) déplace la vue', () => {
    expect(deplacementDuGlisse({ id: null, fond: true })).toEqual({ traine: false, fond: true });
  });

  it('rien de saisi (id nul, fond faux) n’est qu’un survol', () => {
    // Pas de corps et fond faux : l'appui n'a rien retenu, le déplacement ne
    // fait que survoler — ni traîne, ni panoramique.
    expect(deplacementDuGlisse({ id: null, fond: false })).toEqual({ traine: false, fond: false });
  });
});

// ─── LES ÉTIQUETTES DU GRAPHE ────────────────────────────────────────────────
//
// D'où vient ce bloc : `if (heurte && p.id !== actif) continue;` muté en `||`
// laissait la suite ENTIÈRE verte (247 fichiers, 3 641 cas) — et faisait
// disparaître TOUS les noms du graphe sauf celui de la note regardée.
//
// La règle de mesure du canevas est injectée : ici, une fonte imaginaire où
// chaque caractère vaut 10 points de large. Ce n'est pas une simulation du
// canevas — c'est la seule chose que le canevas apportait (une largeur), rendue
// par un paramètre. Les trois décisions, elles, sont les vraies.

/** Une note nommable, réduite au strict nécessaire. */
const note = (id: string, genre: string, degre: number) => ({ id, n: { genre, degre } });

/** Une fonte imaginaire : 10 points par caractère, hauteur 12. */
const regleFixe =
  (largeurs: Record<string, number>) =>
  (p: { id: string }): Boite => ({
    x: largeurs[`${p.id}.x`] ?? 0,
    y: 0,
    l: largeurs[p.id] ?? 10,
    h: 12,
  });

const jamaisEteinte = () => false;

describe('estCharpente — qui tient le graphe, et qui n’en est qu’une trace', () => {
  it('une note reliée et non-épisode EST de la charpente', () => {
    expect(estCharpente({ genre: 'lecon', degre: 2 })).toBe(true);
  });

  it('un ÉPISODE n’en est pas, même bien relié', () => {
    // `genre !== 'episode'` muté en `===` : seuls les épisodes seraient nommés
    // — exactement le texte illisible que cette règle existe pour éviter.
    expect(estCharpente({ genre: 'episode', degre: 9 })).toBe(false);
  });

  it('une note ISOLÉE n’en est pas, même d’un genre structurant', () => {
    // `degre > 0` muté en `>= 0` : les feuilles orphelines prendraient la place
    // des carrefours du savoir.
    expect(estCharpente({ genre: 'invariant', degre: 0 })).toBe(false);
  });
});

describe('porteSonNom — le droit au nom, et ses deux exceptions', () => {
  it('la note ACTIVE porte son nom même si elle n’est PAS de la charpente', () => {
    // `id === actif` muté en `!==` : l'unique note qu'on regarde serait la
    // seule à ne pas être nommée.
    expect(porteSonNom('ep1', { genre: 'episode', degre: 0 }, 'ep1', false)).toBe(true);
  });

  it('une note ÉTEINTE ne porte pas son nom, même de la charpente ET active', () => {
    // La garde `if (eteinte) return false` supprimée : une note écartée du
    // regard reviendrait au premier plan par son nom.
    expect(porteSonNom('n1', { genre: 'lecon', degre: 5 }, 'n1', true)).toBe(false);
  });

  it('une note ordinaire de la charpente porte son nom', () => {
    expect(porteSonNom('n1', { genre: 'lecon', degre: 5 }, 'autre', false)).toBe(true);
  });

  it('un épisode ni actif ni éteint ne porte PAS son nom', () => {
    expect(porteSonNom('ep1', { genre: 'episode', degre: 3 }, 'autre', false)).toBe(false);
  });
});

describe('ordreDePose — l’ordre est une PRIORITÉ, pas un affichage', () => {
  const A = { id: 'a', degre: 1 };
  const B = { id: 'b', degre: 5 };

  it('la note ACTIVE passe devant, quel que soit son degré', () => {
    // `a.id === actif ? -1` muté : la note regardée perdrait sa priorité et
    // c'est SON nom qui sauterait au premier chevauchement.
    expect(ordreDePose(A, B, 'a')).toBeLessThan(0);
    expect(ordreDePose(A, B, 'b')).toBeGreaterThan(0);
  });

  it('à défaut d’active, le MIEUX RELIÉ passe devant', () => {
    // `b.degre - a.degre` inversé : les feuilles évinceraient les carrefours.
    expect(ordreDePose(A, B, null)).toBeGreaterThan(0);
    expect(ordreDePose(B, A, null)).toBeLessThan(0);
  });

  it('à degré ÉGAL, l’identifiant départage — sinon le graphe clignoterait', () => {
    // Sans ce départage, l'ordre dépendrait de celui du tableau : deux images
    // successives ne poseraient pas les mêmes noms.
    expect(ordreDePose({ id: 'a', degre: 3 }, { id: 'b', degre: 3 }, null)).toBeLessThan(0);
    expect(ordreDePose({ id: 'b', degre: 3 }, { id: 'a', degre: 3 }, null)).toBeGreaterThan(0);
  });
});

describe('seChevauchent — strict sur les quatre bords', () => {
  const REF: Boite = { x: 0, y: 0, l: 10, h: 10 };

  it('deux boîtes franchement superposées se chevauchent', () => {
    expect(seChevauchent(REF, { x: 5, y: 5, l: 10, h: 10 })).toBe(true);
  });

  it('deux boîtes qui se TOUCHENT exactement ne se chevauchent pas', () => {
    // Les quatre comparaisons mutées en `<=`/`>=` : deux libellés jointifs se
    // croiraient en collision, et on perdrait un nom pour rien.
    expect(seChevauchent(REF, { x: 10, y: 0, l: 10, h: 10 })).toBe(false);
    expect(seChevauchent(REF, { x: 0, y: 10, l: 10, h: 10 })).toBe(false);
    expect(seChevauchent({ x: 10, y: 0, l: 10, h: 10 }, REF)).toBe(false);
    expect(seChevauchent({ x: 0, y: 10, l: 10, h: 10 }, REF)).toBe(false);
  });

  it('décalées sur UN seul axe, elles ne se chevauchent pas', () => {
    // Chacun des quatre bords compte : sans le test en Y, deux libellés
    // superposés en X mais à des hauteurs différentes s'évinceraient.
    expect(seChevauchent(REF, { x: 0, y: 40, l: 10, h: 10 })).toBe(false);
    expect(seChevauchent(REF, { x: 40, y: 0, l: 10, h: 10 })).toBe(false);
  });
});

describe('etiquettesPosees — qui garde son nom quand la toile est serrée', () => {
  it('SANS collision, tous les candidats de la charpente sont posés', () => {
    const posees = etiquettesPosees(
      [note('a', 'lecon', 2), note('b', 'lecon', 1)],
      null,
      jamaisEteinte,
      regleFixe({ 'a.x': 0, 'b.x': 100 }),
    );
    expect(posees.map((d) => d.corps.id)).toEqual(['a', 'b']);
  });

  it('les ÉPISODES et les ÉTEINTES ne sont pas candidats', () => {
    const posees = etiquettesPosees(
      [note('a', 'lecon', 2), note('ep', 'episode', 4), note('off', 'lecon', 3)],
      null,
      (id) => id === 'off',
      regleFixe({ 'a.x': 0, 'ep.x': 100, 'off.x': 200 }),
    );
    expect(posees.map((d) => d.corps.id)).toEqual(['a']);
  });

  it('EN COLLISION, le mieux relié garde son nom et l’autre le perd', () => {
    // Les deux boîtes au même endroit : une seule peut être posée, et ce doit
    // être celle qui tient le graphe.
    const posees = etiquettesPosees(
      [note('faible', 'lecon', 1), note('fort', 'lecon', 9)],
      null,
      jamaisEteinte,
      regleFixe({ 'faible.x': 0, 'fort.x': 0 }),
    );
    expect(posees.map((d) => d.corps.id)).toEqual(['fort']);
  });

  it('la note ACTIVE garde son nom face à une note qui la recouvre', () => {
    // LA GARANTIE, PAS LE MÉCANISME. Le code d'origine portait une exception
    // dans la collision (`heurte && p.id !== actif`) ; la mesure a montré
    // qu'elle était MORTE — c'est le TRI qui protège l'actif, puisqu'il le pose
    // en premier, quand rien ne peut encore le recouvrir. Cette assertion ne
    // dit pas par quel chemin l'actif garde son nom : elle dit qu'il le garde.
    // Elle rougit donc si l'on casse le tri, comme elle aurait rougi si l'on
    // avait cassé l'exception — c'est ce qui la rend indifférente à la
    // suppression d'un mécanisme redondant.
    const posees = etiquettesPosees(
      [note('fort', 'lecon', 9), note('vu', 'episode', 0)],
      'vu',
      jamaisEteinte,
      regleFixe({ 'fort.x': 0, 'vu.x': 0 }),
    );
    expect(posees.map((d) => d.corps.id)).toEqual(['vu']);
  });

  it('la boîte MESURÉE est rendue avec l’étiquette — le canevas n’a plus à la refaire', () => {
    const posees = etiquettesPosees(
      [note('a', 'lecon', 2)],
      null,
      jamaisEteinte,
      regleFixe({ 'a.x': 7, a: 42 }),
    );
    expect(posees[0]?.boite).toEqual({ x: 7, y: 0, l: 42, h: 12 });
  });

  it('l’ordre RENDU est l’ordre de pose — l’actif écrit en dernier serait recouvert', () => {
    const posees = etiquettesPosees(
      [note('a', 'lecon', 1), note('vu', 'lecon', 1), note('z', 'lecon', 9)],
      'vu',
      jamaisEteinte,
      regleFixe({ 'a.x': 0, 'vu.x': 100, 'z.x': 200 }),
    );
    expect(posees.map((d) => d.corps.id)).toEqual(['vu', 'z', 'a']);
  });

  // ─── C'EST BIEN L'ACTIVE QU'ON MESURE EN GRAS ──────────────────────────────
  //
  // Balayage loupe du 13 août : `boiteDe(p, p.id === actif)` muté en `!==`,
  // suite ENTIÈRE verte. Les bancs au-dessus passent tous `regleFixe`, qui
  // IGNORE son second paramètre — aucun d'eux ne pouvait donc voir le drapeau
  // partir à la mauvaise note.
  //
  // Ce que le mutant fait à l'écran : l'active est mesurée comme si elle était
  // maigre (donc plus étroite qu'elle n'est, et elle chevauchera ses voisines
  // en vrai), pendant que TOUTES les autres sont mesurées en gras — plus larges
  // qu'elles ne sont, donc évincées pour des collisions qui n'existent pas. Le
  // graphe perd des noms d'un côté et en superpose de l'autre.
  //
  // L'entrée qui tranche est une règle dont la largeur DÉPEND du gras : la
  // largeur est la seule chose que le canevas apporte ici, et c'est justement
  // celle que le drapeau commande.
  const regleSelonGras =
    (x: Record<string, number>) =>
    (p: { id: string }, estActif: boolean): Boite => ({
      x: x[p.id] ?? 0,
      y: 0,
      l: estActif ? 30 : 10,
      h: 12,
    });

  it('LE GRAS SUIT L’ACTIVE : sa boîte est la large, et elle évince sa voisine', () => {
    // `vu` est posée en premier (le tri met l'active devant). Mesurée en GRAS
    // elle couvre 0→30 et recouvre `a` (20→30), qui perd son nom.
    // Le drapeau inversé la mesurerait maigre (0→10) et laisserait passer `a`.
    const posees = etiquettesPosees(
      [note('a', 'lecon', 1), note('vu', 'lecon', 1)],
      'vu',
      jamaisEteinte,
      regleSelonGras({ vu: 0, a: 20 }),
    );
    expect(posees.map((d) => d.corps.id)).toEqual(['vu']);
    expect(posees[0]?.boite.l, 'l’active est mesurée en gras, donc large').toBe(30);
  });

  it('ET LES AUTRES RESTENT MAIGRES — sinon elles s’évinceraient pour rien', () => {
    // Sans note active : personne n'est en gras, les deux tiennent côte à côte.
    // Le drapeau inversé les mettrait TOUTES en gras (30 de large), et `b`
    // (20→50 contre 0→30) disparaîtrait sans qu'aucun pixel ne se touche.
    const posees = etiquettesPosees(
      [note('a', 'lecon', 2), note('b', 'lecon', 1)],
      null,
      jamaisEteinte,
      regleSelonGras({ a: 0, b: 20 }),
    );
    expect(posees.map((d) => d.corps.id)).toEqual(['a', 'b']);
    expect(posees.map((d) => d.boite.l)).toEqual([10, 10]);
  });

  it('L’ÉTIQUETTE DIT SI ELLE EST ACTIVE — la boucle de dessin n’a plus à le recalculer', () => {
    // Le canevas relisait `p.id === actif` pour choisir sa fonte et son alpha.
    // `getContext` rend `null` sous happy-dom : cette comparaison-là ne pouvait
    // pas être éprouvée là où elle vivait. Elle est rendue ici, avec la boîte.
    const posees = etiquettesPosees(
      [note('a', 'lecon', 2), note('vu', 'lecon', 1)],
      'vu',
      jamaisEteinte,
      regleFixe({ 'a.x': 0, 'vu.x': 100 }),
    );
    expect(posees.map((d) => [d.corps.id, d.estActif])).toEqual([
      ['vu', true],
      ['a', false],
    ]);
  });

  it('SANS active, aucune étiquette ne se dit active', () => {
    const posees = etiquettesPosees(
      [note('a', 'lecon', 2)],
      null,
      jamaisEteinte,
      regleFixe({ 'a.x': 0 }),
    );
    expect(posees[0]?.estActif).toBe(false);
  });
});

// ─── LA FONTE : UNE SEULE SOURCE POUR LA MESURE ET POUR L'ÉCRITURE ───────────
//
// `Cerveau.tsx` composait cette chaîne DEUX FOIS, à deux endroits, avec deux
// littéraux séparés — un pour `measureText`, un pour `fillText`. Elles
// s'accordaient par chance. Le jour où l'une change, la ruche mesure une fonte
// et en dessine une autre : les boîtes deviennent fausses, donc les collisions
// aussi, et le graphe ment sur ce qu'il montre sans que rien ne casse.
describe('policeEtiquette — ce qu’on mesure est ce qu’on écrit', () => {
  it('L’ACTIVE est SEMI-GRASSE — c’est ce `600` qui la fait plus large', () => {
    expect(policeEtiquette(11, true)).toBe('600 11px ui-monospace, monospace');
  });

  it('LES AUTRES sont maigres — aucune graisse devant la taille', () => {
    expect(policeEtiquette(11, false)).toBe('11px ui-monospace, monospace');
  });

  it('la TAILLE traverse telle quelle — le zoom la divise en amont', () => {
    // `11 / zoom` : à fort zoom la fonte est fractionnaire, et le canevas
    // l'accepte. L'arrondir ici ferait sauter le texte d'un cran à l'autre.
    expect(policeEtiquette(5.5, false)).toBe('5.5px ui-monospace, monospace');
  });
});

describe('noteCreuse — la décision que le canevas ne faisait que dessiner', () => {
  it('JAMAIS servie ⇒ creuse ; servie AUJOURD’HUI ⇒ pleine', () => {
    // `null` et `0` sont aux deux extrêmes, et les confondre est le défaut que
    // cet écran existe pour éviter. C'est l'entrée qui tranche le mutant
    // `=== null` → `!== null`, rendu nu par un balayage élargi : la ligne
    // vivait dans la boucle de dessin, où `getContext` rend `null` sous
    // happy-dom — donc aucun banc ne pouvait l'atteindre.
    expect(noteCreuse({ serviIlYaJours: null })).toBe(true);
    expect(noteCreuse({ serviIlYaJours: 0 })).toBe(false);
    expect(noteCreuse({ serviIlYaJours: 400 }), 'vieille n’est pas jamais').toBe(false);
  });
});

describe('resumeDeNote — ce que la bulle de survol dit, sans passer par le canevas', () => {
  const fr = (f: string) => f;
  const en = (_f: string, e: string) => e;

  it('une note JAMAIS servie le dit, dans les deux langues', () => {
    const n = { genre: 'lecon', degre: 3, serviIlYaJours: null };
    expect(resumeDeNote(n, fr)).toBe('leçons · 3 liens · jamais servie');
    expect(resumeDeNote(n, en)).toBe('lessons · 3 links · never used');
  });

  it('une note SERVIE porte son ancienneté — c’est l’entrée qui tranche', () => {
    // Avec le mutant `!== null`, une note servie il y a 5 jours s'annoncerait
    // « jamais servie » : l'écran dirait dormant ce qui vient de servir.
    const n = { genre: 'invariant', degre: 12, serviIlYaJours: 5 };
    expect(resumeDeNote(n, fr)).toBe('invariants · 12 liens · servie il y a 5 j');
    expect(resumeDeNote(n, en)).toBe('invariants · 12 links · used 5 d ago');
  });

  it('SERVIE AUJOURD’HUI (0 jour) n’est pas « jamais servie »', () => {
    expect(resumeDeNote({ genre: 'carte', degre: 1, serviIlYaJours: 0 }, fr)).toContain(
      'servie il y a 0 j',
    );
  });

  it('un genre INCONNU rend une chaîne vide, pas sa clé interne', () => {
    // La bulle nomme déjà la note juste au-dessus : afficher `episode_bis`
    // n'apprendrait rien et trahirait un identifiant interne.
    expect(resumeDeNote({ genre: 'inexistant', degre: 0, serviIlYaJours: null }, fr)).toBe(
      ' · 0 liens · jamais servie',
    );
  });

  it('les cinq genres connus ont bien leurs deux langues', () => {
    for (const g of Object.keys(LIBELLE_GENRE)) {
      expect(resumeDeNote({ genre: g, degre: 1, serviIlYaJours: 1 }, fr)).not.toMatch(/^ ·/);
      expect(resumeDeNote({ genre: g, degre: 1, serviIlYaJours: 1 }, en)).not.toMatch(/^ ·/);
    }
  });
});

describe('densiteEcran — un repli qui protège deux pannes différentes', () => {
  it('LE CAS QUI TRANCHE : une densité ABSENTE retombe sur 1', () => {
    // `window.devicePixelRatio` vaut `undefined` là où personne ne
    // l'implémente. Le mutant `||` → `&&` fait disparaître le repli exactement
    // quand il servait : le canevas se dessine à une échelle `undefined`.
    expect(densiteEcran(undefined)).toBe(1);
    expect(densiteEcran(0), 'zéro n’est pas une densité').toBe(1);
  });

  it('LE SECOND CAS, LE PLUS VICIEUX : un écran à 2 reste à 2', () => {
    // Sous le mutant, `2 && 1` vaut 1 : le graphe se dessine à moitié
    // résolution et paraît flou. Rien ne casse, rien n'avertit — l'écran est
    // juste moins bon, et ça ne se voit que côte à côte avec un écran qui marche.
    expect(densiteEcran(2)).toBe(2);
    expect(densiteEcran(3)).toBe(3);
  });

  it('les densités fractionnaires passent telles quelles', () => {
    expect(densiteEcran(1.5)).toBe(1.5);
  });
});

// ─── LE MOUVEMENT RÉDUIT, SORTI DE LA BOUCLE POUR ÊTRE MESURÉ ────────────────
//
// Le balayage du 16 août l'a rendue SANS TEST dans `Cerveau.tsx`. Je l'ai
// d'abord rangée parmi les « éprouvables sans géométrie » — FAUX, et répété
// trois fois : son unique appel vivait APRÈS `getContext`, donc derrière la
// même porte que les lignes classées hors de portée. Sortie de la boucle, elle
// se juge au point près.
describe('le mouvement réduit', () => {
  /** Un `matchMedia` de laboratoire : il note ce qu'on lui demande. */
  function media(matches: boolean) {
    const vues: string[] = [];
    return {
      interroger: (requete: string) => {
        vues.push(requete);
        return { matches };
      },
      vues,
    };
  }

  it('LE SYSTÈME DEMANDE MOINS DE MOUVEMENT : on le respecte', () => {
    const { interroger, vues } = media(true);
    expect(mouvementReduit(interroger)).toBe(true);
    // Et l'on vérifie CE QU'ON A DEMANDÉ : un `true` obtenu sur la mauvaise
    // requête serait vrai pour la mauvaise raison.
    expect(vues, 'la requête média n’est pas celle du mouvement réduit').toEqual([
      '(prefers-reduced-motion: reduce)',
    ]);
  });

  it('LE SYSTÈME NE DEMANDE RIEN : l’animation reste permise', () => {
    // C'est LE cas qui départage `&&` de `||` : en `||`, la seule existence de
    // `matchMedia` suffirait à court-circuiter à vrai, et le Cerveau se croirait
    // en mouvement réduit sur tous les postes du monde — graphe figé, sans
    // message, préférence d'accessibilité imposée à qui ne l'a pas demandée.
    const { interroger } = media(false);
    expect(mouvementReduit(interroger)).toBe(false);
  });

  it('AUCUN `matchMedia` : on n’invente pas une préférence, et on ne casse pas', () => {
    // Un vieux navigateur, ou un banc : la fonction doit rendre `false` sans
    // jeter. C'est la borne du `typeof`.
    expect(() => mouvementReduit(undefined)).not.toThrow();
    expect(mouvementReduit(undefined)).toBe(false);
  });
});
