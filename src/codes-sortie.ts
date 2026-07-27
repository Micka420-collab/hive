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
