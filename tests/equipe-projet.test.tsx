// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ÉQUIPE D'UN PROJET — les deux gardes que personne ne tenait.
//
// ─── CE QUI ÉTAIT DÉJÀ DÉFENDU, ET OÙ ────────────────────────────────────────
//
// Ce lot est petit EXPRÈS. La carte Équipe est déjà largement gardée, mais pas
// là où on la cherche : `dashboard/tests/` est une SECONDE racine de bancs, à
// côté de `tests/`. Vérifié par mutation :
//
//     if (!user) return null;                 défendue — sans elle, `user.id`
//                                             plus bas jette, et TOUTE la vue
//                                             Projets tombe (22 bancs rougissent)
//     jePeuxAdmettre && m.role !== 'owner'    défendue — dashboard/tests/gestes-panneaux
//     question={`Retirer ${nom} du projet ?`} défendue — dashboard/tests/geste-irreversible
//
// Et la SÉCURITÉ, elle, est ailleurs encore : `tests/adoption-admission.test.ts`
// éprouve les routes serveur (qui adopte, qui admet, et que le refus ressemble
// à une absence à l'octet près). Le commentaire du code le dit sans détour :
//
//     « Cosmétique, toujours : le serveur retranche de toute façon. On masque
//       ce qu'il refusera, on ne décide rien ici. »
//
// Ce fichier ne garde donc PAS un contrôle d'accès. Il garde deux gestes qui
// mentiraient à l'utilisateur.
//
// ─── LES DEUX QUI RESTAIENT NUES ─────────────────────────────────────────────
//
// Mutées séparément, suite entière verte à chaque fois — 282 fichiers,
// 4 150 tests :
//
//     disabled={occupe || aAdmettre.trim() === ''}   →  disabled={occupe}
//     {orphelin && jeSuisAdmin && (…)}               →  {(orphelin || jeSuisAdmin) && (…)}

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

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
  admettreMembre: vi.fn(() => Promise.resolve({})),
  adopterProjet: vi.fn(() => Promise.resolve({})),
  // Sondes des ENFANTS, pas de la vue (§ 9 duotrigicenties).
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  fetchGardeFou: vi.fn(() => Promise.resolve(null)),
  postReview: vi.fn(() => Promise.resolve()),
}));

import { admettreMembre } from '../dashboard/src/api';
import Projets from '../dashboard/src/views/Projets';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // 20 vraies connexions vers 127.0.0.1:3000 par lancement, mesurées.
  // Voir `tests/aide/sans-reseau.ts`.
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

/** Le projet, avec ou sans propriétaire. */
const projet = (ownerId: string | null) => ({
  id: 'p-1',
  name: 'Rucher',
  repoUrl: null,
  ownerId,
});

/** Le compte connecté. `role` décide de ce que la carte propose. */
const compte = (id: string, role: 'user' | 'admin') => ({
  id,
  role,
  email: 'x@y.z',
  displayName: 'Camille',
});

async function monter(
  ownerId: string | null,
  user: ReturnType<typeof compte> | null,
): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [projet(ownerId)],
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
    user,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Projets {...props} />));
  await act(async () => {});
  return document.body;
}

const boutonOuNull = (dom: HTMLElement, libelle: string): HTMLButtonElement | null =>
  ([...dom.querySelectorAll('button')].find((e) =>
    (e.textContent ?? '').includes(libelle),
  ) as HTMLButtonElement) ?? null;

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = boutonOuNull(dom, libelle);
  if (!b) throw new Error(`bouton « ${libelle} » introuvable`);
  return b;
}

/** Écrit dans un champ CONTRÔLÉ par React : le mutateur natif, jamais `.value`. */
function ecrire(champ: HTMLInputElement, texte: string): void {
  const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
    v: string,
  ) => void;
  poser.call(champ, texte);
  champ.dispatchEvent(new Event('input', { bubbles: true }));
}

const champIdentifiant = (dom: HTMLElement): HTMLInputElement => {
  const c = dom.querySelector<HTMLInputElement>('input[aria-label="Identifiant du compte"]');
  if (!c) throw new Error('le champ d’identifiant est introuvable');
  return c;
};

describe('la carte Équipe : deux gestes qui ne doivent pas mentir', () => {
  it('LE PROPRIÉTAIRE VOIT LA CARTE ET SON CHAMP — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Les deux cas suivants constatent l'ABSENCE de quelque chose. Sans ce
    // cas-ci, ils seraient verts sur une carte qui ne s'affiche pas du tout.
    const dom = await monter('u-1', compte('u-1', 'user'));

    expect(dom.textContent, 'la carte Équipe ne se rend pas').toContain('Équipe');
    expect(champIdentifiant(dom), 'le champ d’admission manque').not.toBeNull();
    // Le mode d'emploi : sans son propre identifiant affiché, « admettre par
    // identifiant » n'a aucun moyen d'être utilisé par l'autre bout.
    expect(dom.textContent, 'on ne peut pas donner son identifiant').toContain('Votre identifiant');
  });

  it('ADMETTRE EST MORT SUR UN CHAMP VIDE — et vif dès qu’on écrit', async () => {
    // ─── LA PORTE DU GESTE ─────────────────────────────────────────────────
    //
    // Sans la garde, le bouton part sur la chaîne vide : le serveur refuse (il
    // refuse toujours, c'est lui qui décide), et l'utilisateur reçoit une
    // erreur pour un geste que l'écran lui avait proposé. Un bouton vivant qui
    // ne peut qu'échouer est pire qu'un bouton mort.
    //
    // Le contraste porte le cas : mort PUIS vif, sinon un bouton toujours
    // désactivé passerait aussi.
    const dom = await monter('u-1', compte('u-1', 'user'));

    expect(bouton(dom, 'Admettre').disabled, 'le bouton est vif sur un champ vide').toBe(true);

    await act(async () => ecrire(champIdentifiant(dom), 'u-2'));
    await act(async () => {});
    expect(bouton(dom, 'Admettre').disabled, 'le bouton reste mort alors qu’on a écrit').toBe(
      false,
    );

    await act(async () => {
      bouton(dom, 'Admettre').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {});
    expect(admettreMembre, 'le geste ne part pas').toHaveBeenCalledWith('p-1', 'u-2');
  });

  it('ADOPTER NE S’OFFRE QUE SUR UN PROJET ORPHELIN, ET QU’À UN ADMIN', async () => {
    // ─── LES DEUX MOITIÉS DU `&&` ──────────────────────────────────────────
    //
    // Muté en `||`, le bloc sort dans DEUX situations fausses : un admin le
    // voit sur un projet déjà tenu — « Adopter ce projet » proposé sur le
    // projet de quelqu'un d'autre — et n'importe qui le voit sur un orphelin.
    //
    // Trois montages, parce que `&&` ne se départage pas en moins : les deux
    // moitiés vraies, puis chacune fausse à son tour.
    const tenu = await monter('u-9', compte('u-1', 'admin'));
    expect(
      boutonOuNull(tenu, 'Adopter ce projet'),
      'un admin se voit proposer d’adopter le projet d’un autre',
    ).toBeNull();

    act(() => racine?.unmount());
    conteneur?.remove();
    const orphelinSansDroit = await monter(null, compte('u-1', 'user'));
    expect(
      boutonOuNull(orphelinSansDroit, 'Adopter ce projet'),
      'une ouvrière ordinaire se voit proposer d’adopter',
    ).toBeNull();

    act(() => racine?.unmount());
    conteneur?.remove();
    const orphelinAdmin = await monter(null, compte('u-1', 'admin'));
    expect(
      boutonOuNull(orphelinAdmin, 'Adopter ce projet'),
      'l’admin ne peut pas adopter un projet sans propriétaire — le cul-de-sac reste fermé',
    ).not.toBeNull();
  });
});
