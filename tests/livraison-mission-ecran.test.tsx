// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ÉCRAN DE LA LIVRAISON D'UNE MISSION — les trois portes, telles qu'on les voit.
//
// La Reine tient les gardes ; cet écran tient ce qu'une personne COMPREND en
// les rencontrant. Trois choses s'y perdraient sans bruit :
//
//   · rien ne doit partir au montage — ni livraison, ni scrutation — et
//     pousser doit être DÉCOCHÉ : écrire sur le dépôt avec les identifiants
//     d'une ouvrière n'est jamais un défaut ;
//   · le forçage ne se propose qu'après un arrêt de l'EVALUATOR, et exige une
//     raison. Offert sur « aucune ouvrière n'a consenti », il ne forcerait rien
//     et apprendrait à cliquer « passer outre » par réflexe ;
//   · une branche gardée sur l'ouvrière alors qu'on demandait de pousser n'est
//     pas un succès vert.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  livrerLocalement: vi.fn(),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
}));

import { fetchMergeResult, livrerLocalement, RefusLivraison } from '../dashboard/src/api';
import { LivraisonMission } from '../dashboard/src/views/LivraisonMission';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJET: Project = {
  id: 'p1',
  name: 'Rucher',
  repoUrl: 'https://git.exemple.test/rucher.git',
  description: null,
  visibility: 'private',
  ownerId: null,
  createdAt: 1,
};

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  vi.mocked(livrerLocalement).mockReset();
  vi.mocked(fetchMergeResult).mockReset().mockResolvedValue({ result: null });
});
afterEach(() => {
  vi.useRealTimers();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine?.render(
      <LivraisonMission project={PROJET} taskTitles={new Map([['t1', 'Tâche une']])} />,
    );
  });
  return conteneur;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(libelle),
  );
  expect(b, `bouton « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

function taper(champ: HTMLInputElement, texte: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(champ) as object,
      'value',
    )?.set;
    setter?.call(champ, texte);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function livrer(dom: HTMLElement): Promise<void> {
  cliquer(bouton(dom, 'Livrer la mission'));
  cliquer(bouton(dom, 'Confirmer'));
  await act(async () => {});
}

const champRaison = (dom: HTMLElement) =>
  dom.querySelector<HTMLInputElement>('input[aria-label="Raison du forçage"]');

describe('la livraison d’une mission, à l’écran', () => {
  it('RIEN NE PART AU MONTAGE, et pousser est décoché', async () => {
    const dom = await monter();
    expect(vi.mocked(livrerLocalement)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchMergeResult)).not.toHaveBeenCalled();
    const pousser = dom.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(pousser?.checked).toBe(false);
    expect(champRaison(dom), 'aucun forçage offert avant un arrêt').toBeNull();
  });

  it('LE FORÇAGE NE SE PROPOSE QU’APRÈS UN ARRÊT DE L’EVALUATOR — et exige une raison', async () => {
    const dom = await monter();
    // Un refus qui n'est PAS de l'Evaluator : le dire, sans proposer de forcer.
    vi.mocked(livrerLocalement).mockRejectedValueOnce(
      new RefusLivraison(
        'aucune ouvrière en ligne n’a consenti à pousser',
        409,
        'aucun_noeud_consentant',
      ),
    );
    await livrer(dom);
    expect(dom.textContent).toContain('aucune ouvrière en ligne n’a consenti à pousser');
    expect(champRaison(dom), 'forcer ne répond pas à un défaut de consentement').toBeNull();

    vi.mocked(livrerLocalement).mockRejectedValueOnce(
      new RefusLivraison('l’Evaluator arrête 1 tâche(s)', 409, 'evaluator_blocks', [
        { taskId: 't1', decision: 'correction_required' },
      ]),
    );
    await livrer(dom);
    const raison = champRaison(dom);
    expect(raison, 'l’arrêt de l’Evaluator ouvre le forçage').not.toBeNull();
    expect(dom.textContent).toContain('Tâche une');
    expect(dom.textContent).toContain('correction_required');
    const forcer = bouton(dom, 'Passer outre et livrer');
    expect(forcer.disabled, 'pas de forçage sans raison').toBe(true);

    vi.mocked(livrerLocalement).mockResolvedValueOnce({
      mergeId: 'm-force',
      nodeId: 'n1',
      noeud: 'atelier',
      order: ['t1'],
      pousser: false,
      forcees: ['t1'],
    });
    taper(raison as HTMLInputElement, 'relu à la main');
    expect(forcer.disabled).toBe(false);
    cliquer(forcer);
    await act(async () => {});
    expect(vi.mocked(livrerLocalement)).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ forcer: { raison: 'relu à la main' }, pousser: false }),
    );
  });

  it('UN REJEU SIMULÉ SE DIT SIMULÉ — pas refusé, pas en cours — et s’offre à la validation humaine', async () => {
    // La Reine répond 409 `rejeu_simule` : rien n'est parti. Traité comme un
    // départ, l'écran scrutait un merge sans identifiant pendant dix minutes ;
    // traité comme un refus sec, la validation humaine n'aurait été qu'une API.
    const dom = await monter();
    // Le trajet réel d'un rejeu : l'Evaluator arrête, on force, et la Reine
    // simule la livraison forcée.
    vi.mocked(livrerLocalement).mockRejectedValueOnce(
      new RefusLivraison('l’Evaluator arrête 1 tâche(s)', 409, 'evaluator_blocks', [
        { taskId: 't1', decision: 'correction_required' },
      ]),
    );
    await livrer(dom);
    vi.mocked(livrerLocalement).mockRejectedValueOnce(
      new RefusLivraison(
        'Projet de rejeu : cette action irréversible est simulée et rangée, pas exécutée.',
        409,
        'rejeu_simule',
      ),
    );
    taper(champRaison(dom) as HTMLInputElement, 'relu à la main');
    cliquer(bouton(dom, 'Passer outre et livrer'));
    await act(async () => {});
    expect(dom.textContent).toContain('livraison SIMULÉE et rangée');
    expect(dom.textContent).not.toContain('Livraison refusée');
    expect(dom.textContent).not.toContain('Livraison en cours');
    expect(vi.mocked(fetchMergeResult), 'aucun suivi d’un merge qui n’existe pas').not.toBeCalled();

    vi.mocked(livrerLocalement).mockResolvedValueOnce({
      mergeId: 'm-valide',
      nodeId: 'n1',
      noeud: 'atelier',
      order: ['t1'],
      pousser: false,
      forcees: [],
    });
    cliquer(bouton(dom, 'Valider pour de vrai'));
    await act(async () => {});
    // La validation renvoie la demande TELLE QUELLE, forçage compris : sans
    // lui, elle retomberait sur l'arrêt de l'Evaluator, et le forçage suivant
    // serait re-simulé — une boucle.
    expect(vi.mocked(livrerLocalement)).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ validerRejeu: true, forcer: { raison: 'relu à la main' } }),
    );
  });

  it('UNE BRANCHE NON POUSSÉE N’EST PAS UN SUCCÈS VERT', async () => {
    vi.useFakeTimers();
    const dom = await monter();
    const pousser = dom.querySelector<HTMLInputElement>('input[type="checkbox"]');
    cliquer(pousser as HTMLInputElement);
    vi.mocked(livrerLocalement).mockResolvedValueOnce({
      mergeId: 'm-1',
      nodeId: 'n1',
      noeud: 'atelier',
      order: ['t1'],
      pousser: true,
      forcees: [],
    });
    await livrer(dom);
    expect(vi.mocked(livrerLocalement)).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ pousser: true }),
    );
    expect(dom.textContent).toContain('Livraison en cours sur l’ouvrière…');

    vi.mocked(fetchMergeResult).mockResolvedValue({
      result: {
        mergeId: 'm-1',
        applied: ['t1'],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: '',
        livraison: {
          etat: 'commitee',
          branche: 'hive/mission-p1-1',
          commit: 'a'.repeat(40),
          poussee: 'refusee',
          motif: 'consentement absent',
        },
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    const statut = dom.querySelector('.pj-mission-avertissement');
    expect(statut, 'la gravité se voit').not.toBeNull();
    expect(statut?.textContent).toContain('hive/mission-p1-1');
    expect(statut?.textContent).toContain('non poussée');
    expect(dom.querySelector('.pj-mission-ok')).toBeNull();
    expect(dom.textContent, 'le rapport de merge suit').toContain('diff(s) appliqué(s)');
  });
});
