// Hive Mission Control : shell de l'application — sidebar alvéolaire (7 vues,
// navigation par hash sans router), topbar compacte, pouls de la ruche (ECG),
// tiroir de tâche et modales globales. L'état temps réel (snapshot + journal)
// vit ici et descend dans les vues en props (contrat ViewProps).

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { HiveEvent, StateSnapshot, SubAgent } from '../../src/shared/types';
import { connectFeed, fetchPulse, getToken, saveToken } from './api';
import { InvitePanel } from './InvitePanel';
import { NewProjectModal } from './NewProjectModal';
import { TaskDrawer } from './TaskDrawer';
import { modalOpen } from './ui';
import Ruche from './views/Ruche';
import { countPendingReviews, Sparkline, useApiPoll, useReviewTick } from './views/shared';
import type { ViewId, ViewProps } from './views/shared';

// Chaque vue est un chunk séparé — la Ruche (première peinture) reste inline.
const Miellerie = lazy(() => import('./views/Miellerie'));
const Projets = lazy(() => import('./views/Projets'));
const Essaim = lazy(() => import('./views/Essaim'));
const Sante = lazy(() => import('./views/Sante'));
const Chronique = lazy(() => import('./views/Chronique'));
const Memoire = lazy(() => import('./views/Memoire'));
const Reine = lazy(() => import('./views/Reine'));

const EMPTY: StateSnapshot = { projects: [], nodes: [], tasks: [] };

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  key: string;
}

const NAV: NavItem[] = [
  { id: 'ruche', label: 'Ruche', icon: '🐝', key: '1' },
  { id: 'reine', label: 'Reine', icon: '👑', key: '2' },
  { id: 'miellerie', label: 'Miellerie', icon: '🍯', key: '3' },
  { id: 'projets', label: 'Projets', icon: '⬡', key: '4' },
  { id: 'essaim', label: 'Essaim', icon: '🕺', key: '5' },
  { id: 'sante', label: 'Santé', icon: '💓', key: '6' },
  { id: 'chronique', label: 'Chronique', icon: '📜', key: '7' },
  { id: 'memoire', label: 'Mémoire', icon: '🧠', key: '8' },
];

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
  const [refreshTick, setRefreshTick] = useState(0);
  const reviewTick = useReviewTick();
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
      onStatus: setConnected,
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
      if (item) navigate(item.id);
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

  const applyToken = () => {
    // Ne reconnecter que si le token a réellement changé : une reconnexion
    // gratuite perd les événements émis pendant la fenêtre de coupure.
    if (token === getToken()) return;
    saveToken(token);
    setFeedKey((k) => k + 1);
  };

  const viewProps: ViewProps = {
    snapshot,
    events,
    agentsByTask,
    deferred,
    onOpenTask: setOpenTaskId,
    onNavigate: navigate,
    selectedId: route.selectedId,
    refreshTick,
  };

  const openTask = openTaskId ? (snapshot.tasks.find((t) => t.id === openTaskId) ?? null) : null;
  const current = NAV.find((n) => n.id === route.view) ?? NAV[0]!;

  return (
    <div className="app mc-app">
      <nav className="mc-sidebar" aria-label="Navigation principale">
        <div className="mc-sidebar-brand" title="Hive — Mission Control">
          <span className="brand-logo">🐝</span>
        </div>
        <ul className="mc-nav">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                className={`mc-nav-cell${route.view === item.id ? ' active' : ''}`}
                onClick={() => navigate(item.id)}
                title={`${item.label} (touche ${item.key})`}
                aria-current={route.view === item.id ? 'page' : undefined}
              >
                <span className="mc-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="mc-nav-label">{item.label}</span>
                {item.id === 'miellerie' && pendingReviews > 0 && (
                  <span className="mc-nav-badge" title={`${pendingReviews} production(s) à revoir`}>
                    {pendingReviews > 99 ? '99+' : pendingReviews}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="mc-sidebar-pulse" title="Pouls de la ruche (débit/h)">
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
              <h1>{current.label}</h1>
              <span className="brand-sub">
                {snapshot.projects.length} projet(s) · {snapshot.nodes.length} nœud(s)
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="btn primary" onClick={() => setShowNewProject(true)}>
              + Projet
            </button>
            <InvitePanel />
            <input
              type="password"
              className="token-input"
              placeholder="token"
              title="Token de la ruche (x-hive-token)"
              value={token}
              onChange={(e) => setTokenState(e.target.value)}
              onBlur={applyToken}
              onKeyDown={(e) => e.key === 'Enter' && applyToken()}
            />
            <span className={connected ? 'conn online' : 'conn offline'}>
              <span className="conn-dot" />
              {connected ? 'connecté' : 'hors ligne'}
            </span>
          </div>
        </header>

        <Suspense fallback={<div className="mc-view-loading">Chargement de la vue…</div>}>
          {route.view === 'ruche' && <Ruche {...viewProps} />}
          {route.view === 'miellerie' && <Miellerie {...viewProps} />}
          {route.view === 'projets' && <Projets {...viewProps} />}
          {route.view === 'essaim' && <Essaim {...viewProps} />}
          {route.view === 'sante' && <Sante {...viewProps} />}
          {route.view === 'chronique' && <Chronique {...viewProps} />}
          {route.view === 'memoire' && <Memoire {...viewProps} />}
          {route.view === 'reine' && <Reine {...viewProps} />}
        </Suspense>
      </div>

      {openTask && (
        <TaskDrawer task={openTask} nodes={snapshot.nodes} onClose={() => setOpenTaskId(null)} />
      )}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  );
}
