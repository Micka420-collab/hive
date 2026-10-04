// SANDBOX LIVE — l'état EN DIRECT d'une exécution, tel qu'il traverse la ruche.
//
// ─── CE QUE CE MODULE PORTE, ET CE QU'IL NE PORTE PAS ────────────────────────
//
// La sortie de l'agent voyage déjà (`task_output`, #489) et ses sous-agents
// aussi (`task_progress`). Il manquait l'ÉTAT de l'exécution : où elle en est
// (préparation → agent → validations), ce qui tourne (la commande), ce que ça
// coûte à la machine (CPU, mémoire de l'arbre de processus), si on peut la
// suspendre, et les validations du bac (#475) à mesure qu'elles concluent.
//
// Ce sont des faits ÉPHÉMÈRES : ils décrivent un instant, pas une histoire.
// Le hub les garde EN MÉMOIRE, une entrée par tâche vivante, et ne les
// journalise jamais — le journal est élagué PAR NOMBRE (`EVENT_RETENTION`), et
// une mesure toutes les cinq secondes y chasserait l'histoire de la ruche. Il
// les rend à un écran qui (re)vient, et les oublie à la fin de l'exécution
// (terminée, échouée, annulée, requalifiée).
//
// ─── BORNÉ DANS LES DEUX SENS, ET « INCONNU » RESTE INCONNU ──────────────────
//
// Chaque champ est optionnel et borné : un nœud qui ne sait pas mesurer (le
// mode processus sous Windows, un moteur qui ne répond pas) n'envoie RIEN, et
// l'écran écrit « inconnu » — jamais un zéro qui passerait pour une mesure.
// Un champ hors borne fait tomber le message entier, comme ailleurs dans le
// protocole : un nœud qui l'enverrait ment ou bogue.
//
// Module PUR : aucune I/O. Le nœud produit (`node-client/pilote-execution.ts`),
// le hub fusionne (`fusionnerDirect`), l'écran affiche.

import { VALIDATION_KEYS } from './validations-bac.js';
import type { ValidationKey, ValidationState } from './validations-bac.js';

/** Les phases d'une exécution, dans l'ordre. La fin n'en est pas une : l'état disparaît. */
export const PHASES_DIRECT = ['preparation', 'agent', 'validations'] as const;
export type PhaseDirect = (typeof PHASES_DIRECT)[number];

/** Une validation du bac : en cours, puis l'un des quatre états de #475. */
export type EtatControleDirect = 'en_cours' | ValidationState;
const ETATS_CONTROLE: readonly EtatControleDirect[] = [
  'en_cours',
  'passed',
  'failed',
  'missing',
  'not_applicable',
];

/**
 * La commande courante, caviardée par le nœud puis coupée ici. Trois cents
 * caractères disent QUOI tourne (`claude -p …`, `npm run test`) ; le prompt
 * entier, qui suit souvent, n'a rien à faire dans une ligne d'état.
 */
export const COMMANDE_DIRECT_MAX = 300;

/**
 * Le diff d'une exécution EN COURS, demandé à la main (bouton « Diff ») : au
 * plus 256 Kio. Un diff plus gros est coupé et le dit (`tronque`) — le diff
 * complet arrive avec le résultat. Jamais poussé : seulement demandé.
 */
export const DIFF_DIRECT_MAX = 256 * 1024;

/**
 * Les événements qui clôturent une exécution — et donc son état en direct, sa
 * sortie et ses sous-agents : la Reine oublie l'état qu'elle gardait, l'écran
 * vide ce qu'il affichait.
 */
export const FINS_D_EXECUTION: readonly string[] = [
  'task_done',
  'task_failed',
  'task_cancelled',
  'task_requeued',
  'task_retry',
  // Un nœud qui refuse APRÈS avoir fait tourner l'agent (auth, quota) : la
  // tâche redevient « prête », sans `task_requeued`. Sans cette fin, sa sortie
  // restait à l'écran et se collait à celle du nœud suivant.
  'task_rejected',
];

/** Toutes les combien le nœud mesure l'arbre de processus d'un agent. */
export const INTERVALLE_METRIQUES_MS = 5_000;

/**
 * Une mesure des ressources de l'exécution.
 *
 *   · `arbre` : l'arbre de processus de l'agent sur l'hôte (POSIX — le mode
 *     processus et bubblewrap, dont les processus sont visibles de l'hôte) ;
 *   · `conteneur` : ce que le moteur (Podman, Docker) dit de SON conteneur.
 *
 * `cpuPct` est en pour cent d'UN cœur (200 = deux cœurs pleins), sur la
 * fenêtre écoulée depuis la mesure précédente. Chaque nombre est absent quand
 * la source ne le donne pas.
 */
export interface MetriquesDirect {
  source: 'arbre' | 'conteneur';
  cpuPct?: number;
  rssOctets?: number;
  processus?: number;
}

/** Ce qu'un nœud envoie (`TaskUpdateMsg.direct`) : seulement ce qui a changé. */
export interface EtatDirect {
  phase?: PhaseDirect;
  commande?: string;
  /** La pause est-elle possible ICI, maintenant ? Faux : le bouton se cache. */
  pausable?: boolean;
  enPause?: boolean;
  /** `null` : la mesure ne vaut plus (l'agent est sorti) — « inconnu » à l'écran. */
  metriques?: MetriquesDirect | null;
  controles?: Partial<Record<ValidationKey, EtatControleDirect>>;
}

/** Ce que le hub garde et diffuse : l'état fusionné d'UNE exécution. */
export interface DirectTache {
  taskId: string;
  nodeId: string;
  phase?: PhaseDirect;
  commande?: string;
  pausable?: boolean;
  enPause?: boolean;
  metriques?: MetriquesDirect;
  controles?: Partial<Record<ValidationKey, EtatControleDirect>>;
  /** Heure du HUB à la dernière mise à jour, et à la dernière mesure. */
  majA: number;
  metriquesA?: number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nombre = (v: unknown, max: number): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

/** 1 024 cœurs, un pétaoctet, cent mille processus : au-delà, ce n'est pas une mesure. */
const CPU_PCT_MAX = 102_400;
const RSS_MAX = 2 ** 50;
const PROCESSUS_MAX = 100_000;

function metriquesDepuis(v: unknown): MetriquesDirect | null {
  if (!estObjet(v)) return null;
  if (v.source !== 'arbre' && v.source !== 'conteneur') return null;
  if (v.cpuPct !== undefined && !nombre(v.cpuPct, CPU_PCT_MAX)) return null;
  if (v.rssOctets !== undefined && !nombre(v.rssOctets, RSS_MAX)) return null;
  if (
    v.processus !== undefined &&
    !(Number.isInteger(v.processus) && nombre(v.processus, PROCESSUS_MAX))
  ) {
    return null;
  }
  return {
    source: v.source,
    ...(v.cpuPct !== undefined ? { cpuPct: v.cpuPct as number } : {}),
    ...(v.rssOctets !== undefined ? { rssOctets: v.rssOctets as number } : {}),
    ...(v.processus !== undefined ? { processus: v.processus as number } : {}),
  };
}

function controlesDepuis(v: unknown): Partial<Record<ValidationKey, EtatControleDirect>> | null {
  if (!estObjet(v)) return null;
  const sortie: Partial<Record<ValidationKey, EtatControleDirect>> = {};
  for (const [cle, etat] of Object.entries(v)) {
    if (!(VALIDATION_KEYS as readonly string[]).includes(cle)) return null;
    if (!ETATS_CONTROLE.includes(etat as EtatControleDirect)) return null;
    sortie[cle as ValidationKey] = etat as EtatControleDirect;
  }
  return sortie;
}

/**
 * Valide un `EtatDirect` venu du réseau, champ par champ ; `null` au premier
 * champ hors contrat. Les clés inconnues sont ignorées (un nœud plus récent).
 */
export function etatDirectDepuis(v: unknown): EtatDirect | null {
  if (!estObjet(v)) return null;
  const e: EtatDirect = {};
  if (v.phase !== undefined) {
    if (!PHASES_DIRECT.includes(v.phase as PhaseDirect)) return null;
    e.phase = v.phase as PhaseDirect;
  }
  if (v.commande !== undefined) {
    if (typeof v.commande !== 'string' || v.commande.length > COMMANDE_DIRECT_MAX) return null;
    e.commande = v.commande;
  }
  for (const cle of ['pausable', 'enPause'] as const) {
    if (v[cle] === undefined) continue;
    if (typeof v[cle] !== 'boolean') return null;
    e[cle] = v[cle];
  }
  if (v.metriques !== undefined) {
    if (v.metriques === null) e.metriques = null;
    else {
      const m = metriquesDepuis(v.metriques);
      if (!m) return null;
      e.metriques = m;
    }
  }
  if (v.controles !== undefined) {
    const c = controlesDepuis(v.controles);
    if (!c) return null;
    e.controles = c;
  }
  return e;
}

/** Valide l'état fusionné que le hub diffuse (`task_direct`), côté écran. */
export function directTacheDepuis(v: unknown): DirectTache | null {
  if (!estObjet(v)) return null;
  if (typeof v.taskId !== 'string' || !ID.test(v.taskId)) return null;
  if (typeof v.nodeId !== 'string' || !ID.test(v.nodeId)) return null;
  if (!nombre(v.majA, Number.MAX_SAFE_INTEGER)) return null;
  if (v.metriquesA !== undefined && !nombre(v.metriquesA, Number.MAX_SAFE_INTEGER)) return null;
  // `metriques: null` n'a pas cours ici : une mesure qui ne vaut plus est absente.
  if (v.metriques === null) return null;
  const etat = etatDirectDepuis(v);
  if (!etat) return null;
  const { metriques, ...reste } = etat;
  return {
    ...reste,
    ...(metriques ? { metriques } : {}),
    taskId: v.taskId,
    nodeId: v.nodeId,
    majA: v.majA as number,
    ...(v.metriquesA !== undefined ? { metriquesA: v.metriquesA as number } : {}),
  };
}

/**
 * Fusionne une mise à jour dans l'état gardé par le hub.
 *
 * Un AUTRE nœud repart de zéro : l'état d'une tentative ne se colle pas à la
 * suivante (réaffectation sans fin d'exécution vue, relance sur un autre
 * nœud). Les validations se fusionnent clé par clé : chacune arrive seule, à
 * mesure qu'elle conclut. Une phase qui change efface la commande de la
 * précédente — `npm run test` ne tourne plus pendant que l'agent reprend.
 */
export function fusionnerDirect(
  prev: DirectTache | undefined,
  taskId: string,
  nodeId: string,
  maj: EtatDirect,
  maintenant: number,
): DirectTache {
  const base: DirectTache =
    prev && prev.nodeId === nodeId ? { ...prev } : { taskId, nodeId, majA: maintenant };
  if (maj.phase !== undefined && maj.phase !== base.phase) {
    base.phase = maj.phase;
    delete base.commande;
  }
  if (maj.commande !== undefined) base.commande = maj.commande;
  if (maj.pausable !== undefined) base.pausable = maj.pausable;
  if (maj.enPause !== undefined) base.enPause = maj.enPause;
  if (maj.metriques === null) {
    delete base.metriques;
    delete base.metriquesA;
  } else if (maj.metriques !== undefined) {
    base.metriques = maj.metriques;
    base.metriquesA = maintenant;
  }
  if (maj.controles !== undefined) base.controles = { ...base.controles, ...maj.controles };
  base.majA = maintenant;
  return base;
}
