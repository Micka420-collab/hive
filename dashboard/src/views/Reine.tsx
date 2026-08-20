// Vue Reine — dialogue avec la ruche : on pose une question à la Reine IA,
// contextualisée par projet (optionnel), avec suggestions cliquables et
// historique de session. L'endpoint /api/chat est écrit en parallèle : en son
// absence (404/501), la vue bascule sur un message d'accueil dégradé.

import './reine.css';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { getToken } from '../api';
import { AtelierRecette } from '../AtelierRecette';
import { t as tNow, useT } from '../i18n';
import type { Translate } from '../i18n';
import { timeShort } from './shared';
import type { ViewProps } from './shared';

// ─── Fetcher local (ne pas toucher api.ts : endpoint en cours d'écriture) ────

interface ChatResponse {
  reply: string;
  source: 'live' | 'llm';
  suggestions?: string[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
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
    let msg = tNow(`Erreur ${res.status}`, `Error ${res.status}`);
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
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

interface StoredChat {
  messages: ChatMessage[];
  /** Vide = suggestions par défaut, résolues au rendu dans la langue courante. */
  suggestions: string[];
}

const CHAT_KEY = 'hive.reine.chat';

/** Suggestions par défaut — résolues au rendu pour suivre la langue d'interface. */
function defaultSuggestions(t: Translate): string[] {
  return [
    t('Où en est le projet ?', 'How is the project doing?'),
    t("Que s'est-il passé cette nuit ?", 'What happened overnight?'),
    t('Quel nœud travaille le mieux ?', 'Which node works best?'),
    t('Aide-moi à écrire un bon brief', 'Help me write a good brief'),
    t('Quelles bonnes pratiques pour mon projet ?', 'What are good practices for my project?'),
  ];
}

/** Relit la conversation de la session (survit aux changements de vue). */
function readChat(): StoredChat {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredChat>;
      if (Array.isArray(parsed.messages)) {
        return {
          messages: parsed.messages,
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        };
      }
    }
  } catch {
    /* stockage corrompu → conversation vierge */
  }
  return { messages: [], suggestions: [] };
}

let seq = 0;
/** Identifiant local court — les messages ne quittent jamais la session. */
function uid(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}`;
}

function welcomeDegraded(t: Translate): string {
  return t(
    'La Reine n’est pas encore réveillée : le canal /api/chat ouvre bientôt.\n' +
      'En attendant, la Ruche et la Chronique vous renseignent en temps réel sur l’essaim — revenez butiner un peu plus tard.',
    'The Queen is not awake yet: the /api/chat channel opens soon.\n' +
      'Meanwhile, the Hive and the Chronicle keep you posted on the swarm in real time — come back to forage a little later.',
  );
}

// ─── Vue ──────────────────────────────────────────────────────────────────────

export default function Reine({ snapshot, onNavigate }: ViewProps) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChat().messages);
  const [suggestions, setSuggestions] = useState<string[]>(() => readChat().suggestions);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState('');
  /** Session : total tokens IA consommés dans cet onglet (indicatif). */
  const [tokensSession, setTokensSession] = useState(0);

  const threadRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Suggestions affichées : celles de la Reine, sinon les défauts (langue courante).
  const shownSuggestions = suggestions.length > 0 ? suggestions : defaultSuggestions(t);

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
      if (res.usage) setTokensSession((n) => n + res.usage!.totalTokens);
      appendPersist(
        {
          id: uid(),
          role: 'queen',
          text: res.reply,
          ts: Date.now(),
          source: res.source,
          usage: res.usage,
        },
        res.suggestions && res.suggestions.length > 0 ? res.suggestions : undefined,
      );
    } catch (e) {
      // 404/501 = endpoint pas encore déployé → accueil dégradé, sans badge.
      const absent = e instanceof ChatHttpError && (e.status === 404 || e.status === 501);
      const detail = e instanceof Error ? e.message : String(e);
      const reply = absent
        ? welcomeDegraded(t)
        : t(
            `La Reine n’a pas pu répondre : ${detail}. Réessayez dans un instant.`,
            `The Queen could not reply: ${detail}. Please try again in a moment.`,
          );
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
    setSuggestions([]);
    setTokensSession(0);
    sessionStorage.removeItem(CHAT_KEY);
  };

  return (
    <div className="mc-view rn-view">
      <AtelierRecette />
      <header className="rn-head card">
        <div className="rn-head-title">
          <span className="marque" aria-hidden="true" />
          <div>
            <h2>{t('Parlez à la Reine', 'Talk to the Queen')}</h2>
            <p className="rn-sub">
              {t(
                'posez une question sur la ruche, ou faites-vous guider pour votre projet',
                'ask a question about the hive, or get guidance for your project',
              )}
            </p>
          </div>
        </div>
        <div className="rn-head-actions">
          <label className="rn-project">
            <span>{t('Projet', 'Project')}</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t('Toute la ruche', 'The whole hive')}</option>
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {tokensSession > 0 && (
            <span
              className="rn-tokens-session"
              title={t(
                'Tokens IA consommés dans cette session de chat',
                'AI tokens used in this chat session',
              )}
            >
              {tokensSession.toLocaleString()} tok
            </span>
          )}
          {messages.length > 0 && (
            <button type="button" className="btn ghost rn-clear" onClick={clear}>
              {t('Effacer', 'Clear')}
            </button>
          )}
        </div>
      </header>

      <nav className="rn-modes card" aria-label={t('Modes de travail', 'Work modes')}>
        <button type="button" className="rn-mode actif" aria-current="true">
          {t('Chat', 'Chat')}
        </button>
        <button
          type="button"
          className="rn-mode"
          onClick={() => onNavigate('projets', projectId || undefined)}
          title={t(
            'Atelier Queen Bee — brief → plan de tâches',
            'Queen Bee Workshop — brief → task plan',
          )}
        >
          {t('Plan', 'Plan')}
        </button>
        <button
          type="button"
          className="rn-mode"
          onClick={() => onNavigate('projets', projectId || undefined)}
          title={t(
            'Plein Essaim — la ruche travaille des jours sans vous (réglage sur le projet)',
            'Full Swarm — the hive works for days without you (set on the project)',
          )}
        >
          {t('Autonomie', 'Autonomy')}
        </button>
        <button
          type="button"
          className="rn-mode"
          onClick={() => onNavigate('rayon', projectId || undefined)}
          title={t(
            'Sauvegardes et code — timeline récupérable',
            'Backups and code — recoverable timeline',
          )}
        >
          {t('Sauvegardes', 'Backups')}
        </button>
        <span className="rn-mode-hint">
          {t(
            'L’Atelier (bureau ci-dessus) teste le projet sur la machine de la ruche.',
            'The Workshop (desktop above) tests the project on the hive computer.',
          )}
        </span>
      </nav>

      <section
        className="rn-thread card"
        ref={threadRef}
        role="log"
        aria-live="polite"
        aria-label={t('Fil de discussion avec la Reine', 'Conversation thread with the Queen')}
      >
        {messages.length === 0 && !pending && (
          <div className="rn-empty">
            <span className="marque" aria-hidden="true" />
            <p>
              {t(
                'La ruche bourdonne, la Reine écoute. Posez votre première question — ou butinez une suggestion ci-dessous.',
                'The hive is buzzing, the Queen is listening. Ask your first question — or forage a suggestion below.',
              )}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`rn-msg ${m.role === 'user' ? 'rn-user' : 'rn-queen'}`}>
            {m.role === 'queen' && <span className="rn-avatar" aria-hidden="true" />}
            <div className="rn-bubble">
              <p className="rn-text">{m.text}</p>
              <div className="rn-meta">
                {m.source === 'live' && (
                  <span
                    className="rn-src"
                    title={t(
                      'Réponse calculée sur l’état réel de la ruche',
                      'Answer computed from the live state of the hive',
                    )}
                  >
                    {t('état réel', 'live state')}
                  </span>
                )}
                {m.source === 'llm' && (
                  <span
                    className="rn-src"
                    title={t('Réponse générée par le modèle', 'Answer generated by the model')}
                  >
                    {t('IA', 'AI')}
                  </span>
                )}
                {m.usage && (
                  <span
                    className="rn-tokens"
                    title={t(
                      `${m.usage.inputTokens} entrants · ${m.usage.outputTokens} sortants`,
                      `${m.usage.inputTokens} in · ${m.usage.outputTokens} out`,
                    )}
                  >
                    {m.usage.totalTokens.toLocaleString()} tok
                  </span>
                )}
                <span className="rn-time">{timeShort(m.ts)}</span>
              </div>
            </div>
          </div>
        ))}
        {pending && (
          <div className="rn-msg rn-queen">
            <span className="rn-avatar" aria-hidden="true" />
            <div className="rn-bubble rn-thinking">
              {t('la Reine réfléchit', 'the Queen is thinking')}
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
          {shownSuggestions.map((s) => (
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
            placeholder={t(
              'Votre question à la Reine… (Entrée pour envoyer, Maj+Entrée : nouvelle ligne)',
              'Your question for the Queen… (Enter to send, Shift+Enter: new line)',
            )}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              grow();
            }}
            onKeyDown={onKeyDown}
            aria-label={t('Message à la Reine', 'Message to the Queen')}
          />
          <button
            className="btn primary rn-send"
            disabled={pending || draft.trim() === ''}
            onClick={() => void send(draft)}
          >
            {t('Envoyer', 'Send')}
          </button>
        </div>
      </footer>
    </div>
  );
}
