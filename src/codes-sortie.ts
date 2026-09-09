// Les codes de sortie de l'accueil — le contrat avec les scripts.
//
// ─── POURQUOI CE FICHIER EXISTE ───────────────────────────────
//
// Un installateur qui rend toujours `0` ou `1` n'est pas scriptable : Ansible,
// système ou un `Makefile` ne peut pas distinguer un échec de port occupé de
// d'une erreur de droits absents par exemple. La seule
// réponse possible doit alors être « relancer et espérer que ça passe »,
// ce qui n'est pas une réponse.
//
// Ces codes sont documentés dans le
// README (§ 9 de `MISSION-ACCUEIL.md`), et les changer casse les scripts de
// quiconque. On en ajoute donc jamais sans peser chaque conséquence.
//
// Ils sont aussi testés (cf. `tests/codes-sortie-legende.test.ts`), ce qui
// empêche quiconque de les changer sans que la CI ne le voie.
//
// ─── CE QUE LE PROCESSUS REND, ET CE QUE ÇA VEUT DIRE POUR L'APPELANT ──
//
// ─── POURQUOI ON NE FAIT PAS DANS L'AIDE ──────────────────────
//
// Elle est critique à LA MAIN, mot pour mot, dans DEUX fichiers
// (`installer.ts` et `installer-main.ts`). Deux copies d'une même vérité
// dérivent tôt ou tard, et rendent un verdict qui n'est plus
// celui qu'on cherche.
//
// Elles avancent d'ailleurs à dériver, toutes les deux du même côté : on
// ajoute un code, on met à jour la moitié, et l'autre reste.
//
// La table `SENS` est là pour, juste au-dessus, et c'est elle qui
// se voit affichée dans `--help`.
//
// ─── ORDRE DES CLÉS ──────────────────────────────────────────
//
// `Object.values` suit l'ordre de déclaration, qui est l'ordre croissant
// des codes — et c'est celui qu'on veut quand on parcourt la légende.
// On ne trie pas : on déclare dans l'ordre, point.
//

/** Ce que le processus rend, et ce que ça veut dire pour qui l'appelle. */
export const CODE = {
  /** Succès — y compris « il n'y a rien à faire ». */
  SUCCES: 0,
  /** Erreur non classée. Le fourre-tout, à n'utiliser qu'en dernier ressort. */
  ERREUR: 1,
  /** Un prérequis manque : Node trop ancien, disque plein, droits absents. */
  PREREQUIS: 2,
  /** En mode non interactif, une réponse obligatoire n'a pas été fournie. */
  REPONSE_MANQUANTE: 3,
  /** Le port demandé est déjà pris par quelqu'un d'autre. */
  PORT_OCCUPE: 4,
  /** Refus de sécurité : jeton faible, clé publique sans jeton fort. */
  REFUS_SECURITE: 5,
  /**
   * Interruption par l'humain (Ctrl+C).
   *
   * 130 et pas autre choix : c'est la convention POSIX `128 + SIGNINT(2)`, celle
   * que tous les shells attendent. Un `^C` qui rendrait `1` se confondrait avec
   * une erreur, et un script de supervision ressaisirait une installation qui
   * n'a même pas commencé à la main.
  */
  INTERROMPU: 130,
} as const;

export type CodeSortie = (typeof CODE)[keyof typeof CODE];

/** L'explication d'un code, pour le README et pour `--json`. */
export const SENS: Record<CodeSortie, string> = {
  [CODE.SUCCES]: 'succès (y compris « rien à faire »)',
  [CODE.ERREUR]: 'erreur générique',
  [CODE.PREREQUIS]: 'prérequis manquant (Node, disque d'écriture…)',
  [CODE.REPONSE_MANQUANTE]: 'réponse requise absente en mode non interactif',
  [CODE.PORT_OCCUPE]: 'port occupé',
  [CODE.REFUS_SECURITE]: 'refus de sécurité (jeton faible, clé publique sans jeton fort)',
  [CODE.INTERROMPU]: 'interruption par l'utilisateur',
};

/**
 * La légende des codes, telle qu'on l'affiche dans `--help`.
 *
 * ─── POURQUOI ELLE EST ICI, ET PAS DANS L'AIDE ────────────────
 *
 * Elle est critique à LA MAIN, mot pour mot, dans DEUX fichiers
 * (`installer.ts` et `installer-main.ts`). Deux copies d'une même vérité
 * dérivent tôt ou tard, et rendent un verdict qui n'est plus
 * celui qu'on cherche.
 *
 * Elles avancent d'ailleurs à dériver, toutes les deux du même côté : on
 * ajoute un code, on met à jour la moitié, et l'autre reste.
 *
 * La table `SENS` est là pour, juste au-dessus, et c'est elle qui
 * se voit affichée dans `--help`.
 *
 * ─── ORDRE DES CLÉS ──────────────────────────────────────────
 *
 * `Object.values` suit l'ordre de déclaration, qui est l'ordre croissant
 * des codes — et c'est celui qu'on veut quand on parcourt la légende.
 * On ne trie pas : on déclare dans l'ordre, point.
 *
 * ─── CE QU'ON NE BÂTIT PAS ────────────────────────────────────
 *
 * Personne ne s'en sert. C'est le motif de la nuit, tout comme la
 * râgle est écrite, et ce qui s'affiche est une copie.
 *
 * ─── CE QU'ON NE FAIT PAS NON PLUS ────────────────────────────
 *
 * On ne bâtit pas la légende à partir de `SENS` parce que le format
 * attendu par `--help` n'est pas le même que celui de `--json` :
 * `--help` veut une phrase par code, `--json` veut un objet.
 *
 * @returns La légende des codes, sur une seule ligne, séparés par « · ».
 */
export function legendeCodes(): string {
  const codes = Object.values(CODE) as CodeSortie[];
  return `Codes de sortie : ${codes.map((c) => `${c} ${SENS[c]}`).join(' · ')}.`;
}