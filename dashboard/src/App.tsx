// Application dashboard : Swarm View + panneau latéral (nœuds connectés,
// file de tâches, journal), alimentée en temps réel par le WebSocket.

import { lazy, Suspense, useEffect, useState } from 'react';
import type { HiveEvent, StateSnapshot, SubAgent } from '../../src/shared/types';
import { connectFeed, getToken, saveToken } from './api';
import { InvitePanel } from './InvitePanel';
import { SwarmView } from './SwarmView';
import { TaskTable } from './TaskTable';

// Le moteur 3D (~290 Ko gzip) n'est chargé que si l'utilisateur active la vue 3D.
const SwarmView3D = lazy(() => import('./SwarmView3D'));

const EMPTY: StateSnapshot = { projects: [], nodes: [], tasks: [] };
type ViewMode = '2d' | '3d';

export function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot>(EMPTY);
  const [events, setEvents] = useState<HiveEvent[]>([]);
  const [agentsByTask, setAgentsByTask] = useState<Record<string, SubAgent[]>>({});
  const [connected, setConnected] = useState(false);
  const [token, setTokenState] = useState(getToken());
  const [feedKey, setFeedKey] = useState(0);
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('hive.view') as ViewMode) ?? '2d',
  );

  const switchView = (mode: ViewMode) => {
    setView(mode);
    localStorage.setItem('hive.view', mode);
  };

  useEffect(() => {
    const feed = connectFeed({
      onState: setSnapshot,
      onEvent: (ev) => {
        setEvents((prev) => [...prev.slice(-99), ev]);
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
      },
      onStatus: setConnected,
    });
    return () => feed.close();
  }, [feedKey]);

  const done = snapshot.tasks.filter((t) => t.status === 'done').length;
  const failed = snapshot.tasks.filter((t) => t.status === 'failed').length;
  const total = snapshot.tasks.length;
  const online = snapshot.nodes.filter((n) => n.status === 'online').length;
  const projectName = snapshot.projects[snapshot.projects.length - 1]?.name;

  const applyToken = () => {
    saveToken(token);
    setFeedKey((k) => k + 1); // reconnecte le flux avec le nouveau token
  };

  return (
    <div className="app">
      <header>
        <h1>
          🐝 Hive <span className="subtitle">Swarm View</span>
        </h1>
        <div className="progress" title={projectName ?? ''}>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: total > 0 ? `${(done / total) * 100}%` : '0%' }}
            />
          </div>
          <span>
            {done}/{total} tâches
            {failed > 0 ? ` · ${failed} échec(s)` : ''}
          </span>
        </div>
        <div className="header-right">
          <div className="view-toggle" role="group" aria-label="Mode d'affichage">
            <button className={view === '2d' ? 'active' : ''} onClick={() => switchView('2d')}>
              2D
            </button>
            <button className={view === '3d' ? 'active' : ''} onClick={() => switchView('3d')}>
              3D
            </button>
          </div>
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
          <span className={connected ? 'status online' : 'status offline'}>
            {connected ? '● connecté' : '○ déconnecté'}
          </span>
        </div>
      </header>

      <main>
        <section className="swarm-panel">
          {view === '3d' ? (
            <div className="swarm3d-wrap">
              <Suspense fallback={<div className="swarm3d-loading">Chargement du moteur 3D…</div>}>
                <SwarmView3D
                  tasks={snapshot.tasks}
                  nodes={snapshot.nodes}
                  agentsByTask={agentsByTask}
                />
              </Suspense>
            </div>
          ) : (
            <SwarmView tasks={snapshot.tasks} nodes={snapshot.nodes} agentsByTask={agentsByTask} />
          )}
          <TaskTable tasks={snapshot.tasks} nodes={snapshot.nodes} />
        </section>

        <aside>
          <h2>
            Nœuds ({online}/{snapshot.nodes.length} en ligne)
          </h2>
          <ul className="nodes">
            {snapshot.nodes.map((n) => (
              <li key={n.id} className={n.status}>
                <strong>{n.name}</strong>
                <span>
                  {n.agentType} · {n.running}/{n.maxConcurrency} · {n.ownerName}
                </span>
              </li>
            ))}
            {snapshot.nodes.length === 0 && (
              <li className="empty">Aucun nœud n&apos;a rejoint la ruche.</li>
            )}
          </ul>

          <h2>File de tâches</h2>
          <ul className="queue">
            {snapshot.tasks
              .filter((t) => t.status !== 'done')
              .slice(0, 12)
              .map((t) => (
                <li key={t.id}>
                  <span className={`badge ${t.status}`}>{t.status}</span> {t.title}
                </li>
              ))}
            {total > 0 && done === total && <li className="empty">🍯 Tout est butiné !</li>}
            {total === 0 && <li className="empty">Aucune tâche pour l&apos;instant.</li>}
          </ul>

          <h2>Journal</h2>
          <ul className="journal">
            {[...events]
              .slice(-25)
              .reverse()
              .map((ev) => (
                <li key={ev.id}>
                  <time>{new Date(ev.ts).toLocaleTimeString()}</time> {describeEvent(ev)}
                </li>
              ))}
            {events.length === 0 && <li className="empty">En attente d&apos;événements…</li>}
          </ul>
        </aside>
      </main>
    </div>
  );
}

/** Libellé court et lisible pour une entrée du journal. */
function describeEvent(ev: HiveEvent): string {
  const p = ev.payload;
  const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 8) : '?');
  switch (ev.type) {
    case 'project_created':
      return `projet créé : ${String(p.name ?? '')}`;
    case 'task_created':
      return `tâche créée : ${String(p.title ?? short(p.taskId))}`;
    case 'task_ready':
      return `tâche prête (${short(p.taskId)})`;
    case 'task_assigned':
      return `tâche ${short(p.taskId)} → nœud ${short(p.nodeId)}`;
    case 'task_started':
      return `butinage démarré (${short(p.taskId)})`;
    case 'task_progress':
      return `sous-agents actifs (${short(p.taskId)})`;
    case 'task_done':
      return `tâche terminée (${short(p.taskId)}) en ${String(p.durationMs)} ms`;
    case 'task_retry':
      return `échec, essai ${String(p.attempt)}/${String(p.maxAttempts)} (${short(p.taskId)})`;
    case 'task_failed':
      return `tâche échouée (${short(p.taskId)})`;
    case 'task_requeued':
      return `tâche réaffectée (${short(p.taskId)})`;
    case 'node_registered':
      return `nouveau nœud : ${String(p.name ?? '')}`;
    case 'node_online':
      return `nœud en ligne : ${String(p.name ?? '')}`;
    case 'node_offline':
      return `nœud hors ligne : ${String(p.name ?? '')}`;
    case 'result_ignored':
      return `résultat périmé ignoré (${short(p.taskId)})`;
    case 'boot_recovery':
      return `reprise après redémarrage : ${String(p.requeued)} tâche(s) requalifiée(s)`;
    default:
      return ev.type;
  }
}
