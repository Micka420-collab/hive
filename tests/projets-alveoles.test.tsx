// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES PROJETS, RENDUS — la porte de l'atelier, le rapport de merge qui ne
// s'affiche qu'une fois RENDU, et l'étoile du Conseil sur la bonne danse.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu TROIS survivantes dans cette vue :
//
//   · `disabled={busy !== 'idle' || brief.trim().length < 8}` — mutée, le
//     bouton « Proposer un plan » serait MORT au repos (brief valide compris)
//     et vivant pendant que la reine réfléchit ;
//   · `{run.phase === 'done' && <MergeReport …>}` — mutée, le rapport se
//     rendrait AVANT d'exister (`result` indéfini : l'écran casse) et se
//     tairait une fois le merge rendu ;
//   · `d.id === session.retenue` (la classe) — mutée, l'habit de « retenue »
//     irait aux danses battues, et la retenue passerait pour contestée.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateSnapshot, Task } from '../src/shared/types';
import type { DanseConseil, SessionConseil } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchReport: vi.fn(() => Promise.resolve(null)),
  fetchConseils: vi.fn(() => Promise.resolve({ conseils: [] })),
  fetchConseil: vi.fn(() => Promise.reject(new Error('aucune session simulée'))),
  fetchMergePlan: vi.fn(() =>
    Promise.resolve({ total: 1, done: 1, mergeable: true, order: ['t-fusionnee'], conflicts: [] }),
  ),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'coulée-p' })),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchProjetsOuverts: vi.fn(() => Promise.resolve({ projets: [] })),
  fetchDepotsGithub: vi.fn(() => Promise.resolve({ depots: [] })),
  fetchMembresProjet: vi.fn(() => Promise.resolve({ membres: [] })),
  fetchPartages: vi.fn(() => Promise.resolve({ partages: [] })),
  fetchIssues: vi.fn(() => Promise.resolve({ issues: [] })),
  fetchLivraisons: vi.fn(() => Promise.resolve({ livraisons: [] })),
  planBrief: vi.fn(() => Promise.resolve({ tasks: [], source: 'heuristic' })),
  // Sondes des sous-composants embarqués (PleinEssaim, Balance) : sans elles,
  // un VRAI fetch part vers le port 3000 et le banc bruisse d'ECONNREFUSED.
  fetchEssaim: vi.fn(() => Promise.resolve(null)),
  fetchProjectBalance: vi.fn(() => Promise.resolve(null)),
}));

import {
  fetchBalance,
  fetchConseil,
  fetchConseils,
  fetchDepotsGithub,
  fetchMergeResult,
  runMerge,
} from '../dashboard/src/api';
import Projets from '../dashboard/src/views/Projets';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(runMerge).mockClear();
  vi.mocked(fetchMergeResult).mockClear().mockResolvedValue({ result: null });
  vi.mocked(fetchConseils).mockReset().mockResolvedValue({ conseils: [] });
  vi.mocked(fetchConseil).mockReset().mockRejectedValue(new Error('aucune session simulée'));
  vi.mocked(fetchBalance)
    .mockReset()
    .mockResolvedValue(null as never);
});
afterEach(() => {
  vi.useRealTimers();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function tache(id: string, titre: string): Task {
  return {
    id,
    projectId: 'p1',
    title: titre,
    prompt: 'p',
    status: 'done',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 1,
  };
}

function instantane(tasks: Task[]): StateSnapshot {
  return {
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
    ],
    nodes: [],
    tasks,
    tasksTotal: tasks.length,
  } as unknown as StateSnapshot;
}

async function monter(snapshot: StateSnapshot): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot,
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
  return conteneur;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(libelle),
  );
  expect(b, `bouton « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

/** Frappe dans un champ contrôlé par React : valeur native + événement input. */
function taper(champ: HTMLTextAreaElement, texte: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(champ) as object,
      'value',
    )?.set;
    setter?.call(champ, texte);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function danse(id: string, titre: string, over: Partial<DanseConseil> = {}): DanseConseil {
  return {
    id,
    titre,
    corps: '',
    sources: [],
    eclaireuse: 'e1',
    famille: 'claude',
    qualite: 0.8,
    intensite: 1,
    soutiens: [],
    arrets: [],
    familles: ['claude'],
    quorum: false,
    autoSoutienIgnore: false,
    raisons: [],
    ...over,
  };
}

describe('les Projets — les trois survivantes du balayage', () => {
  it('LA PORTE DE L’ATELIER : morte sur un brief trop court, vivante au repos sur un brief valide', async () => {
    // `busy !== 'idle' || brief < 8` mutée en `===` : le bouton serait MORT au
    // repos — brief valide compris — et vivant pendant le travail. Les deux
    // moitiés de la frontière se vérifient sur le MÊME rendu.
    const dom = await monter(instantane([]));
    const brief = dom.querySelector('.pj-brief') as HTMLTextAreaElement;
    expect(brief, 'l’atelier doit offrir son brief').toBeTruthy();
    const proposer = bouton(dom, 'Proposer un plan');

    taper(brief, 'court');
    expect(proposer.disabled, 'sept caractères ne font pas un brief').toBe(true);

    taper(brief, 'Une API de sondages avec authentification');
    expect(proposer.disabled, 'un brief valide au repos ouvre la porte').toBe(false);
  });

  it('LE RAPPORT DE MERGE NE S’AFFICHE QU’UNE FOIS LE MERGE RENDU', async () => {
    // `run.phase === 'done'` mutée en `!==` : le rapport se rendrait dès le
    // repos avec un `result` indéfini — l'écran casse — et se tairait au
    // moment précis où il a quelque chose à dire.
    vi.useFakeTimers();
    const dom = await monter(instantane([tache('t-fusionnee', 'Tâche fusionnée')]));

    cliquer(bouton(dom, '⬡ Plan de merge'));
    await act(async () => {});
    expect(dom.textContent).toContain('1/1 tâche(s) terminée(s)');
    expect(dom.textContent, 'aucun rapport avant le lancement').not.toContain(
      'diff(s) appliqué(s)',
    );

    cliquer(bouton(dom, 'Lancer le merge'));
    cliquer(bouton(dom, 'Confirmer'));
    await act(async () => {});
    expect(vi.mocked(runMerge)).toHaveBeenCalled();
    expect(dom.textContent).toContain('Merge en cours sur le nœud…');

    // Le nœud rend son résultat au prochain battement de la scrutation.
    vi.mocked(fetchMergeResult).mockResolvedValue({
      result: {
        mergeId: 'coulée-p',
        applied: ['t-fusionnee'],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: 'journal-du-banc',
      },
    } as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    expect(dom.textContent, 'le rapport se montre une fois rendu').toContain('diff(s) appliqué(s)');
    expect(dom.textContent).toContain('✔ Tâche fusionnée');
  });

  it('L’ÉTOILE DU CONSEIL MARQUE LA DANSE RETENUE — et elle seule', async () => {
    // `d.id === session.retenue` mutée en `!==` : l'habit de « retenue »
    // irait aux battues. La battue n'a AUCUN arrêt : sa classe ne peut devenir
    // « retenue » que par la mutation.
    vi.mocked(fetchConseils).mockResolvedValue({
      conseils: [
        {
          id: 'c1',
          question: 'Quelle piste suivre ?',
          projectId: 'p1',
          etat: 'clos',
          tour: 2,
          issue: 'quorum',
          createdAt: 1,
          closedAt: 2,
        },
      ],
    } as never);
    vi.mocked(fetchConseil).mockResolvedValue({
      id: 'c1',
      question: 'Quelle piste suivre ?',
      projectId: 'p1',
      etat: 'clos',
      tour: 2,
      issue: 'quorum',
      createdAt: 1,
      closedAt: 2,
      enVol: 0,
      retenue: 'd-elue',
      danses: [
        danse('d-elue', 'La piste élue', { soutiens: ['a', 'b'], quorum: true }),
        danse('d-battue', 'La piste battue'),
      ],
    } as SessionConseil);

    const dom = await monter(instantane([tache('t-1', 'Une tâche')]));
    cliquer(bouton(dom, 'Quelle piste suivre ?'));
    await act(async () => {});

    const retenues = [...dom.querySelectorAll('.pj-cs-retenue')];
    expect(retenues, 'exactement une danse porte l’habit de retenue').toHaveLength(1);
    expect(retenues[0]?.textContent).toContain('La piste élue');
    expect(retenues[0]?.textContent).not.toContain('La piste battue');
    // Et l'étoile vit dans la retenue, une seule fois.
    expect(dom.textContent?.match(/★/g)).toHaveLength(1);
    expect(retenues[0]?.textContent).toContain('★');
  });

  it('LA BALANCE : l’alerte de plafond ne sonne QUE sur un solde en alerte', async () => {
    // La survivante de Balance.tsx : `{etat === 'alerte' && (…)}` mutée en
    // `!==` — l'alarme sonnerait sur chaque plafond SAUF ceux qui la
    // méritent. Deux soldes plafonnés, un seul en alerte : le badge ⚠ doit
    // suivre l'état, pas l'inverse.
    const solde = (etat: 'passe' | 'alerte') => ({
      projectId: 'p1',
      depenseMs: 5_400_000,
      tentatives: 3,
      plafondMs: 6_000_000,
      etat,
      bloque: false,
    });
    const balance = (etat: 'passe' | 'alerte') =>
      ({
        version: 1,
        mode: 'strict',
        aJour: true,
        fenetre: 100,
        pesee: {
          version: 1,
          global: { totalMs: 0, tentatives: 0 },
          parProjet: [],
          parNoeud: [],
          reprises: { taches: 0, tentatives: 0 },
        },
        soldes: [solde(etat)],
      }) as never;

    vi.mocked(fetchBalance).mockResolvedValue(balance('passe'));
    const calme = await monter(instantane([tache('t-1', 'Une tâche')]));
    expect(calme.textContent).toContain('Plafond');
    expect(calme.textContent, 'sous le seuil, pas d’alarme').not.toContain('Alerte :');

    act(() => racine?.unmount());
    vi.mocked(fetchBalance).mockResolvedValue(balance('alerte'));
    const alerte = await monter(instantane([tache('t-1', 'Une tâche')]));
    expect(alerte.textContent, 'au seuil franchi, l’alarme sonne').toContain('Alerte :');
    expect(alerte.textContent).toContain('% du plafond consommés');
  });

  it('CHAQUE ALVÉOLE PÈSE SON MIEL — jamais celui de la voisine', async () => {
    // Survivante du balayage du soir : `p.projectId === project.id` du
    // compteProjet mutée en `!==` — avec deux projets, chaque carte
    // afficherait la pesée de L'AUTRE. Deux comptes aux durées bien
    // distinctes (30 min / 2 h) pour que l'échange se voie.
    const compte = (totalMs: number) => ({
      utileMs: totalMs,
      repriseMs: 0,
      echecMs: 0,
      rebuteMs: 0,
      totalMs,
      tentatives: 1,
      rendement: 1,
    });
    vi.mocked(fetchBalance).mockResolvedValue({
      version: 1,
      mode: 'observation',
      aJour: true,
      fenetre: 100,
      pesee: {
        version: 1,
        global: compte(9_000_000),
        parProjet: [
          { projectId: 'p-un', ...compte(30 * 60_000) },
          { projectId: 'p-deux', ...compte(2 * 3_600_000) },
        ],
        parNoeud: [],
        reprises: { taches: 0, tentatives: 0 },
      },
      soldes: [],
    } as never);
    const deuxProjets = {
      projects: [
        { id: 'p-un', name: 'Ruche-Un', repoUrl: null, description: null, createdAt: 1 },
        { id: 'p-deux', name: 'Ruche-Deux', repoUrl: null, description: null, createdAt: 2 },
      ],
      nodes: [],
      tasks: [],
      tasksTotal: 0,
    } as unknown as StateSnapshot;
    const dom = await monter(deuxProjets);
    const cartes = [...dom.querySelectorAll('.pj-card')];
    const un = cartes.find((c) => (c.textContent ?? '').includes('Ruche-Un'));
    const deux = cartes.find((c) => (c.textContent ?? '').includes('Ruche-Deux'));
    expect(un?.querySelector('.bal-projet-total')?.textContent, 'Ruche-Un pèse 30 min').toContain(
      '30 min',
    );
    expect(deux?.querySelector('.bal-projet-total')?.textContent, 'Ruche-Deux pèse 2 h').toContain(
      '2 h',
    );
    expect(un?.textContent, 'le miel de la voisine ne déborde pas').not.toContain('2 h');
  });

  it('L’ERREUR GITHUB PORTE SON HABIT — et il n’existe pas au repos', async () => {
    // `{erreur && <p className="pj-gh-erreur">}` mutée en `||` : un habit
    // d'erreur VIDE s'afficherait dès l'ouverture de la section, et l'erreur
    // réelle se rendrait crue. Les deux mondes : ouverture sereine (liste
    // vide), puis ouverture sur une sonde en panne.
    vi.mocked(fetchDepotsGithub).mockResolvedValue({ depots: [] } as never);
    const serein = await monter(instantane([]));
    cliquer(bouton(serein, 'Connecter un dépôt GitHub'));
    await act(async () => {});
    expect(
      serein.querySelector('.pj-gh-erreur'),
      'aucun habit d’erreur sur une ouverture sereine',
    ).toBeNull();

    act(() => racine?.unmount());
    conteneur?.remove();
    vi.mocked(fetchDepotsGithub).mockRejectedValue(new Error('GitHub non connecté (501)'));
    const panne = await monter(instantane([]));
    cliquer(bouton(panne, 'Connecter un dépôt GitHub'));
    await act(async () => {});
    const habit = panne.querySelector('.pj-gh-erreur');
    expect(habit, 'la panne réelle porte son habit').toBeTruthy();
    expect(habit?.textContent).toContain('GitHub non connecté');
  });
});
