// Panneau des nœuds : une carte par machine membre, avec charge, agent — et
// la MACHINE elle-même (🪟/🍎/🐧), déclarée par le nœud à l'inscription.

import { PICTO_PLATEFORME } from '../../src/shared/machine';
import type { HiveNode } from '../../src/shared/types';
import { useT } from './i18n';
import { ProgressBar } from './ui';

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

export function NodesPanel({ nodes }: { nodes: HiveNode[] }) {
  const t = useT();
  const online = nodes.filter((n) => n.status === 'online').length;
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
          <li key={n.id} className={`node-card ${n.status}`}>
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
    </section>
  );
}
