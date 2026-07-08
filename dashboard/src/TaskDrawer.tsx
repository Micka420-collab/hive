// Tiroir latéral : détail complet d'une tâche + son résultat (diff/logs) pour
// revue humaine, avec possibilité d'annuler une tâche en cours.

import { lazy, Suspense, useEffect, useState } from 'react';
import { cancelTask, fetchResults } from './api';
import type { HiveNode, Task, TaskResult } from '../../src/shared/types';
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
  const [results, setResults] = useState<TaskResult[] | null>(null);
  const [tab, setTab] = useState<'diff' | 'logs'>('diff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError('copie impossible dans ce contexte.');
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
          <button className="modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <dl className="meta-grid">
          <dt>Nœud</dt>
          <dd>{nodeName}</dd>
          <dt>Tentatives</dt>
          <dd>{task.attempts}</dd>
          <dt>Branche</dt>
          <dd className="mono">{task.branch ?? '—'}</dd>
          <dt>Durée</dt>
          <dd>{task.result ? formatMs(task.result.durationMs) : '—'}</dd>
          <dt>Dépendances</dt>
          <dd>{task.dependsOn.length > 0 ? task.dependsOn.length : 'aucune'}</dd>
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
                <label className="toggle" title="Autoriser l'édition locale (non enregistrée)">
                  <input
                    type="checkbox"
                    checked={editable}
                    onChange={(e) => setEditable(e.target.checked)}
                  />
                  éditer
                </label>
                <button className="chip" onClick={copyCode}>
                  {copied ? '✔ copié' : 'copier'}
                </button>
              </div>
            </div>
            <Suspense fallback={<pre className="code-block scroll">{shown || '(vide)'}</pre>}>
              <CodeEditor
                value={shown || (tab === 'diff' ? '(aucun diff)' : '(aucun log)')}
                lang={tab === 'diff' ? 'diff' : 'text'}
                editable={editable}
                onChange={setEdited}
              />
            </Suspense>
            {editable && (
              <p className="editor-hint">
                Édition locale d’exploration — non enregistrée (le merge arrivera au Palier 3).
              </p>
            )}
          </>
        )}
        {results !== null && results.length === 0 && (
          <p className="muted-text">Aucun résultat remonté pour l’instant.</p>
        )}

        {error && <p className="modal-error">{error}</p>}
        {cancellable && (
          <button className="btn danger-btn" onClick={doCancel} disabled={busy}>
            {busy ? 'Annulation…' : 'Annuler la tâche'}
          </button>
        )}
      </aside>
    </div>
  );
}
