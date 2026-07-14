// OpenAlexPanel — moteur de recherche scientifique intégré à HIVE.
// Interroge l'API OpenAlex (proxy backend) et affiche les articles dans le
// design system « ruche ».

import { useState, useCallback, useRef } from 'react';

/** Résultat formaté renvoyé par le backend. */
interface Paper {
  id: string;
  title: string;
  doi: string | null;
  year: number | null;
  citedBy: number;
  authors: string[];
  abstract: string | null;
  type: string;
  openAccess: boolean;
  url: string | null;
}

interface SearchResponse {
  total: number;
  page: number;
  perPage: number;
  results: Paper[];
}

/** Reconstitue le DOI en URL cliquable. */
function doiUrl(doi: string): string {
  return doi.startsWith('https://') ? doi : `https://doi.org/${doi}`;
}

/** Traduit le type OpenAlex en emoji + libellé. */
function paperBadge(type: string): { emoji: string; label: string } {
  switch (type) {
    case 'journal-article':
      return { emoji: '📄', label: 'Article' };
    case 'book':
      return { emoji: '📘', label: 'Livre' };
    case 'book-chapter':
      return { emoji: '📑', label: 'Chapitre' };
    case 'preprint':
      return { emoji: '🚀', label: 'Preprint' };
    case 'dissertation':
      return { emoji: '🎓', label: 'Thèse' };
    case 'dataset':
      return { emoji: '📊', label: 'Dataset' };
    default:
      return { emoji: '📚', label: type };
  }
}

export function OpenAlexPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string, p = 1) => {
    if (q.length < 2) {
      setPapers([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, page: String(p) });
      const res = await fetch(`/api/openalex/search?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as SearchResponse;
      setPapers(data.results);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const onInput = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(value), 400);
    },
    [search],
  );

  const nextPage = () => search(query, page + 1);
  const prevPage = () => search(query, Math.max(1, page - 1));
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide openalex-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oa-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="oa-title">🧬 OpenAlex — Moteur scientifique</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <div className="openalex-search">
          <input
            ref={inputRef}
            type="text"
            className="openalex-input"
            value={query}
            onChange={(e) => onInput(e.target.value)}
            placeholder="Rechercher un article, un auteur, un concept… (ex: transformer attention mechanism, CRISPR, dark matter)"
            autoFocus
          />
          {loading && <span className="openalex-spinner">🔍 Recherche en cours…</span>}
        </div>

        {error && <p className="modal-error">{error}</p>}

        {total > 0 && (
          <p className="openalex-count">
            {total.toLocaleString()} résultat{total > 1 ? 's' : ''}
            {totalPages > 1 && ` — page ${page}/${totalPages}`}
          </p>
        )}

        <div className="openalex-results">
          {papers.map((paper) => {
            const badge = paperBadge(paper.type);
            return (
              <article key={paper.id} className="openalex-card">
                <div className="oa-card-head">
                  <span className="oa-badge" title={badge.label}>
                    {badge.emoji} {badge.label}
                  </span>
                  {paper.year && <span className="oa-year">{paper.year}</span>}
                  {paper.openAccess && <span className="oa-oa">🔓 OA</span>}
                </div>
                <h3 className="oa-title">
                  <a
                    href={paper.url ?? (paper.doi ? doiUrl(paper.doi) : '#')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {paper.title}
                  </a>
                </h3>
                {paper.authors.length > 0 && (
                  <p className="oa-authors">{paper.authors.join(', ')}</p>
                )}
                {paper.abstract && (
                  <p className="oa-abstract">
                    {paper.abstract}
                    {paper.abstract.length >= 500 ? '…' : ''}
                  </p>
                )}
                <div className="oa-card-foot">
                  <span className="oa-citations">
                    📊 {paper.citedBy.toLocaleString()} citation{paper.citedBy > 1 ? 's' : ''}
                  </span>
                  {paper.doi && (
                    <a
                      className="oa-doi"
                      href={doiUrl(paper.doi)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {paper.doi.replace('https://doi.org/', '')}
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="modal-actions">
            <button
              className="btn ghost"
              onClick={prevPage}
              disabled={page <= 1 || loading}
            >
              ← Précédent
            </button>
            <span className="oa-pager">
              Page {page} / {totalPages}
            </span>
            <button
              className="btn ghost"
              onClick={nextPage}
              disabled={page >= totalPages || loading}
            >
              Suivant →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}