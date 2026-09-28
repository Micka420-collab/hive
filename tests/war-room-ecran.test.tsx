// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA WAR ROOM ET LE CONSEIL À L'ÉCRAN — réunir, trancher, voir ce qui attend.
//
// Le panneau du Conseil disait « vous tranchez » sans rien pour trancher, et
// le Conseil ne se réunissait qu'en ligne de commande. Ce fichier vérifie les
// gestes, sur la vue montée pour de vrai (seules les routes sont simulées) :
//
//   · RÉUNIR depuis la carte projet, et le 409 « déjà en cours » DIT — le
//     conseil qui délibère est déplié au lieu d'un échec muet ;
//   · TRANCHER un conseil clos, avec une raison obligatoire ; relire qui a
//     tranché, l'aveu du jeton de ruche compris ; revenir sur une décision en
//     NOMMANT celle qu'on remplace ;
//   · la War Room met en tête ce qui attend quelqu'un, et le cockpit en donne
//     le compte — « inconnu » n'étant jamais « aucun ».

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import type {
  ConseilResume,
  DecisionConseil,
  SessionConseil,
  VueWarRoom,
} from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchReport: vi.fn(() => Promise.resolve(null)),
  fetchConseils: vi.fn(() => Promise.resolve({ conseils: [] })),
  fetchConseil: vi.fn(() => Promise.reject(new Error('aucune session simulée'))),
  reunirConseil: vi.fn(),
  trancherConseil: vi.fn(),
  fetchWarRoom: vi.fn(),
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
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  fetchGardeFou: vi.fn(() => Promise.resolve(null)),
}));

import {
  ApiError,
  fetchConseil,
  fetchConseils,
  fetchWarRoom,
  reunirConseil,
  trancherConseil,
} from '../dashboard/src/api';
import { AccesWarRoom } from '../dashboard/src/AccesWarRoom';
import Projets from '../dashboard/src/views/Projets';
import WarRoom from '../dashboard/src/views/WarRoom';
import { direEntree } from '../dashboard/src/views/warroom-rendu';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  vi.mocked(fetchConseils).mockResolvedValue({ conseils: [] } as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

const snapshot = {
  projects: [{ id: 'p-1', name: 'Rucher', repoUrl: null, createdAt: 1 }],
  nodes: [{ id: 'n-codex', name: 'Codex du salon' }],
  tasks: [{ id: 't-1', projectId: 'p-1', title: 'Ajouter une garde', status: 'done' }],
  tasksTotal: 1,
} as unknown as StateSnapshot;

function props(over: Partial<ViewProps> = {}): ViewProps {
  return {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNewProject: () => {},
    onNavigate: () => {},
    selectedId: null,
    refreshTick: 0,
    user: null,
    ...over,
  } as unknown as ViewProps;
}

async function rendre(element: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(element));
  await act(async () => {});
  await act(async () => {});
  return conteneur;
}

async function cliquer(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('élément à cliquer introuvable');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

const bouton = (dom: HTMLElement, texte: string): HTMLButtonElement | undefined =>
  [...dom.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(texte));

/** Coche un bouton radio — `click()` porte l'activation que React écoute. */
async function cocher(el: HTMLInputElement | undefined): Promise<void> {
  if (!el) throw new Error('bouton radio introuvable');
  await act(async () => {
    el.click();
  });
}

async function saisir(el: HTMLInputElement | HTMLTextAreaElement, valeur: string): Promise<void> {
  const proto =
    el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const resume = (over: Partial<ConseilResume> = {}): ConseilResume => ({
  id: 'cs-1',
  question: 'Quel socle pour la ruche ?',
  projectId: 'p-1',
  etat: 'clos',
  tour: 2,
  issue: 'depart',
  createdAt: 0,
  closedAt: 10,
  decision: null,
  ...over,
});

const danse = (id: string, titre: string) => ({
  id,
  titre,
  corps: '',
  sources: [],
  eclaireuse: 'n',
  famille: 'codex',
  qualite: 7,
  intensite: 1,
  soutiens: [],
  arrets: [],
  familles: [],
  quorum: true,
  autoSoutienIgnore: false,
  raisons: [],
});

const session = (over: Partial<SessionConseil> = {}): SessionConseil => ({
  id: 'cs-1',
  question: 'Quel socle pour la ruche ?',
  projectId: 'p-1',
  etat: 'clos',
  tour: 2,
  issue: 'depart',
  createdAt: 0,
  closedAt: 10,
  enVol: 0,
  danses: [danse('prop-a', 'Piste A'), danse('prop-b', 'Piste B')],
  retenue: null,
  decision: null,
  ...over,
});

const decision = (over: Partial<DecisionConseil> = {}): DecisionConseil => ({
  genre: 'conseil_decide',
  id: 42,
  ts: 1_000,
  sessionId: 'cs-1',
  projectId: 'p-1',
  propositionId: 'prop-b',
  titre: 'Piste B',
  justification: 'B se teste seule',
  par: { genre: 'jeton_de_ruche' },
  remplace: null,
  ...over,
});

/** Soumet le formulaire de décision — comme le bouton « Consigner » le ferait. */
async function consigner(dom: HTMLElement): Promise<void> {
  const form = dom.querySelector('.pj-cs-trancher');
  if (!form) throw new Error('aucun formulaire de décision');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

async function deplier(dom: HTMLElement): Promise<void> {
  await cliquer(dom.querySelector('.pj-cs-question'));
}

describe('réunir le Conseil depuis la carte projet', () => {
  it('LE GESTE EXISTE HORS DE LA LIGNE DE COMMANDE — et la question part avec lui', async () => {
    vi.mocked(reunirConseil).mockResolvedValue(session({ id: 'cs-neuf', etat: 'exploration' }));
    const dom = await rendre(<Projets {...props()} />);
    // Sans délibération, le panneau se tait — jusqu'à ce qu'on demande à réunir.
    expect(dom.querySelector('.pj-cs-reunir')).toBeNull();

    await cliquer(bouton(dom, 'Réunir le Conseil'));
    const champ = dom.querySelector<HTMLInputElement>('.pj-cs-reunir input');
    expect(champ, 'le formulaire de réunion ne s’ouvre pas').not.toBeNull();
    // Le coût est dit AVANT le bouton : ce sont de vraies tâches d'ouvrières.
    expect(dom.querySelector('.pj-cs-reunir')?.textContent).toMatch(/vraies tâches d’ouvrières/);
    await saisir(champ!, 'Faut-il un cache ?');
    await cliquer(bouton(dom.querySelector('.pj-cs-reunir')!, 'Réunir'));

    expect(reunirConseil).toHaveBeenCalledWith('p-1', 'Faut-il un cache ?');
    expect(fetchConseil, 'le conseil réuni se déplie').toHaveBeenCalledWith('cs-neuf');
  });

  it('LE 409 SE DIT — et le conseil qui délibère déjà se déplie', async () => {
    // Deux conseils concurrents doubleraient la dépense : le refus est une
    // garde, pas une panne. L'écran le dit, et montre le conseil existant.
    vi.mocked(reunirConseil).mockRejectedValue(new ApiError('déjà en cours', 409));
    vi.mocked(fetchConseils).mockResolvedValue({
      conseils: [resume({ id: 'cs-en-vol', etat: 'exploration', issue: null, closedAt: null })],
    } as never);
    vi.mocked(fetchConseil).mockResolvedValue(
      session({ id: 'cs-en-vol', etat: 'exploration', closedAt: null }),
    );
    const dom = await rendre(<Projets {...props()} />);
    await cliquer(bouton(dom, 'Réunir le Conseil'));
    await cliquer(bouton(dom.querySelector('.pj-cs-reunir')!, 'Réunir'));

    expect(dom.querySelector('.pj-cs-avis')?.textContent).toMatch(/délibère déjà/);
    expect(dom.querySelector('.panel-error'), 'le 409 n’est pas un échec').toBeNull();
    expect(fetchConseil).toHaveBeenCalledWith('cs-en-vol');
  });
});

describe('trancher un conseil clos', () => {
  it('LA LISTE DIT CE QUI ATTEND QUELQU’UN, et ce qui est tranché', async () => {
    vi.mocked(fetchConseils).mockResolvedValue({
      conseils: [
        resume({ id: 'cs-1' }),
        resume({ id: 'cs-2', question: 'Tranché', decision: decision({ sessionId: 'cs-2' }) }),
        resume({ id: 'cs-3', question: 'Quorum', issue: 'quorum' }),
      ],
    } as never);
    const dom = await rendre(<Projets {...props()} />);
    const lignes = [...dom.querySelectorAll('.pj-cs-liste li')].map((l) => l.textContent ?? '');
    expect(lignes[0]).toContain('à trancher');
    expect(lignes[1]).toContain('tranché');
    expect(lignes[1]).not.toContain('à trancher');
    // Un quorum a une recommandation : ce n'est pas un désaccord.
    expect(lignes[2]).not.toContain('trancher');
  });

  it('UNE PISTE ET UNE RAISON — puis la décision se relit, avec son auteur', async () => {
    vi.mocked(fetchConseils).mockResolvedValue({ conseils: [resume()] } as never);
    vi.mocked(fetchConseil).mockResolvedValue(session());
    vi.mocked(trancherConseil).mockResolvedValue(
      session({ decision: decision({ par: { genre: 'compte', userId: 'u-1', nom: 'Ada' } }) }),
    );
    const dom = await rendre(<Projets {...props()} />);
    await deplier(dom);

    // Un enregistrement, pas un ordre : le formulaire le dit au moment du geste.
    expect(dom.querySelector('.pj-cs-trancher-tete')?.textContent).toContain(
      'ne crée ni n’annule aucune tâche',
    );
    const envoi = bouton(dom, 'Consigner la décision')!;
    expect(envoi.disabled, 'sans choix ni raison, rien ne part').toBe(true);
    const radios = [...dom.querySelectorAll<HTMLInputElement>('.pj-cs-choix input')];
    expect(radios, 'chaque piste ET « aucune »').toHaveLength(3);
    await cocher(radios[1]);
    expect(envoi.disabled, 'une raison est obligatoire').toBe(true);
    // Même soumis sans raison (touche Entrée, bouton contourné), rien ne part.
    await consigner(dom);
    expect(trancherConseil).not.toHaveBeenCalled();
    await saisir(
      dom.querySelector<HTMLTextAreaElement>('.pj-cs-justification')!,
      '  B se teste seule  ',
    );
    expect(envoi.disabled).toBe(false);
    await consigner(dom);

    expect(trancherConseil).toHaveBeenCalledWith('cs-1', {
      propositionId: 'prop-b',
      justification: 'B se teste seule',
      precedente: null,
    });
    const rangee = dom.querySelector('[data-testid="pj-cs-decision"]')?.textContent ?? '';
    expect(rangee).toContain('Ada');
    expect(rangee).toContain('Piste B');
    expect(rangee).toContain('B se teste seule');
  });

  it('LE JETON DE RUCHE NE SIGNE PAS — l’écran le dit', async () => {
    vi.mocked(fetchConseils).mockResolvedValue({
      conseils: [resume({ decision: decision() })],
    } as never);
    vi.mocked(fetchConseil).mockResolvedValue(session({ decision: decision() }));
    const dom = await rendre(<Projets {...props()} />);
    await deplier(dom);
    expect(dom.querySelector('[data-testid="pj-cs-decision"]')?.textContent).toContain(
      'auteur non identifié',
    );
  });

  it('REVENIR SUR UNE DÉCISION NOMME CELLE QU’ON REMPLACE', async () => {
    vi.mocked(fetchConseils).mockResolvedValue({
      conseils: [resume({ decision: decision() })],
    } as never);
    vi.mocked(fetchConseil).mockResolvedValue(session({ decision: decision() }));
    vi.mocked(trancherConseil).mockResolvedValue(
      session({ decision: decision({ id: 43, propositionId: null, remplace: 42 }) }),
    );
    const dom = await rendre(<Projets {...props()} />);
    await deplier(dom);
    await cliquer(bouton(dom, 'Revoir la décision'));
    const aucune = [...dom.querySelectorAll<HTMLInputElement>('.pj-cs-choix input')].at(-1);
    await cocher(aucune);
    await saisir(
      dom.querySelector<HTMLTextAreaElement>('.pj-cs-justification')!,
      'rien ne tient finalement',
    );
    await consigner(dom);

    expect(trancherConseil).toHaveBeenCalledWith('cs-1', {
      propositionId: null,
      justification: 'rien ne tient finalement',
      precedente: 42,
    });
  });

  it('LE REFUS (409) SE DIT — la décision de l’autre s’affiche, la vôtre n’est pas perdue', async () => {
    // Deux décisions signées « jeton de ruche » se ressemblent : sans avis,
    // l'opérateur refusé croirait la sienne rangée.
    vi.mocked(fetchConseils).mockResolvedValue({ conseils: [resume()] } as never);
    vi.mocked(fetchConseil)
      .mockResolvedValueOnce(session())
      .mockResolvedValue(
        session({ decision: decision({ justification: 'la raison d’un AUTRE' }) }),
      );
    vi.mocked(trancherConseil).mockRejectedValue(
      new ApiError('la décision a changé depuis votre lecture — relisez le conseil', 409),
    );
    const dom = await rendre(<Projets {...props()} />);
    await deplier(dom);
    await cocher(dom.querySelectorAll<HTMLInputElement>('.pj-cs-choix input')[0]);
    await saisir(dom.querySelector<HTMLTextAreaElement>('.pj-cs-justification')!, 'ma raison');
    await consigner(dom);

    const rangee = dom.querySelector('[data-testid="pj-cs-decision"]')?.textContent ?? '';
    expect(rangee, 'la décision en place est celle de l’autre').toContain('la raison d’un AUTRE');
    expect(rangee, 'le refus est dit').toContain('n’a pas été consignée');

    // La reprendre : le choix et la raison refusés reviennent, et la décision
    // à remplacer est la bonne.
    await cliquer(bouton(dom, 'Revoir la décision'));
    expect(dom.querySelector<HTMLTextAreaElement>('.pj-cs-justification')?.value).toBe('ma raison');
    expect(dom.querySelectorAll<HTMLInputElement>('.pj-cs-choix input')[0]?.checked).toBe(true);
    vi.mocked(trancherConseil).mockResolvedValue(session({ decision: decision({ id: 43 }) }));
    await consigner(dom);
    expect(trancherConseil).toHaveBeenLastCalledWith('cs-1', {
      propositionId: 'prop-a',
      justification: 'ma raison',
      precedente: 42,
    });
  });

  it('UN CONSEIL QUI DÉLIBÈRE NE SE TRANCHE PAS', async () => {
    vi.mocked(fetchConseils).mockResolvedValue({
      conseils: [resume({ etat: 'verification', issue: null, closedAt: null })],
    } as never);
    vi.mocked(fetchConseil).mockResolvedValue(session({ etat: 'verification', closedAt: null }));
    const dom = await rendre(<Projets {...props()} />);
    await deplier(dom);
    expect(dom.querySelector('.pj-cs-trancher'), 'un formulaire sur un verdict mouvant').toBeNull();
    expect(dom.querySelector('.pj-cs-detail')?.textContent).toContain('délibère encore');
  });
});

const vue = (over: Partial<VueWarRoom> = {}): VueWarRoom => ({
  projectId: null,
  taskId: null,
  entrees: [],
  tronque: false,
  desaccords: [],
  taches: {},
  conseils: {},
  journalElague: false,
  ...over,
});

describe('la War Room', () => {
  it('CE QUI ATTEND QUELQU’UN EN TÊTE, puis le fil du plus récent au plus ancien', async () => {
    vi.mocked(fetchWarRoom).mockResolvedValue(
      vue({
        desaccords: [
          { genre: 'conseil', sessionId: 'cs-1', issue: 'epuise', depuis: 1_000 },
          {
            genre: 'tache',
            taskId: 't-1',
            resultId: 8,
            raison: 'attempts_exhausted',
            objections: ['le cas du jeton vide n’est pas traité'],
            depuis: 2_000,
          },
        ],
        entrees: [
          {
            genre: 'contre_verdict',
            id: 1,
            ts: 1_000,
            taskId: 't-1',
            resultId: 8,
            relecteur: 'codex',
            conteste: true,
            objections: ['le cas du jeton vide n’est pas traité'],
            criteres: [],
            marqueurIllisible: false,
          },
          {
            genre: 'renvoi_refuse',
            id: 2,
            ts: 2_000,
            taskId: 't-1',
            resultId: 8,
            raison: 'attempts_exhausted',
          },
        ],
        taches: { 't-1': { titre: 'Ajouter une garde', projectId: 'p-1' } },
        conseils: { 'cs-1': { question: 'Quel socle ?', projectId: 'p-1' } },
        journalElague: true,
      }),
    );
    const dom = await rendre(<WarRoom {...props()} />);

    const desaccords = dom.querySelector('.wr-desaccords')?.textContent ?? '';
    expect(desaccords).toContain('Quel socle ?');
    expect(desaccords).toContain('arrêté sans converger');
    expect(desaccords).toContain('Ajouter une garde');
    expect(desaccords).toContain('essais épuisés');
    expect(desaccords).toContain('le cas du jeton vide n’est pas traité');

    const lignes = [...dom.querySelectorAll('.wr-entree')];
    expect(lignes[0]?.textContent, 'le plus récent en tête').toContain(
      'Renvoi en correction refusé',
    );
    expect(lignes[1]?.className, 'une objection ne se lit pas comme un accord').toContain(
      'wr-ton-objection',
    );
    // Un fil court qui aurait l'air complet est le mensonge le plus facile.
    expect(dom.querySelector('.wr-aveu')).not.toBeNull();
  });

  it('CLIQUER UNE TÂCHE MONTRE SON DÉBAT ENTIER', async () => {
    vi.mocked(fetchWarRoom).mockResolvedValue(
      vue({
        entrees: [{ genre: 'revue_humaine', id: 1, ts: 1, taskId: 't-1', etat: 'rejected' }],
        taches: { 't-1': { titre: 'Ajouter une garde', projectId: 'p-1' } },
      }),
    );
    const dom = await rendre(<WarRoom {...props()} />);
    expect(fetchWarRoom).toHaveBeenLastCalledWith({ projectId: null, taskId: null });
    await cliquer(dom.querySelector('.wr-sujet'));
    expect(fetchWarRoom).toHaveBeenLastCalledWith({ projectId: null, taskId: 't-1' });
  });

  it('UNE WAR ROOM ILLISIBLE LE DIT', async () => {
    vi.mocked(fetchWarRoom).mockRejectedValue(new Error('Erreur 500'));
    const dom = await rendre(<WarRoom {...props()} />);
    expect(dom.textContent).toContain('War Room indisponible');
  });

  it('CHANGER DE PROJET REPLIE LE CONSEIL DU PROJET D’AVANT — on ne tranche pas A sous B', async () => {
    const deuxProjets = {
      ...snapshot,
      projects: [
        { id: 'p-1', name: 'Un', repoUrl: null, createdAt: 1 },
        { id: 'p-2', name: 'Deux', repoUrl: null, createdAt: 2 },
      ],
    } as unknown as StateSnapshot;
    vi.mocked(fetchConseils).mockResolvedValue({
      conseils: [
        resume({ id: 'cs-1', question: 'Question du projet UN' }),
        resume({ id: 'cs-2', question: 'Question du projet DEUX', projectId: 'p-2' }),
      ],
    } as never);
    vi.mocked(fetchConseil).mockImplementation((id: string) =>
      Promise.resolve(
        id === 'cs-1'
          ? session({ danses: [danse('prop-1', 'Piste du projet UN')] })
          : session({ id: 'cs-2', projectId: 'p-2', danses: [danse('prop-2', 'Piste DEUX')] }),
      ),
    );
    vi.mocked(fetchWarRoom).mockImplementation((q) =>
      Promise.resolve(
        vue({
          projectId: q?.projectId ?? null,
          desaccords:
            q?.projectId == null
              ? [{ genre: 'conseil', sessionId: 'cs-2', issue: 'depart', depuis: 1 }]
              : [],
          conseils: { 'cs-2': { question: 'Question du projet DEUX', projectId: 'p-2' } },
        }),
      ),
    );
    const naviguer = vi.fn();
    const monter = (selectedId: string | null) => (
      <WarRoom {...props({ snapshot: deuxProjets, selectedId, onNavigate: naviguer })} />
    );
    const dom = await rendre(monter('p-1'));
    await cliquer(dom.querySelector('.wr-conseil .pj-cs-question'));
    expect(dom.querySelector('.wr-conseil')?.textContent).toContain('Piste du projet UN');

    await act(async () => racine?.render(monter('p-2')));
    await act(async () => {});
    const panneau = dom.querySelector('.wr-conseil')?.textContent ?? '';
    expect(panneau).toContain('Question du projet DEUX');
    expect(panneau, 'le conseil de A reste ouvert sous B').not.toContain('Piste du projet UN');
    expect(dom.querySelector('.wr-conseil .pj-cs-trancher')).toBeNull();

    // Depuis toute la ruche, « Trancher » mène au projet du conseil et le
    // déplie LÀ — le bon conseil, sous le bon projet.
    await act(async () => racine?.render(monter(null)));
    await act(async () => {});
    await cliquer(bouton(dom.querySelector('.wr-desaccords')!, 'Trancher'));
    expect(naviguer).toHaveBeenLastCalledWith('warroom', 'p-2', { replace: true });
    await act(async () => racine?.render(monter('p-2')));
    await act(async () => {});
    expect(dom.querySelector('.wr-conseil .pj-cs-detail')?.textContent).toContain('Piste DEUX');
  });

  it('CE QUE LA REINE NE CONNAÎT PLUS SE LIT, MAIS NE SE CLIQUE PAS', async () => {
    vi.mocked(fetchWarRoom).mockResolvedValue(
      vue({
        desaccords: [
          {
            genre: 'tache',
            taskId: 't-ancienne',
            resultId: 3,
            raison: 'delivery_exists',
            objections: [],
            depuis: 1,
          },
        ],
        entrees: [
          { genre: 'conseil_ouvert', id: 1, ts: 1, sessionId: 'cs-elague' },
          { genre: 'revue_humaine', id: 2, ts: 2, taskId: 't-disparue', etat: 'approved' },
        ],
        // Ni la tâche disparue ni le conseil élagué ne sont joints.
        taches: { 't-ancienne': { titre: 'Une vieille tâche', projectId: 'p-1' } },
      }),
    );
    const naviguer = vi.fn();
    const dom = await rendre(<WarRoom {...props({ onNavigate: naviguer })} />);
    const sujets = [...dom.querySelectorAll<HTMLButtonElement>('.wr-sujet')];
    expect(sujets.map((b) => b.disabled)).toEqual([true, true]);

    // Hors de l'instantané, la Miellerie choisirait en silence une AUTRE
    // tâche : le bouton ne s'offre pas, et l'écran dit pourquoi.
    const desaccords = dom.querySelector('.wr-desaccords')!;
    expect(bouton(desaccords as HTMLElement, 'Revoir en Miellerie')).toBeUndefined();
    expect(desaccords.textContent).toContain('hors de l’instantané');
  });

  it('UN FILTRE DE TÂCHE EN ERREUR RESTE RETIRABLE', async () => {
    vi.mocked(fetchWarRoom).mockImplementation((q) =>
      q?.taskId
        ? Promise.reject(new ApiError('tâche inconnue', 404))
        : Promise.resolve(
            vue({
              entrees: [{ genre: 'revue_humaine', id: 1, ts: 1, taskId: 't-1', etat: 'approved' }],
              taches: { 't-1': { titre: 'Ajouter une garde', projectId: 'p-1' } },
            }),
          ),
    );
    const dom = await rendre(<WarRoom {...props()} />);
    await cliquer(dom.querySelector('.wr-sujet'));
    expect(dom.textContent).toContain('War Room indisponible');
    await cliquer(bouton(dom, 'Retirer le filtre de tâche'));
    expect(fetchWarRoom).toHaveBeenLastCalledWith({ projectId: null, taskId: null });
    expect(dom.textContent).not.toContain('War Room indisponible');
  });

  it('UN PROJET CHOISI MONTE LE PANNEAU DU CONSEIL — le même que la carte projet', async () => {
    vi.mocked(fetchWarRoom).mockResolvedValue(vue({ projectId: 'p-1' }));
    const dom = await rendre(<WarRoom {...props({ selectedId: 'p-1' })} />);
    await cliquer(bouton(dom, 'Réunir le Conseil'));
    expect(dom.querySelector('.wr-conseil .pj-cs-reunir')).not.toBeNull();
  });
});

describe('l’accès depuis la Ruche', () => {
  it('LE COMPTE DE CE QUI ATTEND, et un clic pour y aller', async () => {
    vi.mocked(fetchWarRoom).mockResolvedValue(
      vue({
        desaccords: [
          { genre: 'conseil', sessionId: 'a', issue: 'depart', depuis: 1 },
          { genre: 'conseil', sessionId: 'b', issue: 'epuise', depuis: 2 },
        ],
      }),
    );
    const naviguer = vi.fn();
    const dom = await rendre(<AccesWarRoom refreshTick={0} onNavigate={naviguer} />);
    // Le cockpit ne relit que le compte, pas tout le fil.
    expect(fetchWarRoom).toHaveBeenCalledWith({ limite: 0 });
    const acces = dom.querySelector('[data-testid="acces-war-room"]')!;
    expect(acces.textContent).toContain('2 désaccord(s) à trancher');
    await cliquer(acces);
    expect(naviguer).toHaveBeenCalledWith('warroom');
  });

  it('UN ÉCHEC APRÈS UNE LECTURE RÉUSSIE NE GARDE PAS L’ANCIEN COMPTE', async () => {
    // Le jeton révoqué, la Reine qui redémarre : le dernier « aucun » lu
    // n'est plus une information.
    vi.mocked(fetchWarRoom).mockResolvedValueOnce(vue()).mockRejectedValue(new Error('Erreur 401'));
    const dom = await rendre(<AccesWarRoom refreshTick={0} onNavigate={() => {}} />);
    const acces = () => dom.querySelector('[data-testid="acces-war-room"]')?.textContent ?? '';
    expect(acces()).toContain('aucun désaccord en suspens');
    await act(async () => racine?.render(<AccesWarRoom refreshTick={1} onNavigate={() => {}} />));
    await act(async () => {});
    expect(acces()).toContain('état inconnu');
    expect(acces()).not.toContain('aucun');
  });

  it('« JE N’AI PAS PU LIRE » N’EST PAS « AUCUN »', async () => {
    vi.mocked(fetchWarRoom).mockRejectedValue(new Error('Erreur 401'));
    const dom = await rendre(<AccesWarRoom refreshTick={0} onNavigate={() => {}} />);
    const texte = dom.querySelector('[data-testid="acces-war-room"]')?.textContent ?? '';
    expect(texte).toContain('état inconnu');
    expect(texte).not.toContain('aucun');
  });
});

describe('les lignes du fil', () => {
  const t = (fr: string) => fr;
  it('un code de refus inconnu est rendu TEL QUEL, jamais traduit au hasard', () => {
    const l = direEntree(
      { genre: 'renvoi_refuse', id: 1, ts: 1, taskId: 't', resultId: null, raison: 'code_futur' },
      t,
      (n) => n,
    );
    expect(l.texte).toContain('code_futur');
  });

  it('les éclaireuses sont NOMMÉES, et un signal d’arrêt est une objection', () => {
    const l = direEntree(
      {
        genre: 'conseil_avis',
        id: 1,
        ts: 1,
        sessionId: 's',
        propositionId: 'p',
        nodeId: 'n-codex',
        avis: 'arret',
        tour: 2,
      },
      t,
      (n) => (n === 'n-codex' ? 'Codex du salon' : n),
    );
    expect(l).toMatchObject({ ton: 'objection' });
    expect(l.texte).toContain('Codex du salon');
  });
});
