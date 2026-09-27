import { describe, expect, it } from 'vitest';
import {
  ancetreEchoue,
  descendantsEnVol,
  jugerDelegation,
  slotsOccupes,
  type DemandeDelegation,
  type NoeudDelegation,
} from '../src/orchestrator/delegation.js';
import { LIMITES_DELEGATION_DEFAUT } from '../src/shared/limites-delegation.js';

const root = (patch: Partial<NoeudDelegation> = {}): NoeudDelegation => ({
  taskId: 'root',
  rootTaskId: 'root',
  parentTaskId: null,
  depth: 0,
  status: 'running',
  origine: 'hive',
  ...patch,
});

const demande = (patch: Partial<DemandeDelegation> = {}): DemandeDelegation => ({
  childTaskId: 'child',
  parentTaskId: 'root',
  title: 'Tester le runtime',
  prompt: 'Exécute les tests ciblés et rapporte les preuves.',
  durationMs: 60_000,
  costMicros: 100_000,
  resourceUnits: 1,
  ...patch,
});

describe('délégation Hive bornée', () => {
  it('produit un lien racine/parent/enfant sans choisir le modèle', () => {
    const verdict = jugerDelegation(
      demande({ preferredAgent: 'codex', preferredModel: 'modele-neuf' }),
      [root()],
    );
    expect(verdict).toEqual({
      ok: true,
      plan: expect.objectContaining({
        childTaskId: 'child',
        parentTaskId: 'root',
        rootTaskId: 'root',
        depth: 1,
        preferredAgent: 'codex',
        preferredModel: 'modele-neuf',
      }),
    });
  });

  it.each([
    ['done', 'parent_termine'],
    ['failed', 'parent_termine'],
  ] as const)('refuse un parent %s', (status, code) => {
    expect(jugerDelegation(demande(), [root({ status })])).toMatchObject({ ok: false, code });
  });

  it('refuse un parent absent et un identifiant dupliqué', () => {
    expect(jugerDelegation(demande(), [])).toMatchObject({ ok: false, code: 'parent_absent' });
    expect(jugerDelegation(demande(), [root(), root({ taskId: 'child' })])).toMatchObject({
      ok: false,
      code: 'task_id_duplique',
    });
  });

  it('borne profondeur, enfants Hive et descendants Hive', () => {
    const profond = root({ taskId: 'p', depth: LIMITES_DELEGATION_DEFAUT.maxDepth });
    expect(jugerDelegation(demande({ parentTaskId: 'p' }), [profond])).toMatchObject({
      ok: false,
      code: 'profondeur',
    });

    const enfants = Array.from({ length: LIMITES_DELEGATION_DEFAUT.maxChildrenPerParent }, (_, i) =>
      root({ taskId: `c${i}`, parentTaskId: 'root', depth: 1 }),
    );
    expect(jugerDelegation(demande(), [root(), ...enfants])).toMatchObject({
      ok: false,
      code: 'enfants',
    });

    const descendants = Array.from(
      { length: LIMITES_DELEGATION_DEFAUT.maxDescendantsPerRoot },
      (_, i) => root({ taskId: `d${i}`, parentTaskId: `p${i}`, depth: 2 }),
    );
    expect(jugerDelegation(demande(), [root(), ...descendants])).toMatchObject({
      ok: false,
      code: 'descendants',
    });
  });

  it('garde les sous-agents natifs distincts des enfants orchestrés', () => {
    const natifs = Array.from({ length: 20 }, (_, i) =>
      root({ taskId: `native${i}`, parentTaskId: 'root', depth: 1, origine: 'native' }),
    );
    expect(jugerDelegation(demande(), [root(), ...natifs])).toMatchObject({ ok: true });
  });

  it.each([
    [{ durationMs: LIMITES_DELEGATION_DEFAUT.maxDurationMs + 1 }, 'duree'],
    [{ costMicros: LIMITES_DELEGATION_DEFAUT.maxCostMicros + 1 }, 'cout'],
    [{ resourceUnits: LIMITES_DELEGATION_DEFAUT.maxResourceUnits + 1 }, 'ressources'],
    [{ durationMs: Number.NaN }, 'duree'],
    [{ costMicros: -1 }, 'cout'],
  ] as const)('refuse un budget hors borne %#', (patch, code) => {
    expect(jugerDelegation(demande(patch), [root()])).toMatchObject({ ok: false, code });
  });

  it('borne et normalise le titre et la mission', () => {
    expect(jugerDelegation(demande({ title: ' ', prompt: 'ok' }), [root()])).toMatchObject({
      ok: false,
      code: 'titre',
    });
    expect(jugerDelegation(demande({ title: 'ok', prompt: ' ' }), [root()])).toMatchObject({
      ok: false,
      code: 'prompt',
    });
    const verdict = jugerDelegation(demande({ title: '  Titre  ', prompt: '  Mission  ' }), [
      root(),
    ]);
    expect(verdict).toMatchObject({ ok: true, plan: { title: 'Titre', prompt: 'Mission' } });
  });
});

describe('descendants orphelins d’une tâche qui se termine', () => {
  // root ─┬─ a (done) ─┬─ a1 (running)
  //       │            └─ a2 (done)
  //       ├─ b (ready)
  //       └─ c (failed)
  const graphe: NoeudDelegation[] = [
    root({ status: 'done' }),
    root({ taskId: 'a', parentTaskId: 'root', depth: 1, status: 'done' }),
    root({ taskId: 'b', parentTaskId: 'root', depth: 1, status: 'ready' }),
    root({ taskId: 'c', parentTaskId: 'root', depth: 1, status: 'failed' }),
    root({ taskId: 'a1', parentTaskId: 'a', depth: 2, status: 'running' }),
    root({ taskId: 'a2', parentTaskId: 'a', depth: 2, status: 'done' }),
  ];

  it('traverse les descendants terminés et ne rend que ceux en vol, parents avant enfants', () => {
    // Entrée volontairement désordonnée : la fonction ne suppose pas l'ordre
    // du store. Le petit-enfant `a1` vole sous un enfant FINI — c'est lui
    // qu'un arrêt à la première génération laisserait orphelin.
    const orphelins = descendantsEnVol([...graphe].reverse(), 'root', 'ancestor_done', () => false);
    expect(orphelins.map((n) => n.taskId)).toEqual(['b', 'a1']);
  });

  it('ne remonte jamais : le sous-arbre d’un enfant exclut son parent et ses frères', () => {
    const sousArbre = (taskId: string): string[] =>
      descendantsEnVol(graphe, taskId, 'ancestor_cancelled', () => false).map((n) => n.taskId);
    expect(sousArbre('a')).toEqual(['a1']);
    expect(sousArbre('b')).toEqual([]);
  });

  // `b` a livré, puis l'Evaluator l'a rouvert : sa correction lui appartient,
  // et `b1`, qu'il vient de déléguer, attend SON résultat — pas celui de root.
  // Seul un root ABOUTI peut encore être rouvert et la relire ; échoué ou
  // annulé, il ne le sera jamais, et la correction n'a plus de lecteur.
  const avecCorrection = [
    ...graphe,
    root({ taskId: 'b1', parentTaskId: 'b', depth: 2, status: 'running' }),
  ];
  const cas = [
    { cause: 'ancestor_done', attendus: ['a1'] },
    { cause: 'ancestor_failed', attendus: ['b', 'a1', 'b1'] },
    { cause: 'ancestor_cancelled', attendus: ['b', 'a1', 'b1'] },
    // L'enveloppe coût épuisée ne sera jamais rendue : rien n'est épargné.
    { cause: 'root_cost_budget_exhausted', attendus: ['b', 'a1', 'b1'] },
  ] as const;

  for (const { cause, attendus } of cas) {
    it(`un enfant rouvert après livraison n’est épargné, avec sa descendance, que sous un ancêtre abouti (${cause})`, () => {
      const rouverts = new Set(['b']);
      expect(
        descendantsEnVol(avecCorrection, 'root', cause, (id) => rouverts.has(id)).map(
          (n) => n.taskId,
        ),
      ).toEqual(attendus);
    });
  }
});

describe('ancêtre échoué d’une tâche que l’Evaluator voudrait rouvrir', () => {
  // root ── a ── a1 : le statut de chaque ancêtre varie selon le cas.
  const chaine = (statutRoot: NoeudDelegation['status'], statutA: NoeudDelegation['status']) => [
    root({ status: statutRoot }),
    root({ taskId: 'a', parentTaskId: 'root', depth: 1, status: statutA }),
    root({ taskId: 'a1', parentTaskId: 'a', depth: 2, status: 'done' }),
  ];

  it('remonte jusqu’à la racine, et seul un ancêtre échoué compte', () => {
    // Un parent abouti sous une racine échouée n'a plus de lecteur non plus.
    expect(ancetreEchoue(chaine('failed', 'done'), 'a1')).toBe(true);
    expect(ancetreEchoue(chaine('running', 'failed'), 'a1')).toBe(true);
    // Abouti, un ancêtre peut encore être rouvert et relire la correction.
    expect(ancetreEchoue(chaine('done', 'done'), 'a1')).toBe(false);
    expect(ancetreEchoue(chaine('failed', 'failed'), 'root')).toBe(false);
  });
});

// ─── L'ENVELOPPE DE LA RACINE ─────────────────────────────────────────────────
//
// Durée, coût et ressources se jugent CUMULÉS sur tout l'arbre : jugé enfant
// par enfant, chacun pouvait réserver le plafond entier — seize enfants, seize
// fois la demi-heure et les cinq dollars. Et chaque refus nomme sa borne.
describe('l’enveloppe cumulée d’une racine', () => {
  const L = LIMITES_DELEGATION_DEFAUT;
  /** Un enfant Hive de la racine, qui a déjà réservé `budget`. */
  const enfant = (
    taskId: string,
    budget: Partial<NonNullable<NoeudDelegation['budget']>>,
    patch: Partial<NoeudDelegation> = {},
  ): NoeudDelegation =>
    root({
      taskId,
      parentTaskId: 'root',
      depth: 1,
      status: 'done',
      budget: { durationMs: 0, costMicros: 0, resourceUnits: 0, ...budget },
      ...patch,
    });

  it.each([
    ['duree', 'durationMs', L.maxDurationMs - 60_000, 120_000, 60_000],
    ['cout', 'costMicros', L.maxCostMicros - 1_000, 5_000, 1_000],
    ['ressources', 'resourceUnits', L.maxResourceUnits - 1, 2, 1],
  ] as const)(
    'refuse le budget %s qui ne tient plus dans ce que l’arbre a laissé — et dit ce qui reste',
    (code, champ, reservee, demandee, reste) => {
      // Un enfant TERMINÉ garde sa réservation : elle ne se rend pas.
      const graphe = [root(), enfant('fini', { [champ]: reservee })];
      const verdict = jugerDelegation(demande({ [champ]: demandee }), graphe);
      expect(verdict).toMatchObject({ ok: false, code });
      if (verdict.ok) return;
      expect(verdict.motif).toContain('cumulés par racine');
      expect(verdict.motif).toContain(`il en reste ${reste}`);
      // Ce que l'arbre a laissé, et pas un iota de plus, passe encore.
      expect(jugerDelegation(demande({ [champ]: reste }), graphe).ok).toBe(true);
    },
  );

  it('compte toute la profondeur de l’arbre, pas les seuls frères', () => {
    // root ── a ── a1 : la réservation du petit-enfant pèse sur l'enveloppe de
    // la racine quand `a` délègue à son tour.
    const graphe = [
      root(),
      enfant('a', { durationMs: 10 * 60_000 }, { status: 'running' }),
      enfant('a1', { durationMs: 15 * 60_000 }, { parentTaskId: 'a', depth: 2 }),
    ];
    const verdict = jugerDelegation(demande({ parentTaskId: 'a', durationMs: 6 * 60_000 }), graphe);
    expect(verdict).toMatchObject({ ok: false, code: 'duree' });
  });

  it('les sous-agents natifs ne réservent rien sur l’enveloppe Hive', () => {
    const natif = enfant('natif', { costMicros: L.maxCostMicros }, { origine: 'native' });
    expect(jugerDelegation(demande(), [root(), natif]).ok).toBe(true);
  });

  it('une dépense déclarée qui atteint le plafond ferme la racine — et un coût inconnu n’est pas un zéro', () => {
    const epuise = jugerDelegation(demande({ costMicros: 0 }), [root()], {
      depense: { micros: L.maxCostMicros, tentatives: 3, sansCout: 1 },
    });
    expect(epuise).toMatchObject({ ok: false, code: 'cout' });
    if (epuise.ok) return;
    expect(epuise.motif).toContain('budget coût de la racine épuisé');
    expect(epuise.motif).toContain('dont 1 au coût inconnu');
    expect(epuise.motif).toContain('plancher');
    // Des tentatives sans coût déclaré ne font pas franchir le plafond :
    // Hive n'invente pas de montant.
    const inconnu = jugerDelegation(demande(), [root()], {
      depense: { micros: 0, tentatives: 5, sansCout: 5 },
    });
    expect(inconnu.ok).toBe(true);
  });

  it('chaque refus de structure nomme sa borne', () => {
    const profond = root({ taskId: 'p', depth: L.maxDepth });
    const motif = (v: ReturnType<typeof jugerDelegation>): string => (v.ok ? '' : v.motif);
    expect(motif(jugerDelegation(demande({ parentTaskId: 'p' }), [profond]))).toContain(
      `la borne est ${L.maxDepth}`,
    );
    const pleins = Array.from({ length: L.maxChildrenPerParent }, (_, i) => enfant(`c${i}`, {}));
    expect(motif(jugerDelegation(demande(), [root(), ...pleins]))).toContain(
      `${L.maxChildrenPerParent}/${L.maxChildrenPerParent}`,
    );
    expect(motif(jugerDelegation(demande({ title: ' ' }), [root()]))).toContain(
      `1 à ${L.maxTitleChars} caractères`,
    );
    expect(motif(jugerDelegation(demande({ durationMs: -1 }), [root()]))).toContain(
      `entier de 0 à ${L.maxDurationMs} ms`,
    );
  });
});

describe('les places d’une ouvrière', () => {
  it('un parent qui attend son enfant ne tient pas de place', () => {
    expect(slotsOccupes({ running: 3, enAttente: 2 })).toBe(1);
    expect(slotsOccupes({ running: 2 })).toBe(2);
  });
});
