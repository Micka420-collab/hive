// Tiroir latéral : détail complet d'une tâche + son résultat (diff/logs) pour
// revue humaine, avec possibilité d'annuler une tâche en cours.

import { lazy, Suspense, useEffect, useState } from 'react';
import { cancelTask, fetchRace, fetchResults, raceTask } from './api';
import type { DroneRace, RaceVictory } from './api';
import type { HiveNode, Task, TaskResult } from '../../src/shared/types';
import { useLang, useT } from './i18n';
import { formatMs, StatusBadge, useDialog } from './ui';
import { direAnnonce, direDuree } from '../../src/shared/horloge-chantier';
import { verdictAnnonce } from './horloge-vue';
import type { VueHorloge } from './horloge-vue';

// L'éditeur (CodeMirror) est chargé à la demande — pesant seulement quand on
// ouvre le tiroir d'une tâche.
const CodeEditor = lazy(() => import('./CodeEditor'));

interface Props {
  task: Task;
  nodes: HiveNode[];
  /**
   * Ce que la ruche avait annoncé pour CETTE tâche, replié du journal.
   *
   * Optionnel, et il faut qu'il le reste : le journal est élagué, donc une
   * tâche assez vieille n'a plus son annonce. On n'affiche alors rien — mieux
   * qu'un « — » qui laisserait croire que la ruche n'avait rien annoncé.
   */
  horloge?: VueHorloge;
  onClose: () => void;
}

export function TaskDrawer({ task, nodes, horloge, onClose }: Props) {
  const t = useT();
  const lang = useLang();
  const [results, setResults] = useState<TaskResult[] | null>(null);
  const [tab, setTab] = useState<'diff' | 'logs'>('diff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raced, setRaced] = useState<number | null>(null);
  const [race, setRace] = useState<DroneRace | null>(null);
  const [victory, setVictory] = useState<RaceVictory | null>(null);
  const [editable, setEditable] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useDialog<HTMLElement>(onClose);

  // Calculé ici et pas dans le JSX : le rendu ci-dessous s'en sert deux fois
  // (choix du bloc, puis choix de la phrase), et deux appels pourraient
  // diverger si l'un des deux oubliait un argument.
  const verdict = verdictAnnonce(horloge?.annonce, task.result?.durationMs ?? -1);
  // Le plafond sorti de l'optionnel : `verdict !== 'sans_objet'` IMPLIQUE qu'il
  // existe, mais le compilateur ne peut pas le savoir — et le lui affirmer avec
  // un `!` échangerait une vérification contre une promesse. Le rendu teste les
  // deux, ce qui coûte une comparaison et ne peut pas mentir.
  const plafondMs = horloge?.annonce?.p80Ms;

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

  // Drone Wars : une course est-elle en vol sur cette tâche ? (lecture à
  // l'ouverture et au changement de statut — pas de polling, les événements
  // WS re-rendent le tiroir via le snapshot).
  useEffect(() => {
    let alive = true;
    setRace(null);
    setVictory(null);
    // En vol : montrer la course. Terminée : montrer le vainqueur éventuel
    // (reconstruit côté serveur depuis le journal — la course n'est plus en
    // mémoire une fois tranchée).
    if (task.status === 'assigned' || task.status === 'running' || task.status === 'done') {
      fetchRace(task.id)
        .then((r) => {
          if (!alive) return;
          setRace(r.race);
          setVictory(r.victory ?? null);
        })
        .catch(() => alive && setRace(null));
    }
    return () => {
      alive = false;
    };
  }, [task.id, task.status]);

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
          {horloge?.annonce && (
            <>
              <dt>{t('Annoncé', 'Announced')}</dt>
              <dd className="horloge-annonce">{direAnnonce(horloge.annonce, lang)}</dd>
            </>
          )}
          <dt>{t('Dépendances', 'Dependencies')}</dt>
          <dd>{task.dependsOn.length > 0 ? task.dependsOn.length : t('aucune', 'none')}</dd>
          <dt>ID</dt>
          <dd className="mono">{task.id}</dd>
        </dl>

        {race && !race.decided && (
          <p className="muted-text" title={t('Course de drones en vol', 'Drone race in flight')}>
            {t(
              `Course en vol : ${race.drones.filter((d) => d.status === 'running').length} drone(s) sur ${race.drones.length} — le premier succès gagne.`,
              `Race in flight: ${race.drones.filter((d) => d.status === 'running').length} drone(s) of ${race.drones.length} — first success wins.`,
            )}
          </p>
        )}
        {task.status === 'done' && victory && (
          <p className="muted-text" title={t('Course de drones gagnée', 'Drone race won')}>
            {(() => {
              const name =
                nodes.find((n) => n.id === victory.nodeId)?.name ??
                `${victory.nodeId.slice(0, 8)}…`;
              return t(
                `Gagnée en course de drones par ${name}` +
                  (victory.cancelled > 0
                    ? ` — ${victory.cancelled} concurrent(s) annulé(s).`
                    : '.'),
                `Won in a drone race by ${name}` +
                  (victory.cancelled > 0
                    ? ` — ${victory.cancelled} competitor(s) cancelled.`
                    : '.'),
              );
            })()}
          </p>
        )}

        {horloge?.horsDomaine && (
          <p className="horloge-alerte" role="status">
            {t(
              `Sortie du domaine connu après ${direDuree(horloge.horsDomaine.ecouleMs, 'fr')} — plus longue que tout ce que la ruche avait observé (record : ${direDuree(horloge.horsDomaine.recordMs, 'fr')}).`,
              `Out of the known domain after ${direDuree(horloge.horsDomaine.ecouleMs, 'en')} — longer than anything the hive had observed (record: ${direDuree(horloge.horsDomaine.recordMs, 'en')}).`,
            )}
          </p>
        )}
        {/*
          L'ANNONCE, CONFRONTÉE AU RÉEL.

          C'est la seule ligne de cet écran qui rende l'horloge réfutable : sans
          elle, une annonce est un chiffre que personne ne repasse jamais, donc
          un chiffre qu'on peut se permettre de faire n'importe comment. Avec
          elle, chaque tâche finie porte publiquement le résultat du pari.

          `sans_objet` n'est PAS affiché : sur socle « aucun », la ruche a dit
          « je ne sais pas encore ». Rendre un verdict là-dessus noterait comme
          un échec le fait d'avoir refusé de chiffrer.
        */}
        {task.result && verdict !== 'sans_objet' && plafondMs !== undefined && (
          <p className={`horloge-verdict ${verdict}`} role="status">
            {verdict === 'tenue'
              ? t(
                  `Annonce tenue : ${direDuree(task.result.durationMs, 'fr')} pour un plafond annoncé de ${direDuree(plafondMs, 'fr')}.`,
                  `Announcement held: ${direDuree(task.result.durationMs, 'en')} against an announced ceiling of ${direDuree(plafondMs, 'en')}.`,
                )
              : t(
                  `Annonce débordée : ${direDuree(task.result.durationMs, 'fr')} pour un plafond annoncé de ${direDuree(plafondMs, 'fr')}. Une annonce sur cinq est censée déborder — c'est leur RÉPÉTITION qui accuse l'horloge, pas celle-ci.`,
                  `Announcement overrun: ${direDuree(task.result.durationMs, 'en')} against an announced ceiling of ${direDuree(plafondMs, 'en')}. One announcement in five is meant to overrun — it is their REPETITION that indicts the clock, not this one.`,
                )}
          </p>
        )}

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
              : t('Course de drones (3 nœuds)', 'Drone race (3 nodes)')}
          </button>
        )}
        {raced !== null && task.status !== 'done' && task.status !== 'failed' && (
          <p className="muted-text">
            {t('Course lancée :', 'Race launched:')} {raced}{' '}
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
