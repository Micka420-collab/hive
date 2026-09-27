// UNE RELECTURE NE CHANGE PAS DE RELECTEUR.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// Une contre-expertise est posée par le hub DIRECTEMENT sur le nœud d'une autre
// famille (`signalerContreExpertise`), et le lien consigne qui relit : son
// nœud, son agent. Le verdict qui revient est attribué à CE relecteur
// (`noterVerdict` lit `lien.relecteurNodeId` / `lien.relecteurAgent`), et
// l'Aiguillage apprend de ce verdict.
//
// Or une relecture peut revenir en file : le relecteur est saturé et refuse
// (`noeud_sature`), ou il se déconnecte. La file ne savait pas qu'une relecture
// a un relecteur désigné : le planificateur la confiait au premier nœud libre —
// très souvent le PRODUCTEUR lui-même, qui venait justement de se libérer en
// rendant sa production. Claude relisait Claude, et le verdict était consigné
// comme celui de Codex.
//
// Ce n'était pas une vue de l'esprit sur le chemin par défaut : avec une
// ouvrière par agent, chacune à une tâche à la fois (`planOuvrieres`), le
// relecteur est occupé chaque fois que sa propre production tourne encore.
//
// La relecture ATTEND donc son relecteur. Une relecture qui attend se voit
// (une tâche prête, nommée « Contre-expertise — … ») ; une relecture faite par
// le mauvais modèle et signée du bon ne se voit nulle part.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';

/** Un instant fixe : tout le banc est daté, rien ne dépend de l'horloge. */
const T = 1_000_000;
/** Au-delà du refroidissement d'un refus (`REJECT_COOLDOWN_MS`, 3 s). */
const APRES_REFROIDISSEMENT = T + 10_000;

describe('UNE RELECTURE NE CHANGE PAS DE RELECTEUR', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  beforeEach(() => {
    store = new HiveStore(':memory:');
    scheduler = new Scheduler(store);
  });
  afterEach(() => store.close());

  /**
   * Une production de Claude, une relecture confiée à Codex, et Codex occupé
   * par son propre travail. Le producteur est nommé pour passer EN PREMIER
   * dans l'ordre par défaut (charge égale, puis nom) : c'est lui que la file
   * choisissait.
   */
  function scene(): {
    producteur: string;
    relecteur: string;
    relecture: string;
    occupation: string;
  } {
    const producteur = scheduler.registerNode(
      { name: 'aaa-claude', ownerName: 'banc', agentType: 'claude-code', maxConcurrency: 1 },
      T,
    ).id;
    const relecteur = scheduler.registerNode(
      { name: 'zzz-codex', ownerName: 'banc', agentType: 'codex', maxConcurrency: 1 },
      T,
    ).id;
    const p = store.createProject({ name: 'P' });
    const production = store.createTask({
      projectId: p.id,
      title: 'Ajoute un endpoint',
      prompt: 'implémente la route',
    });
    store.patchTask(production.id, { status: 'done', assignedNodeId: producteur }, T);
    // Codex tient une tâche : à une tâche à la fois, il est saturé.
    const occupation = store.createTask({
      projectId: p.id,
      title: 'Travail de Codex',
      prompt: 'x',
    });
    store.patchTask(occupation.id, { status: 'running', assignedNodeId: relecteur }, T);
    // La relecture, posée comme le hub la pose : liée d'abord, assignée ensuite.
    const relecture = store.createTask({
      projectId: p.id,
      title: 'Contre-expertise — Ajoute un endpoint',
      prompt: 'relis',
    });
    store.inscrireRelecture({
      relectureTaskId: relecture.id,
      productionTaskId: production.id,
      relecteurNodeId: relecteur,
      relecteurAgent: 'codex',
      producteurAgent: 'claude-code',
      now: T,
    });
    store.patchTask(relecture.id, { status: 'assigned', assignedNodeId: relecteur }, T);
    return { producteur, relecteur, relecture: relecture.id, occupation: occupation.id };
  }

  it('LE RELECTEUR SATURÉ REFUSE : la relecture l’attend, elle ne part pas chez le producteur', () => {
    const { producteur, relecteur, relecture, occupation } = scene();

    // Le nœud Codex répond `task_reject` / `noeud_sature` — son geste réel.
    scheduler.rejectTask(relecteur, relecture, 'noeud_sature', false, T + 10);

    const apresRefus = store.getTask(relecture);
    expect(apresRefus?.assignedNodeId, 'Claude relirait Claude sous le nom de Codex').not.toBe(
      producteur,
    );
    expect(apresRefus?.status, 'la relecture attend, en file').toBe('ready');

    // Même le producteur libre, rien ne change : l'attente n'est pas une course.
    scheduler.tick(T + 20);
    expect(store.getTask(relecture)?.assignedNodeId ?? null).toBeNull();

    // Codex se libère, le refroidissement du refus passe : la relecture lui revient.
    store.patchTask(occupation, { status: 'done' }, APRES_REFROIDISSEMENT);
    scheduler.tick(APRES_REFROIDISSEMENT);
    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);
  });

  it('LE RELECTEUR SE DÉCONNECTE : la relecture l’attend jusqu’à son retour', () => {
    const { producteur, relecteur, relecture, occupation } = scene();
    // Codex n'a plus que la relecture : c'est ELLE seule qui repart en file, et
    // le producteur, libre, est le premier nœud que la file trouverait.
    store.patchTask(occupation, { status: 'done' }, T + 5);

    // Perte du nœud Codex : ses tâches actives repartent en file.
    scheduler.nodeDisconnected(relecteur, 'ws_close', T + 10);
    expect(store.getTask(relecture)?.status).toBe('ready');
    expect(store.getTask(relecture)?.assignedNodeId, 'confiée au producteur').not.toBe(producteur);

    // Il revient (même identité, stable par dossier de travail) : la relecture
    // repart chez lui, et chez personne d'autre.
    scheduler.heartbeat(relecteur, APRES_REFROIDISSEMENT);
    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);
  });

  it('UNE TÂCHE ORDINAIRE, ELLE, VA TOUJOURS AU PREMIER NŒUD LIBRE', () => {
    // La garde ne vise QUE les relectures : une production n'a pas de nœud
    // désigné, et la bloquer en attente serait une ruche qui ralentit pour rien.
    const { producteur } = scene();
    const p = store.createProject({ name: 'Q' });
    const ordinaire = store.createTask({ projectId: p.id, title: 'Écris la doc', prompt: 'doc' });

    scheduler.tick(T + 20);

    expect(store.getTask(ordinaire.id)?.assignedNodeId).toBe(producteur);
  });
});
