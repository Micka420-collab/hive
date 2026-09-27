// LA REPRISE APRÈS PANNE, SUR DE VRAIS PROCESSUS — le banc que le README cite.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le README range « reprise après panne » dans « Prouvé », « mesurée avec de
// vrais processus » : `kill -9` de la Reine ou d'un nœud en pleine mission,
// base verrouillée par un autre processus, réseau gelé. C'était vrai — le
// 25/09, à la main. Les scripts n'étaient pas dans le dépôt : aucun test ne
// tuait une vraie Reine en SIGKILL, aucun ne posait de `BEGIN EXCLUSIVE`. Une
// preuve qu'on ne peut pas relancer devient une anecdote datée, et la première
// régression l'aurait démentie sans que rien ne rougisse.
//
// `tests/resilience.test.ts` redémarre un orchestrateur DANS le processus de
// test — `server.stop()` puis `createServer` : un arrêt poli, sur des objets
// que le banc tient en main. Ici, rien de poli : de vrais processus, lancés par
// la porte des humains (`scripts/lancer.mjs`), une vraie base sur disque, et
// des pannes que ni la Reine ni le nœud ne voient venir.
//
// ─── LES QUATRE PANNES ───────────────────────────────────────────────────────
//
//   A. `kill -9` de la Reine en pleine mission, relancée sur la MÊME base et le
//      MÊME port ;
//   B. `kill -9` du nœud en pleine tâche, relancé avec le MÊME `HIVE_WORKDIR`
//      (donc la même identité) ;
//   C. un autre processus tient `BEGIN EXCLUSIVE` pendant 8 s — plus que le
//      délai d'attente de better-sqlite3 (5 s) : la Reine prend de vrais
//      `SQLITE_BUSY`, pas seulement une attente ;
//   D. le chemin réseau GÈLE — un relais TCP cesse de transmettre sans rien
//      fermer — plus longtemps que `NODE_TIMEOUT_MS`, pour que les DEUX côtés
//      renoncent.
//
// La cinquième du relevé du 25/09 (E, chemin réseau mort sans FIN) vit dans
// `tests/noeud-veille.test.ts`, sur le vrai client et de vraies sockets.
//
// ─── L'INVARIANT, LE MÊME POUR LES QUATRE ────────────────────────────────────
//
// Chaque tâche de la mission finit `done`, avec EXACTEMENT UNE ligne
// `results.success = 1`. « Au moins une » est ce que dit `done` (le statut ne
// se pose qu'après l'écriture du succès) ; « au plus une » est ce que promet
// le README — « aucun résultat n'est compté deux fois ». Le compte se lit dans
// la base, pas dans l'API : c'est la table que la Balance, les phéromones et
// le Genome relisent.
//
// ─── CHAQUE PANNE PROUVE QU'ELLE A MORDU ─────────────────────────────────────
//
// Un banc de panne qui passe parce que la panne est tombée à côté ne prouve
// rien. Chaque scénario exige donc la TRACE de la panne dans le journal de la
// Reine : une tâche remise en file au démarrage (A), une tâche reprise au nœud
// tué (B), un nœud tenu pour mort faute de battement (D) — et, pour C, des
// tâches encore en vol quand le verrou tombe, puis un vrai `SQLITE_BUSY` dans
// la sortie de la Reine.
//
// ─── CE QUI N'EST PAS ICI ────────────────────────────────────────────────────
//
// POSIX seulement, comme les autres bancs de vrais processus : `kill -9` et
// les groupes de processus n'ont pas d'équivalent fidèle sous Windows. Le
// mode conteneur (un `docker run` orphelin après le `kill -9` d'un nœud) n'est
// pas couvert : il demande un moteur que cette suite ne suppose pas.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { HEARTBEAT_INTERVAL_MS, NODE_TIMEOUT_MS } from '../src/shared/types.js';
import { lancerBorneTuyaute, reprendreTous, tuerGroupe } from './harnais-processus.js';
import type { ChildProcessAvecTuyaux } from './harnais-processus.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const LANCER = path.join(RACINE, 'scripts', 'lancer.mjs');
const POSIX = process.platform !== 'win32';
const TOKEN = 'jeton-de-banc-de-panne-suffisamment-long';
const SECRET = 'secret-de-session-du-banc-de-panne-assez-long';

/** Six tâches, deux de front : la panne tombe toujours sur du travail en vol. */
const TACHES = 6;
const CONCURRENCE = 2;

/** Le verrou de C : au-delà des 5 s d'attente par défaut de better-sqlite3. */
const VERROU_MS = 8_000;

/**
 * Le processus qui tient le verrou de C — un AUTRE processus, comme le dit le
 * README, et comme le serait une sauvegarde ou un `sqlite3` ouvert à la main
 * sur la base de production.
 *
 * Il fut d'abord une connexion DU BANC. Mesuré sur la jambe macOS : ainsi
 * tenu, le verrou n'y a jamais fait buter la Reine, deux fois de suite, alors
 * qu'il la bloquait sous Linux. La cause n'est pas caractérisée ; mais les
 * verrous `fcntl` sur lesquels SQLite repose appartiennent au PROCESSUS, pas
 * à la connexion, et le banc ouvre et ferme ses propres lectures pendant que
 * le verrou court. Un processus à lui seul ne partage rien de tout ça.
 *
 * CommonJS par `-e` : `argv[1]` est le module better-sqlite3 résolu depuis ce
 * fichier, `argv[2]` la base, `argv[3]` la durée.
 */
const VERROUILLEUR = [
  'const Database = require(process.argv[1]);',
  'const db = new Database(process.argv[2]);',
  "db.exec('BEGIN EXCLUSIVE');",
  "console.log('VERROU PRIS');",
  'setTimeout(() => {',
  "  db.exec('COMMIT');",
  '  db.close();',
  "  console.log('VERROU RENDU');",
  '}, Number(process.argv[3]));',
].join('\n');
const MODULE_SQLITE = createRequire(import.meta.url).resolve('better-sqlite3');

/**
 * Le gel de D : plus que le silence toléré des deux côtés (`NODE_TIMEOUT_MS`),
 * plus un battement — la veille du nœud ne regarde qu'à chaque battement —,
 * plus une marge. Calculé depuis les constantes réelles : si on les relève un
 * jour, le gel suit, et le banc continue de faire renoncer les deux côtés au
 * lieu de passer à côté.
 */
const GEL_MS = NODE_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS + 2_000;

// ─── Ménage ─────────────────────────────────────────────────────────────────
//
// Sans condition, et les processus AVANT les dossiers : une Reine encore
// vivante tient ouverte la base qu'on s'apprête à effacer (§ 2 duovicies du
// carnet).
const dossiers: string[] = [];
const relaisOuverts: Relais[] = [];
afterEach(async () => {
  reprendreTous();
  for (const r of relaisOuverts.splice(0)) await r.fermer();
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ─── Le banc : une Reine, un nœud, une base ─────────────────────────────────

interface Banc {
  dossier: string;
  db: string;
  /** Le port de la Reine, fixé pour qu'une Reine relancée le retrouve. */
  port: number;
  /** Le `HIVE_WORKDIR` du nœud : son identité survit à son processus. */
  travail: string;
  /** Tout ce que les processus ont dit — rendu en entier quand un banc rougit. */
  journal: string[];
  /** L'origine des horodatages du journal : une panne se lit dans le temps. */
  debut: number;
}

async function portLibre(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const adresse = s.address();
  await new Promise<void>((r) => s.close(() => r()));
  if (adresse === null || typeof adresse === 'string') throw new Error('adresse inattendue');
  return adresse.port;
}

async function nouveauBanc(): Promise<Banc> {
  const dossier = mkdtempSync(path.join(os.tmpdir(), 'ruche-panne-'));
  dossiers.push(dossier);
  return {
    dossier,
    db: path.join(dossier, 'ruche.db'),
    port: await portLibre(),
    travail: path.join(dossier, 'travail'),
    journal: [],
    debut: Date.now(),
  };
}

/** L'environnement de départ : AUCUN `HIVE_*` hérité de la machine qui lance la suite. */
function envPropre(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
  return { ...env, ...extra };
}

/** Range une ligne au journal, horodatée depuis le début du banc. */
function noter(banc: Banc, nom: string, texte: string): void {
  const t = ((Date.now() - banc.debut) / 1000).toFixed(1);
  banc.journal.push(`[${nom} +${t} s] ${texte}`);
}

/**
 * Lance un processus Node et attend son marqueur.
 *
 * Pour la Reine et le nœud, c'est `scripts/lancer.mjs` et pas `tsx` : un seul
 * processus, donc le `kill -9` frappe celui qui porte la ruche, pas une
 * enveloppe qui la relaierait. Le cwd est le dossier jetable : les deux
 * points d'entrée lisent le `.env` du répertoire courant, et celui du dépôt
 * n'a rien à faire ici.
 */
async function lancer(
  banc: Banc,
  nom: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  marqueur: string,
): Promise<ChildProcessAvecTuyaux> {
  const proc = lancerBorneTuyaute(process.execPath, args, {
    cwd: banc.dossier,
    env: envPropre(env),
  });
  let sortie = '';
  const lire = (m: Buffer): void => {
    const texte = m.toString('utf8');
    sortie += texte;
    noter(banc, nom, texte);
  };
  proc.stdout.on('data', lire);
  proc.stderr.on('data', lire);
  await attendre(
    () => sortie.includes(marqueur),
    `${nom} n’a jamais annoncé « ${marqueur} »`,
    45_000,
    banc,
  );
  return proc;
}

function lancerReine(banc: Banc): Promise<ChildProcessAvecTuyaux> {
  return lancer(
    banc,
    'reine',
    [LANCER, 'src/orchestrator/main.ts'],
    {
      HIVE_PORT: String(banc.port),
      HIVE_HOST: '127.0.0.1',
      HIVE_DB: banc.db,
      HIVE_TOKEN: TOKEN,
      HIVE_JWT_SECRET: SECRET,
      // L'ordonnanceur n'assigne à un nœud simulé que sur l'une des deux
      // trappes que `messageRefusShellProduction` annonce. Celle-ci ne relâche
      // AUCUNE garde de sécurité, contrairement à `HIVE_SIMULATION=1`.
      HIVE_AGENT: 'shell',
    },
    'orchestrateur (Queen) en ligne',
  );
}

/**
 * Lance le nœud et attend qu'il soit ENREGISTRÉ côté Reine — le marqueur du
 * nœud part avant la poignée de main WebSocket, et une mission créée entre
 * les deux ne dirait rien de plus.
 */
async function lancerNoeud(banc: Banc, url: string): Promise<ChildProcessAvecTuyaux> {
  const proc = await lancer(
    banc,
    'noeud',
    [LANCER, 'src/node-client/main.ts'],
    {
      HIVE_URL: url,
      HIVE_TOKEN: TOKEN,
      // Le shell SIMULÉ : 3 à 5 étapes de 350 à 750 ms, aucun processus
      // lancé. La panne porte sur la ruche, pas sur l'agent.
      HIVE_AGENT: 'shell',
      HIVE_WORKDIR: banc.travail,
      HIVE_ISOLEMENT: 'off',
      HIVE_NODE_NAME: 'ouvriere-de-panne',
      HIVE_MAX_CONCURRENCY: String(CONCURRENCE),
    },
    'Nœud Hive démarré',
  );
  const nodeId = readFileSync(path.join(banc.travail, 'node-id.txt'), 'utf8').trim();
  await attendre(
    () =>
      lire<{ status: string }>(banc, 'SELECT status FROM nodes WHERE id = ?', nodeId)[0]?.status ===
      'online',
    `le nœud ${nodeId} ne s’est jamais présenté à la Reine`,
    20_000,
    banc,
  );
  return proc;
}

/** Tue un processus en SIGKILL et attend sa mort — le `kill -9` du relevé. */
async function tuer(proc: ChildProcessAvecTuyaux): Promise<void> {
  const mort = new Promise<void>((r) => {
    if (proc.exitCode !== null || proc.signalCode !== null) r();
    else proc.once('exit', () => r());
  });
  tuerGroupe(proc, 'SIGKILL');
  await mort;
}

// ─── Lire la base, comme le ferait un second processus ──────────────────────

/** Les codes SQLite d'une base partagée avec un écrivain vivant : passagers. */
const TRANSITOIRES = ['SQLITE_CANTOPEN', 'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_READONLY_'];

/**
 * Une connexion en LECTURE SEULE, ouverte et refermée à chaque appel : elle
 * ne retient rien entre deux lectures, et survit donc au `kill -9` et au
 * redémarrage de la Reine qui écrit dans la même base.
 */
function lire<T>(banc: Banc, sql: string, ...params: unknown[]): T[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(banc.db, { readonly: true, fileMustExist: true });
    return db.prepare(sql).all(...params) as T[];
  } catch (e) {
    // Une base pas encore créée, ou occupée l'instant d'une écriture de la
    // Reine : on relira au tour suivant. Tout le reste — une requête fautive
    // d'abord — doit rougir ICI, pas se déguiser en « pas encore » jusqu'à
    // l'échéance.
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSITOIRES.some((t) => code.startsWith(t))) return [];
    throw e;
  } finally {
    db?.close();
  }
}

function statuts(banc: Banc, ids: readonly string[]): Map<string, string> {
  const lignes = lire<{ id: string; status: string }>(
    banc,
    `SELECT id, status FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  return new Map(lignes.map((l) => [l.id, l.status]));
}

function evenements(banc: Banc, type: string): Record<string, unknown>[] {
  return lire<{ payload: string }>(banc, 'SELECT payload FROM events WHERE type = ?', type).map(
    (e) => JSON.parse(e.payload) as Record<string, unknown>,
  );
}

/**
 * Scrute une condition jusqu'à l'échéance, puis échoue avec TOUT ce que les
 * processus ont dit. `quoi` peut être une fonction : l'état qu'on décrit est
 * alors celui de l'ÉCHÉANCE, pas celui du départ.
 */
async function attendre(
  condition: () => boolean,
  quoi: string | (() => string),
  echeanceMs: number,
  banc: Banc,
): Promise<void> {
  const depart = Date.now();
  while (!condition()) {
    if (Date.now() - depart > echeanceMs) {
      const dit = typeof quoi === 'string' ? quoi : quoi();
      throw new Error(`échéance (${echeanceMs} ms) : ${dit}\n${banc.journal.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ─── La mission, par l'API — le geste de l'opérateur ────────────────────────

async function creerMission(banc: Banc, nom: string): Promise<string[]> {
  const base = `http://127.0.0.1:${banc.port}`;
  const entetes = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
  const projet = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ name: nom }),
  });
  expect(projet.status, 'la Reine a refusé le projet').toBe(201);
  const { id } = (await projet.json()) as { id: string };
  const taches = await fetch(`${base}/api/projects/${id}/tasks`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      tasks: Array.from({ length: TACHES }, (_, i) => ({
        title: `${nom} — tâche ${i + 1}`,
        prompt: `travail ${i + 1}`,
      })),
    }),
  });
  expect(taches.status, 'la Reine a refusé les tâches').toBe(201);
  return ((await taches.json()) as { id: string }[]).map((t) => t.id);
}

/** Attend qu'une tâche au moins TOURNE : la panne doit tomber sur du travail en vol. */
async function enVol(banc: Banc, ids: readonly string[]): Promise<void> {
  await attendre(
    () => [...statuts(banc, ids).values()].includes('running'),
    'aucune tâche n’a jamais tourné',
    30_000,
    banc,
  );
}

/**
 * LE VERDICT, le même pour les quatre pannes : chaque tâche `done`, et
 * exactement un succès rangé par tâche.
 */
async function verdict(banc: Banc, ids: readonly string[]): Promise<void> {
  await attendre(
    () => {
      const s = statuts(banc, ids);
      return ids.every((id) => s.get(id) === 'done');
    },
    () => `la mission n’a pas repris : ${JSON.stringify(Object.fromEntries(statuts(banc, ids)))}`,
    90_000,
    banc,
  );
  const succes = lire<{ taskId: string; n: number }>(
    banc,
    `SELECT taskId, SUM(success) AS n FROM results WHERE taskId IN (${ids.map(() => '?').join(',')}) GROUP BY taskId`,
    ...ids,
  );
  const parTache = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const l of succes) parTache[l.taskId] = l.n;
  expect(parTache, 'un succès compté deux fois, ou une tâche finie sans succès rangé').toEqual(
    Object.fromEntries(ids.map((id) => [id, 1])),
  );
}

// ─── Le relais de D : un chemin réseau qu'on peut geler ─────────────────────

interface Relais {
  port: number;
  geler(): void;
  degeler(): void;
  fermer(): Promise<void>;
}

/**
 * Un relais TCP entre le nœud et la Reine.
 *
 * GELER n'est pas couper : aucune socket n'est fermée, rien n'est rejeté —
 * les octets cessent simplement de passer, dans les deux sens, comme sur un
 * Wi-Fi qui décroche. Une connexion ouverte PENDANT le gel est acceptée puis
 * retenue, sans être prolongée vers la Reine : sinon celle-ci la fermerait
 * au bout de ses 5 s d'authentification, et le gel fuirait.
 *
 * `unpipe` en plus de `pause` : un `pipe` reprend sa source tout seul au
 * prochain `drain`, et le gel fuirait par là.
 */
async function ouvrirRelais(cible: number): Promise<Relais> {
  let gele = false;
  const paires = new Set<[net.Socket, net.Socket]>();
  const retenues = new Set<net.Socket>();

  const relier = (client: net.Socket): void => {
    const amont = net.connect(cible, '127.0.0.1');
    const paire: [net.Socket, net.Socket] = [client, amont];
    paires.add(paire);
    amont.on('error', () => undefined);
    const fin = (): void => {
      client.destroy();
      amont.destroy();
      paires.delete(paire);
    };
    client.on('close', fin);
    amont.on('close', fin);
    client.pipe(amont);
    amont.pipe(client);
  };

  const serveur = net.createServer((client) => {
    client.on('error', () => undefined);
    if (gele) {
      client.pause();
      retenues.add(client);
      client.on('close', () => retenues.delete(client));
      return;
    }
    relier(client);
  });
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', () => r()));
  const adresse = serveur.address();
  if (adresse === null || typeof adresse === 'string') throw new Error('adresse inattendue');

  const relais: Relais = {
    port: adresse.port,
    geler() {
      gele = true;
      for (const [a, b] of paires) {
        a.unpipe(b);
        b.unpipe(a);
        a.pause();
        b.pause();
      }
    },
    degeler() {
      gele = false;
      for (const [a, b] of paires) {
        a.pipe(b);
        b.pipe(a);
      }
      for (const client of retenues) relier(client);
      retenues.clear();
    },
    async fermer() {
      for (const [a, b] of paires) {
        a.destroy();
        b.destroy();
      }
      for (const client of retenues) client.destroy();
      await new Promise<void>((r) => serveur.close(() => r()));
    },
  };
  relaisOuverts.push(relais);
  return relais;
}

// ─── Les bancs ──────────────────────────────────────────────────────────────

describe.runIf(POSIX)('reprise après panne — vrais processus, vraie base', () => {
  it('A. KILL -9 DE LA REINE en pleine mission — relancée sur la même base, tout reprend', async () => {
    const banc = await nouveauBanc();
    const reine = await lancerReine(banc);
    await lancerNoeud(banc, `ws://127.0.0.1:${banc.port}/ws`);
    const ids = await creerMission(banc, 'panne A');
    await enVol(banc, ids);

    await tuer(reine);
    await lancerReine(banc);

    await verdict(banc, ids);
    // La panne a mordu : au redémarrage, la Reine a trouvé du travail en vol
    // et l'a remis en file (`recoverOrphanTasks`).
    const reprises = evenements(banc, 'task_requeued').filter((e) => e.reason === 'boot_recovery');
    expect(reprises.length, 'le kill -9 n’est tombé sur aucune tâche en vol').toBeGreaterThan(0);
  }, 150_000);

  it('B. KILL -9 DU NŒUD en pleine tâche — relancé, même identité, rien n’est compté deux fois', async () => {
    const banc = await nouveauBanc();
    await lancerReine(banc);
    const url = `ws://127.0.0.1:${banc.port}/ws`;
    const noeud = await lancerNoeud(banc, url);
    const ids = await creerMission(banc, 'panne B');
    await enVol(banc, ids);

    await tuer(noeud);
    await lancerNoeud(banc, url);

    await verdict(banc, ids);
    const reprises = evenements(banc, 'task_requeued').filter((e) => e.reason === 'ws_closed');
    expect(reprises.length, 'le kill -9 n’est tombé sur aucune tâche en vol').toBeGreaterThan(0);
    // L'identité a survécu au processus : un seul nœud connu, pas de fantôme.
    expect(lire<{ id: string }>(banc, 'SELECT id FROM nodes')).toHaveLength(1);
  }, 150_000);

  it('C. BASE VERROUILLÉE par un autre processus pendant 8 s — la mission finit quand même', async () => {
    const banc = await nouveauBanc();
    await lancerReine(banc);
    await lancerNoeud(banc, `ws://127.0.0.1:${banc.port}/ws`);
    const ids = await creerMission(banc, 'panne C');
    await enVol(banc, ids);

    // Le verrou, tenu par un autre processus — voir `VERROUILLEUR`.
    await lancer(
      banc,
      'verrou',
      ['-e', VERROUILLEUR, MODULE_SQLITE, banc.db, String(VERROU_MS)],
      {},
      'VERROU PRIS',
    );
    // La panne a mordu : du travail était en vol quand le verrou est tombé.
    const auVerrou = statuts(banc, ids);
    noter(banc, 'banc', `statuts au verrou : ${JSON.stringify([...auVerrou.values()])}\n`);
    const enCours = [...auVerrou.values()].filter((s) => s !== 'done');
    expect(enCours.length, 'le verrou est tombé sur une mission déjà finie').toBeGreaterThan(0);
    await attendre(
      () => banc.journal.join('').includes('VERROU RENDU'),
      'le verrou n’a jamais été rendu',
      VERROU_MS + 10_000,
      banc,
    );
    // Et elle a mordu la REINE : une écriture au moins a pris `SQLITE_BUSY`
    // (« database is locked ») au lieu de seulement attendre — c'est ce que
    // garantissent 8 s de verrou contre 5 s d'attente, avec un progrès de
    // tâche journalisé à chaque étape (350 à 750 ms).
    //
    // ATTENDU, PAS CONSTATÉ À L'INSTANT. La Reine imprime ce message pendant
    // qu'une AUTRE écriture la retient jusqu'au `COMMIT` : better-sqlite3 est
    // synchrone, sa boucle est figée. Node n'écrit les tubes de stdio de façon
    // synchrone que sous Linux ; ailleurs, la ligne attend que la boucle se
    // libère. Mesuré : la jambe macOS rougissait sur le constat immédiat.
    await attendre(
      () => banc.journal.join('').includes('database is locked'),
      'la Reine n’a jamais buté sur le verrou',
      15_000,
      banc,
    );

    await verdict(banc, ids);
  }, 150_000);

  it('D. RÉSEAU GELÉ au-delà du délai de vie — les deux côtés renoncent, la mission reprend', async () => {
    const banc = await nouveauBanc();
    await lancerReine(banc);
    const relais = await ouvrirRelais(banc.port);
    await lancerNoeud(banc, `ws://127.0.0.1:${relais.port}/ws`);
    const ids = await creerMission(banc, 'panne D');
    await enVol(banc, ids);

    relais.geler();
    await new Promise((r) => setTimeout(r, GEL_MS));
    // Les deux côtés ont renoncé PENDANT le gel — sinon le banc n'a rien gelé
    // qui compte. La Reine : nœud tenu pour mort faute de battement, travail
    // remis en file. Le nœud : sa veille a quitté la connexion muette.
    const morts = evenements(banc, 'node_offline').filter((e) => e.reason === 'heartbeat_timeout');
    expect(morts.length, 'la Reine n’a jamais tenu le nœud pour mort').toBeGreaterThan(0);
    expect(banc.journal.join(''), 'la veille du nœud n’a jamais renoncé').toContain(
      'hub muet depuis',
    );
    relais.degeler();

    await verdict(banc, ids);
  }, 150_000);
});
