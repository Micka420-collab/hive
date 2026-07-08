// Modale de création : lancer un projet et son lot de tâches (DAG) directement
// depuis l'interface, sans passer par la CLI.

import { useRef, useState } from 'react';
import { addTasks, createProject } from './api';
import type { NewTaskInput } from './api';
import { useDialog } from './ui';

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
  // Si le projet a déjà été créé mais que l'ajout des tâches a échoué, on ne le
  // recrée pas au retry (sinon on empilerait des projets vides orphelins).
  const createdId = useRef<string | null>(null);
  const closeIfIdle = () => {
    if (!busy) onClose();
  };
  const dialogRef = useDialog<HTMLDivElement>(closeIfIdle);

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
      // Ne conserver que les champs connus : le serveur rejette tout champ
      // superflu (additionalProperties:false), on nettoie donc en amont.
      tasks = (parsed as Record<string, unknown>[]).map((t) => {
        const clean: NewTaskInput = {
          title: String(t.title ?? ''),
          prompt: String(t.prompt ?? ''),
        };
        if (typeof t.id === 'string') clean.id = t.id;
        if (Array.isArray(t.dependsOn)) clean.dependsOn = t.dependsOn.map(String);
        return clean;
      });
    } catch (e) {
      setError(`Tâches invalides : ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(true);
    try {
      // Créer le projet une seule fois, même après un échec d'ajout de tâches.
      if (!createdId.current) {
        const project = await createProject({
          name: name.trim(),
          ...(repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
        });
        createdId.current = project.id;
      }
      await addTasks(createdId.current, tasks);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={closeIfIdle}>
      <div
        className="modal wide"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="np-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="np-title">🐝 Nouveau projet</h2>
          <button className="modal-close" onClick={closeIfIdle} disabled={busy} aria-label="Fermer">
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
