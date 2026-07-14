// Hive Pulse (innovation) — les signes vitaux de la ruche.
//
// Là où le Waggle Board dit QUI contribue et Ghost QUOI cloche, Hive Pulse dit
// COMMENT VA la ruche dans son ensemble : débit de tâches dans le temps, latence
// (p50/p95), taux de succès global et nœuds actifs. Tout est dérivé du journal
// d'événements (source de vérité) par un repli PUR — aucune I/O, déterministe.

import type { HiveEvent } from '../shared/types.js';

const HOUR_MS = 3_600_000;
/** Nombre maximal de tranches horaires renvoyées (les plus récentes). Borne la réponse. */
const MAX_BUCKETS = 48;

/** Débit sur une tranche d'une heure. */
export interface PulseBucket {
  /** Début de l'heure (epoch ms, aligné sur l'heure). */
  hourStart: number;
  done: number;
  failed: number;
}

/** Statistiques de latence des tâches réussies (ms). */
export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  avg: number;
  max: number;
}

/** Photographie de la vitalité de la ruche. */
export interface HivePulse {
  totalDone: number;
  totalFailed: number;
  /** done / (done + failed) dans [0, 1] ; 1 si aucune issue terminale. */
  successRate: number;
  /** Nœuds en ligne à la fin du journal. */
  activeNodes: number;
  latency: LatencyStats;
  /** Débit par heure, trié par heure croissante, borné aux MAX_BUCKETS plus récentes. */
  throughput: PulseBucket[];
  /** Durée couverte par le journal (ms) : dernier ts − premier ts. */
  spanMs: number;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Percentile par rang le plus proche (nearest-rank), sur un tableau TRIÉ croissant.
 * p ∈ [0, 1]. Retourne 0 pour un tableau vide. Déterministe, sans interpolation.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(Math.min(1, Math.max(0, p)) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx] ?? 0;
}

/** Calcule les signes vitaux à partir du journal (événements triés par id croissant). */
export function computePulse(events: HiveEvent[]): HivePulse {
  const buckets = new Map<number, PulseBucket>();
  const durations: number[] = [];
  const nodeOnline = new Map<string, boolean>();
  let totalDone = 0;
  let totalFailed = 0;
  let firstTs = Infinity;
  let lastTs = -Infinity;

  const bucketOf = (ts: number): PulseBucket => {
    const hourStart = Math.floor(ts / HOUR_MS) * HOUR_MS;
    let b = buckets.get(hourStart);
    if (!b) {
      b = { hourStart, done: 0, failed: 0 };
      buckets.set(hourStart, b);
    }
    return b;
  };

  for (const event of events) {
    if (event.ts < firstTs) firstTs = event.ts;
    if (event.ts > lastTs) lastTs = event.ts;
    const p = event.payload ?? {};
    switch (event.type) {
      case 'node_registered':
      case 'node_online': {
        const nodeId = str(p, 'nodeId');
        if (nodeId) nodeOnline.set(nodeId, true);
        break;
      }
      case 'node_offline': {
        const nodeId = str(p, 'nodeId');
        if (nodeId) nodeOnline.set(nodeId, false);
        break;
      }
      case 'task_done': {
        totalDone += 1;
        bucketOf(event.ts).done += 1;
        durations.push(num(p, 'durationMs'));
        break;
      }
      case 'task_failed': {
        totalFailed += 1;
        bucketOf(event.ts).failed += 1;
        break;
      }
      default:
        break;
    }
  }

  durations.sort((a, b) => a - b);
  const sum = durations.reduce((s, d) => s + d, 0);
  const latency: LatencyStats = {
    count: durations.length,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    avg: durations.length === 0 ? 0 : Math.round(sum / durations.length),
    max: durations.length === 0 ? 0 : (durations[durations.length - 1] ?? 0),
  };

  const terminal = totalDone + totalFailed;
  const throughput = [...buckets.values()]
    .sort((a, b) => a.hourStart - b.hourStart)
    .slice(-MAX_BUCKETS);

  let activeNodes = 0;
  for (const online of nodeOnline.values()) if (online) activeNodes += 1;

  return {
    totalDone,
    totalFailed,
    successRate: terminal === 0 ? 1 : totalDone / terminal,
    activeNodes,
    latency,
    throughput,
    spanMs: events.length >= 2 && lastTs >= firstTs ? lastTs - firstTs : 0,
  };
}
