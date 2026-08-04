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
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { Suite } from '../src/orchestrator/polyethisme.js';

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
  beforeEach(() => {
    store = new HiveStore(':memory:');
    scheduler = new Scheduler(store, {});
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
  function vecu(modele: string, suite: Suite, n: number): void {
    const p = store.createProject({ name: 'vecu' });
    for (let i = 0; i < n; i++) {
      const t = store.createTask({
        projectId: p.id,
        title: 'Ajoute un endpoint',
        prompt: 'implémente la fonction',
      }).id;
      store.poserModeleAiguillage(t, modele, 1_000 + i);
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

  it('LE TROUPEAU EST BORNÉ — un modèle neuf avec des élections EN VOL ne rafle plus la tâche prête', () => {
    // opus a un vécu fort sur « code » ; grok est NEUF (0 verdict) mais a DÉJÀ
    // cinq élections en vol (cinq tâches actives, modèle grok, pas encore
    // jugées). Sans la borne, grok serait à +∞ et raflerait la tâche prête.
    // Avec, ses cinq essais en vol éteignent l'infini, et opus (note haute)
    // reprend la main — le premier lancement a suffi.
    vecu('opus', 'appliquer', 8);
    for (let i = 0; i < 5; i++) {
      const tv = store.createTask({
        projectId: store.createProject({ name: 'vol' }).id,
        title: 'Ajoute un endpoint',
        prompt: 'implémente la fonction',
      }).id;
      store.poserModeleAiguillage(tv, 'grok', 100 + i);
      store.patchTask(tv, { status: 'running' }); // active, sans verdict ⇒ en vol
    }
    const nOpus = scheduler.registerNode(profile('n-opus', ['opus']));
    const nGrok = scheduler.registerNode(profile('n-grok', ['grok']));
    const t = tacheCode('Ajoute le composant Ruche');

    scheduler.tick(5_000);

    const task = store.getTask(t);
    expect(task?.assignedNodeId, 'grok en vol éteint son +∞ ⇒ opus reprend la tâche').toBe(
      nOpus.id,
    );
    expect(task?.assignedNodeId, 'et grok neuf ne rafle plus').not.toBe(nGrok.id);
  });
});
