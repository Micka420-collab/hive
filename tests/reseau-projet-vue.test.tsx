// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PANNEAU « RÉSEAU DES AGENTS » d'un projet (Mission Control) : il dit le
// niveau en vigueur — et que c'est le DÉFAUT quand personne ne l'a réglé —,
// ce que chaque niveau ouvre, et règle au clic.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchReseauProjet: vi.fn(),
  reglerReseauProjet: vi.fn(() => Promise.resolve({ niveau: 'integrations', regle: true })),
}));

import { fetchReseauProjet, reglerReseauProjet } from '../dashboard/src/api';
import type { EtatReseauUi } from '../dashboard/src/api';
import { ReseauProjet } from '../dashboard/src/ReseauProjet';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  void act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
  vi.mocked(fetchReseauProjet).mockReset();
  vi.mocked(reglerReseauProjet).mockClear();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<ReseauProjet projectId="p-1" />));
  await act(async () => {});
  return conteneur;
}

const etat = (p: Partial<EtatReseauUi> = {}): EtatReseauUi => ({
  niveau: 'dependances',
  regle: false,
  definiPar: null,
  updatedAt: null,
  niveaux: ['integrations', 'dependances', 'ouvert'],
  defaut: 'dependances',
  ...p,
});

describe('le panneau du réseau des agents', () => {
  it('dit le défaut COMME un défaut, et ce qu’il ouvre', async () => {
    vi.mocked(fetchReseauProjet).mockResolvedValue(etat());
    const c = await monter();
    const niveau = c.querySelector('[data-testid="reseau-niveau"]')?.textContent ?? '';
    expect(niveau).toContain('Dépendances (défaut)');
    expect(niveau).toContain('registres que le dépôt déclare');
    expect(
      c.querySelector('[data-testid="reseau-dependances"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('« ouvert » dit qu’il rend le réseau entier et les clés réelles', async () => {
    vi.mocked(fetchReseauProjet).mockResolvedValue(etat({ niveau: 'ouvert', regle: true }));
    const c = await monter();
    const niveau = c.querySelector('[data-testid="reseau-niveau"]')?.textContent ?? '';
    expect(niveau).not.toContain('(défaut)');
    expect(niveau).toMatch(/réseau entier.*clés réelles/);
  });

  it('un clic règle le niveau, puis relit l’état', async () => {
    vi.mocked(fetchReseauProjet).mockResolvedValue(etat());
    const c = await monter();
    const bouton = c.querySelector<HTMLButtonElement>('[data-testid="reseau-integrations"]');
    await act(async () => bouton?.click());
    expect(vi.mocked(reglerReseauProjet)).toHaveBeenCalledWith('p-1', 'integrations');
    expect(vi.mocked(fetchReseauProjet)).toHaveBeenCalledTimes(2);
  });
});
