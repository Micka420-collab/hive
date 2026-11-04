// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ÉCRAN DES AUTOMATISATIONS — le full auto se règle par un VRAI
// interrupteur, se confirme en disant ce qu'il va trancher, et raconte ce que
// les agents ont décidé.
//
// Ce que ce banc tient :
//
//   · un `switch` nommé « Full auto », jamais une case muette ;
//   · ALLUMER se confirme (le geste qui retire l'humain de la boucle), et la
//     confirmation dit combien de productions en attente seront tranchées —
//     ÉTEINDRE, le geste sûr, ne demande rien ;
//   · les dernières décisions nomment la tâche et ouvrent sa fiche ;
//   · une lecture qui échoue sur une carte le dit sur CETTE carte, sans faire
//     tomber l'écran.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtatFullAutoUi } from '../dashboard/src/api';
import type { Project, StateSnapshot } from '../src/shared/types';

const banc = vi.hoisted(() => ({
  etat: null as unknown as EtatFullAutoUi,
  reglages: [] as boolean[],
}));

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchFullAuto: vi.fn(() => Promise.resolve(banc.etat)),
  setFullAuto: vi.fn((_id: string, actif: boolean) => {
    banc.reglages.push(actif);
    banc.etat = { ...banc.etat, actif, depuis: actif ? Date.now() : null };
    return Promise.resolve(banc.etat);
  }),
  fetchEssaim: vi.fn(() =>
    Promise.resolve({
      niveau: 'off',
      gouvernantes: [],
      gouvernantesRequises: 2,
    }),
  ),
  fetchGardeFou: vi.fn(() => Promise.reject(new Error('garde-fou illisible'))),
  fetchChantiers: vi.fn(() => Promise.resolve({ chantiers: [] })),
  fetchConnecteursProjet: vi.fn(() => Promise.reject(new Error('compte requis'))),
}));

import { setLang } from '../dashboard/src/i18n';
import Automatisations from '../dashboard/src/views/Automatisations';
import type { ViewProps } from '../dashboard/src/views/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const projet = { id: 'p1', name: 'Démo', repoUrl: null } as unknown as Project;

function etatDe(p: Partial<EtatFullAutoUi> = {}): EtatFullAutoUi {
  return {
    actif: false,
    definiPar: null,
    depuis: null,
    tentativesMax: 3,
    enAttente: 4,
    echouees: 0,
    bilan: { validees: 0, avecReserve: 0, corrigees: 0, laissees: 0, bloquees: 0, derniers: [] },
    ...p,
  };
}

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
const ouvertes: string[] = [];

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: { projects: [projet], tasks: [], nodes: [] } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set<string>(),
    onOpenTask: (id: string) => ouvertes.push(id),
    onNewProject: () => {},
    onNavigate: () => {},
    selectedId: null,
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Automatisations {...props} />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return conteneur;
}

const bouton = (dom: HTMLElement, mot: string): HTMLButtonElement => {
  const b = [...dom.querySelectorAll('button')].find((x) => x.textContent?.includes(mot));
  expect(b, `bouton « ${mot} » introuvable`).toBeTruthy();
  return b!;
};

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  banc.reglages.length = 0;
  ouvertes.length = 0;
  banc.etat = etatDe();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

describe('les automatisations', () => {
  it('un interrupteur « Full auto », éteint — et ALLUMER se confirme en disant la file', async () => {
    const dom = await monter();
    const sw = dom.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    expect(dom.querySelector(`#${sw?.getAttribute('aria-labelledby')}`)?.textContent).toBe(
      'Full auto',
    );

    await act(async () => sw!.click());
    expect(banc.reglages, 'allumer sans confirmer retirerait l’humain sur un faux clic').toEqual(
      [],
    );
    const confirmation = dom.querySelector('.hs-auto-confirmer');
    expect(confirmation?.textContent).toContain('Les 4 production(s) qui t’attendent');

    await act(async () => bouton(dom, 'Allumer le full auto').click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(banc.reglages).toEqual([true]);
    expect(dom.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(dom.querySelector('.hs-auto-confirmer')).toBeNull();
  });

  it('ÉTEINDRE, le geste sûr, ne demande rien', async () => {
    banc.etat = etatDe({ actif: true, depuis: Date.now() - 60_000, enAttente: 0 });
    const dom = await monter();
    await act(async () => dom.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(banc.reglages).toEqual([false]);
  });

  it('les décisions des agents nomment la tâche, disent le geste et sa réserve, et ouvrent la fiche', async () => {
    banc.etat = etatDe({
      actif: true,
      depuis: Date.now() - 60_000,
      enAttente: 0,
      bilan: {
        validees: 1,
        avecReserve: 1,
        corrigees: 1,
        laissees: 0,
        bloquees: 1,
        derniers: [
          {
            id: 3,
            ts: Date.now(),
            taskId: 't3',
            titre: 'Facture',
            geste: 'bloquee',
            raison: 'attempts_exhausted',
          },
          {
            id: 2,
            ts: Date.now(),
            taskId: 't2',
            titre: 'Parseur',
            geste: 'corriger',
            raison: 'production creuse',
          },
          {
            id: 1,
            ts: Date.now(),
            taskId: 't1',
            titre: 'Socle',
            geste: 'approuver',
            raison: 'preuves manquantes : tests',
          },
        ],
      },
    });
    const dom = await monter();
    const lignes = [...dom.querySelectorAll('.hs-auto-journal li')].map((l) =>
      l.textContent?.replace(/\s+/g, ' '),
    );
    expect(lignes[0]).toContain('Facture correction impossible');
    expect(lignes[1]).toContain('Parseur renvoyée en correction');
    expect(lignes[1]).toContain('production creuse');
    // Une validation SANS PREUVE ne ressemble pas à une validation prouvée.
    expect(lignes[2]).toContain('Socle validée avec réserve');
    expect(lignes[2]).toContain('preuves manquantes : tests');
    expect(dom.querySelector('.hs-auto-bilan-note')?.textContent).toContain(
      '1 validée(s) avec réserve',
    );
    await act(async () => bouton(dom, 'Parseur').click());
    expect(ouvertes).toEqual(['t2']);
    // « à toi » : les laissées, les bloquées et les échecs définitifs.
    const chiffres = [...dom.querySelectorAll('.hs-auto-chiffre')].map((c) =>
      c.textContent?.replace(/\s+/g, ' '),
    );
    expect(chiffres).toEqual(['1validées', '1corrections', '1à toi', '0en attente']);
  });

  it('une carte illisible le dit, sans faire tomber les autres', async () => {
    const dom = await monter();
    const cartes = [...dom.querySelectorAll('.hs-auto-carte')].map((c) => c.textContent ?? '');
    expect(cartes.find((c) => c.includes('Garde-fous'))).toContain('Illisible');
    expect(cartes.find((c) => c.includes('Plein Essaim'))).toContain('Éteint');
    expect(cartes.find((c) => c.includes('Chantiers'))).toContain('Sans dépôt');
    expect(cartes.find((c) => c.includes('Connecteurs'))).toContain('Avec un compte');
  });
});
