// Vue Projets — les alvéoles de la ruche : atelier Queen Bee (brief → DAG),
// cartes projet avec rapport d'avancement, plan de merge Honeycomb (analyse +
// exécution réelle suivie) et conflits Sting. Données REST via useApiPoll,
// temps réel via le snapshot WS reçu en props.

import { useEffect, useMemo, useState } from 'react';
import {
  addTasks,
  fetchConflicts,
  fetchMergePlan,
  fetchMergeResult,
  fetchReport,
  planBrief,
  runMerge,
} from '../api';
import type { MergeRunResult, NewTaskInput, PlanResponse } from '../api';
import { useLang, useT } from '../i18n';
import { ProgressBar, STATUS_ICON, statusLabel } from '../ui';
import { Honeycomb, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import type { Project, Task, TaskStatus } from '../../../src/shared/types';
import './projets.css';

const STATUSES: TaskStatus[] = ['pending', 'ready', 'assigned', 'running', 'done', 'failed'];

/** Message d'erreur lisible quel que soit le rejet. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Atelier Queen Bee : brief → plan de tâches (DAG) → envoi au projet ──────

type PlanMode = 'auto' | 'heuristic' | 'llm';

/** Profondeur de chaque tâche du plan selon dependsOn (cycles tolérés). */
function planDepths(tasks: NewTaskInput[]): number[] {
  const byId = new Map<string, NewTaskInput>();
  for (const t of tasks) if (t.id) byId.set(t.id, t);
  const memo = new Map<string, number>();
  const depthOf = (task: NewTaskInput, stack: Set<string>): number => {
    let max = -1;
    for (const dep of task.dependsOn ?? []) {
      const parent = byId.get(dep);
      if (!parent || stack.has(dep)) continue; // dépendance externe ou cycle
      let d = memo.get(dep);
      if (d === undefined) {
        stack.add(dep);
        d = depthOf(parent, stack);
        stack.delete(dep);
        memo.set(dep, d);
      }
      if (d > max) max = d;
    }
    return max + 1;
  };
  return tasks.map((t) => depthOf(t, new Set(t.id ? [t.id] : [])));
}

function QueenBee({ projects }: { projects: Project[] }) {
  const t = useT();
  const [brief, setBrief] = useState('');
  const [mode, setMode] = useState<PlanMode>('auto');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState<'idle' | 'plan' | 'send'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // Cible : sélection explicite, sinon le projet le plus récent.
  const target = targetId || (projects[0]?.id ?? '');
  const depths = useMemo(() => (plan ? planDepths(plan.tasks) : []), [plan]);
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of plan?.tasks ?? []) if (t.id) m.set(t.id, t.title);
    return m;
  }, [plan]);

  const propose = () => {
    setBusy('plan');
    setError(null);
    setSent(null);
    planBrief(brief.trim(), mode)
      .then((p) => setPlan(p))
      .catch((e: unknown) =>
        setError(t(`Plan impossible : ${errMsg(e)}`, `Could not plan: ${errMsg(e)}`)),
      )
      .finally(() => setBusy('idle'));
  };

  const send = () => {
    if (!plan || !target) return;
    setBusy('send');
    setError(null);
    // Les ids du planner sont déterministes ('socle', 'tests'…) et la validation
    // serveur est GLOBALE : on les suffixe d'un nonce (dependsOn remappés) pour
    // que le 2e plan de la ruche ne soit pas rejeté en collision d'ids.
    const suffix = Date.now().toString(36);
    const rename = new Map(
      plan.tasks.filter((t) => t.id).map((t) => [t.id!, `${t.id}-${suffix}`] as const),
    );
    const uniqueTasks = plan.tasks.map((t) => ({
      ...t,
      ...(t.id ? { id: rename.get(t.id) } : {}),
      ...(t.dependsOn ? { dependsOn: t.dependsOn.map((d) => rename.get(d) ?? d) } : {}),
    }));
    addTasks(target, uniqueTasks)
      .then((created) => {
        const name = projects.find((p) => p.id === target)?.name ?? target;
        setSent(
          t(
            `${created.length} tâche(s) déposée(s) dans « ${name} ». Bon butinage !`,
            `${created.length} task(s) dropped into “${name}”. Happy foraging!`,
          ),
        );
        setPlan(null);
        setBrief('');
      })
      .catch((e: unknown) =>
        setError(t(`Envoi refusé : ${errMsg(e)}`, `Send rejected: ${errMsg(e)}`)),
      )
      .finally(() => setBusy('idle'));
  };

  return (
    <section className="card pj-queen">
      <header className="panel-head">
        <h2>{t('👑 Atelier Queen Bee', '👑 Queen Bee Workshop')}</h2>
        <span className="panel-count">
          {t('brief → plan de butinage', 'brief → foraging plan')}
        </span>
      </header>
      <div className="pj-queen-body">
        <textarea
          className="pj-brief"
          rows={3}
          placeholder={t(
            'Décrivez votre projet… (ex. : API de sondages avec auth JWT et dashboard de résultats)',
            'Describe your project… (e.g. a survey API with JWT auth and a results dashboard)',
          )}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          disabled={busy !== 'idle'}
          aria-label={t('Brief du projet', 'Project brief')}
        />
        <div className="pj-qb-actions">
          <label className="pj-select-label">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PlanMode)}
              disabled={busy !== 'idle'}
            >
              <option value="auto">auto</option>
              <option value="heuristic">{t('heuristique', 'heuristic')}</option>
              <option value="llm">llm</option>
            </select>
          </label>
          <button
            className="btn primary"
            onClick={propose}
            disabled={busy !== 'idle' || brief.trim().length < 8}
          >
            {busy === 'plan'
              ? t('La reine réfléchit…', 'The Queen is thinking…')
              : t('✨ Proposer un plan', '✨ Propose a plan')}
          </button>
        </div>

        {error && <p className="panel-error">{error}</p>}
        {sent && <p className="pj-sent">🍯 {sent}</p>}

        {plan && (
          <div className="pj-plan">
            <div className="pj-plan-head">
              <span className={`pj-src ${plan.source}`}>
                {plan.source === 'llm' ? '🧠 llm' : t('⚙ heuristique', '⚙ heuristic')}
              </span>
              <span className="panel-count">
                {plan.tasks.length} {t('tâche(s)', 'task(s)')}
              </span>
              {plan.note && <span className="plan-note">{plan.note}</span>}
            </div>
            <ul className="pj-plan-list" aria-label={t('Prévisualisation du plan', 'Plan preview')}>
              {plan.tasks.map((t2, i) => {
                const deps = (t2.dependsOn ?? []).map((d) => titleById.get(d) ?? d);
                return (
                  <li key={t2.id ?? `t${i}`} style={{ paddingLeft: 8 + (depths[i] ?? 0) * 18 }}>
                    <span className="pj-plan-title">
                      {(depths[i] ?? 0) > 0 && (
                        <span className="pj-plan-arrow" aria-hidden="true">
                          ↳{' '}
                        </span>
                      )}
                      {t2.title}
                    </span>
                    {deps.length > 0 && (
                      <span className="pj-plan-deps mono">
                        {t('après :', 'after:')} {deps.join(', ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="pj-send">
              {projects.length > 0 ? (
                <>
                  <label className="pj-select-label">
                    <span>{t('Projet cible', 'Target project')}</span>
                    <select value={target} onChange={(e) => setTargetId(e.target.value)}>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary" onClick={send} disabled={busy !== 'idle'}>
                    {busy === 'send'
                      ? t('Envoi…', 'Sending…')
                      : t('Envoyer les tâches', 'Send the tasks')}
                  </button>
                </>
              ) : (
                <p className="muted-text pj-no-target">
                  {t(
                    'Créez d’abord un projet (« + Projet » dans la barre du haut) pour y déposer ces tâches.',
                    'Create a project first (“+ Project” in the top bar) to drop these tasks into.',
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Plan de merge Honeycomb : analyse + exécution réelle suivie ─────────────

const MERGE_POLL_MS = 3_000; // suivi d'une action utilisateur, borné à 2 min
const MERGE_TIMEOUT_MS = 120_000;

type RunState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'polling'; mergeId: string; since: number }
  | { phase: 'done'; result: MergeRunResult }
  | { phase: 'timeout' }
  | { phase: 'error'; message: string };

function MergeReport({
  result,
  taskTitles,
}: {
  result: MergeRunResult;
  taskTitles: Map<string, string>;
}) {
  const t = useT();
  const tests = !result.testsRun
    ? t('tests non lancés', 'tests not run')
    : result.testsPassed === true
      ? t('✔ tests verts', '✔ tests green')
      : result.testsPassed === false
        ? t('✘ tests rouges', '✘ tests red')
        : t('tests sans verdict', 'tests without a verdict');
  return (
    <div className="pj-merge-report">
      <p>
        <strong>{result.applied.length}</strong> {t('diff(s) appliqué(s),', 'diff(s) applied,')}{' '}
        <strong>{result.conflicts.length}</strong> {t('conflit(s)', 'conflict(s)')} — {tests}
      </p>
      {result.applied.length > 0 && (
        <ul className="pj-applied">
          {result.applied.map((id) => (
            <li key={id}>✔ {taskTitles.get(id) ?? id}</li>
          ))}
        </ul>
      )}
      {result.conflicts.length > 0 && (
        <ul className="pj-conf-list">
          {result.conflicts.map((c) => (
            <li key={c.taskId}>
              <strong>{taskTitles.get(c.taskId) ?? c.taskId}</strong> — {c.reason}
            </li>
          ))}
        </ul>
      )}
      {result.logs && (
        <details className="pj-report-detail">
          <summary>{t('Journal du merge', 'Merge log')}</summary>
          <pre className="code-block scroll">{result.logs}</pre>
        </details>
      )}
    </div>
  );
}

function MergePanel({
  project,
  taskTitles,
  refreshTick,
}: {
  project: Project;
  taskTitles: Map<string, string>;
  refreshTick: number;
}) {
  const t = useT();
  const planPoll = useApiPoll(() => fetchMergePlan(project.id), 30_000, refreshTick);
  const plan = planPoll.data;
  const [testCmd, setTestCmd] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const busyRun = run.phase === 'starting' || run.phase === 'polling';

  const launch = () => {
    setConfirming(false);
    setRun({ phase: 'starting' });
    const cmd = testCmd.trim() ? testCmd.trim().split(/\s+/) : undefined;
    runMerge(project.id, cmd)
      .then((start) => setRun({ phase: 'polling', mergeId: start.mergeId, since: Date.now() }))
      .catch((e: unknown) => setRun({ phase: 'error', message: errMsg(e) }));
  };

  // Suivi du merge lancé : relevé toutes les 3 s, abandon après 2 min.
  useEffect(() => {
    if (run.phase !== 'polling') return;
    const { mergeId, since } = run;
    let alive = true;
    const id = window.setInterval(() => {
      if (Date.now() - since > MERGE_TIMEOUT_MS) {
        window.clearInterval(id);
        if (alive) setRun({ phase: 'timeout' });
        return;
      }
      fetchMergeResult(project.id)
        .then(({ result }) => {
          if (!alive || !result || result.mergeId !== mergeId) return;
          window.clearInterval(id);
          setRun({ phase: 'done', result });
        })
        .catch(() => {
          /* relevé raté : on retente au prochain battement */
        });
    }, MERGE_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [run, project.id]);

  return (
    <section className="pj-sub">
      <header className="pj-sub-head">
        <h4>{t('Plan de merge Honeycomb', 'Honeycomb merge plan')}</h4>
        {plan && (
          <span className={`pj-verdict ${plan.mergeable ? 'ok' : 'ko'}`}>
            {plan.mergeable
              ? t('✔ intégrable', '✔ mergeable')
              : t('⚠ pas encore intégrable', '⚠ not mergeable yet')}
          </span>
        )}
      </header>
      {planPoll.error && (
        <p className="panel-error">
          {t('Plan indisponible :', 'Plan unavailable:')} {planPoll.error}
        </p>
      )}
      {!plan && !planPoll.error && (
        <p className="muted-text">{t('Analyse des diffs…', 'Analyzing diffs…')}</p>
      )}
      {plan && (
        <>
          <p className="pj-sub-meta">
            {plan.done}/{plan.total} {t('tâche(s) terminée(s)', 'task(s) completed')} ·{' '}
            {plan.conflicts.length} {t('conflit(s) ligne-à-ligne', 'line-by-line conflict(s)')}
          </p>
          {plan.order.length > 0 ? (
            <ol
              className="pj-order"
              aria-label={t('Ordre de merge proposé', 'Proposed merge order')}
            >
              {plan.order.map((id) => (
                <li key={id}>{taskTitles.get(id) ?? id}</li>
              ))}
            </ol>
          ) : (
            <p className="muted-text">
              {t(
                'Aucune tâche terminée à intégrer pour l’instant.',
                'No completed tasks to merge yet.',
              )}
            </p>
          )}
          {plan.conflicts.length > 0 && (
            <ul className="pj-conf-list">
              {plan.conflicts.map((c, i) => (
                <li key={`${c.a}-${c.b}-${i}`}>
                  <strong>{taskTitles.get(c.a) ?? c.a}</strong> ↔{' '}
                  <strong>{taskTitles.get(c.b) ?? c.b}</strong> —{' '}
                  <code className="mono">{c.file}</code>
                </li>
              ))}
            </ul>
          )}

          <div className="pj-run">
            <input
              className="pj-testcmd"
              type="text"
              placeholder={t(
                'Commande de test (optionnel), ex. npm test',
                'Test command (optional), e.g. npm test',
              )}
              value={testCmd}
              onChange={(e) => setTestCmd(e.target.value)}
              disabled={busyRun}
              aria-label={t('Commande de test', 'Test command')}
            />
            {!confirming && !busyRun && (
              <button
                className="btn primary"
                onClick={() => setConfirming(true)}
                disabled={plan.done === 0}
              >
                {t('Lancer le merge', 'Run the merge')}
              </button>
            )}
            {confirming && (
              <>
                <span className="pj-confirm">
                  {t(
                    `Merge réel de « ${project.name} » sur un nœud — confirmer ?`,
                    `Real merge of “${project.name}” on a node — confirm?`,
                  )}
                </span>
                <button className="btn primary" onClick={launch}>
                  {t('Confirmer', 'Confirm')}
                </button>
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  {t('Annuler', 'Cancel')}
                </button>
              </>
            )}
            {busyRun && (
              <span className="pj-busy" role="status">
                <span className="pj-busy-dot" aria-hidden="true">
                  ⬡
                </span>{' '}
                {t('Merge en cours sur le nœud…', 'Merge running on the node…')}
              </span>
            )}
          </div>
          {run.phase === 'error' && (
            <p className="panel-error">
              {t('Merge refusé :', 'Merge refused:')} {run.message}
            </p>
          )}
          {run.phase === 'timeout' && (
            <p className="panel-error">
              {t(
                'Pas de résultat après 2 min — vérifiez le nœud puis relancez.',
                'No result after 2 min — check the node, then try again.',
              )}
            </p>
          )}
          {run.phase === 'done' && <MergeReport result={run.result} taskTitles={taskTitles} />}
        </>
      )}
    </section>
  );
}

// ─── Conflits Sting : paires de tâches à risque avant exécution ──────────────

function ConflictsPanel({
  projectId,
  taskTitles,
  refreshTick,
}: {
  projectId: string;
  taskTitles: Map<string, string>;
  refreshTick: number;
}) {
  const t = useT();
  const poll = useApiPoll(() => fetchConflicts(projectId), 30_000, refreshTick);
  const conflicts = poll.data?.conflicts;
  return (
    <section className="pj-sub">
      <header className="pj-sub-head">
        <h4>{t('Conflits Sting', 'Sting conflicts')}</h4>
        {conflicts && <span className="panel-count">{conflicts.length}</span>}
      </header>
      {poll.error && (
        <p className="panel-error">
          {t('Détection indisponible :', 'Detection unavailable:')} {poll.error}
        </p>
      )}
      {!conflicts && !poll.error && (
        <p className="muted-text">{t('Inspection des dards…', 'Inspecting the stingers…')}</p>
      )}
      {conflicts && conflicts.length === 0 && (
        <p className="muted-text">
          {t(
            'Aucun dard en vue — pas de conflit détecté.',
            'No stinger in sight — no conflict detected.',
          )}
        </p>
      )}
      {conflicts && conflicts.length > 0 && (
        <ul className="pj-sting-list">
          {conflicts.map((c, i) => (
            <li key={`${c.a}-${c.b}-${i}`} className={`pj-sting ${c.severity}`}>
              <span className="pj-sting-sev">
                {c.severity === 'high'
                  ? t('⚡ sévérité haute', '⚡ high severity')
                  : t('· sévérité faible', '· low severity')}
              </span>
              <span className="pj-sting-pair">
                {taskTitles.get(c.a) ?? c.a} ↔ {taskTitles.get(c.b) ?? c.b}
              </span>
              {c.sharedPaths.length > 0 && (
                <span className="pj-sting-detail mono">
                  {t('fichiers :', 'files:')} {c.sharedPaths.join(', ')}
                </span>
              )}
              {c.sharedTerms.length > 0 && (
                <span className="pj-sting-detail mono">
                  {t('termes :', 'terms:')} {c.sharedTerms.join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Carte projet : identité, rapport, rayon de miel, actions ────────────────

function ProjectCard({
  project,
  tasks,
  taskTitles,
  nodeNames,
  deferred,
  refreshTick,
  selected,
  onOpenTask,
  onNavigate,
}: {
  project: Project;
  tasks: Task[];
  taskTitles: Map<string, string>;
  nodeNames: Map<string, string>;
  deferred: Set<string>;
  refreshTick: number;
  selected: boolean;
  onOpenTask: ViewProps['onOpenTask'];
  onNavigate: ViewProps['onNavigate'];
}) {
  const t = useT();
  const lang = useLang();
  const reportPoll = useApiPoll(() => fetchReport(project.id), 30_000, refreshTick);
  const report = reportPoll.data;
  const [showMerge, setShowMerge] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);

  const contributors = report
    ? report.contributingNodes.map((id) => nodeNames.get(id) ?? id.slice(0, 8)).join(', ')
    : '';

  return (
    <article className={`card pj-card${selected ? ' pj-selected' : ''}`}>
      <header className="pj-head">
        <h3 className="pj-name">{project.name}</h3>
        <span className={`pj-vis ${project.visibility}`}>
          {project.visibility === 'private' ? t('🔒 privé', '🔒 private') : '🌐 public'}
        </span>
      </header>
      {project.description && <p className="pj-desc">{project.description}</p>}
      {project.repoUrl && (
        <code className="pj-repo mono" title={project.repoUrl}>
          {project.repoUrl}
        </code>
      )}

      {reportPoll.error && (
        <p className="panel-error">
          {t('Rapport indisponible :', 'Report unavailable:')} {reportPoll.error}
        </p>
      )}
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
                title={`${report.byStatus[s]} ${statusLabel(s, lang)}(s)`}
              >
                <span aria-hidden="true">{STATUS_ICON[s]}</span> {report.byStatus[s]}
              </span>
            ))}
            <span className="pj-meta">
              🐝{' '}
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

      {tasks.length > 0 ? (
        <Honeycomb
          tasks={tasks}
          deferred={deferred}
          mini
          onSelect={(task) => onOpenTask(task.id)}
        />
      ) : (
        <p className="muted-text pj-none">
          {t('Alvéoles vides — aucune tâche pour l’instant.', 'Empty cells — no tasks yet.')}
        </p>
      )}

      <div className="pj-actions">
        <button className="btn" onClick={() => onNavigate('miellerie')}>
          {t('🍯 Revue', '🍯 Review')}
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
          {t('⚡ Conflits Sting', '⚡ Sting conflicts')}
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

// ─── Vue principale ──────────────────────────────────────────────────────────

export default function Projets({
  snapshot,
  deferred,
  onOpenTask,
  onNavigate,
  selectedId,
  refreshTick,
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

  return (
    <div className="mc-view pj-view">
      <QueenBee projects={recents} />

      {recents.length === 0 ? (
        <section className="card">
          <p className="empty pad">
            {t(
              'Aucune alvéole de projet pour l’instant. Créez votre premier projet avec le bouton',
              'No project cells yet. Create your first project with the',
            )}
            <strong> {t('« + Projet »', '“+ Project”')} </strong>
            {t(
              'de la barre du haut, puis laissez la Queen Bee planifier le butinage.',
              'button in the top bar, then let the Queen Bee plan the foraging.',
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
              onOpenTask={onOpenTask}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
