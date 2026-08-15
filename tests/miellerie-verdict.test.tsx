// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE VERDICT AU CLAVIER — `a` approuve, `x` rejette, `u` annule, et la file
// avance toute seule.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// `miellerie-clavier` défend le DÉPLACEMENT dans la file (`j`, `k`, `i`, les
// gardes de saisie et de modificateur). Il s'arrête là. Le geste qui donne son
// nom à l'écran — POSER UN VERDICT — n'était joué nulle part.
//
// Nudité mesurée avant d'écrire une ligne (§ 9 quaterdecicenties) : les trois
// gardes ci-dessous ont été mutées ENSEMBLE, chaque mutant vérifié posé, et la
// suite entière est restée verte — 275 fichiers, 4 114 tests.
//
//     if (!e.repeat) decide('approved');   →   decide('approved');
//     if (state === null) return;          →   (retiré)
//     rest.find((t) => getReview(t.id) === null)   →   rest[0]
//
// ─── CE QUE CHACUNE PORTE, ET CE QU'ELLE COÛTE ───────────────────────────────
//
//   · `e.repeat` — la Miellerie AVANCE toute seule après un verdict. Sans la
//     garde, garder `a` enfoncé une seconde n'approuve pas une production :
//     il approuve TOUTE LA FILE, une par répétition clavier, sans un clic.
//     C'est la seule garde du dépôt dont le défaut se mesure en productions
//     livrées à tort ;
//
//   · le retour anticipé sur `null` — annuler n'est pas juger. `u` retire un
//     verdict posé par erreur ; s'il avançait comme `a` et `x`, la production
//     qu'on venait de corriger disparaîtrait de l'écran au moment même où l'on
//     voulait la relire ;
//
//   · `getReview(t.id) === null` — l'auto-avance saute ce qui est DÉJÀ jugé.
//     Sans ce filtre, la file rejoue les productions déjà revues et l'on ne
//     tombe jamais sur celles qui attendent : le travail à faire devient
//     inatteignable au clavier, précisément dans l'écran fait pour lui.
//
// ─── POURQUOI LE BANC REBRANCHE `selectedId` ─────────────────────────────────
//
// Dans le produit, `select()` change le hash, et la vue est remontée avec le
// nouveau `selectedId`. Un banc qui se contenterait d'ENREGISTRER les demandes
// — ce que fait `miellerie-clavier`, à juste titre pour `j`/`k` — laisserait la
// tâche active immobile : la deuxième frappe de `a` retomberait sur la même
// production, et « maintenir la touche approuve la file » serait invérifiable.
//
// Ici on referme la boucle : `onNavigate` REMONTE la vue. C'est la condition
// physique de la mesure (§ 9 septvicicenties).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { getReview, hydrateReviews } from '../dashboard/src/views/shared';
import type { ReviewState, ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot, Task } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'coulée-1' })),
  postReview: vi.fn(() => Promise.resolve()),
}));

import Miellerie from '../dashboard/src/views/Miellerie';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
/** Ce que la vue a demandé de sélectionner, dans l'ordre. */
let demandes: string[] = [];

/**
 * Le cache des verdicts vit EN MÉMOIRE (`serverReviews`), pas dans
 * `localStorage` — vider le stockage ne le remet pas à zéro, et le premier cas
 * de ce fichier a d'abord teinté le deuxième par cette porte-là. `hydrateReviews`
 * est la remise à plat que le dépôt utilise déjà (`revues-hors-ligne`).
 */
beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  hydrateReviews({});
  demandes = [];
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  localStorage.clear();
  hydrateReviews({});
});

function tache(id: string, updatedAt: number, status: Task['status'] = 'done'): Task {
  return {
    id,
    projectId: 'p1',
    title: `Production ${id}`,
    prompt: 'p',
    status,
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt,
  };
}

/** Des verdicts déjà posés — ce qu'un tour de revue précédent aurait laissé. */
function verdictDeja(deja: Record<string, ReviewState>): void {
  hydrateReviews(deja);
}

/**
 * Monte la vue et REBRANCHE la sélection : quand la Miellerie demande à passer
 * à une autre production, on la remonte avec ce `selectedId` — exactement ce
 * que fait la coquille via le hash. Sans ce rebranchement, la tâche active ne
 * bougerait jamais et l'auto-avance serait invisible.
 */
async function monter(taches: Task[], depart?: string): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);

  const snapshot = {
    projects: [{ id: 'p1', name: 'Rucher', repoUrl: null }],
    nodes: [],
    tasks: taches,
    tasksTotal: taches.length,
  } as unknown as StateSnapshot;

  const rendre = (selectedId: string | null): void => {
    const props = {
      snapshot,
      events: [],
      agentsByTask: {},
      deferred: new Set(),
      selectedId,
      onOpenTask: () => {},
      onNavigate: (_vue: string, id?: string) => {
        if (!id) return;
        demandes.push(id);
        rendre(id);
      },
      navigate: () => {},
      refreshTick: 0,
    } as unknown as ViewProps;
    racine?.render(<Miellerie {...props} />);
  };

  await act(async () => rendre(depart ?? null));
  await act(async () => {});
}

/** Frappe une touche sur la fenêtre — c'est là que la vue écoute. */
async function frapper(touche: string, repeat = false): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: touche, bubbles: true, repeat }));
  });
  await act(async () => {});
}

/**
 * Les verdicts tels que L'ÉCRAN les lira — `getReview` est l'accès du produit,
 * et le seul qui recouvre le cache mémoire ET le repli local.
 */
const verdicts = (): Record<string, ReviewState> =>
  Object.fromEntries(
    ['a', 'b', 'c'].map((id) => [id, getReview(id)]).filter(([, v]) => v !== null),
  ) as Record<string, ReviewState>;

/** Le point de verdict d'une rangée, lu où l'utilisateur le voit. */
function pastille(id: string): string {
  const rangees = [...document.querySelectorAll('.mi-row')];
  const rangee = rangees.find((r) => r.textContent?.includes(`Production ${id}`));
  if (!rangee) throw new Error(`la rangée « ${id} » est introuvable`);
  return rangee.querySelector('.mi-dot')?.className ?? '';
}

// Trois productions, la plus fraîche en tête : à rang de revue égal, la file
// trie par fraîcheur. L'ordre affiché est donc c, b, a.
const TROIS = [tache('a', 1_000), tache('b', 2_000), tache('c', 3_000)];

describe('le verdict au clavier', () => {
  it('`a` APPROUVE LA PRODUCTION ACTIVE — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Tout ce fichier compte des verdicts posés. Si la touche ne posait aucun
    // verdict du tout, « maintenir `a` n'approuve pas la file » serait vert en
    // comparant deux absences — un banc qui ne peut pas rougir.
    await monter(TROIS);
    expect(pastille('c'), 'la production part déjà jugée').not.toContain('ok');

    await frapper('a');

    expect(verdicts(), '`a` ne pose aucun verdict').toEqual({ c: 'approved' });
    expect(pastille('c'), 'le verdict posé ne se voit pas à l’écran').toContain('ok');
  });

  it('`x` REJETTE — et les deux touches ne disent JAMAIS la même chose', async () => {
    // Le contraste : un banc qui vérifierait seulement « un verdict est posé »
    // resterait vert sur une mutation qui échange l'approbation et le rejet.
    await monter(TROIS);
    await frapper('x');

    expect(verdicts(), '`x` n’enregistre pas un rejet').toEqual({ c: 'rejected' });
    expect(pastille('c'), 'le rejet ne se voit pas').toContain('ko');
    expect(pastille('c'), 'rejeter et approuver peignent pareil').not.toContain('ok');
  });

  it('MAINTENIR `a` N’APPROUVE PAS TOUTE LA FILE', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // La Miellerie avance toute seule après un verdict. Le clavier, lui, répète
    // tant que la touche reste enfoncée — des dizaines de fois par seconde.
    //
    // Sans `e.repeat`, garder `a` appuyé une seconde n'approuve pas UNE
    // production : il approuve la file entière, une par répétition, et livre du
    // travail que personne n'a lu. C'est la seule garde du dépôt dont le défaut
    // se compte en productions livrées à tort.
    //
    // Le premier appui est VRAI (`repeat: false`) : c'est le geste de
    // l'utilisateur, et il doit aboutir. Les suivants sont la répétition
    // automatique du clavier, et eux seuls doivent être refusés.
    await monter(TROIS);

    await frapper('a'); // le vrai appui
    await frapper('a', true); // le clavier répète…
    await frapper('a', true);
    await frapper('a', true);

    expect(
      Object.keys(verdicts()).sort(),
      'la répétition du clavier a jugé des productions que personne n’a lues',
    ).toEqual(['c']);
  });

  it('`u` ANNULE SANS AVANCER — on relit ce qu’on vient de corriger', async () => {
    // ─── LE RETOUR ANTICIPÉ SUR `null` ─────────────────────────────────────
    //
    // Annuler n'est pas juger. `u` sert à retirer un verdict posé par erreur —
    // le seul moment où l'on veut RESTER sur la production, pour la relire.
    //
    // Sans le retour anticipé, `u` avancerait comme `a` et `x` : la production
    // qu'on vient de libérer quitterait l'écran à l'instant précis où l'on
    // voulait la reprendre.
    //
    // ─── LA FORME QUE L'ENTRÉE DOIT AVOIR ──────────────────────────────────
    //
    // Il faut que la production annulée soit DÉJÀ jugée — sinon `u` n'a rien à
    // retirer — et qu'il reste ailleurs de quoi avancer : sans production en
    // attente, l'auto-avance ne trouverait rien et le mutant passerait pour
    // sage. On part donc de `a` jugée et sélectionnée, `b` et `c` en attente.
    //
    // (C'est aussi pour cela qu'on ne juge pas d'abord avec `a` : le verdict
    // fait AVANCER, et `u` porterait alors sur la production suivante — pas sur
    // celle qu'on voulait corriger.)
    verdictDeja({ a: 'approved' });
    await monter(TROIS, 'a');
    expect(verdicts(), 'le verdict à annuler n’est pas en place').toEqual({ a: 'approved' });

    const avant = demandes.length;
    await frapper('u');

    expect(verdicts(), '`u` ne retire pas le verdict').toEqual({});
    expect(
      demandes.slice(avant),
      'annuler a fait avancer la file : la production corrigée a quitté l’écran',
    ).toEqual([]);
  });

  it('L’AUTO-AVANCE SAUTE CE QUI EST DÉJÀ JUGÉ', async () => {
    // ─── L'ENTRÉE QUI DÉPARTAGE ────────────────────────────────────────────
    //
    // `rest.find((t) => getReview(t.id) === null)` contre `rest[0]` : il faut
    // que la production SUIVANTE soit déjà jugée et qu'une autre attende plus
    // loin. Sans cette forme précise, les deux mènent au même endroit et le
    // banc bénirait la mutation.
    //
    // La file trie les jugées EN DERNIER ; on se sert donc du bouclage. Avec
    // `a`(déjà rejetée), `b` et `c` en attente, l'ordre affiché est c, b, a.
    // On juge `b` : le reste est [a, c] — `a` est jugée, `c` attend.
    //
    //     avec le filtre : on va sur `c`, celle qui attend ;
    //     sans le filtre : on retombe sur `a`, déjà jugée.
    //
    // Sans ce filtre, la file rejoue indéfiniment ce qui est fait et ne mène
    // jamais à ce qui reste — le travail à faire devient inatteignable au
    // clavier, dans l'écran fait pour lui.
    verdictDeja({ a: 'rejected' });
    await monter(TROIS, 'b');

    await frapper('a');

    expect(demandes.at(-1), 'la file est retombée sur une production déjà jugée').toBe('c');
  });

  it('QUAND TOUT EST JUGÉ, LA FILE NE BOUGE PLUS', async () => {
    // Le bord de l'auto-avance : `rest.find(...)` peut ne rien trouver, et
    // `if (next)` est ce qui empêche `select(undefined)`. On juge la dernière
    // production en attente — il ne reste alors nulle part où aller.
    verdictDeja({ a: 'rejected', b: 'approved' });
    await monter(TROIS);

    const avant = demandes.length;
    await frapper('a');

    expect(verdicts().c, 'la dernière production n’a pas été jugée').toBe('approved');
    expect(
      demandes.slice(avant),
      'la file a demandé une production alors qu’il n’en restait aucune à juger',
    ).toEqual([]);
  });
});
