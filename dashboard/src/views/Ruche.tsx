// Vue Ruche (vue d'ensemble) : le cockpit — KPIs, Swarm View 2D/3D, rayon de
// miel du projet courant, file d'attente et journal condensé.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AutonomiePulse } from '../AutonomiePulse';
import { useLang, useT } from '../i18n';
import { Journal } from '../Journal';
import { NodesPanel } from '../NodesPanel';
import { StatTiles } from '../StatTiles';
import { annoncesDepuisEvenements, calibrationDepuisEvenements } from '../horloge-vue';
import { direDuree, direAnnonce } from '../../../src/shared/horloge-chantier';
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
  onNewProject,
  onNavigate,
}: ViewProps) {
  const t = useT();
  const lang = useLang();
  const [mode, setMode] = useState<SwarmMode>(
    () => (localStorage.getItem('hive.view') as SwarmMode) ?? '2d',
  );
  const switchMode = (m: SwarmMode) => {
    setMode(m);
    localStorage.setItem('hive.view', m);
  };

  // La note que l'horloge s'est donnée, repliée du journal déjà reçu — comme le
  // reste de l'horloge, elle vient du flux et non d'une route.
  const note = useMemo(() => calibrationDepuisEvenements(events), [events]);
  const annonces = useMemo(() => annoncesDepuisEvenements(events), [events]);

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
  const vide = snapshot.projects.length === 0;

  return (
    <div className="mc-view mc-ruche">
      {/* ─── LA RUCHE VIDE NE DISAIT PAS PAR OÙ COMMENCER ────────────────────
          Sans projet, cette vue montrait un essaim au repos, une file vide et
          rien à cliquer : le seul départ possible vivait dans l'en-tête d'une
          AUTRE vue. On y arrivait donc en croyant qu'il fallait d'abord un
          ami, ou une configuration de plus. Le premier projet se lance ici,
          seul, sur ce nœud-ci.

          Et dès qu'il n'y a encore RIEN, on ne remplit pas l'écran de zéros :
          stats / essaim / file vides diluaient le seul geste utile. */}
      {vide && (
        <section className="card ruche-depart">
          <span className="marque" aria-hidden="true" />
          <h2>{t('Votre ruche est prête', 'Your hive is ready')}</h2>
          <p>
            {t(
              'Un projet, ce nœud, maintenant. Il travaille seul — personne d’autre n’est requis.',
              'One project, this node, now. It works on its own — nobody else is required.',
            )}
          </p>
          <button className="btn primary" onClick={onNewProject}>
            {t('Démarrer un projet', 'Start a project')}
          </button>
        </section>
      )}

      {!vide && (
        <>
          <div className="mc-ruche-stats card">
            <StatTiles snapshot={snapshot} throughput={throughput} calibration={note} />
          </div>

          <AutonomiePulse
            projets={snapshot.projects.map((p) => ({ id: p.id, name: p.name }))}
            onNavigate={onNavigate}
          />

          <main className="layout">
            <section className="col-main">
              <div className="card swarm-hero">
                <div
                  className="view-toggle floating"
                  role="group"
                  aria-label={t("Mode d'affichage", 'Display mode')}
                >
                  <button
                    className={mode === '2d' ? 'active' : ''}
                    onClick={() => switchMode('2d')}
                  >
                    2D
                  </button>
                  <button
                    className={mode === '3d' ? 'active' : ''}
                    onClick={() => switchMode('3d')}
                  >
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
                      onSelect={(tk) => onOpenTask(tk.id)}
                      mini
                    />
                  </div>
                )}
              </div>
            </section>

            <aside className="col-side">
              {/* Les tâches et le geste d'ouverture : les cartes deviennent des
                  fiches coéquipières (mission « Le Poste », lot 2). */}
              <NodesPanel
                nodes={snapshot.nodes}
                tasks={snapshot.tasks}
                onOpenTask={onOpenTask}
                onOuvrirPoste={(id) => onNavigate('chambre', id)}
              />

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
                        {/*
                          L'ANNONCE, LÀ OÙ ON REGARDE LA FILE.

                          Un INTERVALLE et pas un plafond : « ≤ 25 min » se lit
                          comme une borne dure alors que c'est un quantile à
                          80 %. « 7–25 min » ne peut pas être lu comme une
                          promesse — et c'est la seule forme qui tienne dans une
                          ligne sans mentir. La phrase entière, avec son `n`,
                          reste dans l'infobulle et dans le tiroir.

                          Rien pour le socle « aucun » : deux zéros affichés
                          « 0 s–0 s » seraient l'exact contraire de « je ne sais
                          pas encore ».
                        */}
                        {(() => {
                          const h = annonces.get(task.id);
                          if (h?.horsDomaine !== undefined) {
                            return (
                              <span
                                className="queue-annonce hors"
                                title={t(
                                  `Sortie du domaine connu — record observé ${direDuree(h.horsDomaine.recordMs, 'fr')}`,
                                  `Out of the known domain — record observed ${direDuree(h.horsDomaine.recordMs, 'en')}`,
                                )}
                              >
                                {t('hors domaine', 'out of domain')}
                              </span>
                            );
                          }
                          if (h?.annonce === undefined || h.annonce.socle === 'aucun') return null;
                          return (
                            <span className="queue-annonce" title={direAnnonce(h.annonce, lang)}>
                              {direDuree(h.annonce.p50Ms, lang)}–{direDuree(h.annonce.p80Ms, lang)}
                            </span>
                          );
                        })()}
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
                    <li className="empty">{t('Tout est butiné.', 'Everything is foraged.')}</li>
                  )}
                  {total === 0 && (
                    <li className="empty">
                      {t('Aucune tâche en attente.', 'No tasks waiting.')}{' '}
                      <button className="lien-bouton" onClick={onNewProject}>
                        {t('Démarrer un projet', 'Start a project')}
                      </button>
                    </li>
                  )}
                </ul>
              </section>

              <Journal events={events} />
            </aside>
          </main>
        </>
      )}
    </div>
  );
}
