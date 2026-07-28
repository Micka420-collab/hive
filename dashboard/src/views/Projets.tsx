// Vue Projets — les alvéoles de la ruche : atelier Queen Bee (brief → DAG),
// cartes projet avec rapport d'avancement, plan de merge Honeycomb (analyse +
// exécution réelle suivie) et conflits Sting. Données REST via useApiPoll,
// temps réel via le snapshot WS reçu en props.

import { useEffect, useMemo, useState } from 'react';
import {
  addTasks,
  admettreMembre,
  adopterProjet,
  creerPartage,
  estAdmin,
  fetchBalance,
  fetchConflicts,
  fetchConseil,
  fetchConseils,
  fetchDepotsGithub,
  fetchMembresProjet,
  fetchMergePlan,
  fetchPartages,
  fetchMergeResult,
  fetchProjetsOuverts,
  fetchReport,
  importerDepotGithub,
  fetchIssues,
  fetchLivraisons,
  prendreIssue,
  reprendreLivraison,
  planBrief,
  rejoindreProjet,
  retirerMembre,
  revoquerPartage,
  runMerge,
} from '../api';
import { ApiError } from '../api';
import type {
  AuthUser,
  BalanceState,
  DepotsGithub,
  IssueConseil,
  IssueVue,
  LivraisonVue,
  MergeRunResult,
  NewTaskInput,
  PartageCree,
  PlanResponse,
  ProjetPublicVue,
  SessionConseil,
} from '../api';
import { useLang, useT } from '../i18n';
import { GesteIrreversible, ProgressBar, STATUS_ICON, statusLabel } from '../ui';
import { BalanceProjet, CarteDevis } from './Balance';
import { PleinEssaim } from '../PleinEssaim';
import { Honeycomb, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import { sansIdentifiants } from '../../../src/shared/projet-public';
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
            {/* Devis (la Balance, « prévoir ») : `null` — ou absent, sur un
                orchestrateur d'avant le pèse-ruche — ⇒ SILENCE complet, jamais
                un « 0 » qui se lirait comme « gratuit ». Placé après le plan
                qu'il chiffre et avant l'envoi : c'est le dernier chiffre qu'on
                regarde avant de déposer les tâches. Volontairement loin de tout
                solde et de tout plafond — voir CarteDevis. */}
            {plan.devis && <CarteDevis devis={plan.devis} nbTaches={plan.tasks.length} />}
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
  // L'ENVIRONNEMENT EN ÉCHEC N'EST PAS UN TEST ROUGE. Les tests n'ont alors pas
  // tourné du tout : afficher « tests non lancés » sans dire pourquoi enverrait
  // chercher une régression dans du code qui va très bien.
  const envRate = result.preparedOk === false;
  const tests = envRate
    ? t('environnement non préparé — tests non lancés', 'environment not prepared — tests not run')
    : !result.testsRun
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
      {envRate && (
        <p className="panel-error">
          {t(
            'L’installation des dépendances a échoué sur le nœud : le code n’est pas en cause. Vérifiez son accès réseau, puis le fichier de verrouillage du dépôt.',
            'Dependency installation failed on the node: the code is not at fault. Check its network access, then the repository lockfile.',
          )}
        </p>
      )}
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
  const [prepCmd, setPrepCmd] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const busyRun = run.phase === 'starting' || run.phase === 'polling';

  const launch = () => {
    setConfirming(false);
    setRun({ phase: 'starting' });
    const argv = (s: string) => (s.trim() ? s.trim().split(/\s+/) : undefined);
    runMerge(project.id, { testCommand: argv(testCmd), prepareCommand: argv(prepCmd) })
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
            {/* La préparation d'abord — à l'écran comme à l'exécution. Sans
                elle, `npm test` sur un clone frais échoue faute de
                dépendances, et le verdict se lit « tests cassés ». */}
            <div className="pj-cmds">
              <input
                className="pj-testcmd"
                type="text"
                placeholder={t(
                  'Préparer l’environnement (optionnel), ex. npm ci',
                  'Prepare the environment (optional), e.g. npm ci',
                )}
                value={prepCmd}
                onChange={(e) => setPrepCmd(e.target.value)}
                disabled={busyRun}
                aria-label={t('Préparation de l’environnement', 'Environment preparation')}
              />
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
            </div>
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

/**
 * L'équipe d'un projet — et le cul-de-sac qu'elle ouvre.
 *
 * ─── CE QUI N'AVAIT AUCUN CHEMIN ─────────────────────────────────────────────
 *
 * Un projet privé n'avait aucun moyen de gagner un membre : on ne s'invite pas
 * chez les autres (correct), et personne ne pouvait inviter non plus (oubli).
 * Un dépôt importé de GitHub cumule les deux — privé ET sans propriétaire,
 * puisque l'import s'authentifie par le jeton de ruche, qui n'est le compte de
 * personne. On connectait son dépôt, et aucune de ses abeilles ne le voyait.
 *
 * ─── POURQUOI ON ADMET PAR IDENTIFIANT, ET PAS PAR COURRIEL ──────────────────
 *
 * Admettre par courriel serait plus agréable, et ferait de cette route un
 * oracle : « ce courriel a-t-il un compte ici ? », interrogeable par tout
 * propriétaire de projet. L'inscription a été durcie exprès pour ne pas
 * répondre à cette question. On ne la rouvre pas ailleurs.
 *
 * L'ouvrière donne donc son identifiant — une chaîne opaque, qu'elle lit sur
 * cette même carte — exactement comme on se passe un billet d'invitation.
 */
export function EquipeProjet({
  project,
  user,
  refreshTick,
}: {
  project: Project;
  user: AuthUser | null;
  refreshTick: number;
}) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const membres = useApiPoll(() => fetchMembresProjet(project.id), 120_000, refreshTick + tick);
  const [aAdmettre, setAAdmettre] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  // Cosmétique, toujours : le serveur retranche de toute façon. On masque ce
  // qu'il refusera, on ne décide rien ici.
  const jeSuisAdmin = estAdmin(user);
  const jeSuisProprio = project.ownerId !== null && project.ownerId === user?.id;
  const jePeuxAdmettre = jeSuisAdmin || jeSuisProprio;
  const orphelin = project.ownerId === null;

  const agir = (p: Promise<unknown>) => {
    setOccupe(true);
    setErreur(null);
    p.then(() => setTick((n) => n + 1))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(false));
  };

  // Sans compte, cette carte n'a rien à dire : les routes exigent un COMPTE, et
  // afficher une équipe vide laisserait croire qu'il n'y a personne.
  if (!user) return null;

  return (
    <div className="pj-sub pj-equipe">
      <div className="pj-sub-head">
        <h4>{t('Équipe', 'Team')}</h4>
        {membres.data && <span className="pj-sub-meta">{membres.data.length}</span>}
      </div>

      {orphelin && jeSuisAdmin && (
        <div className="pj-orphelin">
          <p>
            {t(
              'Ce projet n’a pas de propriétaire — un dépôt importé appartient à la ruche, pas à un compte. Sans propriétaire, personne ne peut y admettre d’ouvrière.',
              'This project has no owner — an imported repository belongs to the hive, not to an account. Without an owner, nobody can admit a worker to it.',
            )}
          </p>
          <button
            className="btn primary"
            disabled={occupe}
            onClick={() => agir(adopterProjet(project.id))}
          >
            {t('Adopter ce projet', 'Adopt this project')}
          </button>
        </div>
      )}

      {membres.data && membres.data.length > 0 && (
        <ul className="pj-equipe-liste">
          {membres.data.map((m) => {
            // La question NOMME la personne : cette liste se relit toute seule
            // toutes les deux minutes, et la ligne visée peut avoir glissé.
            const nom = (m.displayName ?? m.userId.slice(0, 8)).slice(0, 40);
            return (
              <li key={m.userId}>
                <span className="pj-equipe-nom">{m.displayName ?? m.userId.slice(0, 8)}</span>
                <span className="pj-equipe-role">{m.role}</span>
                {jePeuxAdmettre && m.role !== 'owner' && (
                  <GesteIrreversible
                    libelle="✕"
                    ariaLabel={t('Retirer du projet', 'Remove from project')}
                    question={t(`Retirer ${nom} du projet ?`, `Remove ${nom} from the project?`)}
                    confirmer={t('Retirer', 'Remove')}
                    disabled={occupe}
                    onConfirmer={() => agir(retirerMembre(project.id, m.userId))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {jePeuxAdmettre && (
        <div className="pj-run">
          <input
            className="pj-testcmd"
            type="text"
            placeholder={t('Identifiant du compte à admettre', 'Account identifier to admit')}
            value={aAdmettre}
            onChange={(e) => setAAdmettre(e.target.value)}
            disabled={occupe}
            aria-label={t('Identifiant du compte', 'Account identifier')}
          />
          <button
            className="btn"
            disabled={occupe || aAdmettre.trim() === ''}
            onClick={() => {
              agir(admettreMembre(project.id, aAdmettre.trim()));
              setAAdmettre('');
            }}
          >
            {t('Admettre', 'Admit')}
          </button>
        </div>
      )}

      {/* L'autre bout de la manœuvre : ce qu'on donne à la personne qui tient
          le projet. Sans ça, « admettre par identifiant » n'a pas de mode
          d'emploi et la carte est inutilisable. */}
      <p className="pj-equipe-moi">
        {t('Votre identifiant :', 'Your identifier:')} <code className="mono">{user.id}</code>
      </p>

      {erreur && <p className="panel-error">{erreur}</p>}
    </div>
  );
}

/**
 * Les liens de partage en lecture — montrer sans donner la ruche.
 *
 * ─── LA SEULE CHOSE À NE PAS RATER ICI ───────────────────────────────────────
 *
 * Le serveur ne rend le jeton QU'UNE FOIS, à la création. La liste ne le montre
 * jamais — c'est ce qui fait qu'un lien perdu se remplace au lieu de se
 * retrouver. Un écran qui n'afficherait pas le lien à ce moment-là le
 * perdrait pour de bon, et la seule issue serait d'en créer un autre sans
 * comprendre pourquoi.
 *
 * D'où le bandeau qui reste tant qu'on ne l'a pas fermé, et le libellé qui
 * annonce que c'est la seule fois.
 */
export function PartagesProjet({
  project,
  user,
  refreshTick,
}: {
  project: Project;
  user: AuthUser | null;
  refreshTick: number;
}) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const liens = useApiPoll(() => fetchPartages(project.id), 120_000, refreshTick + tick);
  const [nouveau, setNouveau] = useState<PartageCree | null>(null);
  const [label, setLabel] = useState('');
  const [jours, setJours] = useState(7);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [copie, setCopie] = useState(false);

  if (!user) return null;

  const creer = () => {
    setOccupe(true);
    setErreur(null);
    creerPartage(project.id, {
      ...(label.trim() ? { label: label.trim() } : {}),
      ttlMs: jours * 24 * 60 * 60 * 1000,
    })
      .then((p) => {
        setNouveau(p);
        setLabel('');
        setCopie(false);
        setTick((n) => n + 1);
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(false));
  };

  const revoquer = (id: string) => {
    setOccupe(true);
    setErreur(null);
    revoquerPartage(project.id, id)
      .then(() => setTick((n) => n + 1))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(false));
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Partage en lecture', 'Read-only sharing')}</h4>
        {liens.data && <span className="pj-sub-meta">{liens.data.length}</span>}
      </div>

      {nouveau && (
        <div className="pj-lien-neuf">
          <p>
            {t(
              'Ce lien ne sera plus affiché. Copiez-le maintenant.',
              'This link will not be shown again. Copy it now.',
            )}
          </p>
          {/* `readOnly` et non `disabled` : un champ désactivé ne se sélectionne
              pas, et il faut pouvoir copier à la main si le presse-papier est
              refusé par le navigateur. */}
          <input className="pj-testcmd mono" readOnly value={nouveau.lien} aria-label="lien" />
          <div className="pj-run">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(nouveau.lien).then(() => setCopie(true));
              }}
            >
              {copie ? t('✔ copié', '✔ copied') : t('Copier', 'Copy')}
            </button>
            <button className="btn ghost" onClick={() => setNouveau(null)}>
              {t('J’ai copié', 'Done')}
            </button>
          </div>
        </div>
      )}

      {liens.data && liens.data.length > 0 && (
        <ul className="pj-liens">
          {liens.data.map((l) => {
            const nom = (l.label || t('(sans nom)', '(unnamed)')).slice(0, 40);
            return (
              <li key={l.id} className={l.vivant ? '' : 'pj-lien-mort'}>
                <span className="pj-lien-nom">{l.label || t('(sans nom)', '(unnamed)')}</span>
                <span className="pj-lien-etat">
                  {!l.vivant
                    ? t('éteint', 'dead')
                    : l.vuA
                      ? t('ouvert', 'opened')
                      : t('jamais ouvert', 'never opened')}
                </span>
                {l.vivant && (
                  <GesteIrreversible
                    libelle="✕"
                    ariaLabel={t('Révoquer ce lien', 'Revoke this link')}
                    question={t(
                      `Éteindre « ${nom} » ? Le lien ne se rallume pas.`,
                      `Kill “${nom}”? The link does not come back.`,
                    )}
                    confirmer={t('Éteindre', 'Kill')}
                    disabled={occupe}
                    onConfirmer={() => revoquer(l.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="pj-run">
        <input
          className="pj-testcmd"
          type="text"
          placeholder={t(
            'À qui ? (ex. « client », optionnel)',
            'For whom? (e.g. “client”, optional)',
          )}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={occupe}
          aria-label={t('Nom du lien', 'Link label')}
        />
        <label className="pj-select-label">
          <span>{t('jours', 'days')}</span>
          <select
            value={jours}
            onChange={(e) => setJours(Number(e.target.value))}
            disabled={occupe}
          >
            {[1, 7, 30, 90].map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={occupe} onClick={creer}>
          {t('Créer un lien', 'Create a link')}
        </button>
      </div>

      <p className="pj-equipe-moi">
        {t(
          'Un lien ouvre DEUX actes : voir l’avancement et lire le code. Il ne donne ni la ruche, ni votre compte, et se révoque un par un.',
          'A link opens TWO acts: see progress and read code. It grants neither the hive nor your account, and each one is revoked on its own.',
        )}
      </p>

      {erreur && <p className="panel-error">{erreur}</p>}
    </div>
  );
}

/**
 * Le Conseil des Éclaireuses — ce que la ruche PROPOSE, et qui l'a contredite.
 *
 * ─── POURQUOI CET ÉCRAN EST LE PLUS MANQUANT DE TOUS ─────────────────────────
 *
 * Le Conseil ne change rien : son verdict est une PROPOSITION À UN HUMAIN,
 * exactement comme la Miellerie propose un merge sans jamais le faire. Un
 * mécanisme dont la sortie EST une proposition à un humain, et que cet humain
 * ne peut lire qu'en ligne de commande, ne sert à personne. C'est plus net
 * encore que Les Guetteuses, dont la sortie était au moins une alerte.
 *
 * ─── CE QU'ON MONTRE, ET POURQUOI PAS SEULEMENT LA GAGNANTE ──────────────────
 *
 * Le protocole est fait pour éviter quatre pièges de délibération, et trois
 * d'entre eux ne se voient QUE dans les perdantes :
 *
 *   • Les SIGNAUX D'ARRÊT. Une éclaireuse convaincue qu'une piste est mauvaise
 *     l'inhibe activement. N'afficher que la retenue effacerait l'objection —
 *     c'est-à-dire l'information la plus chère du conseil.
 *   • La DIVERSITÉ des familles. Dix instances du même modèle qui s'accordent,
 *     ce n'est pas dix avis : c'est un avis répété dix fois. On montre donc les
 *     familles distinctes, pas seulement le nombre de soutiens.
 *   • L'ÉGALITÉ (`depart`). Plusieurs propositions au quorum, c'est à l'humain
 *     de trancher — et il ne peut trancher que s'il les voit toutes.
 *
 * Une issue sans recommandation (`vide`, `sans_quorum`, `epuise`) se DIT. Un
 * écran qui n'afficherait rien dans ces cas-là laisserait croire à une panne,
 * alors que « personne n'a rien trouvé » est un résultat.
 */
function ConseilProjet({ projectId, refreshTick }: { projectId: string; refreshTick: number }) {
  const t = useT();
  const liste = useApiPoll(fetchConseils, 60_000, refreshTick);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [session, setSession] = useState<SessionConseil | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const miens = (liste.data?.conseils ?? []).filter((c) => c.projectId === projectId);

  useEffect(() => {
    if (!ouvert) return setSession(null);
    let vivant = true;
    fetchConseil(ouvert)
      .then((s) => vivant && setSession(s))
      .catch((e: unknown) => vivant && setErreur(errMsg(e)));
    return () => {
      vivant = false;
    };
  }, [ouvert]);

  // Aucune délibération sur ce projet : on se tait plutôt que d'afficher une
  // section vide sur chaque carte.
  if (miens.length === 0) return null;

  const ISSUE: Record<IssueConseil, { fr: string; en: string }> = {
    quorum: { fr: '✔ une piste a convergé', en: '✔ one path converged' },
    depart: { fr: '⚖ égalité — à vous de trancher', en: '⚖ tie — yours to settle' },
    sans_quorum: { fr: '… du débat, rien de convergé', en: '… debate, nothing converged' },
    epuise: { fr: '⏳ arrêté sans converger', en: '⏳ stopped without converging' },
    vide: { fr: '∅ personne n’a rien trouvé', en: '∅ nobody found anything' },
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Conseil des Éclaireuses', 'Council of Scouts')}</h4>
        <span className="pj-sub-meta">{miens.length}</span>
      </div>

      <ul className="pj-cs-liste">
        {miens.map((c) => (
          <li key={c.id}>
            <button
              className="pj-cs-question"
              onClick={() => setOuvert(ouvert === c.id ? null : c.id)}
            >
              {ouvert === c.id ? '▾' : '▸'} {c.question}
            </button>
            {/* DEUX QUESTIONS DIFFÉRENTES, et l'écran doit les distinguer.
                La liste rend l'issue RANGÉE — celle d'un conseil clos — donc
                `null` tant qu'il délibère. Le détail, lui, RECALCULE ce que le
                protocole dirait à cet instant. Afficher l'un pour l'autre
                donnerait un résumé qui contredit son propre détail. */}
            <span className="pj-cs-issue">
              {c.issue
                ? t(ISSUE[c.issue].fr, ISSUE[c.issue].en)
                : t('délibère encore', 'still deliberating')}
            </span>
          </li>
        ))}
      </ul>

      {erreur && <p className="panel-error">{erreur}</p>}

      {session && (
        <div className="pj-cs-detail">
          {/* Tant que le conseil n'est pas clos, ce verdict est ce que le
              protocole dirait MAINTENANT — il peut encore changer. Le taire
              ferait passer une lecture instantanée pour une conclusion. */}
          <p className="pj-cs-resume">
            {t(`Tour ${session.tour}`, `Round ${session.tour}`)} ·{' '}
            {t(ISSUE[session.issue].fr, ISSUE[session.issue].en)}
            {!session.closedAt && ` — ${t('provisoire', 'provisional')}`}
            {session.enVol > 0 && ` · ${session.enVol} ${t('en vol', 'in flight')}`}
          </p>
          {session.danses.length === 0 ? (
            <p className="muted-text">
              {t(
                'Aucune proposition : les éclaireuses n’ont rien rapporté.',
                'No proposal: the scouts brought nothing back.',
              )}
            </p>
          ) : (
            <ul className="pj-cs-danses">
              {session.danses.map((d) => (
                <li
                  key={d.id}
                  className={
                    d.id === session.retenue
                      ? 'pj-cs-retenue'
                      : d.arrets.length
                        ? 'pj-cs-contestee'
                        : ''
                  }
                >
                  <div className="pj-cs-titre">
                    {d.id === session.retenue && <span className="pj-cs-marque">★</span>}
                    <strong>{d.titre}</strong>
                    <span className="pj-cs-chiffres">
                      {/* Les FAMILLES, pas seulement les soutiens : dix clones
                          d'accord ne font pas dix avis. */}
                      ↑{d.soutiens.length} · {d.familles.length} {t('famille(s)', 'famil(y|ies)')}
                      {d.arrets.length > 0 && (
                        <span className="pj-cs-arrets"> · ⛔{d.arrets.length}</span>
                      )}
                    </span>
                  </div>
                  {d.corps && <p className="pj-cs-corps">{d.corps}</p>}
                  {/* LES OBJECTIONS EN CLAIR. C'est l'information la plus chère
                      du conseil : une piste qu'une éclaireuse a vérifiée et
                      jugée mauvaise. */}
                  {d.raisons
                    .filter((r) => r.type === 'arret' && r.raison)
                    .map((r, i) => (
                      <p key={i} className="pj-cs-objection">
                        ⛔ {r.raison}
                      </p>
                    ))}
                  {d.sources.length > 0 && (
                    <p className="pj-cs-sources">
                      {/* AFFICHÉES, jamais suivies par la ruche. */}
                      {d.sources.join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="pj-equipe-moi">
            {t(
              'Le Conseil ne décide rien : il propose, vous tranchez.',
              'The Council decides nothing: it proposes, you settle.',
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * LES PROJETS OUVERTS À LA RUCHE — la porte qui n'avait pas de poignée.
 *
 * ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
 *
 * `GET /api/projects/public` et `POST /api/projects/:id/join` existaient depuis
 * longtemps. Le refus de `join` est écrit avec soin — il prend la forme EXACTE
 * de l'inexistence, pour qu'une liste d'identifiants ne dessine pas la carte
 * des projets privés — et sa garde `peutRejoindre` est un module pur bien
 * testé.
 *
 * **Aucun écran ne les appelait.** Ni la ligne de commande. Sur une plateforme
 * d'orchestration COMMUNAUTAIRE, « découvrir un projet ouvert et le rejoindre »
 * est le parcours qui donne son sens à tous les autres, et il avait un serveur
 * sans porte. C'est exactement le défaut de `POST /api/projects/user` : il
 * n'était dans aucune route, il était dans ce que rien ne faisait.
 *
 * ─── CE QUE CET ÉCRAN REFUSE DE DÉDUIRE ──────────────────────────────────────
 *
 * Un refus revient en **404**, indistinguable d'un projet qui n'existe pas.
 * C'est délibéré côté serveur. L'écran NE DOIT PAS le retraduire en « vous
 * n'avez pas le droit » : ce serait reconstruire dans le navigateur
 * l'information que le serveur a tue, et rendre le refus à nouveau lisible pour
 * qui balaie des identifiants.
 *
 * Il dit donc la seule chose vraie — le projet n'est plus disponible — et relit
 * la liste, qui est la réponse honnête.
 */
export function ProjetsOuverts({
  user,
  dejaVus,
  onRejoint,
}: {
  user: AuthUser | null;
  /** Les projets déjà visibles : on ne propose pas de rejoindre les siens. */
  dejaVus: Set<string>;
  onRejoint: () => void;
}) {
  const t = useT();
  const [ouverts, setOuverts] = useState<ProjetPublicVue[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  // Rejoindre exige un COMPTE : le jeton de ruche ne dit pas qui vous êtes, et
  // on ne peut pas inscrire « le jeton » comme membre. Sans compte, le panneau
  // se tait plutôt que d'offrir un bouton qui ne peut que refuser.
  if (!user) return null;

  // `relire` NE TOUCHE PAS au message d'erreur, et c'est nécessaire : un refus
  // déclenche une relecture, et si la relecture effaçait le message, le refus
  // serait silencieux. Le bouton, lui, veut bien repartir de zéro — d'où les
  // deux fonctions plutôt qu'un drapeau.
  const relire = () => {
    setChargement(true);
    fetchProjetsOuverts()
      .then(setOuverts)
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  const charger = () => {
    setErreur(null);
    relire();
  };

  const rejoindre = (p: ProjetPublicVue) => {
    setEnCours(p.id);
    setErreur(null);
    rejoindreProjet(p.id)
      .then(() => onRejoint())
      .catch((e: unknown) => {
        // On NE TRADUIT PAS le 404 en « interdit ». Voir l'en-tête. Et on relit :
        // si le projet a disparu ou s'est refermé, la liste le dira. Laisser la
        // ligne morte inviterait à recliquer sur ce qui ne peut plus marcher.
        setErreur(
          e instanceof ApiError && e.status === 404
            ? t(
                'Ce projet n’est plus disponible. La liste a été relue.',
                'This project is no longer available. The list has been reloaded.',
              )
            : errMsg(e),
        );
        relire();
      })
      .finally(() => setEnCours(null));
  };

  const aRejoindre = (ouverts ?? []).filter((p) => !dejaVus.has(p.id));

  return (
    <section className="card pj-ouverts">
      <div className="pj-sub-head">
        <h3>{t('Projets ouverts à la ruche', 'Projects open to the hive')}</h3>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : ouverts
              ? t('relire', 'reload')
              : t('voir les projets ouverts', 'show open projects')}
        </button>
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {ouverts && aRejoindre.length === 0 && (
        <p className="pj-sub-vide">
          {ouverts.length === 0
            ? t(
                'Aucun projet ouvert pour l’instant. Un projet devient ouvert quand son propriétaire le rend public.',
                'No open project yet. A project becomes open when its owner makes it public.',
              )
            : t(
                'Vous êtes déjà dans tous les projets ouverts.',
                'You are already in every open project.',
              )}
        </p>
      )}

      {aRejoindre.length > 0 && (
        <ul className="pj-ouverts-liste">
          {aRejoindre.map((p) => (
            <li key={p.id}>
              <span className="pj-ouv-nom">{p.name}</span>
              {p.description && <span className="pj-ouv-desc">{p.description}</span>}
              {/* ON LAVE, MÊME SI LA SOURCE LAVE DÉJÀ. `vuePublique` retire les
                  identifiants côté serveur, et c'est bien — mais « la source
                  s'en charge » est exactement le raisonnement qui a laissé
                  passer la même fuite TROIS FOIS (voir
                  `tests/repourl-affichage.test.ts`). `sansIdentifiants` est
                  idempotent : une seconde application ne peut rien casser, elle
                  ne peut qu'enlever un secret qui n'aurait pas dû être là. */}
              {p.repoUrl && <code className="pj-ouv-depot">{sansIdentifiants(p.repoUrl)}</code>}
              <button
                className="btn ghost sm"
                onClick={() => rejoindre(p)}
                disabled={enCours !== null}
              >
                {enCours === p.id ? '…' : t('Rejoindre', 'Join')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Le connecteur GitHub — connecter un dépôt existant en un clic.
 *
 * ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
 *
 * `GET /api/github/repos` et `POST /api/github/import` vivaient depuis le début
 * sans aucun écran : connecter un dépôt se faisait en ligne de commande, alors
 * que c'est le tout PREMIER geste de quelqu'un qui arrive avec du code.
 *
 * ─── CE QUE CET ÉCRAN NE FAIT PAS, ET C'EST VOULU ────────────────────────────
 *
 * Il ne demande jamais le jeton GitHub. Celui-ci vit dans l'environnement de
 * l'orchestrateur, en mémoire, le temps du processus. Un champ « collez votre
 * jeton » en ferait une valeur qui traverse le navigateur, l'historique et le
 * presse-papiers — pour un gain nul, puisque c'est l'orchestrateur qui appelle
 * GitHub, pas le navigateur.
 *
 * Quand le jeton manque, le serveur répond 501 avec la marche à suivre : on
 * l'affiche telle quelle plutôt que d'inventer un message qui dériverait.
 */
function ConnecteurGithub({ user, onImporte }: { user: AuthUser | null; onImporte: () => void }) {
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState('');
  const [depots, setDepots] = useState<DepotsGithub | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);

  const lister = (q: string) => {
    setCharge(true);
    setErreur(null);
    fetchDepotsGithub(q)
      .then(setDepots)
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setCharge(false));
  };

  const importer = (fullName: string) => {
    setOccupe(fullName);
    setErreur(null);
    importerDepotGithub(fullName)
      .then(() => {
        onImporte();
        lister(filtre);
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(null));
  };

  if (!ouvert) {
    return (
      <section className="card pj-gh-repli">
        <button
          className="btn"
          onClick={() => {
            setOuvert(true);
            lister('');
          }}
        >
          🐙 {t('Connecter un dépôt GitHub', 'Connect a GitHub repository')}
        </button>
        <span className="pj-gh-aide">
          {t(
            'Vos dépôts, les plus récents d’abord. Le jeton reste sur l’orchestrateur.',
            'Your repositories, most recent first. The token stays on the orchestrator.',
          )}
        </span>
      </section>
    );
  }

  return (
    <section className="card">
      <header className="panel-head">
        <h2>{t('🐙 Connecter un dépôt GitHub', '🐙 Connect a GitHub repository')}</h2>
        <button className="btn ghost" onClick={() => setOuvert(false)}>
          {t('Fermer', 'Close')}
        </button>
      </header>

      <div className="pj-run pj-gh-barre">
        <input
          className="pj-testcmd"
          type="text"
          placeholder={t(
            'Filtrer (nom, description, langage)',
            'Filter (name, description, language)',
          )}
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lister(filtre)}
          aria-label={t('Filtrer les dépôts', 'Filter repositories')}
        />
        <button className="btn" onClick={() => lister(filtre)} disabled={charge}>
          {charge ? t('Lecture…', 'Reading…') : t('Chercher', 'Search')}
        </button>
      </div>

      {/* Le 501 « GitHub non connecté » porte la marche à suivre complète :
          on la montre telle quelle. La reformuler ici la ferait diverger de
          celle du serveur, et c'est celle du serveur qui est juste. */}
      {erreur && <p className="panel-error pj-gh-erreur">{erreur}</p>}

      {!user && (
        <p className="pj-gh-aide">
          {t(
            'Sans compte connecté, le dépôt sera connecté à la ruche sans propriétaire — un administrateur devra l’adopter pour que quelqu’un puisse s’en servir.',
            'Without a signed-in account, the repository will be connected with no owner — an administrator will have to adopt it before anyone can use it.',
          )}
        </p>
      )}

      {depots && (
        <ul className="pj-gh-liste">
          {depots.depots.length === 0 && (
            <li className="pj-gh-vide">
              {t('Aucun dépôt ne correspond.', 'No repository matches.')}
            </li>
          )}
          {depots.depots.map((d) => (
            <li key={d.fullName} className={d.importe ? 'pj-gh-deja' : ''}>
              <div className="pj-gh-nom">
                <strong>{d.fullName}</strong>
                {d.prive && <span className="pj-vis private">🔒 {t('privé', 'private')}</span>}
                {d.archive && <span className="pj-gh-tag">{t('archivé', 'archived')}</span>}
                {d.langage && <span className="pj-gh-tag">{d.langage}</span>}
              </div>
              {d.description && <span className="pj-gh-desc">{d.description}</span>}
              {d.importe ? (
                <span className="pj-gh-etat">{t('déjà connecté', 'already connected')}</span>
              ) : (
                <button
                  className="btn"
                  disabled={occupe !== null}
                  onClick={() => importer(d.fullName)}
                >
                  {occupe === d.fullName
                    ? t('Connexion…', 'Connecting…')
                    : t('Connecter', 'Connect')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Les issues du dépôt, et le geste de les prendre.
 *
 * ─── POURQUOI CE PANNEAU NE SE RAFRAÎCHIT PAS TOUT SEUL ─────────────────────
 *
 * Chaque lecture consomme le QUOTA GITHUB DE L'HÔTE. Un `useApiPoll` sur cinq
 * cartes de projet épuiserait le quota horaire du jeton en une après-midi
 * d'écran ouvert, et la ruche perdrait alors sa capacité à LIVRER — pour avoir
 * affiché une liste que personne ne regardait.
 *
 * Les issues se demandent donc, elles ne se surveillent pas.
 *
 * EXPORTÉ POUR ÊTRE RENDU EN TEST — pas pour être réutilisé ailleurs. Ce
 * panneau porte une machine à états (`enCours`) qu'aucune lecture du source ne
 * peut exercer : seul un rendu réel dit si le bouton se verrouille pendant que
 * la ruche travaille. Voir `dashboard/tests/panneaux-depot.test.tsx`.
 */
export function IssuesProjet({ project }: { project: Project }) {
  const t = useT();
  const [issues, setIssues] = useState<IssueVue[] | null>(null);
  const [depot, setDepot] = useState('');
  const [tronque, setTronque] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pris, setPris] = useState<Record<number, string>>({});
  const [enCours, setEnCours] = useState<number | null>(null);

  // Sans dépôt, il n'y a rien à demander : on se tait plutôt que d'offrir un
  // bouton qui ne peut que refuser.
  if (!project.repoUrl) return null;

  const charger = () => {
    setChargement(true);
    setErreur(null);
    fetchIssues(project.id)
      .then((r) => {
        setIssues(r.issues);
        setDepot(r.depot);
        setTronque(r.tronque);
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  const prendre = (numero: number) => {
    setEnCours(numero);
    setErreur(null);
    prendreIssue(project.id, numero)
      .then((r) =>
        setPris((p) => ({
          ...p,
          [numero]: t(`${r.taches.length} tâche(s) créée(s)`, `${r.taches.length} task(s) created`),
        })),
      )
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setEnCours(null));
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Issues du dépôt', 'Repository issues')}</h4>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : issues
              ? t('relire', 'reload')
              : t('voir les issues', 'show issues')}
        </button>
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {issues && issues.length === 0 && (
        <p className="pj-sub-vide">
          {t('Aucune issue ouverte sur ', 'No open issue on ')}
          {depot}.
        </p>
      )}

      {issues && issues.length > 0 && (
        <ul className="pj-iss-liste">
          {issues.map((i) => (
            <li key={i.numero}>
              <a
                className="pj-iss-titre"
                href={i.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                #{i.numero} {i.titre}
              </a>
              {i.etiquettes.length > 0 && (
                <span className="pj-iss-etiq">{i.etiquettes.join(' · ')}</span>
              )}
              {pris[i.numero] ? (
                <span className="pj-iss-pris">✔ {pris[i.numero]}</span>
              ) : (
                <button
                  className="btn ghost sm"
                  onClick={() => prendre(i.numero)}
                  disabled={enCours !== null}
                  title={t(
                    'La ruche découpe cette demande en tâches',
                    'The hive splits this request into tasks',
                  )}
                >
                  {enCours === i.numero ? '…' : t('prendre', 'take')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {tronque && (
        <p className="pj-sub-note">
          {t(
            'Liste tronquée : le dépôt a plus d’issues que la ruche n’en lit d’un coup.',
            'Truncated: the repository has more issues than the hive reads at once.',
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Ce que deviennent les pull requests ouvertes par la ruche.
 *
 * Même règle que les issues : la lecture coûte le quota de l'hôte, donc elle se
 * demande. Et REPRENDRE fait travailler l'essaim — c'est un geste, jamais un
 * effet de bord d'un rafraîchissement.
 *
 * EXPORTÉ POUR ÊTRE RENDU EN TEST — même raison que `IssuesProjet`.
 */
export function LivraisonsProjet({ project }: { project: Project }) {
  const t = useT();
  const [livraisons, setLivraisons] = useState<LivraisonVue[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [repris, setRepris] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<string | null>(null);

  if (!project.repoUrl) return null;

  const charger = () => {
    setChargement(true);
    setErreur(null);
    fetchLivraisons(project.id)
      .then((r) => setLivraisons(r.livraisons))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  const reprendre = (taskId: string) => {
    setEnCours(taskId);
    setErreur(null);
    reprendreLivraison(project.id, taskId)
      .then((r) => {
        setRepris((p) => ({ ...p, [taskId]: r.tache.title }));
        charger();
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setEnCours(null));
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Ce que devient le travail livré', 'What the delivered work becomes')}</h4>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : livraisons
              ? t('relire', 'reload')
              : t('voir les livraisons', 'show deliveries')}
        </button>
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {livraisons && livraisons.length === 0 && (
        <p className="pj-sub-vide">
          {t('Aucune pull request ouverte par la ruche.', 'No pull request opened by the hive.')}
        </p>
      )}

      {livraisons && livraisons.length > 0 && (
        <ul className="pj-liv-liste">
          {livraisons.map((l) => (
            <li key={l.taskId} className={`pj-liv-${l.etat ?? 'inconnu'}`}>
              <a
                className="pj-liv-pr"
                href={`https://github.com/${l.depot}/pull/${l.pr}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                #{l.pr}
              </a>
              <span className="pj-liv-titre">{l.titre || l.taskId}</span>
              {/* Une PR illisible le DIT. Une ligne muette laisserait croire
                  qu'il ne se passe rien, alors qu'on n'a pas pu regarder. */}
              <span className="pj-liv-etat">{l.illisible ? `⚠ ${l.illisible}` : l.dit}</span>
              {repris[l.taskId] ? (
                <span className="pj-liv-repris">✔ {repris[l.taskId]}</span>
              ) : (
                l.reprenable && (
                  <button
                    className="btn ghost sm"
                    onClick={() => reprendre(l.taskId)}
                    disabled={enCours !== null}
                    title={t(
                      'Fabrique une tâche qui reprend ce qui est signalé',
                      'Creates a task that picks up what was reported',
                    )}
                  >
                    {enCours === l.taskId ? '…' : t('reprendre', 'pick up')}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  tasks,
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
          {project.visibility === 'private' ? t('🔒 privé', '🔒 private') : '🌐 public'}
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
                title={`${report.byStatus[s]} ${statusLabel(s, lang)}${lang === 'fr' ? '(s)' : ''}`}
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
      <PleinEssaim projectId={project.id} />

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
      <LivraisonsProjet project={project} />

      {/* Le Conseil en dernier : c'est une lecture de délibération, pas un
          geste. Il ne s'affiche que si ce projet a délibéré. */}
      <ConseilProjet projectId={project.id} refreshTick={refreshTick} />

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
