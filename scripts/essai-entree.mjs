// LE PAS 6/6 — un invité colle la commande, et il est dans la ruche.
//
//   node scripts/essai-entree.mjs --racine <ruche installée> [--invite <dossier>]
//
// ─── CE QU'IL PROLONGE, ET LE TROU QU'IL FERME ───────────────────────────────
//
// Les cinq pas précédents mènent l'arrivant jusqu'à « j'ai installé, j'ouvre le
// tableau, je crée mon premier projet ». Le geste qui SUIT — inviter quelqu'un —
// avait tout sauf sa mesure :
//
//   · `commande-entree.ts`      la commande se compose, éprouvée sur des billets
//   · `installeurs-jumeaux`     `rejoindre.sh` et `.ps1` restent parallèles
//   · `invite-panneau`          le bouton remet bien la commande d'entrée
//
// Trois bancs, et pas un qui joue le geste. C'est la forme EXACTE du trou
// qu'était le pas 4/5 — et celui-là a trouvé un défaut réel (`install.ps1` ne
// construisait pas l'écran, donc le premier écran de Hive sous Windows était une
// page d'excuses) à sa toute première exécution.
//
// ─── EN NODE, ET PAS DEUX FOIS DANS DEUX LANGAGES ────────────────────────────
//
// Même raison que `essai-parcours.mjs` : les deux essais de seuil sont jumeaux,
// et `installeurs-jumeaux.test.ts` existe parce qu'ils avaient déjà divergé en
// silence. Ce script décide seul du jumeau à lancer, selon la plateforme — une
// implémentation, deux appelants.
//
// ─── CE QUI EST MESURÉ, ET CE QUI NE L'EST PAS ───────────────────────────────
//
// MESURÉ : la ruche vivante remet des commandes d'entrée utilisables, le script
// d'entrée reconnaît une installation déjà là plutôt que de la refaire, et
// l'invité APPARAÎT dans la ruche — vu depuis `/api/state`, là où le tableau
// regarde.
//
// PAS MESURÉ, et il faut le dire : l'installation depuis zéro par le chemin de
// l'invité. Le dossier d'invité est fabriqué par copie, donc le script prend sa
// branche « déjà installé ». Installer une seconde fois demanderait plusieurs
// minutes ET TIRERAIT DU DÉPÔT PUBLIC — on mesurerait alors le code de `main`,
// pas celui qu'on est en train de livrer, en restant parfaitement vert. Cette
// moitié-là est déjà tenue par les pas 1 à 3, qui installent pour de vrai depuis
// l'arbre sous essai.
//
// ─── LES SECRETS, ET CELUI QUI PASSE QUAND MÊME EN ARGUMENT ──────────────────
//
// Le JETON DE RUCHE ne passe jamais en argument : il est lu dans le `.env` que
// l'installeur vient d'écrire et voyage dans un en-tête.
//
// Le BILLET, lui, passe en argument — parce que c'est le geste qu'on mesure. La
// commande d'entrée est faite pour être collée dans un terminal, billet compris ;
// un essai qui le passerait autrement ne jouerait pas le parcours. Le compromis
// est celui de `rejoindre.sh`, où il est écrit : un billet est COMPTÉ, RÉVOCABLE,
// et échangé contre une clé propre au nœud dès la première connexion.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as attendre } from 'node:timers/promises';
import { lireEnv } from './premier-quart-heure.mjs';
import {
  RAISON_ENTREE,
  defautDuBillet,
  noeudsConnus,
  nouveauNoeud,
  verdictEntree,
} from './entree-invite.mjs';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

/** Combien de temps on laisse à l'invité pour se présenter. */
const PATIENCE_S = 90;

function arguments_(argv) {
  const vu = { racine: null, invite: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--racine') vu.racine = argv[++i] ?? null;
    else if (argv[i] === '--invite') vu.invite = argv[++i] ?? null;
  }
  return vu;
}

// ─── UN ÉCHEC SE DIT, IL NE DÉROULE PAS UNE PILE ─────────────────────────────
//
// Même forme que `essai-parcours.mjs`, et pour la même raison mesurée là-bas :
// douze lignes de pile Node pour dire « la ruche ne répond plus » font soupçonner
// `fetch`, l'essai, le réseau du runner — tout sauf ce qui s'est passé.
//
// Et `process.exitCode` plutôt que `process.exit()` : sous Windows, couper la
// boucle d'événements avec une connexion `fetch` encore en vol fait abandonner
// libuv sur une assertion (§ 9 nonacenties). Le verdict était bon, la sortie non.
class EssaiRate extends Error {}
const rate = (quoi) => {
  throw new EssaiRate(quoi);
};

const { racine, invite: inviteDemande } = arguments_(process.argv.slice(2));

let base = '';
let port = '';

async function demander(chemin, options = {}) {
  try {
    return await fetch(base + chemin, options);
  } catch (e) {
    const cause = e?.cause?.code ?? e?.message ?? String(e);
    rate(`la ruche ne répond plus sur :${port} (${chemin}) — ${cause}`);
  }
}

/**
 * Fabrique le poste de l'invité : les sources, et `node_modules` EN LIEN.
 *
 * ─── POURQUOI UN LIEN ET PAS UNE COPIE ─────────────────────────────────────
 *
 * Recopier `node_modules` coûterait des centaines de mégaoctets et une minute
 * par jambe, pour rien : l'invité n'a pas besoin de SES dépendances, il a besoin
 * QUE `rejoindre.sh` en trouve. Un lien satisfait le `[ -d node_modules ]` du
 * script — c'est exactement ce qu'on veut éprouver.
 *
 * Sous Windows, un lien symbolique de dossier demande des privilèges ; une
 * JONCTION n'en demande aucun et se comporte pareil pour `Test-Path`. Node sait
 * la faire, et c'est le seul endroit du fichier qui distingue les plateformes.
 *
 * Ce qui n'est PAS copié compte autant :
 *   · `.git`     — plusieurs dizaines de mégaoctets, et l'invité n'en a pas ;
 *   · `.env`     — l'invité n'a NI jeton NI secret de session. Le lui copier
 *                  ferait entrer un poste qui connaît déjà les clés de la ruche,
 *                  c'est-à-dire pas un invité ;
 *   · les bases  — un `.db` recopié ferait écrire deux processus dans la même.
 */
function preparerLePoste(source, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, {
    recursive: true,
    dereference: false,
    filter: (chemin) => {
      const nom = path.basename(chemin);
      if (nom === 'node_modules' || nom === '.git' || nom === '.env') return false;
      return !/\.(db|db-wal|db-shm)$/.test(nom);
    },
  });
  // `resolve`, jamais `join` : une JONCTION Windows exige une cible ABSOLUE, et
  // se contenter du chemin reçu ferait dépendre l'essai de l'endroit d'où on
  // l'appelle — une panne qui n'apparaîtrait que sur une jambe.
  const modules = path.resolve(source, 'node_modules');
  if (!existsSync(modules)) {
    rate(`la ruche installée n’a pas de node_modules (${modules}) — rien à lier`);
  }
  symlinkSync(modules, path.join(dest, 'node_modules'), 'junction');
}

/** La ligne de commande du jumeau qui convient à CETTE plateforme. */
function jumeauDentree(source, billet) {
  if (process.platform === 'win32') {
    return {
      bin: 'powershell.exe',
      argv: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(source, 'rejoindre.ps1'),
        '-Billet',
        billet,
      ],
      nom: 'rejoindre.ps1',
    };
  }
  return { bin: 'sh', argv: [path.join(source, 'rejoindre.sh'), billet], nom: 'rejoindre.sh' };
}

/**
 * Emporte le processus d'entrée ET sa descendance.
 *
 * `rejoindre.sh` finit par `exec npm run join`, qui lance Node, qui lance tsx :
 * un signal au seul enfant direct ne descend pas (§ 9 quadragies, déjà payé sur
 * la ruche de l'essai d'installation). On vise donc le GROUPE, que `detached`
 * nous a donné.
 */
function emporter(enfant) {
  if (!enfant?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(enfant.pid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(-enfant.pid, 'SIGKILL');
    }
  } catch {
    // Déjà mort, ou groupe déjà rendu : il n'y a rien à réparer et rien à dire.
  }
}

async function principal() {
  if (racine === null) {
    console.error('usage : node scripts/essai-entree.mjs --racine <ruche> [--invite <dossier>]');
    return MAL_APPELE;
  }
  const invite = inviteDemande ?? `${racine}-invite`;

  const env = lireEnv(readFileSync(path.join(racine, '.env'), 'utf8'));
  port = env.HIVE_PORT ?? '';
  const jeton = env.HIVE_TOKEN ?? '';
  if (!port || !jeton) rate('.env sans HIVE_PORT ou HIVE_TOKEN — l’essai ne peut rien conclure');

  base = `http://127.0.0.1:${port}`;
  const entetes = { 'x-hive-token': jeton };

  // ─── LE RELEVÉ D'AVANT ────────────────────────────────────────────────────
  //
  // L'essai de seuil lance `npm run ruche` sans drapeau : la Reine, UNE
  // OUVRIÈRE, et l'écran. Il y a donc déjà un nœud quand l'invité arrive, et
  // « au moins un nœud » serait vert avant même qu'on ait lancé quoi que ce
  // soit. On relève, puis on cherchera CELUI QUI N'Y ÉTAIT PAS.
  const etatAvant = await demander('/api/state', { headers: entetes });
  if (etatAvant.status !== 200) rate(`6/6 — l’instantané rend ${etatAvant.status} avant l’entrée`);
  const dejaVus = noeudsConnus(await etatAvant.json());

  // ─── LE BILLET, FRAPPÉ PAR LA RUCHE VIVANTE ───────────────────────────────
  //
  // L'adresse est imposée en boucle locale : laissée à la ruche, elle serait
  // celle du réseau du runner, et l'essai dépendrait de la façon dont la machine
  // de CI se voit elle-même — une variable qui n'a rien à faire ici.
  const frappe = await demander('/api/billets', {
    method: 'POST',
    headers: { ...entetes, 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Le poste de l’invité (essai)',
      uses: 1,
      url: `ws://127.0.0.1:${port}/ws`,
    }),
  });
  if (frappe.status !== 200 && frappe.status !== 201) {
    rate(`6/6 — la ruche refuse de frapper un billet (${frappe.status}) : ${await frappe.text()}`);
  }
  const remis = await frappe.json();
  const defaut = defautDuBillet(remis);
  if (defaut !== null) rate(`6/6 — ${defaut}`);

  // ─── LE POSTE DE L'INVITÉ ─────────────────────────────────────────────────
  preparerLePoste(racine, invite);

  const jumeau = jumeauDentree(racine, remis.billet);
  const enfant = spawn(jumeau.bin, jumeau.argv, {
    // `shell: false` sans exception : le billet est un ARGUMENT, jamais un
    // morceau de ligne de commande à réinterpréter.
    shell: false,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: invite,
    // `HIVE_DIR` est la seule chose qu'on impose : c'est ainsi qu'un invité
    // choisit où poser sa ruche, et les deux jumeaux le lisent.
    env: { ...process.env, HIVE_DIR: invite },
  });

  let dit = '';
  const lire = (m) => {
    dit += m.toString('utf8');
  };
  enfant.stdout.on('data', lire);
  enfant.stderr.on('data', lire);

  let mort = null;
  enfant.on('exit', (code, signal) => {
    mort = signal ?? `code ${String(code)}`;
  });

  try {
    // ─── ON ATTEND L'INVITÉ, ON NE DORT PAS UN TEMPS FIXE ───────────────────
    //
    // Une attente en dur est un pari sur la vitesse de la machine (§ 9
    // octoquadragies). On demande, et l'on s'arrête dès que quelqu'un de neuf
    // est là — mesuré sur une ruche locale : moins d'une seconde.
    let neuf = null;
    for (let i = 0; i < PATIENCE_S && neuf === null; i++) {
      await attendre(1000);

      // ─── ON REGARDE AVANT DE CONCLURE À LA MORT ──────────────────────────
      //
      // L'ORDRE de ces deux blocs est la seule subtilité de la boucle, et la
      // première version l'avait à l'envers : elle constatait la mort du script
      // AVANT d'interroger la ruche.
      //
      // Le vrai `rejoindre.sh` finit par `exec npm run join`, qui reste vivant :
      // le défaut ne se voyait donc pas. Mais rien ne l'exige — un script
      // d'entrée qui inscrit le nœud puis rend la main aurait été déclaré en
      // échec alors que l'invité ÉTAIT dans la ruche. Un essai qui rougit sur un
      // produit sain apprend à ne plus croire les rouges.
      //
      // On interroge donc d'abord ; la mort ne se conclut que si la ruche,
      // consultée APRÈS elle, ne voit toujours personne de neuf.
      const etat = await demander('/api/state', { headers: entetes });
      if (etat.status !== 200) rate(`6/6 — l’instantané rend ${etat.status} pendant l’entrée`);
      neuf = nouveauNoeud(await etat.json(), dejaVus);

      if (neuf === null && mort !== null) {
        rate(
          `6/6 — le script d’entrée s’est arrêté (${mort}) sans faire entrer personne :\n${dit}`,
        );
      }
    }

    if (neuf === null) {
      rate(`6/6 — aucun nœud neuf après ${PATIENCE_S} s. Ce que l’entrée a dit :\n${dit}`);
    }

    // ─── ET L'INSTALLATION N'A PAS ÉTÉ REFAITE ─────────────────────────────
    //
    // Vérifié APRÈS l'entrée, pas avant : c'est la seule façon d'avoir tout ce
    // que le script a dit. Une réinstallation tirerait du dépôt public, donc
    // mesurerait `main` et non l'arbre livré — et l'essai serait vert.
    const fait = verdictEntree(dit);
    if (fait !== 'rejoint') rate(`6/6 — ${RAISON_ENTREE[fait] ?? fait}`);

    console.log(`✔ 6/6 — un invité a collé la commande et il est dans la ruche (${neuf})`);
    return OK;
  } finally {
    emporter(enfant);
    rmSync(invite, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await principal();
} catch (e) {
  if (!(e instanceof EssaiRate)) throw e;
  console.error(`✘ ${e.message}`);
  process.exitCode = ECHEC;
}
