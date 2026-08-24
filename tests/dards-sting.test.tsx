// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES DARDS STING — deux tâches qui vont se piquer, et à quel point.
//
// ─── CE QUE CE PANNEAU SERT À DÉCIDER ────────────────────────────────────────
//
// Sting compare les tâches AVANT la coulée et signale celles qui touchent au
// même endroit. L'opérateur s'en sert pour trancher : on fusionne quand même,
// ou on sépare le travail d'abord. Cette décision se prend sur **la gravité**,
// et sur rien d'autre — deux tâches se croisent presque toujours quelque part.
//
//     {c.severity === 'high'
//       ? t('⚡ sévérité haute', '⚡ high severity')
//       : t('· sévérité faible', '· low severity')}
//
// Échangée, la ligne ne casse rien : elle continue de nommer les deux tâches et
// de lister les fichiers. Elle inverse seulement le conseil. On fusionne un
// conflit fort en croyant le savoir faible — et l'inverse, on sépare un travail
// qui n'en avait pas besoin.
//
// `miellerie-revue` défend la même bascule dans la MIELLERIE. Celle-ci vit dans
// la vue Projets, sur un autre composant, et n'était pas gardée : un contrat
// tenu à un endroit ne l'est pas ailleurs (§ 9 quinvicicenties — quand on
// trouve une instance, on compte ses frères).
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Quatre mutants posés ensemble, chacun vérifié posé, suite entière verte —
// 281 fichiers, 4 145 tests.
//
//     c.severity === 'high' ? … : …          →  !== 'high'
//     className={`pj-sting ${c.severity}`}   →  `pj-sting low`
//     conflicts.length === 0 && (…)          →  === -1   (plus d'état vide)
//     c.sharedPaths.length > 0 && (…)        →  >= 0

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot, Task } from '../src/shared/types';
import type { Conflict } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchReport: vi.fn(() => Promise.resolve(null)),
  fetchConseils: vi.fn(() => Promise.resolve({ conseils: [] })),
  fetchConseil: vi.fn(() => Promise.reject(new Error('aucune session simulée'))),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'c-1' })),
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
  // Sondes des ENFANTS, pas de la vue (§ 9 duotrigicenties).
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  fetchGardeFou: vi.fn(() => Promise.resolve(null)),
  postReview: vi.fn(() => Promise.resolve()),
}));

import { fetchConflicts } from '../dashboard/src/api';
import Projets from '../dashboard/src/views/Projets';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
  vi.mocked(fetchConflicts).mockResolvedValue({ conflicts: [] } as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

const tache = (id: string, titre: string): Task =>
  ({
    id,
    projectId: 'p-1',
    title: titre,
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

const dard = (severity: Conflict['severity'], over: Partial<Conflict> = {}): Conflict => ({
  a: 't-lecture',
  b: 't-ecriture',
  severity,
  sharedPaths: ['src/ruche.ts'],
  sharedTerms: [],
  ...over,
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [{ id: 'p-1', name: 'Rucher', repoUrl: null }],
      nodes: [],
      tasks: [tache('t-lecture', 'Lire le nectar'), tache('t-ecriture', 'Écrire le miel')],
      tasksTotal: 2,
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

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Ouvre le panneau des dards, sur les conflits donnés. */
async function ouvrirLesDards(conflicts: Conflict[]): Promise<HTMLElement> {
  vi.mocked(fetchConflicts).mockResolvedValue({ conflicts } as never);
  const dom = await monter();
  const b = [...dom.querySelectorAll('button')].find((e) =>
    (e.textContent ?? '').includes('Conflits Sting'),
  );
  if (!b) throw new Error('le bouton des Conflits Sting est introuvable');
  await cliquer(b as HTMLElement);
  return dom;
}

/** Les dards affichés, dans l'ordre. */
const dards = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.pj-sting'),
];

describe('les dards Sting disent à quel point ça pique', () => {
  it('UN DARD S’AFFICHE AVEC SES DEUX TÂCHES — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Sans lui, « la gravité ne s'échange pas » serait vert sur un panneau qui
    // ne rend aucun dard : on comparerait deux absences.
    const dom = await ouvrirLesDards([dard('high')]);

    expect(dards(dom), 'aucun dard rendu').toHaveLength(1);
    const d = dards(dom)[0]!;
    expect(d.textContent, 'la première tâche n’est pas nommée').toContain('Lire le nectar');
    expect(d.textContent, 'la seconde tâche n’est pas nommée').toContain('Écrire le miel');
    expect(d.textContent, 'le fichier partagé n’est pas dit').toContain('src/ruche.ts');
  });

  it('UN DARD FORT NE S’ANNONCE JAMAIS « FAIBLE » — ni l’inverse', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // C'est la seule chose sur laquelle l'opérateur tranche : deux tâches se
    // croisent presque toujours quelque part, la question est de savoir si ça
    // compte. Échangée, la ligne ne casse rien — elle inverse le conseil.
    //
    // On mesure les DEUX gravités dans le même cas : un banc qui n'en
    // regarderait qu'une resterait vert sur l'échange, puisqu'il y a toujours
    // un libellé affiché.
    const dom = await ouvrirLesDards([
      dard('high'),
      dard('low', { a: 't-ecriture', b: 't-lecture' }),
    ]);

    const [fort, faible] = dards(dom);
    expect(fort!.textContent, 'le dard FORT ne s’annonce pas haut').toContain('sévérité haute');
    expect(fort!.textContent, 'le dard fort s’annonce AUSSI faible').not.toContain(
      'sévérité faible',
    );
    expect(faible!.textContent, 'le dard FAIBLE ne s’annonce pas faible').toContain(
      'sévérité faible',
    );
  });

  it('L’HABIT SUIT LA GRAVITÉ — le mot seul ne suffit pas à l’œil', async () => {
    // La classe porte la couleur. Figée, tous les dards se peignent pareil :
    // le texte reste juste, mais l'écran ne trie plus rien au premier regard —
    // et c'est ainsi qu'on lit ce panneau, en le survolant.
    const dom = await ouvrirLesDards([
      dard('high'),
      dard('low', { a: 't-ecriture', b: 't-lecture' }),
    ]);

    const [fort, faible] = dards(dom);
    expect(fort!.className, 'le dard fort ne porte pas son habit').toContain('high');
    expect(faible!.className, 'le dard faible porte l’habit du fort').not.toContain('high');
  });

  it('AUCUN DARD SE DIT — le silence n’est pas une réponse', async () => {
    // ─── L'AUTRE MONDE (§ 9 octovicicenties) ───────────────────────────────
    //
    // Une liste vide et une détection qui n'a pas répondu donnent le même
    // écran : rien. Le message distingue les deux, et c'est lui qui autorise à
    // fusionner l'esprit tranquille.
    const dom = await ouvrirLesDards([]);

    expect(dards(dom), 'des dards apparaissent sur une liste vide').toHaveLength(0);
    expect(dom.textContent, 'l’absence de conflit ne se dit pas').toContain('Aucun dard en vue');
  });

  it('UN DÉTAIL VIDE NE LAISSE PAS SON ÉTIQUETTE PENDRE', async () => {
    // ─── LA BORNE (§ 9 trigicenties) ───────────────────────────────────────
    //
    // `sharedPaths.length > 0` muté en `>= 0` affiche « fichiers : » suivi de
    // rien, sur TOUS les dards. Les cas de sens ne le voient pas : avec un
    // fichier, les deux versions affichent la même chose. Il faut un dard qui
    // n'en partage AUCUN — c'est le cas d'un conflit détecté sur les seuls
    // termes.
    const dom = await ouvrirLesDards([
      dard('low', { sharedPaths: [], sharedTerms: ['calculerLeMiel'] }),
    ]);

    const d = dards(dom)[0]!;
    expect(d.textContent, 'le terme partagé n’est pas dit').toContain('calculerLeMiel');
    expect(d.textContent, 'une étiquette « fichiers : » pend sans rien derrière').not.toContain(
      'fichiers',
    );
  });
});
