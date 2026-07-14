// Primitives partagées des vues Mission Control : contrat de props commun,
// grille alvéolaire (rayon de miel), sparkline SVG maison, polling léger et
// état de revue local. Aucune dépendance externe — CSS dans styles.css (mc-*).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HiveEvent, StateSnapshot, SubAgent, Task, TaskStatus } from '../../../src/shared/types';

// ─── Contrat commun : App possède l'état temps réel, les vues le reçoivent ───

export type ViewId =
  | 'ruche'
  | 'miellerie'
  | 'projets'
  | 'essaim'
  | 'sante'
  | 'chronique'
  | 'memoire';

export interface ViewProps {
  snapshot: StateSnapshot;
  events: HiveEvent[];
  agentsByTask: Record<string, SubAgent[]>;
  /** Tâches différées par le Sting Detector (conflit de fichier). */
  deferred: Set<string>;
  /** Ouvre le tiroir de détail d'une tâche (global, au-dessus de toute vue). */
  onOpenTask: (taskId: string) => void;
  /** Navigue vers une vue (met à jour le hash) ; selectedId optionnel. */
  onNavigate: (view: ViewId, selectedId?: string) => void;
  /** Identifiant sélectionné porté par le hash (#/vue/id), sinon null. */
  selectedId: string | null;
  /** Compteur incrémenté à chaque événement pertinent — déclenche les re-fetchs. */
  refreshTick: number;
}

// ─── État de revue local (Miellerie) — v1 côté client, serveur au palier 5 ───

export type ReviewState = 'approved' | 'rejected';
const REVIEW_KEY = 'hive.review';

function readReviews(): Record<string, ReviewState> {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '{}') as Record<string, ReviewState>;
  } catch {
    return {};
  }
}

export function getReview(taskId: string): ReviewState | null {
  return readReviews()[taskId] ?? null;
}

export function setReview(taskId: string, state: ReviewState | null): void {
  const all = readReviews();
  if (state === null) delete all[taskId];
  else all[taskId] = state;
  localStorage.setItem(REVIEW_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent('hive:review'));
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
