// Vue Mémoire : le Hive Mind — ce que la ruche a retenu de ses butinages —
// avec recherche au submit, souvenirs récents en repli, et la bibliothèque
// scientifique OpenAlex en modale (onglet secondaire).

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { fetchMemories } from '../api';
import type { Memory } from '../api';
import { useT } from '../i18n';
import { OpenAlexPanel } from '../OpenAlexPanel';
import { timeShort, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import './chronique.css';

/** Longueur au-delà de laquelle le contenu est replié derrière un <details>. */
const SHORT_LEN = 200;

interface SearchPage {
  q: string;
  total: number;
  memories: Memory[];
}

export default function Memoire({ snapshot, onOpenTask, refreshTick }: ViewProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showOpenAlex, setShowOpenAlex] = useState(false);

  // Souvenirs récents (repli sans recherche active) — 60 s, jamais moins.
  const recent = useApiPoll(() => fetchMemories(), 60_000, refreshTick);

  // Ids des tâches encore présentes dans le snapshot (lien cliquable sinon éteint).
  const taskIds = useMemo(() => new Set(snapshot.tasks.map((t) => t.id)), [snapshot.tasks]);

  // Recherche au submit / Entrée uniquement — pas de requête à chaque frappe.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setSearch(null);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    fetchMemories(q, 12)
      .then((r) => setSearch({ q, ...r }))
      .catch((err: unknown) => setSearchError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSearching(false));
  };

  const clearSearch = () => {
    setSearch(null);
    setSearchError(null);
    setQuery('');
  };

  const page = search ?? recent.data;
  const memories = page?.memories ?? [];
  const total = page?.total ?? null;
  const error = searchError ?? (search ? null : recent.error);

  return (
    <div className="mc-view ch-view ch-memoire">
      <section className="card panel ch-mem-panel">
        <header className="panel-head">
          <h2>
            <span className="marque" aria-hidden="true" /> Hive Mind
          </h2>
          <span className="panel-count">
            {total === null
              ? t('la ruche fouille ses rayons…', 'the hive is searching its honeycombs…')
              : t(
                  `la ruche se souvient de ${total} chose${total === 1 ? '' : 's'}`,
                  `the hive remembers ${total} thing${total === 1 ? '' : 's'}`,
                )}
          </span>
          <div className="drawer-tabs ch-mem-tabs" role="group" aria-label="Sections">
            <button type="button" className="active">
              {t('Souvenirs', 'Memories')}
            </button>
            <button type="button" onClick={() => setShowOpenAlex(true)}>
              OpenAlex
            </button>
          </div>
        </header>

        <form className="mind-search ch-mem-search" onSubmit={onSubmit} role="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(
              'Butiner les souvenirs… (Entrée pour chercher)',
              'Forage the memories… (Enter to search)',
            )}
            aria-label={t('Rechercher un souvenir', 'Search for a memory')}
          />
          <button className="btn" type="submit" disabled={searching}>
            {searching ? '…' : t('Chercher', 'Search')}
          </button>
        </form>

        {search && (
          <p className="ch-mem-note muted-text">
            {t(
              `${search.memories.length} souvenir${search.memories.length === 1 ? '' : 's'} pour « ${search.q} »`,
              `${search.memories.length} ${search.memories.length === 1 ? 'memory' : 'memories'} for “${search.q}”`,
            )}{' '}
            —{' '}
            <button type="button" className="ch-linklike" onClick={clearSearch}>
              {t('revenir aux récents', 'back to recent')}
            </button>
          </p>
        )}
        {error && <p className="panel-error ch-mem-note">{error}</p>}

        <ul className="ch-mem-list">
          {memories.map((m) => (
            <li key={m.id} className="mind-item ch-mem-item">
              <div className="ch-mem-head">
                <span className="mind-title">{m.title}</span>
                {m.score !== null && (
                  <span className="mind-score" title={t('Score de pertinence', 'Relevance score')}>
                    [{Number.isInteger(m.score) ? m.score : m.score.toFixed(2)}]
                  </span>
                )}
              </div>
              {m.content.length > SHORT_LEN ? (
                <details className="ch-mem-details">
                  <summary className="mind-content">
                    <span className="ch-mem-preview">{m.content.slice(0, SHORT_LEN)}… </span>
                    <span className="ch-mem-more ch-mem-more-closed">
                      {t('(tout voir)', '(show all)')}
                    </span>
                    <span className="ch-mem-more ch-mem-more-open">
                      {t('(replier)', '(collapse)')}
                    </span>
                  </summary>
                  <p className="mind-content">{m.content}</p>
                </details>
              ) : (
                <p className="mind-content">{m.content}</p>
              )}
              <div className="ch-mem-foot">
                <time className="jtime">{timeShort(m.createdAt)}</time>
                {taskIds.has(m.taskId) ? (
                  <button
                    type="button"
                    className="ch-mem-task mono"
                    onClick={() => onOpenTask(m.taskId)}
                    title={t('Ouvrir la tâche d’origine', 'Open the originating task')}
                  >
                    {m.taskId.slice(0, 8)}
                  </button>
                ) : (
                  <span
                    className="ch-mem-task mono ch-gone"
                    title={t('Tâche absente du snapshot', 'Task absent from the snapshot')}
                  >
                    {m.taskId.slice(0, 8)}
                  </span>
                )}
              </div>
            </li>
          ))}
          {memories.length === 0 && (
            <li className="empty pad">
              <span className="marque" aria-hidden="true" />{' '}
              {search
                ? t(
                    'Aucun souvenir ne correspond à cette recherche.',
                    'No memory matches this search.',
                  )
                : t('La ruche n’a encore rien retenu.', 'The hive has not retained anything yet.')}
            </li>
          )}
        </ul>
      </section>

      {showOpenAlex && <OpenAlexPanel onClose={() => setShowOpenAlex(false)} />}
    </div>
  );
}
