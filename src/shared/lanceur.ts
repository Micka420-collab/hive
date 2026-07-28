// Quel exécutable lancer VRAIMENT, quand le nom donné n'en est pas un.
//
// ─── LE DÉFAUT, ET COMMENT IL S'EST MONTRÉ ───────────────────────────────────
//
// La préparation d'un merge lance `npm ci`. Sur un nœud Windows, ça ne marchait
// pas — et personne ne pouvait le savoir, parce qu'aucune CI ne tournait sur
// Windows. Le premier run l'a dit en une ligne :
//
//     [hive] échec du lancement : spawn npm ENOENT
//
// Sous Windows, `npm` n'est pas un exécutable : c'est `npm.cmd`, un script de
// commandes. Et Node documente noir sur blanc qu'un `.cmd` ou un `.bat` ne peut
// pas être lancé sans passer par `cmd.exe`. La préparation d'environnement
// était donc INOPÉRANTE sur toute machine Windows, en silence.
//
// ─── POURQUOI PAS `shell: true`, QUI RÉGLERAIT ÇA EN UN CARACTÈRE ────────────
//
// Parce que la contrainte §5.1 est écrite comme absolue, et qu'elle a raison :
// `spawn(bin, argv, { shell: false })`, jamais autrement. Passer par un
// interpréteur de commandes rendrait au shell le soin de redécouper ce que nous
// avions pris soin de garder en tableau — et la commande vient d'un dépôt
// connecté, pas de nous.
//
// On fait donc l'inverse : on VISE L'EXÉCUTABLE RÉEL, ce qui est plus strict
// qu'avant, pas moins. `npm` est un script JavaScript livré avec Node ; on
// lance donc l'interpréteur, qui lui est un vrai binaire, avec ce script en
// premier argument. Aucun shell n'intervient, à aucun moment.
//
// ─── ET CE QU'ON NE SAIT PAS FAIRE, ON LE DIT ────────────────────────────────
//
// `yarn`, `pnpm`, `mvn`, `gradle`… sont aussi des shims `.cmd` sous Windows,
// mais ils ne sont livrés avec rien : leur script n'est pas à un endroit qu'on
// puisse déduire. Plutôt que de les laisser mourir sur un `ENOENT` que personne
// ne sait lire, on refuse en NOMMANT la raison et l'issue.
//
// Ce module est PUR : il reçoit la plateforme en paramètre. C'est ce qui rend
// la branche Windows vérifiable depuis Linux — sans quoi elle ne serait
// éprouvée que sur la machine où on ne la teste jamais.

/** Ce qu'il faut faire du binaire demandé. */
export type Decision =
  /** Un vrai exécutable : on le lance tel quel. C'est le cas de tout POSIX. */
  | { genre: 'tel-quel' }
  /**
   * Un script livré avec Node : on lance l'interpréteur avec ce script.
   * `script` est le chemin RELATIF au dossier de Node, à résoudre par l'appelant.
   */
  | { genre: 'via-node'; script: string }
  /** Un shim qu'on ne sait pas lancer sans shell. On refuse, et on l'explique. */
  | { genre: 'refus'; motif: string };

/**
 * Les lanceurs livrés AVEC Node, donc dont le script est trouvable.
 *
 * La valeur est le chemin sous le dossier de l'exécutable Node. C'est
 * l'agencement d'une installation Node standard sous Windows, et c'est le seul
 * cas où l'on peut déduire un chemin sans le chercher au hasard.
 */
const LIVRES_AVEC_NODE: Readonly<Record<string, string>> = {
  npm: 'node_modules/npm/bin/npm-cli.js',
  npx: 'node_modules/npm/bin/npx-cli.js',
};

/**
 * Ce qui EST un vrai `.exe` sous Windows, et n'a donc besoin de rien.
 *
 * Liste explicite plutôt que « tout le reste passe » : un shim inconnu qu'on
 * laisserait filer redonnerait exactement l'`ENOENT` illisible qu'on corrige.
 */
const VRAIS_BINAIRES_WIN32: ReadonlySet<string> = new Set([
  'node',
  'deno',
  'bun',
  'go',
  'cargo',
  'dotnet',
  'python',
  'python3',
  'py',
  'make',
  'git',
  'docker',
  'podman',
]);

/** Le nom du lanceur, sans chemin ni extension, en minuscules. */
function nomNu(bin: string): string {
  const dernier = bin.replace(/\\/g, '/').split('/').pop() ?? bin;
  return dernier.replace(/\.(cmd|bat|exe|ps1)$/i, '').toLowerCase();
}

/**
 * Que faire du binaire `bin` sur la plateforme `plateforme` ?
 *
 * Hors Windows, la réponse est toujours « tel quel » : les scripts y portent un
 * shebang, et `spawn` les exécute sans intermédiaire. Le problème n'existe que
 * là où l'on ne teste jamais.
 */
export function decider(bin: string, plateforme: string): Decision {
  if (plateforme !== 'win32') return { genre: 'tel-quel' };

  // Un chemin ABSOLU vers un vrai fichier reste la responsabilité de l'appelant :
  // s'il a résolu lui-même, on ne le contredit pas. Mais un `.cmd` explicite,
  // lui, ne s'exécutera pas plus parce qu'il est absolu.
  const nu = nomNu(bin);

  const script = LIVRES_AVEC_NODE[nu];
  if (script !== undefined) return { genre: 'via-node', script };

  if (VRAIS_BINAIRES_WIN32.has(nu)) return { genre: 'tel-quel' };

  return {
    genre: 'refus',
    motif:
      `« ${nu} » ne peut pas être lancé sur un nœud Windows : c’est un script de ` +
      `commandes (.cmd), et le lancer demanderait un interpréteur de commandes — ` +
      `ce que la ruche s’interdit, parce que la commande vient du dépôt connecté ` +
      `et non de nous. Utilisez « npm » (livré avec Node, donc lançable sans shell), ` +
      `ou faites tourner ce nœud sous Linux ou macOS.`,
  };
}
