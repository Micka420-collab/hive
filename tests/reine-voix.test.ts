// @vitest-environment happy-dom
//
// La voix de la Reine — écouter (Web Speech) et parler (synthèse).
//
// Ni `SpeechRecognition` ni `speechSynthesis` n'existent sous happy-dom :
// vérifié, les deux valent `undefined`. Le décor est donc posé ici à la main,
// ce qui vaut mieux qu'un vrai navigateur pour ce module — les événements
// partent quand le banc le décide, donc chaque cas est reproductible.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  couperParole,
  demarrerEcoute,
  parlerTexte,
  voixEcouteDisponible,
  voixParoleDisponible,
  type EtatEcoute,
} from '../dashboard/src/reine-voix.js';

/** Un résultat tel que le navigateur le remonte : indexé, avec `isFinal`. */
type Alternative = { transcript: string };
type Resultat = { isFinal: boolean; 0?: Alternative };

class FausseReconnaissance {
  static instances: FausseReconnaissance[] = [];
  /** Posé par un banc pour que `start()` jette, comme un micro refusé. */
  static startJette = false;
  /** Posé par un banc pour que `stop()` jette, comme une session déjà close. */
  static stopJette = false;

  lang = '';
  continuous = false;
  interimResults = false;
  demarrages = 0;
  arrets = 0;
  onstart: ((ev: Event) => void) | null = null;
  onend: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event & { error?: string }) => void) | null = null;
  onresult: ((ev: Event & { resultIndex: number; results: ArrayLike<Resultat> }) => void) | null =
    null;

  constructor() {
    FausseReconnaissance.instances.push(this);
  }

  start(): void {
    this.demarrages++;
    if (FausseReconnaissance.startJette) throw new Error('micro refusé');
  }

  stop(): void {
    this.arrets++;
    if (FausseReconnaissance.stopJette) throw new Error('déjà arrêtée');
  }

  /** Rejoue un lot de résultats comme le ferait le navigateur. */
  emettre(resultIndex: number, results: Resultat[]): void {
    this.onresult?.(
      Object.assign(new Event('result'), { resultIndex, results }) as Event & {
        resultIndex: number;
        results: ArrayLike<Resultat>;
      },
    );
  }
}

interface FenetreVocale {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: unknown;
}

function fenetre(): FenetreVocale {
  return window as unknown as FenetreVocale;
}

/** Le journal de la synthèse : l'ORDRE des appels est ce qui compte. */
let dits: string[] = [];
let enonces: { text: string; lang: string }[] = [];

class FauxEnonce {
  lang = '';
  constructor(public text: string) {
    enonces.push(this);
  }
}

function poserSynthese(): void {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: {
      cancel: () => dits.push('cancel'),
      speak: (u: { text: string }) => dits.push(`speak:${u.text.length}`),
    },
  });
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = FauxEnonce;
}

function retirerSynthese(): void {
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
}

beforeEach(() => {
  FausseReconnaissance.instances = [];
  FausseReconnaissance.startJette = false;
  FausseReconnaissance.stopJette = false;
  dits = [];
  enonces = [];
});

afterEach(() => {
  delete fenetre().SpeechRecognition;
  delete fenetre().webkitSpeechRecognition;
  retirerSynthese();
});

describe('disponibilité', () => {
  it('sans aucun constructeur, la machine ne sait pas écouter', () => {
    expect(voixEcouteDisponible()).toBe(false);
  });

  it('avec SpeechRecognition, elle sait écouter', () => {
    fenetre().SpeechRecognition = FausseReconnaissance;
    expect(voixEcouteDisponible()).toBe(true);
  });

  it('le préfixe webkit suffit — c’est le repli de Chrome', () => {
    fenetre().webkitSpeechRecognition = FausseReconnaissance;
    expect(voixEcouteDisponible()).toBe(true);
  });

  it('sans speechSynthesis, la machine ne sait pas parler', () => {
    expect(voixParoleDisponible()).toBe(false);
  });

  it('avec speechSynthesis, elle sait parler', () => {
    poserSynthese();
    expect(voixParoleDisponible()).toBe(true);
  });
});

describe('démarrer une écoute', () => {
  it('sans reconnaissance : état « indisponible », rien construit, retour nul', () => {
    const etats: EtatEcoute[] = [];
    const session = demarrerEcoute({
      lang: 'fr-FR',
      onTexte: () => {},
      onEtat: (e) => etats.push(e),
    });
    expect(session).toBeNull();
    expect(etats).toEqual(['indisponible']);
    expect(FausseReconnaissance.instances).toHaveLength(0);
  });

  it('les réglages sont posés avant le démarrage', () => {
    fenetre().SpeechRecognition = FausseReconnaissance;
    demarrerEcoute({ lang: 'en-US', onTexte: () => {}, onEtat: () => {} });
    const rec = FausseReconnaissance.instances[0]!;
    expect(rec.lang).toBe('en-US');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.demarrages).toBe(1);
  });

  it('un micro refusé (start qui jette) : état « erreur » et retour nul', () => {
    fenetre().SpeechRecognition = FausseReconnaissance;
    FausseReconnaissance.startJette = true;
    const etats: EtatEcoute[] = [];
    const session = demarrerEcoute({
      lang: 'fr-FR',
      onTexte: () => {},
      onEtat: (e) => etats.push(e),
    });
    expect(session).toBeNull();
    expect(etats).toEqual(['erreur']);
  });
});

describe('les états remontés par le navigateur', () => {
  function ecouter(): { rec: FausseReconnaissance; etats: EtatEcoute[]; erreurs: string[] } {
    fenetre().SpeechRecognition = FausseReconnaissance;
    const etats: EtatEcoute[] = [];
    const erreurs: string[] = [];
    demarrerEcoute({
      lang: 'fr-FR',
      onTexte: () => {},
      onEtat: (e) => etats.push(e),
      onErreur: (m) => erreurs.push(m),
    });
    return { rec: FausseReconnaissance.instances[0]!, etats, erreurs };
  }

  it('onstart annonce « ecoute »', () => {
    const { rec, etats } = ecouter();
    rec.onstart?.(new Event('start'));
    expect(etats).toEqual(['ecoute']);
  });

  it('onend annonce « inactif »', () => {
    const { rec, etats } = ecouter();
    rec.onend?.(new Event('end'));
    expect(etats).toEqual(['inactif']);
  });

  it('onerror annonce « erreur » ET transmet le motif', () => {
    const { rec, etats, erreurs } = ecouter();
    rec.onerror?.(Object.assign(new Event('error'), { error: 'not-allowed' }));
    expect(etats).toEqual(['erreur']);
    expect(erreurs).toEqual(['not-allowed']);
  });

  it('une erreur sans motif reste nommée « error » plutôt que vide', () => {
    const { rec, erreurs } = ecouter();
    rec.onerror?.(Object.assign(new Event('error'), { error: '' }));
    expect(erreurs).toEqual(['error']);
  });
});

describe('les résultats de la dictée', () => {
  function ecouter(): { rec: FausseReconnaissance; textes: [string, boolean][] } {
    fenetre().SpeechRecognition = FausseReconnaissance;
    const textes: [string, boolean][] = [];
    demarrerEcoute({
      lang: 'fr-FR',
      onTexte: (t, f) => textes.push([t, f]),
      onEtat: () => {},
    });
    return { rec: FausseReconnaissance.instances[0]!, textes };
  }

  it('un résultat final est annoncé comme final', () => {
    const { rec, textes } = ecouter();
    rec.emettre(0, [{ isFinal: true, 0: { transcript: 'bonjour' } }]);
    expect(textes).toEqual([['bonjour', true]]);
  });

  it('un résultat partiel est annoncé comme partiel', () => {
    const { rec, textes } = ecouter();
    rec.emettre(0, [{ isFinal: false, 0: { transcript: 'bonj' } }]);
    expect(textes).toEqual([['bonj', false]]);
  });

  it('final et partiel dans le même lot : le final seul est annoncé', () => {
    const { rec, textes } = ecouter();
    rec.emettre(0, [
      { isFinal: true, 0: { transcript: 'bonjour' } },
      { isFinal: false, 0: { transcript: ' la ru' } },
    ]);
    expect(textes).toEqual([['bonjour', true]]);
  });

  it('plusieurs finals sont recollés dans l’ordre', () => {
    const { rec, textes } = ecouter();
    rec.emettre(0, [
      { isFinal: true, 0: { transcript: 'bonjour' } },
      { isFinal: true, 0: { transcript: ' la ruche' } },
    ]);
    expect(textes).toEqual([['bonjour la ruche', true]]);
  });

  it('ce qui précède resultIndex est déjà consommé : jamais réannoncé', () => {
    const { rec, textes } = ecouter();
    rec.emettre(1, [
      { isFinal: true, 0: { transcript: 'DÉJÀ DIT' } },
      { isFinal: true, 0: { transcript: 'neuf' } },
    ]);
    expect(textes).toEqual([['neuf', true]]);
  });

  it('une entrée sans alternative est sautée sans emporter les suivantes', () => {
    const { rec, textes } = ecouter();
    rec.emettre(0, [{ isFinal: true }, { isFinal: true, 0: { transcript: 'suite' } }]);
    expect(textes).toEqual([['suite', true]]);
  });

  it('un lot entièrement vide n’annonce rien du tout', () => {
    const { rec, textes } = ecouter();
    rec.emettre(0, [{ isFinal: false, 0: { transcript: '' } }]);
    expect(textes).toEqual([]);
  });
});

describe('arrêter l’écoute', () => {
  it('stop() détache onresult, arrête la reconnaissance et annonce « inactif »', () => {
    fenetre().SpeechRecognition = FausseReconnaissance;
    const etats: EtatEcoute[] = [];
    const session = demarrerEcoute({
      lang: 'fr-FR',
      onTexte: () => {},
      onEtat: (e) => etats.push(e),
    });
    const rec = FausseReconnaissance.instances[0]!;
    session?.stop();
    expect(rec.onresult).toBeNull();
    expect(rec.arrets).toBe(1);
    expect(etats).toEqual(['inactif']);
  });

  it('une reconnaissance déjà close ne fait pas perdre l’état « inactif »', () => {
    fenetre().SpeechRecognition = FausseReconnaissance;
    FausseReconnaissance.stopJette = true;
    const etats: EtatEcoute[] = [];
    const session = demarrerEcoute({
      lang: 'fr-FR',
      onTexte: () => {},
      onEtat: (e) => etats.push(e),
    });
    expect(() => session?.stop()).not.toThrow();
    expect(etats).toEqual(['inactif']);
  });
});

describe('parler', () => {
  it('sans synthèse, parler ne jette pas et ne dit rien', () => {
    expect(() => parlerTexte('bonjour', 'fr-FR')).not.toThrow();
    expect(dits).toEqual([]);
  });

  it('un texte blanc ne coupe même pas la lecture en cours', () => {
    poserSynthese();
    parlerTexte('   \n  ', 'fr-FR');
    expect(dits).toEqual([]);
  });

  it('la lecture précédente est coupée AVANT la nouvelle', () => {
    poserSynthese();
    parlerTexte('bonjour', 'fr-FR');
    expect(dits).toEqual(['cancel', 'speak:7']);
  });

  it('la langue demandée est posée sur l’énoncé', () => {
    poserSynthese();
    parlerTexte('hello', 'en-US');
    expect(enonces).toHaveLength(1);
    expect(enonces[0]!.lang).toBe('en-US');
  });

  it('un texte très long est tronqué à 4 000 caractères', () => {
    poserSynthese();
    parlerTexte('a'.repeat(9_000), 'fr-FR');
    expect(dits).toEqual(['cancel', 'speak:4000']);
    expect(enonces[0]!.text).toHaveLength(4_000);
  });

  it('couper la parole appelle cancel', () => {
    poserSynthese();
    couperParole();
    expect(dits).toEqual(['cancel']);
  });

  it('couper la parole sans synthèse ne jette pas', () => {
    expect(() => couperParole()).not.toThrow();
    expect(dits).toEqual([]);
  });
});
