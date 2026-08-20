// OpenAlexPanel — moteur de recherche scientifique intégré à HIVE.
// Interroge l'API OpenAlex (proxy backend) et affiche les articles dans le
// design system « ruche ».

import { useState, useCallback, useRef } from 'react';
import { useT, t as tStatic } from './i18n';
import type { Translate } from './i18n';
import { useDialog, Voile } from './ui';

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

/** Libellé de type OpenAlex — texte seul, sans emoji (t injecté au rendu). */
function paperBadge(type: string, t: Translate): { label: string } {
  switch (type) {
    case 'journal-article':
      return { label: t('Article', 'Article') };
    case 'book':
      return { label: t('Livre', 'Book') };
    case 'book-chapter':
      return { label: t('Chapitre', 'Chapter') };
    case 'preprint':
      return { label: t('Preprint', 'Preprint') };
    case 'dissertation':
      return { label: t('Thèse', 'Thesis') };
    case 'dataset':
      return { label: t('Dataset', 'Dataset') };
    default:
      return { label: type };
  }
}

export function OpenAlexPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
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
        // tStatic (non réactif) : dans un useCallback à dépendances vides, un
        // `t` de rendu serait figé sur la langue du premier rendu.
        throw new Error(
          (body as { error?: string }).error ??
            tStatic(`Erreur ${res.status}`, `Error ${res.status}`),
        );
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

  // Échap ferme, et le focus revient d'où il venait — comme les quatre autres
  // overlays. C'était le seul à ne pas répondre à la touche : une modale qui se
  // ferme autrement que ses voisines s'apprend deux fois.
  const dialogRef = useDialog<HTMLDivElement>(onClose, inputRef);

  const nextPage = () => search(query, page + 1);
  const prevPage = () => search(query, Math.max(1, page - 1));
  const totalPages = Math.ceil(total / 20);

  return (
    <Voile onClose={onClose}>
      <div
        className="modal wide openalex-panel"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="oa-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="oa-title">
            <span className="marque" aria-hidden="true" />{' '}
            {t('OpenAlex — Moteur scientifique', 'OpenAlex — Scientific search engine')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label={t('Fermer', 'Close')}>
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
            placeholder={t(
              'Rechercher un article, un auteur, un concept… (ex: transformer attention mechanism, CRISPR, dark matter)',
              'Search for a paper, an author, a concept… (e.g. transformer attention mechanism, CRISPR, dark matter)',
            )}
          />
          {loading && (
            <span className="openalex-spinner">{t('Recherche en cours…', 'Searching…')}</span>
          )}
        </div>

        {error && <p className="modal-error">{error}</p>}

        {total > 0 && (
          <p className="openalex-count">
            {total.toLocaleString()} {t('résultat', 'result')}
            {total > 1 ? 's' : ''}
            {totalPages > 1 && ` — page ${page}/${totalPages}`}
          </p>
        )}

        <div className="openalex-results">
          {papers.map((paper) => {
            const badge = paperBadge(paper.type, t);
            return (
              <article key={paper.id} className="openalex-card">
                <div className="oa-card-head">
                  <span className="oa-badge" title={badge.label}>
                    {badge.label}
                  </span>
                  {paper.year && <span className="oa-year">{paper.year}</span>}
                  {paper.openAccess && <span className="oa-oa">OA</span>}
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
                    {paper.citedBy.toLocaleString()} citation{paper.citedBy > 1 ? 's' : ''}
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
            <button className="btn ghost" onClick={prevPage} disabled={page <= 1 || loading}>
              {t('← Précédent', '← Previous')}
            </button>
            <span className="oa-pager">
              Page {page} / {totalPages}
            </span>
            <button
              className="btn ghost"
              onClick={nextPage}
              disabled={page >= totalPages || loading}
            >
              {t('Suivant →', 'Next →')}
            </button>
          </div>
        )}
      </div>
    </Voile>
  );
}
