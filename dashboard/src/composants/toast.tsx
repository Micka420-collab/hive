// LES NOTIFICATIONS ÉPHÉMÈRES (« toasts ») — un geste a eu lieu, on le dit.
//
// Plusieurs gestes du tableau de bord ne laissaient AUCUNE trace visible :
// un lien copié, un réglage enregistré, un verdict renvoyé. Le geste réussissait
// en silence, et le silence se lit comme un échec — on reclique.
//
// Le contrat :
//   · UNE région pour toute l'application (`ToastProvider`, monté par
//     main.tsx), et dedans DEUX files vivantes, toujours montées : `status`
//     (poli) pour ce qui informe, `alert` (qui interrompt) pour l'erreur. Les
//     toasts eux-mêmes n'ont pas de rôle : une région vivante dans une autre
//     fait lire la même phrase deux fois (NVDA, JAWS sous Chrome), et une
//     région qui naît avec son texte n'est pas annoncée par tous les lecteurs ;
//   · une information s'efface seule (5 s) ; une ERREUR reste jusqu'à ce
//     qu'on la ferme — un message qui disparaît avant d'avoir été lu est un
//     message perdu (WCAG 2.2.1), et c'est l'erreur qu'on n'a pas le droit de
//     perdre ;
//   · chaque notification a son bouton « Fermer », au clavier comme à la
//     souris ;
//   · la couleur double un mot (« Erreur », « Attention »…), elle ne le
//     remplace pas.
//
// Un toast n'est PAS le seul endroit où vit une information : ce qui doit
// rester (une panne, un refus) reste aussi dans la vue qui la concerne.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

export type TonToast = 'info' | 'succes' | 'alerte' | 'erreur';

export interface Annonce {
  message: ReactNode;
  ton?: TonToast;
  /** Durée d'affichage ; `null` = jusqu'à fermeture. Défaut : 5 s, `null` pour une erreur. */
  dureeMs?: number | null;
}

interface ToastVivant {
  id: number;
  message: ReactNode;
  ton: TonToast;
}

type Annoncer = (annonce: Annonce) => void;

const Contexte = createContext<Annoncer | null>(null);

const DUREE_PAR_DEFAUT_MS = 5_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [vivants, setVivants] = useState<ToastVivant[]>([]);
  const suivant = useRef(1);
  const minuteries = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const retirer = useCallback((id: number) => {
    const m = minuteries.current.get(id);
    if (m !== undefined) clearTimeout(m);
    minuteries.current.delete(id);
    setVivants((liste) => liste.filter((v) => v.id !== id));
  }, []);

  const annoncer = useCallback<Annoncer>(
    ({ message, ton = 'info', dureeMs }) => {
      const id = suivant.current++;
      setVivants((liste) => [...liste, { id, message, ton }]);
      const duree =
        dureeMs === undefined ? (ton === 'erreur' ? null : DUREE_PAR_DEFAUT_MS) : dureeMs;
      if (duree !== null)
        minuteries.current.set(
          id,
          setTimeout(() => retirer(id), duree),
        );
    },
    [retirer],
  );

  // Démonté : aucune minuterie ne doit survivre au fournisseur.
  useEffect(() => {
    const encours = minuteries.current;
    return () => {
      for (const m of encours.values()) clearTimeout(m);
      encours.clear();
    };
  }, []);

  const mot: Record<TonToast, string> = {
    info: t('Info', 'Info'),
    succes: t('Fait', 'Done'),
    alerte: t('Attention', 'Warning'),
    erreur: t('Erreur', 'Error'),
  };

  return (
    <Contexte.Provider value={annoncer}>
      {children}
      <section className="ds-toasts" aria-label={t('Notifications', 'Notifications')}>
        {(['status', 'alert'] as const).map((role) => (
          <div key={role} className="ds-toasts-file" role={role}>
            {vivants
              .filter((v) => (v.ton === 'erreur') === (role === 'alert'))
              .map((v) => (
                <div key={v.id} className={`ds-toast ds-toast--${v.ton}`}>
                  <span className="ds-toast-ton">{mot[v.ton]}</span>
                  <span className="ds-toast-message">{v.message}</span>
                  <button
                    type="button"
                    className="ds-toast-fermer"
                    aria-label={t('Fermer la notification', 'Dismiss notification')}
                    onClick={() => retirer(v.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
        ))}
      </section>
    </Contexte.Provider>
  );
}

/**
 * La fonction qui affiche une notification. Hors d'un `ToastProvider`, elle
 * LÈVE : un toast qui partirait dans le vide serait exactement le geste
 * silencieux qu'elle existe pour empêcher.
 */
export function useToast(): Annoncer {
  const annoncer = useContext(Contexte);
  if (annoncer === null) throw new Error('useToast() appelé hors de <ToastProvider>');
  return annoncer;
}
