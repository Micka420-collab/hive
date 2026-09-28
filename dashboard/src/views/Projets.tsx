// Vue Projets — les alvéoles de la ruche : atelier Queen Bee (brief → DAG),
// cartes projet avec rapport d'avancement, plan de merge Honeycomb (analyse +
// exécution réelle suivie) et conflits Sting. Données REST via useApiPoll,
// temps réel via le snapshot WS reçu en props.

import { useMemo, useState } from 'react';
import { fetchBalance } from '../api';
import { useT } from '../i18n';
import { useApiPoll } from './shared';
import type { ViewProps } from './shared';
import type { Task } from '../../../src/shared/types';
import { QueenBee } from './projets/AtelierQueenBee';
import { ConnecteurGithub, ProjetsOuverts } from './projets/Arrivee';
import { ProjectCard } from './projets/CarteProjet';
import './projets.css';

// ─── Vue principale ──────────────────────────────────────────────────────────

export default function Projets({
  snapshot,
  deferred,
  onOpenTask,
  onNavigate,
  selectedId,
  refreshTick,
  user,
}: ViewProps) {
  const t = useT();
  // Récents d'abord : la dernière alvéole créée est en tête de rayon.
  const recents = useMemo(
    () => [...snapshot.projects].sort((a, b) => b.createdAt - a.createdAt),
    [snapshot.projects],
  );
  const tasksByProject = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const task of snapshot.tasks) {
      const list = m.get(task.projectId);
      if (list) list.push(task);
      else m.set(task.projectId, [task]);
    }
    return m;
  }, [snapshot.tasks]);
  const taskTitles = useMemo(
    () => new Map<string, string>(snapshot.tasks.map((task) => [task.id, task.title])),
    [snapshot.tasks],
  );
  const nodeNames = useMemo(
    () => new Map<string, string>(snapshot.nodes.map((n) => [n.id, n.name])),
    [snapshot.nodes],
  );
  // UN SEUL relevé de la Balance pour toutes les cartes : /api/balance rend la
  // ruche entière (pesée par projet + soldes), une carte par projet en aurait
  // fait N appels identiques. Erreur ou route absente ⇒ `data` reste null et
  // aucune carte n'affiche de bloc Balance — les cartes projet sont intactes.
  const balance = useApiPoll(fetchBalance, 30_000, refreshTick);
  const [, setImportTick] = useState(0);

  return (
    <div className="mc-view pj-view">
      {/* Connecter un dépôt vient AVANT l'atelier : c'est le premier geste de
          quelqu'un qui arrive avec du code existant, alors que la Queen Bee
          s'adresse à qui part d'une idée. */}
      <ConnecteurGithub user={user} onImporte={() => setImportTick((n) => n + 1)} />

      {/* Rejoindre vient AVANT la Queen Bee : quelqu'un qui arrive sans projet
          a plus vite quelque chose à faire en rejoignant l'existant qu'en
          rédigeant un brief. */}
      <ProjetsOuverts
        user={user}
        dejaVus={new Set(snapshot.projects.map((p) => p.id))}
        onRejoint={() => setImportTick((n) => n + 1)}
      />

      {recents.length > 0 && <QueenBee projects={recents} />}

      {recents.length === 0 ? (
        <section className="card pj-depart">
          <span className="marque" aria-hidden="true" />
          <h2>{t('Aucun projet pour l’instant', 'No projects yet')}</h2>
          <p>
            {t(
              'Utilisez « + Projet » en haut pour démarrer — un nœud suffit.',
              'Use “+ Project” above to start — one node is enough.',
            )}
          </p>
        </section>
      ) : (
        <div className="pj-grid">
          {recents.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              tasks={tasksByProject.get(p.id) ?? []}
              taskTitles={taskTitles}
              nodeNames={nodeNames}
              deferred={deferred}
              refreshTick={refreshTick}
              selected={p.id === selectedId}
              balance={balance.data}
              onBalanceChange={balance.refresh}
              onOpenTask={onOpenTask}
              onNavigate={onNavigate}
              user={user}
            />
          ))}
        </div>
      )}
    </div>
  );
}
