// Vue Ruche (vue d'ensemble) : le cockpit — KPIs, Swarm View 2D/3D, rayon de
// miel du projet courant, file d'attente et journal condensé.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Journal } from '../Journal';
import { NodesPanel } from '../NodesPanel';
import { StatTiles } from '../StatTiles';
import { SwarmView } from '../SwarmView';
import { activateProps, StatusBadge } from '../ui';
import { Honeycomb } from './shared';
import type { ViewProps } from './shared';

const SwarmView3D = lazy(() => import('../SwarmView3D'));

type SwarmMode = '2d' | '3d';

export default function Ruche({ snapshot, events, agentsByTask, deferred, onOpenTask }: ViewProps) {
  const t = useT();
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
            <div
              className="view-toggle floating"
              role="group"
              aria-label={t("Mode d'affichage", 'Display mode')}
            >
              <button className={mode === '2d' ? 'active' : ''} onClick={() => switchMode('2d')}>
                2D
              </button>
              <button className={mode === '3d' ? 'active' : ''} onClick={() => switchMode('3d')}>
                3D
              </button>
            </div>
            {mode === '3d' ? (
              <Suspense
                fallback={
                  <div className="swarm3d-loading">
                    {t('Chargement du moteur 3D…', 'Loading the 3D engine…')}
                  </div>
                }
              >
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
                  {done}/{total} {t('tâches butinées', 'tasks foraged')}
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
          {/* Les tâches et le geste d'ouverture : les cartes deviennent des
              fiches coéquipières (mission « Le Poste », lot 2). */}
          <NodesPanel nodes={snapshot.nodes} tasks={snapshot.tasks} onOpenTask={onOpenTask} />

          <section className="card panel">
            <header className="panel-head">
              <h2>{t('File d’attente', 'Queue')}</h2>
            </header>
            <ul className="queue">
              {snapshot.tasks
                .filter((task) => task.status !== 'done')
                .slice(0, 14)
                .map((task) => (
                  <li
                    key={task.id}
                    className="clickable"
                    {...activateProps(() => onOpenTask(task.id))}
                  >
                    <StatusBadge status={task.status} />
                    <span className="queue-title">{task.title}</span>
                    {deferred.has(task.id) && task.status === 'ready' && (
                      <span
                        className="badge-conflict"
                        title={t('Différée : conflit de fichier', 'Deferred: file conflict')}
                      >
                        ⏸
                      </span>
                    )}
                  </li>
                ))}
              {total > 0 && done === total && (
                <li className="empty">🍯 {t('Tout est butiné !', 'Everything is foraged!')}</li>
              )}
              {total === 0 && (
                <li className="empty">{t('Aucune tâche en attente.', 'No tasks waiting.')}</li>
              )}
            </ul>
          </section>

          <Journal events={events} />
        </aside>
      </main>
    </div>
  );
}
