// Tiroir latéral : détail complet d'une tâche + son résultat (diff/logs) pour
// revue humaine, avec possibilité d'annuler une tâche en cours.

import { lazy, Suspense, useEffect, useState } from 'react';
import { cancelTask, fetchResults, raceTask } from './api';
import type { HiveNode, Task, TaskResult } from '../../src/shared/types';
import { useT } from './i18n';
import { formatMs, StatusBadge, useDialog } from './ui';

// L'éditeur (CodeMirror) est chargé à la demande — pesant seulement quand on
// ouvre le tiroir d'une tâche.
const CodeEditor = lazy(() => import('./CodeEditor'));

interface Props {
  task: Task;
  nodes: HiveNode[];
  onClose: () => void;
}

export function TaskDrawer({ task, nodes, onClose }: Props) {
  const t = useT();
  const [results, setResults] = useState<TaskResult[] | null>(null);
  const [tab, setTab] = useState<'diff' | 'logs'>('diff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raced, setRaced] = useState<number | null>(null);
  const [editable, setEditable] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useDialog<HTMLElement>(onClose);

  useEffect(() => {
    let alive = true;
    setResults(null);
    fetchResults(task.id)
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults([]));
    return () => {
      alive = false;
    };
  }, [task.id]);

  const nodeName = task.assignedNodeId
    ? (nodes.find((n) => n.id === task.assignedNodeId)?.name ?? task.assignedNodeId.slice(0, 8))
    : '—';
  const last = results && results.length > 0 ? results[results.length - 1] : null;
  const cancellable = task.status !== 'done' && task.status !== 'failed';

  // Contenu affiché dans l'éditeur : édition locale prioritaire, sinon la source.
  const source = last ? (tab === 'diff' ? last.diff : last.logs) : '';
  const shown = edited ?? source;
  // Réinitialiser l'édition locale quand on change d'onglet ou de tâche.
  useEffect(() => {
    setEdited(null);
    setCopied(false);
  }, [tab, task.id, results]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('copie impossible dans ce contexte.', 'copy is unavailable in this context.'));
    }
  };

  const doCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelTask(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Drone Wars : course compétitive sur une tâche prête (geste humain explicite).
  const doRace = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await raceTask(task.id);
      setRaced(res.drones.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2 id="drawer-title">{task.title}</h2>
            <StatusBadge status={task.status} />
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t('Fermer', 'Close')}>
            ×
          </button>
        </header>

        <dl className="meta-grid">
          <dt>{t('Nœud', 'Node')}</dt>
          <dd>{nodeName}</dd>
          <dt>{t('Tentatives', 'Attempts')}</dt>
          <dd>{task.attempts}</dd>
          <dt>{t('Branche', 'Branch')}</dt>
          <dd className="mono">{task.branch ?? '—'}</dd>
          <dt>{t('Durée', 'Duration')}</dt>
          <dd>{task.result ? formatMs(task.result.durationMs) : '—'}</dd>
          <dt>{t('Dépendances', 'Dependencies')}</dt>
          <dd>{task.dependsOn.length > 0 ? task.dependsOn.length : t('aucune', 'none')}</dd>
          <dt>ID</dt>
          <dd className="mono">{task.id}</dd>
        </dl>

        <h3>Prompt</h3>
        <pre className="code-block">{task.prompt}</pre>

        {last && (
          <>
            <div className="editor-bar">
              <div className="drawer-tabs">
                <button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>
                  Diff
                </button>
                <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
                  Logs
                </button>
              </div>
              <div className="editor-actions">
                <label
                  className="toggle"
                  title={t(
                    "Autoriser l'édition locale (non enregistrée)",
                    'Allow local editing (not saved)',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={editable}
                    onChange={(e) => setEditable(e.target.checked)}
                  />
                  {t('éditer', 'edit')}
                </label>
                <button className="chip" onClick={copyCode}>
                  {copied ? t('✔ copié', '✔ copied') : t('copier', 'copy')}
                </button>
              </div>
            </div>
            <Suspense
              fallback={<pre className="code-block scroll">{shown || t('(vide)', '(empty)')}</pre>}
            >
              <CodeEditor
                value={
                  shown ||
                  (tab === 'diff' ? t('(aucun diff)', '(no diff)') : t('(aucun log)', '(no logs)'))
                }
                lang={tab === 'diff' ? 'diff' : 'text'}
                editable={editable}
                onChange={setEdited}
              />
            </Suspense>
            {editable && (
              <p className="editor-hint">
                {t(
                  'Édition locale d’exploration — non enregistrée (le merge arrivera au Palier 3).',
                  'Local exploratory edit — not saved (merge lands at Stage 3).',
                )}
              </p>
            )}
          </>
        )}
        {results !== null && results.length === 0 && (
          <p className="muted-text">
            {t('Aucun résultat remonté pour l’instant.', 'No results reported yet.')}
          </p>
        )}

        {error && <p className="modal-error">{error}</p>}
        {task.status === 'ready' && raced === null && (
          <button
            className="btn"
            onClick={doRace}
            disabled={busy}
            title={t(
              'Drone Wars : la même tâche confiée à plusieurs nœuds — le premier succès gagne, les autres sont annulés',
              'Drone Wars: the same task handed to several nodes — the first success wins, the others are cancelled',
            )}
          >
            {busy
              ? t('Lancement…', 'Launching…')
              : t('⚔ Course de drones (3 nœuds)', '⚔ Drone race (3 nodes)')}
          </button>
        )}
        {raced !== null && (
          <p className="muted-text">
            ⚔ {t('Course lancée :', 'Race launched:')} {raced}{' '}
            {t(
              'drone(s) en vol — le premier succès gagne.',
              'drone(s) in flight — the first success wins.',
            )}
          </p>
        )}
        {cancellable && (
          <button className="btn danger-btn" onClick={doCancel} disabled={busy}>
            {busy ? t('Annulation…', 'Cancelling…') : t('Annuler la tâche', 'Cancel the task')}
          </button>
        )}
      </aside>
    </div>
  );
}
