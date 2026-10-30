// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA REVUE LIGNE PAR LIGNE, À L'ÉCRAN (G06) — le diff rangé par pertinence,
// un clic qui ancre un commentaire sur la bonne ligne de la version modifiée,
// et « Demander des changements » qui part avec la production affichée.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateSnapshot, Task, TaskResult } from '../src/shared/types';
import type { CommentaireRevue } from '../src/shared/commentaire-revue';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchEvaluation: vi.fn(() => Promise.resolve(null)),
  fetchCommentairesRevue: vi.fn(),
  posterCommentaireRevue: vi.fn(),
  demanderChangements: vi.fn(),
  fetchCritique: vi.fn(() => Promise.resolve({ taskId: '', raisonRevue: null, reprise: null })),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  postReview: vi.fn(() => Promise.resolve()),
}));

import {
  demanderChangements,
  fetchCommentairesRevue,
  fetchResults,
  posterCommentaireRevue,
} from '../dashboard/src/api';
import Miellerie from '../dashboard/src/views/Miellerie';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIFF = [
  'diff --git a/package-lock.json b/package-lock.json',
  '--- a/package-lock.json',
  '+++ b/package-lock.json',
  '@@ -1 +1 @@',
  '-"v": 1',
  '+"v": 2',
  'diff --git a/src/panier.ts b/src/panier.ts',
  '--- a/src/panier.ts',
  '+++ b/src/panier.ts',
  '@@ -10,2 +10,2 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '',
].join('\n');

const DEJA_POSE: CommentaireRevue = {
  id: 'com-1',
  taskId: 't-1',
  resultId: 7,
  fichier: 'src/panier.ts',
  ligneDebut: 10,
  ligneFin: 10,
  texte: 'COMMENTAIRE-D-UN-AUTRE-OPERATEUR',
  extrait: ' const a = 1;',
  auteur: null,
  creeA: 1,
  soumission: null,
  soumisA: null,
};

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  vi.mocked(fetchResults).mockResolvedValue([
    {
      taskId: 't-1',
      resultId: 7,
      nodeId: 'n1',
      success: true,
      diff: DIFF,
      logs: '',
      durationMs: 5,
      subAgents: [],
    } as unknown as TaskResult,
  ]);
  vi.mocked(fetchCommentairesRevue).mockResolvedValue({
    taskId: 't-1',
    resultId: 7,
    max: 30,
    // Un commentaire d'une production PRÉCÉDENTE ne s'affiche pas sous celle-ci.
    commentaires: [DEJA_POSE, { ...DEJA_POSE, id: 'com-0', resultId: 3, texte: 'PERIME' }],
  });
  vi.mocked(posterCommentaireRevue).mockReset().mockResolvedValue(DEJA_POSE);
  vi.mocked(demanderChangements)
    .mockReset()
    .mockResolvedValue({
      state: 'rejected',
      changements: { soumission: 'chg-1', commentaires: 1 },
    });
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const tache: Task = {
  id: 't-1',
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

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [{ id: 'p1', name: 'Rucher', repoUrl: null }],
      nodes: [],
      tasks: [tache],
      tasksTotal: 1,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    selectedId: 't-1',
    onOpenTask: () => {},
    onNavigate: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Miellerie {...props} />));
  await act(async () => {});
  return conteneur;
}

async function cliquer(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(libelle),
  );
  if (!b) throw new Error(`bouton « ${libelle} » introuvable`);
  return b as HTMLButtonElement;
}

describe('Miellerie — revue ligne par ligne', () => {
  it('range la source avant le verrou, et grise le verrou', async () => {
    const dom = await monter();
    const puces = [...dom.querySelectorAll('.mi-file-chip')];
    expect(puces.map((p) => p.getAttribute('title'))).toEqual([
      'src/panier.ts',
      'package-lock.json',
    ]);
    expect(puces[1]?.classList.contains('muted-text')).toBe(true);
    expect(puces[0]?.classList.contains('muted-text')).toBe(false);
  });

  it('un clic ancre la ligne de la version modifiée ; une ligne supprimée ne s’ancre pas', async () => {
    const dom = await monter();
    // Seuls les commentaires de LA production affichée.
    expect(dom.textContent).toContain('COMMENTAIRE-D-UN-AUTRE-OPERATEUR');
    expect(dom.textContent).not.toContain('PERIME');
    const lignes = [...dom.querySelectorAll('.mi-diff-pre span')];
    const supprimee = lignes.find((l) => l.textContent?.startsWith('-const b = 2;'));
    expect(supprimee?.classList.contains('mi-ligne-commentable')).toBe(false);
    const ajoutee = lignes.find((l) => l.textContent?.startsWith('+const b = 3;'));
    expect(ajoutee?.classList.contains('mi-ligne-commentable')).toBe(true);
    await cliquer(ajoutee as Element);

    const zone = dom.querySelector('textarea');
    expect(zone, 'le formulaire s’ouvre sous le fichier').toBeTruthy();
    await act(async () => {
      const saisir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      saisir?.call(zone, 'garder 2');
      zone?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await cliquer(bouton(dom, 'Commenter'));
    // La ligne 11 : `@@ +10` , contexte (10), suppression (sans numéro), ajout (11).
    expect(vi.mocked(posterCommentaireRevue)).toHaveBeenCalledWith('t-1', {
      fichier: 'src/panier.ts',
      ligneDebut: 11,
      ligneFin: 11,
      resultId: 7,
      texte: 'garder 2',
    });
  });

  it('« Demander des changements » part avec la production affichée et la raison saisie', async () => {
    const dom = await monter();
    const raison = dom.querySelector('input.mi-raison');
    await act(async () => {
      const saisir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      saisir?.call(raison, 'reprendre le total');
      raison?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const envoyer = bouton(dom, 'Demander des changements');
    expect(envoyer.textContent, 'le nombre en attente est annoncé').toContain('(1)');
    await cliquer(envoyer);
    expect(vi.mocked(demanderChangements)).toHaveBeenCalledWith('t-1', 7, 'reprendre le total');
  });
});
