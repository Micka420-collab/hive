// Tests de la Thermorégulation : la ruche ventile quand elle surchauffe —
// module pur (prise de température, bandes, facteur, concurrence effective)
// puis câblage scheduler : hystérésis sur deux ticks, événement thermo_shift,
// concurrence réduite sous surchauffe et restaurée quand la ruche refroidit.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import { concurrenceEffective, lireTemperature } from '../src/orchestrator/thermo.js';

const FENETRE_MS = 10 * 60 * 1_000;

/** Fabrique `count` événements d'un type donné, tous datés de `ts`. */
function evs(
  type: string,
  count: number,
  ts: number,
): Array<{ type: string; ts: number; payload?: Record<string, unknown> }> {
  return Array.from({ length: count }, () => ({ type, ts }));
}

describe('lireTemperature (module pur)', () => {
  const now = 100 * FENETRE_MS;

  it('échantillon maigre (< 4 issues) → froide à 20°, jamais de panique à froid', () => {
    const lecture = lireTemperature(
      [...evs('task_failed', 2, now), ...evs('task_retry', 1, now)],
      now,
    );
    expect(lecture).toEqual({
      temperature: 20,
      bande: 'froide',
      facteur: 1,
      signaux: { echecs: 2, retries: 1, refusInfra: 0, succes: 0, total: 3 },
    });
  });

  it('100 % de succès → température 0, froide, pleine concurrence', () => {
    const lecture = lireTemperature(evs('task_done', 6, now), now);
    expect(lecture.temperature).toBe(0);
    expect(lecture.bande).toBe('froide');
    expect(lecture.facteur).toBe(1);
    expect(lecture.signaux).toEqual({ echecs: 0, retries: 0, refusInfra: 0, succes: 6, total: 6 });
  });

  it('moitié d’échecs → 100 × 2 / 4 = 50° : bande chaude, facteur 0.75', () => {
    const lecture = lireTemperature(
      [...evs('task_done', 2, now), ...evs('task_failed', 2, now)],
      now,
    );
    expect(lecture.temperature).toBe(50);
    expect(lecture.bande).toBe('chaude');
    expect(lecture.facteur).toBe(0.75);
  });

  it('pondérations : 1 échec + 1 retry + 1 refus infra + 1 succès → (1 + 0.6 + 0.8) × 25 = 60°', () => {
    const lecture = lireTemperature(
      [
        { type: 'task_failed', ts: now },
        { type: 'task_retry', ts: now },
        { type: 'task_rejected', ts: now, payload: { infra: true } },
        { type: 'task_done', ts: now },
      ],
      now,
    );
    expect(lecture.temperature).toBe(60);
    expect(lecture.bande).toBe('chaude');
    expect(lecture.signaux).toEqual({ echecs: 1, retries: 1, refusInfra: 1, succes: 1, total: 4 });
  });

  // ─── Ce qui ne doit PAS chauffer la ruche ─────────────────────────────────

  it('les échecs en CASCADE ne comptent pas : un vrai échec n’en vaut pas dix', () => {
    // 1 échec réel + 9 dépendantes fauchées en cascade, et 3 succès.
    const cascade = Array.from({ length: 9 }, () => ({
      type: 'task_failed',
      ts: now,
      payload: { reason: 'dependency_failed' },
    }));
    const lecture = lireTemperature(
      [
        { type: 'task_failed', ts: now, payload: { reason: 'boom' } },
        ...cascade,
        ...evs('task_done', 3, now),
      ],
      now,
    );
    expect(lecture.signaux).toEqual({ echecs: 1, retries: 0, refusInfra: 0, succes: 3, total: 4 });
    expect(lecture.temperature).toBe(25); // 100 × 1 / 4 — et non 100 × 10 / 13 = 77°
    expect(lecture.bande).toBe('normale');
  });

  it('un refus SANS infra (saturation, Night Shift) vient d’une ruche saine : ignoré', () => {
    const lecture = lireTemperature(
      [
        { type: 'task_rejected', ts: now, payload: { reason: 'hors_service_night_shift' } },
        { type: 'task_rejected', ts: now, payload: { reason: 'sature' } },
        ...evs('task_done', 4, now),
      ],
      now,
    );
    expect(lecture.signaux).toEqual({ echecs: 0, retries: 0, refusInfra: 0, succes: 4, total: 4 });
    expect(lecture.temperature).toBe(0);
  });

  it('frontière basse : 1 échec pour 3 succès → 25° pile, bande normale', () => {
    const lecture = lireTemperature(
      [...evs('task_done', 3, now), ...evs('task_failed', 1, now)],
      now,
    );
    expect(lecture.temperature).toBe(25);
    expect(lecture.bande).toBe('normale');
    expect(lecture.facteur).toBe(1);
  });

  it('80 % d’échecs → 80° : surchauffe, facteur 0.5', () => {
    const lecture = lireTemperature(
      [...evs('task_failed', 8, now), ...evs('task_done', 2, now)],
      now,
    );
    expect(lecture.temperature).toBe(80);
    expect(lecture.bande).toBe('surchauffe');
    expect(lecture.facteur).toBe(0.5);
  });

  it('100 % d’échecs → plafond 100°', () => {
    expect(lireTemperature(evs('task_failed', 5, now), now).temperature).toBe(100);
  });

  it('les événements hors fenêtre (> 10 min) sont ignorés', () => {
    const vieux = now - FENETRE_MS - 1;
    // 10 échecs anciens n'entrent ni dans la chaleur ni dans le total.
    const lecture = lireTemperature(
      [...evs('task_failed', 10, vieux), ...evs('task_done', 4, now - 1_000)],
      now,
    );
    expect(lecture.temperature).toBe(0);
    expect(lecture.bande).toBe('froide');
    expect(lecture.signaux).toEqual({ echecs: 0, retries: 0, refusInfra: 0, succes: 4, total: 4 });
  });

  it('les événements non terminaux (assignation, progrès…) ne comptent pas', () => {
    const lecture = lireTemperature(
      [...evs('task_assigned', 20, now), ...evs('task_progress', 20, now)],
      now,
    );
    expect(lecture.signaux.total).toBe(0);
    expect(lecture.bande).toBe('froide');
  });
});

describe('concurrenceEffective', () => {
  it('applique le facteur avec un arrondi à l’entier inférieur', () => {
    expect(concurrenceEffective(4, 1)).toBe(4);
    expect(concurrenceEffective(4, 0.75)).toBe(3);
    expect(concurrenceEffective(4, 0.5)).toBe(2);
    expect(concurrenceEffective(3, 0.75)).toBe(2); // floor(2.25)
  });

  it('plancher à 1 : la ruche ne s’arrête jamais, elle ralentit', () => {
    expect(concurrenceEffective(1, 0.5)).toBe(1);
    expect(concurrenceEffective(1, 0.75)).toBe(1);
    expect(concurrenceEffective(2, 0.5)).toBe(1);
  });
});

describe('Thermorégulation : câblage scheduler', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assigned: { nodeId: string; taskId: string }[];

  beforeEach(() => {
    store = new HiveStore(':memory:');
    assigned = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task) => assigned.push({ nodeId, taskId: task.id }),
    });
  });

  afterEach(() => store.close());

  function profile(name: string): NodeProfile {
    return { name, ownerName: 'test', agentType: 'shell', maxConcurrency: 4 };
  }

  /** Injecte une rafale d'issues défavorables récentes dans le journal. */
  function rafaleChaude(now: number): void {
    for (let i = 0; i < 6; i++) store.appendEvent('task_failed', { taskId: `f${i}` }, now - 5_000);
    for (let i = 0; i < 4; i++) store.appendEvent('task_retry', { taskId: `r${i}` }, now - 5_000);
  }

  /** Crée `count` tâches prêtes à être assignées. */
  function tachesPretes(projectId: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const t = store.createTask({ projectId, title: `T${i}`, prompt: 'p' });
      store.patchTask(t.id, { status: 'ready' });
    }
  }

  it('surchauffe confirmée sur deux ticks : thermo_shift émis et concurrence réduite à 2/4', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    const node = scheduler.registerNode(profile('ouvriere'), now);
    // 6 échecs + 4 retries récents : 100 × (6 + 2.4) / 10 = 84° → surchauffe.
    rafaleChaude(now);

    // Tick 1 : lecture divergente mais PAS de bascule (hystérésis).
    scheduler.tick(now);
    expect(scheduler.thermo).toEqual({ bande: 'froide', facteur: 1 });
    expect(store.listEvents(0, 1000).some((e) => e.type === 'thermo_shift')).toBe(false);

    // Tick 2 : même lecture divergente → la ruche passe en surchauffe.
    scheduler.tick(now + 4_000);
    expect(scheduler.thermo).toEqual({ bande: 'surchauffe', facteur: 0.5 });
    const shift = store.listEvents(0, 1000).find((e) => e.type === 'thermo_shift');
    expect(shift?.payload).toEqual({ bande: 'surchauffe', temperature: 84, facteur: 0.5 });
    // Payload de faits typés : aucun message français figé en base.
    expect(shift?.payload.message).toBeUndefined();

    // 4 tâches prêtes, un nœud maxConcurrency=4 : seules 2 sont assignées.
    tachesPretes(p.id, 4);
    scheduler.tick(now + 8_000);
    expect(assigned).toHaveLength(2);
    expect(assigned.every((a) => a.nodeId === node.id)).toBe(true);
    expect(store.tasksByStatus('assigned')).toHaveLength(2);
    expect(store.tasksByStatus('ready')).toHaveLength(2);
  });

  it('la ventilation se restaure quand la fenêtre refroidit : les tâches différées partent', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    const node = scheduler.registerNode(profile('ouvriere'), now);
    rafaleChaude(now);
    scheduler.tick(now);
    scheduler.tick(now + 4_000); // surchauffe confirmée
    tachesPretes(p.id, 4);
    scheduler.tick(now + 8_000);
    expect(assigned).toHaveLength(2); // ventilation : 2 sur 4

    // 11 minutes plus tard, la rafale est sortie de la fenêtre : lecture froide.
    const apres = now + FENETRE_MS + 60_000;
    scheduler.heartbeat(node.id, apres); // le nœud reste vivant (pas de reap)
    scheduler.tick(apres); // divergence pressentie, encore surchauffe
    expect(scheduler.thermo.bande).toBe('surchauffe');
    expect(store.tasksByStatus('assigned')).toHaveLength(2);

    scheduler.heartbeat(node.id, apres + 4_000);
    scheduler.tick(apres + 4_000); // confirmation → froide, et le même tick assigne le reste
    expect(scheduler.thermo).toEqual({ bande: 'froide', facteur: 1 });
    expect(store.tasksByStatus('assigned')).toHaveLength(4);
    const shifts = store.listEvents(0, 1000).filter((e) => e.type === 'thermo_shift');
    expect(shifts.map((e) => e.payload.bande)).toEqual(['surchauffe', 'froide']);
  });

  it('la fenêtre est TEMPORELLE : un flot de task_progress n’aveugle pas la ventilation', () => {
    const now = Date.now();
    scheduler.registerNode(profile('ouvriere'), now);
    rafaleChaude(now); // 6 échecs + 4 retries → 84°, surchauffe
    // 3 000 progrès plus récents : sur une lecture par LOT (les N derniers
    // événements, tous types confondus), la rafale sortait du champ de vision
    // et la ruche restait froide alors qu'elle brûlait.
    for (let i = 0; i < 3_000; i++) {
      store.appendEvent('task_progress', { taskId: `p${i}` }, now - 1_000);
    }

    scheduler.tick(now);
    scheduler.tick(now + 4_000);

    expect(scheduler.thermo).toEqual({ bande: 'surchauffe', facteur: 0.5 });
  });

  it('hystérésis : deux ticks consécutifs HORS bande suffisent, même divergents', () => {
    const now = Date.now();
    // Tick 1 : 5 échecs / 5 succès → 50°, bande chaude (divergente #1).
    for (let i = 0; i < 5; i++) store.appendEvent('task_failed', { taskId: `f${i}` }, now - 5_000);
    for (let i = 0; i < 5; i++) store.appendEvent('task_done', { taskId: `d${i}` }, now - 5_000);
    scheduler.tick(now);
    expect(scheduler.thermo.bande).toBe('froide');

    // Tick 2 : 15 échecs / 5 succès → 75°, bande surchauffe (divergente #2,
    // mais DIFFÉRENTE). L'ancienne règle exigeait deux lectures IDENTIQUES :
    // deux bandes divergentes en alternance ne basculaient jamais.
    for (let i = 0; i < 10; i++) store.appendEvent('task_failed', { taskId: `g${i}` }, now - 4_000);
    scheduler.tick(now + 4_000);

    expect(scheduler.thermo).toEqual({ bande: 'surchauffe', facteur: 0.5 });
  });

  it('les échecs en cascade propagés par le scheduler ne font pas chauffer la ruche', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    const socle = store.createTask({ projectId: p.id, title: 'socle', prompt: 'x' });
    for (let i = 0; i < 9; i++) {
      store.createTask({
        projectId: p.id,
        title: `dependante ${i}`,
        prompt: 'y',
        dependsOn: [socle.id],
      });
    }
    store.patchTask(socle.id, { status: 'failed' });
    for (let i = 0; i < 6; i++) store.appendEvent('task_done', { taskId: `d${i}` }, now);

    scheduler.tick(now); // propage 9 task_failed « dependency_failed »
    scheduler.tick(now + 4_000);

    expect(store.listEvents(0, 1000).filter((e) => e.type === 'task_failed')).toHaveLength(9);
    // Un seul incident réel : la ruche reste froide (ancien calcul : 60°, chaude).
    expect(scheduler.thermo).toEqual({ bande: 'froide', facteur: 1 });
  });

  it('une course explicite respecte la ventilation en vigueur', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    const node = scheduler.registerNode(profile('ouvriere'), now); // maxConcurrency 4
    rafaleChaude(now);
    scheduler.tick(now);
    scheduler.tick(now + 4_000);
    expect(scheduler.thermo.facteur).toBe(0.5); // concurrence effective : 2

    // Le nœud porte déjà 2 tâches : plein sous ventilation, libre sans elle.
    for (let i = 0; i < 2; i++) {
      const occupee = store.createTask({ projectId: p.id, title: `occupation ${i}`, prompt: 'z' });
      store.patchTask(occupee.id, { status: 'running', assignedNodeId: node.id });
    }
    const course = store.createTask({ projectId: p.id, title: 'course', prompt: 'w' });
    store.patchTask(course.id, { status: 'ready' });

    const res = scheduler.startRace(course.id, 2, now + 8_000);
    expect(res).toEqual({ ok: false, error: 'aucun nœud disponible pour la course' });
  });

  it('ruche saine : 4 tâches assignées d’un coup, aucun thermo_shift', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    const node = scheduler.registerNode(profile('ouvriere'), now);
    // Que des succès récents : température 0, bande froide (comme au boot).
    for (let i = 0; i < 6; i++) store.appendEvent('task_done', { taskId: `d${i}` }, now - 5_000);
    tachesPretes(p.id, 4);

    scheduler.tick(now);
    scheduler.tick(now + 4_000);

    expect(scheduler.thermo).toEqual({ bande: 'froide', facteur: 1 });
    expect(assigned).toHaveLength(4);
    expect(assigned.every((a) => a.nodeId === node.id)).toBe(true);
    expect(store.listEvents(0, 1000).some((e) => e.type === 'thermo_shift')).toBe(false);
  });
});
