// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CONNECTEUR GITHUB — quelle ligne est en train de voyager, et laquelle est déjà prise.
//
// ─── CE QUI ÉTAIT DÉJÀ GARDÉ ─────────────────────────────────────────────────
//
// Recensement fait depuis la RACINE, sur les DEUX racines de bancs
// (§ 9 quattuortrigicenties). `projets-alveoles` tient déjà deux points :
// l'habit de l'erreur GitHub, et le « aucun dépôt ne correspond ». Ce fichier
// ne les rejoue pas.
//
// ─── LES QUATRE QUI RESTAIENT NUES ───────────────────────────────────────────
//
// Mutées ensemble, chacune vérifiée posée, suite entière verte — 284 fichiers,
// 4 158 tests :
//
//     occupe === d.fullName ? 'Connexion…' : 'Connecter'   →  occupe !== null ? …
//     {d.importe ? <déjà connecté> : <bouton>}             →  {!d.importe ? …}
//     {!user && <avertissement sans propriétaire>}         →  {user && …}
//     {d.description && <span>}                            →  {d.description || <span>}
//
// ─── POURQUOI « QUELLE LIGNE VOYAGE » EST LA PLUS CHÈRE ──────────────────────
//
// L'import est long : la ruche clone le dépôt. Pendant ce temps, une seule
// ligne doit dire « Connexion… ». Muté en `occupe !== null`, TOUTES l'annoncent
// — l'écran affirme qu'on connecte dix dépôts alors qu'on en connecte un.
//
// C'est encore la famille du mauvais SUJET, cette fois à l'échelle d'une liste :
// l'état d'UNE ligne peint toutes ses voisines.
//
// ─── ET `importe`, QUE LE TYPE LUI-MÊME EXPLIQUE ─────────────────────────────
//
//     /** Déjà connecté à la ruche : deux projets sur un même dépôt, c'est deux
//      *  plans de merge concurrents sur les mêmes fichiers. */
//     importe: boolean;
//
// Le coût est écrit dans le type. Muté, l'écran propose de reconnecter ce qui
// l'est déjà — et invite à créer la situation que le champ existe pour éviter.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import type { DepotGithub } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchReport: vi.fn(() => Promise.resolve(null)),
  fetchConseils: vi.fn(() => Promise.resolve({ conseils: [] })),
  fetchConseil: vi.fn(() => Promise.reject(new Error('aucune session simulée'))),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'c-1' })),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchProjetsOuverts: vi.fn(() => Promise.resolve({ projets: [] })),
  fetchDepotsGithub: vi.fn(() => Promise.resolve({ depots: [], total: 0 })),
  fetchStatutGithub: vi.fn(() => Promise.resolve({ configure: true })),
  importerDepotGithub: vi.fn(() => new Promise(() => {})),
  fetchMembresProjet: vi.fn(() => Promise.resolve({ membres: [] })),
  fetchPartages: vi.fn(() => Promise.resolve({ partages: [] })),
  fetchIssues: vi.fn(() => Promise.resolve({ issues: [] })),
  fetchLivraisons: vi.fn(() => Promise.resolve({ livraisons: [] })),
  fetchEssaim: vi.fn(() => Promise.resolve(null)),
  fetchProjectBalance: vi.fn(() => Promise.resolve(null)),
  planBrief: vi.fn(() => Promise.resolve({ tasks: [], source: 'heuristic' })),
  addTasks: vi.fn(() => Promise.resolve([])),
  // Sondes des ENFANTS, pas de la vue (§ 9 duotrigicenties).
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  fetchGardeFou: vi.fn(() => Promise.resolve(null)),
  postReview: vi.fn(() => Promise.resolve()),
}));

import { fetchDepotsGithub, fetchStatutGithub } from '../dashboard/src/api';
import Projets from '../dashboard/src/views/Projets';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchDepotsGithub).mockResolvedValue({ depots: [], total: 0 } as never);
  vi.mocked(fetchStatutGithub).mockResolvedValue({ configure: true } as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

const depot = (fullName: string, over: Partial<DepotGithub> = {}): DepotGithub => ({
  fullName,
  nom: fullName.split('/')[1] ?? fullName,
  description: 'Un dépôt qui se décrit',
  prive: false,
  cloneUrl: `https://github.com/${fullName}.git`,
  htmlUrl: `https://github.com/${fullName}`,
  langage: 'TypeScript',
  pousseA: 1_700_000_000_000,
  archive: false,
  importe: false,
  ...over,
});

async function monter(user: { id: string; role: string } | null): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [],
      nodes: [],
      tasks: [],
      tasksTotal: 0,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
    user,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Projets {...props} />));
  await act(async () => {});
  return document.body;
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((e) =>
    (e.textContent ?? '').includes(libelle),
  );
  if (!b) throw new Error(`bouton « ${libelle} » introuvable`);
  return b as HTMLButtonElement;
}

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Déplie le connecteur sur la liste de dépôts donnée. */
async function ouvrirLeConnecteur(
  depots: DepotGithub[],
  user: { id: string; role: string } | null = { id: 'u-1', role: 'user' },
): Promise<HTMLElement> {
  vi.mocked(fetchDepotsGithub).mockResolvedValue({ depots, total: depots.length } as never);
  const dom = await monter(user);
  await cliquer(bouton(dom, 'Connecter un dépôt GitHub'));
  return dom;
}

/** Les lignes de dépôts, dans l'ordre. */
const lignes = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.pj-gh-liste li'),
];

/** La ligne d'un dépôt, désignée par SON nom — jamais par son rang. */
function ligneDe(dom: HTMLElement, fullName: string): HTMLElement {
  const l = lignes(dom).find((e) => (e.textContent ?? '').includes(fullName));
  if (!l) throw new Error(`la ligne de « ${fullName} » est introuvable`);
  return l;
}

describe('le connecteur GitHub : une liste où chaque ligne parle pour elle', () => {
  it('LES DÉPÔTS SE LISTENT — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const dom = await ouvrirLeConnecteur([depot('rucher/miel'), depot('rucher/cire')]);

    expect(lignes(dom), 'les dépôts ne se listent pas').toHaveLength(2);
    expect(ligneDe(dom, 'rucher/miel').textContent, 'la description manque').toContain(
      'Un dépôt qui se décrit',
    );
    expect(
      bouton(ligneDe(dom, 'rucher/miel'), 'Connecter').disabled,
      'le bouton part désactivé',
    ).toBe(false);
  });

  it('SEULE LA LIGNE QU’ON CONNECTE ANNONCE « CONNEXION… »', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // L'import est long : la ruche clone le dépôt. `importerDepotGithub` est
    // bouchonnée par une promesse qu'on ne tient JAMAIS — c'est ainsi qu'on
    // fige l'état « en vol » et qu'on peut le regarder.
    //
    // Muté en `occupe !== null`, toutes les lignes s'annoncent en connexion :
    // l'écran affirme qu'on connecte deux dépôts alors qu'on en connecte un.
    const dom = await ouvrirLeConnecteur([depot('rucher/miel'), depot('rucher/cire')]);

    await cliquer(bouton(ligneDe(dom, 'rucher/miel'), 'Connecter'));

    expect(
      ligneDe(dom, 'rucher/miel').textContent,
      'la ligne qu’on connecte ne le dit pas',
    ).toContain('Connexion…');
    expect(
      ligneDe(dom, 'rucher/cire').textContent,
      'une ligne au repos s’annonce en connexion — l’état d’une ligne peint ses voisines',
    ).not.toContain('Connexion…');
    // Et pendant ce voyage, aucune autre ne part : deux clones concurrents sur
    // la même ruche, c'est ce que la désactivation empêche.
    expect(
      bouton(ligneDe(dom, 'rucher/cire'), 'Connecter').disabled,
      'une seconde connexion peut partir pendant la première',
    ).toBe(true);
  });

  it('UN DÉPÔT DÉJÀ CONNECTÉ NE S’OFFRE PAS UNE SECONDE FOIS', async () => {
    // ─── CE QUE LE TYPE LUI-MÊME EXPLIQUE ──────────────────────────────────
    //
    //     « Déjà connecté à la ruche : deux projets sur un même dépôt, c'est
    //       deux plans de merge concurrents sur les mêmes fichiers. »
    //
    // Le coût est écrit dans le type. Muté, l'écran invite à créer exactement
    // la situation que ce champ existe pour éviter.
    //
    // Les deux mondes dans le même montage : sans quoi « pas de bouton »
    // pourrait venir d'une liste qui n'en rend aucun.
    const dom = await ouvrirLeConnecteur([
      depot('rucher/deja', { importe: true }),
      depot('rucher/neuf', { importe: false }),
    ]);

    const deja = ligneDe(dom, 'rucher/deja');
    expect(deja.textContent, 'un dépôt déjà connecté ne le dit pas').toContain('déjà connecté');
    expect(
      deja.querySelector('button'),
      'un dépôt déjà connecté se voit proposer de l’être encore',
    ).toBeNull();

    expect(
      ligneDe(dom, 'rucher/neuf').querySelector('button'),
      'un dépôt neuf n’a pas de bouton',
    ).not.toBeNull();
  });

  it('SANS COMPTE, L’ÉCRAN EXIGE LA CONNEXION — plus d’import orphelin proposé', async () => {
    // ─── L'AUTRE BOUT DU CUL-DE-SAC ────────────────────────────────────────
    //
    // Un dépôt importé sans compte appartient à la ruche, pas à quelqu'un — et
    // sans propriétaire, personne ne peut y admettre d'ouvrière. Prévenir ne
    // suffisait pas : l'écran proposait quand même le bouton. On exige
    // maintenant le compte avant toute liste.
    const sansCompte = await ouvrirLeConnecteur([depot('rucher/miel')], null);
    expect(
      sansCompte.textContent,
      'sans compte, rien n’invite à se connecter',
    ).toContain('Se connecter pour importer');
    expect(
      sansCompte.querySelector('.pj-gh-liste'),
      'la liste des dépôts s’affiche sans compte',
    ).toBeNull();
    expect(fetchDepotsGithub, 'GitHub est interrogé sans compte').not.toHaveBeenCalled();

    act(() => racine?.unmount());
    conteneur?.remove();

    const avecCompte = await ouvrirLeConnecteur([depot('rucher/miel')], {
      id: 'u-1',
      role: 'user',
    });
    expect(
      avecCompte.textContent,
      'le CTA de connexion s’affiche à un compte connecté',
    ).not.toContain('Se connecter pour importer');
    expect(ligneDe(avecCompte, 'rucher/miel').querySelector('button')).not.toBeNull();
  });

  it('UN DÉPÔT SANS DESCRIPTION N’EN AFFICHE PAS UNE VIDE', async () => {
    // La garde que le code signale lui-même sans la tenir : « muté en `||`, une
    // description absente rend un <span> vide et stylé plutôt que rien ».
    // Un commentaire qui explique n'est pas une garde (§ 9 sexvicicenties).
    //
    // L'entrée qui tranche est un dépôt SANS description — avec, les deux
    // versions rendent la même chose.
    const dom = await ouvrirLeConnecteur([depot('rucher/muet', { description: '' })]);

    expect(
      ligneDe(dom, 'rucher/muet').querySelector('.pj-gh-desc'),
      'une description vide occupe quand même sa place à l’écran',
    ).toBeNull();
  });
});
