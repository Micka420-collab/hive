// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE HIVE MIND — ce que la ruche a retenu, et ce qu'elle en dit.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Recensement des cas existants, sur les DEUX racines de bancs
// (§ 9 quattuortrigicenties) :
//
//     INTENDANCE  16 cas       RUCHE     39 cas      ESSAIM   7 cas
//     PARTAGE      7 cas       RAYON      5 cas      …
//     MÉMOIRE      0 cas       ← la seule vraiment jamais examinée
//
// La liste des « vues jamais examinées » qui circulait était une supposition ;
// le compte l'a corrigée. Mémoire est la seule à zéro.
//
// ─── CE QUE CET ÉCRAN DÉCIDE ─────────────────────────────────────────────────
//
// Quatre gardes, toutes nues — mutées ensemble, chacune vérifiée posée, suite
// entière verte (285 fichiers, 4 163 tests) :
//
//     taskIds.has(m.taskId) ? <bouton> : <span éteint>   →  !taskIds.has(…)
//     m.content.length > SHORT_LEN ? <details> : <p>     →  false / >=
//     {search ? 'aucun ne correspond' : 'rien retenu'}   →  {!search ? …}
//     if (!q) { setSearch(null); return; }               →  if (false) { … }
//
// ─── POURQUOI LES DEUX VIDES NE SONT PAS LE MÊME VIDE ────────────────────────
//
// « La ruche n'a encore rien retenu » et « aucun souvenir ne correspond à cette
// recherche » décrivent des mondes opposés : dans le premier, il n'y a rien à
// trouver ; dans le second, il y a peut-être tout, mais pas ça. Échangés, une
// ruche pleine se déclare vide devant quelqu'un qui n'a rien cherché — et
// l'écran ment sur l'état du produit, pas sur celui de la requête.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot, Task } from '../src/shared/types';
import type { Memory } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMemories: vi.fn(() => Promise.resolve({ total: 0, memories: [] })),
}));

import { fetchMemories } from '../dashboard/src/api';
import Memoire from '../dashboard/src/views/Memoire';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Le seuil du pli, tel que le produit le pose. */
const SHORT_LEN = 200;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
/** Les tâches qu'on a demandé d'ouvrir — c'est là que le lien se mesure. */
let ouvertes: string[] = [];

beforeEach(() => {
  setLang('fr');
  ouvertes = [];
  vi.mocked(fetchMemories).mockResolvedValue({ total: 0, memories: [] } as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

const souvenir = (over: Partial<Memory> = {}): Memory => ({
  id: 1,
  projectId: 'p-1',
  taskId: 't-vivante',
  title: 'Ce que la ruche a retenu',
  content: 'Un souvenir court.',
  createdAt: 1_700_000_000_000,
  score: null,
  ...over,
});

const tache = (id: string): Task =>
  ({
    id,
    projectId: 'p-1',
    title: `Tâche ${id}`,
    prompt: 'p',
    status: 'done',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Task;

async function monter(taches: Task[] = [tache('t-vivante')]): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [{ id: 'p-1', name: 'Rucher', repoUrl: null }],
      nodes: [],
      tasks: taches,
      tasksTotal: taches.length,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: (id: string) => ouvertes.push(id),
    onNavigate: () => {},
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Memoire {...props} />));
  await act(async () => {});
  return conteneur;
}

/** Monte l'écran sur les souvenirs récents donnés. */
async function avecSouvenirs(memories: Memory[], taches?: Task[]): Promise<HTMLElement> {
  vi.mocked(fetchMemories).mockResolvedValue({
    total: memories.length,
    memories,
  } as never);
  return monter(taches);
}

const items = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.ch-mem-item'),
];

/**
 * Écrit dans le champ CONTRÔLÉ par React : le mutateur natif, jamais `.value`.
 *
 * Le champ se trouve par sa STRUCTURE (`form.mind-search`), pas par son
 * `aria-label` — qui est traduit. La première version visait
 * `input[aria-label="Rechercher un souvenir"]` et ne trouvait plus rien dès que
 * l'écran passait en anglais : un outil de banc lié à une langue mesure une
 * langue (§ 9 sexquinquagicenties).
 */
function chercher(dom: HTMLElement, texte: string): void {
  const champ = dom.querySelector<HTMLInputElement>('form.mind-search input');
  if (!champ) throw new Error('le champ de recherche est introuvable');
  const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
    v: string,
  ) => void;
  poser.call(champ, texte);
  champ.dispatchEvent(new Event('input', { bubbles: true }));
}

async function soumettre(dom: HTMLElement): Promise<void> {
  const f = dom.querySelector<HTMLFormElement>('form.mind-search');
  if (!f) throw new Error('le formulaire de recherche est introuvable');
  await act(async () => {
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

describe('le Hive Mind : ce qu’on peut ouvrir, et ce qu’on peut lire', () => {
  it('UN SOUVENIR S’AFFICHE AVEC SA TÂCHE — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const dom = await avecSouvenirs([souvenir()]);

    expect(items(dom), 'aucun souvenir rendu').toHaveLength(1);
    expect(dom.textContent, 'le titre du souvenir manque').toContain('Ce que la ruche a retenu');
    expect(dom.textContent, 'le compte de la ruche n’est pas annoncé').toContain('se souvient');
  });

  it('LA TÂCHE DISPARUE NE SE CLIQUE PAS — et la vivante s’ouvre', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Un souvenir survit à sa tâche : l'élagueur retire les tâches anciennes,
    // le Hive Mind garde ce qu'elles ont appris. Le lien vers l'origine ne mène
    // alors nulle part, et l'écran l'éteint plutôt que d'offrir un bouton qui
    // ne fait rien.
    //
    // Les DEUX mondes dans le même montage : muté, ils s'échangent exactement,
    // et un banc qui n'en regarderait qu'un resterait vert.
    const dom = await avecSouvenirs(
      [
        souvenir({ id: 1, taskId: 't-vivante' }),
        souvenir({ id: 2, taskId: 't-effacee', title: 'Souvenir orphelin' }),
      ],
      [tache('t-vivante')],
    );

    const [vivante, orpheline] = items(dom);
    const bouton = vivante!.querySelector<HTMLElement>('button.ch-mem-task');
    expect(bouton, 'la tâche vivante n’est pas cliquable').not.toBeNull();
    expect(
      orpheline!.querySelector('button.ch-mem-task'),
      'la tâche effacée offre un bouton qui ne mène nulle part',
    ).toBeNull();
    expect(
      orpheline!.querySelector('.ch-gone'),
      'la tâche effacée ne porte pas son habit éteint',
    ).not.toBeNull();

    await act(async () => {
      bouton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(ouvertes, 'le clic n’ouvre pas la tâche d’origine').toEqual(['t-vivante']);
  });

  it('LE PLI SE FAIT AU-DELÀ DE 200 SIGNES — et 200 PILE ne se replie pas', async () => {
    // ─── LE SEUIL, ET SA BORNE (§ 9 trigicenties) ──────────────────────────
    //
    // Sans le pli, un souvenir de 3 000 signes se déroule d'un bloc et la liste
    // devient illisible. Mais la borne compte autant : `>=` replierait un
    // contenu de 200 signes PILE, c'est-à-dire cacherait derrière « (tout
    // voir) » un texte qui tenait déjà à l'écran.
    //
    // Les cas de sens ne départagent pas `>` de `>=` : à 201 comme à 3 000, les
    // deux replient. Seule la valeur ÉGALE les sépare.
    const dom = await avecSouvenirs([
      souvenir({ id: 1, content: 'x'.repeat(SHORT_LEN), title: 'Pile à la borne' }),
      souvenir({ id: 2, content: 'y'.repeat(SHORT_LEN + 1), title: 'Un signe de trop' }),
    ]);

    const [pile, trop] = items(dom);
    expect(
      pile!.querySelector('details'),
      '200 signes pile se replient : le pli mord un cran trop tôt',
    ).toBeNull();
    expect(
      trop!.querySelector('details'),
      'un souvenir plus long que la borne ne se replie pas',
    ).not.toBeNull();
  });

  it('LES DEUX VIDES NE DISENT PAS LA MÊME CHOSE', async () => {
    // ─── DEUX MONDES OPPOSÉS ───────────────────────────────────────────────
    //
    // « La ruche n'a encore rien retenu » : il n'y a rien à trouver.
    // « Aucun souvenir ne correspond » : il y a peut-être tout, mais pas ça.
    //
    // Échangés, une ruche pleine se déclare vide devant quelqu'un qui n'a rien
    // cherché — l'écran ment alors sur l'état du PRODUIT, pas sur celui de la
    // requête.
    const dom = await avecSouvenirs([]);
    expect(dom.textContent, 'une ruche neuve ne le dit pas').toContain('n’a encore rien retenu');

    // Puis une recherche qui ne trouve rien.
    vi.mocked(fetchMemories).mockResolvedValue({ total: 0, memories: [] } as never);
    await act(async () => chercher(dom, 'propolis'));
    await soumettre(dom);

    expect(dom.textContent, 'une recherche infructueuse ne se distingue pas').toContain(
      'Aucun souvenir ne correspond',
    );
    expect(dom.textContent, 'la recherche vide se dit « rien retenu »').not.toContain(
      'n’a encore rien retenu',
    );
  });

  it('UN ENVOI VIDE REVIENT AUX RÉCENTS — il ne cherche pas la chaîne vide', async () => {
    // ─── LA PORTE DU GESTE ─────────────────────────────────────────────────
    //
    // Effacer sa recherche et appuyer sur Entrée est le geste naturel pour
    // revenir en arrière. Sans la garde, il part chercher `''` : une requête
    // inutile, et un écran qui affiche « 0 souvenir pour «  » ».
    const dom = await avecSouvenirs([souvenir()]);
    await act(async () => chercher(dom, 'propolis'));
    await soumettre(dom);
    expect(dom.textContent, 'la recherche n’a pas eu lieu').toContain('pour « propolis »');

    const appelsAvant = vi.mocked(fetchMemories).mock.calls.length;
    await act(async () => chercher(dom, '   '));
    await soumettre(dom);

    expect(
      vi.mocked(fetchMemories).mock.calls.length,
      'un envoi vide part quand même chercher',
    ).toBe(appelsAvant);
    expect(dom.textContent, 'on ne revient pas aux souvenirs récents').not.toContain('pour «');
  });
});

// ─── LES SIX NUES DU BALAYAGE COMPLET ────────────────────────────────────────
//
// Balayage de la loupe sur `dashboard/src/views/Memoire.tsx`, base épinglée dans
// l'atelier (`LOUPE_BASE=e93b252`, 183 ajoutées / 0 retirée), mené jusqu'au bout :
//
//     14 mutation(s) possible(s), 14 examinée(s) — 8 défendues, 6 SANS TEST
//
// Les cas plus haut en défendent trois de plus qu'on ne le croyait : le pli à
// 200 signes, et les DEUX opérateurs de `memories.length === 0 &&`. Mesuré, pas
// supposé — c'est la seule façon de savoir ce qu'un banc tient vraiment.
//
// ─── TROIS DES SIX SONT EN ANGLAIS, ET C'EST UNE FAMILLE ─────────────────────
//
// `t('… chose${total === 1 ? "" : "s"}', '… thing${total === 1 ? "" : "s"}')`
//
// La MÊME décision, écrite deux fois : une par langue. Le membre français est
// défendu, l'anglais était nu — et pareil pour les deux comptes de recherche.
// Tous les bancs de ce dépôt posent `setLang('fr')` : la moitié anglaise du
// produit n'était jamais rendue.
//
// Le trou a été BORNÉ avant d'écrire, par un recensement côté source :
//
//     appels `t(fr, en)` dans dashboard/src : 893
//     dont un membre porte une DÉCISION     :   5
//
// Cinq sur huit cent quatre-vingt-treize — le défaut est réel et ÉNUMÉRABLE, pas
// systémique. Deux de ces cinq vivent ici et sont fermés ci-dessous ; les trois
// autres (`Journal.tsx` ×2, `TaskDrawer.tsx`) sont nommés dans `docs/ETAPES.md`,
// hors de ce lot. Consigné en § 9 sexquinquagicenties.
describe('les six nues du balayage complet', () => {
  /** Le bandeau de compte, pris dans son en-tête — jamais dans le texte entier. */
  const compte = (dom: HTMLElement): string =>
    dom.querySelector('.panel-head .panel-count')?.textContent ?? '';

  /** La note de recherche, celle qui dit combien de souvenirs répondent. */
  const note = (dom: HTMLElement): string =>
    dom.querySelector('.ch-mem-note.muted-text')?.textContent ?? '';

  it('UN SEUL SOUVENIR : « se souvient de 1 chose », au singulier', async () => {
    // ─── LE CAS NOMINAL, ET LA BORNE — total vaut EXACTEMENT 1 ─────────────
    //
    // À deux souvenirs, `=== 1` et `!== 1` rendent tous deux le « s » : rien ne
    // se distingue. Le singulier n'existe qu'au seuil.
    const dom = await avecSouvenirs([souvenir()]);
    expect(compte(dom), 'le compte ne se dit pas').toContain('se souvient de 1 chose');
    expect(compte(dom), 'un seul souvenir prend le pluriel').not.toContain('1 choses');
  });

  it('EN ANGLAIS AUSSI : « remembers 1 thing », et pas « 1 things »', async () => {
    // ─── LA MOITIÉ DU PRODUIT QUE PERSONNE NE RENDAIT ──────────────────────
    //
    // Même garde, autre langue, autre site. Le membre français est défendu par
    // le cas ci-dessus depuis ce lot ; celui-ci était nu parce qu'aucun banc du
    // dépôt ne monte cet écran en anglais.
    setLang('en');
    const dom = await avecSouvenirs([souvenir()]);
    expect(compte(dom), 'le compte anglais ne se dit pas').toContain('remembers 1 thing');
    expect(compte(dom), 'un seul souvenir prend le pluriel en anglais').not.toContain('1 things');
  });

  it('UN SEUL RÉSULTAT : « 1 souvenir pour … », au singulier', async () => {
    const dom = await avecSouvenirs([souvenir()]);
    vi.mocked(fetchMemories).mockResolvedValue({
      total: 1,
      memories: [souvenir({ title: 'La propolis' })],
    } as never);
    await act(async () => chercher(dom, 'propolis'));
    await soumettre(dom);

    expect(note(dom), 'la note de recherche ne se dit pas').toContain('1 souvenir pour');
    expect(note(dom), 'un seul résultat prend le pluriel').not.toContain('1 souvenirs');
  });

  it('UN SEUL RÉSULTAT EN ANGLAIS : « 1 memory for … », pas « 1 memories »', async () => {
    setLang('en');
    const dom = await avecSouvenirs([souvenir()]);
    vi.mocked(fetchMemories).mockResolvedValue({
      total: 1,
      memories: [souvenir({ title: 'La propolis' })],
    } as never);
    await act(async () => chercher(dom, 'propolis'));
    await soumettre(dom);

    expect(note(dom), 'la note anglaise ne se dit pas').toContain('1 memory for');
    expect(note(dom), 'un seul résultat prend le pluriel en anglais').not.toContain('1 memories');
  });

  it('UNE RECHERCHE QUI ÉCHOUE PORTE SON MESSAGE — et rien ne s’affiche au repos', async () => {
    // ─── LES DEUX SENS DE `{error && …}` ───────────────────────────────────
    //
    // Muté en `||`, la garde s'inverse EXACTEMENT : quand une erreur existe, le
    // `||` court-circuite sur la chaîne et le `<p className="panel-error">`
    // n'est jamais construit ; au repos, `null || <p>` rend une bande d'erreur
    // VIDE en permanence. Un écran sain porterait un bandeau rouge muet, et un
    // écran cassé n'en porterait aucun.
    const dom = await avecSouvenirs([souvenir()]);
    expect(dom.querySelector('.panel-error'), 'une bande d’erreur au repos').toBeNull();

    vi.mocked(fetchMemories).mockRejectedValue(new Error('la ruche a trébuché'));
    await act(async () => chercher(dom, 'propolis'));
    await soumettre(dom);

    const bande = dom.querySelector('.panel-error');
    expect(bande, 'la recherche a échoué sans le dire').not.toBeNull();
    expect(bande?.textContent, 'la bande ne dit pas ce qui a échoué').toContain(
      'la ruche a trébuché',
    );
  });

  it('UN REJET QUI N’EST PAS UNE ERREUR NE PRÊTE PAS SON `message`', async () => {
    // ─── POURQUOI `instanceof Error` ET PAS `instanceof Object` ────────────
    //
    // `.catch` reçoit un `unknown` : n'importe quoi peut arriver là. Muté en
    // `instanceof Object`, un objet quelconque verrait son champ `message` lu
    // et rendu à l'écran — un champ que personne n'a écrit pour être lu par un
    // humain. On vérifie donc que le marqueur n'apparaît PAS.
    const dom = await avecSouvenirs([souvenir()]);
    vi.mocked(fetchMemories).mockRejectedValue({ message: 'trace-interne-4f2b' });
    await act(async () => chercher(dom, 'propolis'));
    await soumettre(dom);

    const bande = dom.querySelector('.panel-error');
    expect(bande, 'le rejet n’a produit aucune bande').not.toBeNull();
    expect(bande?.textContent, 'le champ `message` d’un objet quelconque est rendu').not.toContain(
      'trace-interne-4f2b',
    );
  });

  it('LA BIBLIOTHÈQUE OPENALEX S’OUVRE AU CLIC — et pas avant', async () => {
    // ─── LES DEUX SENS DE `{showOpenAlex && …}` ────────────────────────────
    //
    // Muté en `||`, la modale est ouverte À L'ARRIVÉE (`false || <Panel/>`) et
    // ne s'ouvre PLUS au clic (`true || …` rend `true`, que React n'affiche
    // pas). L'onglet secondaire deviendrait la porte d'entrée, et le bouton qui
    // devait l'ouvrir n'aurait plus d'effet.
    const dom = await avecSouvenirs([souvenir()]);
    expect(
      dom.querySelector('.openalex-panel'),
      'la bibliothèque est ouverte sans qu’on l’ait demandée',
    ).toBeNull();

    const onglet = [...dom.querySelectorAll<HTMLButtonElement>('.ch-mem-tabs button')].find((b) =>
      (b.textContent ?? '').includes('OpenAlex'),
    );
    expect(onglet, 'l’onglet OpenAlex est introuvable').toBeTruthy();
    await act(async () => {
      onglet?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(
      document.querySelector('.openalex-panel'),
      'le clic n’ouvre pas la bibliothèque',
    ).not.toBeNull();
  });
});
