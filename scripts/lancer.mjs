// LA PORTE UNIQUE — tout lancement destiné à un humain passe par ici.
//
//     node scripts/lancer.mjs src/cli.ts doctor
//
// ─── POURQUOI UNE PORTE, ET UNE SEULE ────────────────────────────────────────
//
// Les scripts de `package.json` invoquaient chacun le binaire `tsx` :
//
//     "cli": "tsx src/cli.ts"
//
// Sur une copie où les dépendances manquent, ça donne, sous Windows :
//
//     'tsx' n’est pas reconnu en tant que commande interne ou externe
//
// Un message qui ne nomme ni le dépôt, ni `npm install`, ni ce qu'il faut faire
// — et que même `hive doctor` recevait, alors que dire ce qui manque est son
// métier entier.
//
// Chaque script était une occasion d'oublier le contrôle. On en fait donc UN
// chemin : l'amorce s'exécute ici, et aucun point d'entrée ne peut la contourner
// sans qu'un test le voie (`tests/amorce.test.ts` relit `package.json`).
//
// C'est le § 9 bis du journal appliqué à l'envers : deux chemins pour le même
// geste, et c'est toujours le moins fréquenté qui pourrit. Ici il n'en reste
// qu'un.
//
// ─── CE QUI RESTE HORS DE CETTE PORTE, ET POURQUOI ───────────────────────────
//
// `dev`, `test`, `lint`, `build`, `loupe` : des commandes de développement.
// Elles s'adressent à quelqu'un qui a déjà `node_modules` — et `tsx watch`
// n'existe que dans le binaire de tsx, pas dans son API de chargement.
// La frontière est « est-ce qu'un humain qui découvre le dépôt tape ça ? ».

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exigerAmorce } from './amorce.mjs';

// `fileURLToPath`, jamais `.pathname` : sous Windows ce dernier rend `/D:/…`,
// que `path.resolve` préfixe ensuite de la racine du lecteur (§ 6.1 du
// journal, recommis trois fois).
const RACINE = fileURLToPath(new URL('..', import.meta.url));

// ─── LE CONTRÔLE, AVANT LE MOINDRE `import` D'UNE DÉPENDANCE ─────────────────
//
// Tout ce qui précède cette ligne est du Node nu. `exigerAmorce` s'arrête sur
// un message lisible plutôt que sur une trace de résolution de module.
exigerAmorce(RACINE);

const [entree, ...reste] = process.argv.slice(2);

if (entree === undefined) {
  process.stderr.write('usage : node scripts/lancer.mjs <fichier.ts> [arguments…]\n');
  process.exit(2);
}

const cible = path.resolve(RACINE, entree);
if (!existsSync(cible)) {
  process.stderr.write(`✘ Point d’entrée introuvable : ${entree}\n`);
  process.exit(2);
}

// ─── L'ARGV QUE LE POINT D'ENTRÉE DOIT VOIR ──────────────────────────────────
//
// Sans cette réécriture, `src/cli.ts` lirait `process.argv.slice(2)` et y
// trouverait `['src/cli.ts', 'doctor']` : la première commande tapée serait
// toujours avalée par le nom du fichier. On rend donc l'argv que produirait
// `tsx src/cli.ts doctor`, à l'identique — argv[1] est le script exécuté.
process.argv = [process.argv[0], cible, ...reste];

// `tsx/esm/api` plutôt que `--import tsx` : le drapeau est résolu par Node avant
// que la moindre ligne de ce fichier ne tourne, donc AVANT l'amorce. L'appel,
// lui, arrive après — et ne peut s'exécuter que si l'amorce a laissé passer.
const { register } = await import('tsx/esm/api');
register();

// ─── `pathToFileURL`, ET SURTOUT PAS LE CHEMIN NU ────────────────────────────
//
// `import()` prend un SPÉCIFICATEUR, pas un chemin. Sous Windows, `cible` vaut
// `C:\Users\…\src\cli.ts` : Node y lit un schéma d'URL `c:` et refuse.
//
//     Only URLs with a scheme in: file, data, and node are supported by the
//     default ESM loader. Received protocol 'c:'
//
// Sous Linux et macOS, un chemin absolu commence par `/` et passe — donc une CI
// à deux systèmes sur trois resterait verte pendant que la ruche serait morte
// chez tout le monde sous Windows. C'est le § 6.1 du journal sous une troisième
// forme : la conversion chemin ↔ URL ne s'improvise jamais.
//
// `tests/amorce.test.mjs` LANCE ce fichier dans un vrai processus, ce qui est la
// seule façon de voir ça : aucune relecture ne distingue les deux, et sur deux
// systèmes sur trois elles se comportent pareil.
await import(pathToFileURL(cible).href);
