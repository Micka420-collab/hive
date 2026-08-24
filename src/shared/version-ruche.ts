// Quelle version de la ruche tourne ici, et comment la mettre à jour.
//
// ─── CE QUI MANQUAIT, ET QUI BLOQUAIT TOUT LE RESTE ─────────────────────────
//
// « rajoute un bouton pour faire la mise à jour » — puis, précisé : mettre à
// jour Hive LUI-MÊME depuis son dépôt.
//
// En cherchant par où commencer, un fait s'est imposé : la ruche ne sait pas
// ce qu'elle fait tourner. `package.json` annonce `0.2.0` et ne bouge jamais ;
// le dépôt n'a ni étiquette ni version publiée. Comparer « ma version » à « la
// dernière » était donc impossible — il n'y avait ni l'une ni l'autre.
//
// Ce module tient la première : DIRE ce qui tourne, et donner la marche à
// suivre exacte pour passer à la suite. C'est le fait dont toutes les formes
// du bouton ont besoin, quelle que soit celle qu'on choisira.
//
// ─── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
//
// Il n'exécute rien, ne va sur aucun réseau, ne lance pas `git`. Une ruche qui
// se met à jour toute seule peut se casser toute seule — et ce dépôt sait
// précisément comment : `better-sqlite3` est une dépendance OPTIONNELLE que
// npm écarte en silence, ce qui donne une ruche qui démarre morte. La marche à
// suivre le dit ; un bouton qui l'aurait ignoré aurait cassé une installation
// qui marchait.

/** Ce que la ruche sait d'elle-même, tel qu'on a pu le lire. */
export interface VersionRuche {
  /** Le commit exact, ou `null` quand on ne peut pas le savoir. */
  readonly commit: string | null;
  /** La branche suivie, si elle est lisible. */
  readonly branche: string | null;
  /** La version déclarée dans `package.json` — informative, elle bouge peu. */
  readonly declaree: string;
}

/**
 * Comment cette ruche a été posée. La marche à suivre en dépend entièrement.
 *
 * `inconnue` n'est pas un échec : une ruche installée depuis une archive ou
 * une image n'a pas de `.git`, et c'est normal. Ce qui serait fautif, c'est de
 * lui inventer un commit.
 */
export type Pose = 'git' | 'inconnue';

/**
 * La version que le `package.json` DÉCLARE, ou « inconnue ».
 *
 * ─── POURQUOI CETTE FONCTION EXISTE SÉPARÉMENT DE SA LECTURE ────────────────
 *
 * Ces trois lignes vivaient dans `server.ts`, à l'intérieur d'une expression
 * exécutée à l'import qui lisait `package.json` sur le disque. La loupe y a
 * trouvé TROIS mutants survivants d'affilée — `&&` → `||` deux fois, `> 0` →
 * `>= 0` une — et aucun n'était équivalent : le dernier, par exemple, faisait
 * annoncer une version VIDE au lieu d'« inconnue ».
 *
 * Ils survivaient parce qu'aucun banc ne pouvait les atteindre. L'entrée de
 * cette décision n'était pas un argument, c'était un fichier du dépôt : il n'y
 * a qu'un `package.json`, il est bien formé, et rien ne permet d'en présenter
 * un autre. Du code soudé à une lecture de disque n'est pas éprouvable — ce
 * n'est pas un manque de bancs, c'est une conséquence de sa forme.
 *
 * La décision est donc ici, PURE, et `server.ts` ne garde que la lecture.
 */
export function versionDeclaree(paquet: unknown): string {
  if (typeof paquet === 'object' && paquet !== null) {
    const v = (paquet as Record<string, unknown>).version;
    // `length > 0`, pas `>= 0` : un `"version": ""` est une déclaration
    // ABSENTE, pas une version vide. La rendre telle quelle afficherait
    // « version déclarée  » avec un trou à la place du numéro.
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return 'inconnue';
}

export function poseDepuis(v: VersionRuche): Pose {
  return v.commit !== null ? 'git' : 'inconnue';
}

/** Le commit raccourci pour l'œil — jamais tronqué sous 7, jamais inventé. */
export function commitCourt(commit: string | null): string | null {
  if (commit === null) return null;
  const propre = commit.trim();
  return /^[0-9a-f]{7,40}$/i.test(propre) ? propre.slice(0, 7) : null;
}

/**
 * Ce que la ruche répond à « quelle version fais-tu tourner ? ».
 *
 * Quand elle ne sait pas, elle le DIT. Une ruche qui annoncerait « 0.2.0 » en
 * guise de réponse laisserait croire à une version suivie, alors que ce
 * numéro n'a pas bougé depuis des mois et ne bougera pas au prochain `git
 * pull` : ce serait une fausse certitude, plus nuisible qu'un aveu.
 */
export function direVersion(v: VersionRuche, lang: 'fr' | 'en' = 'fr'): string {
  const court = commitCourt(v.commit);
  if (court === null) {
    return lang === 'en'
      ? `This hive does not know which commit it runs (declared version ${v.declaree}). It was likely installed from an archive or an image rather than a git clone.`
      : `Cette ruche ne sait pas quel commit elle fait tourner (version déclarée ${v.declaree}). Elle a probablement été posée depuis une archive ou une image, plutôt qu'un clone git.`;
  }
  const branche =
    v.branche !== null ? (lang === 'en' ? ` on ${v.branche}` : ` sur ${v.branche}`) : '';
  return lang === 'en'
    ? `This hive runs commit ${court}${branche} (declared version ${v.declaree}).`
    : `Cette ruche fait tourner le commit ${court}${branche} (version déclarée ${v.declaree}).`;
}

/**
 * La marche à suivre, EN ARGUMENTS SÉPARÉS — à lire, puis à coller soi-même.
 *
 * L'ordre n'est pas décoratif :
 *   1. `git pull` — le code ;
 *   2. `npm ci` — les dépendances, à l'identique du verrou ;
 *   3. la SONDE de `better-sqlite3`, parce que npm l'écarte en silence et que
 *      la ruche démarrerait morte sans que rien ne le dise ;
 *   4. `npm run build` — le tableau de bord ET le hub ;
 *   5. redémarrer.
 *
 * L'étape 3 est celle qu'on oublie, et c'est celle que ce dépôt a payée.
 */
export function marcheASuivre(pose: Pose): readonly (readonly string[])[] {
  if (pose !== 'git') return [];
  return Object.freeze([
    Object.freeze(['git', 'pull', '--ff-only']),
    Object.freeze(['npm', 'ci']),
    // La forme MINIMALE, et sans métacaractère de shell — ces commandes sont
    // faites pour être collées dans un terminal. `require` suffit : si le
    // module natif manque, node sort en erreur, et le code de sortie EST le
    // verdict. Rien à lire, rien à interpréter.
    //
    // Le Dockerfile en fait une plus profonde (il ouvre une base et écrit
    // dedans) parce qu'il construit l'image ; ici on répond à « est-ce que le
    // module a survécu au `npm ci` ? », et c'est la question qui coûte.
    Object.freeze(['node', '-e', "require('better-sqlite3')"]),
    Object.freeze(['npm', 'run', 'build']),
  ]);
}

/**
 * Ce qu'on dit à quelqu'un dont la ruche n'a pas de `.git`.
 *
 * On ne lui propose PAS `git pull` : il n'a pas de dépôt, la commande
 * échouerait, et il chercherait pourquoi. On le renvoie à la porte par
 * laquelle il est entré.
 */
export function conseilSansGit(lang: 'fr' | 'en' = 'fr'): string {
  return lang === 'en'
    ? 'Without a git clone there is nothing to pull: update through the door you came in — re-run the installer, or pull the new image if the hive runs in a container.'
    : 'Sans clone git, il n’y a rien à tirer : mettez à jour par la porte d’entrée que vous avez prise — relancez l’installeur, ou tirez la nouvelle image si la ruche tourne en conteneur.';
}
