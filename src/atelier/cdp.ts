// Le canal WEB de l'Atelier — Chrome DevTools Protocol, port 9222.
//
// MODULE PUR + fetch injectable. Rien n'écoute 0.0.0.0 sur l'hôte : compose
// publie `127.0.0.1:9222`. L'agent pilote le DOM, clique, capture — il ne
// reçoit PAS les cookies de l'humain (ADR 0008, décision 3).

export const PORT_CDP = 9222;

export function urlCdp(port: number = PORT_CDP): string {
  return `http://127.0.0.1:${String(port)}`;
}

export interface VersionCdp {
  readonly Browser?: string;
  readonly webSocketDebuggerUrl?: string;
}

export interface CibleCdp {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl?: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function versionCdp(
  port: number = PORT_CDP,
  fetchFn: FetchFn = fetch,
): Promise<VersionCdp> {
  const res = await fetchFn(`${urlCdp(port)}/json/version`);
  if (!res.ok) throw new Error(`CDP version ${String(res.status)}`);
  return (await res.json()) as VersionCdp;
}

export async function ciblesCdp(
  port: number = PORT_CDP,
  fetchFn: FetchFn = fetch,
): Promise<CibleCdp[]> {
  const res = await fetchFn(`${urlCdp(port)}/json/list`);
  if (!res.ok) throw new Error(`CDP list ${String(res.status)}`);
  const brut = (await res.json()) as unknown;
  return Array.isArray(brut) ? (brut as CibleCdp[]) : [];
}

/** Première page — pas une extension, pas un worker de service. */
export function pagePrincipale(cibles: readonly CibleCdp[]): CibleCdp | null {
  return cibles.find((c) => c.type === 'page') ?? cibles[0] ?? null;
}

/**
 * Capture via l'endpoint HTTP `/json` : on NE parle pas encore au WebSocket
 * CDP ici. Un screenshot "vrai" (Page.captureScreenshot) demande le socket ;
 * ce module expose d'abord ce qui se teste sans navigateur — la découverte.
 *
 * Pour un PNG, l'appelant passe par noVNC ou par un client CDP branché sur
 * `webSocketDebuggerUrl`. On refuse toute URL qui n'est pas locale.
 */
export function jugerSocketCdp(url: string): { ok: true } | { ok: false; raison: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, raison: 'URL CDP illisible' };
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    return { ok: false, raison: 'le débogueur parle en WebSocket' };
  }
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    return { ok: false, raison: 'le CDP ne quitte pas la machine' };
  }
  return { ok: true };
}
