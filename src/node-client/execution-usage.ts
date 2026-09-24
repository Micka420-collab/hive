import type { ExecutionUsage } from '../shared/types.js';

/**
 * Snapshot local de la consommation du processus Worker.
 *
 * Les valeurs viennent uniquement des compteurs du processus Node : aucun
 * argument, log, chemin ou secret n'entre dans la mesure. Les compteurs sont
 * des faits d'observation, pas une estimation de facture fournisseur.
 */
export interface ExecutionUsageSnapshot {
  userCpuMicros: number;
  systemCpuMicros: number;
  maxRssBytes: number;
  rssBytes: number;
  heapUsedBytes: number;
}

const entierPositif = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;

const kiloOctetsEnOctets = (value: number): number => {
  const kiloOctets = entierPositif(value);
  return kiloOctets <= Math.floor(Number.MAX_SAFE_INTEGER / 1024)
    ? kiloOctets * 1024
    : Number.MAX_SAFE_INTEGER;
};

/** Capture les compteurs disponibles sur toutes les plateformes Node supportées. */
export function capturerExecutionUsage(): ExecutionUsageSnapshot {
  const cpu = process.resourceUsage();
  const memory = process.memoryUsage();
  return {
    userCpuMicros: entierPositif(cpu.userCPUTime),
    systemCpuMicros: entierPositif(cpu.systemCPUTime),
    // Node expose maxRSS en kilo-octets. La conversion est bornée avant la
    // multiplication afin de ne jamais fabriquer un nombre non sûr.
    maxRssBytes: kiloOctetsEnOctets(cpu.maxRSS),
    rssBytes: entierPositif(memory.rss),
    heapUsedBytes: entierPositif(memory.heapUsed),
  };
}

const delta = (after: number, before: number): number =>
  Number.isSafeInteger(after) && Number.isSafeInteger(before) ? Math.max(0, after - before) : 0;

/**
 * Produit une mesure bornée depuis deux snapshots. `maxRssBytes`, `rssBytes`
 * et `heapUsedBytes` sont des valeurs instantanées ; le CPU est un delta.
 */
export function executionUsageDepuis(
  avant: ExecutionUsageSnapshot,
  apres: ExecutionUsageSnapshot,
): ExecutionUsage {
  return {
    userCpuMicros: delta(apres.userCpuMicros, avant.userCpuMicros),
    systemCpuMicros: delta(apres.systemCpuMicros, avant.systemCpuMicros),
    maxRssBytes: Math.max(0, entierPositif(apres.maxRssBytes)),
    rssBytes: Math.max(0, entierPositif(apres.rssBytes)),
    heapUsedBytes: Math.max(0, entierPositif(apres.heapUsedBytes)),
  };
}
