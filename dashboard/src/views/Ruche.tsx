// Vue Ruche (vue d'ensemble) : le cockpit — KPIs, Swarm View 2D/3D, rayon de
// miel du projet courant, file d'attente et journal condensé.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Journal } from '../Journal';
import { NodesPanel } from '../NodesPanel';
import { StatTiles } from '../StatTiles';
import { SwarmView } from '../SwarmView';
import { activateProps, StatusBadge } from '../ui';
import { Honeycomb } from './shared';
import type { ViewProps } from './shared';

const SwarmView3D = lazy(() => import('../SwarmView3D'));

type SwarmMode = '2d' | '3d';

export default function Ruche({
  snapshot,
  events,
  agentsByTask,
  deferred,
  onOpenTask,
}: ViewProps) {
  const [mode, setMode] = useState<SwarmMode>(
    () => (localStorage.getItem('hive.view') as SwarmMode) ?? '2d',
  );
  const switchMode = (m: SwarmMode) => {
    setMode(m);
    localStorage.setItem('hive.view', m);
  };

  // Débit : tâches terminées dans les 60 dernières secondes (depuis le journal).
  const doneTimes = useRef<number[]>([]);
  const [throughput, setThroughput] = useState(0);
  useEffect(() => {
    doneTimes.current = events.filter((e) => e.type === 'task_done').map((e) => e.ts);
  }, [events]);
  useEffect(() => {
    const tick = () => {
      const cutoff = Date.now() - 60_000;
      setThroughput(doneTimes.current.filter((t) => t >= cutoff).length);
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, []);

  const total = snapshot.tasks.length;
  const done = snapshot.tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="mc-view mc-ruche">
      <div className="mc-ruche-stats card">
        <StatTiles snapshot={snapshot} throughput={throughput} />
      </div>

      <main className="layout">
        <section className="col-main">
          <div className="card swarm-hero">
            <div className="view-toggle floating" role="group" aria-label="Mode d'affichage">
              <button className={mode === '2d' ? 'active' : ''} onClick={() => switchMode('2d')}>
                2D
              </button>
              <button className={mode === '3d' ? 'active' : ''} onClick={() => switchMode('3d')}>
                3D
              </button>
            </div>
            {mode === '3d' ? (
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
                <Honeycomb
                  tasks={snapshot.tasks}
                  deferred={deferred}
                  onSelect={(t) => onOpenTask(t.id)}
                  mini
                />
              </div>
            )}
          </div>
        </section>

        <aside className="col-side">
          <NodesPanel nodes={snapshot.nodes} />

          <section className="card panel">
            <header className="panel-head">
              <h2>File d’attente</h2>
            </header>
            <ul className="queue">
              {snapshot.tasks
                .filter((t) => t.status !== 'done')
                .slice(0, 14)
                .map((t) => (
                  <li key={t.id} className="clickable" {...activateProps(() => onOpenTask(t.id))}>
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

          <Journal events={events} />
        </aside>
      </main>
    </div>
  );
}
