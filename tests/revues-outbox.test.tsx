// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'OUTBOX DES REVUES — ce qui décide qu'un verdict humain survit, ou non.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage complet de `shared.tsx` (base épinglée `e93b252`, 503 ajoutées /
// 0 retirée) : **22 candidates, 22 examinées, 12 défendues, 10 SANS TEST**.
// Dernier fichier jamais balayé du terrain `dashboard/src/views`.
//
// ─── POURQUOI CELUI-CI N'EST PAS COMME LES SIX AUTRES ────────────────────────
//
// Les six vues balayées avant lui rendaient des nues D'AFFICHAGE : un pluriel
// fautif, une tuile « chaude » à zéro, une pastille de propriété inversée. On
// lit un mensonge à l'écran, la donnée est intacte.
//
// Ici, six des dix nues vivent dans la machinerie qui décide si le verdict
// d'un humain est GARDÉ, JETÉ ou REJOUÉ — et chacune échoue en SILENCE, en
// annonçant le succès :
//
//   · le chemin de SUCCÈS, dans les deux sens : un verdict changé pendant le
//     vol perd sa marque « non synchronisé » et n'est jamais rejoué ;
//   · le chemin d'ÉCHEC, dans les deux sens : une panne TRANSITOIRE (réseau,
//     5xx, 401) purge l'entrée que le commentaire du fichier promet de garder ;
//   · le drain CONCURRENT : le verdict d'un collègue arrivé pendant le vol est
//     jeté au lieu de reprendre la main.
//
// Le commentaire du fichier énonce le contrat exact — « Échec DÉFINITIF […]
// l'entrée est purgée. Échec transitoire […] l'entrée reste, re-postée » — et
// rien ne le tenait. Un commentaire qui explique n'est pas une garde
// (§ 9 sexvicicenties), et celui-ci gardait la donnée d'un utilisateur.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => {
  const vrai = await importOriginal<Record<string, unknown>>();
  return { ...vrai, postReview: vi.fn() };
});

import { ApiError, postReview } from '../dashboard/src/api';
import {
  Sparkline,
  applyReviewEvent,
  countUnsyncedReviews,
  getReview,
  hydrateReviews,
  setReview,
} from '../dashboard/src/views/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Une promesse qu'on dénoue À LA MAIN : le vol du POST est un ÉTAT, pas un délai. */
function enVol(): { promesse: Promise<void>; tenir: () => void; rompre: (e: unknown) => void } {
  let tenir!: () => void;
  let rompre!: (e: unknown) => void;
  const promesse = new Promise<void>((ok, ko) => {
    tenir = () => ok();
    rompre = (e) => ko(e);
  });
  return { promesse, tenir, rompre };
}

/** Laisse les micro-tâches s'écouler — aucune horloge n'est consultée. */
const respirer = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(postReview).mockReset();
  // Repart d'un serveur connu et VIDE : sans hydratation, le cache s'amorce
  // sur le repli local et les cas se contamineraient l'un l'autre.
  hydrateReviews({});
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('le chemin de SUCCÈS ne jette pas un verdict plus récent', () => {
  it('UN VERDICT CHANGÉ PENDANT LE VOL RESTE « non synchronisé »', async () => {
    // `if (taskId in m && m[taskId]?.state === state)` — la condition dit
    // « l'entrée en attente est bien celle que je viens d'envoyer ».
    //
    //   · mutée en `||`  : on efface dès que la tâche est dans l'outbox, même
    //     si l'utilisateur a changé d'avis entre-temps ;
    //   · mutée en `!==` : on efface QUAND ÇA A CHANGÉ, et on garde quand le
    //     serveur a confirmé — les deux moitiés à l'envers.
    //
    // Dans les deux cas le second verdict perd sa marque et n'est jamais
    // rejoué : il est perdu, et le bandeau annonce « tout est synchronisé ».
    const premier = enVol();
    const second = enVol();
    vi.mocked(postReview)
      .mockReturnValueOnce(premier.promesse as never)
      .mockReturnValueOnce(second.promesse as never);

    setReview('t-change', 'approved');
    await respirer();
    expect(countUnsyncedReviews(), 'le premier verdict n’est pas en attente').toBe(1);

    // L'utilisateur change d'avis AVANT que le premier POST ne réponde.
    setReview('t-change', 'rejected');
    await respirer();

    premier.tenir(); // le serveur confirme… l'ANCIEN verdict
    await respirer();

    expect(
      countUnsyncedReviews(),
      'le verdict le plus récent a perdu sa marque « non synchronisé »',
    ).toBe(1);
    expect(getReview('t-change'), 'le verdict le plus récent a été écrasé').toBe('rejected');
  });

  it('UN VERDICT CONFIRMÉ TEL QUEL PERD SA MARQUE — le cas positif', async () => {
    const vol = enVol();
    vi.mocked(postReview).mockReturnValueOnce(vol.promesse as never);

    setReview('t-confirme', 'approved');
    await respirer();
    expect(countUnsyncedReviews()).toBe(1);

    vol.tenir();
    await respirer();
    expect(countUnsyncedReviews(), 'un verdict confirmé reste marqué non synchronisé').toBe(0);
  });
});

describe('le chemin d’ÉCHEC distingue le définitif du transitoire', () => {
  it('UNE PANNE TRANSITOIRE (5xx) GARDE l’entrée pour la rejouer', async () => {
    // `err instanceof ApiError && [400,404,422].includes(err.status)` mutée en
    // `||` : la moitié gauche suffit, donc TOUTE ApiError purge — y compris un
    // 500 ou un 401. Le verdict est jeté juste au moment où le filet devait
    // le retenir.
    const vol = enVol();
    vi.mocked(postReview).mockReturnValueOnce(vol.promesse as never);

    setReview('t-transitoire', 'approved');
    await respirer();
    vol.rompre(new ApiError('panne serveur', 500));
    await respirer();

    expect(
      countUnsyncedReviews(),
      'une panne transitoire a purgé le verdict au lieu de le garder',
    ).toBe(1);
  });

  it('UN REJET QUI N’EST PAS UNE ApiError NE PURGE RIEN, MÊME AVEC UN « status » 404', async () => {
    // `instanceof ApiError` élargi en `instanceof Object` : n'importe quel
    // objet rejeté portant `status: 404` devient un échec « définitif » et
    // emporte le verdict. Le type est la garde ; l'élargir l'ouvre à tout.
    const vol = enVol();
    vi.mocked(postReview).mockReturnValueOnce(vol.promesse as never);

    setReview('t-nonapi', 'approved');
    await respirer();
    vol.rompre({ status: 404, message: 'pas une ApiError' });
    await respirer();

    expect(
      countUnsyncedReviews(),
      'un objet quelconque portant status 404 a purgé le verdict',
    ).toBe(1);
  });

  it('UN ÉCHEC DÉFINITIF (404) PURGE — le cas positif, sans quoi les deux au-dessus sont du décor', async () => {
    const vol = enVol();
    vi.mocked(postReview).mockReturnValueOnce(vol.promesse as never);

    setReview('t-definitif', 'approved');
    await respirer();
    vol.rompre(new ApiError('tâche disparue', 404));
    await respirer();

    expect(countUnsyncedReviews(), 'un échec définitif laisse l’entrée se rejouer sans fin').toBe(
      0,
    );
  });
});

describe('le drain rend la main au verdict d’un AUTRE opérateur', () => {
  it('UN VERDICT WS REÇU PENDANT LE VOL REPREND LA MAIN AU DRAIN', async () => {
    // `if (buffered !== current)` mutée en `===` : le rejeu n'a lieu QUE si le
    // tampon vaut déjà l'état courant (un geste pour rien) et il est SAUTÉ
    // quand ils diffèrent — c'est-à-dire exactement quand un collègue a statué.
    // Deux personnes revoient la même tâche, l'une des deux perd, en silence.
    const vol = enVol();
    vi.mocked(postReview).mockReturnValueOnce(vol.promesse as never);

    setReview('t-concurrent', 'approved');
    await respirer();

    // Pendant le vol, un autre opérateur rejette la même tâche.
    applyReviewEvent('t-concurrent', 'rejected', 'un-autre-onglet');
    await respirer();
    expect(getReview('t-concurrent'), 'le tampon ne doit pas s’appliquer pendant le vol').toBe(
      'approved',
    );

    vol.tenir();
    await respirer();

    expect(getReview('t-concurrent'), 'le verdict du collègue a été jeté au drain').toBe(
      'rejected',
    );
  });
});

describe('le repli local garde les verdicts, pas les retraits', () => {
  it('UN VERDICT POSÉ EST ÉCRIT DANS LE REPLI, UN RETRAIT L’EN RETIRE', async () => {
    // `if (state === null) delete local[taskId]; else local[taskId] = state;`
    // mutée en `!==` : les deux branches s'échangent. Le repli finit par ne
    // contenir QUE les verdicts retirés — et perd tous les autres, c'est-à-dire
    // précisément ce qu'il existe pour survivre à un rechargement.
    const vol = enVol();
    vi.mocked(postReview).mockReturnValue(vol.promesse as never);

    setReview('t-repli', 'approved');
    await respirer();
    const apresPose = JSON.parse(localStorage.getItem('hive.review') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(apresPose['t-repli'], 'le verdict posé n’est pas dans le repli local').toBe('approved');

    setReview('t-repli', null);
    await respirer();
    const apresRetrait = JSON.parse(localStorage.getItem('hive.review') ?? '{}') as Record<
      string,
      unknown
    >;
    expect('t-repli' in apresRetrait, 'le retrait n’a pas vidé le repli local').toBe(false);
  });
});

describe('la sparkline tient ses trois cas dégénérés', () => {
  let racine: Root | null = null;
  let conteneur: HTMLElement | null = null;

  const dessiner = (values: number[], beat = false): SVGElement => {
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine?.render(<Sparkline values={values} beat={beat} />));
    const svg = conteneur.querySelector('svg');
    if (!svg) throw new Error('la sparkline n’est pas rendue');
    return svg;
  };

  afterEach(() => {
    act(() => racine?.unmount());
    conteneur?.remove();
    racine = null;
    conteneur = null;
  });

  it('UNE SÉRIE VIDE DEVIENT UN POINT À ZÉRO, ET NE PERD PAS LES AUTRES', () => {
    // `if (values.length === 0) values = [0]` mutée en `!==` : c'est la série
    // PLEINE qu'on remplace par [0] — la vraie donnée est jetée.
    const vide = dessiner([]);
    const ptsVide = vide.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(ptsVide, 'la série vide ne rend pas un point').toBeTruthy();
    expect(vide.getAttribute('class')).toContain('flat');

    const pleine = dessiner([1, 5, 3]);
    const pts = (pleine.querySelector('polyline')?.getAttribute('points') ?? '').split(' ');
    expect(pts, 'une série pleine a été remplacée par un point').toHaveLength(3);
  });

  it('UN SEUL POINT NE DIVISE PAS PAR ZÉRO', () => {
    // `values.length > 1` mutée en `>=` : à UN point, `width / (1 - 1)` vaut
    // Infinity, la coordonnée x devient non finie et SVG ne trace plus rien.
    const svg = dessiner([7]);
    const pts = svg.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(pts, 'la coordonnée est non finie (division par zéro)').not.toContain('Infinity');
    expect(pts, 'la coordonnée est non finie (NaN)').not.toContain('NaN');
    expect(pts.startsWith('0.0,'), 'le point unique n’est pas à l’origine en x').toBe(true);
  });

  it('UNE SÉRIE TOUTE À ZÉRO EST « flat » ET NE BAT PAS', () => {
    // `values.every((v) => v === 0)` mutée en `!==` : « plat » devient vrai
    // quand AUCUNE valeur n'est nulle. Et `beat && !flat` mutée en `||` fait
    // battre un trait plat.
    const plate = dessiner([0, 0, 0], true);
    const c = plate.getAttribute('class') ?? '';
    expect(c, 'une série nulle n’est pas marquée plate').toContain('flat');
    expect(c, 'un trait plat bat quand même').not.toContain('beat');

    const vivante = dessiner([1, 2, 3], true);
    const c2 = vivante.getAttribute('class') ?? '';
    expect(c2, 'une série vivante est marquée plate').not.toContain('flat');
    expect(c2, 'une série vivante ne bat pas').toContain('beat');
  });
});
