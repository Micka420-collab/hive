// Vue Reine — dialogue avec la ruche : on pose une question à la Reine IA,
// contextualisée par projet (optionnel), avec suggestions cliquables et
// historique de session. L'endpoint /api/chat est écrit en parallèle : en son
// absence (404/501), la vue bascule sur un message d'accueil dégradé.

import './reine.css';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { getToken } from '../api';
import { timeShort } from './shared';
import type { ViewProps } from './shared';

// ─── Fetcher local (ne pas toucher api.ts : endpoint en cours d'écriture) ────

interface ChatResponse {
  reply: string;
  source: 'live' | 'llm';
  suggestions?: string[];
}

/** Erreur HTTP porteuse du statut — pour distinguer « pas encore déployé ». */
class ChatHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function askQueen(message: string, projectId?: string): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hive-token': getToken() },
    body: JSON.stringify(projectId ? { message, projectId } : { message }),
  });
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      msg = body.message ?? body.error ?? msg;
    } catch {
      /* corps non-JSON */
    }
    throw new ChatHttpError(msg, res.status);
  }
  return (await res.json()) as ChatResponse;
}

// ─── Modèle de conversation + persistance de session ─────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'queen';
  text: string;
  ts: number;
  /** Origine d'une réponse de la Reine (badge) — absent pour l'utilisateur. */
  source?: 'live' | 'llm';
}

interface StoredChat {
  messages: ChatMessage[];
  suggestions: string[];
}

const CHAT_KEY = 'hive.reine.chat';

const DEFAULT_SUGGESTIONS = [
  'Où en est le projet ?',
  "Que s'est-il passé cette nuit ?",
  'Quel nœud travaille le mieux ?',
  'Aide-moi à écrire un bon brief',
  'Quelles bonnes pratiques pour mon projet ?',
];

/** Relit la conversation de la session (survit aux changements de vue). */
function readChat(): StoredChat {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredChat>;
      if (Array.isArray(parsed.messages)) {
        return {
          messages: parsed.messages,
          suggestions:
            Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0
              ? parsed.suggestions
              : DEFAULT_SUGGESTIONS,
        };
      }
    }
  } catch {
    /* stockage corrompu → conversation vierge */
  }
  return { messages: [], suggestions: DEFAULT_SUGGESTIONS };
}

let seq = 0;
/** Identifiant local court — les messages ne quittent jamais la session. */
function uid(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}`;
}

const WELCOME_DEGRADED =
  '🐝 La Reine n’est pas encore réveillée : le canal /api/chat ouvre bientôt.\n' +
  'En attendant, la Ruche et la Chronique vous renseignent en temps réel sur l’essaim — revenez butiner un peu plus tard.';

// ─── Vue ──────────────────────────────────────────────────────────────────────

export default function Reine({ snapshot }: ViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChat().messages);
  const [suggestions, setSuggestions] = useState<string[]>(() => readChat().suggestions);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState('');

  const threadRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Persiste l'historique à chaque évolution (sessionStorage : survit à la
  // navigation entre vues, pas à la fermeture de l'onglet).
  useEffect(() => {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify({ messages, suggestions }));
  }, [messages, suggestions]);

  // Auto-scroll en bas du fil à chaque nouveau message ou pendant la réflexion.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  /** Textarea auto-grow, plafonnée (le CSS fixe max-height en garde-fou). */
  const grow = () => {
    const ta = areaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  };

  /**
   * Ajoute un message en write-through dans sessionStorage EN PLUS du setState :
   * si l'utilisateur change de vue pendant que la Reine répond, le composant est
   * démonté (setState no-op) mais la réponse survit et réapparaît au remontage.
   */
  const appendPersist = (msg: ChatMessage, newSuggestions?: string[]) => {
    const stored = readChat();
    sessionStorage.setItem(
      CHAT_KEY,
      JSON.stringify({
        messages: [...stored.messages, msg],
        suggestions: newSuggestions ?? stored.suggestions,
      }),
    );
    setMessages((m) => [...m, msg]);
    if (newSuggestions) setSuggestions(newSuggestions);
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || pending) return;
    appendPersist({ id: uid(), role: 'user', text, ts: Date.now() });
    setDraft('');
    const ta = areaRef.current;
    if (ta) ta.style.height = 'auto';
    setPending(true);
    try {
      const res = await askQueen(text, projectId || undefined);
      appendPersist(
        { id: uid(), role: 'queen', text: res.reply, ts: Date.now(), source: res.source },
        res.suggestions && res.suggestions.length > 0 ? res.suggestions : undefined,
      );
    } catch (e) {
      // 404/501 = endpoint pas encore déployé → accueil dégradé, sans badge.
      const absent = e instanceof ChatHttpError && (e.status === 404 || e.status === 501);
      const reply = absent
        ? WELCOME_DEGRADED
        : `La Reine n’a pas pu répondre : ${e instanceof Error ? e.message : String(e)}. Réessayez dans un instant.`;
      appendPersist({ id: uid(), role: 'queen', text: reply, ts: Date.now() });
    } finally {
      setPending(false);
    }
  };

  /**
   * Entrée envoie, Maj+Entrée insère une nouvelle ligne. Une Entrée de
   * validation de composition IME (japonais, chinois, coréen…) ne doit jamais
   * envoyer le message — la Reine est mondiale (keyCode 229 : quirk Safari).
   */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      e.nativeEvent.keyCode !== 229
    ) {
      e.preventDefault();
      void send(draft);
    }
  };

  const clear = () => {
    setMessages([]);
    setSuggestions(DEFAULT_SUGGESTIONS);
    sessionStorage.removeItem(CHAT_KEY);
  };

  return (
    <div className="mc-view rn-view">
      <header className="rn-head card">
        <div className="rn-head-title">
          <span className="rn-crown" aria-hidden="true">
            👑
          </span>
          <div>
            <h2>Parlez à la Reine</h2>
            <p className="rn-sub">
              posez une question sur la ruche, ou faites-vous guider pour votre projet
            </p>
          </div>
        </div>
        <div className="rn-head-actions">
          <label className="rn-project">
            <span>Projet</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Toute la ruche</option>
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {messages.length > 0 && (
            <button className="btn ghost rn-clear" onClick={clear}>
              Effacer
            </button>
          )}
        </div>
      </header>

      <section
        className="rn-thread card"
        ref={threadRef}
        role="log"
        aria-live="polite"
        aria-label="Fil de discussion avec la Reine"
      >
        {messages.length === 0 && !pending && (
          <div className="rn-empty">
            <span aria-hidden="true">🍯</span>
            <p>
              La ruche bourdonne, la Reine écoute. Posez votre première question — ou butinez une
              suggestion ci-dessous.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`rn-msg ${m.role === 'user' ? 'rn-user' : 'rn-queen'}`}>
            {m.role === 'queen' && (
              <span className="rn-avatar" aria-hidden="true">
                👑
              </span>
            )}
            <div className="rn-bubble">
              <p className="rn-text">{m.text}</p>
              <div className="rn-meta">
                {m.source === 'live' && (
                  <span className="rn-src" title="Réponse calculée sur l’état réel de la ruche">
                    📡 état réel
                  </span>
                )}
                {m.source === 'llm' && (
                  <span className="rn-src" title="Réponse générée par le modèle">
                    ✨ IA
                  </span>
                )}
                <span className="rn-time">{timeShort(m.ts)}</span>
              </div>
            </div>
          </div>
        ))}
        {pending && (
          <div className="rn-msg rn-queen">
            <span className="rn-avatar" aria-hidden="true">
              👑
            </span>
            <div className="rn-bubble rn-thinking">
              la Reine réfléchit
              <span className="rn-dots" aria-hidden="true">
                <i>.</i>
                <i>.</i>
                <i>.</i>
              </span>
            </div>
          </div>
        )}
      </section>

      <footer className="rn-composer">
        <div className="rn-chips" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              className="chip rn-chip"
              disabled={pending}
              onClick={() => void send(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="rn-inputrow">
          <textarea
            ref={areaRef}
            className="rn-input"
            rows={1}
            placeholder="Votre question à la Reine… (Entrée pour envoyer, Maj+Entrée : nouvelle ligne)"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              grow();
            }}
            onKeyDown={onKeyDown}
            aria-label="Message à la Reine"
          />
          <button
            className="btn primary rn-send"
            disabled={pending || draft.trim() === ''}
            onClick={() => void send(draft)}
          >
            Envoyer
          </button>
        </div>
      </footer>
    </div>
  );
}
