// Modale de création : lancer un projet et son lot de tâches (DAG) directement
// depuis l'interface, sans passer par la CLI.

import { useRef, useState } from 'react';
import { addTasks, createProject, planBrief } from './api';
import type { NewTaskInput } from './api';
import { useT } from './i18n';
import type { Translate } from './i18n';
import { useDialog, Voile } from './ui';

const j = (v: unknown) => JSON.stringify(v, null, 2);

/** Modèles de démarrage : remplissent le champ des tâches en un clic.
 *  Fonction paramétrée par `t` (pas de hook au niveau module). */
const makeTemplates = (t: Translate): { label: string; tasks: NewTaskInput[] }[] => [
  {
    label: t('Tâche unique', 'Single task'),
    tasks: [
      {
        id: 'tache',
        title: t('Ma tâche', 'My task'),
        prompt: t('Décrivez le travail à faire', 'Describe the work to do'),
      },
    ],
  },
  {
    label: t('API + tests', 'API + tests'),
    tasks: [
      {
        id: 'modele',
        title: t('Modèle de données', 'Data model'),
        prompt: t('Concevoir le schéma', 'Design the schema'),
      },
      {
        id: 'api',
        title: t('API REST', 'REST API'),
        prompt: t('Implémenter les endpoints', 'Implement the endpoints'),
        dependsOn: ['modele'],
      },
      {
        id: 'tests',
        title: t('Tests', 'Tests'),
        prompt: t('Couvrir l’API', 'Cover the API'),
        dependsOn: ['api'],
      },
    ],
  },
  {
    label: t('SaaS complet', 'Full SaaS'),
    tasks: [
      {
        id: 'socle',
        title: t('Échafauder le dépôt', 'Scaffold the repository'),
        prompt: t('Créer la structure', 'Create the structure'),
      },
      {
        id: 'bdd',
        title: t('Schéma BDD', 'DB schema'),
        prompt: t('Comptes, abonnements, factures', 'Accounts, subscriptions, invoices'),
        dependsOn: ['socle'],
      },
      {
        id: 'auth',
        title: t('API auth', 'Auth API'),
        prompt: t('Signup / login / sessions', 'Signup / login / sessions'),
        dependsOn: ['bdd'],
      },
      {
        id: 'billing',
        title: t('API facturation', 'Billing API'),
        prompt: t('Paiement + webhooks', 'Payment + webhooks'),
        dependsOn: ['bdd'],
      },
      {
        id: 'ui',
        title: t('Interface web', 'Web interface'),
        prompt: t('Dashboard client', 'Customer dashboard'),
        dependsOn: ['socle'],
      },
      {
        id: 'tests',
        title: t('Tests d’intégration', 'Integration tests'),
        prompt: t('Auth + facturation + UI', 'Auth + billing + UI'),
        dependsOn: ['auth', 'billing', 'ui'],
      },
      {
        id: 'deploy',
        title: t('Déploiement', 'Deployment'),
        prompt: t('CI/CD', 'CI/CD'),
        dependsOn: ['tests'],
      },
    ],
  },
];

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const templates = makeTemplates(t);
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [brief, setBrief] = useState('');
  const [tasksJson, setTasksJson] = useState(() => j(makeTemplates(t)[0]!.tasks));
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Si le projet a déjà été créé mais que l'ajout des tâches a échoué, on ne le
  // recrée pas au retry (sinon on empilerait des projets vides orphelins).
  const createdId = useRef<string | null>(null);
  const closeIfIdle = () => {
    if (!busy && !planning) onClose();
  };
  const dialogRef = useDialog<HTMLDivElement>(closeIfIdle);

  // Queen Bee : demande un DAG dérivé du brief et le charge dans le champ JSON,
  // qui reste éditable — la sortie est une proposition, jamais imposée.
  const generate = async () => {
    setError(null);
    setPlanNote(null);
    setPlanning(true);
    try {
      const res = await planBrief(brief.trim());
      setTasksJson(j(res.tasks));
      setAdvanced(true);
      setPlanNote(
        res.source === 'llm'
          ? t(
              `${res.tasks.length} tâches proposées par l’IA — vérifiez puis ajustez.`,
              `${res.tasks.length} tasks proposed by the AI — review then adjust.`,
            )
          : (res.note ??
              t(
                `${res.tasks.length} tâches (découpage heuristique) — vérifiez puis ajustez.`,
                `${res.tasks.length} tasks (heuristic split) — review then adjust.`,
              )),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t('Le nom du projet est requis.', 'The project name is required.'));
      return;
    }
    let tasks: NewTaskInput[];
    if (!advanced) {
      if (!brief.trim()) {
        setError(
          t(
            'Décrivez la première mission à confier à la ruche.',
            'Describe the first mission to give the hive.',
          ),
        );
        return;
      }
      tasks = [{ title: name.trim(), prompt: brief.trim() }];
    } else {
      try {
        const parsed: unknown = JSON.parse(tasksJson);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error(
            t(
              'le JSON doit être un tableau non vide de tâches',
              'the JSON must be a non-empty array of tasks',
            ),
          );
        }
        // Ne conserver que les champs connus : le serveur rejette tout champ
        // superflu (additionalProperties:false), on nettoie donc en amont.
        tasks = (parsed as Record<string, unknown>[]).map((task) => {
          const clean: NewTaskInput = {
            title: String(task.title ?? ''),
            prompt: String(task.prompt ?? ''),
          };
          if (typeof task.id === 'string') clean.id = task.id;
          if (Array.isArray(task.dependsOn)) clean.dependsOn = task.dependsOn.map(String);
          return clean;
        });
      } catch (e) {
        setError(
          `${t('Tâches invalides :', 'Invalid tasks:')} ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return;
      }
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
    <Voile onClose={closeIfIdle}>
      <div
        className="modal wide np-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="np-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="np-title">
            <span className="marque" aria-hidden="true" /> {t('Nouveau projet', 'New project')}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={closeIfIdle}
            disabled={busy || planning}
            aria-label={t('Fermer', 'Close')}
          >
            ×
          </button>
        </header>

        {error && <p className="modal-error">{error}</p>}

        <div className="np-intro">
          <span className="np-intro-step">1</span>
          <div>
            <strong>
              {t(
                'Nommez le projet et sa première mission',
                'Name the project and its first mission',
              )}
            </strong>
            <p>
              {t(
                'Hive crée le projet, confie la mission à un agent, puis vous rend la production à valider.',
                'Hive creates the project, assigns the mission to an agent, then returns the output for your approval.',
              )}
            </p>
          </div>
        </div>

        <label className="field">
          <span>{t('Nom du projet', 'Project name')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Mon SaaS', 'My SaaS')}
            autoFocus
            disabled={busy || planning}
          />
        </label>

        <label className="field">
          <span>{t('Dépôt git (optionnel)', 'Git repository (optional)')}</span>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder={t(
              'https://github.com/moi/projet.git',
              'https://github.com/me/project.git',
            )}
            disabled={busy || planning}
          />
        </label>

        <label className="field">
          <span>{t('Première mission', 'First mission')}</span>
          <textarea
            className="code-input"
            rows={4}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={t(
              'Ex : crée une page d’accueil accessible, responsive et couverte par des tests.',
              'E.g. build an accessible, responsive landing page covered by tests.',
            )}
            disabled={busy || planning}
          />
          <div className="template-row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => void generate()}
              disabled={busy || planning || !brief.trim()}
            >
              {planning
                ? t('Génération…', 'Generating…')
                : t('Découper avec la Reine', 'Break down with the Queen')}
            </button>
            {planNote && <span className="plan-note">{planNote}</span>}
          </div>
        </label>

        <div className="np-advanced">
          <button
            type="button"
            className="np-advanced-toggle"
            aria-expanded={advanced}
            aria-controls="np-advanced-content"
            onClick={() => setAdvanced((v) => !v)}
            disabled={busy || planning}
          >
            <span>{t('Options avancées', 'Advanced options')}</span>
            <span aria-hidden="true">{advanced ? '−' : '+'}</span>
          </button>
          {advanced && (
            <div id="np-advanced-content" className="np-advanced-content">
              <p>
                {t(
                  'Pour un travail complexe : choisissez un modèle ou éditez directement le graphe de tâches.',
                  'For complex work: choose a template or directly edit the task graph.',
                )}
              </p>
              <div className="template-row np-templates">
                <span className="template-label">{t('Modèles :', 'Templates:')}</span>
                {templates.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    className="chip"
                    onClick={() => setTasksJson(j(tpl.tasks))}
                    disabled={busy || planning}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>{t('Graphe de tâches (JSON)', 'Task graph (JSON)')}</span>
                <textarea
                  className="code-input"
                  rows={10}
                  value={tasksJson}
                  onChange={(e) => setTasksJson(e.target.value)}
                  spellCheck={false}
                  disabled={busy || planning}
                />
              </label>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={closeIfIdle}
            disabled={busy || planning}
          >
            {t('Annuler', 'Cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy || planning}
          >
            {busy ? t('Création…', 'Creating…') : t('Créer le projet', 'Create project')}
          </button>
        </div>
      </div>
    </Voile>
  );
}
