// @vitest-environment happy-dom
//
// LA VUE DU CERVEAU.
//
// ─── CE QUI SE TESTE, ET CE QUI NE SE TESTE PAS ──────────────────────────────
//
// Le cœur de cet écran est un canevas animé, et un canevas ne se teste pas :
// happy-dom n'a pas de contexte 2D, et même avec, on ne va pas comparer des
// pixels. C'est dit à voix haute plutôt que laissé croire.
//
// Ce qui SE teste, c'est tout ce que l'écran affirme AUTOUR du dessin, et qui
// peut mentir sans casser :
//
//   · le cerveau VIDE doit dire « c'est normal », pas « erreur » — un premier
//     démarrage n'est pas une panne, et l'écran qui l'annoncerait comme telle
//     enverrait quelqu'un chercher un problème qui n'existe pas ;
//   · les liens MORTS doivent être annoncés comme non dessinés — sinon on
//     croit que le graphe est complet ;
//   · les compteurs doivent venir du serveur, jamais être recalculés ici.
//
// Le reste — quelles arêtes existent, laquelle est morte — est décidé dans
// `src/shared/cerveau-graphe.ts`, qui est pur et testé à part. Ce fichier ne
// re-teste pas ces décisions : il vérifie qu'elles ARRIVENT à l'écran.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import Cerveau from '../src/views/Cerveau';
import { setLang } from '../src/i18n';
import type { CerveauGraphe } from '../src/api';
import type { ViewProps } from '../src/views/shared';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ─── Le réseau ──────────────────────────────────────────────────────────────

let reponse: CerveauGraphe;

function poserLeReseau(): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => reponse,
    } as Response)) as typeof fetch;
}

/**
 * `requestAnimationFrame` est neutralisé : la boucle de simulation tournerait
 * indéfiniment dans le test, et elle n'a rien à y prouver. On garde UN passage
 * — assez pour attraper une erreur de dessin, pas assez pour boucler.
 */
function poserLAnimation(): void {
  let tours = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    if (tours++ < 1) cb(16);
    return tours;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
}

// ─── Montage ────────────────────────────────────────────────────────────────

let conteneur: HTMLElement;
let racine: Root;

const PROPS = {} as ViewProps;

async function monter(): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine.render(<Cerveau {...PROPS} />);
  });
  // Laisse le poll résoudre sa promesse.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const texte = (): string => (conteneur.textContent ?? '').replace(/\s+/g, ' ');

// ─── Les données ────────────────────────────────────────────────────────────

const vide: CerveauGraphe = {
  noeuds: [],
  aretes: [],
  liensMorts: [],
  orphelines: [],
  parGenre: { invariant: 0, lecon: 0, decision: 0, carte: 0, episode: 0 },
  servies: 0,
  total: 0,
  dossier: '/data/cerveau',
};

const peuple: CerveauGraphe = {
  noeuds: [
    {
      id: 'inv-shell-false',
      genre: 'invariant',
      titre: 'shell: false sur tout spawn',
      recurrences: 4,
      degre: 1,
      ageJours: 12,
      serviIlYaJours: 0,
    },
    {
      id: 'ep-fetch-failed',
      genre: 'episode',
      titre: 'fetch failed pendant la loupe',
      recurrences: 1,
      degre: 1,
      ageJours: 3,
      serviIlYaJours: null,
    },
  ],
  aretes: [{ de: 'ep-fetch-failed', vers: 'inv-shell-false', reciproque: false }],
  liensMorts: [{ de: 'inv-shell-false', vers: 'note-disparue' }],
  orphelines: [],
  parGenre: { invariant: 1, lecon: 0, decision: 0, carte: 0, episode: 1 },
  servies: 1,
  total: 2,
  dossier: '/data/cerveau',
};

beforeAll(() => {
  setLang('fr');
});

beforeEach(() => {
  poserLeReseau();
  poserLAnimation();
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('UN CERVEAU VIDE EST UN ÉTAT NORMAL', () => {
  it('il le DIT, au lieu de ressembler à une panne', async () => {
    // Premier démarrage : le dossier n'existe pas encore. Un écran muet, ou
    // pire un message d'erreur, enverrait chercher un problème inexistant.
    reponse = vide;
    await monter();
    expect(texte()).toMatch(/vide/i);
    expect(texte(), 'un cerveau neuf ne doit pas se lire comme une erreur').toMatch(/normal/i);
  });

  it('…et il dit COMMENT il se remplira', async () => {
    // « Vide » sans « voici ce qui le remplit » laisse l'utilisateur devant un
    // écran qu'il ne sait pas faire vivre.
    reponse = vide;
    await monter();
    expect(texte()).toMatch(/épisode/i);
  });

  it('il montre le dossier — c’est la seule piste quand rien n’apparaît', async () => {
    reponse = vide;
    await monter();
    expect(texte()).toContain('/data/cerveau');
  });
});

describe('CE QUE L’ÉCRAN ANNONCE SUR UN CERVEAU PEUPLÉ', () => {
  it('les compteurs viennent du SERVEUR, ils ne sont pas recalculés ici', async () => {
    // Un total recalculé côté navigateur dériverait du serveur au premier
    // champ ajouté, et l'écart ne se verrait qu'à l'œil.
    reponse = peuple;
    await monter();
    const s = texte();
    expect(s).toMatch(/2 notes/);
    expect(s).toMatch(/1 liens/);
    expect(s, 'la part servie est ce qui mesure l’usage').toMatch(/1\/2 ont servi/);
  });

  it('LES LIENS MORTS SONT ANNONCÉS COMME NON DESSINÉS', async () => {
    // C'est la phrase qui empêche de croire le graphe complet. Sans elle, une
    // note citée mais absente disparaît sans laisser de trace à l'écran.
    reponse = peuple;
    await monter();
    const s = texte();
    expect(s).toMatch(/1 liens morts/);
    expect(s, 'l’écran doit dire qu’il ne les dessine PAS').toMatch(/ne sont PAS dessinés/i);
    expect(s, 'la cible manquante doit être nommée pour être réparée').toContain('note-disparue');
  });

  it('la légende porte les cinq genres, y compris ceux à zéro', async () => {
    // « Aucun invariant » est justement ce qu'il faut voir : un genre absent
    // de la légende ferait disparaître l'information.
    reponse = peuple;
    await monter();
    const cases = conteneur.querySelectorAll('.cerveau-legende li');
    expect(cases).toHaveLength(5);
    expect(texte()).toMatch(/décisions/);
  });

  it('un cerveau peuplé montre la toile, pas l’état vide', async () => {
    reponse = peuple;
    await monter();
    expect(conteneur.querySelector('canvas'), 'la toile doit être montée').toBeTruthy();
    expect(texte()).not.toMatch(/est vide/i);
  });
});

describe('L’ÉCRAN NE PROPOSE AUCUNE ÉCRITURE', () => {
  it('aucun bouton ne modifie le Cerveau', async () => {
    // ─── POURQUOI C'EST UNE GARDE, ET PAS UN OUBLI ─────────────────────────
    //
    // Promouvoir un épisode en leçon demande de comprendre POURQUOI. Ce geste
    // se fait dans Obsidian, à la main, avec un commit qu'on peut relire et
    // annuler. Un bouton « promouvoir » ferait écrire une règle en un clic —
    // or une règle FAUSSE coûte plus cher que pas de règle du tout, parce
    // qu'elle est SUIVIE et transmise à chaque tâche.
    //
    // Le jour où quelqu'un ajoutera ce bouton, ce test tombera, et il faudra
    // relire ce commentaire avant de le supprimer.
    reponse = peuple;
    await monter();
    expect(conteneur.querySelectorAll('button')).toHaveLength(0);
    expect(conteneur.querySelectorAll('input, textarea')).toHaveLength(0);
  });
});
