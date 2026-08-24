// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ATELIER QUEEN BEE — du brief au dépôt, et les deux mécanismes qu'on ne voit pas.
//
// ─── LE GESTE ────────────────────────────────────────────────────────────────
//
// On décrit son projet en trois lignes, la reine propose un plan de tâches
// ordonnées, on choisit la ruche cible et on dépose. `projets-alveoles` défend
// la porte de l'atelier (le bouton mort sous huit caractères) et l'étiquette du
// bouton d'envoi. Entre les deux, deux mécanismes n'étaient joués nulle part.
//
// ─── 1. L'ESCALIER DU PLAN ───────────────────────────────────────────────────
//
// `planDepths` calcule la profondeur de chaque tâche dans le graphe de
// dépendances. C'est ce qui indente la liste et pose la flèche `↳` :
//
//     style={{ paddingLeft: 8 + (depths[i] ?? 0) * 18 }}
//     {(depths[i] ?? 0) > 0 && <span className="pj-plan-arrow">↳ </span>}
//
// Un plan est un ORDRE. Aplati, il se lit comme une liste de courses : on ne
// voit plus que « écrire les tests » vient après « poser le socle », et c'est
// la seule chose que le plan apporte par rapport au brief qu'on vient de taper.
//
// La descente porte aussi une garde de CYCLE. Un planificateur LLM qui rend un
// graphe circulaire n'est pas une hypothèse d'école — c'est le mode `llm`.
// Sans la garde, mesuré : `RangeError: Maximum call stack size exceeded` dans
// `depthOf`. Ce n'est pas une liste mal indentée, c'est la VUE PROJETS entière
// qui tombe, sur un plan que l'utilisateur n'a fait que demander.
//
// ─── 2. LE NONCE DE L'ENVOI ──────────────────────────────────────────────────
//
// Le commentaire du code dit exactement ce qu'il évite :
//
//     « Les ids du planner sont déterministes ('socle', 'tests'…) et la
//       validation serveur est GLOBALE : on les suffixe d'un nonce (dependsOn
//       remappés) pour que le 2e plan de la ruche ne soit pas rejeté en
//       collision d'ids. »
//
// Sans le nonce, l'atelier marche UNE fois par ruche. Le deuxième projet planifié
// se fait refuser en bloc, et le message parle de collision d'identifiants sur
// des noms que l'utilisateur n'a jamais vus ni choisis.
//
// Et le renommage doit emporter les DÉPENDANCES avec lui : des tâches qui
// portent les nouveaux ids en se réclamant des anciens forment un plan dont
// aucun lien ne se referme.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Mutants posés ensemble, chacun vérifié posé, suite entière verte — 279
// fichiers, 4 136 tests.
//
//     return max + 1;                              →  return max;
//     addTasks(target, uniqueTasks)                →  addTasks(target, plan.tasks)
//     dependsOn.map((d) => rename.get(d) ?? d)     →  .map((d) => d)

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import type { NewTaskInput } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchReport: vi.fn(() => Promise.resolve(null)),
  fetchConseils: vi.fn(() => Promise.resolve({ conseils: [] })),
  fetchConseil: vi.fn(() => Promise.reject(new Error('aucune session simulée'))),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchProjetsOuverts: vi.fn(() => Promise.resolve({ projets: [] })),
  fetchDepotsGithub: vi.fn(() => Promise.resolve({ depots: [] })),
  fetchMembresProjet: vi.fn(() => Promise.resolve({ membres: [] })),
  fetchPartages: vi.fn(() => Promise.resolve({ partages: [] })),
  fetchIssues: vi.fn(() => Promise.resolve({ issues: [] })),
  fetchLivraisons: vi.fn(() => Promise.resolve({ livraisons: [] })),
  fetchEssaim: vi.fn(() => Promise.resolve(null)),
  fetchProjectBalance: vi.fn(() => Promise.resolve(null)),
  // Sondes des enfants qui ne sont PAS nommés dans Projets.tsx : `Honeycomb`
  // (shared) hydrate les revues, `GardeFous` lit ses bornes. `vi.mock` garde
  // les exports non redéfinis via `importOriginal` — ceux-là partent donc EN
  // VRAI vers le port 3000, et le banc bruit d'ECONNREFUSED sans échouer.
  // Chercher les sondes dans le seul fichier de la vue ne suffit pas : il faut
  // suivre ses ENFANTS.
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  fetchGardeFou: vi.fn(() => Promise.resolve(null)),
  postReview: vi.fn(() => Promise.resolve()),
  planBrief: vi.fn(() => Promise.resolve({ tasks: [], source: 'heuristic' })),
  addTasks: vi.fn(() => Promise.resolve([{ id: 't-x' }])),
}));

import { addTasks, planBrief } from '../dashboard/src/api';
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
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

const PROJET = { id: 'p-1', name: 'Rucher', repoUrl: null };

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [PROJET],
      nodes: [],
      tasks: [],
      tasksTotal: 0,
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

/**
 * Remplit le brief. Un champ CONTRÔLÉ par React ignore une écriture directe de
 * `.value` : le « value tracker » de React ne voit pas de changement et
 * `onChange` ne part jamais. On passe donc par le mutateur natif du prototype,
 * puis on émet l'événement — sinon le bouton resterait mort et le banc serait
 * vert pour la mauvaise raison.
 */
function ecrireLeBrief(dom: HTMLElement, texte: string): void {
  const champ = dom.querySelector<HTMLTextAreaElement>('textarea.pj-brief');
  if (!champ) throw new Error('le champ du brief est introuvable');
  const poser = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as (
    v: string,
  ) => void;
  poser.call(champ, texte);
  champ.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Un bouton désigné par son libellé — jamais par son rang. */
function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((e) =>
    (e.textContent ?? '').includes(libelle),
  );
  if (!b) throw new Error(`bouton « ${libelle} » introuvable`);
  return b as HTMLButtonElement;
}

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Monte l'atelier, tape un brief et fait proposer le plan donné. */
async function proposer(taches: NewTaskInput[]): Promise<HTMLElement> {
  vi.mocked(planBrief).mockResolvedValue({ tasks: taches, source: 'heuristic' } as never);
  const dom = await monter();
  await act(async () => ecrireLeBrief(dom, 'Une API de sondages avec authentification'));
  await act(async () => {});
  await cliquer(bouton(dom, 'Proposer un plan'));
  return dom;
}

/** Les lignes du plan, dans l'ordre affiché. */
const lignesDuPlan = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.pj-plan-list li'),
];

/** Ce qui est PARTI vers la ruche — l'argument réel du dépôt. */
const tachesEnvoyees = (): NewTaskInput[] =>
  (vi.mocked(addTasks).mock.calls[0]?.[1] ?? []) as NewTaskInput[];

// Un plan à trois étages : socle → tests → doc. C'est la forme que rend le
// planificateur, et celle dont l'escalier se voit.
const PLAN_EN_ESCALIER: NewTaskInput[] = [
  { id: 'socle', title: 'Poser le socle', prompt: 'p' },
  { id: 'tests', title: 'Écrire les tests', prompt: 'p', dependsOn: ['socle'] },
  { id: 'doc', title: 'Rédiger la doc', prompt: 'p', dependsOn: ['tests'] },
];

describe('l’atelier propose un plan qui se lit comme un ordre', () => {
  it('LE BRIEF DEVIENT UN PLAN — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Il éprouve aussi le remplissage du champ contrôlé : sans le mutateur
    // natif, `onChange` ne part pas, le bouton reste désactivé, et TOUS les cas
    // suivants seraient verts en constatant l'absence d'un plan qui n'a jamais
    // été demandé (§ 9 unvicicenties, la panne du champ contrôlé).
    const dom = await proposer(PLAN_EN_ESCALIER);

    expect(planBrief, 'la reine n’a pas été sollicitée').toHaveBeenCalled();
    expect(lignesDuPlan(dom), 'le plan ne rend pas ses trois tâches').toHaveLength(3);
    expect(dom.textContent, 'le titre d’une tâche manque').toContain('Poser le socle');
  });

  it('L’ESCALIER SE VOIT — la racine à plat, ce qui suit décalé', async () => {
    // ─── L'ASSERTION QUI PORTE LA PREMIÈRE MOITIÉ ──────────────────────────
    //
    // `return max + 1` muté en `return max` : toutes les profondeurs tombent à
    // zéro, la liste s'aplatit et les flèches disparaissent. Le plan se lit
    // alors comme une liste de courses — on ne voit plus que « écrire les
    // tests » vient APRÈS « poser le socle », et c'est la seule chose que le
    // plan apporte par rapport au brief qu'on vient de taper.
    //
    // On mesure le CONTRASTE entre la racine et ses descendants : un banc qui
    // ne regarderait qu'une ligne ne distinguerait pas « tout à zéro » de
    // « tout au même étage ».
    const dom = await proposer(PLAN_EN_ESCALIER);
    const [racineL, testsL, docL] = lignesDuPlan(dom);

    const marge = (li: HTMLElement) => parseInt(li.style.paddingLeft || '0', 10);
    expect(marge(racineL!), 'la racine est déjà décalée').toBe(8);
    expect(marge(testsL!), 'le premier descendant n’est pas décalé').toBeGreaterThan(
      marge(racineL!),
    );
    expect(marge(docL!), 'l’escalier ne descend pas d’un second étage').toBeGreaterThan(
      marge(testsL!),
    );

    expect(racineL!.textContent, 'la racine porte une flèche de descendance').not.toContain('↳');
    expect(testsL!.textContent, 'le descendant n’a pas sa flèche').toContain('↳');
  });

  it('UN PLAN CIRCULAIRE NE FAIT PAS TOURNER LA DESCENTE', async () => {
    // ─── LA GARDE DE CYCLE ─────────────────────────────────────────────────
    //
    // `if (!parent || stack.has(dep)) continue;` — sans `stack.has(dep)`, deux
    // tâches qui se réclament l'une de l'autre font descendre `depthOf` sans
    // fin. Ce n'est pas une hypothèse d'école : le mode `llm` fait rendre le
    // graphe par un modèle, et rien ne garantit qu'il soit acyclique.
    //
    // Le banc ne mesure pas « ça ne boucle pas » (un test qui boucle n'échoue
    // pas, il EXPIRE) : il mesure que l'écran s'affiche quand même, ce qui est
    // la conséquence observable de la garde.
    const dom = await proposer([
      { id: 'a', title: 'Tâche A', prompt: 'p', dependsOn: ['b'] },
      { id: 'b', title: 'Tâche B', prompt: 'p', dependsOn: ['a'] },
    ]);

    expect(lignesDuPlan(dom), 'un plan circulaire n’arrive pas à l’écran').toHaveLength(2);
    expect(dom.textContent, 'la tâche du cycle n’est pas rendue').toContain('Tâche A');
  });
});

describe('le dépôt renomme les tâches, et emporte les liens avec lui', () => {
  /** Fait le geste complet : proposer, puis envoyer. */
  async function envoyer(taches: NewTaskInput[]): Promise<void> {
    const dom = await proposer(taches);
    await cliquer(bouton(dom, 'Envoyer les tâches'));
  }

  it('LES IDS DÉPOSÉS NE SONT PLUS CEUX DU PLANIFICATEUR', async () => {
    // ─── L'ASSERTION QUI PORTE LA SECONDE MOITIÉ ───────────────────────────
    //
    // Les ids du planificateur sont déterministes — « socle », « tests », «
    // doc » — et la validation serveur est GLOBALE. Sans le nonce, l'atelier
    // marche UNE fois par ruche : le deuxième projet planifié se fait refuser
    // en bloc, sur une collision d'identifiants que l'utilisateur n'a jamais vus
    // ni choisis.
    await envoyer(PLAN_EN_ESCALIER);

    const envoyees = tachesEnvoyees();
    expect(envoyees, 'rien n’a été déposé').toHaveLength(3);
    const ids = envoyees.map((t) => t.id ?? '');
    expect(
      ids,
      'les ids du planificateur partent tels quels : le 2e plan sera refusé',
    ).not.toContain('socle');
    // Le suffixe seulement : l'id d'origine reste lisible en tête, sinon
    // personne ne reconnaîtrait « socle » dans le tableau après le dépôt.
    expect(ids[0], 'l’id déposé ne dérive plus de celui du plan').toMatch(/^socle-/);
    expect(new Set(ids).size, 'deux tâches partagent le même id').toBe(3);
  });

  it('LES DÉPENDANCES SUIVENT LE RENOMMAGE — et une dépendance ÉTRANGÈRE est laissée intacte', async () => {
    // ─── LES DEUX MOITIÉS DE `rename.get(d) ?? d` ──────────────────────────
    //
    // À gauche : une dépendance INTERNE doit pointer sur le NOUVEL id. Sans
    // cela, les tâches portent les nouveaux noms en se réclamant des anciens —
    // un plan dont aucun lien ne se referme.
    //
    // À droite : le `?? d` garde une dépendance qui n'appartient PAS au plan
    // (une tâche déjà présente dans la ruche). La renommer la ferait pointer
    // dans le vide.
    //
    // L'entrée porte les deux à la fois : c'est la seule forme qui départage
    // les deux moitiés d'un seul geste.
    await envoyer([
      { id: 'socle', title: 'Poser le socle', prompt: 'p' },
      {
        id: 'tests',
        title: 'Écrire les tests',
        prompt: 'p',
        dependsOn: ['socle', 'tache-deja-dans-la-ruche'],
      },
    ]);

    const envoyees = tachesEnvoyees();
    const socleId = envoyees[0]?.id ?? '';
    const deps = envoyees[1]?.dependsOn ?? [];

    expect(deps, 'la dépendance interne pointe encore sur l’ancien id').toContain(socleId);
    expect(deps, 'la dépendance interne n’a pas suivi le renommage').not.toContain('socle');
    expect(
      deps,
      'une dépendance étrangère au plan a été renommée : elle pointe dans le vide',
    ).toContain('tache-deja-dans-la-ruche');
  });
});
