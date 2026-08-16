// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES COURSES EN VOL — ce que la carte affirme, et ce qu'elle refuse d'affirmer.
//
// ─── CE QUI ÉTAIT DÉJÀ GARDÉ, ET COMMENT ON LE SAIT ──────────────────────────
//
// Recensement sur les DEUX racines (§ 9 quattuortrigicenties) : `es-races`,
// `es-race-row`, `es-race-title`, `es-race-drone`, « Courses en vol »,
// `liveRaces`, `racingNodes` — rien. `essaim-castes` tient le badge ⚔ et deux
// des trois branches de `statusLabel`.
//
// Le recensement n'a PAS suffi. Les six mutants posés ensemble ont fait rougir
// `essaim-castes` : l'un d'eux était déjà tenu. Mesurés SÉPARÉMENT contre la
// suite entière (290 fichiers, 4 191 tests) :
//
//     R1  course fantôme            4 191 passés  ← nu
//     R2  titleOf (mauvaise tâche)  4 191 passés  ← nu
//     R3  nameOf  (mauvais nœud)    1 ÉCHEC       ← DÉJÀ TENU
//     R4  statusLabel('succeeded')  4 191 passés  ← nu
//     R5  ICON[status] ?? '?'       4 191 passés  ← nu
//     R6  liveRaces.length > 0      4 191 passés  ← nu
//
// `R3` meurt sur l'`aria-label` d'`essaim-castes` (« ruche-en-vol — en vol »),
// qui nomme le nœud pour l'éprouver. NON REJOUÉ ici : cinq cas, pas six.
//
// C'est le § 9 quattuortrigicenties en action — le recensement disait « nu »
// pour les six, la mesure a dit « non » pour l'un d'eux. Et la mesure ne se
// fait qu'UN PAR UN : posés ensemble, ils s'attribuent mutuellement leurs
// rouges.
//
// ─── LA GARDE QUE LE FICHIER ÉNONCE, ET QUE PERSONNE NE TENAIT ───────────────
//
//     // Les courses vivent en mémoire du hub : si le poll tombe en panne,
//     // races.data est périmé — on éteint le badge plutôt que d'affirmer une
//     // course fantôme.
//     const liveRaces = races.error === null ? (races.data?.races ?? []) : [];
//
// Un commentaire qui explique n'est pas une garde (§ 9 sexvicicenties) — le
// quatrième de cette série. Celui-ci décrit exactement la règle, le mutant, ET
// sa conséquence, et rien ne le jouait.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { HiveNode, StateSnapshot, Task } from '../src/shared/types';

// Les QUATRE sondes de la vue sont bouchées, pas seulement celle qu'on met en
// scène : un bouchon partiel laisse partir au réseau tout ce qu'on n'a pas
// nommé (§ 9 duotrigicenties).
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
}));

import { fetchPheromones, fetchPolyethisme, fetchRaces, fetchWaggle } from '../dashboard/src/api';
import Essaim from '../dashboard/src/views/Essaim';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Drone = { nodeId: string; status: string };
type Course = { taskId: string; factor: number; drones: Drone[] };

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchWaggle)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchPheromones)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchPolyethisme)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchRaces).mockReset();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const noeud = (id: string, name: string): HiveNode =>
  ({
    id,
    name,
    ownerName: 'apicultrice',
    agentType: 'shell',
    maxConcurrency: 2,
    running: 1,
    status: 'online',
    lastSeen: 1,
  }) as HiveNode;

const tache = (id: string, title: string): Task =>
  ({
    id,
    projectId: 'p-1',
    title,
    prompt: 'p',
    status: 'running',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Task;

const NOEUDS = [noeud('n-nord', 'ruche-nord'), noeud('n-sud', 'ruche-sud')];
const TACHES = [
  tache('t-course-0000-1111', 'Poser le toit de la ruche'),
  tache('t-autre-2222-3333', 'Une tout autre besogne'),
];

function proprietes(refreshTick = 0): ViewProps {
  return {
    snapshot: {
      projects: [],
      nodes: NOEUDS,
      tasks: TACHES,
      tasksTotal: TACHES.length,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick,
  } as unknown as ViewProps;
}

/** Monte l'Essaim sur les courses données. */
async function monter(races: Course[]): Promise<HTMLElement> {
  vi.mocked(fetchRaces).mockResolvedValue({ races } as never);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Essaim {...proprietes()} />));
  await act(async () => {});
  return conteneur;
}

/**
 * Refait un tour de sondage sur la MÊME vue montée.
 *
 * `refreshTick` est la dépendance de l'effet de `useApiPoll` : le changer
 * relance `load()`. C'est le seul moyen d'obtenir l'état qui compte ici — une
 * donnée déjà reçue, PUIS une erreur.
 */
async function resonder(): Promise<void> {
  await act(async () => racine?.render(<Essaim {...proprietes(1)} />));
  await act(async () => {});
}

const course = (over: Partial<Course> = {}): Course => ({
  taskId: 't-course-0000-1111',
  factor: 2,
  drones: [
    { nodeId: 'n-nord', status: 'running' },
    { nodeId: 'n-sud', status: 'failed' },
  ],
  ...over,
});

/** La carte « Courses en vol », ou `null` si elle n'est pas à l'écran. */
const carteCourses = (dom: HTMLElement): HTMLElement | null =>
  [...dom.querySelectorAll<HTMLElement>('section.card')].find((s) =>
    (s.querySelector('h2')?.textContent ?? '').includes('Courses en vol'),
  ) ?? null;

const badges = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.es-race-badge'),
];

describe('les courses en vol : ce que la carte ose affirmer', () => {
  it('UNE COURSE S’AFFICHE AVEC SON TITRE ET SES DRONES — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const dom = await monter([course()]);
    const c = carteCourses(dom);

    expect(c, 'la carte des courses n’est pas rendue').not.toBeNull();
    expect(c!.textContent, 'le titre de la tâche disputée manque').toContain(
      'Poser le toit de la ruche',
    );
    expect(badges(dom), 'l’ouvrière dont le drone vole ne porte pas le ⚔').toHaveLength(1);
  });

  it('UN SONDAGE EN PANNE ÉTEINT LA COURSE — un relevé périmé n’est pas une course', async () => {
    // ─── LA COURSE FANTÔME ─────────────────────────────────────────────────
    //
    // Les courses vivent en MÉMOIRE du hub : elles ne survivent pas à son
    // redémarrage, et rien ne les rejoue. Quand le sondage tombe, la dernière
    // réponse reçue reste en mémoire du navigateur — et sans la garde, l'écran
    // continue d'affirmer une course qui, peut-être, n'existe plus depuis des
    // minutes. L'opérateur voit deux drones « en vol » sur une ruche à l'arrêt.
    //
    // C'est le SEUL état qui départage les deux versions : il faut une donnée
    // DÉJÀ REÇUE, puis une erreur. Un montage qui échoue d'emblée laisse
    // `races.data` à `null` et les deux versions rendent alors la même chose.
    const dom = await monter([course()]);
    expect(badges(dom), 'la course n’est pas affichée avant la panne').toHaveLength(1);
    expect(carteCourses(dom), 'la carte manque avant la panne').not.toBeNull();

    // Le hub tombe. La donnée précédente, elle, est toujours là.
    vi.mocked(fetchRaces).mockRejectedValue(new Error('le hub ne répond plus'));
    await resonder();

    expect(
      badges(dom),
      'le ⚔ survit à la panne du sondage — l’écran affirme une course fantôme',
    ).toHaveLength(0);
    expect(
      carteCourses(dom),
      'la carte des courses survit à la panne, garnie d’un relevé périmé',
    ).toBeNull();
  });

  it('LA COURSE PORTE LE TITRE DE SA TÂCHE — pas celui d’une autre', async () => {
    // `snapshot.tasks.find((task) => task.id === taskId)` : inversée, la
    // recherche rend la PREMIÈRE tâche qui n'est pas la bonne. La carte reste
    // parfaitement plausible — un titre, bien formé — et désigne le mauvais
    // travail. C'est la pire forme de faux : celle qui ne se voit pas.
    const dom = await monter([course({ taskId: 't-course-0000-1111' })]);
    const titre = dom.querySelector<HTMLElement>('.es-race-title');

    expect(titre?.textContent, 'la course ne porte pas le titre de sa tâche').toBe(
      'Poser le toit de la ruche',
    );
    expect(
      titre?.textContent,
      'la course porte le titre d’une AUTRE tâche — un faux parfaitement plausible',
    ).not.toContain('Une tout autre besogne');
  });

  it('UNE TÂCHE PURGÉE RESTE LISIBLE — un identifiant écourté vaut mieux que rien', async () => {
    // L'élagueur retire les tâches anciennes ; une course peut leur survivre le
    // temps d'un sondage. Le repli `${taskId.slice(0, 8)}…` garde la ligne
    // lisible plutôt que de rendre « undefined » ou de faire disparaître la
    // course.
    const dom = await monter([course({ taskId: 't-effacee-9999-0000' })]);
    const titre = dom.querySelector<HTMLElement>('.es-race-title');

    expect(titre?.textContent, 'une tâche purgée ne laisse aucun repère').toBe('t-efface…');
  });

  it('LE VAINQUEUR SE DIT « VAINQUEUR » — aucun statut cru ne traverse l’écran', async () => {
    // ─── LA TROISIÈME BRANCHE ──────────────────────────────────────────────
    //
    // Le fichier le dit : « le title/aria porte l'état, l'emoji seul ne suffit
    // ni aux lecteurs d'écran ni aux opérateurs non anglophones ».
    // `essaim-castes` éprouve `running` et `failed` — la branche `succeeded`,
    // celle du drone qui GAGNE, n'était tenue par personne. Sans elle,
    // l'annonce de la victoire est « succeeded », en anglais et en jargon.
    //
    // Et le repli de l'icône dans le même montage : un statut inconnu — un hub
    // d'une autre version — garde un « ? » plutôt que de laisser un blanc à la
    // place de l'emoji.
    const dom = await monter([
      course({
        drones: [
          { nodeId: 'n-nord', status: 'succeeded' },
          { nodeId: 'n-sud', status: 'inconnu-du-tableau' },
        ],
      }),
    ]);

    const drones = [...dom.querySelectorAll<HTMLElement>('.es-race-drone')];
    const etiquettes = drones.map((d) => d.getAttribute('aria-label') ?? '');

    expect(
      etiquettes.some((l) => l.includes('ruche-nord — vainqueur')),
      'la victoire s’annonce en jargon anglais',
    ).toBe(true);
    expect(
      etiquettes.some((l) => l.includes('succeeded')),
      'un statut cru traverse l’écran',
    ).toBe(false);
    expect(
      drones[1]?.textContent,
      'un statut inconnu laisse un blanc à la place de l’emoji',
    ).toContain('?');
  });

  it('SANS COURSE, PAS DE CARTE — zéro PILE est la borne', async () => {
    // ─── LA BORNE À ZÉRO (§ 9 tertrigicenties) ─────────────────────────────
    //
    // `liveRaces.length > 0` et `>= 0` ne diffèrent QU'À ZÉRO : dès qu'une
    // course existe, les deux affichent la carte. Seule la valeur ÉGALE les
    // sépare — et zéro est l'état NORMAL d'une ruche, puisque les courses de
    // drones sont optionnelles et rares.
    //
    // Muté, chaque ruche porte en permanence un « ⚔ Courses en vol — 0 » vide :
    // une colonne encombrée par une fonctionnalité que la plupart n'utilisent
    // pas.
    const dom = await monter([]);

    expect(carteCourses(dom), 'une ruche sans course affiche quand même la carte, vide').toBeNull();
    expect(badges(dom), 'un ⚔ apparaît sans course').toHaveLength(0);
    // La vue, elle, reste entière.
    expect(dom.textContent, 'la vue Essaim a disparu avec la carte').toContain('Waggle Board');
  });
});
