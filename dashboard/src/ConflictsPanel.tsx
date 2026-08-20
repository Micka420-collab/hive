// Panneau Sting Detector : conflits potentiels entre tâches (par projet).
// Masqué tant qu'il n'y a aucun conflit. Se rafraîchit sur les events pertinents.

import { useEffect, useState } from 'react';
import { fetchConflicts } from './api';
import type { Conflict } from './api';
import { useT } from './i18n';
import type { Project, Task } from '../../src/shared/types';

interface Entry {
  projectId: string;
  conflict: Conflict;
}

export function ConflictsPanel({
  projects,
  tasks,
  refreshKey,
}: {
  projects: Project[];
  tasks: Task[];
  refreshKey: number;
}) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      projects.map((p) =>
        fetchConflicts(p.id).then(
          (r) => r.conflicts.map((conflict) => ({ projectId: p.id, conflict })),
          () => [] as Entry[],
        ),
      ),
    ).then((lists) => {
      if (!cancelled) setEntries(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, projects.length]);

  if (entries.length === 0) return null; // rien à signaler → panneau masqué

  const titleOf = (id: string): string => tasks.find((t) => t.id === id)?.title ?? id.slice(0, 8);

  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>
          <span className="marque" aria-hidden="true" /> {t('Conflits', 'Conflicts')}
        </h2>
        <span className="panel-count warn">{entries.length}</span>
      </header>
      <ul className="conflict-list">
        {entries.slice(0, 10).map(({ conflict }, i) => (
          <li key={i} className={`conflict-item ${conflict.severity}`}>
            <span className="conflict-sev">{conflict.severity === 'high' ? '⚠' : '·'}</span>
            <span className="conflict-pair">
              {titleOf(conflict.a)} ↔ {titleOf(conflict.b)}
            </span>
            {conflict.sharedPaths.length > 0 && (
              <span className="conflict-detail">{conflict.sharedPaths[0]}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
