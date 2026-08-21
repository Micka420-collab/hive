// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// RAYON → CHAMBRE — un curseur constaté ouvre le poste de l’ouvrière.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { EntreeRayon } from '../dashboard/src/api';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/CodeEditor', () => ({
  default: () => <div data-editeur="1" />,
}));

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPartage: vi.fn(() => null),
  fetchRayon: vi.fn(() =>
    Promise.resolve({
      chemin: '',
      entrees: [
        {
          chemin: 'src/pont/mcp.ts',
          nom: 'mcp.ts',
          type: 'fichier',
          taille: 42,
        } satisfies EntreeRayon,
      ],
    }),
  ),
  fetchFichierRayon: vi.fn(),
  fetchApercu: vi.fn(() => Promise.resolve(null)),
  proposerRetouche: vi.fn(),
  fetchSauvegardes: vi.fn(() => Promise.resolve({ sauvegardes: [] })),
  fetchPresences: vi.fn(() =>
    Promise.resolve({
      presences: [
        {
          nodeId: 'node-capucine',
          bapteme: 'Capucine',
          chemin: 'src/pont/mcp.ts',
          outil: 'Edit',
          toolUseId: 'tu1',
          taskId: 't1',
          constateA: 1,
        },
      ],
    }),
  ),
}));

import { fetchPresences, getPartage } from '../dashboard/src/api';
import Rayon from '../dashboard/src/views/Rayon';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(getPartage).mockReturnValue(null);
  vi.mocked(fetchPresences)
    .mockReset()
    .mockResolvedValue({
      presences: [
        {
          nodeId: 'node-capucine',
          bapteme: 'Capucine',
          chemin: 'src/pont/mcp.ts',
          outil: 'Edit',
          toolUseId: 'tu1',
          taskId: 't1',
          constateA: 1,
        },
      ],
    });
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(onNavigate: ViewProps['onNavigate']): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [
        {
          id: 'p1',
          name: 'Pont',
          description: '',
          status: 'active',
          createdAt: 1,
          repoUrl: null,
          localPath: null,
          baseBranch: 'main',
        },
      ],
      nodes: [],
      tasks: [],
      tasksTotal: 0,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate,
    refreshTick: 0,
    selectedId: 'p1',
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Rayon {...props} />));
  await act(async () => {});
  return document.body;
}

describe('curseur Rayon → Chambre', () => {
  it('un clic sur Capucine ouvre #/chambre/<nodeId>', async () => {
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    const curseur = dom.querySelector('[data-testid="ry-curseur-poste"]') as HTMLButtonElement;
    expect(curseur).toBeTruthy();
    expect(curseur.textContent).toContain('Capucine');
    expect(curseur.getAttribute('aria-label')).toMatch(/Capucine.*ouvrir le poste/i);
    await act(async () => {
      curseur.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('chambre', 'node-capucine');
  });

  it('en partage, annonce l’absence d’identités et n’affiche pas de curseur', async () => {
    vi.mocked(getPartage).mockReturnValue({ token: 'x', projectId: 'p1' } as never);
    const dom = await monter(vi.fn());
    expect(dom.querySelector('[data-testid="ry-partage-identites"]')?.textContent).toContain(
      'Identités absentes',
    );
    expect(dom.querySelectorAll('[data-testid="ry-curseur-poste"]')).toHaveLength(0);
    expect(dom.querySelector('[data-testid="ry-presences-live"]')).toBeNull();
  });

  it('liste les présences même si le fichier n’est pas dans l’arbre', async () => {
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    const bandeau = dom.querySelector('[data-testid="ry-presences-live"]');
    expect(bandeau?.textContent).toContain('En train de');
    expect(bandeau?.textContent).toContain('src/pont/mcp.ts');
    expect(bandeau?.textContent).toContain('Capucine');
  });

  it('sans baptême, le curseur reste muet (outil, pas de prénom inventé)', async () => {
    vi.mocked(fetchPresences).mockResolvedValue({
      presences: [
        {
          nodeId: 'node-anonyme',
          bapteme: null,
          chemin: 'src/a.ts',
          outil: 'Read',
          toolUseId: 'tu-muet',
          taskId: 't2',
          constateA: 1,
        },
      ],
    } as never);
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    const curseur = dom.querySelector('[data-testid="ry-curseur-poste"]') as HTMLButtonElement;
    expect(curseur).toBeTruthy();
    expect(curseur.classList.contains('ry-curseur-muet')).toBe(true);
    expect(curseur.textContent).toBe('Read');
    expect(curseur.textContent).not.toMatch(/Capucine|Anonyme|ouvrière/i);
    await act(async () => {
      curseur.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('chambre', 'node-anonyme');
  });

  it('un clic sur le chemin du bandeau ouvre le fichier dans l’arbre', async () => {
    const { fetchFichierRayon, fetchRayon } = await import('../dashboard/src/api');
    vi.mocked(fetchFichierRayon).mockResolvedValue({
      chemin: 'src/pont/mcp.ts',
      contenu: 'export {}',
      langage: 'typescript',
      taille: 10,
      tronque: false,
    } as never);
    vi.mocked(fetchRayon).mockImplementation(async (_p: string, chemin = '') => {
      if (chemin === '') {
        return {
          chemin: '',
          entrees: [{ chemin: 'src', nom: 'src', type: 'dossier', taille: 0 }],
        } as never;
      }
      if (chemin === 'src') {
        return {
          chemin: 'src',
          entrees: [{ chemin: 'src/pont', nom: 'pont', type: 'dossier', taille: 0 }],
        } as never;
      }
      if (chemin === 'src/pont') {
        return {
          chemin: 'src/pont',
          entrees: [{ chemin: 'src/pont/mcp.ts', nom: 'mcp.ts', type: 'fichier', taille: 42 }],
        } as never;
      }
      return { chemin, entrees: [] } as never;
    });
    const dom = await monter(vi.fn());
    const chemin = dom.querySelector('[data-testid="ry-presences-chemin"]') as HTMLButtonElement;
    expect(chemin).toBeTruthy();
    await act(async () => {
      chemin.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(fetchFichierRayon)).toHaveBeenCalledWith('p1', 'src/pont/mcp.ts');
    expect(dom.querySelector('.ry-entree.active')?.textContent).toContain('mcp.ts');
    expect(dom.querySelector('.ry-entree.active')?.getAttribute('aria-current')).toBe('true');
  });
});
