// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ANNONCE DANS LA FILE D'ATTENTE — voir sans ouvrir chaque tiroir.
//
// ─── POURQUOI UN INTERVALLE, ET JAMAIS UN PLAFOND ────────────────────────────
//
// « ≤ 25 min » se lit comme une borne dure. Ce n'en est pas une : `p80Ms` est
// un quantile à 80 %, et une annonce sur cinq est censée le dépasser. Dans une
// ligne de file, où personne ne survole pour lire l'infobulle, la forme qui
// tient sans mentir est l'INTERVALLE — « 7 min–25 min » ne peut pas être lu
// comme une promesse.
//
// Et rien du tout sur socle « aucun » : deux zéros rendus « 0 s–0 s » seraient
// l'exact contraire de « je ne sais pas encore ».

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ruche from '../dashboard/src/views/Ruche';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { HiveEvent, StateSnapshot, Task } from '../src/shared/types';

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
  localStorage.clear();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

function tache(id: string): Task {
  return {
    id,
    projectId: 'p1',
    title: `poser l’alvéole ${id}`,
    prompt: '',
    status: 'running',
    dependsOn: [],
    assignedNodeId: 'n1',
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

let suivant = 1;
function ev(type: string, payload: Record<string, unknown>): HiveEvent {
  return { id: suivant++, ts: 1_700_000_000_000 + suivant, type, payload };
}

function monter(events: HiveEvent[]): HTMLElement {
  const snapshot = {
    projects: [{ id: 'p1', name: 'Rucher' }],
    nodes: [],
    tasks: [tache('t1')],
    tasksTotal: 1,
  } as unknown as StateSnapshot;
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot,
    events,
    agentsByTask: {},
    deferred: new Set<string>(),
    onOpenTask: () => {},
    onNewProject: () => {},
    onNavigate: () => {},
    selectedId: null,
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  act(() => racine?.render(<Ruche {...props} />));
  return conteneur;
}

/** La puce d'annonce de la seule ligne de file du décor. */
function puce(dom: HTMLElement): HTMLElement | null {
  return dom.querySelector<HTMLElement>('.queue .queue-annonce');
}

const ANNONCE = ev('duree_annoncee', {
  taskId: 't1',
  nodeId: 'n1',
  socle: 'caste',
  n: 12,
  p50Ms: 420_000,
  p80Ms: 1_500_000,
});

describe('la file d’attente porte l’annonce', () => {
  it('SANS ANNONCE : aucune puce — le journal n’en a pas, on n’en invente pas', () => {
    const dom = monter([]);
    expect(dom.querySelector('.queue li'), 'le décor n’a pas de ligne de file').toBeTruthy();
    expect(puce(dom)).toBeNull();
  });

  it('AVEC ANNONCE : un INTERVALLE, pas un plafond', () => {
    const dom = monter([ANNONCE]);
    const p = puce(dom);
    expect(p, 'l’annonce n’atteint pas la file').not.toBeNull();
    const texte = p?.textContent ?? '';
    expect(texte, 'la borne basse manque — sans elle c’est un plafond').toContain('7 min');
    expect(texte).toContain('25 min');
    // Et la phrase entière, avec son `n`, reste accessible.
    expect(p?.getAttribute('title') ?? '').toContain('12 obs.');
  });

  it('SOCLE « AUCUN » : rien — « 0 s–0 s » dirait le contraire de « je ne sais pas »', () => {
    // La moitié qui tue la garde `socle === 'aucun'`. Sans elle, la file
    // afficherait un intervalle nul sur chaque tâche d'une ruche neuve — un
    // chiffre là où la ruche avait justement refusé d'en donner un.
    const dom = monter([
      ev('duree_annoncee', {
        taskId: 't1',
        nodeId: 'n1',
        socle: 'aucun',
        n: 2,
        p50Ms: 0,
        p80Ms: 0,
      }),
    ]);
    expect(puce(dom)).toBeNull();
  });

  it('HORS DOMAINE : la puce le DIT, et prend la place de l’intervalle', () => {
    // ─── L'ORDRE COMPTE ─────────────────────────────────────────────────────
    //
    // Les deux moitiés coexistent : la tâche a été annoncée PUIS elle est
    // sortie du domaine. Afficher l'intervalle serait alors le pire des deux
    // mondes — un chiffre rassurant sur la seule tâche dont on sait qu'il ne
    // s'applique plus.
    const dom = monter([
      ANNONCE,
      ev('duree_hors_domaine', {
        taskId: 't1',
        nodeId: 'n1',
        ecouleMs: 7_200_000,
        recordMs: 3_600_000,
      }),
    ]);
    const p = puce(dom);
    expect(p?.textContent).toContain('hors domaine');
    expect(p?.textContent, 'l’intervalle périmé ne doit pas rester').not.toContain('25 min');
    expect(p?.className).toContain('hors');
    expect(p?.getAttribute('title') ?? '', 'le record informe, un « bientôt » non').toContain(
      '60 min',
    );
  });

  it('L’ANNONCE D’UNE AUTRE TÂCHE NE DÉTEINT PAS', () => {
    // La moitié qui tue « prendre la première annonce venue » : la file lit par
    // identifiant, sinon toutes les lignes porteraient la même durée.
    const dom = monter([
      ev('duree_annoncee', {
        taskId: 'une-autre',
        nodeId: 'n1',
        socle: 'caste',
        n: 9,
        p50Ms: 60_000,
        p80Ms: 120_000,
      }),
    ]);
    expect(puce(dom)).toBeNull();
  });
});
