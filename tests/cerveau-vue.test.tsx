// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CERVEAU, RENDU — le bon mode allumé, et la fiche de la note choisie.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Les DEUX dernières survivantes du balayage loupe du 3 août vivent ici :
//
//   · `className={mode === 'graphe' ? 'on' : ''}` — mutée en `!==`, le bouton
//     « Graphe » s'allumerait quand on regarde la LISTE, et s'éteindrait sur
//     son propre mode : l'interrupteur qui montre l'inverse de l'état ;
//   · `noteChoisie = choisi === null ? null : (parId.get(choisi) ?? null)` —
//     mutée, la fiche de détail ne s'ouvrirait JAMAIS : choisir une note ne
//     montrerait rien, et l'écran fait pour explorer le savoir deviendrait
//     une image qu'on ne peut pas interroger.
//
// Le canevas du mode graphe ne se dessine pas sous happy-dom (`getContext`
// rend null, la simulation se tait) — c'est prévu par la vue : la LISTE est
// « la même information, dans un tableau navigable », et c'est par elle que
// la fiche s'ouvre au clavier comme au clic.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCerveau: vi.fn(() => Promise.resolve(null)),
}));

import { fetchCerveau } from '../dashboard/src/api';
import Cerveau from '../dashboard/src/views/Cerveau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchCerveau)
    .mockReset()
    .mockResolvedValue({
      noeuds: [
        {
          id: 'note-lecon',
          genre: 'lecon',
          titre: 'La leçon des tubes',
          recurrences: 3,
          degre: 1,
          ageJours: 10,
          serviIlYaJours: 2,
        },
        {
          id: 'note-episode',
          genre: 'episode',
          titre: 'L’épisode du port occupé',
          recurrences: 1,
          degre: 1,
          ageJours: 5,
          serviIlYaJours: null,
        },
      ],
      aretes: [{ de: 'note-lecon', vers: 'note-episode', reciproque: false }],
      liensMorts: [],
      orphelines: [],
      parGenre: { invariant: 0, lecon: 1, decision: 0, carte: 0, episode: 1 },
      servies: 1,
      total: 2,
      dossier: 'cerveau',
    } as never);
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {} as unknown as ViewProps;
  await act(async () => racine?.render(<Cerveau {...props} />));
  await act(async () => {});
  return conteneur;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function boutonMode(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('.cerveau-modes button')].find(
    (x) => (x.textContent ?? '').trim() === libelle,
  );
  expect(b, `bouton de mode « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

describe('le Cerveau — les deux dernières survivantes du balayage', () => {
  it('L’INTERRUPTEUR DE MODE ALLUME LE MODE OÙ L’ON EST — jamais l’autre', async () => {
    const dom = await monter();
    // Au réveil, le graphe est le mode : SON bouton porte l'habit « on ».
    expect(boutonMode(dom, 'Graphe').classList.contains('on'), 'graphe allumé au réveil').toBe(
      true,
    );
    expect(boutonMode(dom, 'Liste').classList.contains('on')).toBe(false);

    cliquer(boutonMode(dom, 'Liste'));
    expect(boutonMode(dom, 'Liste').classList.contains('on'), 'la liste s’allume au clic').toBe(
      true,
    );
    expect(
      boutonMode(dom, 'Graphe').classList.contains('on'),
      'le graphe s’éteint en le quittant',
    ).toBe(false);
  });

  it('CHOISIR UNE NOTE OUVRE SA FICHE — la survivante `choisi === null`', async () => {
    // Mutée en `!==`, `noteChoisie` serait null dans les deux cas : la fiche
    // ne s'ouvrirait jamais, et l'écran fait pour interroger le savoir
    // n'aurait plus de réponse. On passe par la LISTE, le chemin accessible.
    const dom = await monter();
    cliquer(boutonMode(dom, 'Liste'));
    expect(dom.querySelector('.cerveau-fiche'), 'aucune fiche avant le choix').toBeNull();

    const ligne = [...dom.querySelectorAll('.cerveau-liste tbody tr')].find((r) =>
      (r.textContent ?? '').includes('La leçon des tubes'),
    );
    expect(ligne, 'la note doit être dans la liste').toBeTruthy();
    cliquer(ligne as Element);

    const fiche = dom.querySelector('.cerveau-fiche');
    expect(fiche, 'la fiche s’ouvre sur la note choisie').toBeTruthy();
    expect(fiche?.querySelector('h3')?.textContent).toBe('La leçon des tubes');
    expect(fiche?.textContent).toContain('note-lecon');
    // Et la voisine est proposée : le savoir se parcourt de note en note.
    expect(fiche?.textContent).toContain('L’épisode du port occupé');
  });

  it('« RECENTRER » N’EXISTE QU’EN MODE GRAPHE — rien à recentrer dans un tableau', async () => {
    // Survivante du balayage de nuit : `{mode === 'graphe' && (…)}` mutée en
    // `!==` — le bouton « Recentrer » apparaîtrait au-dessus de la LISTE (où
    // il ne peut rien recentrer, et où le clic serait sans effet visible :
    // le pire des retours, celui qui laisse croire à une panne) et
    // disparaîtrait du graphe, le seul endroit où il sert.
    const dom = await monter();
    const recentrer = () => dom.querySelector('.cerveau-recentrer');
    expect(recentrer(), 'au réveil, on est en graphe : le bouton est là').toBeTruthy();

    cliquer(boutonMode(dom, 'Liste'));
    expect(recentrer(), 'dans la liste, il n’y a rien à recentrer').toBeNull();

    cliquer(boutonMode(dom, 'Graphe'));
    expect(recentrer(), 'de retour au graphe, il revient').toBeTruthy();
  });

  it('LES ORPHELINES NE S’ANNONCENT QUE S’IL Y EN A', async () => {
    // `(g?.orphelines.length ?? 0) > 0 &&` mutée en `||` : le court-circuit
    // rend `true` quand il Y EN A (React n'affiche rien — l'alerte disparaît
    // au moment où elle informe), et un cerveau parfaitement relié
    // annoncerait « 0 orphelines » comme s'il y avait un problème. Une alerte
    // qui se déclenche à vide finit par ne plus être lue du tout.
    const dom = await monter();
    expect(dom.textContent, 'aucune orpheline dans le banc : rien ne s’annonce').not.toContain(
      'orphelines',
    );

    act(() => racine?.unmount());
    conteneur?.remove();
    vi.mocked(fetchCerveau).mockResolvedValue({
      noeuds: [
        {
          id: 'note-seule',
          genre: 'episode',
          titre: 'Une note sans lien',
          recurrences: 1,
          degre: 0,
          ageJours: 2,
          serviIlYaJours: null,
        },
      ],
      aretes: [],
      liensMorts: [],
      orphelines: ['note-seule'],
      parGenre: { invariant: 0, lecon: 0, decision: 0, carte: 0, episode: 1 },
      servies: 0,
      total: 1,
      dossier: 'cerveau',
    } as never);
    const avec = await monter();
    expect(avec.textContent, 'une orpheline : l’alerte se dit').toContain('orphelines');
    expect(avec.textContent, 'et elle dit pourquoi ça compte').toContain(
      'du savoir qui ne se raccroche à rien',
    );
  });

  it('UNE NOTE JAMAIS SERVIE LE DIT — et celle qui l’a été donne son âge', async () => {
    // Survivante du balayage du soir : `n.serviIlYaJours === null` mutée en
    // `!==` inverse les deux mondes — la note SERVIE il y a deux jours
    // s'annoncerait « jamais » (on la croirait morte, on la resservirait pour
    // rien), et celle qui dort vraiment afficherait « il y a null j ». La
    // colonne existe précisément pour décider quoi ressortir du rayon.
    const dom = await monter();
    cliquer(boutonMode(dom, 'Liste'));
    const rangee = (titre: string) =>
      [...dom.querySelectorAll('.cerveau-liste tbody tr')].find((r) =>
        (r.textContent ?? '').includes(titre),
      );
    const servie = rangee('La leçon des tubes');
    const dormante = rangee('L’épisode du port occupé');
    expect(servie, 'la note servie est dans la liste').toBeTruthy();
    expect(dormante, 'la note dormante est dans la liste').toBeTruthy();

    expect(servie?.textContent, 'servie il y a deux jours, elle le dit').toContain('il y a 2 j');
    expect(servie?.textContent, 'une note servie n’est pas « jamais »').not.toContain('jamais');
    expect(dormante?.textContent, 'jamais servie, elle le dit').toContain('jamais');
    // L'habit `dort` marque la même chose que le texte : les deux gardes de
    // la ligne sont éprouvées, pas seulement celle qu'on regarde.
    expect(dormante?.querySelector('.dort'), 'la dormante porte son habit').toBeTruthy();
    expect(servie?.querySelector('.dort'), 'la servie ne le porte pas').toBeNull();
  });
});
