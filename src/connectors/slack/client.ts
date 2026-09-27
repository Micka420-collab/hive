// Le client Slack — poster un message, et ouvrir le Socket Mode entrant.
//
// TOUTE l'I/O réseau du connecteur Slack est ici, derrière des dépendances
// injectées (`fetch`, fabrique de WebSocket). Un test pilote un faux serveur
// Socket Mode et un faux `chat.postMessage` sans réseau réel ; la PREUVE VIVE
// contre un vrai atelier Slack demande des identifiants d'atelier, donc elle
// est hors de cette machine (dit tel quel dans la PR).
//
// Aucune dépendance ajoutée : on POSTE avec le `fetch` global de Node 24, et on
// ouvre le Socket Mode avec le paquet `ws` déjà présent (injecté ici).

/** `fetch` minimal pour Slack : Slack répond 200 même en erreur logique, d'où `json()`. */
export type SlackFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

const API = 'https://slack.com/api';

export type ResultatPost =
  | { readonly ok: true; readonly ts: string | null }
  | { readonly ok: false; readonly motif: string };

/**
 * Poste un message dans un canal via `chat.postMessage`. Slack renvoie HTTP 200
 * avec `{ ok: false, error }` sur un échec logique (canal inconnu, bot non
 * invité…) : on lit donc le champ `ok` DU CORPS, pas seulement le statut HTTP.
 */
export async function posterMessageSlack(
  opts: { token: string; channel: string; message: { text: string; blocks: unknown[] } },
  fetchImpl: SlackFetch,
  timeoutMs = 10_000,
): Promise<ResultatPost> {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        channel: opts.channel,
        text: opts.message.text,
        blocks: opts.message.blocks,
      }),
      signal: ctrl.signal,
    });
    const corps = (await res.json()) as { ok?: boolean; error?: string; ts?: string };
    if (corps.ok === true) return { ok: true, ts: typeof corps.ts === 'string' ? corps.ts : null };
    return { ok: false, motif: corps.error ?? `statut ${res.status}` };
  } catch (err) {
    return { ok: false, motif: err instanceof Error ? err.message : 'réseau' };
  } finally {
    clearTimeout(minuterie);
  }
}

/** Ouvre une connexion Socket Mode et rend l'URL WebSocket, ou un motif d'échec. */
export async function ouvrirConnexionSocket(
  appToken: string,
  fetchImpl: SlackFetch,
): Promise<{ ok: true; url: string } | { ok: false; motif: string }> {
  try {
    const res = await fetchImpl(`${API}/apps.connections.open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${appToken}` },
    });
    const corps = (await res.json()) as { ok?: boolean; url?: string; error?: string };
    if (corps.ok === true && typeof corps.url === 'string') return { ok: true, url: corps.url };
    return { ok: false, motif: corps.error ?? `statut ${res.status}` };
  } catch (err) {
    return { ok: false, motif: err instanceof Error ? err.message : 'réseau' };
  }
}

/** La forme minimale d'un WebSocket dont le Socket Mode a besoin (injecté : `ws`). */
export interface WsLike {
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'message' | 'close' | 'error', cb: (arg?: unknown) => void): void;
}

export type WsFactory = (url: string) => WsLike;

/**
 * Une enveloppe Socket Mode, telle que Slack l'envoie sur le socket. On ne
 * traite que celles qui portent un `envelope_id` (à acquitter) et un `payload`
 * d'interaction ; `hello` et `disconnect` sont gérés par la boucle du hub.
 */
export interface EnveloppeSocket {
  readonly type: string;
  readonly envelope_id?: string;
  readonly payload?: unknown;
}

/** Parse une trame Socket Mode brute, ou rend `null` si elle est illisible. */
export function parserEnveloppe(brut: unknown): EnveloppeSocket | null {
  const texte =
    typeof brut === 'string' ? brut : brut instanceof Buffer ? brut.toString('utf8') : null;
  if (texte === null) return null;
  try {
    const lu: unknown = JSON.parse(texte);
    if (
      typeof lu !== 'object' ||
      lu === null ||
      typeof (lu as { type?: unknown }).type !== 'string'
    ) {
      return null;
    }
    return lu as EnveloppeSocket;
  } catch {
    return null;
  }
}

/** L'accusé de réception qu'une enveloppe attend : Slack renvoie le message sinon. */
export function accuse(envelopeId: string): string {
  return JSON.stringify({ envelope_id: envelopeId });
}
