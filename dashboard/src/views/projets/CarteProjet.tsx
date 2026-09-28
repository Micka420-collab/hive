// LA CARTE D'UN PROJET — identité, rapport d'avancement, Balance, autonomie,
// équipe, dépôt, Conseil, rayon de miel et actions. Elle COMPOSE les panneaux
// voisins ; elle n'en réécrit aucun.

import { useState } from 'react';
import { fetchReport } from '../../api';
import type { AuthUser, BalanceState } from '../../api';
import { useLang, useT } from '../../i18n';
import { ProgressBar, STATUS_ICON, statusLabel } from '../../ui';
import { BalanceProjet } from '../Balance';
import { PleinEssaim } from '../../PleinEssaim';
import { OnboardingEssaim } from '../../OnboardingEssaim';
import { GardeFous } from '../../GardeFous';
import { EchecSondage, Honeycomb, useApiPoll } from '../shared';
import type { ViewProps } from '../shared';
import { sansIdentifiants } from '../../../../src/shared/projet-public';
import type { Project, Task } from '../../../../src/shared/types';
import { ConflictsPanel, MergePanel } from './MergeEtConflits';
import { EquipeProjet, PartagesProjet } from './Equipe';
import { ConseilProjet } from './Conseil';
import { IssuesProjet, LivraisonsProjet } from './Depot';
import { STATUSES } from './commun';
import '../projets.css';

export function ProjectCard({
  project,
  tasks,
  masquees = 0,
  taskTitles,
  nodeNames,
  deferred,
  refreshTick,
  selected,
  balance,
  onBalanceChange,
  onOpenTask,
  onNavigate,
  user,
}: {
  project: Project;
  tasks: Task[];
  /** Les tâches du projet que le filtre posé retire de `tasks`. */
  masquees?: number;
  taskTitles: Map<string, string>;
  nodeNames: Map<string, string>;
  deferred: Set<string>;
  refreshTick: number;
  selected: boolean;
  /** Pesée + soldes de la ruche entière ; `null` tant qu'aucun relevé (ou route absente). */
  balance: BalanceState | null;
  /** Redemande le relevé de ruche — un plafond posé ici change le solde de là. */
  onBalanceChange: () => void;
  onOpenTask: ViewProps['onOpenTask'];
  onNavigate: ViewProps['onNavigate'];
  user: AuthUser | null;
}) {
  const t = useT();
  const lang = useLang();
  const reportPoll = useApiPoll(() => fetchReport(project.id), 30_000, refreshTick);
  const report = reportPoll.data;
  const [showMerge, setShowMerge] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showConseil, setShowConseil] = useState(false);

  const contributors = report
    ? report.contributingNodes.map((id) => nodeNames.get(id) ?? id.slice(0, 8)).join(', ')
    : '';
  // La part de ce projet dans la pesée globale, et son solde au grand livre —
  // qui porte aussi son PLAFOND et l'état de la porte. Absents ⇒ `null` : ce
  // projet n'a rien dépensé dans la fenêtre / n'a pas de ligne au livre.
  // `BalanceProjet` se tait alors, plutôt que d'écrire « 0 ». Un projet
  // plafonné, lui, a toujours sa ligne : le serveur unit les projets qui ont
  // dépensé et ceux qui sont bornés, pour qu'un projet bloqué à zéro dépense
  // ne puisse pas disparaître de l'écran.
  const compteProjet = balance?.pesee.parProjet.find((p) => p.projectId === project.id) ?? null;
  const soldeProjet = balance?.soldes.find((s) => s.projectId === project.id) ?? null;

  return (
    <article className={`card pj-card${selected ? ' pj-selected' : ''}`}>
      <header className="pj-head">
        <h3 className="pj-name">{project.name}</h3>
        <span className={`pj-vis ${project.visibility}`}>
          {project.visibility === 'private' ? t('privé', 'private') : t('public', 'public')}
        </span>
      </header>
      {project.description && <p className="pj-desc">{project.description}</p>}
      {/* LAVÉE DE SES IDENTIFIANTS, ici comme dans Le Rayon.
          Un `repoUrl` peut porter un jeton : c'est la façon dont on donne ses
          identifiants à `git clone` sans configuration
          (`https://user:ghp_…@github.com/…`), et le champ de création de projet
          l'accepte tel quel. Cette carte est vue par toute abeille qui rejoint
          la ruche — c'est même le but du tableau de bord. L'afficher brut
          donnerait le jeton GitHub de l'hôte à chaque nouvelle arrivante.
          Le `title` aussi : un survol de souris est une lecture. */}
      {project.repoUrl && (
        <code className="pj-repo mono" title={sansIdentifiants(project.repoUrl) ?? ''}>
          {sansIdentifiants(project.repoUrl) ?? '—'}
        </code>
      )}

      <EchecSondage
        sondage={reportPoll}
        avant={t('Rapport indisponible :', 'Report unavailable:')}
      />
      {report && (
        <>
          <div className="pj-progress">
            <ProgressBar value={report.done} max={Math.max(report.total, 1)} />
            <span className="pj-pct">{report.progressPct} %</span>
          </div>
          <div className="pj-counts">
            {STATUSES.filter((s) => report.byStatus[s] > 0).map((s) => (
              <span
                key={s}
                className={`pj-count ${s}`}
                title={`${report.byStatus[s]} ${statusLabel(s, lang)}${lang === 'fr' ? '(s)' : ''}`}
              >
                <span aria-hidden="true">{STATUS_ICON[s]}</span> {report.byStatus[s]}
              </span>
            ))}
            <span className="pj-meta">
              {report.contributingNodes.length > 0
                ? contributors
                : t('aucune butineuse', 'no foragers')}
            </span>
            <span className="pj-meta">
              ↻ {report.totalAttempts} {t('tentative(s)', 'attempt(s)')}
            </span>
          </div>
        </>
      )}

      {/* La Balance à l'échelle du projet : ce que ce projet a coûté en
          temps-ouvrière. Sous le rapport d'avancement (« où en est-on »), parce
          qu'elle en est la contrepartie (« ce que ça a pris »). Rendue
          seulement quand le pèse-ruche a répondu ; sinon la carte projet est
          rigoureusement celle d'avant. */}
      {balance && (
        <BalanceProjet
          projectId={project.id}
          projectName={project.name}
          compte={compteProjet}
          solde={soldeProjet}
          mode={balance.mode}
          aJour={balance.aJour}
          onPlafondChange={onBalanceChange}
        />
      )}

      {/* Le Plein Essaim : l'autonomie du projet. Placé APRÈS La Balance, et
          c'est délibéré — on ne propose pas à quelqu'un d'allumer une
          gouvernance autonome avant de lui avoir montré ce que la ruche
          dépense. */}
      <OnboardingEssaim projectId={project.id} />
      <PleinEssaim projectId={project.id} />
      {/* L'Agent Garde-Fous : le réglage appris du trou de vol, opt-in par projet,
          juste sous l'autonomie — les deux réglages « jusqu'où la ruche va seule ». */}
      <GardeFous projectId={project.id} />

      {/* L'équipe, sous l'autonomie : « qui a le droit de voir ça » se pose
          après « qu'est-ce que ça fait ». C'est aussi le seul endroit d'où un
          dépôt importé peut sortir de son orphelinat. */}
      <EquipeProjet project={project} user={user} refreshTick={refreshTick} />

      {/* Le partage vient APRÈS l'équipe : admettre quelqu'un dans le projet et
          lui montrer le projet sont deux gestes différents, et c'est le second
          qui se donne à des gens qui n'ont pas de compte ici. */}
      <PartagesProjet project={project} user={user} refreshTick={refreshTick} />

      {/* Les issues et les livraisons encadrent le travail : d'où il vient,
          et ce qu'il devient. Les deux lisent chez GitHub, donc les deux
          attendent qu'on le demande — voir plus haut. */}
      <IssuesProjet project={project} />
      <LivraisonsProjet project={project} taskTitles={taskTitles} />

      {/* Le Conseil en dernier : c'est d'abord une lecture de délibération. Il
          ne s'affiche que si ce projet a délibéré — ou si l'on demande à le
          réunir, par le bouton de la rangée d'actions. */}
      <ConseilProjet
        projectId={project.id}
        refreshTick={refreshTick}
        reunion={showConseil}
        onReunionFin={() => setShowConseil(false)}
      />

      {tasks.length > 0 ? (
        <Honeycomb
          tasks={tasks}
          deferred={deferred}
          mini
          onSelect={(task) => onOpenTask(task.id)}
        />
      ) : (
        masquees === 0 && (
          <p className="muted-text pj-none">
            {t('Alvéoles vides — aucune tâche pour l’instant.', 'Empty cells — no tasks yet.')}
          </p>
        )
      )}
      {/* Sous un filtre, les alvéoles absentes ne sont pas des alvéoles vides :
          on dit combien le filtre en retire, plutôt que « aucune tâche ». */}
      {masquees > 0 && (
        <p className="muted-text pj-none" data-testid="pj-masquees">
          {t(
            `${masquees} tâche(s) de ce projet masquée(s) par le filtre.`,
            `${masquees} task(s) of this project hidden by the filter.`,
          )}
        </p>
      )}

      <div className="pj-actions">
        <button className="btn" onClick={() => onNavigate('miellerie')}>
          {t('Revue', 'Review')}
        </button>
        <button
          className="btn ghost"
          aria-expanded={showMerge}
          onClick={() => setShowMerge((v) => !v)}
        >
          {t('⬡ Plan de merge', '⬡ Merge plan')}
        </button>
        <button
          className="btn ghost"
          aria-expanded={showConflicts}
          onClick={() => setShowConflicts((v) => !v)}
        >
          {t('Conflits Sting', 'Sting conflicts')}
        </button>
        <button
          className="btn ghost"
          aria-expanded={showConseil}
          onClick={() => setShowConseil((v) => !v)}
        >
          {t('🔭 Réunir le Conseil', '🔭 Convene the Council')}
        </button>
      </div>

      {showMerge && (
        <MergePanel project={project} taskTitles={taskTitles} refreshTick={refreshTick} />
      )}
      {showConflicts && (
        <ConflictsPanel projectId={project.id} taskTitles={taskTitles} refreshTick={refreshTick} />
      )}
    </article>
  );
}
