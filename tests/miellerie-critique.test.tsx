// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA CRITIQUE EN MIELLERIE — la raison d'un rejet part avec le verdict, et la
// critique qu'une tentative a reçue se lit sous la production qu'on relit.
//
// Deux défauts que ce banc ferme :
//   · une raison saisie qui ne partait pas avec le POST — l'humain croyait
//     avoir expliqué son rejet, la correction repartait sans le pourquoi ;
//   · un relecteur de la tentative 2 qui jugeait une correction sans savoir
//     ce qu'on lui avait demandé de corriger.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { hydrateReviews } from '../dashboard/src/views/shared';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot, Task } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchEvaluation: vi.fn(() => Promise.resolve(null)),
  fetchCritique: vi.fn(),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  postReview: vi.fn(() => Promise.resolve()),
}));

import { fetchCritique, postReview } from '../dashboard/src/api';
import Miellerie from '../dashboard/src/views/Miellerie';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  hydrateReviews({});
  vi.mocked(postReview).mockClear();
  vi.mocked(fetchCritique)
    .mockReset()
    .mockResolvedValue({ taskId: 't1', raisonRevue: null, reprise: null });
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  localStorage.clear();
  hydrateReviews({});
});

const TACHE: Task = {
  id: 't1',
  projectId: 'p1',
  title: 'Corriger le panier',
  prompt: 'p',
  status: 'done',
  dependsOn: [],
  assignedNodeId: null,
  result: null,
  branch: null,
  attempts: 1,
  createdAt: 0,
  updatedAt: 1,
};

async function monter(): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [{ id: 'p1', name: 'Rucher', repoUrl: null }],
      nodes: [],
      tasks: [TACHE],
      tasksTotal: 1,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    selectedId: 't1',
    onOpenTask: () => {},
    onNavigate: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Miellerie {...props} />));
  await act(async () => {});
}

/** Saisit une valeur dans un champ contrôlé React (le setter natif, puis `input`). */
async function saisir(champ: HTMLInputElement, valeur: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(champ, valeur);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('la critique en Miellerie', () => {
  it('la raison saisie PART AVEC LE REJET, puis le champ se vide', async () => {
    await monter();
    const champ = document.querySelector<HTMLInputElement>('.mi-raison');
    expect(champ, 'aucun champ de raison à côté du verdict').not.toBeNull();
    await saisir(champ!, 'le panier vide plante encore');

    const rejeter = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Rejeter'),
    );
    await act(async () => rejeter?.click());
    await act(async () => {});

    expect(vi.mocked(postReview)).toHaveBeenCalledWith(
      't1',
      'rejected',
      expect.any(String),
      'le panier vide plante encore',
    );
    expect(document.querySelector<HTMLInputElement>('.mi-raison')?.value).toBe('');
  });

  it('montre la critique que la tentative en cours a reçue', async () => {
    vi.mocked(fetchCritique).mockResolvedValue({
      taskId: 't1',
      raisonRevue: null,
      reprise: {
        tentative: 2,
        ts: 1,
        critique: {
          source: 'contre_revue',
          objections: ['ajoute un test du chemin sécurisé'],
          raisons: ['la contre-revue indépendante demande une amélioration'],
        },
      },
    });
    await monter();
    const volet = document.querySelector('.mi-critique')?.textContent ?? '';
    expect(volet).toContain('Critique transmise depuis la tentative 2, après la contre-revue');
    expect(volet).toContain('ajoute un test du chemin sécurisé');
  });
});
