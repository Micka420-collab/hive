// L'AIGUILLAGE APPRIS, CÂBLÉ DANS L'ORDONNANCEUR (boucle principale).
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// Le module pur `aiguillage.ts` sait DIRE quel modèle pour un genre ; ce banc
// vérifie que l'ordonnanceur l'ÉCOUTE, et seulement quand il le doit :
//
//   1. NO-OP — aucun nœud éligible ne déclare de modèle : l'assignation est
//      exactement celle d'avant (le nœud le moins chargé, départagé par le nom),
//      et RIEN n'est enregistré. C'est la rétro-compatibilité, verrouillée : tant
//      que les nœuds ne déclarent pas leurs modèles (lot 4), le comportement ne
//      bouge pas d'un pouce.
//   2. AIGUILLAGE — des nœuds déclarent leurs modèles : la tâche part au nœud qui
//      offre le MEILLEUR modèle pour son genre, même si un autre nœud, tout aussi
//      libre, la recevrait par défaut (l'ordre des noms). Le modèle domine la
//      charge PARMI les éligibles.
//   3. ENREGISTREMENT — le modèle commandé est rangé (`aiguillage_modeles`), ce
//      qui ferme la boucle : le verdict de contre-visite reviendra le juger.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoriser, cle, cleBras } from '../src/orchestrator/aiguillage.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { projeterWorkers } from '../src/orchestrator/workers.js';
import { affectationsDepuisEvenements } from '../src/shared/routage-vue.js';
import type { Suite } from '../src/orchestrator/polyethisme.js';
import type { TaskResult } from '../src/shared/types.js';
import { EFFORTS, type Effort } from '../src/shared/effort.js';

/**
 * Le bras sous lequel le vécu fabriqué a tourné : le harness des nœuds de ce
 * banc (`agentType: 'shell'`), sans effort — comme l'ordonnanceur le range.
 */
const BRAS_SHELL = { harness: 'shell', effort: null };
/** Le bras d'un nœud Claude Code, au défaut du CLI ou à un effort. */
const brasClaude = (effort: Effort | null = null) => ({ harness: 'claude-code', effort });

const profile = (name: string, modeles?: string[]) => ({
  name,
  ownerName: 'test',
  agentType: 'shell',
  maxConcurrency: 1,
  ...(modeles ? { modeles } : {}),
});

describe('Aiguillage câblé — la boucle principale de l’ordonnanceur', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assignations: { nodeId: string; taskId: string; modele?: string }[];
  beforeEach(() => {
    store = new HiveStore(':memory:');
    assignations = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task, modele) => assignations.push({ nodeId, taskId: task.id, modele }),
    });
  });
  afterEach(() => store.close());

  // Une tâche de genre « code » (ajoute/endpoint/implémente : plusieurs mots du
  // genre `code`), avec un titre qu'on peut retrouver dans les observations.
  function tacheCode(titre: string): string {
    const p = store.createProject({ name: 'P' });
    return store.createTask({ projectId: p.id, title: titre, prompt: 'implémente l’endpoint' }).id;
  }

  // Fabrique du VÉCU : `n` tâches « code » produites par `modele`, chacune jugée
  // `suite`, puis mises hors de la file (statut `done`) pour qu'elles n'entrent
  // pas dans l'assignation courante. C'est ce vécu que l'Aiguillage relit.
  function vecu(
    modele: string,
    suite: Suite,
    n: number,
    bras: { harness: string; effort: Effort | null } = BRAS_SHELL,
  ): void {
    const p = store.createProject({ name: 'vecu' });
    for (let i = 0; i < n; i++) {
      const t = store.createTask({
        projectId: p.id,
        title: 'Ajoute un endpoint',
        prompt: 'implémente la fonction',
      }).id;
      store.poserModeleAiguillage(t, modele, 1_000 + i, bras);
      store.enregistrerContreVisite({
        productionTaskId: t,
        suite,
        raison: '',
        visiteurNodeId: 'v',
        visiteurAgent: 'claude-code',
        now: 2_000 + i,
      });
      store.patchTask(t, { status: 'done' });
    }
  }

  /** Vécu où l'Evaluator a conservé le modèle exact du résultat relu. */
  function vecuAvecModeleExact(
    modeleCommande: string,
    modeleExact: string,
    suite: Suite,
    n: number,
  ): void {
    const p = store.createProject({ name: 'vecu-exact' });
    for (let i = 0; i < n; i++) {
      const t = store.createTask({
        projectId: p.id,
        title: 'Ajoute un endpoint',
        prompt: 'implémente la fonction',
      }).id;
      store.poserModeleAiguillage(t, modeleCommande, 1_000 + i, BRAS_SHELL);
      const resultId = store.insertResult(
        {
          taskId: t,
          nodeId: 'producteur',
          success: true,
          diff: 'diff',
          logs: '',
          durationMs: 1,
          subAgents: [],
        },
        2_000 + i,
      );
      store.appendEvent(
        'contre_expertise_verdict',
        {
          source: 'hive_counter_review',
          taskId: t,
          resultId,
          producteurModele: modeleExact,
          // Le bras voyage avec la preuve, comme le serveur le fige.
          producteurHarness: 'shell',
        },
        2_100 + i,
      );
      store.enregistrerContreVisite({
        productionTaskId: t,
        suite,
        raison: '',
        visiteurNodeId: 'v',
        visiteurAgent: 'claude-code',
        now: 3_000 + i,
      });
      store.patchTask(t, { status: 'done' });
    }
  }

  it('NO-OP : sans modèles déclarés, le nœud par défaut est choisi, et RIEN n’est enregistré', () => {
    const na = scheduler.registerNode(profile('aaa'));
    scheduler.registerNode(profile('zzz'));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const task = store.getTask(t);
    expect(task?.status, 'la tâche part').toBe('assigned');
    expect(task?.assignedNodeId, 'le défaut : moins chargé, nom « aaa » d’abord').toBe(na.id);
    // Aucun modèle commandé : même en posant un verdict, la mémoire reste vide.
    store.enregistrerContreVisite({
      productionTaskId: t,
      suite: 'appliquer',
      raison: '',
      visiteurNodeId: 'v',
      visiteurAgent: 'claude-code',
      now: 6_000,
    });
    expect(store.observationsAiguillage(), 'no-op : aucune élection enregistrée').toEqual([]);
  });

  it('AIGUILLE vers le nœud qui offre le MEILLEUR modèle — et enregistre l’élection', () => {
    // opus excelle sur « code », fable y échoue. Deux nœuds également libres :
    // « aaa » n'offre que fable, « zzz » n'offre qu'opus. Par défaut « aaa »
    // gagnerait (nom d'abord) ; l'Aiguillage doit envoyer la tâche à « zzz ».
    vecu('opus', 'appliquer', 3);
    vecu('fable', 'refaire', 3);
    const na = scheduler.registerNode(profile('aaa', ['fable']));
    const nz = scheduler.registerNode(profile('zzz', ['opus']));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const task = store.getTask(t);
    expect(task?.assignedNodeId, 'le porteur d’opus, pas le nom qui vient d’abord').toBe(nz.id);
    expect(task?.assignedNodeId, 'et surtout pas le porteur de fable').not.toBe(na.id);

    // La boucle se ferme : le modèle commandé est enregistré et ressort dès qu'un
    // verdict le juge.
    store.enregistrerContreVisite({
      productionTaskId: t,
      suite: 'ameliorer',
      raison: '',
      visiteurNodeId: 'v',
      visiteurAgent: 'claude-code',
      now: 6_000,
    });
    const mienne = store
      .observationsAiguillage()
      .find((o) => o.title === 'Ajoute le composant Ruche');
    expect(mienne?.modele, 'opus a été commandé et rangé').toBe('opus');

    const assignation = store
      .listEvents()
      .find((event) => event.type === 'task_assigned' && event.payload.taskId === t);
    expect(assignation?.payload.modele, 'le journal conserve le modèle commandé').toBe('opus');
  });

  it('UN REJEU `figee` ÉLIT SUR LES BRAS FIGÉS — pas seulement sur les modèles', () => {
    // Le vécu du jour est VIDE ; le Genome figé dit tout. Au niveau modèle,
    // alpha et beta se valent ; seuls les BRAS les séparent (beta 10/10, alpha
    // 0/10). Reconstruit sans ses bras, le Genome laisserait gagner le nom
    // qui vient d'abord : alpha.
    const categorie = categoriser('Ajoute un endpoint', 'implémente la fonction');
    const rejeu = store.createProject({ name: 'Rejeu figé' }).id;
    store.inscrireRejeu({
      projectId: rejeu,
      missionSource: 'mission-source',
      projetSource: 'projet-source',
      surcharges: { politiqueRoutage: 'figee' },
      genomeFige: [
        { niveau: 'modele', cle: cle(categorie, 'alpha'), essais: 20, recompenseTotale: 10 },
        { niveau: 'modele', cle: cle(categorie, 'beta'), essais: 20, recompenseTotale: 10 },
        {
          niveau: 'bras',
          cle: cleBras(categorie, { modele: 'alpha', ...BRAS_SHELL }),
          essais: 10,
          recompenseTotale: 0,
        },
        {
          niveau: 'bras',
          cle: cleBras(categorie, { modele: 'beta', ...BRAS_SHELL }),
          essais: 10,
          recompenseTotale: 10,
        },
      ],
      creePar: null,
      creeA: 1,
    });
    scheduler.registerNode(profile('aaa', ['alpha']));
    scheduler.registerNode(profile('zzz', ['beta']));
    const t = store.createTask({
      projectId: rejeu,
      title: 'Ajoute un endpoint',
      prompt: 'implémente la fonction',
    }).id;

    scheduler.tick(5_000);

    expect(assignations.find((a) => a.taskId === t)?.modele).toBe('beta');
  });

  it('LE JOURNAL GARDE LA RAISON DU CHOIX — « pourquoi ce modèle », figée à la décision', () => {
    // Mission Control doit pouvoir répondre « pourquoi opus » sans recroiser des
    // antécédents qui, eux, bougent. La raison est le classement même qui a
    // décidé, joint à `task_assigned` : l'élu en tête, avec son vécu.
    vecu('opus', 'appliquer', 3);
    vecu('fable', 'refaire', 3);
    scheduler.registerNode(profile('aaa', ['fable']));
    scheduler.registerNode(profile('zzz', ['opus']));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const assignation = store
      .listEvents()
      .find((event) => event.type === 'task_assigned' && event.payload.taskId === t);
    expect(assignation?.payload.categorie, 'le genre de la tâche est consigné').toBe('code');
    const raison = assignation?.payload.raisonModele as
      { modele: string; essais: number; moyenne: number; score: number }[] | undefined;
    expect(raison, 'la raison du choix est jointe').toBeTruthy();
    expect(raison?.[0]?.modele, 'l’élu est en tête de la raison').toBe('opus');
    expect(
      raison?.map((r) => r.modele).sort(),
      'les deux modèles en lice figurent dans la raison',
    ).toEqual(['fable', 'opus']);
    expect(raison?.find((r) => r.modele === 'opus')?.essais, 'le vécu réel est porté').toBe(3);
  });

  it('SANS MODÈLE DÉCLARÉ, LE JOURNAL NE PORTE AUCUNE RAISON — on n’invente pas de justification', () => {
    scheduler.registerNode(profile('aaa'));
    scheduler.registerNode(profile('zzz'));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const assignation = store
      .listEvents()
      .find((event) => event.type === 'task_assigned' && event.payload.taskId === t);
    expect(assignation?.payload.raisonModele, 'aucune raison sans aiguillage').toBeUndefined();
    expect(assignation?.payload.categorie, 'ni catégorie sans aiguillage').toBeUndefined();
  });

  it('APPREND le modèle exact du résultat relu après une réassignation', () => {
    // La tâche a été commandée à fable puis son résultat a été produit par opus.
    // Le modèle posé sur la tâche reste fable, mais la preuve de l’Evaluator
    // porte opus : le prochain aiguillage doit apprendre opus, pas attribuer le
    // verdict au modèle remplacé.
    vecuAvecModeleExact('fable', 'opus', 'appliquer', 3);
    vecu('fable', 'refaire', 3);
    const fable = scheduler.registerNode(profile('aaa', ['fable']));
    const opus = scheduler.registerNode(profile('zzz', ['opus']));
    const t = tacheCode('Ajoute le composant Ruche');

    const historique = store
      .observationsAiguillage()
      .filter((observation) => observation.modeleExact === 'opus');
    expect(historique).toHaveLength(3);
    scheduler.tick(5_000);

    expect(store.getTask(t)?.assignedNodeId, 'le modèle exact appris porte la tâche').toBe(opus.id);
    expect(store.getTask(t)?.assignedNodeId).not.toBe(fable.id);
  });

  it('L’UNION SE CALCULE SUR LES ÉLIGIBLES — un modèle dont l’unique porteur est saturé ne fait pas attendre la tâche', () => {
    // « zzz » (opus) porte déjà une tâche en vol (charge 1, capacité 1 → il n'est
    // PAS éligible) ; « aaa » (fable) est vide. opus est le meilleur, mais son
    // unique porteur est injoignable : l'union se calcule sur les seuls
    // éligibles, tombe sur fable, et la tâche part vers « aaa » SANS attendre.
    // C'est la famine « le meilleur modèle vit sur un nœud plein » tuée par
    // construction — le modèle ne peut jamais forcer un nœud saturé.
    vecu('opus', 'appliquer', 3);
    vecu('fable', 'refaire', 3);
    const na = scheduler.registerNode(profile('aaa', ['fable']));
    const nz = scheduler.registerNode(profile('zzz', ['opus']));
    // Sature zzz : une tâche en cours d'exécution le rend inéligible (capacité 1).
    const occupe = store.createTask({
      projectId: store.createProject({ name: 'occ' }).id,
      title: 'occupe',
      prompt: 'x',
    }).id;
    store.patchTask(occupe, { status: 'running', assignedNodeId: nz.id });

    const t = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);

    const task = store.getTask(t);
    expect(
      task?.assignedNodeId,
      'opus saturé ⇒ on aiguille sur le meilleur ATTEIGNABLE (fable)',
    ).toBe(na.id);
  });

  it('LE MODÈLE PASSE AVANT LES PHÉROMONES — un nœud sans le bon modèle ne revient pas par la porte des phéromones', () => {
    // « aaa » (fable) a une forte affinité PHÉROMONE pour le domaine « api » ;
    // « zzz » (opus) n'en a aucune. Sans l'Aiguillage, à charge égale les
    // phéromones enverraient la tâche « api » à « aaa ». Mais opus est le
    // meilleur MODÈLE pour le genre « code » : le départage phéromones doit se
    // faire sur les seuls porteurs d'opus (donc « zzz » seul), et « aaa » ne doit
    // PAS récupérer la tâche par la porte des phéromones. Sinon on enregistrerait
    // « opus » pour une tâche partie sur un nœud qui ne sait pas le lancer.
    vecu('opus', 'appliquer', 3);
    vecu('fable', 'refaire', 3);
    // Dépôt de phéromone : « aaa » a réussi une tâche du domaine « api ».
    const pApi = store.createProject({ name: 'api' });
    const tApi = store.createTask({
      projectId: pApi.id,
      title: 'Créer la route API',
      prompt: 'exposer un endpoint REST',
    }).id;
    const na = scheduler.registerNode(profile('aaa', ['fable']));
    const nz = scheduler.registerNode(profile('zzz', ['opus']));
    store.insertResult(
      {
        taskId: tApi,
        nodeId: na.id,
        diff: '',
        logs: '',
        success: true,
        durationMs: 1,
        subAgents: [],
      },
      4_900,
    );
    store.patchTask(tApi, { status: 'done' });

    // Tâche de genre « code » ET de domaine « api » : les deux classeurs mordent.
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({
      projectId: p.id,
      title: 'Ajoute un endpoint API',
      prompt: 'implémente la route REST',
    }).id;
    scheduler.tick(5_000);

    const task = store.getTask(t);
    expect(task?.assignedNodeId, 'le modèle (opus/zzz) l’emporte sur la phéromone de aaa').toBe(
      nz.id,
    );
  });

  it('LE MODÈLE ÉLU PART AVEC LA TÂCHE — onAssign le reçoit pour `--model`', () => {
    // Le câblage de bout en bout : sans ce troisième argument, le nœud ne saurait
    // jamais quel modèle lancer, et l'enregistrement mentirait (on note un modèle
    // que la production n'a pas employé).
    vecu('opus', 'appliquer', 3);
    vecu('fable', 'refaire', 3);
    const nz = scheduler.registerNode(profile('zzz', ['opus']));
    scheduler.registerNode(profile('aaa', ['fable']));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const mienne = assignations.find((a) => a.taskId === t);
    expect(mienne?.nodeId, 'la tâche part au porteur d’opus').toBe(nz.id);
    expect(mienne?.modele, 'et opus voyage avec elle').toBe('opus');
  });

  it('SANS MODÈLE DÉCLARÉ, onAssign ne porte AUCUN modèle — no-op de bout en bout', () => {
    scheduler.registerNode(profile('aaa'));
    const t = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);
    const mienne = assignations.find((a) => a.taskId === t);
    expect(mienne, 'la tâche est bien assignée').toBeTruthy();
    expect(mienne?.modele, 'mais sans modèle imposé').toBeUndefined();
    const assignation = store
      .listEvents()
      .find((event) => event.type === 'task_assigned' && event.payload.taskId === t);
    expect(assignation?.payload).not.toHaveProperty('modele');
  });

  it('UN MODÈLE NEUF N’EST PLUS CHOISI D’OFFICE — un bon modèle connu garde la tâche (G07)', () => {
    // Jusqu'à la v2, grok, jamais essayé, valait +∞ : il raflait la tâche, et la
    // suivante de chaque genre, quel que soit le vécu d'opus. Il part désormais
    // d'un a priori fini (0,5, masse 10) : huit « appliquer » d'opus l'emportent.
    vecu('opus', 'appliquer', 8);
    const nGrok = scheduler.registerNode(profile('aaa-grok', ['grok']));
    const nOpus = scheduler.registerNode(profile('zzz-opus', ['opus']));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    expect(store.getTask(t)?.assignedNodeId, 'opus garde la tâche').toBe(nOpus.id);
    expect(store.getTask(t)?.assignedNodeId, 'le neuf n’est plus élu d’office').not.toBe(nGrok.id);
    const raison = store
      .listEvents()
      .find((event) => event.type === 'task_assigned' && event.payload.taskId === t)?.payload
      .raisonModele as { modele: string; score: number | null }[] | undefined;
    const grok = raison?.find((r) => r.modele === 'grok');
    expect(Number.isFinite(grok?.score), 'le score de l’inconnu est fini, et consigné').toBe(true);
  });

  it('LE TROUPEAU EST BORNÉ — un modèle neuf avec des élections EN VOL ne rafle plus la tâche prête', () => {
    // opus est moyen (quatre réussites, quatre échecs) : grok, neuf, passerait
    // devant par l'optimisme de l'inconnu — c'est l'exploration. Mais grok a
    // DÉJÀ cinq élections en vol (tâches actives, pas encore jugées) : chacune
    // pèse comme un essai à note nulle, et opus reprend la main. Sans cette
    // borne, grok raflerait toutes les tâches prêtes du genre en attendant son
    // premier verdict.
    vecu('opus', 'appliquer', 4);
    vecu('opus', 'refaire', 4);
    const enVolGrok = (n: number): void => {
      for (let i = 0; i < n; i++) {
        const tv = store.createTask({
          projectId: store.createProject({ name: 'vol' }).id,
          title: 'Ajoute un endpoint',
          prompt: 'implémente la fonction',
        }).id;
        store.poserModeleAiguillage(tv, 'grok', 100 + i, BRAS_SHELL);
        store.patchTask(tv, { status: 'running' }); // active, sans verdict ⇒ en vol
      }
    };
    const nOpus = scheduler.registerNode(profile('n-opus', ['opus']));
    const nGrok = scheduler.registerNode(profile('n-grok', ['grok']));
    const libre = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);
    expect(store.getTask(libre)?.assignedNodeId, 'sans vol, grok est exploré').toBe(nGrok.id);
    store.patchTask(libre, { status: 'done' });

    enVolGrok(5);
    const t = tacheCode('Ajoute le composant Ruche encore');
    scheduler.tick(6_000);

    expect(store.getTask(t)?.assignedNodeId, 'grok en vol ⇒ opus reprend la tâche').toBe(nOpus.id);
  });
  /** Une élection EN VOL : tâche « code » active, modèle commandé, aucun verdict. */
  function enVol(modele: string): void {
    const t = store.createTask({
      projectId: store.createProject({ name: 'vol' }).id,
      title: 'Ajoute un endpoint',
      prompt: 'implémente la fonction',
    }).id;
    store.poserModeleAiguillage(t, modele, 100, BRAS_SHELL);
    store.patchTask(t, { status: 'running' });
  }

  it('LA RAISON FIGÉE DIT « À EXPLORER » POUR UN MODÈLE JAMAIS JUGÉ — ses élections en vol comptées à part', () => {
    // Le troupeau borné, relu comme Mission Control le relit. grok n'a aucun
    // verdict mais cinq élections en vol : la raison disait « 5 essais,
    // moyenne 0 », et le tiroir montrait un modèle mauvais là où la ruche ne
    // sait encore rien de lui.
    vecu('opus', 'appliquer', 8);
    for (let i = 0; i < 5; i++) enVol('grok');
    scheduler.registerNode(profile('n-opus', ['opus']));
    scheduler.registerNode(profile('n-grok', ['grok']));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const evenements = store
      .listEvents()
      .filter((event) => event.type === 'task_assigned' && event.payload.taskId === t);
    const [affectation] = affectationsDepuisEvenements(evenements);
    expect(affectation?.raisonModele.find((l) => l.modele === 'grok')).toEqual({
      modele: 'grok',
      essais: 0,
      enVol: 5,
      moyenne: null,
      score: expect.any(Number) as number,
      aExplorer: true,
      harness: 'shell',
      effort: null,
      intervalle: null,
      cout: null,
    });
    expect(affectation?.raisonModele.find((l) => l.modele === 'opus')).toMatchObject({
      essais: 8,
      enVol: 0,
      moyenne: 1,
      aExplorer: false,
    });
    expect(affectation?.versionAiguillage, 'la raison dit sous quel calcul elle a été prise').toBe(
      3,
    );
    // Opus a huit verdicts, grok aucun : on n'a pas décidé contre un inconnu.
    expect(affectation?.decision).toEqual({ etat: 'explore', coutPondere: false });
  });

  it('LA VUE WORKERS MONTRE LE CLASSEMENT QUI A DÉCIDÉ — modèle prouvé, élections en vol, rivaux', () => {
    // `/api/workers` repliait les verdicts sous le modèle COMMANDÉ et classait
    // chaque modèle SEUL : Essaim montrait fable « 1 essai, 100 % » et opus
    // « 3 essais, 50 % » quand l'ordonnanceur classait opus (2 essais, 0,75)
    // devant fable (2 essais, 0,5). Une seule ouvrière déclare les deux
    // modèles : l'union des éligibles EST son ensemble déclaré, et la raison
    // figée par l'ordonnanceur doit être, ligne à ligne, ce que la vue montre.
    vecuAvecModeleExact('opus', 'opus', 'appliquer', 1);
    vecuAvecModeleExact('opus', 'fable', 'refaire', 1);
    vecuAvecModeleExact('opus', 'opus', 'ameliorer', 1);
    vecuAvecModeleExact('fable', 'fable', 'appliquer', 1);
    enVol('opus');
    scheduler.registerNode(profile('seule', ['fable', 'opus']));
    const [worker] = projeterWorkers(store.listNodes(), {
      verdicts: store.observationsAiguillage(),
      enVol: store.electionsEnVolAiguillage(),
    });
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const raison = store
      .listEvents()
      .find((event) => event.type === 'task_assigned' && event.payload.taskId === t)?.payload
      .raisonModele as
      | {
          modele: string;
          essais: number;
          enVol: number;
          moyenne: number;
          score: number;
          intervalle: { bas: number; haut: number } | null;
          effort: null;
        }[]
      | undefined;
    expect(raison?.map((r) => r.modele).sort()).toEqual(['fable', 'opus']);
    for (const r of raison ?? []) {
      const vue = worker?.modeles?.find((m) => m.modele === r.modele)?.categories.code;
      expect(vue, `${r.modele} : la vue diverge du classement qui a décidé`).toEqual({
        essais: r.essais,
        enVol: r.enVol,
        moyenne: r.moyenne,
        intervalle: r.intervalle,
        score: r.score,
        effort: r.effort,
        exploration: false,
      });
    }
    expect(raison?.find((r) => r.modele === 'opus')).toMatchObject({
      essais: 2,
      enVol: 1,
      moyenne: 0.75,
    });
    expect(raison?.find((r) => r.modele === 'fable')).toMatchObject({
      essais: 2,
      enVol: 0,
      moyenne: 0.5,
    });
  });

  /** Ce que rend une tentative qui plante : CLI en erreur, délai dépassé, exception. */
  const plantage = (taskId: string): Omit<TaskResult, 'nodeId'> => ({
    taskId,
    success: false,
    diff: '',
    logs: '[hive] timeout après 300000 ms — processus tué',
    durationMs: 5,
    subAgents: [],
  });
  /** Les modèles commandés à une tâche, dans l'ordre de ses affectations. */
  const commandes = (taskId: string): (string | undefined)[] =>
    assignations.filter((a) => a.taskId === taskId).map((a) => a.modele);
  const derniereAffectation = (taskId: string) =>
    store
      .listEvents()
      .filter((event) => event.type === 'task_assigned' && event.payload.taskId === taskId)
      .at(-1)?.payload;

  it('UN MODÈLE QUI A PLANTÉ SUR UNE TÂCHE N’EST PAS RÉ-ÉLU POUR SES REPRISES — et son échec n’est pas une note', () => {
    // Une ouvrière déclare deux modèles, dont un cassé (alias mal saisi, modèle
    // retiré). Jamais jugés, les deux sont « à explorer » (même a priori) et le nom
    // départage : fable, le cassé, est élu. Son plantage renvoie la tâche en
    // file — hors vol, sans verdict, fable retrouvait son optimisme et prenait les TROIS
    // tentatives, puis celles de chaque tâche suivante du même genre.
    const n = scheduler.registerNode(profile('seule', ['fable', 'opus']));
    const t = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);
    expect(commandes(t)).toEqual(['fable']);

    scheduler.handleTaskResult(n.id, plantage(t));

    expect(store.getTask(t)?.status, 'la reprise part aussitôt').toBe('assigned');
    expect(commandes(t), 'la reprise part sur l’autre modèle déclaré').toEqual(['fable', 'opus']);
    const reprise = derniereAffectation(t);
    expect(reprise?.modelesEcartes, 'la raison dit quel modèle a été écarté').toEqual(['fable']);
    expect(
      (reprise?.raisonModele as { modele: string }[] | undefined)?.map((r) => r.modele),
      'le modèle écarté ne concourt plus pour cette tâche',
    ).toEqual(['opus']);

    scheduler.handleTaskResult(n.id, { ...plantage(t), success: true, diff: 'diff' });
    expect(store.getTask(t)?.status).toBe('done');

    // Décision : un plantage n'est PAS un essai loyal. Rien n'est appris — une
    // tâche neuve du même genre essaie encore fable, jamais jugé. Son propre
    // plantage n'efface pas l'écart d'une tâche rendue.
    expect(store.observationsAiguillage(), 'aucune observation à récompense nulle').toEqual([]);
    const autre = tacheCode('Ajoute le composant Alvéole');
    scheduler.tick(6_000);
    expect(commandes(autre), 'une tâche neuve n’hérite pas de l’écart').toEqual(['fable']);
    scheduler.handleTaskResult(n.id, plantage(autre));
    scheduler.handleTaskResult(n.id, { ...plantage(autre), success: true, diff: 'diff' });
    expect(commandes(autre)).toEqual(['fable', 'opus']);

    // Une correction demandée par l'Evaluator rouvre la tâche rendue : c'est
    // une reprise de CETTE tâche, fable reste écarté.
    const resultId = store.resultsForTask(t).at(-1)?.resultId ?? 0;
    expect(
      scheduler.retryFromEvaluator({
        taskId: t,
        resultId,
        decision: 'correction_required',
        critique: null,
      }).ok,
    ).toBe(true);
    expect(commandes(t), 'la correction ne repart pas sur fable').toEqual([
      'fable',
      'opus',
      'opus',
    ]);
  });

  it('UN REFUS D’INFRASTRUCTURE ÉCARTE LE MODÈLE COMMANDÉ — un refus de saturation, non', () => {
    // Le CLI de fable répond « quota » : le nœud refuse (`infra`) et la tâche
    // revenait sur fable à l'expiration du cooldown, jusqu'à échouer « aucun
    // agent fonctionnel » quand opus, sur le même nœud, fonctionnait.
    const n = scheduler.registerNode(profile('seule', ['fable', 'opus']));
    const t = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);
    // Saturé : fable n'a pas tourné, il n'a rien prouvé — il reste élu.
    scheduler.rejectTask(n.id, t, 'noeud_sature', false, 5_000);
    scheduler.tick(9_000);
    expect(commandes(t)).toEqual(['fable', 'fable']);

    scheduler.rejectTask(n.id, t, 'agent indisponible (auth/quota)', true, 9_000);
    scheduler.tick(13_000);

    expect(commandes(t), 'la tâche repart sur opus, pas sur fable').toEqual([
      'fable',
      'fable',
      'opus',
    ]);
  });

  it('UN CLONE IMPOSSIBLE N’ÉCARTE AUCUN MODÈLE ET NE BRÛLE AUCUNE TENTATIVE — l’agent n’a pas tourné', () => {
    // Le nœud n'a pas pu cloner le dépôt de la tâche (`avant_agent`) : fable
    // n'a rien lancé. Rangé comme un échec d'agent, il était écarté des
    // reprises, et la tentative comptait.
    const n = scheduler.registerNode(profile('seule', ['fable', 'opus']));
    const t = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);
    scheduler.rejectTask(n.id, t, 'clone impossible : dépôt muet', 'avant_agent', 5_000);
    scheduler.tick(9_000);
    expect(commandes(t), 'fable reste élu').toEqual(['fable', 'fable']);
    expect(store.getTask(t)?.attempts).toBe(0);
    expect(derniereAffectation(t)).not.toHaveProperty('modelesEcartes');
  });

  it('SANS AUTRE MODÈLE DANS LA RUCHE, LA REPRISE PART QUAND MÊME — et la raison dit qu’il est re-tenté', () => {
    // L'unique modèle de la ruche a planté : l'écarter laisserait la tâche
    // prête sans porteur, à jamais. Il est re-tenté, comme avant — mais la
    // raison le dit : sans elle, le tiroir montrait un modèle qui vient de
    // tomber sur cette tâche comme une exploration neuve (« à explorer »).
    const n = scheduler.registerNode(profile('seule', ['fable']));
    const t = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);

    scheduler.handleTaskResult(n.id, plantage(t));

    expect(store.getTask(t)?.status).toBe('assigned');
    expect(commandes(t)).toEqual(['fable', 'fable']);
    expect(derniereAffectation(t)).not.toHaveProperty('modelesEcartes');
    expect(
      derniereAffectation(t)?.modelesReadmis,
      'déjà tombé sur cette tâche, re-tenté faute d’alternative',
    ).toEqual(['fable']);

    // Il rend, et sa production est retenue : il a prouvé qu'il tourne sur
    // cette tâche, son écart tombe. Une correction de SA production lui
    // revient, même si un autre modèle a rejoint la ruche entre-temps.
    scheduler.handleTaskResult(n.id, { ...plantage(t), success: true, diff: 'diff' });
    scheduler.registerNode(profile('nouvelle', ['opus']));
    const resultId = store.resultsForTask(t).at(-1)?.resultId ?? 0;
    expect(
      scheduler.retryFromEvaluator({
        taskId: t,
        resultId,
        decision: 'correction_required',
        critique: null,
      }).ok,
    ).toBe(true);
    expect(commandes(t), 'la correction revient au modèle qui a écrit').toEqual([
      'fable',
      'fable',
      'fable',
    ]);
    expect(derniereAffectation(t)).not.toHaveProperty('modelesReadmis');
  });

  it('LE PORTEUR SAIN EST OCCUPÉ : LA REPRISE L’ATTEND, ELLE NE RETOMBE PAS SUR LE MODÈLE TOMBÉ', () => {
    // L'écart se décidait contre les seuls nœuds LIBRES du tick : opus occupé
    // ailleurs, « tous les modèles offerts ont échoué » devenait vrai et fable
    // reprenait les trois tentatives — la tâche échouait pour de bon pendant
    // qu'une ouvrière saine tournait à côté. Une charge passe : la reprise
    // attend opus comme toute tâche en file attend une place.
    const a = scheduler.registerNode(profile('a', ['fable']));
    const b = scheduler.registerNode(profile('b', ['opus']));
    tacheCode('Ajoute le composant Ruche');
    tacheCode('Ajoute le composant Alvéole');
    scheduler.tick(5_000);
    // Jamais jugés, les deux se valent : le nom donne fable à la première tâche
    // servie, et opus, seul libre ensuite, prend l'autre.
    const surFable = assignations.find((x) => x.modele === 'fable');
    const surOpus = assignations.find((x) => x.modele === 'opus');
    expect([surFable?.nodeId, surOpus?.nodeId]).toEqual([a.id, b.id]);
    const t = surFable?.taskId ?? '';
    const voisine = surOpus?.taskId ?? '';

    scheduler.handleTaskResult(a.id, plantage(t));
    scheduler.tick(6_000);
    expect(store.getTask(t)?.status, 'la reprise attend le porteur sain').toBe('ready');
    expect(commandes(t)).toEqual(['fable']);

    scheduler.handleTaskResult(b.id, { ...plantage(voisine), success: true, diff: 'diff' });
    expect(assignations.at(-1), 'opus libéré prend la reprise').toEqual({
      nodeId: b.id,
      taskId: t,
      modele: 'opus',
    });
    expect(derniereAffectation(t)?.modelesEcartes).toEqual(['fable']);
  });

  it('UN NŒUD SANS MODÈLE DÉCLARÉ EST UNE ALTERNATIVE — la reprise y part plutôt que sur le modèle tombé', () => {
    // Il lance le modèle par défaut de son CLI : inconnu, mais pas celui qui
    // vient de planter sur cette tâche. Le laisser au repos pendant que fable
    // brûlait les trois tentatives était le même défaut que le porteur occupé.
    const libre = scheduler.registerNode(profile('a-libre'));
    const b = scheduler.registerNode(profile('b', ['fable']));
    const t = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);
    expect(assignations, 'un nœud qui déclare ses modèles domine').toEqual([
      { nodeId: b.id, taskId: t, modele: 'fable' },
    ]);

    scheduler.handleTaskResult(b.id, plantage(t));

    expect(assignations.at(-1), 'aucun modèle commandé : son défaut').toEqual({
      nodeId: libre.id,
      taskId: t,
      modele: undefined,
    });
    const reprise = derniereAffectation(t);
    expect(reprise?.modelesEcartes, 'la raison dit ce qui a été écarté').toEqual(['fable']);
    expect(reprise, 'aucune élection de modèle inventée').not.toHaveProperty('modele');
  });

  /** Un nœud Claude Code qui déclare `efforts`, et ce que `onAssign` lui envoie. */
  function noeudClaude(
    modeles: string[],
    efforts: readonly Effort[],
    maxConcurrency = 1,
  ): { id: string; envoyes: { modele?: string; effort?: string }[]; tick: (t: number) => void } {
    const n = scheduler.registerNode({
      ...profile('claude', modeles),
      agentType: 'claude-code',
      maxConcurrency,
      efforts: [...efforts],
    });
    const envoyes: { modele?: string; effort?: string }[] = [];
    const s = new Scheduler(store, {
      onAssign: (_nodeId, _task, modele, effort) => envoyes.push({ modele, effort }),
    });
    return { id: n.id, envoyes, tick: (t) => s.tick(t) };
  }

  it('RUCHE NEUVE : UN NŒUD QUI DÉCLARE DES EFFORTS GARDE LE DÉFAUT DU CLI — jamais `--effort low` d’office', () => {
    // Tous les bras se valent, et le départage prend le moindre effort : le
    // défaut du CLI, que l'opérateur n'a jamais changé — pas `low`, en dessous.
    const n = noeudClaude(['opus'], EFFORTS);
    const t = tacheCode('Ajoute le composant Ruche');

    n.tick(5_000);

    expect(store.getTask(t)?.assignedNodeId).toBe(n.id);
    expect(n.envoyes).toEqual([{ modele: 'opus', effort: undefined }]);
    expect(store.effortAiguillageDe(t)).toBeNull();
    expect(derniereAffectation(t)).not.toHaveProperty('effort');
  });

  it('LE VÉCU AU DÉFAUT DU CLI RESTE ÉLIGIBLE sur un nœud qui déclare des efforts', () => {
    // Tout le vécu d'avant la v3 est rangé sans effort : un nœud mis à jour
    // qui n'offrirait plus que ses niveaux explicites l'aurait rendu
    // inéligible, et relancé chaque modèle à un effort jamais jugé.
    // Un seul niveau déclaré, déjà jugé mauvais : sans le bras au défaut, il
    // serait la seule offre ; avec lui, le vécu du défaut l'emporte.
    vecu('opus', 'appliquer', 8, brasClaude());
    vecu('opus', 'refaire', 4, brasClaude('low'));
    const n = noeudClaude(['opus'], ['low']);
    const t = tacheCode('Ajoute le composant Ruche');

    n.tick(5_000);

    expect(n.envoyes).toEqual([{ modele: 'opus', effort: undefined }]);
    expect(store.effortAiguillageDe(t)).toBeNull();
  });

  it('UN EFFORT QUI A FAIT SES PREUVES EST ÉLU — commandé, rangé et journalisé', () => {
    vecu('opus', 'appliquer', 8, brasClaude('high'));
    vecu('opus', 'refaire', 8, brasClaude());
    const n = noeudClaude(['opus'], ['low', 'high']);
    const t = tacheCode('Ajoute le composant Ruche');

    n.tick(5_000);

    expect(store.getTask(t)?.assignedNodeId).toBe(n.id);
    expect(n.envoyes, 'le nœud reçoit l’effort élu').toEqual([{ modele: 'opus', effort: 'high' }]);
    expect(store.effortAiguillageDe(t)).toBe('high');
    expect(derniereAffectation(t)).toMatchObject({ modele: 'opus', effort: 'high' });
  });

  it('LE TROUPEAU EST BORNÉ PAR MODÈLE, DANS LA PASSE — six efforts ne font pas six tâches pour l’inconnu', () => {
    // Un nœud Claude Code libre pour six tâches, six tâches prêtes, une passe.
    // grok n'a jamais été jugé, opus est moyen. Le vécu est replié une fois par
    // passe : sans y compter chaque élection posée, et sans borne par modèle,
    // grok raflait les six (défaut, low → max) avant son premier verdict.
    vecu('opus', 'appliquer', 4, brasClaude());
    vecu('opus', 'refaire', 4, brasClaude());
    const n = noeudClaude(['grok', 'opus'], EFFORTS, 6);
    for (let i = 0; i < 6; i++) tacheCode(`Ajoute le composant ${i}`);

    n.tick(5_000);

    const modeles = n.envoyes.map((e) => e.modele);
    expect(modeles).toHaveLength(6);
    expect(
      modeles.filter((m) => m === 'grok').length,
      'l’inconnu a sa part, pas tout',
    ).toBeLessThanOrEqual(3);
    expect(modeles, 'le connu garde sa place').toContain('opus');
  });

  it('UN NŒUD QUI N’EN DÉCLARE PAS N’EN REÇOIT JAMAIS — son CLI garde son défaut', () => {
    scheduler.registerNode(profile('codex', ['opus']));
    const efforts: (string | undefined)[] = [];
    const sansEffort = new Scheduler(store, {
      onAssign: (_nodeId, _task, _modele, effort) => efforts.push(effort),
    });
    const t = tacheCode('Ajoute le composant Ruche');

    sansEffort.tick(5_000);

    expect(efforts).toEqual([undefined]);
    expect(store.effortAiguillageDe(t)).toBeNull();
    expect(derniereAffectation(t)).not.toHaveProperty('effort');
  });

  it('LE COÛT DÉCLARÉ PAR LE CLI SUIT LE VERDICT — et un coût tu reste inconnu', () => {
    const n = scheduler.registerNode(profile('seule', ['opus']));
    // L'une après l'autre : créées ensemble, deux tâches au même instant
    // partiraient dans un ordre que seul leur identifiant aléatoire départage.
    const declare = tacheCode('Ajoute le composant Ruche');
    scheduler.tick(5_000);
    expect(store.getTask(declare)?.assignedNodeId).toBe(n.id);
    scheduler.handleTaskResult(n.id, {
      ...plantage(declare),
      success: true,
      diff: 'diff',
      fournisseur: { source: 'claude-code', coutUsd: 0.42 },
    });
    const muet = tacheCode('Ajoute le composant Alvéole');
    scheduler.tick(6_000);
    expect(store.getTask(muet)?.assignedNodeId).toBe(n.id);
    scheduler.handleTaskResult(n.id, { ...plantage(muet), success: true, diff: 'diff' });
    for (const [t, i] of [
      [declare, 0],
      [muet, 1],
    ] as const) {
      store.enregistrerContreVisite({
        productionTaskId: t,
        suite: 'appliquer',
        raison: '',
        visiteurNodeId: 'v',
        visiteurAgent: 'claude-code',
        now: 7_000 + i,
      });
    }

    const lignes = store.observationsAiguillage();
    expect(lignes.find((l) => l.title === 'Ajoute le composant Ruche')?.coutUsd).toBe(0.42);
    expect(
      lignes.find((l) => l.title === 'Ajoute le composant Alvéole'),
      'aucun coût déclaré : aucun coût rangé, pas un zéro',
    ).not.toHaveProperty('coutUsd');
  });
});
