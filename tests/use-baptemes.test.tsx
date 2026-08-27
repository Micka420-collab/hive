// @vitest-environment happy-dom
//
// Hook baptêmes — une sonde, deux vues (Ruche / Essaim).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

import { fetchBaptemes } from '../dashboard/src/api';
import { nomConstate, useBaptemes } from '../dashboard/src/useBaptemes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('nomConstate', () => {
  it('préfère le baptême, sinon le technique', () => {
    expect(nomConstate({ n1: 'Capucine' }, 'n1', 'ma-machine')).toBe('Capucine');
    expect(nomConstate({ n1: null }, 'n1', 'ma-machine')).toBe('ma-machine');
    expect(nomConstate(null, 'n1', 'ma-machine')).toBe('ma-machine');
  });
});

describe('useBaptemes', () => {
  let racine: Root | null = null;
  let conteneur: HTMLElement | null = null;
  let vu: Record<string, string | null> | null = undefined as never;

  function Probe({ ids, tick = 0 }: { ids: string; tick?: number }) {
    vu = useBaptemes(ids, tick);
    return null;
  }

  beforeEach(() => {
    vu = undefined as never;
    vi.mocked(fetchBaptemes).mockReset().mockResolvedValue({ baptemes: [] });
  });

  afterEach(() => {
    act(() => racine?.unmount());
    conteneur?.remove();
    racine = null;
    conteneur = null;
  });

  it('remplit la carte quand l’API répond', async () => {
    vi.mocked(fetchBaptemes).mockResolvedValue({
      baptemes: [{ nodeId: 'n1', nom: 'Capucine', baptiseA: 1 }],
    });
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => racine?.render(<Probe ids="n1,n2" />));
    await act(async () => {});
    expect(vu).toEqual({ n1: 'Capucine', n2: null });
  });

  it('reste null si l’API échoue — pas de faux « pas baptisée »', async () => {
    vi.mocked(fetchBaptemes).mockRejectedValue(new Error('401'));
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => racine?.render(<Probe ids="n1" />));
    await act(async () => {});
    expect(vu).toBeNull();
  });
});
