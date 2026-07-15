// Primitives partagées des vues Mission Control : contrat de props commun,
// grille alvéolaire (rayon de miel), sparkline SVG maison, polling léger et
// état de revue local. Aucune dépendance externe — CSS dans styles.css (mc-*).

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HiveEvent,
  StateSnapshot,
  SubAgent,
  Task,
  TaskStatus,
} from '../../../src/shared/types';
import { postReview } from '../api';

// ─── Contrat commun : App possède l'état temps réel, les vues le reçoivent ───

export type ViewId =
  'ruche' | 'miellerie' | 'projets' | 'essaim' | 'sante' | 'chronique' | 'memoire' | 'reine';

export interface ViewProps {
  snapshot: StateSnapshot;
  events: HiveEvent[];
  agentsByTask: Record<string, SubAgent[]>;
  /** Tâches différées par le Sting Detector (conflit de fichier). */
  deferred: Set<string>;
  /** Ouvre le tiroir de détail d'une tâche (global, au-dessus de toute vue). */
  onOpenTask: (taskId: string) => void;
  /**
   * Navigue vers une vue (met à jour le hash) ; selectedId optionnel.
   * `replace: true` pour les sélections intra-vue (pas d'entrée d'historique).
   */
  onNavigate: (view: ViewId, selectedId?: string, opts?: { replace?: boolean }) => void;
  /** Identifiant sélectionné porté par le hash (#/vue/id), sinon null. */
  selectedId: string | null;
  /** Compteur incrémenté à chaque événement pertinent — déclenche les re-fetchs. */
  refreshTick: number;
}

// ─── État de revue (Miellerie) : serveur partagé + repli localStorage ────────
// Source de vérité : le serveur (POST /api/tasks/:id/review, GET /api/reviews),
// synchronisé entre opérateurs via l'événement WS `task_reviewed`. Le
// localStorage ne sert que de repli si le serveur est injoignable (ou ancien).

export type ReviewState = 'approved' | 'rejected';
const REVIEW_KEY = 'hive.review';
const UNSYNCED_KEY = 'hive.review.unsynced';

/** Cache hydraté depuis le serveur ; null tant que /api/reviews n'a pas répondu. */
let serverReviews: Record<string, ReviewState> | null = null;
/** Fencing : seule la réponse du DERNIER GET /api/reviews lancé est appliquée. */
let hydrationSeq = 0;
let hydrating = false;
/** Deltas (optimistes ou WS) survenus pendant qu'un GET est en vol — rejoués après. */
let pendingDeltas: [string, ReviewState | null][] = [];
/** POSTs sérialisés par tâche : l'ordre serveur suit l'ordre des gestes. */
const postChains = new Map<string, Promise<void>>();
/** Tâches avec un POST local en vol : leurs échos WS sont différés (anti-clignotement). */
const locallyPending = new Set<string>();
/**
 * Dernier événement WS reçu PENDANT un POST local en vol : rejoué au drain de
 * la chaîne — le verdict concurrent d'un AUTRE opérateur ne doit jamais être
 * perdu (le WS est FIFO, c'est la vérité serveur la plus récente vue).
 */
const suppressedWhilePending = new Map<string, ReviewState | null>();

function notifyReviewChange(): void {
  window.dispatchEvent(new CustomEvent('hive:review'));
}

function readLocalReviews(): Record<string, ReviewState> {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '{}') as Record<string, ReviewState>;
  } catch {
    return {};
  }
}

// ─── Verdicts non confirmés par le serveur (outbox persistée) ────────────────
// Un POST échoué ne perd jamais le verdict : il est superposé à chaque
// hydratation et re-posté — une micro-coupure ne fait pas couler un rejet.

function readUnsynced(): Record<string, ReviewState | null> {
  try {
    return JSON.parse(localStorage.getItem(UNSYNCED_KEY) ?? '{}') as Record<
      string,
      ReviewState | null
    >;
  } catch {
    return {};
  }
}

function writeUnsynced(map: Record<string, ReviewState | null>): void {
  localStorage.setItem(UNSYNCED_KEY, JSON.stringify(map));
}

/** Nombre de verdicts locaux non confirmés par le serveur (bandeau d'alerte). */
export function countUnsyncedReviews(): number {
  return Object.keys(readUnsynced()).length;
}

function applyDelta(taskId: string, state: ReviewState | null): void {
  // Amorce depuis le repli local (jamais depuis vide) pour ne pas masquer
  // les revues existantes tant que l'hydratation n'a pas abouti.
  if (serverReviews === null) serverReviews = readLocalReviews();
  if (state === null) delete serverReviews[taskId];
  else serverReviews[taskId] = state;
  if (hydrating) pendingDeltas.push([taskId, state]);
}

/** À appeler AVANT fetchReviews() ; le jeton retourné est passé à hydrateReviews. */
export function beginReviewHydration(): number {
  hydrating = true;
  pendingDeltas = [];
  return ++hydrationSeq;
}

/**
 * Hydrate le cache depuis GET /api/reviews. Les deltas appliqués pendant que
 * la requête était en vol sont rejoués par-dessus l'instantané (un verdict
 * optimiste ou WS plus récent ne doit jamais être écrasé par un GET lent).
 */
export function hydrateReviews(map: Record<string, ReviewState>, seq?: number): void {
  if (seq !== undefined && seq !== hydrationSeq) return; // réponse périmée
  hydrating = false;
  const prev = serverReviews;
  serverReviews = { ...map };
  for (const [taskId, state] of pendingDeltas) {
    if (state === null) delete serverReviews[taskId];
    else serverReviews[taskId] = state;
  }
  pendingDeltas = [];
  // POSTs encore en vol : l'état local (geste le plus récent) prime sur un GET
  // dont l'instantané a pu être pris avant le traitement du POST.
  for (const taskId of locallyPending) {
    const state = prev ? (prev[taskId] ?? null) : null;
    if (state === null) delete serverReviews[taskId];
    else serverReviews[taskId] = state;
  }
  // Verdicts jamais confirmés (POST échoué avant une coupure) : superposés à
  // l'affichage ET re-postés — le serveur convergera vers le geste humain.
  for (const [taskId, state] of Object.entries(readUnsynced())) {
    if (locallyPending.has(taskId)) continue; // déjà en cours de renvoi
    if (state === null) delete serverReviews[taskId];
    else serverReviews[taskId] = state;
    enqueuePost(taskId, state);
  }
  notifyReviewChange();
}

/** Applique un événement `task_reviewed` reçu du flux WS (autre opérateur). */
export function applyReviewEvent(taskId: string, state: ReviewState | null): void {
  // Action locale encore en vol : on DIFFÈRE (sans perdre) — l'événement peut
  // être notre propre écho (no-op) comme le verdict d'un autre opérateur ;
  // il sera rejoué au drain de la chaîne de POSTs.
  if (locallyPending.has(taskId)) {
    suppressedWhilePending.set(taskId, state);
    return;
  }
  applyDelta(taskId, state);
  notifyReviewChange();
}

function readReviews(): Record<string, ReviewState> {
  return serverReviews ?? readLocalReviews();
}

export function getReview(taskId: string): ReviewState | null {
  return readReviews()[taskId] ?? null;
}

/** Enfile un POST de revue sérialisé par tâche, avec suivi unsynced + rejeu WS. */
function enqueuePost(taskId: string, state: ReviewState | null): void {
  // Tant que le serveur n'a pas confirmé, le verdict est « non synchronisé ».
  const unsynced = readUnsynced();
  unsynced[taskId] = state;
  writeUnsynced(unsynced);

  locallyPending.add(taskId);
  const prev = postChains.get(taskId) ?? Promise.resolve();
  const next = prev
    .then(() => postReview(taskId, state))
    .then(
      () => {
        const m = readUnsynced();
        if (taskId in m && m[taskId] === state) {
          delete m[taskId];
          writeUnsynced(m);
          notifyReviewChange(); // le bandeau « non synchronisé » se met à jour
        }
      },
      () => {
        // Échec (token invalide, serveur ancien/injoignable) : le verdict reste
        // local ET dans l'outbox — re-posté à la prochaine hydratation.
        window.dispatchEvent(
          new CustomEvent('hive:review-sync-error', { detail: { taskId, state } }),
        );
        notifyReviewChange();
      },
    );
  postChains.set(taskId, next);
  void next.finally(() => {
    if (postChains.get(taskId) === next) {
      postChains.delete(taskId);
      locallyPending.delete(taskId);
      // Rejouer le dernier événement WS différé pendant le vol : s'il venait
      // d'un autre opérateur, son verdict (vérité serveur) reprend la main.
      if (suppressedWhilePending.has(taskId)) {
        const buffered = suppressedWhilePending.get(taskId) ?? null;
        suppressedWhilePending.delete(taskId);
        const current = serverReviews ? (serverReviews[taskId] ?? null) : null;
        if (buffered !== current) {
          applyDelta(taskId, buffered);
          notifyReviewChange();
        }
      }
    }
  });
}

export function setReview(taskId: string, state: ReviewState | null): void {
  // Optimiste : cache + repli local immédiats, envoi serveur sérialisé derrière.
  applyDelta(taskId, state);
  const local = readLocalReviews();
  if (state === null) delete local[taskId];
  else local[taskId] = state;
  localStorage.setItem(REVIEW_KEY, JSON.stringify(local));
  notifyReviewChange();
  enqueuePost(taskId, state);
}

/** Nombre de tâches terminées non revues (badge sidebar + compteurs). */
export function countPendingReviews(tasks: Task[]): number {
  const reviews = readReviews();
  return tasks.filter((t) => (t.status === 'done' || t.status === 'failed') && !reviews[t.id])
    .length;
}

/** S'abonne aux changements d'état de revue (même onglet + autres onglets). */
export function useReviewTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('hive:review', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('hive:review', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  return tick;
}

// ─── Polling léger : fetch au montage + toutes les `intervalMs` + sur tick ───

export interface Poll<T> {
  data: T | null;
  error: string | null;
  refresh: () => void;
}

export function useApiPoll<T>(fetcher: () => Promise<T>, intervalMs: number, tick = 0): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [manual, setManual] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetcherRef
        .current()
        .then((d) => {
          if (alive) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    };
    load();
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [intervalMs, tick, manual]);

  const refresh = useCallback(() => setManual((m) => m + 1), []);
  return { data, error, refresh };
}

// ─── Rayon de miel : une alvéole hexagonale par tâche ────────────────────────

export interface HoneycombProps {
  tasks: Task[];
  deferred?: Set<string>;
  onSelect?: (task: Task) => void;
  /** Alvéoles compactes (footer merge, cartes projet). */
  mini?: boolean;
  /** Marque les alvéoles revues (remplies de miel) — Miellerie. */
  showReview?: boolean;
}

const HEX_STATUS_TITLE: Record<TaskStatus, string> = {
  pending: 'en attente',
  ready: 'prête',
  assigned: 'assignée',
  running: 'en cours',
  done: 'terminée',
  failed: 'échouée',
};

/** Grille d'hexagones : statut lisible à 3 mètres, cliquable alvéole par alvéole. */
export function Honeycomb({ tasks, deferred, onSelect, mini, showReview }: HoneycombProps) {
  const reviewTick = useReviewTick();
  void reviewTick; // relit localStorage à chaque changement de revue
  return (
    <div className={mini ? 'mc-comb mini' : 'mc-comb'} role="list" aria-label="Rayon de miel">
      {tasks.map((t) => {
        const review = showReview ? getReview(t.id) : null;
        const cls = [
          'mc-cell',
          t.status,
          deferred?.has(t.id) && t.status === 'ready' ? 'deferred' : '',
          review === 'approved' ? 'reviewed' : review === 'rejected' ? 'rejected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const label = `${t.title} — ${HEX_STATUS_TITLE[t.status]}`;
        return onSelect ? (
          <button
            key={t.id}
            className={cls}
            role="listitem"
            title={label}
            aria-label={label}
            onClick={() => onSelect(t)}
          />
        ) : (
          <span key={t.id} className={cls} role="listitem" title={label} aria-label={label} />
        );
      })}
    </div>
  );
}

// ─── Sparkline SVG maison (ECG, débit, latences) ─────────────────────────────

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Couleur CSS (défaut : var(--honey)). */
  stroke?: string;
  /** Anime le trait (battement ECG). */
  beat?: boolean;
}

export function Sparkline({ values, width = 120, height = 28, stroke, beat }: SparklineProps) {
  if (values.length === 0) values = [0];
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
    .join(' ');
  const flat = values.every((v) => v === 0);
  return (
    <svg
      className={`mc-spark${beat && !flat ? ' beat' : ''}${flat ? ' flat' : ''}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={stroke ?? 'var(--honey)'}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Horodatage court pour « dernier relevé à HH:MM:SS ». */
export function timeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
