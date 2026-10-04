// Le port de la Reine de l'app — choisi une fois, puis GARDÉ (ADR 0013 § 5).
//
// ─── POURQUOI LE GARDER ──────────────────────────────────────────────────────
//
// L'écran vit à l'origine `http://127.0.0.1:<port>`, et son `localStorage` —
// le jeton, le thème, la langue — appartient à CETTE origine. Un port tiré à
// chaque lancement, c'est un écran qui oublie tout à chaque ouverture. Le port
// est donc écrit dans le `.env` de la ruche au premier lancement, et relu.
//
// ─── POURQUOI 7777 D'ABORD ───────────────────────────────────────────────────
//
// C'est le port que toute la documentation cite (`PORT_PAR_DEFAUT`) : une
// ouvrière d'ami, un billet d'invitation, `hive doctor` le supposent. On ne le
// quitte que s'il est pris — une ruche lancée par `npm run ruche`, un autre
// service — et on le DIT une fois.

import { createServer } from 'node:net';

/** Le port que la documentation, les billets et `hive doctor` supposent. */
export const PORT_PREFERE = 7777;

/** Ce que l'app fait du port au lancement. */
export type DecisionPort =
  /** Le port gardé (ou 7777 au premier lancement) est libre : on le prend. */
  | { readonly genre: 'garder'; readonly port: number }
  /**
   * Il est pris : on en tire un libre et on le réécrit. `premier` : c'était
   * 7777 au premier lancement ; `occupe` : c'était le port gardé, et
   * l'origine de l'écran change — ce qui se dit.
   */
  | { readonly genre: 'tirer'; readonly motif: 'premier' | 'occupe' };

/**
 * Le port gardé dans le `.env` de la ruche, ou `null` s'il n'y en a pas encore
 * — ou s'il n'est pas un port : une valeur illisible ne se garde pas, elle se
 * remplace (le `.env` est à l'app, pas à l'humain).
 */
export function portGarde(valeur: string | undefined): number | null {
  if (valeur === undefined || !/^\d+$/.test(valeur.trim())) return null;
  const n = Number(valeur.trim());
  return n >= 1 && n <= 65_535 ? n : null;
}

/** La décision, pure : le port candidat, et s'il est libre. */
export function deciderPort(garde: number | null, candidatLibre: boolean): DecisionPort {
  const candidat = garde ?? PORT_PREFERE;
  if (candidatLibre) return { genre: 'garder', port: candidat };
  return { genre: 'tirer', motif: garde === null ? 'premier' : 'occupe' };
}

/**
 * Le port est-il libre sur la boucle locale ? On ÉCOUTE, on ne se connecte
 * pas : un service qui écoute sans répondre ferait passer une connexion
 * refusée pour une place libre.
 */
export function portLibre(port: number, hote = '127.0.0.1'): Promise<boolean> {
  return new Promise((resoudre) => {
    const s = createServer();
    s.once('error', () => resoudre(false));
    s.listen({ port, host: hote, exclusive: true }, () => s.close(() => resoudre(true)));
  });
}

/** Un port libre, tiré par le système. */
export function tirerPortLibre(hote = '127.0.0.1'): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const s = createServer();
    s.once('error', rejeter);
    s.listen({ port: 0, host: hote, exclusive: true }, () => {
      const adresse = s.address();
      const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
      s.close(() => (port > 0 ? resoudre(port) : rejeter(new Error('aucun port tiré'))));
    });
  });
}

/** Le port à utiliser, décision prise et appliquée. */
export async function choisirPort(
  garde: number | null,
  sonder: (port: number) => Promise<boolean> = portLibre,
  tirer: () => Promise<number> = tirerPortLibre,
): Promise<{ readonly port: number; readonly decision: DecisionPort }> {
  const decision = deciderPort(garde, await sonder(garde ?? PORT_PREFERE));
  const port = decision.genre === 'garder' ? decision.port : await tirer();
  return { port, decision };
}
