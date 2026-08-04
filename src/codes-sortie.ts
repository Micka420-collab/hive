// Les codes de sortie de l'accueil — le contrat avec les scripts.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Un installeur qui rend toujours `0` ou `1` n'est pas scriptable : Ansible,
// systemd ou un `Makefile` ne peuvent pas distinguer « déjà en place » de
// « port occupé » de « on a refusé pour raison de sécurité ». La seule
// réponse possible devient « relancer et espérer ».
//
// Ces codes sont donc une INTERFACE PUBLIQUE : ils sont documentés dans le
// README (§9 de `MISSION-ACCUEIL.md`), et les changer casse les scripts de
// quelqu'un. On en ajoute ; on n'en renumérote pas.
//
// Ils sont ici, seuls, dans un module sans dépendance et sans effet : n'importe
// quelle partie du code peut s'y référer sans rien entraîner avec elle.

/** Ce que le processus rend, et ce que ça veut dire pour qui l'appelle. */
export const CODE = {
  /** Succès — y compris « il n'y avait rien à faire ». */
  SUCCES: 0,
  /** Erreur non classée. Le fourre-tout, à n'utiliser qu'en dernier recours. */
  ERREUR: 1,
  /** Un prérequis manque : Node trop ancien, disque plein, droits absents. */
  PREREQUIS: 2,
  /** En mode non interactif, une réponse obligatoire n'a pas été fournie. */
  REPONSE_MANQUANTE: 3,
  /** Le port demandé est déjà pris par quelqu'un d'autre. */
  PORT_OCCUPE: 4,
  /** Refus de sécurité : jeton faible, écoute publique sans jeton fort. */
  REFUS_SECURITE: 5,
  /**
   * Interrompu par l'humain (Ctrl+C).
   *
   * 130 et pas autre chose : c'est la convention POSIX `128 + SIGINT(2)`, celle
   * que tous les shells attendent. Un `^C` qui rendrait `1` se confondrait avec
   * un échec, et un script de supervision réessaierait une installation que
   * quelqu'un venait tout juste d'annuler à la main.
   */
  INTERROMPU: 130,
} as const;

export type CodeSortie = (typeof CODE)[keyof typeof CODE];

/** L'explication d'un code, pour le README et pour `--json`. */
export const SENS: Record<CodeSortie, string> = {
  [CODE.SUCCES]: 'succès (y compris « rien à faire »)',
  [CODE.ERREUR]: 'erreur générique',
  [CODE.PREREQUIS]: 'prérequis manquant (Node, disque…)',
  [CODE.REPONSE_MANQUANTE]: 'réponse requise absente en mode non interactif',
  [CODE.PORT_OCCUPE]: 'port occupé',
  [CODE.REFUS_SECURITE]: 'refus de sécurité (jeton faible, écoute publique sans jeton fort)',
  [CODE.INTERROMPU]: 'interrompu par l’utilisateur',
};

/**
 * La légende des codes, telle qu'elle s'affiche dans `--help`.
 *
 * ─── POURQUOI ELLE EST ICI, ET PAS DANS L'AIDE ───────────────────────────────
 *
 * Elle était écrite À LA MAIN, mot pour mot, dans DEUX fichiers
 * (`installer.ts` et `installer-main.ts`). Deux copies d'une même vérité
 * dérivent toujours dans le même sens : on ajoute un code, on met à jour l'aide
 * qu'on avait sous les yeux, et l'autre ment à partir de ce jour-là.
 *
 * Elles avaient d'ailleurs DÉJÀ dérivé, toutes les deux du même côté : elles
 * annonçaient six codes sur sept. `ERREUR` (1) manquait — c'est-à-dire le
 * fourre-tout, celui qu'un script rencontre le plus souvent après `0`.
 * Quelqu'un dont l'installation rendait `1` lisait `--help` et n'y trouvait
 * rien : ni ce que le code voulait dire, ni même qu'il existait.
 *
 * La table `SENS` était là, juste au-dessus, et disait la vérité pour les sept.
 * Personne ne s'en servait. C'est le motif de la nuit, une fois de plus : la
 * règle est écrite, et ce qui s'affiche est une copie.
 *
 * ─── POURQUOI L'ORDRE EST CELUI DE `CODE` ────────────────────────────────────
 *
 * `Object.values` suit l'ordre de déclaration, qui est l'ordre croissant des
 * codes — et c'est celui dans lequel on les cherche quand on tient un numéro
 * dans la main.
 */
export function legendeCodes(): string {
  const codes = Object.values(CODE) as CodeSortie[];
  return `Codes de sortie : ${codes.map((c) => `${c} ${SENS[c]}`).join(' · ')}.`;
}
