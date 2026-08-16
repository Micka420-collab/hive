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

/** Écrit dans le champ CONTRÔLÉ par React : le mutateur natif, jamais `.value`. */
function chercher(dom: HTMLElement, texte: string): void {
  const champ = dom.querySelector<HTMLInputElement>('input[aria-label="Rechercher un souvenir"]');
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
