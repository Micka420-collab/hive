import { describe, expect, it } from 'vitest';
import { snippetOpenAlexPourBrief } from '../src/orchestrator/openalex-veille.js';

describe('openalex-veille', () => {
  it('retourne null si brief trop court', async () => {
    expect(await snippetOpenAlexPourBrief('ab', {})).toBeNull();
  });

  it('formate un snippet quand l’API répond', async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Deep learning survey',
              publication_year: 2020,
              cited_by_count: 100,
              doi: 'https://doi.org/10.1234/x',
            },
          ],
        }),
      }) as Response;

    const s = await snippetOpenAlexPourBrief(
      'recherche deep learning state of the art',
      {},
      { fetchFn: mockFetch },
    );
    expect(s?.texte).toMatch(/OpenAlex/i);
    expect(s?.extraits[0]?.titre).toMatch(/Deep learning/i);
  });
});
