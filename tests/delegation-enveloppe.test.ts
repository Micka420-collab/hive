// L'ARBRE DÉLÉGUÉ TIENT SES BUDGETS, SES PLACES, ET LA MAIN DE L'OPÉRATEUR.
//
// ─── LES QUATRE DÉFAUTS QUE CE FICHIER FERME ─────────────────────────────────
//
// 1. PLACES — un parent qui délègue reste `running` et gardait sa place
//    pendant toute l'attente. Sur une ouvrière pleine, son enfant ne partait
//    jamais : l'arbre attendait sa propre expiration. Un parent qui attend
//    relâche désormais sa place (`slotsOccupes`).
// 2. COÛT — `costMicros` était transporté et jamais tenu. La dépense DÉCLARÉE
//    par les CLI est maintenant sommée sur l'arbre : à l'enveloppe, les enfants
//    en vol sont annulés avec leur motif, et plus rien ne repart. Un coût
//    inconnu n'est jamais un zéro — ni pour franchir, ni pour se taire.
// 3. PRÉFÉRENCES — `preferredAgent` / `preferredModel` étaient rangés et jamais
//    lus, alors que l'outil les proposait. Ils départagent désormais les ex
//    æquo — et seulement eux —, et la raison du choix le dit.
// 4. OPÉRATEUR — rien ne permettait d'imposer ou d'exclure un agent ou un
//    modèle pour UNE tâche. La consigne de routage est une exclusion dure,
//    consignée « forcée par l'opérateur », qui ne touche aucun score appris.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DemandeDelegation } from '../src/orchestrator/delegation.js';
import type { Suite } from '../src/orchestrator/polyethisme.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import { LIMITES_DELEGATION_DEFAUT } from '../src/shared/limites-delegation.js';
import { affectationsDepuisEvenements } from '../src/shared/routage-vue.js';
import type { HiveEvent, TaskResult } from '../src/shared/types.js';

const profil = (
  name: string,
  agentType = 'shell',
  maxConcurrency = 1,
  modeles?: string[],
): NodeProfile => ({
  name,
  ownerName: 'test',
  agentType,
  maxConcurrency,
  ...(modeles ? { modeles } : {}),
});

const resultat = (
  taskId: string,
  success: boolean,
  coutUsd?: number,
): Omit<TaskResult, 'nodeId'> => ({
  taskId,
  success,
  diff: success ? `diff:${taskId}` : '',
  logs: 'x',
  durationMs: 10,
  subAgents: [],
  ...(coutUsd === undefined ? {} : { fournisseur: { source: 'claude-code', coutUsd } }),
});

const demande = (
  parentTaskId: string,
  childTaskId: string,
  patch: Partial<DemandeDelegation> = {},
): DemandeDelegation => ({
  childTaskId,
  parentTaskId,
  title: `Sous-tâche ${childTaskId}`,
  prompt: 'implémente la fonction et rends les preuves',
  durationMs: 60_000,
  costMicros: 100_000,
  resourceUnits: 1,
  ...patch,
});

describe('l’arbre délégué tient ses places, ses budgets et la consigne de l’opérateur', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let events: HiveEvent[];
  let annulations: Array<{ nodeId: string; taskId: string; reason: string }>;
  let projectId: string;
  const T = Date.now();

  beforeEach(() => {
    store = new HiveStore(':memory:');
    events = [];
    annulations = [];
    scheduler = new Scheduler(store, {
      onCancel: (nodeId, taskId, reason) => annulations.push({ nodeId, taskId, reason }),
      onEvent: (event) => events.push(event),
    });
    projectId = store.createProject({ name: 'Délégation' }).id;
  });

  afterEach(() => store.close());

  const creerPrete = (id: string, prompt = 'implémente la fonction'): void => {
    store.createTask({ id, projectId, title: id, prompt }, T);
    store.patchTask(id, { status: 'ready' }, T);
  };

  const deleguer = (
    parentTaskId: string,
    childTaskId: string,
    patch: Partial<DemandeDelegation> = {},
  ): void => {
    const creation = store.createDelegatedTask(
      demande(parentTaskId, childTaskId, patch),
      undefined,
      T,
    );
    expect(creation.ok, `${childTaskId} : ${creation.ok ? '' : creation.motif}`).toBe(true);
  };

  const noeudDe = (taskId: string): string => {
    const nodeId = store.getTask(taskId)?.assignedNodeId;
    if (!nodeId) throw new Error(`${taskId} n'est assignée à aucun nœud`);
    return nodeId;
  };

  /** La racine, en cours sur son propre nœud (déclaré seul, avant les autres). */
  const lancerRacine = (noeud = profil('racine')): string => {
    const n = scheduler.registerNode(noeud, T);
    creerPrete('root');
    scheduler.tick(T);
    scheduler.handleTaskUpdate(n.id, 'root');
    expect(store.getTask('root')?.assignedNodeId).toBe(n.id);
    return n.id;
  };

  const affectation = (taskId: string) =>
    affectationsDepuisEvenements(
      events.filter((e) => e.payload.taskId === taskId && e.type === 'task_assigned'),
    ).at(-1);

  describe('les places', () => {
    it('un parent qui attend relâche sa place : un arbre à deux niveaux ne s’interbloque pas sur UNE ouvrière', () => {
      // Une seule ouvrière, une seule place. Avant : la racine la tenait,
      // l'enfant restait `ready` jusqu'à l'expiration de l'attente.
      const seul = lancerRacine(profil('seule', 'shell', 1));
      deleguer('root', 'enfant');
      scheduler.tick(T);
      expect(store.getTask('enfant')).toMatchObject({ status: 'assigned', assignedNodeId: seul });
      scheduler.handleTaskUpdate(seul, 'enfant');
      deleguer('enfant', 'petit-enfant');
      scheduler.tick(T);
      expect(store.getTask('petit-enfant')).toMatchObject({
        status: 'assigned',
        assignedNodeId: seul,
      });
      expect(store.listNodes()[0]).toMatchObject({ running: 3, enAttente: 2 });

      // Le petit-enfant rendu, l'enfant n'attend plus : il reprend sa place,
      // et une tâche indépendante ne passe pas devant lui.
      scheduler.handleTaskResult(seul, resultat('petit-enfant', true));
      creerPrete('independante');
      scheduler.tick(T);
      expect(store.getTask('independante')?.status).toBe('ready');
    });
  });

  describe('le budget coût, tenu sur la dépense DÉCLARÉE', () => {
    /** root@racine ─┬─ cher (en vol) et frugal (en vol), sur deux autres nœuds. */
    const monterArbre = (): void => {
      lancerRacine();
      scheduler.registerNode(profil('b'), T);
      scheduler.registerNode(profil('c'), T);
      deleguer('root', 'cher');
      deleguer('root', 'frugal');
      scheduler.tick(T);
      for (const id of ['cher', 'frugal']) scheduler.handleTaskUpdate(noeudDe(id), id);
      events = [];
      annulations = [];
    };
    const plafondUsd = LIMITES_DELEGATION_DEFAUT.maxCostMicros / 1_000_000;

    it('à l’enveloppe, chaque descendant en vol est annulé avec son motif, et plus rien n’est admis', () => {
      monterArbre();
      const noeudFrugal = noeudDe('frugal');

      scheduler.handleTaskResult(noeudDe('cher'), resultat('cher', true, plafondUsd));

      expect(events.find((e) => e.type === 'delegation_budget_exhausted')?.payload).toEqual({
        rootTaskId: 'root',
        taskId: 'cher',
        depenseMicros: LIMITES_DELEGATION_DEFAUT.maxCostMicros,
        budgetMicros: LIMITES_DELEGATION_DEFAUT.maxCostMicros,
        tentatives: 1,
        sansCout: 0,
        annulees: 1,
      });
      expect(store.getTask('frugal')?.status).toBe('failed');
      expect(annulations).toEqual([
        { nodeId: noeudFrugal, taskId: 'frugal', reason: 'root_cost_budget_exhausted' },
      ]);
      expect(events.find((e) => e.type === 'delegation_cancelled')?.payload).toMatchObject({
        childTaskId: 'frugal',
        ancestorTaskId: 'root',
        reason: 'root_cost_budget_exhausted',
      });
      // La racine, elle, continue : son coût n'est pas dans l'enveloppe.
      expect(store.getTask('root')?.status).toBe('running');
      expect(store.getTask('cher')?.status).toBe('done');
      const tard = store.createDelegatedTask(demande('root', 'tard', { costMicros: 0 }));
      expect(tard).toMatchObject({ ok: false, code: 'cout' });
    });

    it('un coût inconnu ne fait pas franchir le plafond, mais il est compté — et une reprise en file est arrêtée', () => {
      monterArbre();
      // Première tentative de `cher` : échouée, SANS coût déclaré.
      scheduler.handleTaskResult(noeudDe('cher'), resultat('cher', false));
      expect(events.some((e) => e.type === 'delegation_budget_exhausted')).toBe(false);
      expect(store.depenseDeclareeRacine('root')).toEqual({
        micros: 0,
        tentatives: 1,
        sansCout: 1,
      });
      scheduler.tick(T);
      scheduler.handleTaskUpdate(noeudDe('cher'), 'cher');

      // Seconde tentative : échouée encore, mais au prix du plafond. La reprise
      // qu'elle ouvre n'a plus de quoi être payée : elle est annulée aussi.
      scheduler.handleTaskResult(noeudDe('cher'), resultat('cher', false, plafondUsd));
      expect(events.find((e) => e.type === 'delegation_budget_exhausted')?.payload).toMatchObject({
        depenseMicros: LIMITES_DELEGATION_DEFAUT.maxCostMicros,
        tentatives: 2,
        sansCout: 1,
        annulees: 2,
      });
      expect(store.getTask('cher')?.status).toBe('failed');
      expect(store.getTask('frugal')?.status).toBe('failed');
    });

    it('sous une racine épuisée, l’Evaluator ne rouvre plus aucune correction', () => {
      monterArbre();
      scheduler.handleTaskResult(noeudDe('cher'), resultat('cher', true, plafondUsd));
      const livre = store.resultsForTask('cher').at(-1);
      const retry = scheduler.retryFromEvaluator({
        taskId: 'cher',
        resultId: livre?.resultId ?? -1,
        decision: 'correction_required',
        critique: null,
      });
      expect(retry).toMatchObject({ ok: false, reason: 'root_cost_budget_exhausted' });
      expect(store.getTask('cher')?.status).toBe('done');
    });
  });

  describe('les préférences de la tâche parente : un départage, jamais plus', () => {
    // Un vécu « code » jugé pour `modele` : de quoi lui donner un score fini.
    const vecu = (modele: string, suite: Suite): void => {
      const t = store.createTask({
        projectId,
        title: 'Ajoute un endpoint',
        prompt: 'implémente la fonction',
      }).id;
      store.poserModeleAiguillage(t, modele, 1_000);
      store.enregistrerContreVisite({
        productionTaskId: t,
        suite,
        raison: '',
        visiteurNodeId: 'v',
        visiteurAgent: 'claude-code',
        now: 2_000,
      });
      store.patchTask(t, { status: 'done' });
    };

    it('le modèle préféré l’emporte entre deux ex æquo, et la raison le dit', () => {
      lancerRacine();
      const n1 = scheduler.registerNode(profil('n1', 'shell', 1, ['modele-a']), T);
      const n2 = scheduler.registerNode(profil('n2', 'shell', 1, ['modele-z']), T);
      // Sans préférence, deux modèles jamais essayés se départagent par le
      // nom : `modele-a`, sur n1.
      deleguer('root', 'enfant', { preferredModel: 'modele-z' });
      scheduler.tick(T);
      expect(store.getTask('enfant')?.assignedNodeId).toBe(n2.id);
      expect(store.modeleAiguillageDe('enfant')).toBe('modele-z');
      const vue = affectation('enfant');
      expect(vue?.preference).toEqual({ agent: null, modele: 'modele-z', departage: ['modele'] });
      expect(vue?.raisonModele[0]).toMatchObject({ modele: 'modele-z', preferee: true });
      expect(n1.id).not.toBe(n2.id);
    });

    it('un modèle préféré moins bien classé ne passe pas devant : lue, sans effet', () => {
      vecu('modele-a', 'refaire');
      lancerRacine();
      scheduler.registerNode(profil('n1', 'shell', 1, ['modele-a']), T);
      const n2 = scheduler.registerNode(profil('n2', 'shell', 1, ['modele-z']), T);
      deleguer('root', 'enfant', { preferredModel: 'modele-a' });
      scheduler.tick(T);
      // `modele-z`, jamais essayé, vaut +∞ : la préférence n'a rien à trancher.
      expect(store.getTask('enfant')?.assignedNodeId).toBe(n2.id);
      expect(affectation('enfant')?.preference?.departage).toEqual([]);
    });

    it('la famille préférée départage les ouvrières à égalité de charge', () => {
      lancerRacine();
      scheduler.registerNode(profil('n-a', 'claude-code'), T);
      const codex = scheduler.registerNode(profil('n-b', 'codex'), T);
      deleguer('root', 'enfant', { preferredAgent: 'codex' });
      scheduler.tick(T);
      expect(store.getTask('enfant')?.assignedNodeId).toBe(codex.id);
      expect(affectation('enfant')).toMatchObject({
        critereNoeud: 'preference_parent',
        preference: { agent: 'codex', modele: null, departage: ['agent'] },
      });
    });
  });

  describe('la consigne de l’opérateur : une exclusion dure', () => {
    it('écarte une famille, sans toucher au classement appris, et l’affectation le dit', () => {
      scheduler.registerNode(profil('n-a', 'claude-code'), T);
      const codex = scheduler.registerNode(profil('n-b', 'codex'), T);
      creerPrete('tache');
      store.poserConsigneRoutage('tache', { sansAgents: ['claude-code'] }, null, T);
      scheduler.tick(T);
      expect(store.getTask('tache')?.assignedNodeId).toBe(codex.id);
      expect(affectation('tache')?.consigne).toEqual({ sansAgents: ['claude-code'] });
    });

    it('impose un modèle : seul qui le déclare le porte, et c’est lui qui est commandé', () => {
      scheduler.registerNode(profil('n1', 'shell', 1, ['m1']), T);
      const n2 = scheduler.registerNode(profil('n2', 'shell', 1, ['m1', 'm2']), T);
      scheduler.registerNode(profil('n3'), T);
      creerPrete('tache');
      store.poserConsigneRoutage('tache', { modele: 'm2' }, null, T);
      scheduler.tick(T);
      expect(store.getTask('tache')?.assignedNodeId).toBe(n2.id);
      expect(store.modeleAiguillageDe('tache')).toBe('m2');
    });

    it('insatisfaite, la tâche attend — et le dit une fois ; levée, elle part', () => {
      const shell = scheduler.registerNode(profil('n'), T);
      creerPrete('tache');
      store.poserConsigneRoutage('tache', { agent: 'grok' }, null, T);
      scheduler.tick(T);
      scheduler.tick(T + 1);
      expect(store.getTask('tache')?.status).toBe('ready');
      expect(events.filter((e) => e.type === 'task_consigne_deferred')).toHaveLength(1);
      store.poserConsigneRoutage('tache', null, null, T);
      scheduler.tick(T + 2);
      expect(store.getTask('tache')?.assignedNodeId).toBe(shell.id);
    });

    it('prime sur la préférence de la tâche parente', () => {
      lancerRacine();
      scheduler.registerNode(profil('n1', 'shell', 1, ['modele-a']), T);
      const n2 = scheduler.registerNode(profil('n2', 'shell', 1, ['modele-z']), T);
      deleguer('root', 'enfant', { preferredModel: 'modele-a' });
      store.poserConsigneRoutage('enfant', { sansModeles: ['modele-a'] }, null, T);
      scheduler.tick(T);
      expect(store.getTask('enfant')?.assignedNodeId).toBe(n2.id);
      expect(store.modeleAiguillageDe('enfant')).toBe('modele-z');
    });

    it('une course de drones ne la franchit pas non plus', () => {
      const claude = scheduler.registerNode(profil('n-a', 'claude-code'), T);
      scheduler.registerNode(profil('n-b', 'codex'), T);
      scheduler.registerNode(profil('n-c', 'grok'), T);
      creerPrete('tache');
      store.poserConsigneRoutage('tache', { sansAgents: ['claude-code'] }, null, T);
      const course = scheduler.startRace('tache', 3, T);
      expect(course.ok).toBe(true);
      if (!course.ok) return;
      expect(course.drones).toHaveLength(2);
      expect(course.drones).not.toContain(claude.id);
    });
  });
});
