// Vue Projets — les alvéoles de la ruche : atelier Queen Bee (brief → DAG),
// cartes projet avec rapport d'avancement, plan de merge Honeycomb (analyse +
// exécution réelle suivie) et conflits Sting. Données REST via useApiPoll,
// temps réel via le snapshot WS reçu en props.

import { useMemo, useState } from 'react';
import { fetchBalance } from '../api';
import type { ProjetSupprime } from '../api';
import { EmptyState } from '../composants';
import { useT } from '../i18n';
import { activateProps, StatusBadge } from '../ui';
import { FiltreTravaux, useOptionsTaches } from './FiltreTravaux';
import { FILTRE_VIDE, filtreActif, filtrerProjets, ouvriereDeTache } from './filtre-travaux';
import { travailDesProjets, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import type { Task } from '../../../src/shared/types';
import { QueenBee } from './projets/AtelierQueenBee';
import { ConnecteurGithub, ProjetsOuverts } from './projets/Arrivee';
import { ProjectCard } from './projets/CarteProjet';
import './projets.css';

/** Au-delà, la liste dit combien il en reste plutôt que de tout dérouler. */
const TACHES_TROUVEES_MAX = 60;

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
  // Le dernier projet supprimé depuis cet écran, et ceux à ne plus montrer :
  // l'instantané de la Reine arrive un quart de seconde plus tard, et la carte
  // d'un projet qui n'existe plus ne doit pas rester cliquable entre-temps.
  const [suppression, setSuppression] = useState<ProjetSupprime | null>(null);
  const [retires, setRetires] = useState<ReadonlySet<string>>(new Set());
  // Récents d'abord : la dernière alvéole créée est en tête de rayon.
  const recents = useMemo(
    () =>
      snapshot.projects.filter((p) => !retires.has(p.id)).sort((a, b) => b.createdAt - a.createdAt),
    [snapshot.projects, retires],
  );
  // Une suppression RÉUSSIE se voit : un bandeau en tête de la liste, qui dit
  // ce qui est parti, et le retour à la liste (plus de projet sélectionné dans
  // l'adresse — la sélection désignerait un projet disparu).
  const surSuppression = (fait: ProjetSupprime) => {
    setSuppression(fait);
    setRetires((avant) => new Set(avant).add(fait.projectId));
    if (selectedId === fait.projectId) onNavigate('projets', undefined, { replace: true });
    window.scrollTo?.({ top: 0 });
  };
  const tasksByProject = useMemo(() => {
    // Le travail de chaque projet, sans les ombres du banc (`travailDesProjets`).
    const m = new Map<string, Task[]>();
    for (const task of travailDesProjets(snapshot.tasks)) {
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

  // ─── LE FILTRE : projets ET tâches, par la même barre ──────────────────────
  //
  // Les cartes ne montrent plus que les tâches qui passent ; un filtre actif
  // ouvre aussi « Tâches trouvées », la liste à plat qui répond à « où est la
  // tâche qui… » sans survoler les alvéoles une à une.
  const [filtre, setFiltre] = useState(FILTRE_VIDE);
  const actif = filtreActif(filtre);
  const noeuds = useMemo(() => new Map(snapshot.nodes.map((n) => [n.id, n])), [snapshot.nodes]);
  const visibles = useMemo(
    () => filtrerProjets(recents, tasksByProject, filtre, noeuds),
    [recents, tasksByProject, filtre, noeuds],
  );
  const tachesTrouvees = visibles.flatMap((v) =>
    v.taches.map((task) => ({ task, projet: v.projet })),
  );
  const options = useOptionsTaches(snapshot.nodes);

  return (
    <div className="mc-view pj-view">
      {suppression && (
        <section className="card pj-supprime" role="status">
          <p>
            {t(
              `Projet « ${suppression.name} » supprimé — ${suppression.lignes} ligne(s) effacée(s)${
                suppression.annulees > 0 ? `, ${suppression.annulees} tâche(s) annulée(s)` : ''
              }. Il ne reste qu’une ligne d’audit au journal.`,
              `Project “${suppression.name}” deleted — ${suppression.lignes} row(s) erased${
                suppression.annulees > 0 ? `, ${suppression.annulees} task(s) cancelled` : ''
              }. Only one audit line remains in the journal.`,
            )}
          </p>
          {suppression.cerveau === 'echec' && (
            <p className="panel-error">
              {t(
                'Les épisodes du Cerveau nés de ce projet n’ont pas pu être effacés : la console de la Reine nomme le dossier où les retirer à la main.',
                'The Cerveau episodes born of this project could not be removed: the Queen’s console names the folder to clean by hand.',
              )}
            </p>
          )}
          {suppression.miroir === 'echec' && (
            <p className="panel-error">
              {t(
                'Le miroir du code n’a pas pu être effacé du disque de la Reine : sa console nomme le dossier à retirer à la main.',
                'The code mirror could not be removed from the Queen’s disk: her console names the folder to delete by hand.',
              )}
            </p>
          )}
          <button className="btn ghost" onClick={() => setSuppression(null)}>
            {t('Fermer', 'Close')}
          </button>
        </section>
      )}

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

      {recents.length > 0 && (
        <FiltreTravaux
          filtre={filtre}
          onChange={setFiltre}
          {...options}
          compte={visibles.length}
          total={recents.length}
          aideRecherche={t(
            'Nom et description des projets, titre, consigne et branche des tâches.',
            'Project name and description, task title, prompt and branch.',
          )}
        />
      )}

      {actif && tachesTrouvees.length > 0 && (
        <section className="card panel pj-trouvees" aria-labelledby="pj-trouvees-titre">
          <header className="panel-head">
            <h2 id="pj-trouvees-titre">{t('Tâches trouvées', 'Matching tasks')}</h2>
            <span className="panel-count">{tachesTrouvees.length}</span>
          </header>
          <ul className="queue">
            {tachesTrouvees.slice(0, TACHES_TROUVEES_MAX).map(({ task, projet }) => {
              const ouvriere = ouvriereDeTache(task);
              return (
                <li
                  key={task.id}
                  className="clickable"
                  {...activateProps(() => onOpenTask(task.id))}
                >
                  <StatusBadge status={task.status} />
                  <span className="queue-title">{task.title}</span>
                  <span className="pj-trouvee-meta">
                    {projet.name}
                    {ouvriere !== null && ` · ${nodeNames.get(ouvriere) ?? ouvriere.slice(0, 8)}`}
                  </span>
                </li>
              );
            })}
          </ul>
          {tachesTrouvees.length > TACHES_TROUVEES_MAX && (
            <p className="muted-text">
              {t(
                `… et ${tachesTrouvees.length - TACHES_TROUVEES_MAX} autre(s) — affinez la recherche.`,
                `… and ${tachesTrouvees.length - TACHES_TROUVEES_MAX} more — narrow the search.`,
              )}
            </p>
          )}
        </section>
      )}

      {recents.length === 0 ? (
        <section className="card">
          <EmptyState
            titre={t('Aucun projet pour l’instant', 'No projects yet')}
            texte={t(
              'Utilisez « + Projet » en haut pour démarrer — un nœud suffit.',
              'Use “+ Project” above to start — one node is enough.',
            )}
          />
        </section>
      ) : visibles.length === 0 ? (
        <section className="card">
          <EmptyState
            titre={t('Aucun projet ne correspond', 'No project matches')}
            texte={t(
              'Ni projet ni tâche ne passe ce filtre. La ruche n’a rien caché : élargissez la recherche.',
              'No project or task passes this filter. The hive hid nothing: widen the search.',
            )}
            action={
              <button type="button" className="btn" onClick={() => setFiltre(FILTRE_VIDE)}>
                {t('Effacer les filtres', 'Clear filters')}
              </button>
            }
          />
        </section>
      ) : (
        <div className="pj-grid">
          {visibles.map(({ projet: p, taches }) => (
            <ProjectCard
              key={p.id}
              project={p}
              tasks={taches}
              masquees={(tasksByProject.get(p.id)?.length ?? 0) - taches.length}
              taskTitles={taskTitles}
              nodeNames={nodeNames}
              deferred={deferred}
              refreshTick={refreshTick}
              selected={p.id === selectedId}
              balance={balance.data}
              onBalanceChange={balance.refresh}
              onOpenTask={onOpenTask}
              onNavigate={onNavigate}
              onSupprime={surSuppression}
              user={user}
            />
          ))}
        </div>
      )}
    </div>
  );
}
