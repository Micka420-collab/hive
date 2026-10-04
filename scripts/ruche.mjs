// LA RUCHE, EN UNE COMMANDE.
//
//   npm run ruche                    la Reine + les ouvrières + l'écran
//   npm run ruche -- --sans-ecran     un serveur : pas de Vite
//   npm run ruche -- --sans-noeud     observer sans exécuter
//   npm run ruche -- --ecran-seul     l'écran seul, hub déjà lancé ailleurs
//   npm run ruche -- --une-ouvriere   une seule ouvrière, même si plusieurs
//                                     agents sont installés
//
// Les ouvrières : une par famille d'agent réelle détectée (Claude Code,
// Codex, Cursor…) dès qu'il y en a deux — c'est ce qui permet la relecture
// croisée. Une seule sinon. Voir `planOuvrieres` dans `demarrage.ts`.
//
// ─── CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS ────────────────────────
//
// Il LANCE. Toute la composition — quels processus, quels chemins, quel ordre —
// vit dans `src/shared/demarrage.ts`, qui est pur et éprouvé sans démarrer un
// serveur. Ici il ne reste que l'impur : `spawn`, les signaux, le préfixage.
//
// C'est la même séparation que partout dans ce dépôt, et pour la même raison :
// la partie où l'on se trompe de chemin est celle qu'on veut pouvoir tester.
//
// ─── LES DEUX CHOSES QU'IL PREND AU SÉRIEUX ─────────────────────────────────
//
// 1. ARRÊTER TOUT. Un ^C doit emporter les trois processus. Sans ça, un Vite ou
//    un nœud reste accroché à son port, et le prochain démarrage échoue sur
//    « port occupé » — une panne qu'on met dix minutes à relier à sa cause.
//
// 2. NE PAS PASSER PAR `npm`. Sous Windows c'est `npm.cmd`, et `spawn` sans
//    interpréteur ne sait pas le lancer (§ 6.2 du journal, déjà mordu deux
//    fois). On vise des scripts réels — `scripts/lancer.mjs` (tsx enregistré
//    dans le processus, cf. `SCRIPTS.lanceur`) et `vite` —, lancés par le Node
//    qui tourne déjà.

import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// `parseEnv` est LE lecteur de `.env` de Node — celui-là même qui sert à
// `--env-file` et à `process.loadEnvFile`. On le prend plutôt que d'écrire un
// troisième analyseur : les guillemets, les lignes vides et les `#` s'y traitent
// déjà, et exactement comme la Reine les traitera.
import { parseEnv } from 'node:util';
import { exigerAmorce } from './amorce.mjs';

// `fileURLToPath`, jamais `.pathname` : sous Windows ce dernier rend `/D:/…`,
// que `path.resolve` préfixe de la racine du lecteur. C'est le § 6.1 du
// journal, et il a été recommis trois fois.
const RACINE = fileURLToPath(new URL('..', import.meta.url));

// ─── L'AMORCE PASSE AVANT TOUT LE RESTE ──────────────────────────────────────
//
// Ce fichier était lancé par `node --import tsx scripts/ruche.mjs`. Le drapeau
// `--import` est résolu par Node AVANT la première instruction du fichier :
// sur une copie sans dépendances, Node mourait sur
//
//     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from …
//
// et le contrôle soigné qui vit quelques lignes plus bas — celui qui dit
// exactement ce qui manque — n'a jamais pu s'afficher une seule fois. Le garde
// était derrière la porte qu'il gardait.
//
// D'où l'ordre d'aujourd'hui : du Node nu jusqu'ici, l'amorce, puis seulement
// le chargeur TypeScript, demandé à la main.
exigerAmorce(RACINE);

const { register } = await import('tsx/esm/api');
register();

const {
  annonceNonConnectes,
  annonceOuvrieres,
  entreesAbsentes,
  largeurEtiquettes,
  pieces,
  planOuvrieres,
  portAnnonce,
  veutOuvriere,
  voeuDepuisArgv,
} = await import('../src/shared/demarrage.ts');

// ─── OÙ LA RUCHE ÉCOUTE, ET COMMENT ON LE SAIT AVANT ELLE ────────────────────
//
// La bannière annonçait `http://127.0.0.1:7777` ÉCRIT EN DUR. Mesuré sur une
// ruche vivante dont le `.env` disait `HIVE_PORT=7911`, la sortie de démarrage
// se contredisait à cinq lignes d'intervalle :
//
//     reine  projets, tâches, journal · http://127.0.0.1:7777   ← ici
//     reine │    Dashboard : http://127.0.0.1:7911              ← la Reine
//
// `:7911` rendait 200, `:7777` refusait la connexion. La grande ligne — celle
// qu'on lit — était la fausse.
//
// On LIT donc le `.env`, sans le CHARGER : `loadEnvFile` poserait le jeton, le
// secret de session et les clés d'API dans l'environnement de ce processus, que
// TOUS les enfants héritent — l'écran Vite compris, qui n'a rien à en faire. Le
// lanceur n'a besoin que d'un numéro de port, et de ce qui décide combien
// d'ouvrières lancer (`HIVE_AGENT`, `HIVE_NODE_NAME`, `HIVE_WORKDIR`…).
let envFichier = {};
try {
  envFichier = parseEnv(readFileSync(path.join(RACINE, '.env'), 'utf8'));
} catch {
  // Pas de `.env`, ou illisible : le défaut fera l'affaire, et la Reine dira
  // elle-même ce qui manque. Ce n'est pas au lanceur de refuser de lancer.
}

const argv = process.argv.slice(2);
const voeu = voeuDepuisArgv(argv);

// ─── UNE OUVRIÈRE PAR AGENT : SONDER ICI, UNE FOIS ───────────────────────────
//
// La décision vit dans `planOuvrieres`, pure et éprouvée ; ici il ne reste que
// l'impur — le nom de la machine et la sonde des binaires. La fusion garde la
// règle de `portAnnonce` : l'environnement au-dessus du `.env`. La sonde, elle,
// lance chaque binaire avec l'environnement de CE processus, qui ne porte aucun
// secret du `.env` (voir `envSonde`).
//
// Un agent installé que son CLI dit NON CONNECTÉ n'a pas d'ouvrière : elle
// s'inscrirait, la Reine lui confierait du travail, et chaque tâche échouerait
// « non authentifié ». La bannière le dit, avec le remède (`inventaireAgents`).
const envFusionne = { ...envFichier, ...process.env };
let nonConnectes = [];
const plan = veutOuvriere(voeu)
  ? await planOuvrieres({
      argv,
      env: envFusionne,
      hote: hostname(),
      detecter: async () => {
        const { inventaireAgents } = await import('../src/node-client/agent-detect.ts');
        const inventaire = await inventaireAgents(envFusionne);
        nonConnectes = inventaire.nonConnectes;
        return inventaire.tous;
      },
    })
  : undefined;

const liste = pieces(process.execPath, voeu, portAnnonce(envFichier), plan);

// ─── Ce qui manque se dit AVANT de lancer quoi que ce soit ────────────────────
//
// Un `spawn` sur un fichier absent échoue par un ENOENT laconique, plusieurs
// lignes plus bas, mêlé à la sortie des processus qui ont démarré. On regarde
// d'abord.
//
// La DÉCISION vit dans `demarrage.ts` et s'y éprouve : ici elle était nue, parce
// qu'un banc qui tourne sur un dépôt installé n'a jamais rien à trouver
// (§ 2 quaterdecies). Ne reste que l'impur — regarder le disque.
const absents = entreesAbsentes(liste, (f) => existsSync(path.join(RACINE, f)));
if (absents.length > 0) {
  console.error(`✘ Fichier(s) introuvable(s) : ${absents.join(', ')}`);
  console.error('');
  console.error('  Les dépendances ne sont pas installées :');
  console.error('');
  console.error('    npm install --no-fund --no-audit');
  console.error('');
  process.exit(2);
}

const largeur = largeurEtiquettes(liste);

console.log('');
console.log('  🐝  La ruche démarre');
console.log('');
for (const p of liste) console.log(`      ${p.nom.padEnd(largeur)}  ${p.role}`);
console.log('');
for (const l of annonceOuvrieres(plan)) console.log(`      ${l}`);
for (const l of annonceNonConnectes(nonConnectes)) console.log(`      ${l}`);
console.log('      ^C arrête tout.');
console.log('');

// ─── LE SUPERVISEUR EST UN MODULE, PARTAGÉ AVEC L'APPLICATION DE BUREAU ─────
//
// Lancer, préfixer, écouter les morts, arrêter en arbre : tout vivait ici,
// dans un script qui s'exécute à l'import. L'app de bureau (ADR 0013) fait
// exactement la même chose — il n'y a donc qu'UN superviseur,
// `src/ruche-superviseur.ts`, et ce fichier n'en garde que le terminal : où
// vont les lignes, et quand sortir. Les raisons de chaque règle (la ligne sans
// `\n`, le code de sortie d'une ruche amputée, l'ordre d'arrêt sous Windows)
// sont écrites là-bas, à côté du code qui les applique.
const { lancerRuche } = await import('../src/ruche-superviseur.ts');

const ruche = lancerRuche({
  liste,
  cwd: RACINE,
  ligne: ({ flux, etiquette, texte }) =>
    (flux === 'stdout' ? process.stdout : process.stderr).write(`${etiquette}${texte}\n`),
  // Une mort qui emporte la ruche se détache d'une ligne vide : c'est la
  // dernière chose qu'on lira, elle ne doit pas se noyer dans la sortie.
  mort: (_piece, suite) => {
    if (suite.arreter) console.error('');
  },
});

// ─── LE CODE DE SORTIE EST CELUI DE LA RUCHE ─────────────────────────────────
//
// Une Reine morte sur EADDRINUSE rendait 0 au superviseur (§ « le code se pose
// avant le minuteur ») : une ruche amputée passait pour un succès. `fini` porte
// le code demandé par l'arrêt — 0 pour un ^C, celui de la mort sinon.
void ruche.fini.then((code) => {
  process.exitCode = code;
  process.exit(code);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('');
    console.log('  ⏹  Arrêt de la ruche…');
    ruche.arreter(0);
  });
}
