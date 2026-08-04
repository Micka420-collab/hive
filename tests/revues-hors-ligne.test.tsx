// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES REVUES FAITES HORS LIGNE — ce que la ruche en fait au retour du réseau.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Survivante du balayage de nuit : `v !== null && typeof v === 'object' &&
// 'state' in v`, dans le tampon des revues non synchronisées. Nudité vérifiée
// contre la SUITE ENTIÈRE avant écriture — 3 267 tests verts avec la mutation
// en place.
//
// ─── CE QUE CE TAMPON PORTE ──────────────────────────────────────────────────
//
// Un humain approuve ou rejette une production. Le POST part. S'il échoue —
// coupure, ruche redémarrée, tunnel tombé —, le verdict n'est pas perdu : il
// est gardé localement, réaffiché, et re-posté au retour du réseau.
//
// Chaque entrée mémorise DEUX choses, et la seconde est la subtile :
//
//   · `state` — le verdict posé par l'humain ;
//   · `base`  — le verdict SERVEUR connu au moment du geste.
//
// `base` sert à ne pas rejouer un geste périmé : si un autre opérateur a
// statué entre-temps, sa décision est plus récente et prime. Sans `base`, le
// dernier à revenir en ligne écraserait le plus récent.
//
// ─── CE QUE LA GARDE DISTINGUE ───────────────────────────────────────────────
//
// Deux formats cohabitent : l'ANCIEN (le verdict nu, `"approved"`) et le
// NOUVEAU (`{ state, base }`). La garde décide lequel elle lit.
//
// Mutée, un tampon au format neuf est relu comme s'il était ancien : `state`
// devient l'OBJET tout entier, et `base` retombe à `null`. Deux conséquences,
// toutes deux silencieuses :
//
//   1. le verdict affiché n'est plus « approuvée » mais un objet — l'écran
//      cesse de dire ce que l'humain a décidé ;
//   2. `base` valant `null`, la comparaison au serveur échoue, et l'entrée est
//      ABANDONNÉE : le geste hors ligne disparaît sans un mot.
//
// C'est la pire des pertes de données de ce dépôt : silencieuse, et sur une
// décision humaine.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Le rejeu POSTe pour de vrai : sans cette simulation, le banc part sur le
  // réseau et dépend de la machine qui l'exécute.
  postReview: vi.fn(() => Promise.resolve()),
}));

import { postReview } from '../dashboard/src/api';
import { countUnsyncedReviews, getReview, hydrateReviews } from '../dashboard/src/views/shared';

const TAMPON = 'hive.review.unsynced';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(postReview).mockClear();
});
afterEach(() => {
  localStorage.clear();
});

/**
 * Laisse partir les microtâches.
 *
 * Le rejeu n'appelle pas `postReview` tout de suite : il l'enchaîne derrière la
 * promesse de la tâche (`prev.then(() => postReview(…))`), pour sérialiser les
 * envois d'une même tâche. Affirmer sans drainer jugerait donc l'instant AVANT
 * l'envoi — et rendrait « rien n'a été renvoyé » sur un rejeu parfaitement sain.
 */
async function drainer(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

/** Pose un tampon de revues non synchronisées, tel quel. */
function poserTampon(contenu: unknown): void {
  localStorage.setItem(TAMPON, JSON.stringify(contenu));
}

describe('le tampon des revues faites hors ligne', () => {
  it('UN VERDICT HORS LIGNE SURVIT AU RETOUR DU RÉSEAU — et il est re-posté', async () => {
    // Format NEUF. Le serveur ne sait rien de cette tâche (`base: null`), donc
    // rien n'a changé depuis le geste : le verdict tient et repart.
    poserTampon({ 't-hors-ligne': { state: 'approved', base: null } });

    hydrateReviews({});
    await drainer();

    expect(getReview('t-hors-ligne'), 'le verdict de l’humain est celui qu’on lit').toBe(
      'approved',
    );
    expect(vi.mocked(postReview), 'et il repart vers la ruche').toHaveBeenCalledWith(
      't-hors-ligne',
      'approved',
      expect.anything(),
    );
  });

  it('UN TAMPON À L’ANCIEN FORMAT EST RELU AUSSI — personne ne perd son geste à la mise à jour', async () => {
    // Le verdict NU, sans enveloppe : c'est ce qu'écrivaient les versions
    // précédentes. Un utilisateur qui met la ruche à jour avec un geste en
    // attente ne doit pas le perdre pour cette raison.
    poserTampon({ 't-ancien': 'rejected' });

    hydrateReviews({});

    expect(getReview('t-ancien')).toBe('rejected');
  });

  it('LE VERDICT LU EST UNE DÉCISION, JAMAIS UNE STRUCTURE', async () => {
    // LA garde, prise par son résultat visible. Mutée, `state` devient l'objet
    // entier : l'écran cesse de dire ce que l'humain a décidé, et affiche une
    // structure là où il annonçait « approuvée ».
    poserTampon({ 't-1': { state: 'approved', base: null } });

    hydrateReviews({});

    const lu = getReview('t-1');
    expect(typeof lu, 'un verdict est un mot, pas un objet').toBe('string');
    expect(['approved', 'rejected'], 'et c’est l’un des deux verdicts').toContain(lu);
  });

  it('UN GESTE HORS LIGNE N’EST PAS ABANDONNÉ QUAND LE SERVEUR N’A PAS BOUGÉ', async () => {
    // Le cœur de `base`. Au moment du geste, le serveur disait « approuvée » ;
    // l'humain a changé d'avis et rejeté, hors ligne. Au retour, le serveur dit
    // TOUJOURS « approuvée » — donc personne n'a statué entre-temps, et le
    // rejet de l'humain doit primer.
    //
    // Mutée, `base` retombe à `null` : la comparaison `'approved' !== null`
    // échoue, l'entrée est jetée, et le rejet disparaît SANS UN MOT.
    poserTampon({ 't-avis': { state: 'rejected', base: 'approved' } });

    hydrateReviews({ 't-avis': 'approved' });
    await drainer();

    expect(getReview('t-avis'), 'le geste le plus récent est celui de l’humain').toBe('rejected');
    expect(vi.mocked(postReview), 'et il est bien renvoyé').toHaveBeenCalled();
  });

  it('UN GESTE PÉRIMÉ EST ABANDONNÉ — la décision d’un autre opérateur prime', async () => {
    // L'autre moitié de la règle, sans laquelle la première serait creuse : si
    // le serveur a changé DEPUIS le geste, c'est qu'un autre a statué plus
    // récemment. Le geste local est périmé, et la valeur serveur reste.
    poserTampon({ 't-perime': { state: 'rejected', base: null } });

    hydrateReviews({ 't-perime': 'approved' });
    await drainer();

    expect(getReview('t-perime'), 'la décision serveur, plus récente, l’emporte').toBe('approved');
    expect(vi.mocked(postReview), 'et rien n’est renvoyé').not.toHaveBeenCalled();
  });

  it('UN TAMPON ILLISIBLE NE FAIT RIEN PERDRE D’AUTRE — il est simplement ignoré', () => {
    // `JSON.parse` sur du texte corrompu lève : le `catch` rend un tampon vide
    // plutôt que de laisser l'exception remonter jusqu'au rendu de la page.
    localStorage.setItem(TAMPON, 'ceci n’est pas du JSON');
    expect(() => countUnsyncedReviews()).not.toThrow();
    expect(countUnsyncedReviews()).toBe(0);
  });

  it('LE COMPTE DES NON-SYNCHRONISÉES VOIT LES DEUX FORMATS', () => {
    // Le bandeau « N verdicts non synchronisés » est ce qui dit à l'humain
    // qu'il a du travail en attente. S'il ne comptait qu'un format, quelqu'un
    // fermerait l'onglet en croyant tout parti.
    poserTampon({ 't-neuf': { state: 'approved', base: null }, 't-ancien': 'rejected' });
    expect(countUnsyncedReviews()).toBe(2);
  });
});
