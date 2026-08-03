// Panneau des nœuds : une carte par machine membre, avec charge, agent — et
// la MACHINE elle-même (🪟/🍎/🐧), déclarée par le nœud à l'inscription.
//
// ─── LA FICHE COÉQUIPIÈRE (mission « Le Poste », lot 2) ──────────────────────
//
// Chaque ouvrière se présente comme une COÉQUIPIÈRE, pas comme une ligne de
// monitoring : cliquer sa carte ouvre sa fiche — qui elle est (machine, agent,
// hôte), ce qu'elle porte (charge), et SES MISSIONS — les tâches qu'elle a
// butinées ou qu'elle butine, cliquables vers le tiroir de tâche, qui montre
// le diff et les logs. C'est l'entrée par ouvrière vers ce que la ruche sait
// déjà montrer par tâche.
//
// La fiche ne s'offre que si l'appelant fournit les tâches et le geste
// d'ouverture : les rendus qui n'ont que les nœuds gardent le panneau d'avant.

import { useState } from 'react';
import { PICTO_PLATEFORME } from '../../src/shared/machine';
import type { HiveNode, Task } from '../../src/shared/types';
import { useT } from './i18n';
import { activateProps, ProgressBar, STATUS_ICON } from './ui';

const AGENT_ICON: Record<string, string> = {
  shell: '🐚',
  'claude-code': '✦',
  codex: '⌗',
};

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Les missions d'UNE ouvrière : celles qu'elle porte (assignées/en cours) et
 * celles qu'elle a rendues (le résultat porte son nom, même si la tâche a été
 * réassignée depuis). Les plus récentes d'abord.
 */
function missionsDe(noeud: HiveNode, tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.assignedNodeId === noeud.id || t.result?.nodeId === noeud.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function FicheOuvriere({
  noeud,
  tasks,
  onOpenTask,
  onClose,
}: {
  noeud: HiveNode;
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const missions = missionsDe(noeud, tasks);
  const butinees = missions.filter((m) => m.status === 'done').length;
  const echouees = missions.filter((m) => m.status === 'failed').length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fiche-ouvriere-titre"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="fiche-ouvriere-titre">
            {AGENT_ICON[noeud.agentType] ?? '•'} {noeud.name}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label={t('Fermer', 'Close')}>
            ×
          </button>
        </header>

        <p className="fo-identite">
          {t('Chez', 'At')} {noeud.ownerName} · {noeud.agentType}
          {noeud.plateforme && (
            <span className="node-plateforme" title={noeud.plateforme}>
              {' '}
              · {PICTO_PLATEFORME[noeud.plateforme]} {noeud.plateforme}
            </span>
          )}
          {' · '}
          {noeud.status === 'online' ? t('en ligne', 'online') : t('hors ligne', 'offline')} ·{' '}
          {noeud.running}/{noeud.maxConcurrency} {t('en vol', 'in flight')}
        </p>

        <h3 className="fo-sous-titre">
          {t('Ses missions', 'Their missions')}{' '}
          <span className="panel-count">
            ✔ {butinees} · ✘ {echouees}
          </span>
        </h3>
        {missions.length === 0 ? (
          <p className="muted-text">
            {t(
              'Aucune mission encore — cette ouvrière n’a rien butiné pour l’instant.',
              'No mission yet — this worker has not foraged anything so far.',
            )}
          </p>
        ) : (
          <ul className="queue fo-missions">
            {missions.slice(0, 8).map((m) => (
              <li key={m.id} className="fo-mission" {...activateProps(() => onOpenTask(m.id))}>
                <span aria-hidden="true">{STATUS_ICON[m.status]}</span> {m.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function NodesPanel({
  nodes,
  tasks,
  onOpenTask,
}: {
  nodes: HiveNode[];
  /** Fournies : les cartes deviennent cliquables et ouvrent la fiche. */
  tasks?: Task[];
  onOpenTask?: (id: string) => void;
}) {
  const t = useT();
  const online = nodes.filter((n) => n.status === 'online').length;
  const [ouverte, setOuverte] = useState<string | null>(null);
  const fiche =
    tasks && onOpenTask && ouverte ? (nodes.find((n) => n.id === ouverte) ?? null) : null;

  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>{t('Nœuds', 'Nodes')}</h2>
        <span className="panel-count">
          {online}/{nodes.length} {t('en ligne', 'online')}
        </span>
      </header>
      <ul className="node-list">
        {nodes.map((n) => (
          <li
            key={n.id}
            className={`node-card ${n.status}`}
            {...(tasks && onOpenTask ? activateProps(() => setOuverte(n.id)) : {})}
          >
            <div className="node-avatar" title={n.agentType}>
              {initials(n.name)}
              <span className="node-agent">{AGENT_ICON[n.agentType] ?? '•'}</span>
            </div>
            <div className="node-body">
              <div className="nc-name">
                {n.name}
                <span className={`dot ${n.status}`} title={n.status} />
              </div>
              <div className="node-meta">
                {n.ownerName} · {n.agentType}
                {/* La machine derrière l'ouvrière — « quelles ouvrières
                    tournent sous Windows ? » se lit ici, pas dans un log.
                    Absente (nœud d'une version antérieure) : rien, plutôt
                    qu'une plateforme inventée. */}
                {n.plateforme && (
                  <span className="node-plateforme" title={n.plateforme}>
                    {' '}
                    · {PICTO_PLATEFORME[n.plateforme]} {n.plateforme}
                  </span>
                )}
              </div>
              <ProgressBar value={n.running} max={Math.max(n.maxConcurrency, 1)} />
            </div>
            <div className="node-load">
              {n.running}/{n.maxConcurrency}
            </div>
          </li>
        ))}
        {nodes.length === 0 && (
          <li className="empty">
            {t(
              'Aucun nœud n’a rejoint la ruche. Cliquez « Inviter un ami » pour en connecter un.',
              'No node has joined the hive yet. Click “Invite a friend” to connect one.',
            )}
          </li>
        )}
      </ul>

      {fiche && tasks && onOpenTask && (
        <FicheOuvriere
          noeud={fiche}
          tasks={tasks}
          onOpenTask={(id) => {
            // Ouvrir le tiroir FERME la fiche : deux surfaces modales empilées
            // se disputeraient le clavier et l'attention.
            setOuverte(null);
            onOpenTask(id);
          }}
          onClose={() => setOuverte(null)}
        />
      )}
    </section>
  );
}
