// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA COULÉE, VUE DE LA MIELLERIE — l'identité du relevé, et l'armement qui retombe.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage de la loupe sur `dashboard/src/views/Miellerie.tsx`, base épinglée
// dans l'atelier (`LOUPE_BASE=e93b252` — le PARENT du commit qui a créé le
// fichier, donc le diff couvre les 1173 lignes ; `f0fc005` n'en montrait que
// 358, le fichier y existait déjà) :
//
//     126 candidates, 12 examinées — 8 défendues, 4 SANS TEST
//     114 laissées de côté : la loupe échantillonne, elle ne balaie pas
//
// ─── LA MÊME GARDE EXISTE DEUX FOIS, ET UNE SEULE ÉTAIT TENUE ────────────────
//
// C'est la trouvaille du lot. Le suivi d'une fusion réelle est écrit DEUX fois,
// dans deux vues, avec le même piège et le même remède :
//
//     Projets.tsx:394   if (!alive || !result || result.mergeId !== mergeId) return;
//     Miellerie.tsx:738 if (alive && result && result.mergeId === mergeId) setMerge(…)
//
// `tests/coulee-du-miel.test.tsx` défend la PREMIÈRE, et son en-tête énonce
// exactement le danger : « `fetchMergeResult` rend LA DERNIÈRE coulée du projet,
// pas la nôtre ». La seconde n'avait rien. Le raisonnement était écrit, la garde
// jumelle était nue — § 9 sexvicicenties, encore : un auteur qui a vu le danger
// s'arrête parfois à la phrase.
//
// Inversée, la Miellerie refuse le résultat de SA PROPRE coulée et accepte celui
// de n'importe quelle autre : l'utilisateur lit le verdict d'une fusion
// précédente comme si c'était le sien, ou attend deux minutes pour rien.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot, Task } from '../src/shared/types';

// Les sondes de la vue sont TOUTES bouchées, pas seulement celles qu'on met en
// scène : un bouchon partiel laisse partir au réseau ce qu'on n'a pas nommé
// (§ 9 duotrigicenties).
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'coulée-à-nous' })),
  postReview: vi.fn(() => Promise.resolve()),
}));

import { fetchConsensus, fetchMergeResult, fetchResults, runMerge } from '../dashboard/src/api';
import Miellerie from '../dashboard/src/views/Miellerie';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

function tache(id: string, projectId: string): Task {
  return {
    id,
    projectId,
    title: `alvéole ${id}`,
    prompt: 'p',
    status: 'done',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 1,
  } as unknown as Task;
}

function instantane(): StateSnapshot {
  const tasks = [tache('t1', 'p1')];
  return {
    projects: [{ id: 'p1', name: 'Rucher', repoUrl: null }],
    nodes: [],
    tasks,
    tasksTotal: tasks.length,
  } as unknown as StateSnapshot;
}

function proprietes(): ViewProps {
  return {
    snapshot: instantane(),
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    selectedId: 'p1',
    onOpenTask: () => {},
    onNavigate: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
}

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Miellerie {...proprietes()} />));
  await act(async () => {});
  return conteneur;
}

/** Le bouton de coulée, quel que soit l'état où il se trouve. */
function boutonCoulee(dom: HTMLElement): HTMLButtonElement {
  const b = dom.querySelector<HTMLButtonElement>('button.mi-pour');
  if (!b) {
    const tous = [...dom.querySelectorAll('button')].map((x) => `« ${x.textContent?.trim()} »`);
    throw new Error(`bouton « .mi-pour » introuvable — présents : ${tous.join(', ')}`);
  }
  return b;
}

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Arme puis confirme — le double geste que la vue exige avant de fondre. */
async function lancerLaCoulee(dom: HTMLElement): Promise<void> {
  await cliquer(boutonCoulee(dom));
  await cliquer(boutonCoulee(dom));
  await act(async () => {});
}

/**
 * Un rapport de coulée, dans la forme RÉELLE de `MergeRunResult`.
 *
 * La première version inventait un champ `merged` là où la vue lit `applied`, et
 * le cas nominal est mort en `TypeError` au rendu — pas en rougissant sur ce
 * qu'il visait. Un monde qui ne peut pas exister ne mesure rien
 * (§ 9 quintrigicenties : un mutant, ou un décor, qui fait PLANTER ne prouve
 * pas la distinction). Les champs sont donc recopiés du contrat, pas devinés.
 */
const RESULTAT = (mergeId: string) =>
  ({
    mergeId,
    applied: ['t1'],
    conflicts: [],
    mergedDiff: '',
    testsRun: false,
    testsPassed: null,
    logs: `journal de ${mergeId}`,
  }) as never;

beforeEach(() => {
  setLang('fr');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(runMerge)
    .mockReset()
    .mockResolvedValue({ mergeId: 'coulée-à-nous' } as never);
  vi.mocked(fetchMergeResult)
    .mockReset()
    .mockResolvedValue({ result: null } as never);
  vi.mocked(fetchResults)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(fetchConsensus)
    .mockReset()
    .mockResolvedValue(null as never);
});

/** Une faction du parlement, dans la forme réelle de `Faction`. */
const faction = (signature: string, votes: number) => ({
  signature,
  votes,
  nodeIds: Array.from({ length: votes }, (_, i) => `n${i}`),
  agentTypes: ['shell'],
  diversity: 1,
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.useRealTimers();
});

describe('la coulée de la Miellerie : le relevé doit être LE NÔTRE', () => {
  it('LE RÉSULTAT DE NOTRE COULÉE S’AFFICHE — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ───────────────
    const dom = await monter();
    vi.mocked(fetchMergeResult).mockResolvedValue({ result: RESULTAT('coulée-à-nous') } as never);

    await lancerLaCoulee(dom);

    expect(dom.textContent, 'le rapport de notre coulée ne s’affiche pas').toContain(
      'journal de coulée-à-nous',
    );
  });

  it('LE RÉSULTAT D’UNE AUTRE COULÉE EST IGNORÉ — on n’affiche pas le verdict du voisin', async () => {
    // `fetchMergeResult` rend LA DERNIÈRE coulée du projet, pas la nôtre : après
    // un lancement, l'ancienne est encore ce que la route renvoie. Sans la garde
    // d'identité, la Miellerie annoncerait « fusion terminée » sur le rapport de
    // quelqu'un d'autre, avec sa branche et ses fichiers.
    const dom = await monter();
    vi.mocked(fetchMergeResult).mockResolvedValue({ result: RESULTAT('coulée-d-avant') } as never);

    await lancerLaCoulee(dom);

    expect(dom.textContent, 'le rapport d’une AUTRE coulée a été affiché').not.toContain(
      'journal de coulée-d-avant',
    );
    // Et la vue reste franche : elle dit qu'elle attend, elle ne se tait pas.
    expect(dom.textContent, 'la vue n’annonce plus rien pendant l’attente').toContain(
      'Fusion en cours',
    );
  });

  it('LE COMPTE DU DIFF NE PREND PAS L’EN-TÊTE POUR UNE LIGNE AJOUTÉE', async () => {
    // `lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'))`.
    //
    // Un diff unifié commence chaque fichier par `--- a/x` et `+++ b/x`. Ces
    // en-têtes COMMENCENT par le bon signe sans être des lignes de code : sans
    // le second terme, chaque fichier gagne un ajout et un retrait fantômes.
    //
    // Le cas est écrit sur un diff où le vrai compte (1 ajout, 1 retrait) et le
    // compte muté (2 et 2) sont DIFFÉRENTS — sur un fichier à zéro modification
    // réelle, les deux rendraient « +1 » et le cas ne distinguerait rien
    // (§ 9 octoquadragicenties, la version « valeur qui coïncide par hasard »).
    const diff = [
      'diff --git a/miel.txt b/miel.txt',
      'index 111..222 100644',
      '--- a/miel.txt',
      '+++ b/miel.txt',
      '@@ -1 +1 @@',
      '-de la cire',
      '+du miel',
    ].join('\n');
    vi.mocked(fetchResults).mockResolvedValue([
      { taskId: 't1', nodeId: 'n1', success: true, diff, logs: '', durationMs: 5, subAgents: [] },
    ] as never);

    const dom = await monter();

    const ajouts = [...dom.querySelectorAll('.mi-add-stat')].map((e) => e.textContent);
    const retraits = [...dom.querySelectorAll('.mi-del-stat')].map((e) => e.textContent);
    expect(ajouts.length, 'le panneau de diff ne s’est pas rendu').toBeGreaterThan(0);
    expect(ajouts, 'l’en-tête « +++ » est compté comme une ligne ajoutée').toEqual(
      Array(ajouts.length).fill('+1'),
    );
    expect(retraits, 'l’en-tête « --- » est compté comme une ligne retirée').toEqual(
      Array(retraits.length).fill('−1'),
    );
  });

  it('LA COURONNE NE SE POSE QUE SUR LA FACTION ÉLUE', async () => {
    // `verdict.winner?.signature === f.signature && (<span>👑 Élu</span>)`.
    //
    // Muté en `||`, la couronne se pose sur TOUTES les factions : l'écran
    // désigne comme élue une sortie qui a perdu le vote, et l'utilisateur
    // fusionne le mauvais code en croyant suivre le parlement.
    //
    // Le cas exige donc UNE couronne, et sur la BONNE : compter seulement
    // « il y en a au moins une » laisserait le mutant vert (§ 9 quinquadragicenties,
    // vérifier D'OÙ vient le verdict, pas seulement qu'il existe).
    const gagnante = faction('sig-gagnante', 2);
    vi.mocked(fetchConsensus).mockResolvedValue({
      outcome: 'elected',
      winner: gagnante,
      factions: [gagnante, faction('sig-perdante', 1)],
      quorum: 2,
      surfaces: [],
      sansSurface: 0,
    } as never);

    const dom = await monter();
    const onglets = [...dom.querySelectorAll('button')];
    const consensus = onglets.find((b) => b.textContent?.trim() === 'Consensus');
    expect(consensus, 'l’onglet Consensus est introuvable').toBeTruthy();
    await cliquer(consensus!);

    const couronnes = [...dom.querySelectorAll('.mi-elected')];
    expect(couronnes, 'la couronne se pose sur plus d’une faction').toHaveLength(1);

    // Et sur la bonne : la couronne doit vivre dans l'entrée de la GAGNANTE.
    const entree = couronnes[0]?.closest('li');
    expect(entree?.textContent, 'la couronne est posée sur la faction perdante').toContain(
      'sig-gagnante',
    );
  });

  it('L’ARMEMENT RETOMBE APRÈS 3 s — une confirmation oubliée ne coule pas plus tard', async () => {
    // Le premier clic ARME, le second confirme. Si l'armement ne retombait pas,
    // un clic oublié laisserait le bouton confirmable indéfiniment : le geste
    // suivant, des minutes après, lancerait une fusion réelle que personne ne
    // vient de demander.
    const dom = await monter();

    await cliquer(boutonCoulee(dom));
    expect(boutonCoulee(dom).textContent, 'le premier clic n’arme pas').toContain('Confirmer');

    await act(async () => {
      vi.advanceTimersByTime(3_100);
    });

    expect(
      boutonCoulee(dom).textContent,
      'l’armement ne retombe pas : un clic oublié reste confirmable',
    ).toContain('Couler le miel');
    expect(runMerge, 'une fusion est partie sans confirmation').not.toHaveBeenCalled();
  });
});
