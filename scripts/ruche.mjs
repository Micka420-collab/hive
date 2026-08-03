// LA RUCHE, EN UNE COMMANDE.
//
//   npm run ruche                  la Reine + une ouvrière + l'écran
//   npm run ruche -- --sans-ecran   un serveur : pas de Vite
//   npm run ruche -- --sans-noeud   observer sans exécuter
//   npm run ruche -- --ecran-seul   l'écran seul, hub déjà lancé ailleurs
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
//    fois). On vise les scripts réels de `tsx` et `vite`, lancés par le Node qui
//    tourne déjà.

import { spawn } from 'node:child_process';
// `setTimeout` explicite : ce fichier est du `.mjs`, que la configuration ESLint
// ne traite pas comme un module Node — les globales du navigateur n'y sont pas
// déclarées, et `no-undef` a raison de le dire.
import { setTimeout as differer } from 'node:timers';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const { largeurEtiquettes, pieces, prefixe, voeuDepuisArgv } =
  await import('../src/shared/demarrage.ts');

const liste = pieces(process.execPath, voeuDepuisArgv(process.argv.slice(2)));

// ─── Ce qui manque se dit AVANT de lancer quoi que ce soit ────────────────────
//
// Un `spawn` sur un fichier absent échoue par un ENOENT laconique, plusieurs
// lignes plus bas, mêlé à la sortie des processus qui ont démarré. On regarde
// d'abord.
const absents = liste
  .map((p) => p.argv[0])
  .filter((f) => f !== undefined && !existsSync(path.join(RACINE, f)));
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
console.log('      ^C arrête tout.');
console.log('');

/** Les enfants vivants, pour pouvoir tous les emporter. */
const enfants = [];
let onFerme = false;

/**
 * Préfixe chaque LIGNE, pas chaque morceau.
 *
 * `stdout` arrive en fragments qui ne s'alignent pas sur les fins de ligne :
 * préfixer les morceaux couperait des lignes en deux et en collerait d'autres.
 * On garde donc le reste en tampon jusqu'au prochain `\n`.
 */
function brancher(flux, etiquette, vers) {
  let reste = '';
  flux.setEncoding('utf8');
  flux.on('data', (bout) => {
    const lignes = (reste + bout).split('\n');
    reste = lignes.pop() ?? '';
    for (const l of lignes) vers.write(`${etiquette}${l}\n`);
  });
  flux.on('end', () => {
    if (reste !== '') vers.write(`${etiquette}${reste}\n`);
  });
}

for (const p of liste) {
  const enfant = spawn(p.bin, [...p.argv], {
    cwd: RACINE,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const etiquette = prefixe(p.nom, largeur);
  brancher(enfant.stdout, etiquette, process.stdout);
  brancher(enfant.stderr, etiquette, process.stderr);

  enfant.on('error', (e) => {
    console.error(`${etiquette}✘ ${e.message}`);
    arreter(1);
  });

  // ─── LA MORT D'UN SEUL EMPORTE LES AUTRES ─────────────────────────────────
  //
  // Une ruche dont le hub est mort n'est pas une ruche à moitié : c'est un nœud
  // qui reconnecte dans le vide et un écran qui affiche des données périmées.
  // Laisser survivre les deux autres, c'est laisser croire que ça tourne.
  enfant.on('exit', (code, signal) => {
    if (onFerme) return;
    console.error('');
    console.error(
      `${etiquette}✘ arrêté (${signal ?? `code ${String(code)}`}) — la ruche s'arrête.`,
    );
    arreter(code === 0 ? 1 : (code ?? 1));
  });

  enfants.push(enfant);
}

/** Emporte tout le monde, une seule fois, puis rend le code demandé. */
function arreter(code) {
  if (onFerme) return;
  onFerme = true;
  // ─── LE CODE SE POSE AVANT LE MINUTEUR, PAS DEDANS ─────────────────────────
  //
  // La version précédente ne rendait le code QUE par `process.exit(code)` dans
  // un minuteur `unref()`. Or `unref` veut dire : « ne me retiens pas » — dès
  // que le dernier enfant meurt et que ses tuyaux se ferment, plus rien ne
  // tient la boucle, et Node sort NATURELLEMENT… en 0, avant que le minuteur ne
  // tire. Mesuré : hub mort sur EADDRINUSE, le lanceur imprimait « ✘ arrêté
  // (code 1) — la ruche s'arrête. » et rendait 0. Pour un superviseur, une
  // ruche amputée passait pour un succès.
  //
  // `process.exitCode` fait porter le bon code à la sortie naturelle ; le
  // minuteur ne reste que comme coup de grâce si un tuyau retient la boucle.
  process.exitCode = code;
  for (const e of enfants) {
    // `kill` sur un processus déjà mort est sans effet et ne jette pas ; on ne
    // filtre donc pas, pour ne pas risquer d'en oublier un.
    e.kill('SIGTERM');
  }
  // On laisse une seconde aux serveurs pour libérer leurs ports. Sans ce délai,
  // le démarrage suivant peut échouer sur « port occupé » — une panne qu'on ne
  // relie pas à un ^C de la veille.
  differer(() => process.exit(code), 1_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('');
    console.log('  ⏹  Arrêt de la ruche…');
    arreter(0);
  });
}
