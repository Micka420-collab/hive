// Vue Miellerie — centre de revue des productions IA : file de revue à gauche,
// inspection (diff / logs / consensus) au centre, verdict à droite (repliable),
// barre de décision sticky et coulée du miel (merge par projet) en pied de vue.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HiveNode, Task, TaskResult } from '../../../src/shared/types';
import {
  fetchConflicts,
  fetchConsensus,
  fetchMergePlan,
  fetchMergeResult,
  fetchResults,
  runMerge,
} from '../api';
import type { Conflict, MergePlan, MergeRunResult, Verdict } from '../api';
import { activateProps, formatMs, StatusBadge } from '../ui';
import { getReview, Honeycomb, setReview, useApiPoll, useReviewTick } from './shared';
import type { ReviewState, ViewProps } from './shared';
import './miellerie.css';

// ─── Aides pures ─────────────────────────────────────────────────────────────

/** Le focus est-il dans un champ de saisie ? (neutralise les raccourcis) */
function inInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  );
}

/** Nom lisible d'un nœud (sinon id court, sinon tiret). */
function nodeName(nodes: HiveNode[], id: string | null | undefined): string {
  if (!id) return '—';
  return nodes.find((n) => n.id === id)?.name ?? id.slice(0, 8);
}

/** Erreur API → texte lisible (503 = aucun nœud en ligne, etc.). */
function readableError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/503/.test(msg)) return 'Aucun nœud en ligne pour exécuter le merge (503).';
  if (/failed to fetch/i.test(msg)) return 'Orchestrateur injoignable — vérifiez la connexion.';
  return msg;
}

/** Rang de tri : échouées d'abord, puis non-revues, puis revues. */
function reviewRank(t: Task): number {
  if (t.status === 'failed') return 0;
  return getReview(t.id) === null ? 1 : 2;
}

// ─── Pré-découpe du diff par fichier ─────────────────────────────────────────

interface DiffFilePart {
  name: string;
  lines: string[];
  adds: number;
  dels: number;
}

const MAX_DIFF_LINES = 2000;

/** Découpe un diff unifié par fichier ; null → fallback brut (trop long ou illisible). */
function splitDiff(diff: string): DiffFilePart[] | null {
  try {
    if (diff.split('\n').length > MAX_DIFF_LINES) return null;
    const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.trim() !== '');
    if (chunks.length === 0 || !chunks[0]?.startsWith('diff --git ')) return null;
    return chunks.map((chunk) => {
      const lines = chunk.replace(/\n$/, '').split('\n');
      const head = lines[0] ?? '';
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(head);
      return {
        name: m?.[2] ?? head.replace('diff --git ', ''),
        lines,
        adds: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
        dels: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
      };
    });
  } catch {
    return null;
  }
}

/** Classe de coloration d'une ligne de diff. */
function lineClass(line: string): string | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) return 'mi-meta';
  if (line.startsWith('+')) return 'mi-add';
  if (line.startsWith('-')) return 'mi-del';
  if (line.startsWith('@@')) return 'mi-hunk';
  if (line.startsWith('diff --git') || line.startsWith('index ')) return 'mi-meta';
  return undefined;
}

// ─── Panneau Diff ────────────────────────────────────────────────────────────

function DiffPanel({ diff }: { diff: string }) {
  const parts = useMemo(() => splitDiff(diff), [diff]);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [copied, setCopied] = useState(false);
  const secRefs = useRef<(HTMLElement | null)[]>([]);

  // Nouveau diff → repli remis à zéro, 1re section dépliée.
  useEffect(() => {
    setOpen(new Set([0]));
  }, [diff]);

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const copy = () => {
    navigator.clipboard
      .writeText(diff)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  if (diff.trim() === '') {
    return <p className="muted-text">Diff vide — rien à butiner sur cette production.</p>;
  }

  const copyBtn = (
    <button className="btn mi-copy" onClick={copy}>
      {copied ? 'Copié !' : 'Copier le diff'}
    </button>
  );

  if (!parts) {
    // Fallback brut : diff trop long (> 2000 lignes) ou format inattendu.
    return (
      <div>
        <div className="mi-files">
          <span className="muted-text">Diff affiché brut (long ou non découpable).</span>
          {copyBtn}
        </div>
        <pre className="code-block scroll mi-diff-pre">{diff}</pre>
      </div>
    );
  }

  return (
    <div>
      <div className="mi-files">
        {parts.map((f, i) => (
          <button
            key={`${i}-${f.name}`}
            className={`mi-file-chip${open.has(i) ? ' open' : ''}`}
            title={f.name}
            onClick={() => {
              if (!open.has(i)) toggle(i);
              secRefs.current[i]?.scrollIntoView({ block: 'nearest' });
            }}
          >
            <span className="mi-file-name">{f.name}</span>
            <span className="mi-add-stat">+{f.adds}</span>
            <span className="mi-del-stat">−{f.dels}</span>
          </button>
        ))}
        {copyBtn}
      </div>
      {parts.map((f, i) => (
        <section
          key={`${i}-${f.name}`}
          className="mi-file-section"
          ref={(el) => {
            secRefs.current[i] = el;
          }}
        >
          <button className="mi-file-head" aria-expanded={open.has(i)} onClick={() => toggle(i)}>
            <span className="mi-fold" aria-hidden="true">
              {open.has(i) ? '▾' : '▸'}
            </span>
            <span className="mi-file-name">{f.name}</span>
            <span className="mi-add-stat">+{f.adds}</span>
            <span className="mi-del-stat">−{f.dels}</span>
          </button>
          {open.has(i) && (
            <pre className="code-block scroll mi-diff-pre">
              {f.lines.map((l, j) => (
                <span key={j} className={lineClass(l)}>
                  {l}
                  {'\n'}
                </span>
              ))}
            </pre>
          )}
        </section>
      ))}
    </div>
  );
}

// ─── Panneau Consensus (Parlement des Agents) ────────────────────────────────

const OUTCOME_LABEL: Record<Verdict['outcome'], string> = {
  elected: 'Consensus atteint',
  no_quorum: 'Pas de quorum — arbitrage humain',
  no_ballots: 'Aucun bulletin',
};

function ConsensusPanel({ verdict, error }: { verdict: Verdict | null; error: string | null }) {
  if (error) return <p className="panel-error">Consensus indisponible : {error}</p>;
  if (!verdict) return <p className="muted-text">Dépouillement en cours…</p>;

  const total = verdict.factions.reduce((sum, f) => sum + f.votes, 0);
  const quorumPct = total > 0 ? Math.min(100, (verdict.quorum / total) * 100) : null;

  return (
    <div>
      <p className={`mi-cons-outcome ${verdict.outcome}`}>{OUTCOME_LABEL[verdict.outcome]}</p>
      {verdict.factions.length > 0 && (
        <>
          <div
            className="mi-cons-bar"
            role="img"
            aria-label={`${verdict.factions.length} faction(s), quorum à ${verdict.quorum} voix`}
          >
            {verdict.factions.map((f) => (
              <div
                key={f.signature}
                className={`mi-fac-seg${f.diversity >= 2 ? ' gold' : ' hatch'}${
                  verdict.winner?.signature === f.signature ? ' win' : ''
                }`}
                style={{ flexGrow: f.votes }}
                title={`${f.votes} voix — ${f.agentTypes.join(', ')}`}
              />
            ))}
            {quorumPct !== null && (
              <div
                className="mi-quorum"
                style={{ left: `${quorumPct}%` }}
                title={`Quorum : ${verdict.quorum} voix`}
              />
            )}
          </div>
          <p className="mi-cons-note">
            quorum : {verdict.quorum} voix · {total} voix exprimée(s)
          </p>
          <ul className="mi-fac-list">
            {verdict.factions.map((f) => (
              <li key={f.signature} className="mi-fac-row">
                <code className="mi-fac-sig">{f.signature}</code>
                <span>{f.votes} voix</span>
                {f.agentTypes.map((t) => (
                  <span key={t} className="chip mi-chip-static">
                    {t}
                  </span>
                ))}
                {verdict.winner?.signature === f.signature && (
                  <span className="mi-elected">👑 Élu</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Vue principale ──────────────────────────────────────────────────────────

type Tab = 'diff' | 'logs' | 'consensus';

type MergePhase =
  | { step: 'idle' }
  | { step: 'arming' }
  | { step: 'starting' }
  | { step: 'waiting'; mergeId: string; since: number }
  | { step: 'done'; result: MergeRunResult }
  | { step: 'error'; message: string };

export default function Miellerie({
  snapshot,
  onOpenTask,
  onNavigate,
  selectedId,
  refreshTick,
}: ViewProps) {
  const reviewTick = useReviewTick();
  void reviewTick; // relit localStorage (tri + compteurs) à chaque revue

  // File de revue : done/failed, groupées par projet, triées (failed → non-revues → revues).
  const finished = snapshot.tasks.filter((t) => t.status === 'done' || t.status === 'failed');
  const byRank = (a: Task, b: Task) => reviewRank(a) - reviewRank(b) || b.updatedAt - a.updatedAt;
  const groups: { id: string; name: string; tasks: Task[] }[] = [];
  for (const p of snapshot.projects) {
    const tasks = finished.filter((t) => t.projectId === p.id).sort(byRank);
    if (tasks.length > 0) groups.push({ id: p.id, name: p.name, tasks });
  }
  const known = new Set(snapshot.projects.map((p) => p.id));
  const orphans = finished.filter((t) => !known.has(t.projectId)).sort(byRank);
  if (orphans.length > 0) groups.push({ id: '?', name: 'Projet inconnu', tasks: orphans });
  const flat = groups.flatMap((g) => g.tasks);
  const reviewedCount = flat.filter((t) => getReview(t.id) !== null).length;

  // Sélection : selectedId du hash si présent dans la liste, sinon la première.
  const activeTask =
    (selectedId ? flat.find((t) => t.id === selectedId) : undefined) ?? flat[0] ?? null;
  const activeId = activeTask ? activeTask.id : null;
  const projectId = activeTask ? activeTask.projectId : null;
  const select = (id: string) => onNavigate('miellerie', id);

  const [tab, setTab] = useState<Tab>('diff');
  const [showInfo, setShowInfo] = useState(true);
  const queueRef = useRef<HTMLUListElement | null>(null);

  // Époque de sélection : force le re-fetch des sondes quand la tâche change
  // (useApiPoll ne réagit qu'au tick, pas au fetcher).
  const [selEpoch, setSelEpoch] = useState(0);
  const prevSel = useRef(activeId);
  useEffect(() => {
    if (prevSel.current !== activeId) {
      prevSel.current = activeId;
      setSelEpoch((e) => e + 1);
    }
  }, [activeId]);
  const pollTick = refreshTick + selEpoch;

  // ─── Sondes REST (≥ 30 s + tick) ────────────────────────────────────────────
  const results = useApiPoll<TaskResult[]>(
    () => (activeId ? fetchResults(activeId) : Promise.resolve([])),
    30_000,
    pollTick,
  );
  // Dernier résultat de LA tâche active (écarte les données périmées d'une autre tâche).
  const lastResult = useMemo(() => {
    const list = results.data ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r && r.taskId === activeId) return r;
    }
    return null;
  }, [results.data, activeId]);
  const resultsReady = results.data !== null && (results.data.length === 0 || lastResult !== null);

  const consensus = useApiPoll(
    () => {
      const id = activeId;
      return id ? fetchConsensus(id).then((v) => ({ id, v })) : Promise.resolve(null);
    },
    30_000,
    pollTick,
  );
  const verdict = consensus.data && consensus.data.id === activeId ? consensus.data.v : null;

  const conflictsPoll = useApiPoll(
    () => {
      const id = projectId;
      return id
        ? fetchConflicts(id).then((r) => ({ id, list: r.conflicts }))
        : Promise.resolve(null);
    },
    60_000,
    pollTick,
  );
  const sting: Conflict[] | null =
    conflictsPoll.data && conflictsPoll.data.id === projectId
      ? conflictsPoll.data.list.filter((c) => c.a === activeId || c.b === activeId)
      : null;

  // ─── Décision de revue + auto-avance ────────────────────────────────────────
  const decide = (state: ReviewState | null) => {
    if (!activeTask) return;
    setReview(activeTask.id, state);
    if (state === null) return;
    // Auto-avance : prochaine tâche non revue, en bouclant sur la liste.
    const idx = flat.findIndex((t) => t.id === activeTask.id);
    const rest = [...flat.slice(idx + 1), ...flat.slice(0, idx)];
    const next = rest.find((t) => getReview(t.id) === null);
    if (next) select(next.id);
  };

  // ─── Raccourcis clavier (j/k, Enter, a/x/u, i, Esc) ────────────────────────
  const handleKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || inInput()) return;
    const focused = document.activeElement as HTMLElement | null;
    const tag = focused?.tagName ?? '';
    switch (e.key) {
      case 'j':
      case 'k': {
        if (flat.length === 0) return;
        const idx = activeId ? flat.findIndex((t) => t.id === activeId) : 0;
        const next = flat[(idx + (e.key === 'j' ? 1 : -1) + flat.length) % flat.length];
        if (next) select(next.id);
        break;
      }
      case 'Enter': {
        // Ne double pas les éléments interactifs déjà focalisés (rangées, boutons).
        if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return;
        if (focused?.getAttribute('role') === 'button') return;
        if (activeId) {
          e.preventDefault();
          onOpenTask(activeId);
        }
        break;
      }
      case 'a':
        decide('approved');
        break;
      case 'x':
        decide('rejected');
        break;
      case 'u':
        decide(null);
        break;
      case 'i':
        setShowInfo((v) => !v);
        break;
      case 'Escape': {
        const row =
          queueRef.current?.querySelector<HTMLElement>('.mi-row.active') ??
          queueRef.current?.querySelector<HTMLElement>('.mi-row');
        row?.focus();
        break;
      }
    }
  };
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Coulée du miel (merge du projet de la tâche active) ───────────────────
  const [planState, setPlanState] = useState<{ id: string; plan: MergePlan } | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [merge, setMerge] = useState<MergePhase>({ step: 'idle' });
  const armTimer = useRef<number | undefined>(undefined);

  // Changement de projet → on repart d'un pied de vue propre.
  useEffect(() => {
    setPlanState(null);
    setPlanErr(null);
    setPlanOpen(false);
    setMerge({ step: 'idle' });
  }, [projectId]);

  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  const togglePlan = () => {
    if (planOpen) {
      setPlanOpen(false);
      return;
    }
    if (!projectId) return;
    const id = projectId;
    setPlanOpen(true);
    setPlanErr(null);
    setPlanLoading(true);
    fetchMergePlan(id)
      .then((plan) => setPlanState({ id, plan }))
      .catch((e: unknown) => setPlanErr(readableError(e)))
      .finally(() => setPlanLoading(false));
  };

  const clickMerge = () => {
    if (!projectId || merge.step === 'starting' || merge.step === 'waiting') return;
    if (merge.step !== 'arming') {
      // 1er clic : armement — le 2e clic (sous 3 s) confirme.
      setMerge({ step: 'arming' });
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => {
        setMerge((m) => (m.step === 'arming' ? { step: 'idle' } : m));
      }, 3_000);
      return;
    }
    window.clearTimeout(armTimer.current);
    setMerge({ step: 'starting' });
    runMerge(projectId)
      .then((start) => setMerge({ step: 'waiting', mergeId: start.mergeId, since: Date.now() }))
      .catch((e: unknown) => setMerge({ step: 'error', message: readableError(e) }));
  };

  // Suivi du merge : relevé toutes les 3 s (exception bornée), 2 min max + refreshTick.
  useEffect(() => {
    if (merge.step !== 'waiting' || !projectId) return;
    const { mergeId, since } = merge;
    const id = projectId;
    let alive = true;
    const check = () => {
      fetchMergeResult(id)
        .then(({ result }) => {
          if (!alive) return;
          if (result && result.mergeId === mergeId) setMerge({ step: 'done', result });
          else if (Date.now() - since > 120_000) {
            setMerge({
              step: 'error',
              message: 'Pas de résultat après 2 min — le merge tourne peut-être encore côté nœud.',
            });
          }
        })
        .catch((e: unknown) => {
          if (alive) setMerge({ step: 'error', message: readableError(e) });
        });
    };
    check();
    const timer = window.setInterval(check, 3_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [merge, projectId, refreshTick]);

  // ─── État vide accueillant ──────────────────────────────────────────────────
  if (!activeTask) {
    return (
      <div className="mc-view mi-view">
        <div className="mi-empty">
          <span className="mi-empty-icon" aria-hidden="true">
            🐝
          </span>
          <p className="mi-empty-lead">Le nectar arrive — aucune production à revoir.</p>
          <p className="muted-text">
            Les tâches terminées ou échouées apparaîtront ici pour la revue humaine.
          </p>
        </div>
      </div>
    );
  }

  const currentReview = getReview(activeTask.id);
  const titleOf = (id: string) => snapshot.tasks.find((t) => t.id === id)?.title ?? id.slice(0, 8);
  const activeNode = nodeName(
    snapshot.nodes,
    activeTask.result?.nodeId ?? activeTask.assignedNodeId,
  );
  const projTasks = snapshot.tasks.filter((t) => t.projectId === projectId);
  const doneCount = projTasks.filter((t) => t.status === 'done').length;
  const approvedCount = projTasks.filter(
    (t) => t.status === 'done' && getReview(t.id) === 'approved',
  ).length;
  const projName = snapshot.projects.find((p) => p.id === projectId)?.name ?? 'Projet inconnu';

  return (
    <div className="mc-view mi-view">
      <div className={`mi-grid${showInfo ? '' : ' no-info'}`}>
        {/* ── Volet 1 : file de revue ── */}
        <aside className="card panel mi-queue-pane" aria-label="File de revue">
          <header className="panel-head">
            <h2>File de revue</h2>
            <span className="panel-count">
              {reviewedCount}/{flat.length} revues
            </span>
          </header>
          <div className="mi-comb-wrap">
            <Honeycomb tasks={flat} showReview mini onSelect={(t) => select(t.id)} />
          </div>
          <ul className="queue mi-queue" ref={queueRef}>
            {groups.map((g) => [
              <li key={`g-${g.id}`} className="mi-group">
                ⬡ {g.name} <span className="chip-count">{g.tasks.length}</span>
              </li>,
              ...g.tasks.map((t) => {
                const review = getReview(t.id);
                const active = t.id === activeId;
                return (
                  <li
                    key={t.id}
                    className={`clickable mi-row${active ? ' active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    {...activateProps(() => select(t.id))}
                  >
                    <StatusBadge status={t.status} />
                    <span className="mi-row-body">
                      <span className="mi-row-title">{t.title}</span>
                      <span className="mi-row-meta">
                        {nodeName(snapshot.nodes, t.result?.nodeId ?? t.assignedNodeId)}
                        {t.result ? ` · ${formatMs(t.result.durationMs)}` : ''}
                      </span>
                    </span>
                    <span
                      className={`mi-dot${review === 'approved' ? ' ok' : review === 'rejected' ? ' ko' : ''}`}
                      title="revue locale (ce navigateur)"
                    >
                      {review === 'approved' ? '🍯' : review === 'rejected' ? '✖' : '·'}
                    </span>
                  </li>
                );
              }),
            ])}
          </ul>
        </aside>

        {/* ── Volet 2 : inspection ── */}
        <section className="card mi-inspect" aria-label="Inspection de la tâche">
          <header className="mi-inspect-head">
            <div className="mi-inspect-title">
              <StatusBadge status={activeTask.status} />
              <h2>{activeTask.title}</h2>
            </div>
            <div className="mi-inspect-sub">
              <span title="Nœud butineur">🐝 {activeNode}</span>
              {activeTask.branch && <code className="mono mi-branch">{activeTask.branch}</code>}
              {activeTask.result && <span>{formatMs(activeTask.result.durationMs)}</span>}
            </div>
          </header>

          <div className="drawer-tabs mi-tabs" aria-label="Onglets d'inspection">
            {(['diff', 'logs', 'consensus'] as const).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t === 'diff' ? 'Diff' : t === 'logs' ? 'Logs' : 'Consensus'}
              </button>
            ))}
          </div>

          <div className="mi-tab-body">
            {tab === 'diff' &&
              (results.error ? (
                <p className="panel-error">Résultats indisponibles : {results.error}</p>
              ) : !resultsReady ? (
                <p className="muted-text">Le butin arrive…</p>
              ) : lastResult ? (
                <DiffPanel diff={lastResult.diff} />
              ) : (
                <p className="muted-text">Aucun résultat remonté pour cette tâche.</p>
              ))}
            {tab === 'logs' &&
              (results.error ? (
                <p className="panel-error">Résultats indisponibles : {results.error}</p>
              ) : !resultsReady ? (
                <p className="muted-text">Le butin arrive…</p>
              ) : lastResult ? (
                <pre className="code-block scroll mi-logs">{lastResult.logs || '(aucun log)'}</pre>
              ) : (
                <p className="muted-text">Aucun résultat remonté pour cette tâche.</p>
              ))}
            {tab === 'consensus' && <ConsensusPanel verdict={verdict} error={consensus.error} />}
          </div>

          {/* ── Barre de décision sticky ── */}
          <div className="mi-decide" aria-label="Décision de revue">
            <button
              className="btn primary"
              title="Approuver — revue locale (ce navigateur)"
              onClick={() => decide('approved')}
            >
              🍯 Approuver <kbd>a</kbd>
            </button>
            <button
              className="btn mi-reject"
              title="Rejeter — revue locale (ce navigateur)"
              onClick={() => decide('rejected')}
            >
              ✖ Rejeter <kbd>x</kbd>
            </button>
            <button
              className="btn ghost"
              disabled={currentReview === null}
              title="Annuler la revue locale"
              onClick={() => decide(null)}
            >
              annuler la revue <kbd>u</kbd>
            </button>
            <span className="mi-decide-state" title="revue locale (ce navigateur)">
              {currentReview === 'approved'
                ? 'Revue : 🍯 approuvée'
                : currentReview === 'rejected'
                  ? 'Revue : ✖ rejetée'
                  : 'Non revue'}
            </span>
            <button
              className="btn ghost mi-info-toggle"
              title="Afficher/replier le volet verdict (i)"
              onClick={() => setShowInfo((v) => !v)}
            >
              {showInfo ? 'Replier le verdict' : 'Verdict'} <kbd>i</kbd>
            </button>
          </div>
        </section>

        {/* ── Volet 3 : verdict (repliable, touche i) ── */}
        {showInfo && (
          <aside className="card mi-info" aria-label="Verdict et contexte">
            <header className="panel-head">
              <h2>Verdict</h2>
              <button
                className="mi-close-info"
                title="Replier (i)"
                aria-label="Replier le volet verdict"
                onClick={() => setShowInfo(false)}
              >
                ✕
              </button>
            </header>
            <div className="mi-info-body">
              <dl className="meta-grid">
                <dt>Nœud</dt>
                <dd>{activeNode}</dd>
                <dt>Tentatives</dt>
                <dd>{activeTask.attempts}</dd>
                <dt>Branche</dt>
                <dd className="mono">{activeTask.branch ?? '—'}</dd>
                <dt>Dépendances</dt>
                <dd>
                  {activeTask.dependsOn.length > 0
                    ? activeTask.dependsOn.map(titleOf).join(', ')
                    : '—'}
                </dd>
                <dt>Id</dt>
                <dd className="mono">{activeTask.id}</dd>
              </dl>

              <details className="mi-prompt">
                <summary>Prompt d’origine</summary>
                <pre className="code-block scroll">{activeTask.prompt}</pre>
              </details>

              <h3 className="mi-sub">Conflits Sting</h3>
              {conflictsPoll.error ? (
                <p className="panel-error">Conflits indisponibles : {conflictsPoll.error}</p>
              ) : sting === null ? (
                <p className="muted-text">Analyse des dards…</p>
              ) : sting.length === 0 ? (
                <p className="muted-text">Aucun conflit impliquant cette tâche.</p>
              ) : (
                <ul className="mi-sting">
                  {sting.map((c, i) => {
                    const other = c.a === activeId ? c.b : c.a;
                    return (
                      <li key={i} className={`mi-sting-item ${c.severity}`}>
                        <span className="mi-sting-sev">
                          {c.severity === 'high' ? '⚡ fort' : '· faible'}
                        </span>
                        <span className="mi-sting-other">avec « {titleOf(other)} »</span>
                        {c.sharedPaths.length > 0 && (
                          <code className="mi-sting-paths">{c.sharedPaths.join(', ')}</code>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Pied de vue : coulée du miel (merge par projet) ── */}
      <footer className="mi-merge" aria-label="Coulée du miel">
        <div className="mi-merge-bar">
          <span className="mi-merge-proj">⬡ {projName}</span>
          <span className="mi-merge-count">
            Prêt à fusionner : <strong>{approvedCount}</strong> approuvée(s) / {doneCount}{' '}
            terminée(s)
          </span>
          <button className="btn" onClick={togglePlan}>
            {planOpen ? 'Replier le plan' : 'Plan de merge'}
          </button>
          <button
            className={`btn primary mi-pour${merge.step === 'arming' ? ' arming' : ''}`}
            disabled={merge.step === 'starting' || merge.step === 'waiting'}
            title="Exécute réellement le merge sur un nœud (double-clic de confirmation)"
            onClick={clickMerge}
          >
            {merge.step === 'arming'
              ? 'Confirmer la coulée ?'
              : merge.step === 'starting'
                ? 'Lancement…'
                : merge.step === 'waiting'
                  ? 'Fusion en cours…'
                  : '🍯 Couler le miel'}
          </button>
        </div>

        {planOpen && (
          <div className="mi-plan">
            {planErr && <p className="panel-error">Plan indisponible : {planErr}</p>}
            {planLoading && <p className="muted-text">Calcul du plan…</p>}
            {planState && planState.id === projectId && (
              <>
                <p className="mi-plan-head">
                  {planState.plan.done}/{planState.plan.total} terminée(s) ·{' '}
                  {planState.plan.mergeable
                    ? 'intégrable d’un coup'
                    : 'intégration partielle ou conflits'}
                </p>
                {planState.plan.order.length > 0 ? (
                  <ol className="mi-plan-order">
                    {planState.plan.order.map((id) => (
                      <li key={id}>{titleOf(id)}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted-text">Rien à fusionner pour l’instant.</p>
                )}
                {planState.plan.conflicts.length === 0 ? (
                  <p className="muted-text">Aucun conflit de lignes détecté.</p>
                ) : (
                  <ul className="mi-plan-conflicts">
                    {planState.plan.conflicts.map((c, i) => (
                      <li key={i}>
                        ⚡ {titleOf(c.a)} ↔ {titleOf(c.b)} — <code>{c.file}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {merge.step === 'waiting' && (
          <p className="mi-merge-wait">Le nœud coule le miel… (relevé toutes les 3 s, 2 min max)</p>
        )}
        {merge.step === 'error' && <p className="panel-error">{merge.message}</p>}
        {merge.step === 'done' && (
          <div className="mi-merge-result">
            <p>
              {merge.result.applied.length} branche(s) appliquée(s) ·{' '}
              {merge.result.conflicts.length} conflit(s) ·{' '}
              {merge.result.testsRun
                ? merge.result.testsPassed
                  ? 'tests ✔'
                  : 'tests ✘'
                : 'tests non lancés'}
            </p>
            {merge.result.conflicts.length > 0 && (
              <ul className="mi-plan-conflicts">
                {merge.result.conflicts.map((c, i) => (
                  <li key={i}>
                    ✖ {titleOf(c.taskId)} — {c.reason}
                  </li>
                ))}
              </ul>
            )}
            {merge.result.logs && (
              <details className="mi-merge-logs">
                <summary>Logs du merge</summary>
                <pre className="code-block scroll">{merge.result.logs}</pre>
              </details>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
