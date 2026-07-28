// La préparation de l'environnement — installer ce dont le projet a besoin.
//
// ─── LE BESOIN ───────────────────────────────────────────────────────────────
//
// `npm test` sur un clone frais échoue : il n'y a pas de `node_modules`. Pour
// que la ruche puisse vraiment vérifier son travail, il faut une étape avant —
// installer les dépendances que le projet DÉCLARE.
//
// ─── LA RÈGLE QUI SÉPARE TOUT ────────────────────────────────────────────────
//
// **La préparation installe ce que le DÉPÔT déclare, jamais ce que la COMMANDE
// nomme.**
//
// C'est la ligne, et elle n'est pas cosmétique. Comparez :
//
//     npm ci                      ← le dépôt décide (package-lock.json)
//     npm install lodash          ← le HUB décide, et le hub n'est pas le dépôt
//     pip install -r requis.txt   ← le dépôt décide
//     pip install requests        ← le hub décide
//     pip install --index-url http://ailleurs/ …   ← quelqu'un d'autre décide
//
// La frontière de confiance de toute la ruche est LE DÉPÔT QUE L'HÔTE A CHOISI
// DE CONNECTER. `npm ci` exécute les scripts d'installation de ce dépôt, et
// c'est exactement ce qu'on lui demande. `npm install <paquet>` installe ce que
// la commande a nommé — et la commande vient du hub, dont un nœud ne doit pas
// tenir pour acquis qu'il est bien celui qu'il croit (même raisonnement que
// `commande-test.ts`, sur un transport que la ruche accepte encore en clair).
//
// D'où trois refus, et chacun ferme un chemin distinct :
//
//   1. Un BINAIRE hors liste — `sh`, `curl`, `make`.
//   2. Une SOUS-COMMANDE hors liste — `npm run deploy` n'est pas une
//      installation, c'est du code arbitraire déguisé en préparation.
//   3. Un ARGUMENT POSITIONNEL — c'est lui qui nomme un paquet. Seuls les
//      drapeaux passent, et pas ceux qui déplacent la SOURCE.
//
// ─── CE QUE ÇA NE PROTÈGE PAS, ET IL FAUT LE DIRE ────────────────────────────
//
// `npm ci` exécute les scripts `postinstall` du dépôt. Qui contrôle le dépôt
// exécute donc du code sur la machine du membre — exactement comme avec
// `npm test`. On ne prétend pas l'empêcher : on garantit seulement que la
// frontière reste LE DÉPÔT, et pas « ce que le hub a tapé ».
//
// C'est aussi pourquoi la préparation passe par le bac à sable, comme le reste.

/**
 * Les installations reconnues : binaire → sous-commandes admises.
 *
 * Chaque entrée installe ce qu'un fichier du dépôt déclare — un lockfile, un
 * manifeste. Aucune n'accepte de nommer un paquet.
 */
export const PREPARATIONS: Readonly<Record<string, readonly string[]>> = {
  npm: ['ci', 'install', 'i'],
  pnpm: ['install', 'i', 'fetch'],
  yarn: ['install'],
  bun: ['install'],
  pip: ['install'],
  pip3: ['install'],
  poetry: ['install'],
  pipenv: ['install', 'sync'],
  cargo: ['fetch'],
  go: ['mod'],
  bundle: ['install'],
  composer: ['install'],
  mvn: ['dependency:go-offline'],
  dotnet: ['restore'],
};

/** Les wrappers du dépôt, comme dans `commande-test.ts`. */
const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  './gradlew': ['dependencies'],
  gradlew: ['dependencies'],
  './mvnw': ['dependency:go-offline'],
  mvnw: ['dependency:go-offline'],
};

/**
 * Les drapeaux qui déplacent la SOURCE de ce qui s'installe.
 *
 * Ceux-là sont refusés même quand la sous-commande est bonne :
 * `pip install --index-url http://ailleurs/ -r requis.txt` respecte la lettre
 * de la règle — le dépôt nomme les paquets — et en trahit l'esprit, puisque
 * c'est un tiers qui les fournit.
 */
const DRAPEAUX_DE_SOURCE = [
  '--index-url',
  '--extra-index-url',
  '--find-links',
  '--registry',
  '--repo',
  '--repository',
  '--trusted-host',
  '--config',
  '--userconfig',
  '--globalconfig',
  '--prefix',
  '--install-links',
];

/**
 * Les drapeaux qui prennent une valeur ATTENDUE ensuite.
 *
 * `-r requis.txt` a un argument positionnel qui n'est pas un nom de paquet mais
 * un fichier du dépôt : c'est le seul cas où un mot nu est légitime.
 */
const DRAPEAUX_A_VALEUR = ['-r', '--requirement', '-f', '--file'];

export type Verdict = { ok: true } | { ok: false; motif: string };

/** Les sous-commandes admises pour ce binaire, ou `null` s'il est inconnu. */
function admises(bin: string): readonly string[] | null {
  const nu = bin.replace(/\\/g, '/');
  if (nu in WRAPPERS) return WRAPPERS[nu]!;
  // Les suffixes Windows : `npm` y est `npm.cmd`.
  const sansSuffixe = nu.replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase();
  if (/[/\\]/.test(nu)) return null; // un chemin contourne la liste
  return PREPARATIONS[sansSuffixe] ?? null;
}

/**
 * Cette commande de préparation peut-elle tourner sur la machine d'un membre ?
 */
export function jugerPreparation(cmd: readonly string[]): Verdict {
  const bin = cmd[0];
  if (bin === undefined || bin.trim() === '') {
    return { ok: false, motif: 'la commande de préparation est vide' };
  }

  const sous = admises(bin);
  if (!sous) {
    return {
      ok: false,
      motif:
        `« ${bin} » n’installe pas des dépendances. La préparation s’exécute sur la MACHINE ` +
        `D’UN MEMBRE : seuls ${Object.keys(PREPARATIONS).join(', ')} sont admis.`,
    };
  }

  const souscommande = cmd[1];
  if (souscommande === undefined || !sous.includes(souscommande)) {
    return {
      ok: false,
      motif:
        `« ${bin} ${souscommande ?? ''} » n’est pas une installation. ` +
        `Avec ${bin}, seul ${sous.map((s) => `« ${s} »`).join(' ou ')} prépare l’environnement — ` +
        'le reste exécuterait du code arbitraire sous couvert de préparation.',
    };
  }

  // `go mod download` : la sous-sous-commande fait partie du nom de l'acte.
  let debut = 2;
  if (bin.replace(/\.(cmd|exe|bat)$/i, '') === 'go' && souscommande === 'mod') {
    if (cmd[2] !== 'download' && cmd[2] !== 'tidy') {
      return { ok: false, motif: '« go mod » n’installe qu’avec « download » ou « tidy »' };
    }
    debut = 3;
  }

  // TOUT LE RESTE DOIT ÊTRE DES DRAPEAUX. C'est un argument nu qui nomme un
  // paquet, et nommer un paquet, c'est décider à la place du dépôt.
  for (let i = debut; i < cmd.length; i++) {
    const arg = cmd[i]!;
    if (!arg.startsWith('-')) {
      return {
        ok: false,
        motif:
          `« ${arg} » nomme quelque chose à installer. La préparation installe ce que le DÉPÔT ` +
          'déclare (lockfile, manifeste), jamais ce que la commande nomme.',
      };
    }
    const nom = arg.split('=')[0]!;
    if (DRAPEAUX_DE_SOURCE.includes(nom)) {
      return {
        ok: false,
        motif: `« ${nom} » change la source des paquets — c’est alors un tiers qui décide de ce qui s’installe.`,
      };
    }
    // Un drapeau à valeur consomme le mot suivant, qui n'est donc pas un
    // nom de paquet : `-r requis.txt` désigne un fichier du dépôt.
    if (DRAPEAUX_A_VALEUR.includes(nom) && !arg.includes('=')) i++;
  }

  return { ok: true };
}

/**
 * Découpe la queue d'arguments d'une ligne de commande en préparation / tests.
 *
 * `merge-run <id> npm test` marchait déjà et doit continuer de marcher : sans
 * le marqueur `--preparer`, TOUT reste la commande de test. Avec lui, ce qui
 * suit prépare l'environnement, jusqu'à `--tester`.
 *
 *     merge-run <id> npm test                            (inchangé)
 *     merge-run <id> --preparer npm ci --tester npm test
 *
 * Ici plutôt que dans `cli.ts` : ce fichier est pur, et `cli.ts` exécute une
 * commande dès qu'on l'importe. Un test qui voudrait juger ce découpage ferait
 * partir la ruche.
 */
export function decouperMergeArgv(queue: readonly string[]): {
  prepareCommand?: string[];
  testCommand?: string[];
} {
  const iPrep = queue.indexOf('--preparer');
  if (iPrep === -1) return queue.length ? { testCommand: [...queue] } : {};
  const apres = queue.slice(iPrep + 1);
  const iTest = apres.indexOf('--tester');
  const prep = iTest === -1 ? apres : apres.slice(0, iTest);
  // Ce qui PRÉCÈDE `--preparer` reste une commande de test : l'ordre des deux
  // marqueurs sur la ligne ne doit pas changer le sens de ce qu'on a tapé.
  const tests = [...queue.slice(0, iPrep), ...(iTest === -1 ? [] : apres.slice(iTest + 1))];
  return {
    ...(prep.length ? { prepareCommand: prep } : {}),
    ...(tests.length ? { testCommand: tests } : {}),
  };
}
