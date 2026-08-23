// LA COURSE NE DOIT PAS ENRÔLER UN NŒUD SIMULÉ EN PRODUCTION.
//
// ─── POURQUOI CE BANC ARRIVE MAINTENANT ──────────────────────────────────────
//
// La ruche a DEUX chemins d'assignation, et un seul était gardé :
//
//   · `tick()` filtre les candidats par `assignationProductionAutorisee` — un
//     nœud `shell` ne reçoit rien tant que le serveur n'est pas en simulation ;
//   · `startRace()` ne le faisait PAS. Il filtrait la charge, la
//     thermorégulation, les refus récents — pas la nature de l'agent.
//
// Ce n'était pas un défaut ATTEIGNABLE jusqu'ici : en production, un poste sans
// agent réel mourait avant de s'inscrire (`main.ts`, `process.exit(2)`), donc
// aucun nœud simulé n'existait pour être enrôlé.
//
// « Présence sans production » lève exactement cette barrière : ces machines
// rejoignent désormais la ruche. La faille dormante devient donc VIVE dans le
// même lot que le changement qui la réveille — c'est pour ça que le garde-fou
// et la présence voyagent ensemble.
//
// Ce que ça aurait coûté : une course lancée à la main aurait enrôlé la machine
// sans outil, son adaptateur `shell` aurait rendu un diff SIMULÉ, et la course
// l'aurait départagé contre du code réel. Un faux gagnant, dans une
// fonctionnalité dont tout l'intérêt est de départager.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';

function profile(name: string, agentType: string): NodeProfile {
  return { name, ownerName: 'test', agentType, maxConcurrency: 2 };
}

describe('startRace — la nature de l’agent est filtrée comme dans `tick`', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assignations: { nodeId: string; taskId: string }[];

  function monter(simulation: boolean | undefined): void {
    store = new HiveStore(':memory:');
    assignations = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task) => assignations.push({ nodeId, taskId: task.id }),
      ...(simulation === undefined ? {} : { simulation }),
    });
  }
  afterEach(() => store.close());

  function tachePrete(): string {
    const p = store.createProject({ name: 'P' });
    const id = store.createTask({ projectId: p.id, title: 'critique', prompt: 'x' }).id;
    store.patchTask(id, { status: 'ready' });
    return id;
  }

  describe('serveur en PRODUCTION (simulation: false)', () => {
    beforeEach(() => monter(false));

    it('UN NŒUD SIMULÉ N’EST JAMAIS ENRÔLÉ DANS UNE COURSE', () => {
      const taskId = tachePrete();
      const reel = scheduler.registerNode(profile('n-reel', 'claude-code')).id;
      const simule = scheduler.registerNode(profile('n-simule', 'shell')).id;

      const started = scheduler.startRace(taskId, 2, 1_000);
      expect(started.ok, 'la course part : un nœud réel suffit').toBe(true);

      const enroles = assignations.map((a) => a.nodeId);
      expect(enroles).toContain(reel);
      expect(enroles, 'le nœud simulé ne court pas contre du code réel').not.toContain(simule);
    });

    it('UNE RUCHE QUI N’A QUE DES NŒUDS SIMULÉS NE LANCE AUCUNE COURSE', () => {
      // Le cas du tout premier lancement, désormais atteignable : deux postes
      // rejoignent en PRÉSENCE, aucun ne porte d'agent. Mieux vaut refuser la
      // course que la faire courir toute seule avec des diffs inventés.
      const taskId = tachePrete();
      scheduler.registerNode(profile('n-a', 'shell'));
      scheduler.registerNode(profile('n-b', 'shell'));

      const started = scheduler.startRace(taskId, 2, 1_000);
      expect(started.ok).toBe(false);
      expect(assignations).toHaveLength(0);
    });
  });

  describe('serveur en SIMULATION (simulation: true)', () => {
    beforeEach(() => monter(true));

    it('LÀ, LE NŒUD SIMULÉ COURT — c’est la démonstration qu’on a demandée', () => {
      // L'autre moitié de la règle, et elle compte autant : un filtre qui
      // exclurait `shell` PARTOUT éteindrait toutes les démonstrations du
      // dépôt. La garde suit la config du serveur, pas une opinion sur `shell`.
      const taskId = tachePrete();
      const a = scheduler.registerNode(profile('n-a', 'shell')).id;
      const b = scheduler.registerNode(profile('n-b', 'shell')).id;

      const started = scheduler.startRace(taskId, 2, 1_000);
      expect(started.ok).toBe(true);
      const enroles = assignations.map((a2) => a2.nodeId);
      expect(enroles).toContain(a);
      expect(enroles).toContain(b);
    });
  });

  describe('serveur SANS flag (bancs unitaires historiques)', () => {
    beforeEach(() => monter(undefined));

    it('LA RÉTROCOMPAT EST PRÉSERVÉE — `shell` reste enrôlable', () => {
      // `assignationProductionAutorisee` rend `true` quand `simulation` est
      // ABSENT : c'est la rétrocompat que `tick` respecte déjà, et la course
      // doit se comporter pareil. Sans cette case, ce lot casserait des bancs
      // qui ne parlent pas de simulation du tout.
      const taskId = tachePrete();
      const a = scheduler.registerNode(profile('n-a', 'shell')).id;
      scheduler.registerNode(profile('n-b', 'claude-code'));

      const started = scheduler.startRace(taskId, 2, 1_000);
      expect(started.ok).toBe(true);
      expect(assignations.map((x) => x.nodeId)).toContain(a);
    });
  });
});
