// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE RAYON DE MIEL — la grille d'alvéoles, « lisible à 3 mètres ».
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Survivante du balayage de nuit : `deferred?.has(t.id) && t.status ===
// 'ready'`, mutée en `||`, ne faisait rougir personne. Le composant React
// `Honeycomb` n'avait AUCUN banc — `tests/honeycomb.test.ts`, malgré son nom,
// éprouve l'algorithme du plan de fusion, pas l'affichage.
//
// C'est un angle mort typique : deux choses portent le même nom, l'une est
// couverte, et on croit l'autre couverte aussi.
//
// ─── CE QUE CETTE GRILLE EXISTE POUR DIRE ────────────────────────────────────
//
// Le rayon est le seul écran qu'on lit SANS lire : une couleur par état, à
// distance. Sa valeur tient entièrement dans le fait que deux états différents
// ne se ressemblent pas.
//
// Or « en attente » et « repoussée » sont deux choses opposées :
//
//   · `ready` — la ruche va la prendre dès qu'une ouvrière se libère ;
//   · `deferred` — un humain a décidé de NE PAS la faire pour l'instant.
//
// Mutée en `||`, toute tâche en attente porte l'habit des repoussées : le
// tableau de bord annonce que rien ne va démarrer, sur une ruche qui est en
// train de démarrer. Et l'inverse est vrai aussi — une tâche repoussée qui a
// changé d'état perd son habit alors que la décision humaine tient toujours.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { Honeycomb } from '../dashboard/src/views/shared';
import type { Task } from '../src/shared/types';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});

function tache(id: string, status: Task['status']): Task {
  return {
    id,
    projectId: 'p1',
    title: `Tâche ${id}`,
    prompt: 'p',
    status,
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

async function monter(taches: Task[], repoussees?: Set<string>): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Honeycomb tasks={taches} deferred={repoussees} />));
  return conteneur;
}

/** Les habits d'une alvéole, par identifiant de tâche. */
function habits(dom: HTMLElement, id: string): string[] {
  const cellules = [...dom.querySelectorAll('.mc-cell')];
  const cible = cellules.find((c) => (c.getAttribute('aria-label') ?? '').includes(`Tâche ${id}`));
  expect(cible, `alvéole « ${id} » introuvable`).toBeTruthy();
  return [...(cible as Element).classList];
}

describe('le rayon de miel — deux états opposés ne portent pas le même habit', () => {
  it('SEULE UNE TÂCHE REPOUSSÉE *ET* EN ATTENTE PORTE L’HABIT « REPOUSSÉE »', async () => {
    // La fixture sépare les quatre combinaisons, parce que la mutation en
    // `||` n'en change que deux : c'est le contraste qui juge, pas le total.
    const dom = await monter(
      [
        tache('repoussee-en-attente', 'ready'),
        tache('en-attente-simple', 'ready'),
        tache('repoussee-mais-partie', 'running'),
        tache('ordinaire', 'running'),
      ],
      new Set(['repoussee-en-attente', 'repoussee-mais-partie']),
    );

    expect(
      habits(dom, 'repoussee-en-attente'),
      'repoussée ET en attente : c’est le seul vrai cas',
    ).toContain('deferred');

    // LA garde. Mutée en `||`, cette alvéole-ci porterait « deferred » aussi —
    // et le tableau annoncerait que rien ne va démarrer sur une ruche qui
    // démarre.
    expect(
      habits(dom, 'en-attente-simple'),
      'en attente mais NON repoussée : la ruche va la prendre',
    ).not.toContain('deferred');

    expect(
      habits(dom, 'repoussee-mais-partie'),
      'repoussée mais déjà partie : l’état réel l’emporte sur la décision passée',
    ).not.toContain('deferred');

    expect(habits(dom, 'ordinaire'), 'ni l’un ni l’autre').not.toContain('deferred');
  });

  it('L’ÉTAT RÉEL EST TOUJOURS PORTÉ — l’habit « repoussée » s’ajoute, il ne remplace pas', async () => {
    // Sans cela, une alvéole repoussée perdrait sa couleur d'état et le rayon
    // cesserait de dire OÙ EN EST le travail — sa seule raison d'exister.
    const dom = await monter([tache('t', 'ready')], new Set(['t']));
    const h = habits(dom, 't');
    expect(h, 'la classe de base').toContain('mc-cell');
    expect(h, 'l’état réel').toContain('ready');
    expect(h, 'et la décision humaine par-dessus').toContain('deferred');
  });

  it('SANS ENSEMBLE DE REPOUSSÉES, RIEN N’EST REPOUSSÉ — pas de crash, pas d’habit', async () => {
    // `deferred` est optionnel : les vues « mini » ne le passent pas. Un
    // `undefined` mal géré marquerait tout, ou lèverait.
    const dom = await monter([tache('t', 'ready')]);
    expect(habits(dom, 't')).not.toContain('deferred');
  });

  it('CHAQUE ALVÉOLE DIT SON ÉTAT EN TOUTES LETTRES — le rayon reste lisible sans les yeux', async () => {
    // La couleur est pour les 3 mètres ; l'`aria-label` est pour ceux qui ne
    // la voient pas. Le dépôt tient `NO_COLOR` et `TERM=dumb` ailleurs — un
    // écran qui n'existerait qu'en pixels serait le seul endroit où cette
    // exigence s'arrête.
    const dom = await monter([tache('a', 'running'), tache('b', 'failed')]);
    const etiquette = (id: string): string => {
      const c = [...dom.querySelectorAll('.mc-cell')].find((x) =>
        (x.getAttribute('aria-label') ?? '').includes(`Tâche ${id}`),
      );
      return c?.getAttribute('aria-label') ?? '';
    };
    expect(etiquette('a')).toContain('en cours');
    expect(etiquette('b')).toContain('échouée');
    expect(etiquette('a'), 'et les deux ne se ressemblent pas').not.toBe(etiquette('b'));
  });
});
