// Panneau Hive Mind : recherche dans la mémoire partagée et souvenirs récents.
// Se rafraîchit à chaque nouveau souvenir (refreshKey piloté par les events).

import { useEffect, useState } from 'react';
import { fetchMemories } from './api';
import type { Memory } from './api';

export function HiveMindPanel({ refreshKey }: { refreshKey: number }) {
  const [q, setQ] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = (query: string): void => {
    fetchMemories(query)
      .then((r) => {
        setMemories(r.memories);
        setTotal(r.total);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  // Montage + arrivée d'un nouveau souvenir : recharge en conservant la recherche.
  useEffect(() => {
    load(q);
  }, [refreshKey]);

  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>🧬 Hive Mind</h2>
        <span className="panel-count">{total}</span>
      </header>
      <form
        className="mind-search"
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
      >
        <input
          type="text"
          placeholder="rechercher un savoir…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      {error && <p className="panel-error">{error}</p>}
      <ul className="mind-list">
        {memories.map((m) => (
          <li key={m.id} className="mind-item">
            <span className="mind-title">
              {m.title}
              {m.score !== null && <em className="mind-score"> · {m.score}</em>}
            </span>
            <span className="mind-content">{m.content.slice(0, 120)}</span>
          </li>
        ))}
        {memories.length === 0 && !error && (
          <li className="empty">
            Aucun souvenir — la mémoire se remplit quand des tâches réussissent.
          </li>
        )}
      </ul>
    </section>
  );
}
