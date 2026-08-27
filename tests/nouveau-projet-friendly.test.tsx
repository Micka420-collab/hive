// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// Nouveau projet : le premier parcours reste en langage humain ; le DAG JSON
// est disponible, mais seulement quand l'utilisateur demande les options.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createProject: vi.fn(),
  addTasks: vi.fn(),
  planBrief: vi.fn(),
}));

import { addTasks, createProject, planBrief } from '../dashboard/src/api';
import { NewProjectModal } from '../dashboard/src/NewProjectModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(createProject)
    .mockReset()
    .mockResolvedValue({ id: 'p-friendly' } as never);
  vi.mocked(addTasks)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(planBrief).mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function monter(onClose = vi.fn()): Promise<{ dom: HTMLElement; onClose: () => void }> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<NewProjectModal onClose={onClose} />));
  return { dom: document.body, onClose };
}

function saisir(el: HTMLInputElement | HTMLTextAreaElement, texte: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  setter?.call(el, texte);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Nouveau projet — parcours accueillant', () => {
  it('cache le JSON au départ et l’offre dans Options avancées', async () => {
    const { dom } = await monter();
    expect(dom.textContent).toContain('Nommez le projet et sa première mission');
    expect(dom.textContent).toContain('Créer le projet');
    expect(dom.querySelector('#np-advanced-content')).toBeNull();

    const ouvrir = [...dom.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Options avancées'),
    );
    expect(ouvrir).toBeTruthy();
    await act(async () => ouvrir!.click());

    expect(dom.querySelector('#np-advanced-content')).toBeTruthy();
    expect(dom.textContent).toContain('Graphe de tâches (JSON)');
  });

  it('transforme la mission simple en une tâche sans demander de JSON', async () => {
    const onClose = vi.fn();
    const { dom } = await monter(onClose);
    const inputs = dom.querySelectorAll<HTMLInputElement>('.np-modal input');
    const brief = dom.querySelector<HTMLTextAreaElement>('.np-modal textarea');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    expect(brief).toBeTruthy();

    await act(async () => {
      saisir(inputs[0]!, 'Site vitrine');
      saisir(brief!, 'Créer une page claire, responsive et accessible.');
    });
    const creer = [...dom.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Créer le projet',
    );
    expect(creer).toBeTruthy();
    await act(async () => creer!.click());

    expect(createProject).toHaveBeenCalledWith({ name: 'Site vitrine' });
    expect(addTasks).toHaveBeenCalledWith('p-friendly', [
      {
        title: 'Site vitrine',
        prompt: 'Créer une page claire, responsive et accessible.',
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });
});
