// L'HORLOGE DE L'HÉBERGEUR S'ARRÊTE QUAND LA TENTATIVE S'ARRÊTE.
//
// ─── LE DÉFAUT QUE CE FICHIER EXISTE POUR EMPÊCHER ───────────────────────────
//
// En Cloud, la dépense d'un projet est `depenseHorlogeHote` : le solde clos,
// PLUS chaque session encore ouverte comptée jusqu'à `now`. Une session que
// personne ne ferme n'est donc pas « un peu fausse » : elle facture chaque
// seconde qui passe, jusqu'à ce que `pruneTasks` emporte la tâche. Or seul le
// RÉSULTAT fermait la session. Une annulation, un nœud perdu, un refus ou un
// redémarrage de la Reine la laissaient ouverte — et un projet Cloud pouvait
// finir « bloqué » sur un plafond que personne n'avait dépensé.
//
// ─── LA RÈGLE, DÉCIDÉE ───────────────────────────────────────────────────────
//
// Une tentative interrompue EST facturée, pour le temps qu'elle a réellement
// occupé l'hébergeur : la session se ferme à l'instant de l'interruption — le
// dernier instant où la Reine l'a vue vivante. Jamais au-delà.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import { NODE_TIMEOUT_MS } from '../src/shared/types.js';

const profil = (name: string): NodeProfile => ({
  name,
  ownerName: 'test',
  agentType: 'shell',
  maxConcurrency: 1,
});

/** Une heure plus tard : assez loin pour qu'une session restée ouverte se voie. */
const BIEN_PLUS_TARD = 60 * 60_000;

describe('horloge de l’hébergeur — close à l’interruption, jamais au-delà', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let projectId: string;
  let T: number;

  beforeEach(() => {
    store = new HiveStore(':memory:');
    scheduler = new Scheduler(store, { factureHorlogeHote: true });
    projectId = store.createProject({ name: 'Cloud' }).id;
    // Une base RÉELLE : l'horloge doit rester cohérente avec `Date.now()`
    // partout où un chemin ne reçoit pas d'instant explicite.
    T = Date.now();
  });

  afterEach(() => store.close());

  /** Une tâche prête, assignée à `nodeId` à l'instant T (session ouverte à T). */
  function assignerA(nodeId: string, titre = 'tâche facturée'): string {
    const task = store.createTask({ projectId, title: titre, prompt: 'p' }, T);
    store.patchTask(task.id, { status: 'ready' }, T);
    scheduler.tick(T);
    expect(store.getTask(task.id)).toMatchObject({ status: 'assigned', assignedNodeId: nodeId });
    return task.id;
  }

  const depense = (at: number): number => store.depenseHorlogeHote(projectId, at);

  it('une tâche annulée en vol cesse d’être facturée à l’instant de l’annulation', () => {
    const n1 = scheduler.registerNode(profil('n1'), T);
    const taskId = assignerA(n1.id);
    scheduler.handleTaskUpdate(n1.id, taskId);

    scheduler.cancelTask(taskId, 'annulée par un humain', T + 5_000);

    // Le défaut : sans fermeture, la même lecture une heure plus tard rendait
    // une heure et cinq secondes — pour une tâche qui ne tourne plus.
    expect(depense(T + BIEN_PLUS_TARD)).toBe(depense(T + 5_000));
    expect(depense(T + 5_000)).toBe(5_000);
  });

  it('un socket fermé arrête l’horloge ; la réassignation ouvre une session NEUVE', () => {
    const n1 = scheduler.registerNode(profil('n1'), T);
    const taskId = assignerA(n1.id);

    scheduler.nodeDisconnected(n1.id, 'ws_closed', T + 4_000);
    expect(store.getTask(taskId)?.status).toBe('ready');
    expect(depense(T + BIEN_PLUS_TARD)).toBe(4_000);

    // Le temps passé en file (de T+4 s à T+10 s) n'a occupé aucun hébergeur.
    const n2 = scheduler.registerNode(profil('n2'), T + 10_000);
    scheduler.tick(T + 10_000);
    expect(store.getTask(taskId)?.assignedNodeId).toBe(n2.id);
    expect(depense(T + 12_000)).toBe(4_000 + 2_000);
  });

  it('un nœud muet est facturé jusqu’à son dernier battement, pas jusqu’au fauchage', () => {
    const n1 = scheduler.registerNode(profil('n1'), T);
    const taskId = assignerA(n1.id);
    scheduler.heartbeat(n1.id, T + 3_000);

    // Le tick ne s'en aperçoit qu'une fois NODE_TIMEOUT_MS écoulé : ce délai
    // de détection n'est pas du temps que la tentative a consommé.
    scheduler.tick(T + 3_000 + NODE_TIMEOUT_MS + 1);
    expect(store.getTask(taskId)?.status).toBe('ready');
    expect(depense(T + BIEN_PLUS_TARD)).toBe(3_000);
  });

  it('un refus d’assignation ferme la session : la file d’attente n’est pas facturée', () => {
    const n1 = scheduler.registerNode(profil('n1'), T);
    const taskId = assignerA(n1.id);

    // Night Shift : le nœud refuse et demande qu'on ne le relance pas avant
    // une heure. La tâche attend en `ready` — sur aucun hébergeur.
    scheduler.rejectTask(n1.id, taskId, 'hors service', false, T + 1_000, BIEN_PLUS_TARD);
    expect(store.getTask(taskId)?.status).toBe('ready');
    expect(depense(T + BIEN_PLUS_TARD)).toBe(1_000);
  });

  it('un nœud revenu qui ré-adopte sa tâche ROUVRE l’horloge', () => {
    const n1 = scheduler.registerNode(profil('n1'), T);
    const taskId = assignerA(n1.id);
    scheduler.nodeDisconnected(n1.id, 'ws_closed', T + 2_000);

    // Le nœud revient et déclare la tâche : le travail vivant est ré-adopté,
    // l'hébergeur est de nouveau occupé — sans session, ce temps échapperait.
    scheduler.registerNode({ ...profil('n1'), nodeId: n1.id }, T + 7_000);
    scheduler.reconcileNode(n1.id, [taskId], T + 7_000);
    expect(store.getTask(taskId)).toMatchObject({ status: 'running', assignedNodeId: n1.id });

    scheduler.cancelTask(taskId, 'annulée par un humain', T + 10_000);
    expect(depense(T + BIEN_PLUS_TARD)).toBe(2_000 + 3_000);
  });

  it('une course éteinte par la perte de tous ses drones cesse d’être facturée', () => {
    const a = scheduler.registerNode(profil('a'), T);
    const b = scheduler.registerNode(profil('b'), T);
    const task = store.createTask({ projectId, title: 'course', prompt: 'p' }, T);
    store.patchTask(task.id, { status: 'ready' }, T);
    const course = scheduler.startRace(task.id, 2, T);
    expect(course.ok).toBe(true);

    scheduler.nodeDisconnected(a.id, 'ws_closed', T + 1_000);
    // Un drone vole encore : la tâche est toujours en vol, l'horloge tourne.
    expect(depense(T + 2_500) - depense(T + 2_000)).toBe(500);
    scheduler.nodeDisconnected(b.id, 'ws_closed', T + 3_000);
    expect(store.getTask(task.id)?.status).toBe('ready');
    expect(depense(T + BIEN_PLUS_TARD)).toBe(3_000);
  });
});

describe('horloge de l’hébergeur — le redémarrage de la Reine ne facture pas sa panne', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-horloge-boot-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('au démarrage, chaque session est close au dernier signe de vie, et aucune ne reste ouverte', () => {
    const dbPath = path.join(dir, 'hive.db');
    // La Reine d'avant tournait il y a deux heures, puis s'est arrêtée net.
    const T = Date.now() - 2 * BIEN_PLUS_TARD;
    const avant = new HiveStore(dbPath);
    const avantScheduler = new Scheduler(avant, { factureHorlogeHote: true });
    const projectId = avant.createProject({ name: 'Cloud' }).id;
    const n1 = avantScheduler.registerNode(profil('n1'), T);
    const orpheline = avant.createTask({ projectId, title: 'orpheline', prompt: 'p' }, T);
    avant.patchTask(orpheline.id, { status: 'ready' }, T);
    avantScheduler.tick(T);
    // Instants explicites : `handleTaskUpdate` daterait le démarrage de
    // l'horloge murale d'AUJOURD'HUI, deux heures après cette Reine-là.
    avant.patchTask(orpheline.id, { status: 'running' }, T + 1_000);
    // Dernier battement enregistré par la Reine avant sa chute.
    avantScheduler.heartbeat(n1.id, T + 8_000);
    // Une session laissée ouverte par une Reine sans ce correctif : la tâche
    // a été annulée à T+2 s, mais sa session courait encore.
    const annulee = avant.createTask({ projectId, title: 'annulée', prompt: 'p' }, T);
    avant.ouvrirHorlogeHote(projectId, annulee.id, T);
    avant.patchTask(annulee.id, { status: 'failed' }, T + 2_000);
    avant.close();

    const apres = new HiveStore(dbPath);
    new Scheduler(apres, { factureHorlogeHote: true }).recoverAtBoot();

    // 8 s pour l'orpheline (jusqu'à son dernier battement, pas deux heures de
    // panne), 2 s pour l'annulée (jusqu'à son annulation).
    const maintenant = Date.now();
    expect(apres.depenseHorlogeHote(projectId, maintenant)).toBe(8_000 + 2_000);
    expect(apres.depenseHorlogeHote(projectId, maintenant + BIEN_PLUS_TARD)).toBe(10_000);
    expect(apres.getTask(orpheline.id)?.status).toBe('ready');
    apres.close();
  });
});
