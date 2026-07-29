// @vitest-environment happy-dom
//
// LA VUE DU CERVEAU.
//
// ─── CE QUI SE TESTE, ET CE QUI NE SE TESTE PAS ──────────────────────────────
//
// Le cœur de l'écran est un canevas animé, et un canevas ne se teste pas :
// happy-dom n'a pas de contexte 2D, et même avec, on ne va pas comparer des
// pixels. C'est dit à voix haute plutôt que laissé croire.
//
// Ce qui SE teste, c'est tout ce que l'écran affirme AUTOUR du dessin, et qui
// peut mentir sans rien casser :
//
//   · le cerveau VIDE doit dire « c'est normal », pas ressembler à une panne ;
//   · les liens MORTS doivent être annoncés comme NON dessinés ;
//   · les compteurs doivent venir du serveur, jamais être recalculés ici ;
//   · la vue LISTE doit porter la même information que le graphe — c'est elle
//     qui rend l'écran utilisable au clavier et par un lecteur d'écran ;
//   · l'écran ne doit RIEN écrire.
//
// Les décisions de filtrage (quelles arêtes survivent, quelle note correspond)
// vivent dans `src/shared/cerveau-graphe.ts`, pur et testé à part. Ce fichier
// ne les re-teste pas : il vérifie qu'elles ARRIVENT à l'écran.

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
let appels: { url: string; methode: string }[] = [];

function poserLeReseau(): void {
  appels = [];
  globalThis.fetch = ((entree: unknown, init?: RequestInit) => {
    appels.push({ url: String(entree), methode: init?.method ?? 'GET' });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => reponse,
    } as Response);
  }) as typeof fetch;
}

/**
 * `requestAnimationFrame` neutralisé : la boucle de simulation tournerait
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
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const texte = (): string => (conteneur.textContent ?? '').replace(/\s+/g, ' ');
const boutons = (): HTMLButtonElement[] => [...conteneur.querySelectorAll('button')];

/**
 * Les tuiles, lues par leur STRUCTURE et non par le texte aplati.
 *
 * Une tuile rend `<b>2</b><span>notes</span>` : `textContent` donne « 2notes »,
 * sans espace. Une assertion sur la chaîne aplatie casserait au premier
 * changement de mise en forme sans que rien de faux ne soit arrivé.
 */
const tuiles = (): Record<string, string> =>
  Object.fromEntries(
    [...conteneur.querySelectorAll('.cerveau-tuile')].map((el) => [
      el.querySelector('span')?.textContent?.trim() ?? '',
      el.querySelector('b')?.textContent?.trim() ?? '',
    ]),
  );

async function cliquer(el: Element | undefined): Promise<void> {
  expect(el, 'élément à cliquer introuvable').toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
    await Promise.resolve();
  });
}

async function taper(valeur: string): Promise<void> {
  const champ = conteneur.querySelector('input[type="search"]') as HTMLInputElement | null;
  expect(champ, 'champ de recherche introuvable').toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(champ, valeur);
    champ!.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

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
      titre: 'Décision de sûreté sur spawn',
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
    reponse = vide;
    await monter();
    expect(texte()).toMatch(/vide/i);
    expect(texte(), 'un cerveau neuf ne doit pas se lire comme une erreur').toMatch(/normal/i);
  });

  it('…et il dit COMMENT il se remplira', async () => {
    reponse = vide;
    await monter();
    expect(texte()).toMatch(/épisode/i);
  });

  it('il montre le dossier — c’est la seule piste quand rien n’apparaît', async () => {
    reponse = vide;
    await monter();
    expect(texte()).toContain('/data/cerveau');
  });

  it('et il ne propose NI recherche NI filtres — il n’y a rien à filtrer', async () => {
    // Une barre d'outils sur un écran vide donne des gestes qui ne font rien.
    reponse = vide;
    await monter();
    expect(conteneur.querySelector('input[type="search"]')).toBeNull();
  });
});

describe('CE QUE L’ÉCRAN ANNONCE SUR UN CERVEAU PEUPLÉ', () => {
  it('les compteurs viennent du SERVEUR, ils ne sont pas recalculés ici', async () => {
    reponse = peuple;
    await monter();
    expect(tuiles()).toEqual({
      notes: '2',
      'ont servi': '1',
      dorment: '1',
      'liens morts': '1',
    });
  });

  it('LES LIENS MORTS SONT ANNONCÉS COMME NON DESSINÉS', async () => {
    reponse = peuple;
    await monter();
    const s = texte();
    expect(s).toMatch(/1 liens morts/);
    expect(s, 'l’écran doit dire qu’il ne les dessine PAS').toMatch(/ne sont PAS dessinés/i);
    expect(s, 'la cible manquante doit être nommée pour être réparée').toContain('note-disparue');
  });

  it('les cinq genres sont proposés au filtre, y compris ceux à zéro', async () => {
    // « Aucun invariant » est justement ce qu'il faut voir : un genre absent
    // de la barre ferait disparaître l'information.
    reponse = peuple;
    await monter();
    expect(conteneur.querySelectorAll('.cerveau-puce')).toHaveLength(5);
    expect(texte()).toMatch(/décisions/);
  });
});

describe('EXPLORER : la recherche et les filtres ARRIVENT à l’écran', () => {
  it('la recherche restreint la liste — et ignore les accents', async () => {
    // Le filtrage lui-même est testé en pur ; ici on vérifie qu'il est CÂBLÉ.
    reponse = peuple;
    await monter();
    await cliquer(boutons().find((b) => b.textContent?.trim() === 'Liste'));
    expect(conteneur.querySelectorAll('tbody tr')).toHaveLength(2);

    await taper('decision');
    const lignes = [...conteneur.querySelectorAll('tbody tr')];
    expect(lignes, 'la recherche sans accent doit trouver « Décision »').toHaveLength(1);
    expect(lignes[0]?.textContent).toMatch(/Décision de sûreté/);
  });

  it('une recherche sans résultat le DIT, au lieu d’un écran vide', async () => {
    // Un tableau vide sans phrase se confond avec un cerveau vide — deux
    // situations opposées, et la mauvaise est celle qui inquiète.
    reponse = peuple;
    await monter();
    await cliquer(boutons().find((b) => b.textContent?.trim() === 'Liste'));
    await taper('zzzz-introuvable');
    expect(texte()).toMatch(/Aucune note ne correspond/);
  });

  it('la tuile « dorment » filtre sur les notes jamais servies', async () => {
    reponse = peuple;
    await monter();
    await cliquer(boutons().find((b) => b.textContent?.includes('dorment')));
    await cliquer(boutons().find((b) => b.textContent?.trim() === 'Liste'));
    const lignes = [...conteneur.querySelectorAll('tbody tr')];
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.textContent).toMatch(/fetch failed/);
  });

  it('les tuiles parlent du cerveau ENTIER même quand un filtre est actif', async () => {
    // Sinon on lit « 1 note » sur un écran dont l'en-tête doit rappeler qu'il
    // y en a deux — et on croit en avoir perdu une.
    reponse = peuple;
    await monter();
    await cliquer(boutons().find((b) => b.textContent?.includes('dorment')));
    expect(tuiles().notes, 'le total doit rester celui du cerveau entier').toBe('2');
  });
});

describe('LA VUE LISTE EST L’ACCESSIBILITÉ, PAS UN REPLI DÉGRADÉ', () => {
  it('elle porte les mêmes faits que le graphe, dans un vrai tableau', async () => {
    // ─── POURQUOI CE MODE EXISTE ───────────────────────────────────────────
    //
    // Un canevas est muet pour un lecteur d'écran et inutilisable au clavier.
    // Le dépôt tient déjà `NO_COLOR`, `TERM=dumb` et l'absence de TTY : un
    // écran qui n'existerait qu'en pixels serait le seul endroit où cette
    // exigence s'arrête.
    reponse = peuple;
    await monter();
    await cliquer(boutons().find((b) => b.textContent?.trim() === 'Liste'));

    expect(conteneur.querySelector('table'), 'aucun tableau').toBeTruthy();
    expect(conteneur.querySelector('caption'), 'un tableau sans légende').toBeTruthy();
    // Les en-têtes portent leur portée : sans `scope`, un lecteur d'écran ne
    // sait pas relier une cellule à sa colonne.
    const enTetes = [...conteneur.querySelectorAll('thead th')];
    expect(enTetes.length).toBeGreaterThan(3);
    expect(enTetes.every((th) => th.getAttribute('scope') === 'col')).toBe(true);

    const s = texte();
    expect(s, 'le titre doit être lisible en texte').toContain('fetch failed pendant la loupe');
    expect(s, '« jamais servie » ne doit pas exister QUE dans le graphe').toMatch(/jamais/);
  });

  it('le canevas disparaît en mode liste — pas deux sources à l’écran', async () => {
    reponse = peuple;
    await monter();
    expect(conteneur.querySelector('canvas')).toBeTruthy();
    await cliquer(boutons().find((b) => b.textContent?.trim() === 'Liste'));
    expect(conteneur.querySelector('canvas')).toBeNull();
  });

  it('les bascules annoncent leur état — `aria-pressed`, pas seulement une classe', async () => {
    // Une couleur ne dit rien à qui ne voit pas l'écran.
    reponse = peuple;
    await monter();
    const graphe = boutons().find((b) => b.textContent?.trim() === 'Graphe');
    expect(graphe?.getAttribute('aria-pressed')).toBe('true');
    await cliquer(boutons().find((b) => b.textContent?.trim() === 'Liste'));
    expect(graphe?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('L’ÉCRAN NE MODIFIE JAMAIS LE CERVEAU', () => {
  it('AUCUNE REQUÊTE D’ÉCRITURE, quoi qu’on clique', async () => {
    // ─── POURQUOI C'EST UNE GARDE, ET PAS UN OUBLI ─────────────────────────
    //
    // Promouvoir un épisode en leçon demande de comprendre POURQUOI. Ce geste
    // se fait dans Obsidian, à la main, avec un commit qu'on peut relire et
    // annuler. Un bouton « promouvoir » ferait écrire une règle en un clic —
    // or une règle FAUSSE coûte plus cher que pas de règle du tout, parce
    // qu'elle est SUIVIE et transmise à chaque tâche.
    //
    // La version précédente de cette garde comptait les boutons et exigeait
    // zéro. Elle est tombée dès qu'on a ajouté des filtres — alors que rien
    // n'écrivait. Elle mesurait un SYMPTÔME. Celle-ci mesure la chose
    // elle-même : aucune requête mutante ne part, quel que soit le geste.
    reponse = peuple;
    await monter();
    for (const b of boutons()) await cliquer(b);
    await taper('quelque chose');

    const mutantes = appels.filter((a) => a.methode !== 'GET');
    expect(
      mutantes,
      `l’écran a émis ${mutantes.length} requête(s) d’écriture : ${JSON.stringify(mutantes)}`,
    ).toEqual([]);
    expect(appels.every((a) => a.url.includes('/api/admin/cerveau'))).toBe(true);
  });
});
