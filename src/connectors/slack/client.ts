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
 * Un appel Slack BORNÉ dans le temps. Tous les appels sortants passent ici : un
 * `apps.connections.open` qui pendrait sans délai bloquerait la boucle entrante
 * pour toujours — aucune reconnexion planifiée, rien au journal —, et c'est
 * exactement la panne qu'on ne voit pas.
 */
async function appelBorne<T>(
  fetchImpl: SlackFetch,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  lire: (res: { status: number; json: () => Promise<unknown> }) => Promise<T>,
  timeoutMs: number,
): Promise<T | { ok: false; motif: string }> {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await lire(await fetchImpl(url, { ...init, signal: ctrl.signal }));
  } catch (err) {
    return { ok: false, motif: err instanceof Error ? err.message : 'réseau' };
  } finally {
    clearTimeout(minuterie);
  }
}

/**
 * Le corps EXACT d'un `chat.postMessage` pour un canal. Exporté pour que le
 * journal hache ces octets-là (canal compris) : une empreinte qui ne couvrirait
 * que le message, sans le canal, ne correspondrait à aucune requête réelle.
 */
export function corpsPostMessage(
  channel: string,
  message: { text: string; blocks: unknown[] },
): string {
  return JSON.stringify({ channel, text: message.text, blocks: message.blocks });
}

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
  return appelBorne(
    fetchImpl,
    `${API}/chat.postMessage`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${opts.token}`,
      },
      body: corpsPostMessage(opts.channel, opts.message),
    },
    async (res): Promise<ResultatPost> => {
      const corps = (await res.json()) as { ok?: boolean; error?: string; ts?: string };
      if (corps.ok === true)
        return { ok: true, ts: typeof corps.ts === 'string' ? corps.ts : null };
      return { ok: false, motif: corps.error ?? `statut ${res.status}` };
    },
    timeoutMs,
  );
}

/** Ouvre une connexion Socket Mode et rend l'URL WebSocket, ou un motif d'échec. */
export async function ouvrirConnexionSocket(
  appToken: string,
  fetchImpl: SlackFetch,
  timeoutMs = 10_000,
): Promise<{ ok: true; url: string } | { ok: false; motif: string }> {
  return appelBorne(
    fetchImpl,
    `${API}/apps.connections.open`,
    { method: 'POST', headers: { authorization: `Bearer ${appToken}` } },
    async (res): Promise<{ ok: true; url: string } | { ok: false; motif: string }> => {
      const corps = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (corps.ok === true && typeof corps.url === 'string') return { ok: true, url: corps.url };
      return { ok: false, motif: corps.error ?? `statut ${res.status}` };
    },
    timeoutMs,
  );
}

/**
 * Le seul hôte où l'on accepte de répondre à un clic. La `response_url` vient
 * du payload Socket Mode (authentifié par le jeton d'app), mais un POST vers une
 * URL lue dans un message reste un POST vers une URL lue dans un message : on
 * n'écrit que chez Slack, jamais ailleurs.
 */
const PREFIXE_REPONSE = 'https://hooks.slack.com/';

/**
 * Répond au cliqueur par la `response_url` de l'interaction : `remplacer` pour
 * réécrire le message (les boutons disparaissent une fois le verdict appliqué),
 * sinon un message éphémère que lui seul voit (le motif d'un refus). Sans cette
 * réponse, un clic ne montrait RIEN à celui qui l'a fait — il recliquait, ou
 * allait approuver ailleurs.
 */
export async function repondreInteraction(
  opts: { responseUrl: string; texte: string; remplacer: boolean },
  fetchImpl: SlackFetch,
  timeoutMs = 10_000,
): Promise<{ ok: true } | { ok: false; motif: string }> {
  if (!opts.responseUrl.startsWith(PREFIXE_REPONSE)) return { ok: false, motif: 'url_refusee' };
  const corps = opts.remplacer
    ? { replace_original: true, text: opts.texte }
    : { response_type: 'ephemeral', replace_original: false, text: opts.texte };
  return appelBorne(
    fetchImpl,
    opts.responseUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(corps),
    },
    // Une `response_url` répond « ok » en texte, pas en JSON : seul le statut compte.
    (res): Promise<{ ok: true } | { ok: false; motif: string }> =>
      Promise.resolve(
        res.status === 200 ? { ok: true } : { ok: false, motif: `statut ${res.status}` },
      ),
    timeoutMs,
  );
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
