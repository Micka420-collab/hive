// Le dialogue avec la Reine (`POST /api/chat`), partagé par deux écrans.
//
// Né dans la vue Reine, il sert aussi la conversation de l'accueil Hive Studio
// (« Répondre à Hive… ») : une seule façon d'appeler la Reine, une seule
// lecture du flux SSE, une seule distinction entre « pas encore déployé »
// (404/501) et une vraie panne. Deux copies finiraient par se contredire.

import { enTetesRuche } from './api';
import { t as tNow } from './i18n';

export interface ChatResponse {
  reply: string;
  source: 'live' | 'llm';
  suggestions?: string[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/** Erreur HTTP porteuse du statut — pour distinguer « pas encore déployé ». */
export class ChatHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function askQueen(
  message: string,
  projectId: string | undefined,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    // La même identité que `api()` : le jeton, et le compte s'il y en a un. Un
    // `fetch` gardé à part ne doit pas devenir la seule porte qui oublie qui
    // appelle.
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...enTetesRuche(),
    },
    body: JSON.stringify({
      message,
      stream: true,
      ...(projectId ? { projectId } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    let msg = tNow(`Erreur ${res.status}`, `Error ${res.status}`);
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      msg = body.message ?? body.error ?? msg;
    } catch {
      /* corps non-JSON */
    }
    throw new ChatHttpError(msg, res.status);
  }

  const ctype = res.headers.get('content-type') ?? '';
  // Hub ancien sans SSE : JSON classique.
  if (!ctype.includes('text/event-stream') || !res.body) {
    return (await res.json()) as ChatResponse;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let assemble = '';
  let final: ChatResponse | null = null;

  const traiterData = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let ev: {
      type?: string;
      text?: string;
      reply?: string;
      source?: 'live' | 'llm';
      suggestions?: string[];
      usage?: ChatResponse['usage'];
    };
    try {
      ev = JSON.parse(trimmed) as typeof ev;
    } catch {
      return;
    }
    if (ev.type === 'delta' && typeof ev.text === 'string') {
      assemble += ev.text;
      onDelta?.(ev.text);
    } else if (ev.type === 'done' && typeof ev.reply === 'string') {
      final = {
        reply: ev.reply,
        source: ev.source === 'llm' ? 'llm' : 'live',
        suggestions: ev.suggestions,
        usage: ev.usage,
      };
    }
  };

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      const t = line.trimEnd();
      if (t.startsWith('data:')) traiterData(t.slice(5).trimStart());
    }
  }
  if (buf.trim().startsWith('data:')) traiterData(buf.trim().slice(5).trimStart());

  if (final) return final;
  if (assemble.trim()) {
    return { reply: assemble, source: 'llm' };
  }
  throw new Error(tNow('Réponse stream vide.', 'Empty stream reply.'));
}
