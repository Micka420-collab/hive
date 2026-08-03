// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// CINQ SENTINELLES, UNE PAR VUE — les survivantes isolées du balayage.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a laissé une survivante ISOLÉE dans cinq
// endroits du dashboard, plus une dans le module partagé. Elles n'ont pas de
// famille : chacune reçoit sa sentinelle ici, avec ce que l'écran raconterait
// de faux si elle vivait :
//
//   · Ruche `{total > 0 && (…)}` — mutée en `||`, une ruche VIDE afficherait
//     « 0/0 tâches butinées » en bandeau de progrès ;
//   · Rayon `{projet?.repoUrl && (…)}` — mutée en `||`, un repoUrl présent
//     serait rendu CRU — avec le jeton qu'il peut porter — au lieu de passer
//     par `sansIdentifiants` ;
//   · Chantiers `verdict.code !== null && …` — mutée, « (code 1) » disparaît
//     des verdicts réels et « (code null) » apparaît sur les autres ;
//   · Santé `taskId === null ? '' : ' clickable'` — mutée, le fantôme qui
//     mène à une tâche perd son habit cliquable, et celui qui ne mène nulle
//     part l'endosse ;
//   · OpenAlex `{error && <p className="modal-error">…}` — mutée en `||`,
//     une erreur vide s'affiche au repos et la vraie erreur perd son habit ;
//   · shared `countPendingReviews` — mutée en `||`, le badge compterait les
//     tâches déjà revues et celles encore en vol.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateSnapshot, Task } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchGhosts: vi.fn(() => Promise.resolve(null)),
  fetchThermo: vi.fn(() => Promise.resolve(null)),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchGardiennes: vi.fn(() => Promise.resolve(null)),
  fetchGuet: vi.fn(() => Promise.resolve(null)),
  fetchChantiers: vi.fn(() => Promise.resolve({ chantiers: [] })),
  fetchVerdictChantier: vi.fn(() => Promise.resolve({ resultat: null })),
  fetchWorkflows: vi.fn(() => Promise.resolve({ workflows: [] })),
  fetchRuns: vi.fn(() => Promise.resolve({ runs: [] })),
  fetchRayon: vi.fn(() => Promise.resolve({ chemin: '', entrees: [] })),
  fetchApercu: vi.fn(() => Promise.resolve(null)),
  fetchFichierRayon: vi.fn(() => Promise.resolve(null)),
}));

import { fetchGhosts, fetchVerdictChantier } from '../dashboard/src/api';
import { OpenAlexPanel } from '../dashboard/src/OpenAlexPanel';
import Chantiers from '../dashboard/src/views/Chantiers';
import Rayon from '../dashboard/src/views/Rayon';
import Ruche from '../dashboard/src/views/Ruche';
import Sante from '../dashboard/src/views/Sante';
import { countPendingReviews } from '../dashboard/src/views/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  vi.mocked(fetchGhosts)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchVerdictChantier)
    .mockReset()
    .mockResolvedValue({ resultat: null } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function tache(id: string, titre: string, statut: Task['status']): Task {
  return {
    id,
    projectId: 'p1',
    title: titre,
    prompt: 'p',
    status: statut,
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 1,
  };
}

function instantane(over: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    projects: [],
    nodes: [],
    tasks: [],
    tasksTotal: 0,
    ...over,
  } as unknown as StateSnapshot;
}

async function monter(ui: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  await act(async () => {});
  return conteneur;
}

function props(snapshot: StateSnapshot): ViewProps {
  return {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
}

describe('les sentinelles — une par survivante isolée', () => {
  it('RUCHE : une ruche vide n’affiche PAS « 0/0 tâches butinées »', async () => {
    const vide = await monter(<Ruche {...props(instantane())} />);
    expect(vide.textContent, 'aucun bandeau de progrès sans tâche').not.toContain(
      'tâches butinées',
    );

    act(() => racine?.unmount());
    const pleine = await monter(
      <Ruche {...props(instantane({ tasks: [tache('t1', 'Butinée', 'done')], tasksTotal: 1 }))} />,
    );
    expect(pleine.textContent).toContain('1/1');
    expect(pleine.textContent).toContain('tâches butinées');
  });

  it('RAYON : le repoUrl est LAVÉ de ses identifiants — jamais rendu cru', async () => {
    // Mutée en `||`, l'expression rendrait la CHAÎNE `repoUrl` telle quelle —
    // avec le jeton dedans — au lieu de l'élément `<code>` lavé.
    const dom = await monter(
      <Rayon
        {...props(
          instantane({
            projects: [
              {
                id: 'p1',
                name: 'Rucher',
                repoUrl: 'https://abeille:ghp_secret123@github.com/o/r',
                description: null,
                visibility: 'private',
                ownerId: null,
                createdAt: 1,
              },
            ] as never,
          }),
        )}
      />,
    );
    expect(dom.textContent, 'le jeton ne traverse JAMAIS l’écran').not.toContain('ghp_secret123');
    expect(dom.querySelector('.ry-depot')?.textContent).toContain('github.com/o/r');
  });

  it('CHANTIERS : le code de sortie ne s’écrit que quand il EXISTE', async () => {
    vi.mocked(fetchVerdictChantier).mockResolvedValue({
      resultat: { nom: 'tests', code: 1, sortie: '', ok: false },
    } as never);
    const battu = await monter(
      <Chantiers
        {...props(
          instantane({
            projects: [
              {
                id: 'p1',
                name: 'Rucher',
                repoUrl: null,
                description: null,
                visibility: 'private',
                ownerId: null,
                createdAt: 1,
              },
            ] as never,
          }),
        )}
      />,
    );
    expect(battu.textContent).toContain('tests — échoué');
    expect(battu.textContent, 'un vrai code se dit').toContain('(code 1)');

    act(() => racine?.unmount());
    vi.mocked(fetchVerdictChantier).mockResolvedValue({
      resultat: { nom: 'tests', code: null, sortie: '', ok: true },
    } as never);
    const sansCode = await monter(
      <Chantiers
        {...props(
          instantane({
            projects: [
              {
                id: 'p1',
                name: 'Rucher',
                repoUrl: null,
                description: null,
                visibility: 'private',
                ownerId: null,
                createdAt: 1,
              },
            ] as never,
          }),
        )}
      />,
    );
    expect(sansCode.textContent).toContain('tests — réussi');
    expect(sansCode.textContent, '« (code null) » est un mensonge').not.toContain('(code');
  });

  it('SANTÉ : seul le fantôme qui mène à une tâche est cliquable', async () => {
    vi.mocked(fetchGhosts).mockResolvedValue({
      ghosts: [
        { kind: 'looping_task', target: 't-boucle', severity: 'high', detail: '12 tours' },
        { kind: 'silent_node', target: 'n-fantome', severity: 'low', detail: 'muet' },
      ],
      scanned: { events: 10, nodes: 1, tasks: 2 },
    } as never);
    const dom = await monter(
      <Sante
        {...props(
          instantane({
            tasks: [tache('t-boucle', 'La tâche qui boucle', 'running')],
            nodes: [{ id: 'n-fantome', name: 'ruche-fantome' }] as never,
          }),
        )}
      />,
    );
    const items = [...dom.querySelectorAll('.es-ghost')];
    const versTache = items.find((l) => (l.textContent ?? '').includes('La tâche qui boucle'));
    const versNoeud = items.find((l) => (l.textContent ?? '').includes('ruche-fantome'));
    expect(versTache, 'le fantôme de tâche doit être listé').toBeTruthy();
    expect(versNoeud, 'le fantôme de nœud doit être listé').toBeTruthy();
    expect(versTache?.classList.contains('clickable'), 'la tâche s’ouvre au clic').toBe(true);
    expect(
      versNoeud?.classList.contains('clickable'),
      'un nœud n’a pas de tiroir — le curseur mentirait',
    ).toBe(false);
  });

  it('OPENALEX : l’erreur ne s’affiche que quand il y en a une, et dans son habit', async () => {
    vi.useFakeTimers();
    const repos = await monter(<OpenAlexPanel onClose={() => {}} />);
    expect(repos.querySelector('.modal-error'), 'aucune erreur au repos').toBeNull();

    // Une recherche qui échoue : le proxy répond 503 avec sa raison.
    vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'OpenAlex en panne' }),
    } as unknown as Response);
    const champ = repos.querySelector('.openalex-input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(champ) as object,
        'value',
      )?.set;
      setter?.call(champ, 'CRISPR');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    const erreur = repos.querySelector('.modal-error');
    expect(erreur, 'l’erreur porte son habit .modal-error').toBeTruthy();
    expect(erreur?.textContent).toContain('OpenAlex en panne');
  });

  it('SHARED : le badge « à revoir » ne compte NI les revues NI les tâches en vol', () => {
    localStorage.setItem('hive.review', JSON.stringify({ 't-revue': 'approved' }));
    const tasks = [
      tache('t-neuve', 'Neuve', 'done'),
      tache('t-revue', 'Revue', 'done'),
      tache('t-en-vol', 'En vol', 'running'),
    ];
    // Mutée en `||`, la revue compterait (statut vrai court-circuite) et la
    // tâche en vol aussi (!review vrai) : 3 au lieu de 1.
    expect(countPendingReviews(tasks)).toBe(1);
  });
});
