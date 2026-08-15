// LA COMMANDE D'ENTRÉE — un seul geste pour rejoindre la ruche.
//
// ─── LE DÉFAUT, TEL QU'UN INVITÉ LE VIT ──────────────────────────────────────
//
// La ruche remettait `npm run join -- hive2_…`, et le panneau d'invitation le
// disait franchement : « il colle cette commande **dans le dossier** ». Le
// dossier. Celui qu'il n'a pas, puisqu'il n'a rien installé.
//
// Le vrai parcours d'un invité était donc en DEUX temps :
//
//     1.  curl -fsSL …/install.sh | sh          ← ne sait rien du billet
//     2.  cd ~/hive && npm run join -- hive2_…  ← suppose le pas 1 réussi
//
// Deux commandes, deux endroits, et un `cd` implicite dont personne ne parle.
// Celui qui invite doit expliquer tout ça de vive voix — et c'est exactement
// ce qui fait qu'on n'invite personne.
//
// ─── CE QUE CE MODULE COMPOSE ────────────────────────────────────────────────
//
// UNE commande, qui installe si besoin puis rejoint, et qui ne demande rien
// d'autre que le billet — lequel porte déjà l'adresse de la ruche.
//
// Le module est PUR : il ne lit ni le réseau ni le disque. La ruche s'en sert
// pour remettre la commande à l'écran, la CLI pour l'imprimer, et le banc pour
// la muter. Trois appelants, une seule vérité.
//
// ─── ET POURQUOI IL REFUSE PLUTÔT QU'IL N'ÉCHAPPE ────────────────────────────
//
// Le résultat est destiné à être COLLÉ DANS UN SHELL. Un billet qui porterait
// un guillemet, un espace ou un `;` ne serait pas un billet mal formé : ce
// serait une injection de commande sur la machine de l'invité, offerte par la
// ruche elle-même et couverte par la confiance qu'il lui accorde.
//
// On pourrait échapper. On refuse, et c'est plus sûr : un billet légitime est
// engendré par `encoderBillet`, donc un préfixe suivi de base64url — un
// alphabet qui n'a AUCUN caractère actif dans un shell. Tout ce qui sort de cet
// alphabet n'est pas un billet à échapper, c'est un billet à jeter.

import { PREFIXE_BILLET } from './acces.js';

/** Les deux mondes où l'on colle une commande. */
export type Systeme = 'posix' | 'windows';

/** Le dépôt public, d'où l'invité tire le script d'entrée. */
export const DEPOT_BRUT = 'https://raw.githubusercontent.com/Micka420-collab/hive/main';

/**
 * Un billet est-il collable dans un shell SANS échappement ?
 *
 * `encoderBillet` rend `hive2_` suivi de base64url, c'est-à-dire `A-Z a-z 0-9
 * - _`. Aucun de ces caractères n'est actif dans un shell POSIX ni dans
 * PowerShell. La garde n'autorise donc rien de plus, et n'a pas à savoir
 * échapper quoi que ce soit.
 *
 * Bornée en longueur : un billet démesuré ne serait pas collable de toute
 * façon, et une commande d'un mégaoctet n'est pas une commande.
 */
export function billetCollable(brut: unknown): brut is string {
  if (typeof brut !== 'string') return false;
  if (!brut.startsWith(PREFIXE_BILLET)) return false;
  const charge = brut.slice(PREFIXE_BILLET.length);
  if (charge.length === 0 || brut.length > 4_000) return false;
  return /^[A-Za-z0-9_-]+$/.test(charge);
}

/**
 * LA commande à coller sur le poste de l'invité, ou `null` si le billet n'est
 * pas collable tel quel.
 *
 * `null` plutôt qu'une exception : l'appelant est une route HTTP ou un écran,
 * et tous deux ont mieux à faire d'un refus que d'une pile.
 */
export function commandeEntree(
  billet: unknown,
  systeme: Systeme,
  depotBrut: string = DEPOT_BRUT,
): string | null {
  if (!billetCollable(billet)) return null;

  if (systeme === 'posix') {
    // `sh -s --` passe les arguments AU SCRIPT lu sur l'entrée standard. Sans
    // le `-s`, `sh` prendrait le billet pour un nom de fichier à exécuter.
    return `curl -fsSL ${depotBrut}/rejoindre.sh | sh -s -- ${billet}`;
  }

  // ─── POURQUOI PAS `irm … | iex` CÔTÉ WINDOWS ───────────────────────────────
  //
  // Même raison qu'`install.ps1`, et elle a déjà été payée : `iex` évalue une
  // EXPRESSION, or un script à `param()` n'est valide qu'au début d'un SCRIPT.
  // Tuyauter un script à paramètres dans `iex` échoue sur AUCUNE machine
  // autrement dit sur toutes, dès la ligne du `param`.
  return (
    `irm ${depotBrut}/rejoindre.ps1 -OutFile "$env:TEMP\\hive-rejoindre.ps1"; ` +
    `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\hive-rejoindre.ps1" -Billet ${billet}`
  );
}
