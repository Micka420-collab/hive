// Modale de création : lancer un projet et son lot de tâches (DAG) directement
// depuis l'interface, sans passer par la CLI.

import { useState } from 'react';
import { addTasks, createProject } from './api';
import type { NewTaskInput } from './api';

const EXAMPLE = `[
  { "id": "socle", "title": "Échafauder le dépôt", "prompt": "Créer la structure" },
  { "id": "api", "title": "API REST", "prompt": "Endpoints", "dependsOn": ["socle"] },
  { "id": "front", "title": "Interface", "prompt": "UI", "dependsOn": ["socle"] },
  { "id": "tests", "title": "Tests e2e", "prompt": "Couvrir", "dependsOn": ["api", "front"] }
]`;

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [tasksJson, setTasksJson] = useState(EXAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Le nom du projet est requis.');
      return;
    }
    let tasks: NewTaskInput[];
    try {
      const parsed: unknown = JSON.parse(tasksJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('le JSON doit être un tableau non vide de tâches');
      }
      tasks = parsed as NewTaskInput[];
    } catch (e) {
      setError(`Tâches invalides : ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(true);
    try {
      const project = await createProject({
        name: name.trim(),
        ...(repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
      });
      await addTasks(project.id, tasks);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🐝 Nouveau projet</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        {error && <p className="modal-error">{error}</p>}

        <label className="field">
          <span>Nom du projet</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mon SaaS"
            autoFocus
          />
        </label>

        <label className="field">
          <span>Dépôt git (optionnel)</span>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/moi/projet.git"
          />
        </label>

        <label className="field">
          <span>Tâches (JSON) — title, prompt, id et dependsOn optionnels</span>
          <textarea
            className="code-input"
            rows={10}
            value={tasksJson}
            onChange={(e) => setTasksJson(e.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Création…' : 'Lancer le butinage'}
          </button>
        </div>
      </div>
    </div>
  );
}
