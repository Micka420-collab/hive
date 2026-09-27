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

import { spawn } from 'node:child_process';
// `setTimeout` explicite : ce fichier est du `.mjs`, que la configuration ESLint
// ne traite pas comme un module Node — les globales du navigateur n'y sont pas
// déclarées, et `no-undef` a raison de le dire.
import { setTimeout as differer } from 'node:timers';
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
  adresseAnnoncee,
  annonceOuvrieres,
  attendLaReine,
  decouperLignes,
  entreesAbsentes,
  envDePiece,
  largeurEtiquettes,
  pieces,
  planOuvrieres,
  portAnnonce,
  prefixe,
  reliquat,
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
const envFusionne = { ...envFichier, ...process.env };
const plan = veutOuvriere(voeu)
  ? await planOuvrieres({
      argv,
      env: envFusionne,
      hote: hostname(),
      detecter: async () => {
        const { detectAllAgents } = await import('../src/node-client/agent-detect.ts');
        return detectAllAgents(envFusionne);
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
console.log('      ^C arrête tout.');
console.log('');

/** Les enfants vivants, pour pouvoir tous les emporter. */
const enfants = [];
let onFerme = false;

/**
 * Préfixe chaque LIGNE, pas chaque morceau.
 *
 * Le découpage et le sort du tampon final vivent dans `demarrage.ts`, où ils
 * s'éprouvent sans processus. Ici il ne reste que le branchement : ce qui n'est
 * pas une décision.
 */
function brancher(flux, etiquette, vers) {
  let reste = '';
  flux.setEncoding('utf8');
  flux.on('data', (bout) => {
    const debit = decouperLignes(reste, bout);
    reste = debit.reste;
    for (const l of debit.lignes) vers.write(`${etiquette}${l}\n`);
  });
  flux.on('end', () => {
    for (const l of reliquat(reste)) vers.write(`${etiquette}${l}\n`);
  });
}

// ─── CEUX QUI REJOIGNENT LA REINE ATTENDENT QU'ELLE DISE OÙ ELLE EST ─────────
//
// Les ouvrières et l'écran partaient avec la Reine, sans rien savoir d'elle :
// ils visaient `:7777` quel que soit son port. Ils ne démarrent plus qu'à son
// annonce, avec l'adresse qu'elle a réellement ouverte — la décision, pure,
// vit dans `demarrage.ts` (`attendLaReine`, `adresseAnnoncee`, `envDePiece`).
// Une Reine qui meurt avant d'annoncer emporte la ruche comme avant : personne
// n'est lancé vers une adresse qui n'existe pas.
const aLAnnonce = liste.filter(attendLaReine);

function lancer(p, reine) {
  // Une ouvrière de l'essaim par agent reçoit SA famille, son nom, sa
  // concurrence ; toute pièce qui rejoint la Reine reçoit son adresse. Posés
  // par-dessus l'environnement, donc au-dessus du `.env` que l'ouvrière
  // chargera sans jamais écraser ce qu'elle a reçu.
  const pose = envDePiece(p, reine);
  const enfant = spawn(p.bin, [...p.argv], {
    cwd: RACINE,
    shell: false,
    windowsHide: true,
    // La Reine seule reçoit un canal IPC : c'est par lui qu'elle s'annonce.
    stdio: p.reine === 'annonce' ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    env: pose ? { ...process.env, ...pose } : process.env,
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
  //
  // Une seule exception, et elle se DIT : l'ouvrière qu'un essaim par agent a
  // AJOUTÉE (`facultative`). La ruche d'avant — la Reine, la première ouvrière,
  // l'écran — tourne toujours sans elle ; l'emporter, c'était casser une ruche
  // qui marchait pour une ouvrière que personne n'avait demandée. Voir
  // `OuvriereAgent.ajoutee`.
  enfant.on('exit', (code, signal) => {
    if (onFerme) return;
    if (p.facultative) {
      console.error(
        `${etiquette}✘ arrêtée (${signal ?? `code ${String(code)}`}) — la ruche continue sans elle.`,
      );
      return;
    }
    console.error('');
    console.error(
      `${etiquette}✘ arrêté (${signal ?? `code ${String(code)}`}) — la ruche s'arrête.`,
    );
    arreter(code === 0 ? 1 : (code ?? 1));
  });

  if (p.reine === 'annonce') {
    enfant.on('message', (message) => {
      const adresse = adresseAnnoncee(message);
      if (adresse === null || onFerme) return;
      // `splice` vide la file : une seconde annonce ne relance personne.
      for (const q of aLAnnonce.splice(0)) lancer(q, adresse);
    });
  }

  enfants.push(enfant);
}

for (const p of liste) if (!attendLaReine(p)) lancer(p, null);

// ─── UNE ATTENTE SANS FIN SE DIT ──────────────────────────────────────────────
//
// La Reine s'annonce dans la foulée de son `listen` : ce silence n'arrive pas
// aujourd'hui. Mais une Reine vivante qui ne s'annonce JAMAIS — un refactor de
// `orchestrator/main.ts` qui perd le `process.send` — laisserait ouvrières et
// écran non lancés sans une ligne : une ruche qui a l'air de tourner et n'a
// personne pour travailler. Le minuteur ne tranche rien, il nomme ceux qui
// attendent ; `unref` : il ne retient pas un lanceur qui s'arrête.
if (aLAnnonce.length > 0) {
  differer(() => {
    if (onFerme || aLAnnonce.length === 0) return;
    const qui = aLAnnonce.map((q) => q.nom).join(', ');
    console.error(`  ⚠  La Reine ne s'est pas annoncée après 30 s : ${qui} attendent toujours.`);
  }, 30_000).unref();
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
