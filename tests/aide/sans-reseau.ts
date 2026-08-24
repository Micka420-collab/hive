// Couper le réseau dans un banc de rendu — une fois, pour tout le monde.
//
// ─── LE RELEVÉ QUI A JUSTIFIÉ CE FICHIER ────────────────────────────────────
//
// Mesuré banc par banc (`npx vitest run <banc> | grep -c ECONNREFUSED`) :
// 342 VRAIES connexions vers 127.0.0.1:3000 par suite complète, réparties sur
// douze fichiers — `coulee-du-miel` à lui seul en faisait 134.
//
// Ce n'est pas qu'un bruit de journal. Le rejet arrive de façon ASYNCHRONE,
// parfois après la fin du test qui l'a déclenché : sous `--sequence.shuffle`,
// il retombe dans la fenêtre d'un banc voisin, qui rougit pour une faute qui
// n'est pas la sienne. Et les milliers de piles d'appels noient le journal de
// CI au point que le détail du banc rouge sort de la fenêtre que l'API des
// journaux accepte de rendre — le bruit efface sa propre preuve.
//
// ─── POURQUOI COUPER `fetch`, ET PAS BOUCHONNER LES FONCTIONS ───────────────
//
// `dashboard/src/api.ts` exporte cent quinze fonctions. Les recopier dans un
// jeu de bouchons serait long, et surtout PÉRISSABLE : la cent-seizième
// arriverait sans que personne y pense, et le trou se rouvrirait en silence.
//
// Toutes passent par `fetch`. On coupe donc là, une fois — et la cent-seizième
// est couverte le jour où elle est écrite.
//
// ─── POURQUOI UN REJET, ET PAS UNE RÉPONSE VIDE ─────────────────────────────
//
// C'est le point délicat. Aujourd'hui ces appels ÉCHOUENT (ECONNREFUSED), et
// les composants suivent leur chemin d'erreur — que certains bancs observent.
// Répondre `{}` avec un 200 changerait ce chemin, et ferait rougir des bancs
// qui n'ont rien demandé.
//
// On rejette donc, comme avant. La sémantique est IDENTIQUE à un octet près ;
// seule la socket disparaît. C'est ce qui rend ce balayage sûr sur douze
// fichiers d'un coup.

import { vi } from 'vitest';

/** Ce qu'un banc peut relire du trafic qu'il a tenté. */
export interface ReseauCoupe {
  /** Les URL demandées, dans l'ordre — utile pour affirmer une ABSENCE. */
  readonly appels: string[];
  /** Remet le `fetch` d'origine. Appelé par `afterEach` si le banc en a un. */
  readonly rendre: () => void;
}

/**
 * Coupe `fetch` pour ce banc. À appeler dans `beforeEach`.
 *
 * Le rejet porte un message reconnaissable : quand un banc rougit à cause
 * d'un appel qu'on n'attendait pas, on veut lire « réseau coupé » plutôt
 * qu'un ECONNREFUSED qui enverrait chercher un serveur qui n'existe pas.
 */
export function couperLeReseau(): ReseauCoupe {
  const appels: string[] = [];
  const origine = globalThis.fetch;
  globalThis.fetch = vi.fn((entree: unknown) => {
    appels.push(
      typeof entree === 'string'
        ? entree
        : entree instanceof URL
          ? entree.href
          : String((entree as { url?: unknown }).url ?? entree),
    );
    return Promise.reject(new Error('réseau coupé dans les bancs (tests/aide/sans-reseau)'));
  }) as unknown as typeof fetch;
  return {
    appels,
    rendre: () => {
      globalThis.fetch = origine;
    },
  };
}
