// L'envoi d'un webhook — la seule I/O du connecteur, tenue à l'écart du reste.
//
// `fetch` est injecté : un test frappe un faux récepteur en mémoire et vérifie
// le corps ET la signature reçus, sans réseau réel. En production, c'est le
// `fetch` global de Node 24. Aucune dépendance ajoutée.

import type { RequeteWebhook } from './charge.js';

/** Le `fetch` dont ce module a besoin — la forme minimale, pour l'injecter. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
    redirect?: 'manual';
  },
) => Promise<{ ok: boolean; status: number }>;

export type ResultatEnvoi =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly status: number; readonly motif: string };

/**
 * Poste la requête. Un statut non-2xx est un ÉCHEC nommé (le récepteur a
 * répondu, mais mal) ; une exception réseau (DNS, connexion refusée, délai) est
 * un échec de statut 0. Dans les deux cas, l'appelant journalise `echec` — le
 * connecteur ne fait jamais silence sur un envoi raté.
 */
export async function envoyerWebhook(
  requete: RequeteWebhook,
  fetchImpl: FetchLike,
  timeoutMs = 10_000,
): Promise<ResultatEnvoi> {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Une redirection n'est JAMAIS suivie : elle renverrait le corps signé, et
    // ses en-têtes, vers une adresse que l'administrateur n'a pas posée (un
    // autre hôte, `http://` en clair). Elle est un échec nommé.
    const res = await fetchImpl(requete.url, {
      method: 'POST',
      headers: requete.entetes,
      body: requete.corps,
      signal: ctrl.signal,
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, motif: `redirection refusée (statut ${res.status})` };
    }
    return res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, motif: `statut ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, motif: err instanceof Error ? err.message : 'réseau' };
  } finally {
    clearTimeout(minuterie);
  }
}
