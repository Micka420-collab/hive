// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// Le graphe d'expérience À L'ÉCRAN — la liste, le voisinage, et ce que le
// tiroir d'une tâche dit de l'expérience que l'ouvrière a lue.
//
// Ce que ces bancs tiennent, et qu'aucun banc serveur ne voit :
//   · la NATURE de chaque lien est ÉCRITE — « fait », « corrélation », « leçon
//     validée » —, jamais laissée à une couleur ;
//   · la provenance est lisible : l'id de l'événement et son type ;
//   · « suivie d'une réussite », jamais « réparée par » : le mot n'affirme pas
//     une cause que le graphe ne sait pas ;
//   · la portée est dite, avec la marche à suivre pour fédérer ; « toute la
//     ruche » n'est offerte qu'à un compte administrateur.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { AuthUser, VueExperience } from '../dashboard/src/api';
import type { HiveNode, Project } from '../src/shared/types';
import type { AffectationVue } from '../src/shared/routage-vue';
import {
  cibleDeTache,
  compterExperience,
  contextesSimilaires,
  listerExperience,
  projeterGrapheExperience,
  voisinageExperience,
} from '../src/shared/graphe-experience';
import type { Note } from '../src/shared/cerveau';
import type { HiveEvent } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchExperience: vi.fn(),
  fetchRoutage: vi.fn(),
}));

import { fetchExperience, fetchRoutage } from '../dashboard/src/api';
import { GrapheExperience } from '../dashboard/src/views/GrapheExperience';
import { RoutageTache } from '../dashboard/src/RoutageTache';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.mocked(fetchExperience).mockReset();
});

// ─── Un vrai graphe, replié par le module pur : pas de formes écrites à la main ──

const ev = (id: number, type: string, payload: Record<string, unknown>): HiveEvent => ({
  id,
  ts: Date.UTC(2026, 8, 1, 12, id),
  type,
  payload,
});

const JOURNAL = [
  ev(1, 'task_created', { taskId: 't1', projectId: 'pa' }),
  ev(2, 'task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'opus' }),
  ev(3, 'task_retry', { taskId: 't1', nodeId: 'n1', resultId: 1 }),
  ev(4, 'cerveau_episode', { taskId: 't1', note: 'ep-jeton' }),
  ev(5, 'task_done', { taskId: 't1', nodeId: 'n1', resultId: 2 }),
  ev(6, 'task_created', { taskId: 't2', projectId: 'pa' }),
  ev(7, 'task_done', { taskId: 't2', nodeId: 'n1', resultId: 3 }),
];
const NOTES: Note[] = [
  {
    id: 'lecon-jeton',
    genre: 'lecon',
    titre: 'Rafraîchir le jeton',
    corps: '[[ep-jeton]]',
    etiquettes: [],
    creee: '2026-09-01T00:00:00.000Z',
    recurrences: 1,
  },
];
const GRAPHE = projeterGrapheExperience(
  {
    evenements: JOURNAL,
    tacheDe: (id) =>
      id === 't1' || id === 't2'
        ? {
            projectId: 'pa',
            titre: id === 't1' ? 'Corriger la connexion' : 'Durcir la session',
            categorie: 'correction',
            fichiers: ['src/auth.ts'],
          }
        : null,
    nomProjet: () => 'Projet A',
    nomOuvriere: () => 'Ouvrière une',
    notes: NOTES,
  },
  { genre: 'projets', projets: new Set(['pa']) },
);

const entete = (reglage: 'projet' | 'ruche' = 'projet'): VueExperience => ({
  portee: 'projet',
  reglage,
  lecture: GRAPHE.lecture,
  comptes: compterExperience(GRAPHE),
});

const PROJETS = [
  { id: 'pa', name: 'Projet A' },
  { id: 'pb', name: 'Projet B' },
] as unknown as Project[];

async function monterGraphe(user: AuthUser | null, reglage: 'projet' | 'ruche' = 'projet') {
  vi.mocked(fetchExperience).mockImplementation(async (_portee, question = {}) => {
    if (question.noeud === undefined) {
      return { ...entete(reglage), noeuds: listerExperience(GRAPHE, question.genre ?? null, 200) };
    }
    const voisinage = voisinageExperience(GRAPHE, question.noeud, 200);
    if (!voisinage) throw new Error('nœud inconnu');
    const cible =
      voisinage.centre.genre === 'task' ? cibleDeTache(GRAPHE, voisinage.centre.id.slice(5)) : null;
    return {
      ...entete(reglage),
      voisinage,
      similaires: cible ? contextesSimilaires(GRAPHE, cible, 5) : [],
    };
  });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(
      <GrapheExperience projects={PROJETS} user={user} refreshTick={0} onOpenTask={() => {}} />,
    ),
  );
  await act(async () => {});
  return conteneur;
}

const cliquer = async (el: Element | null | undefined) => {
  expect(el, 'élément introuvable').toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await act(async () => {});
};

const bouton = (dom: HTMLElement, texte: string) =>
  [...dom.querySelectorAll('button')].find((b) => b.textContent?.includes(texte));

describe('le panneau « Graphe d’expérience » de la Mémoire', () => {
  it('DIT LA PORTÉE ET COMMENT FÉDÉRER — le réglage appartient à l’hôte', async () => {
    const dom = await monterGraphe(null);
    const reglage = dom.querySelector('[data-testid="exp-reglage"]')?.textContent ?? '';
    expect(reglage).toContain('Ce projet seulement');
    expect(reglage).toContain('HIVE_EXPERIENCE_PORTEE=ruche');
    expect(vi.mocked(fetchExperience).mock.calls[0]?.[0]).toEqual({ projectId: 'pa' });
    // Sans compte administrateur, « toute la ruche » n'est pas offerte.
    expect(dom.querySelector('option[value="*ruche*"]')).toBeNull();
  });

  it('« TOUTE LA RUCHE » EST OFFERTE À UN ADMINISTRATEUR, ET LUE PAR SA ROUTE', async () => {
    const admin = { id: 'u', email: 'a@b', displayName: 'A', role: 'admin' } as AuthUser;
    const dom = await monterGraphe(admin, 'ruche');
    expect(dom.querySelector('[data-testid="exp-reglage"]')?.textContent).toContain(
      'l’hôte a ouvert la fédération',
    );
    const select = dom.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = '*ruche*';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {});
    expect(vi.mocked(fetchExperience).mock.calls.at(-1)?.[0]).toBe('ruche');
  });

  it('LE VOISINAGE ÉCRIT LA NATURE ET LA PROVENANCE DE CHAQUE LIEN', async () => {
    const dom = await monterGraphe(null);
    await cliquer(bouton(dom, 'Corriger la connexion'));
    const voisinage = dom.querySelector('[data-testid="exp-voisinage"]')?.textContent ?? '';
    expect(voisinage).toContain('Corriger la connexion');
    // La provenance : l'événement et son type, lisibles.
    expect(voisinage).toMatch(/#1 task_created/);
    expect(voisinage).toContain('a échoué avec');
    expect(voisinage).toContain('fait');
    // Chaque lien se lit de `de` vers `vers`, quel que soit le bout au centre :
    // la production VIENT DE la tâche — pas « vient d'elle-même ».
    const lignes = [...dom.querySelectorAll('.exp-arete')].map((l) => l.textContent ?? '');
    expect(
      lignes.some((l) => l.includes('production r2 — rendue vient de Corriger la connexion')),
    ).toBe(true);
    expect(lignes.some((l) => /production r2 — rendue vient de production r2/.test(l))).toBe(false);
    // Le contexte similaire, dit comme ce qu'il est.
    const similaires = dom.querySelector('[data-testid="exp-similaires"]')?.textContent ?? '';
    expect(similaires).toContain('corrélations, pas des règles');
    expect(similaires).toContain('Durcir la session');
    expect(similaires).toContain('fichiers en commun : src/auth.ts');
  });

  it('« SUIVIE D’UNE RÉUSSITE », JAMAIS « RÉPARÉE PAR » — et la leçon est dite validée', async () => {
    const dom = await monterGraphe(null);
    await cliquer(bouton(dom, 'Erreurs'));
    await cliquer(bouton(dom, 'ep-jeton'));
    const voisinage = dom.querySelector('[data-testid="exp-voisinage"]')?.textContent ?? '';
    expect(voisinage).toContain('suivie d’une réussite');
    expect(voisinage).toContain('corrélation');
    expect(voisinage).not.toMatch(/répar/i);
    expect(voisinage).toContain('leçon validée');
    expect(voisinage).toContain('note lecon-jeton');
    // Suivre un lien : la production qui a suivi l'erreur, d'un clic — elle
    // devient le centre, et son voisinage est relu.
    const lien = [...dom.querySelectorAll('.exp-arete button')].find((b) =>
      b.textContent?.includes('production r2'),
    );
    await cliquer(lien);
    expect(vi.mocked(fetchExperience).mock.calls.at(-1)?.[1]).toEqual({ noeud: 'artifact:r2' });
    expect(dom.querySelector('.exp-centre')?.textContent).toContain('production r2 — rendue');
  });

  it('sans projet, l’écran le dit — pas une liste vide muette', async () => {
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () =>
      racine?.render(
        <GrapheExperience projects={[]} user={null} refreshTick={0} onOpenTask={() => {}} />,
      ),
    );
    expect(conteneur.textContent).toContain('Aucun projet');
    expect(vi.mocked(fetchExperience)).not.toHaveBeenCalled();
  });
});

describe('le tiroir dit ce que l’ouvrière a lu de l’expérience voisine', () => {
  const affectation = (experience: AffectationVue['experience']): AffectationVue => ({
    eventId: 1,
    ts: 1,
    nodeId: 'n-1',
    modele: null,
    categorie: null,
    versionAiguillage: null,
    raisonModele: [],
    modelesEcartes: [],
    modelesReadmis: [],
    pheromone: null,
    course: null,
    critereNoeud: 'moins_charge',
    ...(experience ? { experience } : {}),
  });

  async function monterRoutage(a: AffectationVue) {
    vi.mocked(fetchRoutage).mockResolvedValue({ taskId: 't', affectations: [a] });
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    const noeuds = [{ id: 'n-1', name: 'une' }] as unknown as HiveNode[];
    await act(async () => racine?.render(<RoutageTache taskId="t" cle="k" nodes={noeuds} />));
    await act(async () => {});
    return conteneur;
  }

  const voisine = {
    taskId: 'voisine-1',
    titre: 'Corriger la connexion',
    projectId: 'pb',
    memeProjet: false,
    categorie: true,
    fichiers: ['src/auth.ts'],
    erreurs: 1,
    rendue: true,
    validee: true,
    contestee: false,
    tentativesEchouees: 1,
    modeles: ['opus'],
    lecons: 1,
  };

  it('LES CONTEXTES LUS, AVEC LEURS TRAITS — et ce qu’ils ne sont pas : la raison du choix', async () => {
    const dom = await monterRoutage(
      affectation({ etat: 'jointe', portee: 'ruche', similaires: [voisine] }),
    );
    const bloc = dom.querySelector('[data-testid="routage-experience"]')?.textContent ?? '';
    expect(bloc).toContain('des corrélations, pas la raison du choix');
    expect(bloc).toContain('Fédérée par l’hôte');
    expect(bloc).toContain('Corriger la connexion');
    expect(bloc).toContain('un autre projet');
    expect(bloc).toContain('1 signature(s) d’erreur en commun');
    expect(bloc).toContain('fichiers en commun : src/auth.ts');
    expect(bloc).toContain('modèles : opus');
  });

  it('PERDUS AU BUDGET, ILS SONT DITS PERDUS', async () => {
    const dom = await monterRoutage(
      affectation({ etat: 'perdue', portee: 'projet', similaires: [voisine] }),
    );
    expect(dom.querySelector('[data-testid="routage-experience-perdue"]')?.textContent).toContain(
      'NON transmis',
    );
  });

  it('sans expérience journalisée, le tiroir n’en invente pas', async () => {
    const dom = await monterRoutage(affectation(undefined));
    expect(dom.querySelector('[data-testid="routage-experience"]')).toBeNull();
  });
});
