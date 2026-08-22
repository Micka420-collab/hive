// OpenAlex runtime — extrait littérature pour prompts Reine / planner / tâches.
//
// Réutilise la même politique que GET /api/openalex/search (pas de clé, email polite).

export interface ExtraitOpenAlex {
  titre: string;
  annee: number | null;
  citations: number;
  doi: string | null;
}

export interface SnippetVeilleOpenAlex {
  requete: string;
  extraits: ExtraitOpenAlex[];
  texte: string;
}

function agentOpenAlex(env: NodeJS.ProcessEnv): string {
  const email = (env.OPENALEX_EMAIL ?? '').trim();
  return email === '' ? 'Hive/0.1' : `Hive/0.1 (mailto:${email})`;
}

/**
 * Interroge OpenAlex et formate un bloc court pour injection dans un prompt.
 * Retourne `null` si la requête est trop courte, l'API échoue, ou aucun résultat.
 */
export async function snippetOpenAlexPourBrief(
  brief: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: { limit?: number; fetchFn?: typeof fetch } = {},
): Promise<SnippetVeilleOpenAlex | null> {
  const terms = brief
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 8)
    .join(' ');
  if (terms.length < 4) return null;

  const fetchFn = opts.fetchFn ?? fetch;
  const limit = opts.limit ?? 3;
  const params = new URLSearchParams({
    search: terms,
    sort: 'cited_by_count:desc',
    per_page: String(Math.min(limit, 5)),
  });

  try {
    const res = await fetchFn(`https://api.openalex.org/works?${params}`, {
      headers: { 'User-Agent': agentOpenAlex(env) },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    const raw = data.results ?? [];
    if (raw.length === 0) return null;

    const extraits: ExtraitOpenAlex[] = raw.slice(0, limit).map((w) => ({
      titre: String(w.title ?? 'Sans titre').slice(0, 200),
      annee: typeof w.publication_year === 'number' ? w.publication_year : null,
      citations: typeof w.cited_by_count === 'number' ? w.cited_by_count : 0,
      doi:
        typeof w.doi === 'string'
          ? w.doi.replace(/^https?:\/\/doi\.org\//i, '')
          : null,
    }));

    const lignes = extraits.map(
      (e, i) =>
        `${i + 1}. ${e.titre}${e.annee ? ` (${e.annee})` : ''}` +
        `${e.citations ? ` — ${e.citations} cit.` : ''}` +
        `${e.doi ? ` [doi:${e.doi}]` : ''}`,
    );
    const texte = [
      'LITTÉRATURE OpenAlex (top citations, à citer si pertinent) :',
      ...lignes,
      'Ne pas réimplémenter sans avoir comparé à l’état de l’art.',
    ].join('\n');

    return { requete: terms, extraits, texte };
  } catch {
    return null;
  }
}
