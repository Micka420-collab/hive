// Centre de contrôle de la ruche : KPIs, Swarm View (2D/3D), table des tâches,
// panneaux nœuds/file/journal, tiroir de détail et création de projet.
// Alimenté en temps réel par le flux WebSocket de l'orchestrateur.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { HiveEvent, StateSnapshot, SubAgent } from '../../src/shared/types';
import { connectFeed, getToken, saveToken } from './api';
import { ConflictsPanel } from './ConflictsPanel';
import { HiveMindPanel } from './HiveMindPanel';
import { InvitePanel } from './InvitePanel';
import { Journal } from './Journal';
import { NewProjectModal } from './NewProjectModal';
import { NodesPanel } from './NodesPanel';
import { OpenAlexPanel } from './OpenAlexPanel';
import { StatTiles } from './StatTiles';
import { SwarmView } from './SwarmView';
import { TaskDrawer } from './TaskDrawer';
import { TaskTable } from './TaskTable';
import { activateProps, StatusBadge } from './ui';

// Le moteur 3D (~290 Ko gzip) n'est chargé que si l'utilisateur active la vue 3D.
const SwarmView3D = lazy(() => import('./SwarmView3D'));

const EMPTY: StateSnapshot = { projects: [], nodes: [], tasks: [] };
type ViewMode = '2d' | '3d';

export function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot>(EMPTY);
  const [events, setEvents] = useState<HiveEvent[]>([]);
  const [agentsByTask, setAgentsByTask] = useState<Record<string, SubAgent[]>>({});
  // Tâches retenues par le Sting Detector (conflit fichier avec une tâche active).
  const [deferred, setDeferred] = useState<Set<string>>(() => new Set());
  const [connected, setConnected] = useState(false);
  const [token, setTokenState] = useState(getToken());
  const [feedKey, setFeedKey] = useState(0);
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('hive.view') as ViewMode) ?? '2d',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showOpenAlex, setShowOpenAlex] = useState(false);
  const doneTimes = useRef<number[]>([]);

  const switchView = (mode: ViewMode) => {
    setView(mode);
    localStorage.setItem('hive.view', mode);
  };

  useEffect(() => {
    const feed = connectFeed({
      onState: setSnapshot,
      onEvent: (ev) => {
        setEvents((prev) => [...prev.slice(-199), ev]);
        if (ev.type === 'task_done') doneTimes.current.push(ev.ts);
        const taskId = typeof ev.payload.taskId === 'string' ? ev.payload.taskId : null;
        if (!taskId) return;
        if (ev.type === 'task_progress' && Array.isArray(ev.payload.subAgents)) {
          const subAgents = ev.payload.subAgents as SubAgent[];
          setAgentsByTask((prev) => ({ ...prev, [taskId]: subAgents }));
        } else if (['task_done', 'task_failed', 'task_requeued', 'task_retry'].includes(ev.type)) {
          setAgentsByTask((prev) => {
            if (!(taskId in prev)) return prev;
            const next = { ...prev };
            delete next[taskId];
            return next;
          });
        }
        // Suivi des tâches différées pour conflit : marquée à l'event, levée dès
        // qu'elle est assignée/terminée/réaffectée.
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
    return () => feed.close();
  }, [feedKey]);

  // Débit : tâches terminées dans les 60 dernières secondes.
  const [throughput, setThroughput] = useState(0);
  useEffect(() => {
    const tick = () => {
      const cutoff = Date.now() - 60_000;
      doneTimes.current = doneTimes.current.filter((t) => t >= cutoff);
      setThroughput(doneTimes.current.length);
    };
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, []);

  const total = snapshot.tasks.length;
  const done = snapshot.tasks.filter((t) => t.status === 'done').length;
  const projectName = snapshot.projects[snapshot.projects.length - 1]?.name;
  // Rafraîchissement des panneaux Palier 2 piloté par les events (pas de polling).
  const memoryTick = events.filter((e) => e.type === 'memory_recorded').length;
  const conflictTick = events.filter((e) =>
    [
      'conflict_detected',
      'task_conflict_deferred',
      'task_created',
      'task_done',
      'task_failed',
    ].includes(e.type),
  ).length;
  const selected = useMemo(
    () => snapshot.tasks.find((t) => t.id === selectedId) ?? null,
    [snapshot.tasks, selectedId],
  );

  const applyToken = () => {
    saveToken(token);
    setFeedKey((k) => k + 1);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">🐝</span>
          <div>
            <h1>Hive</h1>
            <span className="brand-sub">{projectName ?? 'Swarm Control'}</span>
          </div>
        </div>

        <StatTiles snapshot={snapshot} throughput={throughput} />

        <div className="topbar-actions">
          <div className="view-toggle" role="group" aria-label="Mode d'affichage">
            <button className={view === '2d' ? 'active' : ''} onClick={() => switchView('2d')}>
              2D
            </button>
            <button className={view === '3d' ? 'active' : ''} onClick={() => switchView('3d')}>
              3D
            </button>
          </div>
          <button className="btn primary" onClick={() => setShowNewProject(true)}>
            + Projet
          </button>
          <button className="btn ghost" onClick={() => setShowOpenAlex(true)} title="Recherche scientifique OpenAlex">
            🧬 OpenAlex
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

      <main className="layout">
        <section className="col-main">
          <div className="card swarm-hero">
            {view === '3d' ? (
              <Suspense fallback={<div className="swarm3d-loading">Chargement du moteur 3D…</div>}>
                <SwarmView3D
                  tasks={snapshot.tasks}
                  nodes={snapshot.nodes}
                  agentsByTask={agentsByTask}
                />
              </Suspense>
            ) : (
              <SwarmView
                tasks={snapshot.tasks}
                nodes={snapshot.nodes}
                agentsByTask={agentsByTask}
              />
            )}
            {total > 0 && (
              <div className="hero-progress">
                <span>
                  {done}/{total} tâches butinées
                </span>
                <div className="pbar big">
                  <div className="pbar-fill" style={{ width: `${(done / total) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          <TaskTable
            tasks={snapshot.tasks}
            nodes={snapshot.nodes}
            deferred={deferred}
            onSelect={(t) => setSelectedId(t.id)}
          />
        </section>

        <aside className="col-side">
          <NodesPanel nodes={snapshot.nodes} />

          <ConflictsPanel
            projects={snapshot.projects}
            tasks={snapshot.tasks}
            refreshKey={conflictTick}
          />

          <section className="card panel">
            <header className="panel-head">
              <h2>File d’attente</h2>
            </header>
            <ul className="queue">
              {snapshot.tasks
                .filter((t) => t.status !== 'done')
                .slice(0, 14)
                .map((t) => (
                  <li
                    key={t.id}
                    className="clickable"
                    {...activateProps(() => setSelectedId(t.id))}
                  >
                    <StatusBadge status={t.status} />
                    <span className="queue-title">{t.title}</span>
                    {deferred.has(t.id) && t.status === 'ready' && (
                      <span className="badge-conflict" title="Différée : conflit de fichier">
                        ⏸
                      </span>
                    )}
                  </li>
                ))}
              {total > 0 && done === total && <li className="empty">🍯 Tout est butiné !</li>}
              {total === 0 && <li className="empty">Aucune tâche en attente.</li>}
            </ul>
          </section>

          <HiveMindPanel refreshKey={memoryTick} />

          <Journal events={events} />
        </aside>
      </main>

      {selected && (
        <TaskDrawer task={selected} nodes={snapshot.nodes} onClose={() => setSelectedId(null)} />
      )}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
      {showOpenAlex && <OpenAlexPanel onClose={() => setShowOpenAlex(false)} />}
    </div>
  );
}
