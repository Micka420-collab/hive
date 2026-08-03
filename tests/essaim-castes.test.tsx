// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ESSAIM, RENDU — le polyéthisme, et le conseil qui ne ment à personne.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu SANS TEST la garde
// `{n.caste !== 'butineuse' && (…)}`. Inversée, chaque BUTINEUSE — la caste
// sommitale, celle qui n'a rien au-dessus — recevrait « N production(s) de
// plus pour le palier suivant » : un conseil vers un palier qui n'existe pas.
// Et les nourrices comme les bâtisseuses perdraient le leur, précisément
// celles qui en ont un à suivre.
//
// Les quatre sondes de la vue passent par le module api, simulé en gardant le
// reste réel (même méthode que le tiroir). Trois rendent `null` — leurs
// sections se taisent — et `fetchPolyethisme` rend la vue qu'on met en scène.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateSnapshot } from '../src/shared/types';
import type { VuePolyethisme } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
}));

import { fetchPolyethisme, fetchRaces } from '../dashboard/src/api';
import Essaim from '../dashboard/src/views/Essaim';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchPolyethisme).mockReset();
  vi.mocked(fetchRaces)
    .mockReset()
    .mockResolvedValue({ races: [] } as never);
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const INSTANTANE: StateSnapshot = { projects: [], nodes: [], tasks: [], tasksTotal: 0 };

function proprietes(): ViewProps {
  return {
    snapshot: INSTANTANE,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
}

async function monterEssaim(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Essaim {...proprietes()} />));
  return conteneur;
}

function ouvriere(
  caste: 'nourrice' | 'batisseuse' | 'butineuse',
  productions: number,
  fiabilite = 0.9,
): VuePolyethisme['noeuds'][number] {
  return {
    nodeId: `noeud-${caste}-${productions}`,
    name: `ruche-${caste}`,
    agentType: 'shell',
    caste,
    productions,
    creuses: 0,
    suspectes: 0,
    fiabilite,
  };
}

function vuePoly(noeuds: VuePolyethisme['noeuds'], mode: VuePolyethisme['mode'] = 'consignes') {
  return {
    mode,
    modeDemande: mode,
    fenetre: 50,
    seuils: { batisseuse: 5, butineuse: 20 },
    noeuds,
  } satisfies VuePolyethisme;
}

describe('le polyéthisme — la survivante du balayage', () => {
  it('UNE NOURRICE VOIT CE QUI LUI MANQUE, chiffré contre le seuil de bâtisseuse', async () => {
    vi.mocked(fetchPolyethisme).mockResolvedValue(vuePoly([ouvriere('nourrice', 3)]));
    const dom = await monterEssaim();
    // seuil bâtisseuse 5, productions 3 → il en manque 2, en toutes lettres.
    expect(dom.textContent).toContain('2 production(s) de plus pour le palier suivant');
  });

  it('UNE BUTINEUSE NE REÇOIT AUCUN CONSEIL DE PALIER — il n’y a rien au-dessus', async () => {
    // La moitié qui tue `!== → ===` : inversée, la caste sommitale recevrait
    // un conseil vers un palier inexistant, et les autres perdraient le leur.
    vi.mocked(fetchPolyethisme).mockResolvedValue(vuePoly([ouvriere('butineuse', 40)]));
    const dom = await monterEssaim();
    expect(dom.textContent).toContain('butineuse');
    expect(dom.textContent, 'pas de palier au-dessus de butineuse').not.toContain('palier suivant');
    expect(dom.textContent).not.toContain('la fiabilité qui retient');
  });

  it('LE VOLUME Y EST, LA FIABILITÉ RETIENT — l’autre branche du conseil', async () => {
    // Bâtisseuse au-dessus du seuil de butineuse (20) mais fiabilité basse :
    // le conseil doit dire POURQUOI elle stagne, pas un compte à rebours nul.
    vi.mocked(fetchPolyethisme).mockResolvedValue(vuePoly([ouvriere('batisseuse', 25, 0.4)]));
    const dom = await monterEssaim();
    expect(dom.textContent).toContain('le volume y est — c’est la fiabilité qui retient');
    expect(dom.textContent).toContain('40%');
  });

  it('AUCUNE OUVRIÈRE : la vue le dit, sans inventer de liste', async () => {
    vi.mocked(fetchPolyethisme).mockResolvedValue(vuePoly([]));
    const dom = await monterEssaim();
    expect(dom.textContent).toContain('Aucune ouvrière observée');
  });

  it('LE ⚔ NE MARQUE QUE L’OUVRIÈRE DONT LE DRONE VOLE — pas celle dont il est tombé', async () => {
    // Deux survivantes du balayage du soir, dans la même mise en scène :
    //   · `d.status === 'running'` du marquage ⚔ — mutée, l'ouvrière au drone
    //     TOMBÉ porterait le badge de course, et celle qui vole non ;
    //   · `statusLabel('running')` — mutée, le drone en vol s'annoncerait
    //     « running » cru, et tous les autres « en vol ».
    vi.mocked(fetchRaces).mockResolvedValue({
      races: [
        {
          taskId: 't-course',
          drones: [
            { nodeId: 'n-vol', status: 'running' },
            { nodeId: 'n-tombe', status: 'failed' },
          ],
        },
      ],
    } as never);
    const noeud = (id: string, name: string) =>
      ({
        id,
        name,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
        running: 0,
        status: 'online',
        lastSeen: 1,
      }) as never;
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    const props = {
      ...proprietes(),
      snapshot: {
        ...INSTANTANE,
        nodes: [noeud('n-vol', 'ruche-en-vol'), noeud('n-tombe', 'ruche-tombee')],
      },
    } as unknown as ViewProps;
    await act(async () => racine?.render(<Essaim {...props} />));
    const dom = conteneur;

    const cartes = [...dom.querySelectorAll('.es-node')];
    const enVol = cartes.find((c) => (c.textContent ?? '').includes('ruche-en-vol'));
    const tombee = cartes.find((c) => (c.textContent ?? '').includes('ruche-tombee'));
    expect(
      enVol?.querySelector('.es-race-badge'),
      'le drone vole : le badge se porte',
    ).toBeTruthy();
    expect(
      tombee?.querySelector('.es-race-badge'),
      'le drone est tombé : pas de badge de course',
    ).toBeNull();

    // Les étiquettes d'état, dans la carte des courses.
    const libelles = [...dom.querySelectorAll('[aria-label]')].map(
      (e) => e.getAttribute('aria-label') ?? '',
    );
    expect(libelles.some((l) => l.includes('ruche-en-vol — en vol'))).toBe(true);
    expect(libelles.some((l) => l.includes('ruche-tombee — tombé'))).toBe(true);
    expect(
      libelles.some((l) => l.includes('— running')),
      'aucun statut cru ne traverse l’écran',
    ).toBe(false);
  });

  it('MODE DEMANDÉ MAIS ÉTEINT : l’écart est DIT — pas un encadrement de façade', async () => {
    // `mode` est celui qui s'applique, `modeDemande` celui qu'on a réglé. Les
    // Gardiennes éteintes, aucune caste ne se gagne : afficher le seul mode
    // demandé laisserait croire à un encadrement qui ne tourne pas.
    vi.mocked(fetchPolyethisme).mockResolvedValue({
      ...vuePoly([ouvriere('nourrice', 1)]),
      mode: 'off',
      modeDemande: 'strict',
    });
    const dom = await monterEssaim();
    expect(dom.textContent).toContain('ÉTEINT');
  });
});
