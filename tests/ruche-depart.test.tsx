// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PREMIER GESTE D'UNE RUCHE VIDE.
//
// ─── LE DÉFAUT MESURÉ ────────────────────────────────────────────────────────
//
// Le bouton « + Projet » ne vit que dans l'en-tête de la vue Projets — et
// c'est une décision gardée par `dashboard-shell.test.ts`, qu'on ne touche
// pas. Mais la vue d'arrivée, la Ruche, n'offrait alors AUCUN départ : un
// essaim au repos, une file vide, et rien à cliquer. D'où « je peux pas
// commencer un projet solo dans la ruche » : le travail solo était possible,
// il n'était nulle part proposé.
//
// Ce fichier garde les deux moitiés de la réparation : l'invite existe quand
// la ruche est vide, elle disparaît dès qu'un projet est là (sinon elle
// encombrerait un cockpit qui travaille), et elle appelle bien l'ouverture de
// la modale — pas une navigation qui laisserait l'humain au même point.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ruche from '../dashboard/src/views/Ruche';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import { couperLeReseau } from './aide/sans-reseau';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchEssaim: vi.fn(() =>
    Promise.resolve({
      niveau: 'off',
      niveaux: ['off', 'propose', 'gouverne', 'plein'],
      runner: { mode: 'off', enPause: false, echecs: 0 },
      derive: { etat: 'saine', echantillon: 0, indicateurs: [], solitudeJours: 0, motif: '' },
      decision: { pas: 'inerte', motif: '', gouvernantes: [] },
      gouvernantes: [],
      gouvernantesRequises: 1,
      depotInscrit: false,
      plafond: 'passe',
      lecons: [],
    }),
  ),
}));

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  localStorage.clear();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

function instantane(over: Partial<StateSnapshot> = {}): StateSnapshot {
  return { projects: [], nodes: [], tasks: [], tasksTotal: 0, ...over } as unknown as StateSnapshot;
}

function monter(snapshot: StateSnapshot, onNewProject: () => void): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set<string>(),
    onOpenTask: () => {},
    onNewProject,
    onNavigate: () => {},
    selectedId: null,
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  act(() => racine?.render(<Ruche {...props} />));
  return conteneur;
}

function depart(dom: HTMLElement): HTMLButtonElement | null {
  return dom.querySelector<HTMLButtonElement>('.ruche-depart button');
}

describe('la Ruche vide propose de commencer, seul', () => {
  it('sans projet, l’invite est là — et elle dit qu’on n’a besoin de personne', () => {
    const dom = monter(instantane(), () => {});
    expect(depart(dom), 'aucun départ proposé sur une ruche vide').toBeTruthy();
    expect(
      dom.querySelector('.ruche-depart')?.textContent,
      'le solo doit être dit : c’est ce que l’humain croyait impossible',
    ).toContain('seul');
    expect(
      dom.querySelector('.mc-ruche-stats'),
      'des KPI à zéro ne doivent pas diluer le départ',
    ).toBeNull();
    expect(
      dom.querySelector('.layout'),
      'essaim et file vides ne doivent pas diluer le départ',
    ).toBeNull();
  });

  it('dès qu’un projet existe, le cockpit (stats + layout) est bien là', () => {
    const dom = monter(instantane({ projects: [{ id: 'p1', name: 'Rucher' }] as never }), () => {});
    expect(dom.querySelector('.mc-ruche-stats'), 'le cockpit doit réapparaître').toBeTruthy();
    expect(dom.querySelector('.layout'), 'essaim et file doivent réapparaître').toBeTruthy();
  });

  it('le clic OUVRE la création — il ne se contente pas d’exister', () => {
    // Un bouton inerte passerait le test précédent sans rien réparer.
    let ouvertures = 0;
    const dom = monter(instantane(), () => {
      ouvertures += 1;
    });
    act(() => {
      depart(dom)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(ouvertures, 'le départ doit appeler la modale de projet').toBe(1);
  });

  it('dès qu’un projet existe, l’invite s’efface du cockpit', () => {
    const dom = monter(instantane({ projects: [{ id: 'p1', name: 'Rucher' }] as never }), () => {});
    expect(dom.querySelector('.ruche-depart'), 'une ruche au travail n’est plus accueillie').toBe(
      null,
    );
  });
});
