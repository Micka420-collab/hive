// Voix ↔ Reine : reconnaissance et synthèse via l’API Web Speech du navigateur.
//
// Aucune clé, aucun serveur, aucune dépendance. Indisponible → l’UI le DIT
// (pas de faux micro qui écoute).

export type EtatEcoute = 'indisponible' | 'inactif' | 'ecoute' | 'erreur';

/** Sous-ensemble typé — les lib DOM TypeScript n’exposent pas toujours Web Speech. */
interface ReconnaissanceVocale {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: Event & { error?: string }) => void) | null;
  onresult:
    | ((
        ev: Event & {
          resultIndex: number;
          results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }>;
        },
      ) => void)
    | null;
}

type RecognitionCtor = new () => ReconnaissanceVocale;

function ctorReconnaissance(): RecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** La machine sait-elle écouter ? (Chrome / Edge surtout ; Safari partiel.) */
export function voixEcouteDisponible(): boolean {
  return ctorReconnaissance() !== null;
}

/** La machine sait-elle parler ? */
export function voixParoleDisponible(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export interface SessionEcoute {
  stop(): void;
}

/**
 * Démarre une écoute : chaque résultat partiel/final appelle `onTexte`.
 * `lang` BCP-47 (`fr-FR`, `en-US`).
 */
export function demarrerEcoute(opts: {
  lang: string;
  onTexte: (texte: string, final: boolean) => void;
  onEtat: (etat: EtatEcoute) => void;
  onErreur?: (message: string) => void;
}): SessionEcoute | null {
  const Ctor = ctorReconnaissance();
  if (!Ctor) {
    opts.onEtat('indisponible');
    return null;
  }
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onstart = () => opts.onEtat('ecoute');
  rec.onend = () => opts.onEtat('inactif');
  rec.onerror = (ev) => {
    opts.onEtat('erreur');
    opts.onErreur?.(ev.error || 'error');
  };
  rec.onresult = (ev) => {
    let interim = '';
    let final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (!r?.[0]) continue;
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) opts.onTexte(final, true);
    else if (interim) opts.onTexte(interim, false);
  };
  try {
    rec.start();
  } catch {
    opts.onEtat('erreur');
    return null;
  }
  return {
    stop() {
      try {
        rec.onresult = null;
        rec.stop();
      } catch {
        /* déjà arrêté */
      }
      opts.onEtat('inactif');
    },
  };
}

/** Fait lire un texte par la synthèse (coupe la lecture précédente). */
export function parlerTexte(texte: string, lang: string): void {
  if (!voixParoleDisponible() || !texte.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texte.slice(0, 4_000));
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

export function couperParole(): void {
  if (voixParoleDisponible()) window.speechSynthesis.cancel();
}
