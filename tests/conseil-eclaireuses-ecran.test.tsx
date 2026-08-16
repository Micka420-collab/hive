// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CONSEIL DES ÉCLAIREUSES À L'ÉCRAN — ce qui est RANGÉ, et ce qui est LU MAINTENANT.
//
// ─── DEUX QUESTIONS QUI SE RESSEMBLENT, ET QU'IL NE FAUT PAS CONFONDRE ───────
//
// Le panneau montre les délibérations d'un projet. Deux endroits y annoncent une
// « issue », et ce ne sont PAS les mêmes questions — le code le dit lui-même :
//
//     « La liste rend l'issue RANGÉE — celle d'un conseil clos — donc `null`
//       tant qu'il délibère. Le détail, lui, RECALCULE ce que le protocole
//       dirait à cet instant. Afficher l'un pour l'autre donnerait un résumé
//       qui contredit son propre détail. »
//
// D'où deux gardes jumelles :
//
//     {c.issue ? t(ISSUE[c.issue]…) : t('délibère encore')}   ← la LISTE
//     {!session.closedAt && ` — ${t('provisoire')}`}          ← le DÉTAIL
//
// La première refuse d'inventer une conclusion à un conseil qui débat encore.
// La seconde avoue que la conclusion affichée peut encore changer. Sans elles,
// l'écran présente une lecture instantanée comme un verdict rangé — et le
// projet se décide sur un chiffre qui n'a pas fini de bouger.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Recensement fait depuis la RACINE, sur les DEUX racines de bancs
// (§ 9 quattuortrigicenties) : `ConseilProjet` n'est monté nulle part.
// `projets-alveoles` garde l'étoile de la danse retenue, rien d'autre.
//
// Quatre mutants posés ensemble, chacun vérifié posé, suite entière verte —
// 283 fichiers, 4 153 tests :
//
//     c.issue ? … : 'délibère encore'        →  … : ISSUE.vide
//     !session.closedAt && ' — provisoire'   →  session.closedAt && …
//     .filter((c) => c.projectId === projectId)  →  .filter(() => true)
//     if (miens.length === 0) return null    →  === -1

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import type { ConseilResume, SessionConseil } from '../dashboard/src/api';

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

import { fetchConseil, fetchConseils } from '../dashboard/src/api';
import Projets from '../dashboard/src/views/Projets';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
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

/** Un conseil TEL QUE LA LISTE le rend : son issue est rangée, ou nulle. */
const resume = (over: Partial<ConseilResume> = {}): ConseilResume => ({
  id: 'cs-1',
  question: 'Quel socle pour la ruche ?',
  projectId: 'p-1',
  etat: 'ouvert',
  tour: 1,
  issue: null,
  createdAt: 0,
  closedAt: null,
  ...over,
});

/** Une session TELLE QUE LE DÉTAIL la rend : son issue est RECALCULÉE. */
const session = (over: Partial<SessionConseil> = {}): SessionConseil => ({
  id: 'cs-1',
  question: 'Quel socle pour la ruche ?',
  projectId: 'p-1',
  etat: 'ouvert',
  tour: 2,
  issue: 'quorum',
  createdAt: 0,
  closedAt: null,
  enVol: 0,
  danses: [],
  retenue: null,
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

/** Monte la vue sur les conseils donnés. */
async function avecConseils(conseils: ConseilResume[]): Promise<HTMLElement> {
  vi.mocked(fetchConseils).mockResolvedValue({ conseils } as never);
  return monter();
}

/** Déplie le premier conseil listé — c'est là que le DÉTAIL apparaît. */
async function deplier(dom: HTMLElement): Promise<void> {
  const q = dom.querySelector<HTMLElement>('.pj-cs-question');
  if (!q) throw new Error('aucune question de conseil à déplier');
  await act(async () => {
    q.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

const lignes = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.pj-cs-liste li'),
];
const resumeDetail = (dom: HTMLElement): string =>
  dom.querySelector('.pj-cs-resume')?.textContent ?? '';

describe('le Conseil des Éclaireuses : le rangé et l’instantané', () => {
  it('UN CONSEIL CLOS ANNONCE SON ISSUE — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Sans lui, « un conseil qui délibère ne conclut pas » serait vert sur un
    // panneau qui n'affiche aucune issue du tout.
    const dom = await avecConseils([resume({ issue: 'quorum', closedAt: 10 })]);

    expect(dom.textContent, 'le panneau du Conseil ne se rend pas').toContain(
      'Conseil des Éclaireuses',
    );
    expect(lignes(dom), 'le conseil n’est pas listé').toHaveLength(1);
    expect(lignes(dom)[0]!.textContent, 'l’issue rangée n’est pas annoncée').toContain(
      'une piste a convergé',
    );
  });

  it('UN CONSEIL QUI DÉLIBÈRE NE SE VOIT PAS ATTRIBUER DE CONCLUSION', async () => {
    // ─── LA PREMIÈRE JUMELLE ───────────────────────────────────────────────
    //
    // `issue` vaut `null` tant que le conseil n'est pas clos : c'est l'issue
    // RANGÉE, et elle n'existe pas encore. Muté, l'écran choisit une issue à sa
    // place — ici « personne n'a rien trouvé », qui est un verdict, et faux.
    const dom = await avecConseils([resume({ issue: null, closedAt: null })]);

    const l = lignes(dom)[0]!;
    expect(l.textContent, 'un conseil en cours n’est pas annoncé comme tel').toContain(
      'délibère encore',
    );
    expect(l.textContent, 'une conclusion est prêtée à un conseil qui débat').not.toContain(
      'personne n’a rien trouvé',
    );
  });

  it('LE DÉTAIL D’UN CONSEIL OUVERT SE DIT PROVISOIRE — et un conseil clos ne le dit pas', async () => {
    // ─── LA SECONDE JUMELLE, ET SES DEUX MONDES ────────────────────────────
    //
    // Le détail RECALCULE ce que le protocole dirait maintenant. Sur un conseil
    // ouvert, ce verdict peut encore changer : le taire ferait passer une
    // lecture instantanée pour une conclusion.
    //
    // Muté en `session.closedAt &&`, les deux mondes s'échangent — l'ouvert
    // s'affiche ferme, et le clos s'excuse d'être provisoire. On mesure donc
    // les deux (§ 9 octovicicenties).
    const ouvert = await avecConseils([resume()]);
    vi.mocked(fetchConseil).mockResolvedValue(session({ closedAt: null }) as never);
    await deplier(ouvert);
    expect(resumeDetail(ouvert), 'un verdict encore mouvant se donne pour définitif').toContain(
      'provisoire',
    );

    act(() => racine?.unmount());
    conteneur?.remove();

    const clos = await avecConseils([resume({ issue: 'quorum', closedAt: 10 })]);
    vi.mocked(fetchConseil).mockResolvedValue(session({ closedAt: 10 }) as never);
    await deplier(clos);
    expect(
      resumeDetail(clos),
      'un conseil clos s’annonce provisoire — le mot ne veut plus rien dire',
    ).not.toContain('provisoire');
  });

  it('LA CARTE NE MONTRE QUE LES CONSEILS DE SON PROJET', async () => {
    // ─── LE BON SUJET ──────────────────────────────────────────────────────
    //
    // `fetchConseils` rend les conseils de TOUTE la ruche ; la carte filtre les
    // siens. Sans le filtre, la délibération d'un autre projet s'affiche sous
    // le nom de celui-ci — la question posée ailleurs, lue ici.
    const dom = await avecConseils([
      resume({ id: 'cs-mien', question: 'Quel socle pour la ruche ?', projectId: 'p-1' }),
      resume({ id: 'cs-autre', question: 'Question d’un AUTRE rucher', projectId: 'p-9' }),
    ]);

    expect(lignes(dom), 'la carte liste des conseils qui ne sont pas les siens').toHaveLength(1);
    expect(dom.textContent, 'la question d’un autre projet s’affiche ici').not.toContain(
      'AUTRE rucher',
    );
  });

  it('SANS DÉLIBÉRATION, LE PANNEAU SE TAIT — pas de section vide sur chaque carte', async () => {
    // Le silence est une décision, pas un oubli : ce panneau vit sur CHAQUE
    // carte de projet. Affiché vide, il ajouterait un titre creux à toutes.
    const dom = await avecConseils([]);

    expect(dom.textContent, 'un panneau de Conseil vide s’affiche quand même').not.toContain(
      'Conseil des Éclaireuses',
    );
  });
});
