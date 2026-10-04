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
import { ApiError, postReview } from '../api';
import { messageDeSondage } from './sondage';
import type { AuthUser } from '../api';
import { useLang, useT } from '../i18n';
import type { UiLang } from '../i18n';

// ─── Contrat commun : App possède l'état temps réel, les vues le reçoivent ───

export type ViewId =
  | 'ruche'
  | 'miellerie'
  | 'projets'
  | 'essaim'
  | 'sante'
  | 'chronique'
  | 'memoire'
  | 'reine'
  | 'monespace'
  | 'rayon'
  | 'intendance'
  | 'cerveau'
  | 'chantiers'
  | 'chambre'
  | 'warroom'
  | 'sandbox';

export interface ViewProps {
  snapshot: StateSnapshot;
  events: HiveEvent[];
  agentsByTask: Record<string, SubAgent[]>;
  /** Tâches différées par le Sting Detector (conflit de fichier). */
  deferred: Set<string>;
  /** Ouvre le tiroir de détail d'une tâche (global, au-dessus de toute vue). */
  onOpenTask: (taskId: string) => void;
  /**
   * Ouvre la modale de création de projet (globale, comme le tiroir).
   *
   * Le bouton « + Projet » de l'en-tête reste réservé à la vue Projets : une
   * action de gestion n'a pas à suivre les treize vues. Mais la Ruche VIDE
   * n'offrait alors aucun départ — on y voit une ruche prête, sans rien à
   * cliquer pour lui donner du travail, et il faut deviner qu'il faut passer
   * par une autre vue. C'est ce que fait ce point d'entrée, et lui seul.
   */
  onNewProject: () => void;
  /**
   * Navigue vers une vue (met à jour le hash) ; selectedId optionnel.
   * `replace: true` pour les sélections intra-vue (pas d'entrée d'historique).
   */
  onNavigate: (view: ViewId, selectedId?: string, opts?: { replace?: boolean }) => void;
  /** Identifiant sélectionné porté par le hash (#/vue/id), sinon null. */
  selectedId: string | null;
  /** Compteur incrémenté à chaque événement pertinent — déclenche les re-fetchs. */
  refreshTick: number;
  /**
   * La session, ou `null` — le dashboard s'utilise sans compte.
   *
   * Ce que les vues en tirent est TOUJOURS cosmétique : masquer ce qui sera
   * refusé de toute façon. L'autorisation se décide au serveur, jamais ici.
   */
  user: AuthUser | null;
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
// Chaque entrée mémorise `base` (le verdict serveur connu au moment du geste) :
// si le serveur a changé entre-temps (verdict PLUS RÉCENT d'un autre
// opérateur), on ne rejoue PAS le geste périmé — la décision serveur prime.

interface OutboxEntry {
  state: ReviewState | null;
  base: ReviewState | null;
  /** La raison jointe au geste : rejouée avec lui, sinon le rejet arriverait muet. */
  raison?: string;
}

function readUnsynced(): Record<string, OutboxEntry> {
  try {
    const raw = JSON.parse(localStorage.getItem(UNSYNCED_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, OutboxEntry> = {};
    for (const [taskId, v] of Object.entries(raw)) {
      if (v !== null && typeof v === 'object' && 'state' in v) out[taskId] = v as OutboxEntry;
      else out[taskId] = { state: v as ReviewState | null, base: null }; // ancien format
    }
    return out;
  } catch {
    return {};
  }
}

function writeUnsynced(map: Record<string, OutboxEntry>): void {
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
  // l'affichage ET re-postés — SAUF si le serveur a changé depuis le geste
  // (un autre opérateur a statué plus récemment : sa décision prime, l'entrée
  // périmée est abandonnée).
  for (const [taskId, entry] of Object.entries(readUnsynced())) {
    if (locallyPending.has(taskId)) continue; // déjà en cours de renvoi
    const serverVal = map[taskId] ?? null;
    if (serverVal !== (entry.base ?? null)) {
      const m = readUnsynced();
      delete m[taskId];
      writeUnsynced(m);
      continue; // l'affichage garde la valeur serveur (plus récente)
    }
    if (entry.state === null) delete serverReviews[taskId];
    else serverReviews[taskId] = entry.state;
    enqueuePost(taskId, entry.state, entry.base, entry.raison);
  }
  notifyReviewChange();
}

/**
 * Identité d'INSTANCE de page (pas persistée : sessionStorage est copié à la
 * duplication d'onglet, ce qui ferait partager un même id à deux onglets).
 * Jointe aux POSTs de revue, échouée par le serveur dans task_reviewed —
 * disponible pour l'observabilité. Repli sans crypto.randomUUID (contexte
 * non sécurisé : HTTP distant) : nonce maison suffisant pour cet usage.
 */
const CLIENT_ID = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
})();

function reviewClientId(): string {
  return CLIENT_ID;
}

/**
 * Applique un événement `task_reviewed` reçu du flux WS. TOUT événement (écho
 * propre compris) passe par le même chemin : pendant un POST local en vol il
 * alimente le tampon (dernier événement vu = vérité serveur la plus récente,
 * rejouée au drain) ; sinon il s'applique — idempotent pour un écho propre.
 * Ne JAMAIS court-circuiter sur clientId : jeter l'écho propre casserait
 * l'invariant FIFO du tampon (un verdict concurrent périmé écraserait le
 * nôtre au drain).
 */
export function applyReviewEvent(
  taskId: string,
  state: ReviewState | null,
  _fromClientId?: string,
): void {
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
function enqueuePost(
  taskId: string,
  state: ReviewState | null,
  base: ReviewState | null,
  raison?: string,
): void {
  // Tant que le serveur n'a pas confirmé, le verdict est « non synchronisé ».
  const unsynced = readUnsynced();
  unsynced[taskId] = { state, base, ...(raison ? { raison } : {}) };
  writeUnsynced(unsynced);

  locallyPending.add(taskId);
  const prev = postChains.get(taskId) ?? Promise.resolve();
  const next = prev
    // Sans raison, la forme d'appel d'avant : trois arguments, pas un
    // quatrième `undefined` que rien ne porte.
    .then(() =>
      raison === undefined
        ? postReview(taskId, state, reviewClientId())
        : postReview(taskId, state, reviewClientId(), raison),
    )
    .then(
      () => {
        const m = readUnsynced();
        if (taskId in m && m[taskId]?.state === state) {
          delete m[taskId];
          writeUnsynced(m);
          notifyReviewChange(); // le bandeau « non synchronisé » se met à jour
        }
      },
      (err: unknown) => {
        // Échec DÉFINITIF (tâche disparue, requête invalide) : inutile de
        // rejouer à chaque reconnexion — l'entrée est purgée, le verdict reste
        // dans le repli local. Échec transitoire (réseau, 5xx, 401/403/409) :
        // l'entrée reste, re-postée à la prochaine hydratation.
        if (err instanceof ApiError && [400, 404, 422].includes(err.status)) {
          const m = readUnsynced();
          delete m[taskId];
          writeUnsynced(m);
        }
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

/**
 * `raison` : facultative, jointe au verdict (jamais à un effacement). Sur un
 * rejet qui relance la tâche, le serveur la transmet à la tentative suivante.
 */
export function setReview(taskId: string, state: ReviewState | null, raison?: string): void {
  // `base` = verdict serveur connu AVANT ce geste : capturé pour détecter, au
  // rejeu éventuel de l'outbox, qu'un autre opérateur a statué entre-temps.
  const base = getReview(taskId);
  // Optimiste : cache + repli local immédiats, envoi serveur sérialisé derrière.
  applyDelta(taskId, state);
  const local = readLocalReviews();
  if (state === null) delete local[taskId];
  else local[taskId] = state;
  localStorage.setItem(REVIEW_KEY, JSON.stringify(local));
  notifyReviewChange();
  enqueuePost(taskId, state, base, state === null ? undefined : raison?.trim() || undefined);
}

/**
 * Le TRAVAIL des projets dans l'instantané : tout, sauf les ombres du banc
 * (`Task.ombre`, orchestrator/shadow-bench.ts). Une ombre rejoue une tâche
 * déjà comptée et ne se livre jamais : dans une file de revue, elle
 * attendrait une relecture sans objet ; dans une sélection de merge, le
 * serveur la refuserait (« tâche hors projet ») et bloquerait la coulée ;
 * dans un compteur, elle compterait deux fois le même travail. Ce qui décrit
 * l'ACTIVITÉ (ce qui tourne, la charge d'une ouvrière) les garde.
 */
export function travailDesProjets(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => !t.ombre);
}

/** Nombre de tâches terminées non revues (badge sidebar + compteurs), hors ombres du banc. */
export function countPendingReviews(tasks: Task[]): number {
  const reviews = readReviews();
  return travailDesProjets(tasks).filter(
    (t) => (t.status === 'done' || t.status === 'failed') && !reviews[t.id],
  ).length;
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
  /** Relit TOUT DE SUITE, sans attendre l'intervalle. */
  refresh: () => void;
  /** `true` entre un `refresh()` et la réponse de la lecture qu'il a lancée. */
  relance: boolean;
  /** Heure (ms) du dernier échec ; `null` dès qu'une lecture réussit. */
  echecA: number | null;
}

export function useApiPoll<T>(fetcher: () => Promise<T>, intervalMs: number, tick = 0): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relance, setRelance] = useState(false);
  const [echecA, setEchecA] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [manual, setManual] = useState(0);

  useEffect(() => {
    let alive = true;
    // `relance` retombe à la PREMIÈRE réponse de cet effet — celle de la
    // lecture qu'un `refresh()` vient de lancer. Les lectures d'un effet
    // précédent ne la touchent plus (`alive`), et les suivantes la trouvent
    // déjà fausse : React ignore un état inchangé.
    const load = () => {
      fetcherRef
        .current()
        .then((d) => {
          if (alive) {
            setData(d);
            setError(null);
            setEchecA(null);
            setRelance(false);
          }
        })
        .catch((e) => {
          if (alive) {
            setError(messageDeSondage(e));
            setEchecA(Date.now());
            setRelance(false);
          }
        });
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

  const refresh = useCallback(() => {
    setRelance(true);
    setManual((m) => m + 1);
  }, []);
  return { data, error, refresh, relance, echecA };
}

// ─── L'ÉCHEC D'UN SONDAGE, DIT ET RATTRAPABLE ────────────────────────────────
//
// Un sondage en échec s'affichait en une phrase rouge, et c'était tout. On
// pouvait lire « la ruche n'a pas répondu », relancer l'orchestrateur… puis
// attendre l'intervalle suivant — trente secondes, parfois deux minutes —
// sans aucun moyen de dire « maintenant ». `refresh()` existait déjà : aucun
// écran ne l'offrait.
//
// Le bouton ne suffit pas seul. Un orchestrateur arrêté refuse la connexion en
// quelques millisecondes : le clic, l'échec et le retour du bouton tiennent
// dans une image, et l'écran ne change pas. On ne saurait pas si le clic a eu
// lieu. D'où l'HEURE du dernier essai, qui bouge à chaque échec : elle prouve
// que la ruche a bien été rappelée, et dit quand.
//
// Le paragraphe garde la classe que chaque écran lui donnait (`classe`) : le
// bouton et l'heure suivent le message DANS ce paragraphe, et chaque écran
// garde sa mise en page.

/** Ce qu'`EchecSondage` lit d'un sondage — un `Poll` entier convient. */
type SondageRelancable = Pick<Poll<unknown>, 'error' | 'refresh' | 'relance' | 'echecA'>;

export function EchecSondage({
  sondage,
  avant,
  classe = 'panel-error',
}: {
  sondage: SondageRelancable;
  /** Ce qui précède le message — « Plan indisponible : », « relevé figé : ». */
  avant?: string;
  classe?: string;
}) {
  const t = useT();
  if (sondage.error === null) return null;
  return (
    <p className={classe}>
      {avant !== undefined && `${avant} `}
      {sondage.error}
      {/* `aria-disabled`, jamais `disabled` : un bouton focalisé qu'on éteint
          perd le focus (« focus fixup » du HTML), et au clavier le Tab
          suivant repartait du haut de la page. Le clic en vol est ignoré. */}
      <button
        type="button"
        className="btn ghost echec-sondage-relance"
        onClick={() => {
          if (!sondage.relance) sondage.refresh();
        }}
        aria-disabled={sondage.relance || undefined}
      >
        {sondage.relance ? t('Nouvel essai…', 'Retrying…') : t('Réessayer', 'Retry')}
      </button>
      {sondage.echecA !== null && (
        <span className="echec-sondage-quand">
          {t('dernier essai à', 'last attempt at')} {timeShort(sondage.echecA)}
        </span>
      )}
    </p>
  );
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

// Double record fr/en résolu au rendu (pas de hook au niveau module).
const HEX_STATUS_TITLE: Record<UiLang, Record<TaskStatus, string>> = {
  fr: {
    pending: 'en attente',
    ready: 'prête',
    assigned: 'assignée',
    running: 'en cours',
    done: 'terminée',
    failed: 'échouée',
  },
  en: {
    pending: 'pending',
    ready: 'ready',
    assigned: 'assigned',
    running: 'running',
    done: 'done',
    failed: 'failed',
  },
};

/** Grille d'hexagones : statut lisible à 3 mètres, cliquable alvéole par alvéole. */
export function Honeycomb({ tasks, deferred, onSelect, mini, showReview }: HoneycombProps) {
  const reviewTick = useReviewTick();
  void reviewTick; // relit localStorage à chaque changement de revue
  const lang = useLang();
  const tr = useT();
  return (
    <div
      className={mini ? 'mc-comb mini' : 'mc-comb'}
      role="list"
      aria-label={tr('Rayon de miel', 'Honeycomb')}
    >
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
        const label = `${t.title} — ${HEX_STATUS_TITLE[lang][t.status]}`;
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
