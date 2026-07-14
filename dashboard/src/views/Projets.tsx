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
import { ProgressBar, STATUS_ICON, STATUS_LABEL } from '../ui';
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
      .catch((e: unknown) => setError(`Plan impossible : ${errMsg(e)}`))
      .finally(() => setBusy('idle'));
  };

  const send = () => {
    if (!plan || !target) return;
    setBusy('send');
    setError(null);
    addTasks(target, plan.tasks)
      .then((created) => {
        const name = projects.find((p) => p.id === target)?.name ?? target;
        setSent(`${created.length} tâche(s) déposée(s) dans « ${name} ». Bon butinage !`);
        setPlan(null);
        setBrief('');
      })
      .catch((e: unknown) => setError(`Envoi refusé : ${errMsg(e)}`))
      .finally(() => setBusy('idle'));
  };

  return (
    <section className="card pj-queen">
      <header className="panel-head">
        <h2>👑 Atelier Queen Bee</h2>
        <span className="panel-count">brief → plan de butinage</span>
      </header>
      <div className="pj-queen-body">
        <textarea
          className="pj-brief"
          rows={3}
          placeholder="Décrivez votre projet… (ex. : API de sondages avec auth JWT et dashboard de résultats)"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          disabled={busy !== 'idle'}
          aria-label="Brief du projet"
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
              <option value="heuristic">heuristique</option>
              <option value="llm">llm</option>
            </select>
          </label>
          <button
            className="btn primary"
            onClick={propose}
            disabled={busy !== 'idle' || brief.trim().length < 8}
          >
            {busy === 'plan' ? 'La reine réfléchit…' : '✨ Proposer un plan'}
          </button>
        </div>

        {error && <p className="panel-error">{error}</p>}
        {sent && <p className="pj-sent">🍯 {sent}</p>}

        {plan && (
          <div className="pj-plan">
            <div className="pj-plan-head">
              <span className={`pj-src ${plan.source}`}>
                {plan.source === 'llm' ? '🧠 llm' : '⚙ heuristique'}
              </span>
              <span className="panel-count">{plan.tasks.length} tâche(s)</span>
              {plan.note && <span className="plan-note">{plan.note}</span>}
            </div>
            <ul className="pj-plan-list" aria-label="Prévisualisation du plan">
              {plan.tasks.map((t, i) => {
                const deps = (t.dependsOn ?? []).map((d) => titleById.get(d) ?? d);
                return (
                  <li key={t.id ?? `t${i}`} style={{ paddingLeft: 8 + (depths[i] ?? 0) * 18 }}>
                    <span className="pj-plan-title">
                      {(depths[i] ?? 0) > 0 && (
                        <span className="pj-plan-arrow" aria-hidden="true">
                          ↳{' '}
                        </span>
                      )}
                      {t.title}
                    </span>
                    {deps.length > 0 && (
                      <span className="pj-plan-deps mono">après : {deps.join(', ')}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="pj-send">
              {projects.length > 0 ? (
                <>
                  <label className="pj-select-label">
                    <span>Projet cible</span>
                    <select value={target} onChange={(e) => setTargetId(e.target.value)}>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary" onClick={send} disabled={busy !== 'idle'}>
                    {busy === 'send' ? 'Envoi…' : 'Envoyer les tâches'}
                  </button>
                </>
              ) : (
                <p className="muted-text pj-no-target">
                  Créez d’abord un projet (« + Projet » dans la barre du haut) pour y déposer ces
                  tâches.
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
  const tests = !result.testsRun
    ? 'tests non lancés'
    : result.testsPassed === true
      ? '✔ tests verts'
      : result.testsPassed === false
        ? '✘ tests rouges'
        : 'tests sans verdict';
  return (
    <div className="pj-merge-report">
      <p>
        <strong>{result.applied.length}</strong> diff(s) appliqué(s),{' '}
        <strong>{result.conflicts.length}</strong> conflit(s) — {tests}
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
          <summary>Journal du merge</summary>
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
        <h4>Plan de merge Honeycomb</h4>
        {plan && (
          <span className={`pj-verdict ${plan.mergeable ? 'ok' : 'ko'}`}>
            {plan.mergeable ? '✔ intégrable' : '⚠ pas encore intégrable'}
          </span>
        )}
      </header>
      {planPoll.error && <p className="panel-error">Plan indisponible : {planPoll.error}</p>}
      {!plan && !planPoll.error && <p className="muted-text">Analyse des diffs…</p>}
      {plan && (
        <>
          <p className="pj-sub-meta">
            {plan.done}/{plan.total} tâche(s) terminée(s) · {plan.conflicts.length} conflit(s)
            ligne-à-ligne
          </p>
          {plan.order.length > 0 ? (
            <ol className="pj-order" aria-label="Ordre de merge proposé">
              {plan.order.map((id) => (
                <li key={id}>{taskTitles.get(id) ?? id}</li>
              ))}
            </ol>
          ) : (
            <p className="muted-text">Aucune tâche terminée à intégrer pour l’instant.</p>
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
              placeholder="Commande de test (optionnel), ex. npm test"
              value={testCmd}
              onChange={(e) => setTestCmd(e.target.value)}
              disabled={busyRun}
              aria-label="Commande de test"
            />
            {!confirming && !busyRun && (
              <button
                className="btn primary"
                onClick={() => setConfirming(true)}
                disabled={plan.done === 0}
              >
                Lancer le merge
              </button>
            )}
            {confirming && (
              <>
                <span className="pj-confirm">
                  Merge réel de « {project.name} » sur un nœud — confirmer ?
                </span>
                <button className="btn primary" onClick={launch}>
                  Confirmer
                </button>
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  Annuler
                </button>
              </>
            )}
            {busyRun && (
              <span className="pj-busy" role="status">
                <span className="pj-busy-dot" aria-hidden="true">
                  ⬡
                </span>{' '}
                Merge en cours sur le nœud…
              </span>
            )}
          </div>
          {run.phase === 'error' && <p className="panel-error">Merge refusé : {run.message}</p>}
          {run.phase === 'timeout' && (
            <p className="panel-error">
              Pas de résultat après 2 min — vérifiez le nœud puis relancez.
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
  const poll = useApiPoll(() => fetchConflicts(projectId), 30_000, refreshTick);
  const conflicts = poll.data?.conflicts;
  return (
    <section className="pj-sub">
      <header className="pj-sub-head">
        <h4>Conflits Sting</h4>
        {conflicts && <span className="panel-count">{conflicts.length}</span>}
      </header>
      {poll.error && <p className="panel-error">Détection indisponible : {poll.error}</p>}
      {!conflicts && !poll.error && <p className="muted-text">Inspection des dards…</p>}
      {conflicts && conflicts.length === 0 && (
        <p className="muted-text">Aucun dard en vue — pas de conflit détecté.</p>
      )}
      {conflicts && conflicts.length > 0 && (
        <ul className="pj-sting-list">
          {conflicts.map((c, i) => (
            <li key={`${c.a}-${c.b}-${i}`} className={`pj-sting ${c.severity}`}>
              <span className="pj-sting-sev">
                {c.severity === 'high' ? '⚡ sévérité haute' : '· sévérité faible'}
              </span>
              <span className="pj-sting-pair">
                {taskTitles.get(c.a) ?? c.a} ↔ {taskTitles.get(c.b) ?? c.b}
              </span>
              {c.sharedPaths.length > 0 && (
                <span className="pj-sting-detail mono">fichiers : {c.sharedPaths.join(', ')}</span>
              )}
              {c.sharedTerms.length > 0 && (
                <span className="pj-sting-detail mono">termes : {c.sharedTerms.join(', ')}</span>
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
          {project.visibility === 'private' ? '🔒 privé' : '🌐 public'}
        </span>
      </header>
      {project.description && <p className="pj-desc">{project.description}</p>}
      {project.repoUrl && (
        <code className="pj-repo mono" title={project.repoUrl}>
          {project.repoUrl}
        </code>
      )}

      {reportPoll.error && <p className="panel-error">Rapport indisponible : {reportPoll.error}</p>}
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
                title={`${report.byStatus[s]} ${STATUS_LABEL[s]}(s)`}
              >
                <span aria-hidden="true">{STATUS_ICON[s]}</span> {report.byStatus[s]}
              </span>
            ))}
            <span className="pj-meta">
              🐝 {report.contributingNodes.length > 0 ? contributors : 'aucune butineuse'}
            </span>
            <span className="pj-meta">↻ {report.totalAttempts} tentative(s)</span>
          </div>
        </>
      )}

      {tasks.length > 0 ? (
        <Honeycomb tasks={tasks} deferred={deferred} mini onSelect={(t) => onOpenTask(t.id)} />
      ) : (
        <p className="muted-text pj-none">Alvéoles vides — aucune tâche pour l’instant.</p>
      )}

      <div className="pj-actions">
        <button className="btn" onClick={() => onNavigate('miellerie')}>
          🍯 Revue
        </button>
        <button
          className="btn ghost"
          aria-expanded={showMerge}
          onClick={() => setShowMerge((v) => !v)}
        >
          ⬡ Plan de merge
        </button>
        <button
          className="btn ghost"
          aria-expanded={showConflicts}
          onClick={() => setShowConflicts((v) => !v)}
        >
          ⚡ Conflits Sting
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
  // Récents d'abord : la dernière alvéole créée est en tête de rayon.
  const recents = useMemo(
    () => [...snapshot.projects].sort((a, b) => b.createdAt - a.createdAt),
    [snapshot.projects],
  );
  const tasksByProject = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of snapshot.tasks) {
      const list = m.get(t.projectId);
      if (list) list.push(t);
      else m.set(t.projectId, [t]);
    }
    return m;
  }, [snapshot.tasks]);
  const taskTitles = useMemo(
    () => new Map<string, string>(snapshot.tasks.map((t) => [t.id, t.title])),
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
            Aucune alvéole de projet pour l’instant. Créez votre premier projet avec le bouton
            <strong> « + Projet » </strong>
            de la barre du haut, puis laissez la Queen Bee planifier le butinage.
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
