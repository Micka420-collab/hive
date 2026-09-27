// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'AIGUILLAGE DU PORTEUR DE LIEN — `main.tsx`, par son vrai chargement.
//
// ─── CE QUE CE BANC TIENT ────────────────────────────────────────────────────
//
// Un onglet est de la ruche OU du partage, jamais des deux. `apiLecture` fait
// partir une lecture avec le lien SEUL dès qu'un lien est en mémoire — c'est
// ce qui empêche un lien révoqué de s'ouvrir encore chez son hôte (voir
// `dashboard-contrat-compte.test.tsx`). Mais cette règle suppose que le lien
// ne survive pas à l'onglet quand il repart en ruche ordinaire : sinon `App`
// lirait le rapport de la personne avec le lien d'un autre projet, et son
// Rayon passerait en lecture seule sur ses propres projets.
//
// `main.tsx` est exclu de la couverture — il n'est qu'aiguillage. C'est
// précisément pour ça qu'il faut le charger pour de vrai : les gardes de
// `partage-endpoint.test.ts` lisent son texte, aucune ne l'exécute.

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Les deux écrans sont remplacés par un témoin : ce banc juge le CHOIX entre
// les deux, pas ce qu'ils affichent — et `App` ouvrirait le flux de la ruche.
vi.mock('../dashboard/src/App', () => ({ App: () => <p data-vue="ruche" /> }));
vi.mock('../dashboard/src/views/Partage', () => ({ default: () => <p data-vue="partage" /> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLE_PARTAGE = 'hive.partage';

/** Charge `main.tsx` comme au premier affichage de l'onglet, et rend l'écran choisi. */
async function ouvrirOnglet(hash: string): Promise<string | null> {
  location.hash = hash;
  await act(async () => {
    await import('../dashboard/src/main');
  });
  // La vue du porteur est chargée en différé (`lazy`) : un tour de plus.
  await act(async () => {});
  return document.querySelector('[data-vue]')?.getAttribute('data-vue') ?? null;
}

beforeEach(() => {
  // `main.tsx` s'exécute à l'import : chaque test veut SON premier chargement.
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
});

describe('main.tsx — un onglet est de la ruche ou du partage, jamais des deux', () => {
  it('un lien SANS projet repart en ruche ordinaire, et ne reste pas en mémoire', async () => {
    expect(await ouvrirOnglet('#/?partage=hive3_sans_projet')).toBe('ruche');
    expect(
      sessionStorage.getItem(CLE_PARTAGE),
      'le lien a suivi l’onglet dans la ruche',
    ).toBeNull();
  });

  it('un lien resté en mémoire ne suit pas l’onglet qu’on rouvre sur la ruche', async () => {
    // L'onglet a lu un partage, puis on l'a rechargé sur `#/ruche` sans passer
    // par « Quitter la lecture partagée » : `sessionStorage` a survécu.
    sessionStorage.setItem(CLE_PARTAGE, 'hive3_reste_la');
    expect(await ouvrirOnglet('#/ruche')).toBe('ruche');
    expect(
      sessionStorage.getItem(CLE_PARTAGE),
      'le lien a suivi l’onglet dans la ruche',
    ).toBeNull();
  });

  it('CONTRASTE : un lien vers un projet est gardé — c’est lui qui ouvre la vue du porteur', async () => {
    expect(await ouvrirOnglet('#/rayon/p1?partage=hive3_vivant')).toBe('partage');
    expect(sessionStorage.getItem(CLE_PARTAGE)).toBe('hive3_vivant');
    // Et il a quitté la barre d'adresse, comme le veut `main.tsx`.
    expect(location.hash).toBe('#/rayon/p1');
  });
});
