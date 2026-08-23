// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CHEMIN VERS LE PREMIER CYCLE — la checklist qui doit DISPARAÎTRE.
//
// Ce composant est arrivé sans banc. Ce n'est pas un détail d'affichage : il
// porte TROIS règles d'effacement, chacune un `return null` isolé, et un
// composant qui reste affiché après coup se lit comme « il reste du travail »
// alors qu'il n'en reste pas. Les trois sont éprouvées ici, séparément.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { CycleEssaimUi, EtatEssaimUi, PretEssaimUi } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchEssaim: vi.fn(),
  fetchEssaimCycles: vi.fn(),
}));

import { fetchEssaim, fetchEssaimCycles } from '../dashboard/src/api';
import { OnboardingEssaim } from '../dashboard/src/OnboardingEssaim';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

/** Aucun prérequis rempli — l'état de départ d'une ruche neuve. */
function pretVierge(over: Partial<PretEssaimUi> = {}): PretEssaimUi {
  return {
    runner: false,
    gouvernantes: false,
    noeudsEnLigne: false,
    agentsReels: false,
    depot: false,
    derive: false,
    plafond: false,
    repo: false,
    ...over,
  };
}

function pretComplet(): PretEssaimUi {
  return {
    runner: true,
    gouvernantes: true,
    noeudsEnLigne: true,
    agentsReels: true,
    depot: true,
    derive: true,
    plafond: true,
    repo: true,
  };
}

function etat(over: Partial<EtatEssaimUi> = {}): EtatEssaimUi {
  return {
    niveau: 'off',
    niveaux: ['off', 'propose', 'gouverne', 'plein'],
    pret: pretVierge(),
    derive: { etat: 'saine', echantillon: 0, indicateurs: [], solitudeJours: 0, motif: '' },
    decision: { pas: 'inerte', motif: '', gouvernantes: [] },
    gouvernantes: [],
    gouvernantesRequises: 2,
    depotInscrit: false,
    plafond: 'passe',
    lecons: [],
    ...over,
  } as EtatEssaimUi;
}

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchEssaimCycles).mockResolvedValue({ cycles: [] as CycleEssaimUi[] });
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<OnboardingEssaim projectId="p1" />));
  await act(async () => {});
  return conteneur;
}

function section(dom: HTMLElement): HTMLElement | null {
  return dom.querySelector('.onboarding-essaim');
}

describe('la checklist du premier cycle', () => {
  it('une ruche neuve la voit, avec le compte des prérequis', async () => {
    vi.mocked(fetchEssaim).mockResolvedValue(etat());
    const dom = await monter();
    expect(section(dom), 'la checklist doit être affichée').toBeTruthy();
    expect(dom.textContent).toContain('0/5');
    expect(dom.querySelectorAll('.onboarding-etapes li')).toHaveLength(5);
  });

  it('le compte SUIT les prérequis remplis', async () => {
    vi.mocked(fetchEssaim).mockResolvedValue(
      etat({ pret: pretVierge({ runner: true, noeudsEnLigne: true, agentsReels: true }) }),
    );
    const dom = await monter();
    expect(dom.textContent).toContain('2/5');
    expect(dom.querySelectorAll('.onboarding-ok')).toHaveLength(2);
  });

  it('l’indice n’apparaît QUE sur l’étape active — une seule à la fois', async () => {
    vi.mocked(fetchEssaim).mockResolvedValue(etat());
    const dom = await monter();
    expect(dom.querySelectorAll('.onboarding-actif')).toHaveLength(1);
    expect(dom.querySelectorAll('.onboarding-hint')).toHaveLength(1);
  });

  it('l’étape active est la PREMIÈRE non faite, pas n’importe laquelle', async () => {
    // Les nœuds sont là ; c'est donc le runner qui devient l'étape active.
    vi.mocked(fetchEssaim).mockResolvedValue(
      etat({ pret: pretVierge({ noeudsEnLigne: true, agentsReels: true }) }),
    );
    const dom = await monter();
    const actif = dom.querySelector('.onboarding-actif');
    expect(actif?.textContent).toContain('HIVE_RUNNER');
  });
});

describe('les trois règles d’effacement', () => {
  it('sans état lisible, elle ne s’affiche pas du tout', async () => {
    vi.mocked(fetchEssaim).mockRejectedValue(new Error('ruche injoignable'));
    const dom = await monter();
    expect(section(dom)).toBeNull();
  });

  it('une ruche DÉJÀ autonome qui a tourné ne la revoit pas', async () => {
    vi.mocked(fetchEssaim).mockResolvedValue(etat({ niveau: 'gouverne' }));
    vi.mocked(fetchEssaimCycles).mockResolvedValue({ cycles: [{ ts: 1 }] as CycleEssaimUi[] });
    const dom = await monter();
    expect(section(dom)).toBeNull();
  });

  it('checklist complète ET un cycle passé : elle s’efface', async () => {
    vi.mocked(fetchEssaim).mockResolvedValue(etat({ pret: pretComplet() }));
    vi.mocked(fetchEssaimCycles).mockResolvedValue({ cycles: [{ ts: 1 }] as CycleEssaimUi[] });
    const dom = await monter();
    expect(section(dom)).toBeNull();
  });

  it('checklist complète mais AUCUN cycle : elle reste, et invite à lancer', async () => {
    // La règle qui distingue « prêt » de « fini ». Sans elle, la ruche prête
    // n'aurait plus rien à l'écran pour dire quoi faire du dernier geste.
    vi.mocked(fetchEssaim).mockResolvedValue(etat({ pret: pretComplet() }));
    const dom = await monter();
    expect(section(dom)).toBeTruthy();
    expect(dom.querySelector('.onboarding-pret')?.textContent).toContain('Checklist complète');
  });
});

describe('la masquer', () => {
  it('le bouton l’efface, et elle ne revient pas', async () => {
    vi.mocked(fetchEssaim).mockResolvedValue(etat());
    const dom = await monter();
    const bouton = [...dom.querySelectorAll('button')].find(
      (b) => b.textContent === 'Masquer',
    ) as HTMLButtonElement;
    expect(bouton, 'le bouton Masquer existe').toBeTruthy();
    await act(async () => bouton.click());
    expect(section(dom)).toBeNull();
  });
});

describe('les deux langues', () => {
  it('en anglais, le titre et le bouton parlent anglais', async () => {
    setLang('en');
    vi.mocked(fetchEssaim).mockResolvedValue(etat());
    const dom = await monter();
    expect(dom.textContent).toContain('Path to the first cycle');
    expect(dom.textContent).toContain('Hide');
  });
});
