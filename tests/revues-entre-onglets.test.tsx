// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// DEUX ONGLETS DE MISSION CONTROL — le verdict posé dans l'un se voit dans l'autre.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// `useReviewTick` est le crochet qui fait REPEINDRE tous les écrans quand un
// verdict de revue change :
//
//     window.addEventListener('hive:review', bump);
//     window.addEventListener('storage', bump);
//
// Deux écouteurs, deux mondes. Aucun banc du dépôt n'émettait ni l'un ni
// l'autre — vérifié : `StorageEvent` et `'hive:review'` n'apparaissaient nulle
// part dans `tests/`.
//
//   · `hive:review` est l'événement MAISON : le même onglet vient de poser un
//     verdict, et tout ce qui l'affiche doit le refléter ;
//   · `storage` est celui du NAVIGATEUR, et il ne se déclenche QUE dans les
//     AUTRES onglets. C'est la synchronisation entre onglets, et c'est un geste
//     banal ici : on surveille l'essaim d'un côté, on juge les livraisons de
//     l'autre.
//
// ─── POURQUOI IL FAUT LES DEUX, ET POURQUOI RIEN NE LES REMPLACE ─────────────
//
// React ne surveille pas `localStorage`. Écrire dedans ne provoque AUCUN rendu :
// sans ces deux écouteurs, l'alvéole garde sa couleur d'avant jusqu'à ce que
// quelque chose d'autre fasse repeindre l'écran — un sondage, un clic, un
// hasard. L'utilisateur voit un verdict qu'il vient de poser ne pas prendre.
//
// Le dernier cas de ce fichier mesure exactement cela : sans événement, rien
// ne bouge. C'est lui qui prouve que les deux autres mesurent l'ÉCOUTEUR, et
// pas un re-rendu de passage.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLang } from '../dashboard/src/i18n';
import type { Task } from '../src/shared/types';
import { Honeycomb } from '../dashboard/src/views/shared';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** La clé que `shared.tsx` lit — la même chaîne, écrite une seule fois ici. */
const CLE = 'hive.review';

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
  localStorage.clear();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  localStorage.clear();
});

const tache = (id: string): Task =>
  ({
    id,
    title: `Tâche ${id}`,
    status: 'done',
    projectId: 'p-1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }) as unknown as Task;

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Honeycomb tasks={[tache('t-1')]} showReview />));
  await act(async () => {});
  return conteneur;
}

/** La classe de l'unique alvéole — c'est là que le verdict se voit. */
const alveole = (dom: HTMLElement): string =>
  dom.querySelector('[role="listitem"]')?.className ?? '';

/** Ce qu'un AUTRE onglet aurait écrit. */
function poserLeVerdict(taskId: string, etat: 'approved' | 'rejected'): void {
  localStorage.setItem(CLE, JSON.stringify({ [taskId]: etat }));
}

describe('le verdict d’un onglet se voit dans l’autre', () => {
  it('UNE ALVÉOLE REVUE PORTE SA COULEUR — sinon rien ici ne mesure rien', async () => {
    // Le cas positif d'abord (§ 9 unvicicenties, § 9 septvicicenties) : si la
    // lecture du verdict ne marchait pas du tout, les cas de repeinture
    // seraient verts en comparant deux absences.
    poserLeVerdict('t-1', 'approved');
    const dom = await monter();

    expect(alveole(dom), 'un verdict déjà posé n’est pas lu au montage').toContain('reviewed');
  });

  it('`hive:review` REPEINT — le verdict posé dans CE onglet prend', async () => {
    // L'événement maison. Sans lui, on pose un verdict et l'alvéole garde sa
    // couleur d'avant : le geste a l'air de n'avoir servi à rien.
    const dom = await monter();
    expect(alveole(dom), 'l’alvéole part déjà revue').not.toContain('reviewed');

    await act(async () => {
      poserLeVerdict('t-1', 'approved');
      window.dispatchEvent(new CustomEvent('hive:review'));
    });
    await act(async () => {});

    expect(alveole(dom), 'le verdict de cet onglet ne repeint pas l’alvéole').toContain('reviewed');
  });

  it('`storage` REPEINT — le verdict posé dans un AUTRE onglet arrive', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // `storage` ne se déclenche QUE dans les autres onglets : c'est le seul
    // signal qu'un navigateur donne pour dire « quelqu'un d'autre a écrit ».
    //
    // Le geste est banal sur ce produit — on surveille l'essaim d'un côté, on
    // juge les livraisons de l'autre. Sans cet écouteur, le second onglet
    // affiche un état périmé sans rien qui le dise, et deux opérateurs voient
    // deux vérités.
    const dom = await monter();

    await act(async () => {
      poserLeVerdict('t-1', 'rejected');
      // La forme exacte de l'événement du navigateur : la clé qui a changé.
      window.dispatchEvent(new StorageEvent('storage', { key: CLE }));
    });
    await act(async () => {});

    expect(alveole(dom), 'le verdict d’un autre onglet n’arrive pas').toContain('rejected');
  });

  it('SANS ÉVÉNEMENT, RIEN NE BOUGE — et c’est pour ça que les deux existent', async () => {
    // ─── LE CAS QUI PROUVE QUE LES DEUX AUTRES MESURENT ────────────────────
    //
    // React ne surveille pas `localStorage`. Écrire dedans ne provoque aucun
    // rendu — c'est précisément le trou que les deux écouteurs comblent.
    //
    // Sans ce cas, les deux précédents pourraient être verts par un re-rendu de
    // passage, et l'on croirait mesurer un écouteur qu'on aurait débranché.
    const dom = await monter();

    await act(async () => {
      poserLeVerdict('t-1', 'approved');
    });
    await act(async () => {});

    expect(
      alveole(dom),
      'l’écran s’est repeint SANS événement : les deux cas d’avant ne mesurent pas l’écouteur',
    ).not.toContain('reviewed');
  });
});
