// La conversation de l'accueil avec la Reine — « Répondre à Hive… ».
//
// Même appel que la vue Reine (`reine-chat.ts`), contextualisé par le projet
// actif, et rangé dans la SESSION de l'onglet, par projet : changer de projet
// change de fil, recharger la page le garde, fermer l'onglet l'oublie. Rien ne
// part au serveur en dehors de la question elle-même.

import { useCallback, useEffect, useRef, useState } from 'react';
import { askQueen, ChatHttpError } from '../reine-chat';
import { t as tNow } from '../i18n';

export interface MessageConversation {
  readonly id: string;
  readonly role: 'moi' | 'reine';
  readonly texte: string;
  readonly ts: number;
  /** `live` : réponse composée par la ruche sans modèle ; `llm` : par le modèle de la Reine. */
  readonly source?: 'live' | 'llm';
}

const CLE = (projetId: string | null) => `hive.studio.conversation.${projetId ?? 'ruche'}`;
const BORNE = 60;

export function lireConversation(brut: string | null): MessageConversation[] {
  if (!brut) return [];
  try {
    const x: unknown = JSON.parse(brut);
    if (!Array.isArray(x)) return [];
    return x
      .filter(
        (m): m is MessageConversation =>
          typeof m === 'object' &&
          m !== null &&
          (m.role === 'moi' || m.role === 'reine') &&
          typeof m.texte === 'string' &&
          typeof m.id === 'string' &&
          typeof m.ts === 'number',
      )
      .slice(-BORNE);
  } catch {
    return [];
  }
}

function charger(projetId: string | null): MessageConversation[] {
  try {
    return lireConversation(sessionStorage.getItem(CLE(projetId)));
  } catch {
    return [];
  }
}

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq += 1).toString(36)}`;

export interface Conversation {
  readonly messages: readonly MessageConversation[];
  readonly enCours: boolean;
  readonly erreur: string | null;
  /** La route n'existe pas sur cette Reine (404/501) : le dire, ne pas réessayer en boucle. */
  readonly indisponible: boolean;
  envoyer(message: string, affiche?: string): Promise<boolean>;
  effacer(): void;
}

export function useConversation(projetId: string | null): Conversation {
  const [messages, setMessages] = useState<MessageConversation[]>(() => charger(projetId));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const annule = useRef<AbortController | null>(null);

  // Un autre projet : un autre fil — et la question en vol pour l'ancien s'arrête.
  useEffect(() => {
    setMessages(charger(projetId));
    setErreur(null);
    return () => annule.current?.abort();
  }, [projetId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(CLE(projetId), JSON.stringify(messages.slice(-BORNE)));
    } catch {
      // Session pleine : le fil vit le temps de la page.
    }
  }, [messages, projetId]);

  const envoyer = useCallback(
    async (message: string, affiche?: string): Promise<boolean> => {
      if (message.trim() === '' || enCours) return false;
      const question: MessageConversation = {
        id: uid(),
        role: 'moi',
        texte: affiche ?? message,
        ts: Date.now(),
      };
      const reponseId = uid();
      setMessages((m) => [...m, question]);
      setEnCours(true);
      setErreur(null);
      const ctrl = new AbortController();
      annule.current = ctrl;
      let recu = '';
      try {
        const r = await askQueen(
          message,
          projetId ?? undefined,
          (delta) => {
            recu += delta;
            setMessages((m) => {
              const sans = m.filter((x) => x.id !== reponseId);
              return [...sans, { id: reponseId, role: 'reine', texte: recu, ts: Date.now() }];
            });
          },
          ctrl.signal,
        );
        setMessages((m) => [
          ...m.filter((x) => x.id !== reponseId),
          { id: reponseId, role: 'reine', texte: r.reply, ts: Date.now(), source: r.source },
        ]);
        return true;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return false;
        if (e instanceof ChatHttpError && (e.status === 404 || e.status === 501)) {
          setIndisponible(true);
        }
        setErreur(
          e instanceof Error
            ? e.message
            : tNow('La Reine n’a pas répondu.', 'The Queen did not answer.'),
        );
        // La question reste affichée : on sait ce qu'on a demandé, et à quoi on n'a pas eu de réponse.
        setMessages((m) => m.filter((x) => x.id !== reponseId));
        return false;
      } finally {
        setEnCours(false);
        if (annule.current === ctrl) annule.current = null;
      }
    },
    [enCours, projetId],
  );

  const effacer = useCallback(() => {
    annule.current?.abort();
    setMessages([]);
    setErreur(null);
  }, []);

  return { messages, enCours, erreur, indisponible, envoyer, effacer };
}
