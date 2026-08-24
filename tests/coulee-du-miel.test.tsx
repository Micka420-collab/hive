// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA COULÉE DU MIEL — suivre une fusion RÉELLE lancée sur un nœud.
//
// ─── CE QUE CE PANNEAU FAIT VRAIMENT ─────────────────────────────────────────
//
// « Lancer le merge » n'ouvre pas un aperçu : il déclenche une fusion réelle sur
// une machine, derrière une confirmation. Le panneau relève ensuite le résultat
// toutes les 3 s et abandonne au bout de 2 min.
//
//     const id = window.setInterval(() => {
//       if (Date.now() - since > MERGE_TIMEOUT_MS) { … setRun({ phase: 'timeout' }); return; }
//       fetchMergeResult(project.id).then(({ result }) => {
//         if (!alive || !result || result.mergeId !== mergeId) return;
//         …
//
// `projets-alveoles` défend l'affichage du rapport une fois la coulée rendue.
// La MACHINE qui mène jusque-là — la confirmation, l'identité du relevé, le
// délai — n'était jouée nulle part.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Trois mutants posés ensemble, chacun vérifié posé, suite entière verte —
// 280 fichiers, 4 141 tests.
//
//     result.mergeId !== mergeId                →  (l'identité n'est plus vérifiée)
//     Date.now() - since > MERGE_TIMEOUT_MS     →  if (false)  (plus d'abandon)
//     s.trim() ? s.trim().split(…) : undefined  →  s.trim().split(…)
//
// ─── POURQUOI L'IDENTITÉ DU RELEVÉ EST LA PLUS CHÈRE ─────────────────────────
//
// `fetchMergeResult` rend LA DERNIÈRE coulée du projet, pas la nôtre. Sans le
// test d'identité, la coulée qu'on vient de lancer affiche le verdict de la
// PRÉCÉDENTE — souvent un succès, puisque c'est celle qui a fini. On lit « ✔
// fusionné » sur une fusion qui tourne encore, et l'on part sur cette foi.
//
// C'est la famille du § 9 novemvicicenties, cette fois DANS le produit : le bon
// écran, la bonne mise en page, le mauvais SUJET.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot, Task } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchReport: vi.fn(() => Promise.resolve(null)),
  fetchConseils: vi.fn(() => Promise.resolve({ conseils: [] })),
  fetchConseil: vi.fn(() => Promise.reject(new Error('aucune session simulée'))),
  fetchMergePlan: vi.fn(() => Promise.resolve(null)),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'coulée-en-cours' })),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchProjetsOuverts: vi.fn(() => Promise.resolve({ projets: [] })),
  fetchDepotsGithub: vi.fn(() => Promise.resolve({ depots: [] })),
  fetchMembresProjet: vi.fn(() => Promise.resolve({ membres: [] })),
  fetchPartages: vi.fn(() => Promise.resolve({ partages: [] })),
  fetchIssues: vi.fn(() => Promise.resolve({ issues: [] })),
  fetchLivraisons: vi.fn(() => Promise.resolve({ livraisons: [] })),
  fetchEssaim: vi.fn(() => Promise.resolve(null)),
  fetchProjectBalance: vi.fn(() => Promise.resolve(null)),
  planBrief: vi.fn(() => Promise.resolve({ tasks: [], source: 'heuristic' })),
  addTasks: vi.fn(() => Promise.resolve([])),
  // Sondes des ENFANTS, pas de la vue (§ 9 duotrigicenties) : sans elles,
  // `importOriginal` les laisse partir pour de bon vers le port 3000.
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  fetchGardeFou: vi.fn(() => Promise.resolve(null)),
  postReview: vi.fn(() => Promise.resolve()),
}));

import { fetchMergePlan, fetchMergeResult, runMerge } from '../dashboard/src/api';
import Projets from '../dashboard/src/views/Projets';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Ce que le produit annonce, et ce que le banc doit respecter. */
const BATTEMENT_MS = 3_000;
const DELAI_MS = 120_000;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // 134 vraies connexions vers 127.0.0.1:3000 par lancement, mesurées. Voir
  // `tests/aide/sans-reseau.ts` pour le pourquoi — et pourquoi on REJETTE
  // plutôt que de répondre : la sémantique reste celle d'aujourd'hui, seule la
  // socket disparaît.
  couperLeReseau();
  setLang('fr');
  vi.useFakeTimers();
  vi.mocked(fetchMergePlan).mockResolvedValue({
    total: 1,
    done: 1,
    mergeable: true,
    order: ['t-1'],
    conflicts: [],
  } as never);
  vi.mocked(fetchMergeResult).mockResolvedValue({ result: null } as never);
  vi.mocked(runMerge).mockResolvedValue({ mergeId: 'coulée-en-cours' } as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

const tache = (id: string): Task =>
  ({
    id,
    projectId: 'p-1',
    title: `Tâche ${id}`,
    prompt: 'p',
    status: 'done',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 1_000,
  }) as unknown as Task;

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [{ id: 'p-1', name: 'Rucher', repoUrl: null }],
      nodes: [],
      tasks: [tache('t-1')],
      tasksTotal: 1,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Projets {...props} />));
  await act(async () => {});
  return document.body;
}

/** Un relevé de coulée, à la forme que `MergeReport` sait rendre. */
const releve = (mergeId: string) => ({
  mergeId,
  applied: ['t-1'],
  conflicts: [],
  mergedDiff: '',
  testsRun: false,
  testsPassed: null,
  preparedOk: null,
  logs: '',
});

/** Un bouton désigné par son libellé — jamais par son rang. */
function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((e) =>
    (e.textContent ?? '').includes(libelle),
  );
  if (!b) throw new Error(`bouton « ${libelle} » introuvable`);
  return b as HTMLButtonElement;
}

const boutonOuNull = (dom: HTMLElement, libelle: string): HTMLButtonElement | null =>
  ([...dom.querySelectorAll('button')].find((e) =>
    (e.textContent ?? '').includes(libelle),
  ) as HTMLButtonElement) ?? null;

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Ouvre le panneau de fusion du projet. */
async function ouvrirLePlan(): Promise<HTMLElement> {
  const dom = await monter();
  await cliquer(bouton(dom, 'Plan de merge'));
  return dom;
}

/** Confirme et lance la coulée : c'est un geste en DEUX temps. */
async function lancerLaCoulee(dom: HTMLElement): Promise<void> {
  await cliquer(bouton(dom, 'Lancer le merge'));
  await cliquer(bouton(dom, 'Confirmer'));
}

/** Fait battre l'horloge du suivi, en respectant le rythme du produit. */
async function battre(fois: number): Promise<void> {
  for (let i = 0; i < fois; i++) {
    await act(async () => {
      vi.advanceTimersByTime(BATTEMENT_MS);
    });
    await act(async () => {});
  }
}

describe('la coulée du miel : lancer, puis suivre', () => {
  it('LA COULÉE SE LANCE EN DEUX TEMPS — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Il éprouve la confirmation, qui n'est pas décorative : « Lancer le
    // merge » déclenche une fusion RÉELLE sur une machine. Un seul clic
    // suffirait sans elle.
    //
    // Et sans ce cas, tous les suivants seraient verts en constatant l'absence
    // d'un suivi qui n'aurait jamais démarré.
    const dom = await ouvrirLePlan();

    await cliquer(bouton(dom, 'Lancer le merge'));
    expect(runMerge, 'un seul clic a suffi à lancer une fusion réelle').not.toHaveBeenCalled();
    expect(dom.textContent, 'la confirmation ne s’annonce pas').toContain('confirmer');

    await cliquer(bouton(dom, 'Confirmer'));
    expect(runMerge, 'la confirmation ne lance rien').toHaveBeenCalledTimes(1);
    expect(dom.querySelector('.pj-busy'), 'le suivi ne s’affiche pas').not.toBeNull();
  });

  it('UNE COMMANDE VIDE N’EST PAS UNE COMMANDE VIDE-MAIS-PRÉSENTE', async () => {
    // ─── `argv` ────────────────────────────────────────────────────────────
    //
    // Les deux champs sont OPTIONNELS. Laissés vides, ils doivent partir
    // `undefined` — pas `['']`. Un tableau contenant la chaîne vide est une
    // commande : le nœud tenterait d'exécuter un programme sans nom, et le
    // verdict se lirait « tests cassés » sur un projet qui n'en demandait pas.
    const dom = await ouvrirLePlan();
    await lancerLaCoulee(dom);

    const options = vi.mocked(runMerge).mock.calls[0]?.[1] as {
      testCommand?: unknown;
      prepareCommand?: unknown;
    };
    expect(options.testCommand, 'un champ vide part comme une commande').toBeUndefined();
    expect(options.prepareCommand, 'un champ vide part comme une commande').toBeUndefined();
  });

  it('LE VERDICT D’UNE AUTRE COULÉE N’EST JAMAIS AFFICHÉ COMME LE SIEN', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // `fetchMergeResult` rend LA DERNIÈRE coulée du projet, pas la nôtre. Le
    // relevé qui arrive pendant notre suivi peut donc appartenir à la fusion
    // PRÉCÉDENTE — souvent un succès, puisque c'est celle qui a fini.
    //
    // Sans le test d'identité, on lit « ✔ fusionné » sur une coulée qui tourne
    // encore, et l'on part sur cette foi. Le bon écran, la bonne mise en page,
    // le mauvais SUJET.
    const dom = await ouvrirLePlan();
    await lancerLaCoulee(dom);

    // Le relevé d'AVANT, avec son propre identifiant.
    vi.mocked(fetchMergeResult).mockResolvedValue({
      result: releve('coulée-precedente'),
    } as never);
    await battre(2);

    expect(
      dom.querySelector('.pj-busy'),
      'le suivi s’est arrêté sur le verdict d’une AUTRE coulée',
    ).not.toBeNull();

    // Et le nôtre, quand il arrive enfin, est bien pris.
    vi.mocked(fetchMergeResult).mockResolvedValue({
      result: releve('coulée-en-cours'),
    } as never);
    await battre(2);

    expect(
      dom.querySelector('.pj-busy'),
      'notre propre verdict n’arrête pas le suivi — le panneau tournerait sans fin',
    ).toBeNull();
  });

  it('APRÈS DEUX MINUTES SANS RÉPONSE, LE SUIVI ABANDONNE ET LE DIT', async () => {
    // ─── L'ABANDON ─────────────────────────────────────────────────────────
    //
    // Un nœud qui tombe pendant la fusion ne répond plus jamais. Sans
    // l'abandon, le panneau affiche « Merge en cours sur le nœud… » pour
    // toujours : aucun message, aucun moyen de relancer — les deux boutons
    // sont masqués tant que `busyRun` est vrai.
    const dom = await ouvrirLePlan();
    await lancerLaCoulee(dom);
    expect(dom.querySelector('.pj-busy'), 'le suivi n’a pas démarré').not.toBeNull();

    // ─── LA BORNE, À LA MILLISECONDE (§ 9 trigicenties) ──────────────────
    //
    // Exactement DELAI_MS écoulés — pas 1 min 57. Le produit dit « > », donc à
    // 2 min PILE on attend encore ; c'est le battement SUIVANT qui abandonne.
    //
    // Ce cas est né d'un survivant : le rejeu de `>` → `>=` restait vert tant
    // que le banc s'arrêtait à 1 min 57, parce que les deux versions attendent
    // encore à cet instant-là. Seule la milliseconde exacte les départage — et
    // il a fallu que l'horloge n'avance QUE par pas contrôlés (`useFakeTimers`
    // sans `shouldAdvanceTime`) pour qu'on puisse la viser.
    await battre(DELAI_MS / BATTEMENT_MS);
    expect(
      dom.querySelector('.pj-busy'),
      'le suivi a lâché À la borne : le délai annoncé est plus court d’un battement',
    ).not.toBeNull();

    // Puis au-delà : un seul battement de plus.
    await battre(1);
    expect(dom.querySelector('.pj-busy'), 'le suivi tourne encore après 2 min').toBeNull();
    expect(dom.textContent, 'l’abandon ne dit pas quoi faire').toContain('Pas de résultat');
    expect(
      boutonOuNull(dom, 'Lancer le merge'),
      'après l’abandon, on ne peut pas relancer',
    ).not.toBeNull();
  });
});
