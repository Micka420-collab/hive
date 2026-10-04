// LE PLAN DE MERGE HONEYCOMB ET LES CONFLITS STING — les deux panneaux
// dépliables sous les actions d'une carte projet. Sortis de `Projets.tsx` tels
// quels : ils ne partagent rien avec la carte, sauf le projet qu'elle porte.

import { useState } from 'react';
import { fetchConflicts, fetchMergePlan, runMerge } from '../../api';
import { useT } from '../../i18n';
import { EchecSondage, useApiPoll } from '../shared';
import { argv, useSuiviMerge } from '../suivi-merge';
import { MergeReport } from '../MergeReport';
import type { Project } from '../../../../src/shared/types';
import '../projets.css';

// ─── Plan de merge Honeycomb : analyse + exécution réelle suivie ─────────────

/** Suivi d'une action utilisateur (cf. `useSuiviMerge`), borné à 2 min. */
const MERGE_TIMEOUT_MS = 120_000;

export function MergePanel({
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
  // Suivi du merge lancé : relevé toutes les 3 s, abandon après 2 min.
  const { suivi: run, lancer } = useSuiviMerge(project.id, MERGE_TIMEOUT_MS);
  const busyRun = run.phase === 'starting' || run.phase === 'polling';

  const launch = () => {
    setConfirming(false);
    lancer(() =>
      runMerge(project.id, { testCommand: argv(testCmd), prepareCommand: argv(prepCmd) }),
    );
  };

  return (
    <section className="pj-sub">
      <header className="pj-sub-head">
        <h4>{t('Plan de merge Honeycomb', 'Honeycomb merge plan')}</h4>
        {plan && (
          <span className={`pj-verdict ${plan.mergeable ? 'ok' : 'ko'}`}>
            {plan.mergeable
              ? t('✔ intégrable', '✔ mergeable')
              : t('pas encore intégrable', 'not mergeable yet')}
          </span>
        )}
      </header>
      <EchecSondage sondage={planPoll} avant={t('Plan indisponible :', 'Plan unavailable:')} />
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

export function ConflictsPanel({
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
      <EchecSondage
        sondage={poll}
        avant={t('Détection indisponible :', 'Detection unavailable:')}
      />
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
                  ? t('sévérité haute', 'high severity')
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
