// Hive Mission Control : shell de l'application — sidebar alvéolaire (7 vues,
// navigation par hash sans router), topbar compacte, pouls de la ruche (ECG),
// tiroir de tâche et modales globales. L'état temps réel (snapshot + journal)
// vit ici et descend dans les vues en props (contrat ViewProps).

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { HiveEvent, StateSnapshot, SubAgent } from '../../src/shared/types';
import {
  authMe,
  clearJwt,
  connectFeed,
  estAdmin,
  fetchPulse,
  fetchReviews,
  getJwt,
  getToken,
  saveToken,
} from './api';
import type { AuthUser } from './api';
import { AccountPanel } from './AccountPanel';
import { setLang, useLang, useT } from './i18n';
import { InvitePanel } from './InvitePanel';
import { NewProjectModal } from './NewProjectModal';
import { TaskDrawer } from './TaskDrawer';
import { modalOpen } from './ui';
import Ruche from './views/Ruche';
import {
  applyReviewEvent,
  beginReviewHydration,
  countPendingReviews,
  countUnsyncedReviews,
  hydrateReviews,
  Sparkline,
  useApiPoll,
  useReviewTick,
} from './views/shared';
import type { ReviewState } from './views/shared';
import type { ViewId, ViewProps } from './views/shared';

// Chaque vue est un chunk séparé — la Ruche (première peinture) reste inline.
const Miellerie = lazy(() => import('./views/Miellerie'));
const Projets = lazy(() => import('./views/Projets'));
const Essaim = lazy(() => import('./views/Essaim'));
const Sante = lazy(() => import('./views/Sante'));
const Chronique = lazy(() => import('./views/Chronique'));
const Memoire = lazy(() => import('./views/Memoire'));
const Reine = lazy(() => import('./views/Reine'));
const Intendance = lazy(() => import('./views/Intendance'));

const EMPTY: StateSnapshot = { projects: [], nodes: [], tasks: [] };

interface NavItem {
  id: ViewId;
  label: string;
  labelEn: string;
  icon: string;
  key: string;
  /** Vue d'administration : la case n'est montrée qu'aux admins. */
  admin?: true;
}

const NAV: NavItem[] = [
  { id: 'ruche', label: 'Ruche', labelEn: 'Hive', icon: '🐝', key: '1' },
  { id: 'reine', label: 'Reine', labelEn: 'Queen', icon: '👑', key: '2' },
  { id: 'miellerie', label: 'Miellerie', labelEn: 'Honey House', icon: '🍯', key: '3' },
  { id: 'projets', label: 'Projets', labelEn: 'Projects', icon: '⬡', key: '4' },
  { id: 'essaim', label: 'Essaim', labelEn: 'Swarm', icon: '🕺', key: '5' },
  { id: 'sante', label: 'Santé', labelEn: 'Health', icon: '💓', key: '6' },
  { id: 'chronique', label: 'Chronique', labelEn: 'Chronicle', icon: '📜', key: '7' },
  { id: 'memoire', label: 'Mémoire', labelEn: 'Memory', icon: '🧠', key: '8' },
  {
    id: 'intendance',
    label: 'Intendance',
    labelEn: 'Stewardship',
    icon: '🖥',
    key: '9',
    admin: true,
  },
];

/**
 * TOUS les identifiants de vue, y compris ceux qui ne sont pas dans la barre.
 *
 * `parseHash` doit reconnaître `#/intendance` même quand la case est masquée :
 * un administrateur qui ouvre son signet arrive AVANT que `/api/auth/me` ait
 * répondu, et le renvoyer sur la Ruche à cet instant-là serait un bug qu'on
 * ne saurait pas reproduire.
 */
const VIEW_IDS = new Set<string>(NAV.map((n) => n.id));

/** #/vue/id → { view, selectedId } (fallback ruche sur hash inconnu). */
function parseHash(): { view: ViewId; selectedId: string | null } {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEW_IDS.has(parts[0] ?? '') ? (parts[0] as ViewId) : 'ruche';
  return { view, selectedId: parts[1] ? decodeURIComponent(parts[1]) : null };
}

/** Le focus est-il dans un champ de saisie ? (neutralise les raccourcis) */
function inInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot>(EMPTY);
  const [events, setEvents] = useState<HiveEvent[]>([]);
  const [agentsByTask, setAgentsByTask] = useState<Record<string, SubAgent[]>>({});
  const [deferred, setDeferred] = useState<Set<string>>(() => new Set());
  const [connected, setConnected] = useState(false);
  const [token, setTokenState] = useState(getToken());
  const [feedKey, setFeedKey] = useState(0);
  const [route, setRoute] = useState(parseHash);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const reviewTick = useReviewTick();
  const lang = useLang();
  const t = useT();
  // Le gestionnaire de raccourcis est installé UNE fois : il lit la session
  // par référence, sinon il resterait sur celle du premier rendu (null).
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  // Coalescence des invalidations : une rafale d'événements → 1 re-fetch/s max.
  const refreshTimer = useRef<number | undefined>(undefined);

  // ─── Flux temps réel ────────────────────────────────────────────────────────
  useEffect(() => {
    const feed = connectFeed({
      onState: setSnapshot,
      onEvent: (ev) => {
        setEvents((prev) => [...prev.slice(-499), ev]);
        // Tout événement de fin de tâche / merge / conflit invalide les vues qui fetchent.
        if (
          [
            'task_done',
            'task_failed',
            'task_cancelled',
            'merge_started',
            'merge_completed',
            'merge_failed',
            'conflict_detected',
            'node_online',
            'node_offline',
            // Changement de régime thermique : la jauge de Santé doit refléter
            // la nouvelle bande appliquée sans attendre le prochain poll.
            'thermo_shift',
          ].includes(ev.type)
        ) {
          if (refreshTimer.current === undefined) {
            refreshTimer.current = window.setTimeout(() => {
              refreshTimer.current = undefined;
              setRefreshTick((t) => t + 1);
            }, 1_000);
          }
        }
        const taskId = typeof ev.payload.taskId === 'string' ? ev.payload.taskId : null;
        if (!taskId) return;
        // Revue posée par un autre opérateur : synchro immédiate du cache.
        if (ev.type === 'task_reviewed') {
          const state = ev.payload.state;
          applyReviewEvent(
            taskId,
            state === 'approved' || state === 'rejected' ? (state as ReviewState) : null,
            typeof ev.payload.clientId === 'string' ? ev.payload.clientId : undefined,
          );
        }
        if (ev.type === 'task_progress' && Array.isArray(ev.payload.subAgents)) {
          const subAgents = ev.payload.subAgents as SubAgent[];
          setAgentsByTask((prev) => ({ ...prev, [taskId]: subAgents }));
        } else if (
          ['task_done', 'task_failed', 'task_cancelled', 'task_requeued', 'task_retry'].includes(
            ev.type,
          )
        ) {
          setAgentsByTask((prev) => {
            if (!(taskId in prev)) return prev;
            const next = { ...prev };
            delete next[taskId];
            return next;
          });
        }
        if (ev.type === 'task_conflict_deferred') {
          setDeferred((prev) => new Set(prev).add(taskId));
        } else if (
          ['task_assigned', 'task_done', 'task_failed', 'task_cancelled', 'task_requeued'].includes(
            ev.type,
          )
        ) {
          setDeferred((prev) => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        }
      },
      onStatus: (up) => {
        setConnected(up);
        // À CHAQUE (re)connexion : ré-hydrater les revues — les task_reviewed
        // émis pendant une coupure ne sont jamais rejoués par le serveur.
        if (up) {
          const seq = beginReviewHydration();
          fetchReviews()
            .then((r) => hydrateReviews(r.reviews, seq))
            .catch(() => {
              // Serveur ancien ou injoignable : getReview retombe sur localStorage.
            });
        }
      },
    });
    return () => {
      if (refreshTimer.current !== undefined) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = undefined;
      }
      feed.close();
    };
  }, [feedKey]);

  // ─── Navigation par hash ────────────────────────────────────────────────────
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (view: ViewId, selectedId?: string, opts?: { replace?: boolean }) => {
    const hash = selectedId ? `#/${view}/${encodeURIComponent(selectedId)}` : `#/${view}`;
    if (opts?.replace) {
      // Sélection intra-vue : pas d'entrée d'historique (replaceState ne
      // déclenche pas hashchange → setRoute manuel).
      history.replaceState(null, '', hash);
      setRoute(parseHash());
    } else {
      location.hash = hash;
    }
  };

  // Raccourcis 1-8 : changement de vue sans souris (hors saisie et dialogues).
  // e.code Digit/Numpad : indépendant de la disposition clavier (AZERTY…).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || inInput() || modalOpen()) return;
      const item = NAV.find(
        (n) => n.key === e.key || e.code === `Digit${n.key}` || e.code === `Numpad${n.key}`,
      );
      // Une case masquée n'a pas non plus de raccourci : sinon « 9 » emmènerait
      // un membre sur un écran qui ne sait que lui dire non.
      if (item && (!item.admin || estAdmin(userRef.current))) navigate(item.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Pouls de la ruche (ECG sidebar) ───────────────────────────────────────
  const pulse = useApiPoll(fetchPulse, 20_000, refreshTick);
  const beatValues = useMemo(() => {
    const buckets = pulse.data?.throughput ?? [];
    return buckets.slice(-24).map((b) => b.done + b.failed);
  }, [pulse.data]);

  const pendingReviews = useMemo(
    () => countPendingReviews(snapshot.tasks),
    [snapshot.tasks, reviewTick],
  );
  // Verdicts locaux que le serveur n'a pas (encore) confirmés : visibles,
  // jamais silencieux — ils sont re-postés automatiquement à la reconnexion.
  const unsyncedReviews = useMemo(() => countUnsyncedReviews(), [reviewTick]);

  const applyToken = () => {
    // Ne reconnecter que si le token a réellement changé : une reconnexion
    // gratuite perd les événements émis pendant la fenêtre de coupure.
    if (token === getToken()) return;
    saveToken(token);
    setFeedKey((k) => k + 1);
  };

  // Session utilisateur (JWT) : restaurée au montage si un jeton est présent.
  // Un jeton périmé est simplement purgé — le dashboard vit très bien sans
  // compte (le token de ruche suffit pour tout le reste).
  useEffect(() => {
    if (!getJwt()) return;
    let alive = true;
    authMe()
      .then((u) => alive && setUser(u))
      .catch(() => {
        clearJwt();
        if (alive) setUser(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const viewProps: ViewProps = {
    snapshot,
    events,
    agentsByTask,
    deferred,
    onOpenTask: setOpenTaskId,
    onNavigate: navigate,
    selectedId: route.selectedId,
    refreshTick,
    user,
  };

  const openTask = openTaskId ? (snapshot.tasks.find((t) => t.id === openTaskId) ?? null) : null;
  const current = NAV.find((n) => n.id === route.view) ?? NAV[0]!;

  return (
    <div className="app mc-app">
      <nav className="mc-sidebar" aria-label={t('Navigation principale', 'Main navigation')}>
        <div className="mc-sidebar-brand" title="Hive — Mission Control">
          <span className="brand-logo">🐝</span>
        </div>
        <ul className="mc-nav">
          {NAV.filter((item) => !item.admin || estAdmin(user)).map((item) => (
            <li key={item.id}>
              <button
                className={`mc-nav-cell${route.view === item.id ? ' active' : ''}`}
                onClick={() => navigate(item.id)}
                title={`${lang === 'fr' ? item.label : item.labelEn} (${t('touche', 'key')} ${item.key})`}
                aria-current={route.view === item.id ? 'page' : undefined}
              >
                <span className="mc-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="mc-nav-label">{lang === 'fr' ? item.label : item.labelEn}</span>
                {item.id === 'miellerie' && pendingReviews > 0 && (
                  <span
                    className="mc-nav-badge"
                    title={`${pendingReviews} ${t('production(s) à revoir', 'production(s) to review')}`}
                  >
                    {pendingReviews > 99 ? '99+' : pendingReviews}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div
          className="mc-sidebar-pulse"
          title={t('Pouls de la ruche (débit/h)', 'Hive pulse (throughput/h)')}
        >
          <Sparkline values={beatValues} width={64} height={22} beat />
          <span className="mc-pulse-rate">
            {pulse.data ? `${Math.round(pulse.data.successRate * 100)}%` : '—'}
          </span>
        </div>
      </nav>

      <div className="mc-body">
        <header className="topbar mc-topbar">
          <div className="brand">
            <div>
              <h1>{lang === 'fr' ? current.label : current.labelEn}</h1>
              <span className="brand-sub">
                {snapshot.projects.length} {t('projet(s)', 'project(s)')} · {snapshot.nodes.length}{' '}
                {t('nœud(s)', 'node(s)')}
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="btn primary" onClick={() => setShowNewProject(true)}>
              {t('+ Projet', '+ Project')}
            </button>
            <button
              className="btn ghost mc-lang"
              onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
              title={t('Basculer l’interface en anglais', 'Switch interface to French')}
            >
              {lang === 'fr' ? 'EN' : 'FR'}
            </button>
            <AccountPanel user={user} onUser={setUser} />
            <InvitePanel />
            <input
              type="password"
              className="token-input"
              placeholder="token"
              title={t('Token de la ruche (x-hive-token)', 'Hive token (x-hive-token)')}
              value={token}
              onChange={(e) => setTokenState(e.target.value)}
              onBlur={applyToken}
              onKeyDown={(e) => e.key === 'Enter' && applyToken()}
            />
            {unsyncedReviews > 0 && (
              <span
                className="mc-unsynced"
                title={t(
                  "Verdicts posés hors connexion — renvoyés automatiquement dès que l'orchestrateur répond",
                  'Verdicts made while offline — resent automatically once the orchestrator responds',
                )}
              >
                ⚠ {unsyncedReviews} {t('revue(s) non synchronisée(s)', 'unsynced review(s)')}
              </span>
            )}
            <span className={connected ? 'conn online' : 'conn offline'}>
              <span className="conn-dot" />
              {connected ? t('connecté', 'connected') : t('hors ligne', 'offline')}
            </span>
          </div>
        </header>

        <Suspense
          fallback={
            <div className="mc-view-loading">{t('Chargement de la vue…', 'Loading view…')}</div>
          }
        >
          {route.view === 'ruche' && <Ruche {...viewProps} />}
          {route.view === 'miellerie' && <Miellerie {...viewProps} />}
          {route.view === 'projets' && <Projets {...viewProps} />}
          {route.view === 'essaim' && <Essaim {...viewProps} />}
          {route.view === 'sante' && <Sante {...viewProps} />}
          {route.view === 'chronique' && <Chronique {...viewProps} />}
          {route.view === 'memoire' && <Memoire {...viewProps} />}
          {route.view === 'reine' && <Reine {...viewProps} />}
          {route.view === 'intendance' && <Intendance {...viewProps} />}
        </Suspense>
      </div>

      {openTask && (
        <TaskDrawer task={openTask} nodes={snapshot.nodes} onClose={() => setOpenTaskId(null)} />
      )}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  );
}
