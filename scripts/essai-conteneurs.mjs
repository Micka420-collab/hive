// LA RUCHE EN CONTENEUR, EXPLOITÉE COMME CHEZ QUELQU'UN.
//
//     node scripts/essai-conteneurs.mjs compose
//     node scripts/essai-conteneurs.mjs cloud
//     node scripts/essai-conteneurs.mjs precedente
//     node scripts/essai-conteneurs.mjs montee [--depuis vX.Y.Z]
//
// Trois travaux de la CI l'appellent (`.github/workflows/ci.yml`). Il lui faut
// Docker et son greffon compose, et les dépendances du dépôt (`npm ci`). Il
// n'écrit que `.env` (ignoré par git) et des volumes Docker que la CI détruit
// après lui — et REFUSE d'écraser un `.env` qu'il n'a pas posé lui-même : ce
// serait celui d'une vraie ruche (voir `ecrireEnv`). `kill -9` de l'hôte passe
// par `sudo -n` quand le processus appartient à root.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// Le travail `image` prouvait qu'un `docker run` NU démarre. Personne
// n'exploite une ruche ainsi : on la pose par `docker compose up`, elle
// redémarre, elle tombe, on la met à jour, on la met derrière Caddy. Aucun de
// ces gestes n'était exercé. Les poser a trouvé, avant même la première
// exécution, deux pannes que seule l'exploitation montre : la Reine du
// conteneur ne pouvait pas copier le code d'un projet (pas de git dans
// l'image), et un `.env` obtenu par `cp .env.example .env` la faisait écouter
// sur SA boucle locale — saine pour la sonde de santé, injoignable pour tous.
//
// ─── LES TROIS ESSAIS ────────────────────────────────────────────────────────
//
//   compose  `docker-compose.yml` depuis un `.env` d'opérateur : la Reine
//            répond sur le port publié ; un init tient le PID 1 ; git est là ;
//            un compte, un projet, une clé posée depuis la Chambre et le code
//            du projet (le Rayon) survivent à `compose restart`, à un
//            `kill -9` de la Reine DEPUIS L'HÔTE (relevée par
//            `unless-stopped`), et à `down` puis `up` (le volume) ; la
//            sauvegarde documentée s'écrit dans le volume, se relit dehors,
//            et se REPOSE comme `docs/RELEASING.md` le dit.
//   cloud    `docker-compose.cloud.yml` derrière le VRAI Caddy, sur son vrai
//            Caddyfile : sans domaine compose refuse, sans secret de webhook
//            la Reine refuse ; `:80` redirige, `/api/edition` répond en HTTPS,
//            la Reine n'est pas publiée en direct ; deux clients (deux
//            conteneurs, deux adresses) gardent chacun leur compteur, et
//            le WebSocket passe (`scripts/sonde-cloud.mjs`).
//   montee   la version ÉTIQUETÉE précédente pose ses données dans le volume ;
//            l'arbre courant démarre sur ce même volume et les relit toutes.
//            Sans étiquette, rien à monter : il le DIT, et sort en 0.

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as minuterie, clearTimeout } from 'node:timers';
import { setTimeout as patienter } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { projetDansInstantane } from './premier-quart-heure.mjs';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Les noms de projet compose : l'étape de nettoyage de la CI les reprend. */
export const PROJETS = Object.freeze({
  compose: 'hive-essai',
  cloud: 'hive-essai-cloud',
  montee: 'hive-montee',
});

/**
 * Le nom servi par Caddy pendant l'essai Cloud.
 *
 * Un nom en `.localhost` ne peut recevoir aucun certificat public : Caddy lui
 * délivre DE LUI-MÊME un certificat de son autorité interne (`tls internal`),
 * sans qu'on touche au Caddyfile livré (certmagic, `SubjectIsInternal`).
 */
export const DOMAINE_ESSAI = 'hive.localhost';

/** Le compte, la clé et le projet que chaque essai pose, puis relit. */
const COMPTE = Object.freeze({
  email: 'reine@essai.test',
  password: 'une ruche en conteneur tient bon',
  displayName: 'Reine d’essai',
});
// Une clé du catalogue de la Chambre (`requisition-env.ts`), fausse, et
// qu'aucun code de la Reine n'utilise pour appeler qui que ce soit.
const CLE = Object.freeze({ envVar: 'SEEDANCE_API_KEY', secret: 'sk-essai-conteneurs-0000' });

/** Une assertion de l'essai qui tombe : un verdict, pas une pile. */
class EssaiRate extends Error {}

function rate(quoi) {
  throw new EssaiRate(quoi);
}

function exiger(condition, quoi) {
  if (!condition) rate(quoi);
}

function etape(texte) {
  console.log(`\n▸ ${texte}`);
}

function reussi(texte) {
  console.log(`✔ ${texte}`);
}

// ─── LANCER ──────────────────────────────────────────────────────────────────

/**
 * Lance un programme — SANS shell — et rend ce qu'il a dit.
 *
 * Le seul lancement du fichier (`tests/security-invariants.test.ts` compte
 * les `shell: false`). `voir` laisse la sortie couler dans le journal de la
 * CI (constructions, `up --wait`) au lieu de la retenir : c'est là qu'on lit
 * pourquoi une construction a échoué.
 */
function lancer(
  bin,
  args,
  { cwd = RACINE, env = process.env, voir = false, tolere = false, delaiMs } = {},
) {
  const r = spawnSync(bin, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    stdio: voir ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    timeout: delaiMs,
    killSignal: 'SIGKILL',
  });
  // `delaiMs` borne un lancement qui, si le défaut gardé revient, ne rendrait
  // JAMAIS la main (une Reine qui démarre au premier plan) : sans borne, la CI
  // attendrait ses six heures au lieu d'échouer en disant pourquoi.
  const delaiDepasse = r.error?.code === 'ETIMEDOUT';
  if (r.error && !delaiDepasse) rate(`« ${bin} » n’a pas pu être lancé — ${r.error.message}`);
  const res = {
    code: r.status ?? 1,
    sortie: r.stdout ?? '',
    erreur: r.stderr ?? '',
    delaiDepasse,
  };
  if (delaiDepasse && !tolere) {
    rate(`${bin} ${args.join(' ')} → toujours en cours après ${Math.round(delaiMs / 1000)} s`);
  }
  if (!tolere && res.code !== 0) {
    const dit = `${res.erreur}\n${res.sortie}`.trim().slice(-3000);
    rate(`${bin} ${args.join(' ')} → code ${res.code}${dit ? `\n${dit}` : ''}`);
  }
  return res;
}

/** `docker compose -p <projet> -f <fichier> …`, depuis `cwd`. */
function compose(projet, fichier, args, options = {}) {
  return lancer('docker', ['compose', '-p', projet, '-f', fichier, ...args], options);
}

/** Attend qu'une condition tienne, par petits pas — jamais un délai deviné. */
async function attendreQue(condition, delaiMs, quoi) {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (await condition()) return;
    await patienter(1_000);
  }
  rate(`${quoi} : rien en ${Math.round(delaiMs / 1000)} s`);
}

// ─── LE `.env` D'UN OPÉRATEUR ────────────────────────────────────────────────

/**
 * Le `.env` d'un essai : `.env.example` tel qu'un opérateur le copie, dont on
 * remplace les valeurs données — TOUTES leurs occurrences actives — et au bout
 * duquel on ajoute celles qu'il ne porte pas (ou seulement en commentaire).
 *
 * PUR. C'est délibérément la copie de l'exemple, pas un fichier minimal : le
 * défaut que cet essai garde (`HIVE_HOST=127.0.0.1` venu de l'exemple, qui
 * faisait écouter la Reine sur sa propre boucle locale) ne se voit QUE si
 * l'essai part de ce que l'opérateur a réellement sous la main.
 */
export function envDEssai(exemple, valeurs) {
  const vues = new Set();
  const lignes = exemple.split(/\r?\n/).map((ligne) => {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(ligne);
    if (m === null || !Object.hasOwn(valeurs, m[1])) return ligne;
    vues.add(m[1]);
    return `${m[1]}=${valeurs[m[1]]}`;
  });
  const ajouts = Object.entries(valeurs)
    .filter(([cle]) => !vues.has(cle))
    .map(([cle, valeur]) => `${cle}=${valeur}`);
  const corps = lignes.join('\n').replace(/\n*$/, '\n');
  return ajouts.length === 0
    ? corps
    : `${corps}\n# ─── Posé par scripts/essai-conteneurs.mjs ───\n${ajouts.join('\n')}\n`;
}

/** Des secrets neufs, jamais trivialement devinables — la Reine refuse les autres. */
function secretsDEssai() {
  return {
    HIVE_TOKEN: randomBytes(24).toString('hex'),
    HIVE_JWT_SECRET: randomBytes(32).toString('hex'),
  };
}

/** Les dossiers dont CET essai a lui-même écrit le `.env` : lui seul peut le réécrire. */
const ENV_POSES = new Set();

/**
 * Écrit `<dossier>/.env` depuis SON `.env.example`, en 0600 comme l'installeur.
 *
 * ─── JAMAIS PAR-DESSUS LE `.env` D'UN OPÉRATEUR ─────────────────────────────
 *
 * Compose lit `env_file: .env` dans le dossier du projet : l'essai DOIT donc
 * écrire là. En CI, le dossier est une copie fraîche et n'en a aucun. Chez un
 * mainteneur, le même fichier porte le HIVE_TOKEN, le secret JWT et chaque clé
 * posée depuis la Chambre (`src/shared/env-queen.ts` y retombe hors conteneur)
 * — l'écraser par des secrets jetables les perdrait sans retour. Un `.env` que
 * cet essai n'a pas écrit lui-même arrête donc tout, en nommant le fichier ;
 * ceux qu'il a posés plus tôt dans la même exécution se réécrivent librement.
 */
export function ecrireEnv(dossier, valeurs, poses = ENV_POSES) {
  const cible = path.join(dossier, '.env');
  exiger(
    poses.has(cible) || !existsSync(cible),
    `${cible} existe déjà et cet essai ne l’a pas écrit : il porterait les secrets et les ` +
      'clés de la Chambre d’une vraie ruche, que l’essai écraserait. Déplace-le (ou lance ' +
      'l’essai depuis un clone sans `.env`), puis relance.',
  );
  const exemple = readFileSync(path.join(dossier, '.env.example'), 'utf8');
  writeFileSync(cible, envDEssai(exemple, valeurs), { mode: 0o600 });
  poses.add(cible);
}

/**
 * Le dépôt dont le Rayon copie le code : celui-ci, là où la CI l'a tiré.
 *
 * HTTPS et public — c'est ce qu'exerce la paire git + `ca-certificates` de
 * l'image. Une fourche éprouve sa propre copie.
 */
function depotPublic() {
  const { GITHUB_SERVER_URL: serveur, GITHUB_REPOSITORY: depot } = process.env;
  return serveur && depot
    ? `${serveur}/${depot}.git`
    : 'https://github.com/Micka420-collab/hive.git';
}

// ─── PARLER À LA RUCHE ───────────────────────────────────────────────────────

async function appeler(
  base,
  chemin,
  { methode = 'GET', jeton, jwt, corps, delaiMs = 30_000 } = {},
) {
  const entetes = {};
  if (jeton) entetes['x-hive-token'] = jeton;
  if (jwt) entetes.authorization = `Bearer ${jwt}`;
  if (corps !== undefined) entetes['content-type'] = 'application/json';
  const arret = new AbortController();
  const delai = minuterie(() => arret.abort(), delaiMs);
  try {
    const res = await fetch(base + chemin, {
      method: methode,
      headers: entetes,
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: arret.signal,
    });
    const texte = await res.text();
    let json = null;
    try {
      json = JSON.parse(texte);
    } catch {
      // Pas du JSON : `texte` porte ce qui a été dit.
    }
    return { statut: res.status, json, texte };
  } catch (e) {
    return rate(`la ruche ne répond pas sur ${chemin} — ${e?.cause?.code ?? e?.message ?? e}`);
  } finally {
    clearTimeout(delai);
  }
}

/**
 * Pose ce que l'essai relira : le premier compte (administrateur), un projet
 * branché sur un dépôt public, une clé accordée depuis la Chambre.
 */
async function semer(base, jeton) {
  const inscrit = await appeler(base, '/api/auth/register', {
    methode: 'POST',
    jeton,
    corps: COMPTE,
  });
  exiger(
    inscrit.statut === 200 && typeof inscrit.json?.token === 'string',
    `le premier compte ne s’inscrit pas → ${inscrit.statut} ${inscrit.texte.slice(0, 300)}`,
  );
  const projet = await appeler(base, '/api/projects', {
    methode: 'POST',
    jeton,
    corps: { name: 'Rucher en conteneur', repoUrl: depotPublic() },
  });
  exiger(
    projet.statut === 201 && typeof projet.json?.id === 'string',
    `le projet ne se crée pas → ${projet.statut} ${projet.texte.slice(0, 300)}`,
  );
  // La route du défaut #446 : la racine du conteneur est en lecture seule, et
  // la clé doit atterrir dans le volume (`HIVE_ENV_FILE`), pas dans `/app/.env`.
  const cle = await appeler(base, '/api/queen/cles', {
    methode: 'POST',
    jeton,
    jwt: inscrit.json.token,
    corps: CLE,
  });
  exiger(
    cle.statut === 200,
    `la Chambre ne pose pas la clé → ${cle.statut} ${cle.texte.slice(0, 300)}`,
  );
  reussi(`compte, projet ${projet.json.id} et clé ${CLE.envVar} posés`);
  return { projetId: projet.json.id };
}

/** La ruche répond-elle, là, tout de suite ? Jamais d'exception : oui ou non. */
async function repond(base) {
  try {
    return (await fetch(`${base}/api/health`)).ok;
  } catch {
    return false;
  }
}

/**
 * Relit TOUT ce que `semer` a posé. `moment` dit après quel geste.
 *
 * On attend d'abord que la ruche réponde sur le port publié : « sain » pour
 * Docker se lit DANS le conteneur, et un redémarrage laisse un court instant
 * où l'état dit encore l'ancien démarrage.
 */
async function verifier(base, jeton, semis, moment) {
  await attendreQue(() => repond(base), 60_000, `${moment} — /api/health ne répond pas`);

  const connexion = await appeler(base, '/api/auth/login', {
    methode: 'POST',
    corps: { email: COMPTE.email, password: COMPTE.password },
  });
  exiger(
    connexion.statut === 200 && typeof connexion.json?.token === 'string',
    `${moment} — le compte ne se connecte plus → ${connexion.statut}`,
  );

  const etat = await appeler(base, '/api/state', { jeton });
  exiger(
    projetDansInstantane(etat.json, semis.projetId),
    `${moment} — le projet ${semis.projetId} n’est plus dans l’instantané`,
  );

  const cles = await appeler(base, '/api/queen/cles', { jeton });
  const presente = cles.json?.presence?.find((p) => p.envVar === CLE.envVar)?.presente;
  exiger(presente === true, `${moment} — la clé ${CLE.envVar} posée depuis la Chambre a disparu`);

  // Le Rayon : la Reine clone (ou rafraîchit) le dépôt avec SON git. Sans git
  // dans l'image, c'est ici que tout se voyait : 409 « n’a pas pu être copié ».
  const rayon = await appeler(base, `/api/projects/${semis.projetId}/rayon`, {
    jeton,
    jwt: connexion.json.token,
    delaiMs: 120_000,
  });
  exiger(
    rayon.statut === 200 && rayon.json?.entrees?.some((e) => e.chemin === 'package.json'),
    `${moment} — le Rayon ne montre pas le code du projet → ${rayon.statut} ${rayon.texte.slice(0, 300)}`,
  );
  reussi(`${moment} — santé, compte, projet, clé de la Chambre et code du projet`);
}

// ─── LE CONTENEUR, VU DE L'HÔTE ──────────────────────────────────────────────

function inspecter(id) {
  const format =
    '{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Status}}|' +
    '{{if .State.Health}}{{.State.Health.Status}}{{end}}';
  const [demarre, redemarrages, etat, sante] = lancer('docker', ['inspect', '-f', format, id])
    .sortie.trim()
    .split('|');
  return { demarre, redemarrages: Number(redemarrages), etat, sante };
}

/** Attend que le conteneur soit de nouveau SAIN, et que `depuis` le distingue d'avant. */
async function attendreSain(id, depuis, quoi) {
  let vu = null;
  await attendreQue(
    () => {
      vu = inspecter(id);
      return vu.sante === 'healthy' && depuis(vu);
    },
    180_000,
    `${quoi} — le conteneur n’est pas redevenu sain (dernier état ${JSON.stringify(vu)})`,
  );
  return vu;
}

/**
 * Le pid, CÔTÉ HÔTE, du processus de la Reine — dans `docker top <id> -eo pid,args`.
 *
 * PUR. On cherche la Reine par sa ligne de commande, pas par son nom : la
 * sonde de santé de l'image est AUSSI un `node`, qui passe par là toutes les
 * trente secondes. Et la ligne doit COMMENCER par `node` : celle de l'init
 * (`/sbin/docker-init -- node dist/orchestrator/main.js`) cite la même
 * commande. Tuer l'init éprouverait l'init, pas la chute de la Reine.
 */
export function pidDeLaReine(sortieTop) {
  for (const ligne of sortieTop.split(/\r?\n/).slice(1)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(ligne);
    if (m !== null && /^(?:\S*\/)?node\s+(?:\S+\s+)*dist\/orchestrator\/main\.js\b/.test(m[2])) {
      return Number(m[1]);
    }
  }
  return null;
}

/** SIGKILL depuis l'hôte : ni la Reine ni Docker ne le voient venir. */
function tuerDepuisLHote(pid) {
  try {
    process.kill(pid, 'SIGKILL');
    return;
  } catch (e) {
    // Le processus appartient à root (le démon Docker l'a lancé) : il faut
    // l'hôte avec ses droits, comme un OOM-killer ou un administrateur.
    if (e?.code !== 'EPERM') throw e;
  }
  lancer('sudo', ['-n', 'kill', '-9', String(pid)]);
}

// ─── COMPOSE ─────────────────────────────────────────────────────────────────

async function essaiCompose() {
  const projet = PROJETS.compose;
  const fichier = 'docker-compose.yml';
  const base = 'http://127.0.0.1:7777';
  const secrets = secretsDEssai();

  etape('`.env` d’opérateur (copié de .env.example), puis `docker compose up --build --wait`');
  ecrireEnv(RACINE, secrets);
  compose(projet, fichier, ['up', '-d', '--build', '--wait', '--wait-timeout', '300'], {
    voir: true,
  });
  const id = compose(projet, fichier, ['ps', '-q', 'ruche']).sortie.trim();
  exiger(id !== '', 'aucun conteneur « ruche » après `up`');
  // Sain pour Docker ne veut pas dire joignable : la sonde tourne DANS le
  // conteneur. C'est le port publié qu'on interroge — celui de l'opérateur.
  exiger(
    await repond(base),
    'Docker dit la Reine saine, et le port publié ne répond pas : écoute-t-elle SA boucle locale ' +
      '(un HIVE_HOST venu de .env) ?',
  );
  reussi('la Reine répond sur 127.0.0.1:7777, malgré le HIVE_HOST=127.0.0.1 de .env.example');

  etape('Le PID 1 du conteneur, et git');
  const pid1 = compose(projet, fichier, [
    'exec',
    '-T',
    'ruche',
    'cat',
    '/proc/1/comm',
  ]).sortie.trim();
  exiger(pid1 !== 'node', 'le PID 1 est `node` : personne ne ramasse les orphelins de git');
  reussi(`PID 1 : ${pid1}, pas la Reine`);
  const git = compose(projet, fichier, ['exec', '-T', 'ruche', 'git', '--version']).sortie.trim();
  reussi(git);

  etape('Semer, puis relire');
  const semis = await semer(base, secrets.HIVE_TOKEN);
  await verifier(base, secrets.HIVE_TOKEN, semis, 'premier démarrage');

  etape('La sauvegarde documentée : écrite dans le volume, relue hors du conteneur');
  const sauvegarde = await sauvegarderEtRelire(projet, fichier, semis);
  // Posé APRÈS la sauvegarde : la restauration, en fin d'essai, doit l'effacer.
  const apres = await appeler(base, '/api/projects', {
    methode: 'POST',
    jeton: secrets.HIVE_TOKEN,
    corps: { name: 'Posé après la sauvegarde' },
  });
  exiger(apres.statut === 201, `le second projet ne se crée pas → ${apres.statut}`);

  etape('`docker compose restart ruche`');
  const avantRestart = inspecter(id);
  compose(projet, fichier, ['restart', 'ruche']);
  await attendreSain(id, (v) => v.demarre !== avantRestart.demarre, 'compose restart');
  await verifier(base, secrets.HIVE_TOKEN, semis, 'après compose restart');

  etape('`kill -9` de la Reine depuis l’hôte — `unless-stopped` doit la relever');
  const pid = pidDeLaReine(lancer('docker', ['top', id, '-eo', 'pid,args']).sortie);
  exiger(pid !== null, 'le processus de la Reine est introuvable dans `docker top`');
  const avantKill = inspecter(id);
  tuerDepuisLHote(pid);
  const releve = await attendreSain(
    id,
    (v) => v.redemarrages > avantKill.redemarrages,
    'kill -9 depuis l’hôte',
  );
  reussi(`relevée par Docker (redémarrages : ${avantKill.redemarrages} → ${releve.redemarrages})`);
  await verifier(base, secrets.HIVE_TOKEN, semis, 'après kill -9');

  etape('`docker compose down`, puis `up` : le volume nommé garde tout');
  compose(projet, fichier, ['down']);
  compose(projet, fichier, ['up', '-d', '--wait', '--wait-timeout', '300'], { voir: true });
  await verifier(base, secrets.HIVE_TOKEN, semis, 'après down puis up');
  const avantRetour = await appeler(base, '/api/state', { jeton: secrets.HIVE_TOKEN });
  exiger(
    projetDansInstantane(avantRetour.json, apres.json.id),
    'le projet posé après la sauvegarde a disparu AVANT la restauration',
  );

  // ─── REVENIR EN ARRIÈRE, TEL QUE `docs/RELEASING.md` L'ÉCRIT ─────────────
  //
  // Une sauvegarde qu'on n'a jamais reposée n'est qu'une promesse. Les
  // commandes sont celles du document, à la lettre — `-wal` et `-shm` compris :
  // laissés en place, SQLite rejouerait les écritures de la base remplacée
  // sur la copie reposée.
  etape('Reposer la sauvegarde (docs/RELEASING.md, « Revenir en arrière »)');
  compose(projet, fichier, ['stop', 'ruche']);
  compose(projet, fichier, [
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '-v',
    `${sauvegarde.dossier}:/restaurer:ro`,
    'ruche',
    'sh',
    '-c',
    `rm -f /app/data/hive.db-wal /app/data/hive.db-shm && cp /restaurer/${sauvegarde.fichier} /app/data/hive.db`,
  ]);
  compose(projet, fichier, ['up', '-d', '--wait', '--wait-timeout', '300'], { voir: true });
  await verifier(base, secrets.HIVE_TOKEN, semis, 'après la restauration');
  const apresRetour = await appeler(base, '/api/state', { jeton: secrets.HIVE_TOKEN });
  exiger(
    !projetDansInstantane(apresRetour.json, apres.json.id),
    'le projet posé après la sauvegarde est encore là : la copie n’a pas été reposée',
  );
  reussi('la base reposée est celle de la sauvegarde — ni plus, ni moins');
}

/**
 * `hive sauvegarde` dans le conteneur, puis la copie SORTIE du volume et
 * rouverte par SQLite : la marche à suivre de `docs/RELEASING.md` avant une
 * montée, exercée telle qu'écrite.
 */
async function sauvegarderEtRelire(projet, fichier, semis) {
  const rapport = compose(projet, fichier, [
    'exec',
    '-T',
    'ruche',
    'node',
    'dist/cli.js',
    'sauvegarde',
    '--json',
  ]).sortie;
  reussi(`hive sauvegarde → ${rapport.trim().slice(0, 200)}`);

  const dehors = mkdtempSync(path.join(tmpdir(), 'hive-sauvegardes-'));
  compose(projet, fichier, ['cp', 'ruche:/app/data/sauvegardes', dehors]);
  const dossier = path.join(dehors, 'sauvegardes');
  const copies = readdirSync(dossier).filter((f) => f.endsWith('.db'));
  exiger(
    copies.length > 0,
    `aucune copie .db sortie du volume (${readdirSync(dossier).join(', ')})`,
  );

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path.join(dossier, copies[0]), { readonly: true });
  try {
    const { n } = db.prepare('SELECT count(*) AS n FROM projects WHERE id = ?').get(semis.projetId);
    exiger(n === 1, `la copie ${copies[0]} ne contient pas le projet ${semis.projetId}`);
  } finally {
    db.close();
  }
  reussi(`${copies[0]} sortie du volume, rouverte, et le projet y est`);
  return { dossier, fichier: copies[0] };
}

// ─── CLOUD ───────────────────────────────────────────────────────────────────

/** Le réseau compose d'un conteneur, et son adresse dessus. */
function reseauEtAdresse(id) {
  const format =
    '{{range $nom, $r := .NetworkSettings.Networks}}{{$nom}} {{$r.IPAddress}}\n{{end}}';
  const [reseau, adresse] = lancer('docker', ['inspect', '-f', format, id])
    .sortie.trim()
    .split(/\s+/);
  exiger(Boolean(reseau && adresse), `réseau de Caddy illisible (${reseau} ${adresse})`);
  return { reseau, adresse };
}

/** Un port de l'hôte refuse-t-il la connexion ? */
function refuse(port) {
  return new Promise((resoudre) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => {
      s.destroy();
      resoudre(false);
    });
    s.once('error', () => resoudre(true));
  });
}

async function essaiCloud() {
  const projet = PROJETS.cloud;
  const fichier = 'docker-compose.cloud.yml';
  const secrets = secretsDEssai();
  const origine = `https://${DOMAINE_ESSAI}`;

  etape('Sans HIVE_DOMAIN, compose refuse — et dit quoi écrire');
  const valeurs = {
    ...secrets,
    // Un secret de webhook factice : Stripe ne parlera pas à cet essai, mais la
    // Reine Cloud refuse de démarrer sans (vérifié juste en dessous).
    HIVE_WEBHOOK_SECRET: randomBytes(16).toString('hex'),
    HIVE_PUBLIC_URL: `wss://${DOMAINE_ESSAI}/ws`,
    HIVE_CORS_ORIGIN: origine,
  };
  ecrireEnv(RACINE, valeurs);
  const sansEnv = { ...process.env };
  delete sansEnv.HIVE_DOMAIN;
  const refusDomaine = compose(projet, fichier, ['config', '--quiet'], {
    env: sansEnv,
    tolere: true,
  });
  exiger(
    refusDomaine.code !== 0 && refusDomaine.erreur.includes('HIVE_DOMAIN'),
    `compose a accepté un Cloud sans HIVE_DOMAIN (code ${refusDomaine.code})`,
  );
  reussi(`refus : ${refusDomaine.erreur.trim().split('\n').pop()}`);
  ecrireEnv(RACINE, { ...valeurs, HIVE_DOMAIN: DOMAINE_ESSAI });

  etape('Sans HIVE_WEBHOOK_SECRET, la Reine Cloud refuse de démarrer');
  compose(projet, fichier, ['build', 'ruche'], { voir: true });
  const refusWebhook = compose(
    projet,
    fichier,
    ['run', '--rm', '--no-deps', '-T', '-e', 'HIVE_WEBHOOK_SECRET=', 'ruche'],
    { tolere: true, delaiMs: 90_000 },
  );
  const dit = `${refusWebhook.sortie}\n${refusWebhook.erreur}`;
  // Une Reine qui tient encore au bout du délai A démarré sans le secret :
  // c'est l'échec lui-même, dit tout de suite plutôt qu'attendu six heures.
  exiger(
    !refusWebhook.delaiDepasse,
    `la Reine Cloud tourne toujours sans secret de webhook après 90 s :\n${dit.slice(-800)}`,
  );
  exiger(
    refusWebhook.code !== 0 && dit.includes('HIVE_WEBHOOK_SECRET'),
    `la Reine Cloud a démarré sans secret de webhook (code ${refusWebhook.code}) :\n${dit.slice(-800)}`,
  );
  reussi(`refus, code ${refusWebhook.code}`);

  etape('`docker compose -f docker-compose.cloud.yml up --wait`, derrière le vrai Caddy');
  compose(projet, fichier, ['up', '-d', '--wait', '--wait-timeout', '300'], { voir: true });

  // La racine interne de Caddy : elle naît quand Caddy émet le certificat du
  // domaine, peu après son démarrage. Copiée hors du volume, elle permet de
  // VÉRIFIER le certificat — `curl -k` ne prouverait rien du tout.
  const racine = path.join(mkdtempSync(path.join(tmpdir(), 'hive-cloud-')), 'caddy-racine.crt');
  await attendreQue(
    () =>
      compose(projet, fichier, ['cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', racine], {
        tolere: true,
      }).code === 0,
    60_000,
    'la racine interne de Caddy',
  );
  // Écrite 0600 par Caddy, et relue dans la sonde par l'utilisateur `node`.
  chmodSync(racine, 0o644);
  const ca = readFileSync(racine);
  const { requete } = await import('./sonde-cloud.mjs');
  const hote = { ip: '127.0.0.1', domaine: DOMAINE_ESSAI };
  // La sonde rend ses pannes de connexion en verdicts ; ici elles deviennent
  // ceux de l'essai, avec le même code de sortie que les autres.
  const parCaddy = async (cible, demande) => {
    try {
      return await requete(cible, demande);
    } catch (e) {
      return rate(e.message);
    }
  };

  etape('Depuis l’hôte, par les ports publiés');
  // Caddy émet le certificat du domaine juste APRÈS avoir démarré : `up
  // --wait` rend la main avant. On attend la première poignée de main
  // réussie — puis on juge sur une requête neuve, qui, elle, doit aboutir.
  await attendreQue(
    async () => {
      try {
        await requete({ ...hote, ca }, { chemin: '/api/edition' });
        return true;
      } catch {
        return false;
      }
    },
    60_000,
    'Caddy ne sert pas HTTPS pour ce domaine',
  );
  const edition = await parCaddy({ ...hote, ca }, { chemin: '/api/edition' });
  exiger(
    edition.statut === 200 &&
      edition.json?.edition === 'cloud' &&
      edition.json?.factureHorlogeHote === true,
    `/api/edition en HTTPS rend ${edition.statut} ${edition.texte.slice(0, 200)}`,
  );
  reussi(`:443 → ${edition.texte.trim()} (certificat vérifié contre la racine de Caddy)`);
  const redirection = await parCaddy({ ...hote, protocole: 'http' }, { chemin: '/api/edition' });
  exiger(
    [301, 302, 307, 308].includes(redirection.statut) &&
      redirection.entetes.location === `${origine}/api/edition`,
    `:80 ne redirige pas vers HTTPS (${redirection.statut} ${redirection.entetes.location})`,
  );
  reussi(`:80 → ${redirection.statut} ${redirection.entetes.location}`);
  exiger(
    await refuse(7777),
    'la Reine est joignable en direct sur :7777 — elle ne doit l’être que par Caddy',
  );
  reussi(':7777 fermé sur l’hôte : la Reine n’est joignable que par Caddy');

  etape('Deux clients, deux adresses : chacun son compteur, et le WebSocket passe');
  const caddy = compose(projet, fichier, ['ps', '-q', 'caddy']).sortie.trim();
  const { reseau, adresse } = reseauEtAdresse(caddy);
  const sonde = path.join(RACINE, 'scripts', 'sonde-cloud.mjs');

  // ─── LES DEUX CLIENTS VIVENT EN MÊME TEMPS, ET C'EST LE POINT ─────────────
  //
  // Première version : deux `docker run --rm` l'un après l'autre. La voisine
  // a reçu 429 dès son premier essai — et ce n'était pas la Reine : Docker
  // rend l'adresse d'un conteneur supprimé au suivant, et la voisine avait
  // hérité de celle de l'acharnée, donc de son compteur. Deux clients qui se
  // succèdent sur la même adresse SONT, pour tout serveur, le même client.
  // Les deux conteneurs sont donc créés d'abord, vivants ensemble, et l'essai
  // vérifie qu'ils ont bien deux adresses avant de conclure quoi que ce soit.
  const clients = ['acharnee', 'voisine'].map((role) => {
    const id = lancer('docker', [
      'run',
      '-d',
      '--rm',
      '--no-healthcheck',
      '--network',
      reseau,
      '-v',
      `${sonde}:/app/scripts/sonde-cloud.mjs:ro`,
      '-v',
      `${racine}:/sonde/caddy-racine.crt:ro`,
      'hive:cloud',
      'sleep',
      'infinity',
    ]).sortie.trim();
    return { role, id, adresse: reseauEtAdresse(id).adresse };
  });
  try {
    const [acharnee, voisine] = clients;
    exiger(
      acharnee.adresse !== voisine.adresse,
      `les deux clients ont la même adresse (${acharnee.adresse}) : l'essai ne distinguerait rien`,
    );
    reussi(`deux clients : ${acharnee.adresse} et ${voisine.adresse}, Caddy en ${adresse}`);
    for (const client of clients) {
      lancer(
        'docker',
        [
          'exec',
          // Sans valeur : Docker la reprend de NOTRE environnement. Le jeton
          // n'apparaît donc ni dans la ligne de commande, ni dans le journal.
          '-e',
          'HIVE_TOKEN',
          client.id,
          'node',
          'scripts/sonde-cloud.mjs',
          client.role,
          '--ip',
          adresse,
          '--domaine',
          DOMAINE_ESSAI,
          '--ca',
          '/sonde/caddy-racine.crt',
        ],
        { env: { ...process.env, HIVE_TOKEN: secrets.HIVE_TOKEN }, voir: true },
      );
    }
  } finally {
    for (const client of clients) lancer('docker', ['rm', '-f', client.id], { tolere: true });
  }
}

// ─── MONTÉE DE VERSION ───────────────────────────────────────────────────────

/**
 * L'étiquette d'où monter : la plus récente `vX.Y.Z` qui ne soit pas posée sur
 * l'arbre éprouvé lui-même.
 *
 * PUR. `triees` vient de `git tag --merged HEAD --sort=-version:refname` — git
 * range déjà `v0.10.0` après `v0.9.0` —, `surLaTete` de `git tag --points-at
 * HEAD`. Même règle stricte que `lireVersion` (`src/shared/fraicheur-version.ts`) :
 * trois nombres, rien d'autre ; `v1.0.0-rc.1` ou `essai` ne sont pas des
 * versions publiées d'où quelqu'un monterait.
 */
export function etiquettePrecedente(triees, surLaTete) {
  const ici = new Set(surLaTete.map((t) => t.trim()));
  for (const brute of triees) {
    const t = brute.trim();
    if (/^v\d+\.\d+\.\d+$/.test(t) && !ici.has(t)) return t;
  }
  return null;
}

const lignes = (texte) =>
  texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

function trouverPrecedente() {
  const triees = lignes(
    lancer('git', ['tag', '--merged', 'HEAD', '--sort=-version:refname', '--list', 'v*']).sortie,
  );
  const surLaTete = lignes(lancer('git', ['tag', '--points-at', 'HEAD']).sortie);
  return etiquettePrecedente(triees, surLaTete);
}

/** Un message qui doit se VOIR dans la CI, pas seulement dans le journal. */
function annoncer(titre, texte) {
  console.log(`\nℹ ${titre} — ${texte}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::notice title=${titre}::${texte}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${titre}\n\n${texte}\n`);
    }
  }
}

const SANS_ETIQUETTE =
  'Aucune étiquette vX.Y.Z n’est encore posée : il n’y a pas de version publiée d’où ' +
  'monter, et l’essai de montée ne tourne pas. Il s’exercera dès la première ' +
  '(docs/RELEASING.md).';

/** Pour la CI : écrit `etiquette=<vX.Y.Z>` (vide sans étiquette) dans `GITHUB_OUTPUT`. */
function essaiPrecedente() {
  const etiquette = trouverPrecedente();
  if (etiquette === null) annoncer('Montée de version', SANS_ETIQUETTE);
  else console.log(`version précédente : ${etiquette}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `etiquette=${etiquette ?? ''}\n`);
  }
}

async function essaiMontee(depuis) {
  const depart = depuis ?? trouverPrecedente();
  if (depart === null) {
    annoncer('Montée de version', SANS_ETIQUETTE);
    return;
  }
  const projet = PROJETS.montee;
  const fichier = 'docker-compose.yml';
  const base = 'http://127.0.0.1:7777';
  const secrets = secretsDEssai();
  const actuelle = JSON.parse(readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version;

  // Une étiquette posée sur un commit dont `package.json` dit autre chose
  // publierait une version qui ne sait pas son propre numéro : `/api/version`
  // et « suis-je à jour ? » mentiraient pour toute la durée de la version.
  if (/^v\d+\.\d+\.\d+$/.test(depart)) {
    const declaree = JSON.parse(lancer('git', ['show', `${depart}:package.json`]).sortie).version;
    exiger(
      `v${declaree}` === depart,
      `l’étiquette ${depart} est posée sur un commit dont package.json déclare ${declaree}`,
    );
  }

  etape(`La version ${depart} pose ses données dans le volume`);
  const ancienne = path.join(mkdtempSync(path.join(tmpdir(), 'hive-montee-')), 'ruche');
  lancer('git', ['worktree', 'add', '--detach', ancienne, depart]);
  ecrireEnv(ancienne, secrets);
  compose(projet, fichier, ['up', '-d', '--build', '--wait', '--wait-timeout', '300'], {
    cwd: ancienne,
    voir: true,
  });
  // `semer` et `verifier` sont ceux de l'arbre COURANT, parlant à l'ANCIENNE
  // Reine : ils ne touchent que des routes stables (compte, projets, clés de
  // la Chambre, Rayon). Qui renomme ou reforme l'une d'elles exprès doit
  // garder ce côté-ci compatible avec la plus vieille étiquette encore
  // éprouvée — sinon `montee` accuserait la montée d'une faute du banc.
  const semis = await semer(base, secrets.HIVE_TOKEN);
  await verifier(base, secrets.HIVE_TOKEN, semis, `en ${depart}`);
  compose(projet, fichier, ['down'], { cwd: ancienne });

  etape(`L’arbre courant (${actuelle}) démarre sur le MÊME volume`);
  ecrireEnv(RACINE, secrets);
  compose(projet, fichier, ['up', '-d', '--build', '--wait', '--wait-timeout', '300'], {
    voir: true,
  });
  await verifier(base, secrets.HIVE_TOKEN, semis, `après la montée depuis ${depart}`);
  const version = await appeler(base, '/api/version', { jeton: secrets.HIVE_TOKEN });
  exiger(
    version.json?.version?.declaree === actuelle,
    `la ruche montée annonce ${version.json?.version?.declaree}, le paquet est en ${actuelle}`,
  );
  reussi(`${depart} → ${actuelle} : tout relu, et la ruche annonce ${actuelle}`);
}

// ─── ENTRÉE ──────────────────────────────────────────────────────────────────

async function principal(argv) {
  const [essai, ...reste] = argv;
  const i = reste.indexOf('--depuis');
  const depuis = i === -1 ? undefined : reste[i + 1];
  if (essai === 'compose') await essaiCompose();
  else if (essai === 'cloud') await essaiCloud();
  else if (essai === 'precedente') essaiPrecedente();
  else if (essai === 'montee' && (i === -1 || depuis)) await essaiMontee(depuis);
  else {
    console.error(
      'usage : node scripts/essai-conteneurs.mjs <compose | cloud | precedente | montee [--depuis <ref>]>',
    );
    return MAL_APPELE;
  }
  return OK;
}

// ─── LA GARDE DU POINT D'ENTRÉE ──────────────────────────────────────────────
//
// Un banc importe ce fichier pour ses fonctions pures : l'import ne doit ni
// écrire `.env`, ni lancer Docker. Même garde que `compte-tests.mjs`.
const MOI = fileURLToPath(import.meta.url);
const LANCE = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (MOI === LANCE) {
  try {
    process.exitCode = await principal(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof EssaiRate)) throw e;
    console.error(`\n✘ ${e.message}`);
    process.exitCode = ECHEC;
  }
}
