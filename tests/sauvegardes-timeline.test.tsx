// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// Timeline de sauvegardes — liste, pose manuelle, restauration via tâche.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPartage: vi.fn(() => null),
  fetchSauvegardes: vi.fn(),
  creerSauvegardeManuelle: vi.fn(),
  restaurerSauvegarde: vi.fn(),
}));

import {
  creerSauvegardeManuelle,
  fetchSauvegardes,
  restaurerSauvegarde,
} from '../dashboard/src/api';
import { SauvegardesTimeline } from '../dashboard/src/SauvegardesTimeline';

const fetchSg = vi.mocked(fetchSauvegardes);
const creer = vi.mocked(creerSauvegardeManuelle);
const resto = vi.mocked(restaurerSauvegarde);

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  setLang('fr');
  fetchSg.mockReset();
  creer.mockReset();
  resto.mockReset();
  fetchSg.mockResolvedValue({ sauvegardes: [] });
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.restoreAllMocks();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine?.render(<SauvegardesTimeline projectId="p1" />);
  });
  await act(async () => {});
  return conteneur;
}

describe('SauvegardesTimeline', () => {
  it('montre l’état vide puis une étape listée', async () => {
    const dom = await monter();
    expect(dom.querySelector('.ry-sg-vide')).not.toBeNull();

    fetchSg.mockResolvedValue({
      sauvegardes: [
        {
          id: 's1',
          projectId: 'p1',
          resultId: 1,
          taskId: 't1',
          label: 'Étape — Socle',
          kind: 'etape',
          taille: 42,
          createdAt: Date.now(),
        },
      ],
    });
    await act(async () => {
      racine?.render(<SauvegardesTimeline projectId="p1" refreshTick={1} />);
    });
    await act(async () => {});
    expect(dom.querySelector('.ry-sg-vide')).toBeNull();
    expect(dom.textContent).toContain('Étape — Socle');
    expect(dom.querySelector('.ry-sg-restaure')).not.toBeNull();
  });

  it('pose une sauvegarde manuelle et appelle l’API', async () => {
    creer.mockResolvedValue({
      sauvegarde: {
        id: 'm1',
        projectId: 'p1',
        resultId: null,
        taskId: null,
        label: 'Avant migration',
        kind: 'manuel',
        taille: 0,
        createdAt: Date.now(),
      },
    });
    const dom = await monter();
    const input = dom.querySelector<HTMLInputElement>('.ry-sg-input');
    expect(input).not.toBeNull();
    const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
      v: string,
    ) => void;
    await act(async () => {
      poser.call(input!, 'Avant migration');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const btn = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Poser'),
    );
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    expect(creer).toHaveBeenCalledWith('p1', { label: 'Avant migration' });
  });

  it('restaurer crée une tâche via l’API', async () => {
    fetchSg.mockResolvedValue({
      sauvegardes: [
        {
          id: 's1',
          projectId: 'p1',
          resultId: 1,
          taskId: 't1',
          label: 'Étape — Socle',
          kind: 'etape',
          taille: 42,
          createdAt: Date.now(),
        },
      ],
    });
    resto.mockResolvedValue({
      task: { id: 'task-r', title: 'Restaurer — Étape — Socle' },
      sauvegardeId: 's1',
    });
    const dom = await monter();
    const btn = dom.querySelector('.ry-sg-restaure');
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    expect(resto).toHaveBeenCalledWith('p1', 's1');
    expect(dom.textContent).toContain('Tâche créée');
  });
});
