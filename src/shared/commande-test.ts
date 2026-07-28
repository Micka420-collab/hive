// La commande de test d'un merge — et pourquoi elle ne peut pas être n'importe quoi.
//
// ─── LA FAILLE QUE CE FICHIER FERME ──────────────────────────────────────────
//
// `POST /api/projects/:id/merge/run` accepte un `testCommand: string[]` que le
// hub relaie au premier nœud en ligne, lequel exécute :
//
//     const [bin, ...args] = cmd;
//     spawn(bin, args, { shell: false, cwd, env });
//
// `shell: false` est bien posé, et il ne protège de RIEN ici : ce qu'il
// empêche, c'est l'interprétation d'une chaîne par un shell. Or `argv[0]` EST
// le binaire. `["/bin/sh", "-c", "curl … | sh"]` s'exécutait tel quel sur la
// machine d'un membre, avec ses droits et son `HOME`.
//
// Deux aggravations rendaient l'affaire sérieuse plutôt que théorique :
//
//   1. LE JETON DE RUCHE N'EST PAS UN SECRET D'ADMINISTRATEUR. Les anciennes
//      invitations `hive1_` le contiennent EN CLAIR, sans expiration ni
//      révocation individuelle — le code le dit lui-même. Quiconque en a reçu
//      une, un jour, gardait donc l'exécution de code sur toutes les machines
//      de l'essaim, pour toujours.
//   2. CE CHEMIN NE PASSE PAS PAR LE BAC À SABLE. `merge-runner.ts` n'appelle
//      pas `envelopper()`, contrairement aux adaptateurs de tâches. Autrement
//      dit `HIVE_ISOLEMENT=exige` — le réglage qu'on pose précisément quand on
//      prête sa machine à des inconnus — n'avait aucun effet ici.
//
// ─── CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS ─────────────────────────
//
// Il restreint le BINAIRE à une liste de lanceurs de tests connus. Il ne
// prétend pas rendre la commande inoffensive : `npm test` exécute ce que le
// `package.json` du dépôt contient, et c'est exactement ce qu'on lui demande.
// La frontière de confiance reste le dépôt que l'hôte a choisi de connecter —
// elle n'est plus « n'importe quel exécutable de la machine du membre ».
//
// La garde est appliquée AUX DEUX BOUTS : le hub refuse tôt avec un message
// clair, et le nœud refuse à son tour. La seconde est celle qui compte — un
// nœud ne doit pas tenir pour acquis que le hub est bien celui qu'il croit,
// surtout sur un transport en clair que la ruche accepte encore.

/**
 * Les lanceurs de tests admis.
 *
 * Choisis pour couvrir ce qu'on trouve réellement dans un dépôt, pas pour être
 * exhaustifs : une liste trop large redevient « n'importe quoi », et une liste
 * trop courte pousse les gens à contourner la garde.
 */
export const BINAIRES_DE_TEST = [
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'deno',
  'make',
  'cargo',
  'go',
  'pytest',
  'python',
  'python3',
  'tox',
  'mvn',
  'gradle',
  'dotnet',
  'composer',
  'rake',
  'bundle',
  'phpunit',
  'vitest',
  'jest',
] as const;

const ADMIS = new Set<string>(BINAIRES_DE_TEST);

/**
 * Les wrappers que le DÉPÔT fournit lui-même, invoqués par chemin relatif.
 *
 * `./gradlew test` est la façon normale de tester un projet Gradle, et `./mvnw`
 * celle d'un projet Maven : refuser ces deux-là fermerait tout l'écosystème JVM
 * sans recours. Ils sont admis parce qu'ils ne déplacent pas la frontière de
 * confiance — ce sont des fichiers du dépôt cloné, exactement comme le script
 * `test` du `package.json` que `npm test` exécute déjà.
 *
 * La liste contient des chaînes ENTIÈRES, comparées telles quelles. Aucune
 * normalisation de chemin n'entre en jeu : il n'y a donc rien à contourner avec
 * un `..` ou un lien symbolique dans le nom.
 *
 * Les deux formes sont admises parce que les deux sont correctes selon l'OS :
 * Windows cherche d'abord dans le répertoire courant (`gradlew` suffit), les
 * autres non (`./gradlew` est nécessaire).
 */
const WRAPPERS = new Set([
  './gradlew',
  'gradlew',
  './gradlew.bat',
  'gradlew.bat',
  './mvnw',
  'mvnw',
  './mvnw.cmd',
  'mvnw.cmd',
]);

/** Suffixes que Windows ajoute aux mêmes lanceurs (`npm` y est `npm.cmd`). */
const SUFFIXES_WINDOWS = ['.cmd', '.exe', '.bat', '.ps1'];

export type Verdict = { ok: true } | { ok: false; motif: string };

/**
 * Cette commande de test peut-elle être exécutée sur la machine d'un membre ?
 *
 * Le refus porte sur le BINAIRE seul. Les arguments qui suivent sont ceux d'un
 * lanceur connu, et les borner davantage casserait des usages légitimes sans
 * fermer grand-chose : qui contrôle le dépôt contrôle déjà ce que `npm test`
 * exécute.
 */
export function jugerCommandeTest(cmd: readonly string[]): Verdict {
  const bin = cmd[0];
  if (bin === undefined || bin.trim() === '') {
    return { ok: false, motif: 'la commande de test est vide' };
  }

  // Les wrappers du dépôt sont reconnus à leur nom exact, AVANT la règle sur
  // les chemins — c'est la seule exception, et elle est close.
  if (WRAPPERS.has(bin.replace(/\\/g, '/').toLowerCase())) return { ok: true };

  // Un chemin, c'est le contournement évident de la liste : `./npm`,
  // `/usr/bin/npm`, `..\\npm`. On refuse tout ce qui n'est pas un nom nu.
  if (/[/\\]/.test(bin)) {
    return {
      ok: false,
      motif:
        `« ${bin} » est un chemin. Donnez le nom du lanceur seul (par exemple « npm »), ` +
        "pour qu'il soit résolu par le PATH de la machine qui exécute.",
    };
  }
  // Un binaire commençant par un tiret serait lu comme une option par ce qui
  // l'entoure, ici comme ailleurs.
  if (bin.startsWith('-')) {
    return { ok: false, motif: `« ${bin} » commence par un tiret` };
  }

  const nu = SUFFIXES_WINDOWS.reduce(
    (v, suffixe) => (v.toLowerCase().endsWith(suffixe) ? v.slice(0, -suffixe.length) : v),
    bin,
  );

  if (!ADMIS.has(nu.toLowerCase())) {
    return {
      ok: false,
      motif:
        `« ${bin} » n'est pas un lanceur de tests reconnu. Cette commande s'exécute sur la ` +
        "MACHINE D'UN MEMBRE : seuls sont admis " +
        `${BINAIRES_DE_TEST.join(', ')}.`,
    };
  }

  return { ok: true };
}
