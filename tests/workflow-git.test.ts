// LE WORKFLOW GIT D'UNE OUVRIÈRE, ÉPROUVÉ SCÉNARIO PAR SCÉNARIO — CONTRE DE
// VRAIS DÉPÔTS.
//
// ─── POURQUOI CE BANC ────────────────────────────────────────────────────────
//
// La carte « Auditer workflow Git, branches, merge et conflits » listait huit
// scénarios. Deux seulement avaient un banc : le dépôt vide et le conflit de
// fusion (`depot-vide.test.ts`, `merge-runner.test.ts`). L'audit du 27/09 a jugé
// le chemin de code « sain et durci » — mais sain À LA LECTURE n'est pas une
// mesure. Ce fichier éprouve les cinq scénarios retenus avec les vraies
// fonctions du nœud (`prepareWorkspace`, `cloneRepo`, `runMerge`), un vrai
// `git`, de vrais dépôts bare, et un vrai serveur HTTP Git (`git http-backend`)
// quand c'est le transport qui est en cause :
//
//   · identifiants invalides — le plus utile des cinq : prouver que le clone
//     échoue VITE, et que l'échec REMONTE à l'opérateur comme issue de la
//     tâche, lisible, sans que l'agent ait tourné ;
//   · branche absente ;
//   · fichier non suivi ;
//   · changement concurrent — l'amont bouge sous l'espace de travail ;
//   · clone interrompu.
//
// La HEAD détachée est HORS PÉRIMÈTRE, par décision : le flux Hive fait
// toujours `checkoutLocalBranch`, elle ne peut pas y naître.
//
// ─── CE QUE CE BANC A TROUVÉ, ET POURQUOI CE N'EST PAS CORRIGÉ ICI ──────────
//
// Quatre défauts réels, tous dans `src/node-client/workspace.ts` — fichier tenu
// par un autre lot au moment où ce banc s'écrit. Ils sont CONSIGNÉS, pas
// cachés, et chacun est nommé sur place :
//
//   · `it.fails` quand le défaut se mesure en une seconde : le banc est VERT
//     tant que le défaut est là, et ROUGIT le jour de la correction — il
//     faudra alors le retourner en `it`, c'est-à-dire en garde ;
//   · `it.todo` quand la mesure exigerait d'attendre une borne qui n'existe
//     pas encore (on ne teste pas « ça bloque pour toujours » en attendant
//     pour toujours).
//
// Un `it.fails` n'est PAS une assertion du défaut comme comportement voulu :
// son corps écrit le comportement JUSTE. C'est ce qui le fera rougir au bon
// moment, et pas avant.

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { runMerge } from '../src/node-client/merge-runner.js';
import type { MergeDiff, MergeRunResult } from '../src/node-client/merge-runner.js';
import { cloneRepo, prepareWorkspace } from '../src/node-client/workspace.js';
import { createServer } from '../src/orchestrator/server.js';
import { MAX_ATTEMPTS } from '../src/shared/types.js';
import type { Task, TaskResult } from '../src/shared/types.js';

/**
 * Ce que « vite » veut dire ici. Mesuré sous Linux : 20 à 45 ms pour un clone
 * refusé. Dix secondes laissent la marge d'un runner Windows chargé, et restent
 * très loin de ce qu'on veut attraper — une attente SANS FIN, qui ne finit
 * jamais, quel que soit le plafond.
 */
const DELAI_ECHEC_RAPIDE_MS = 10_000;

/** Identité et réglages des commits FABRIQUÉS par le banc — rien de la personne. */
const REGLAGES_BANC = [
  '-c',
  'user.email=banc@hive.local',
  '-c',
  'user.name=Banc Hive',
  // Un `commit.gpgsign = true` global ne doit pas empêcher la suite de tourner
  // (cf. l'en-tête de `merge-runner.test.ts`) ; et `core.autocrlf=false` fait
  // committer EXACTEMENT les octets écrits, sous Windows compris.
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

let racine: string;
/** Les dépôts bare de l'amont — c'est aussi la racine que sert `git http-backend`. */
let projets: string;
/** Le `workRoot` du nœud : chaque tâche s'y prépare sous `tasks/<id>`. */
let travail: string;
let serveur: ServeurGit;

beforeAll(async () => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-workflow-git-'));
  projets = path.join(racine, 'projets');
  travail = path.join(racine, 'travail');
  mkdirSync(projets, { recursive: true });
  serveur = new ServeurGit(projets);
  await serveur.demarrer();
});

afterAll(async () => {
  await serveur.fermer();
  try {
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Objets git en lecture seule sous Windows : sans gravité pour un tmpdir.
  }
});

// ─── LES OUTILS DU BANC ──────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...REGLAGES_BANC, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function ecrire(dossier: string, fichiers: Record<string, string | Buffer>): void {
  for (const [relatif, contenu] of Object.entries(fichiers)) {
    const chemin = path.join(dossier, relatif);
    mkdirSync(path.dirname(chemin), { recursive: true });
    writeFileSync(chemin, contenu);
  }
}

/** Le texte d'un fichier, fins de ligne ramenées à `\n` (`core.autocrlf` sous Windows). */
function lireTexte(dossier: string, relatif: string): string {
  return readFileSync(path.join(dossier, relatif), 'utf8').replace(/\r\n/g, '\n');
}

const tache = (id: string): Task => ({ id, title: id, prompt: 'x', branch: null }) as Task;

interface Amont {
  /** Le dépôt bare, tel qu'une tâche le clone. */
  depot: string;
  /** La copie de travail qui l'alimente — l'amont qui avance pendant la tâche. */
  copie: string;
}

/** Un dépôt bare `projets/<nom>.git` avec un premier commit sur `main`. */
function amont(nom: string, fichiers: Record<string, string | Buffer>): Amont {
  const depot = path.join(projets, `${nom}.git`);
  execFileSync('git', ['init', '-q', '--bare', depot]);
  // HEAD posée EXPLICITEMENT : sans ça, elle suivrait `init.defaultBranch` de
  // la machine — `master` sur un runner, `main` ailleurs — et le scénario
  // « branche absente » se produirait par accident dans tous les autres.
  git(depot, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const copie = path.join(racine, 'amont', nom);
  mkdirSync(copie, { recursive: true });
  git(copie, 'init', '-q');
  git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  pousser({ depot, copie }, fichiers, 'premier commit');
  return { depot, copie };
}

function pousser(a: Amont, fichiers: Record<string, string | Buffer>, message: string): void {
  ecrire(a.copie, fichiers);
  git(a.copie, 'add', '--all');
  git(a.copie, 'commit', '-q', '-m', message);
  git(a.copie, 'push', '-q', a.depot, 'main');
}

/**
 * Le chemin d'un merge sur un nœud (`runMergeJob`) : un clone FRAIS de l'amont
 * par `cloneRepo`, puis `runMerge`. C'est l'amont d'AUJOURD'HUI qui sert de
 * base — c'est tout le sujet du changement concurrent.
 */
async function fusionnerSurClone(
  a: Amont,
  diffs: MergeDiff[],
): Promise<{ dossier: string; resultat: MergeRunResult }> {
  const dossier = mkdtempSync(path.join(racine, 'fusion-'));
  rmSync(dossier, { recursive: true, force: true });
  await cloneRepo(dossier, a.depot);
  return { dossier, resultat: await runMerge({ repoDir: dossier, diffs }) };
}

type Issue<T> =
  { etat: 'resolue'; valeur: T } | { etat: 'rejetee'; motif: string } | { etat: 'en-attente' };

/**
 * L'issue d'une promesse AU BOUT DE `ms` — rejetée, résolue, ou toujours en
 * attente. C'est ce qui fait de « échoue VITE » une assertion : une attente
 * sans fin se lit `en-attente` dans le message d'échec, au lieu d'un délai de
 * test dépassé qui ne dit pas ce qu'on attendait.
 */
async function issueSous<T>(promesse: Promise<T>, ms: number): Promise<Issue<T>> {
  let minuteur: NodeJS.Timeout | undefined;
  const attente = new Promise<Issue<T>>((fin) => {
    minuteur = setTimeout(() => fin({ etat: 'en-attente' }), ms);
  });
  try {
    return await Promise.race([
      promesse.then(
        (valeur): Issue<T> => ({ etat: 'resolue', valeur }),
        (e: unknown): Issue<T> => ({
          etat: 'rejetee',
          motif: e instanceof Error ? e.message : String(e),
        }),
      ),
      attente,
    ]);
  } finally {
    clearTimeout(minuteur);
  }
}

type ModeServeur = 'normal' | 'coupe' | 'identifiants';

/** Octets du pack servis avant de couper la connexion, en mode `coupe`. */
const COUPURE_OCTETS = 8 * 1024;

/**
 * Un serveur HTTP Git RÉEL — `git http-backend`, le CGI livré avec git — sur la
 * boucle locale, avec deux pannes à la demande :
 *
 *   · `identifiants` : tout est refusé en 401 Basic, comme un dépôt privé ;
 *   · `coupe` : la réponse du pack est tranchée après `COUPURE_OCTETS`, et la
 *     connexion fermée — un réseau qui lâche en plein transfert.
 *
 * Aucun octet ne sort de la machine : un banc qui dépend d'un tiers pour savoir
 * quand il finit mesure le tiers, pas le code (docs/ERREURS.md).
 */
class ServeurGit {
  mode: ModeServeur = 'normal';
  /** Requêtes reçues AVEC un en-tête `Authorization`, en mode `identifiants`. */
  authentifications = 0;
  private port = 0;
  private readonly http = createHttpServer((req, res) => this.repondre(req, res));

  constructor(private readonly racineDepots: string) {}

  async demarrer(): Promise<void> {
    await new Promise<void>((pret) => this.http.listen(0, '127.0.0.1', () => pret()));
    this.port = (this.http.address() as AddressInfo).port;
  }

  url(nom: string): string {
    return `http://127.0.0.1:${this.port}/${nom}.git`;
  }

  async fermer(): Promise<void> {
    this.http.closeAllConnections();
    await new Promise<void>((fin) => this.http.close(() => fin()));
  }

  private repondre(req: IncomingMessage, res: ServerResponse): void {
    if (this.mode === 'identifiants') {
      if (req.headers.authorization) this.authentifications += 1;
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="depot prive"' });
      res.end('identifiants requis');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const cgi = spawn('git', ['http-backend'], {
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        SYSTEMDRIVE: process.env.SYSTEMDRIVE,
        GIT_PROJECT_ROOT: this.racineDepots,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        ...(req.headers['content-encoding']
          ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] }
          : {}),
        ...(req.headers['git-protocol']
          ? { GIT_PROTOCOL: String(req.headers['git-protocol']) }
          : {}),
      },
    });
    cgi.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    cgi.stdin.on('error', () => {}); // le CGI tué en mode `coupe` ne lit plus
    req.pipe(cgi.stdin);

    const couper = this.mode === 'coupe' && req.method === 'POST';
    let tampon = Buffer.alloc(0);
    let entetesEnvoyes = false;
    let envoyes = 0;
    cgi.stdout.on('data', (morceau: Buffer) => {
      let corps = morceau;
      if (!entetesEnvoyes) {
        tampon = Buffer.concat([tampon, morceau]);
        const fin = tampon.indexOf('\r\n\r\n');
        if (fin < 0) return;
        let statut = 200;
        const entetes: Record<string, string> = {};
        for (const ligne of tampon.subarray(0, fin).toString('latin1').split('\r\n')) {
          const deuxPoints = ligne.indexOf(':');
          const nom = ligne.slice(0, deuxPoints).trim();
          const valeur = ligne.slice(deuxPoints + 1).trim();
          if (nom.toLowerCase() === 'status') statut = Number.parseInt(valeur, 10);
          else entetes[nom] = valeur;
        }
        res.writeHead(statut, entetes);
        entetesEnvoyes = true;
        corps = tampon.subarray(fin + 4);
      }
      if (!couper) {
        res.write(corps);
        return;
      }
      res.write(corps.subarray(0, Math.max(0, COUPURE_OCTETS - envoyes)));
      envoyes += corps.length;
      if (envoyes >= COUPURE_OCTETS) {
        cgi.kill();
        res.destroy();
      }
    });
    cgi.stdout.on('end', () => {
      if (!res.destroyed) res.end();
    });
  }
}

// ─── 1. IDENTIFIANTS INVALIDES ───────────────────────────────────────────────

describe('identifiants Git invalides — l’échec est RAPIDE, et il REMONTE', () => {
  // ─── CE QUE `GIT_TERMINAL_PROMPT=0` ACHÈTE, MESURÉ ─────────────────────────
  //
  // Un dépôt privé répond 401. Sans ce réglage, git demande un nom
  // d'utilisateur sur le TERMINAL du processus. Un nœud lancé à la main dans
  // un terminal en a un : mesuré sous un vrai pseudo-terminal, git affiche
  // « Username for 'http://127.0.0.1:…': » et ATTEND — jusqu'à ce qu'on le
  // tue. La tâche reste « running », son créneau est pris, et personne ne lit
  // l'invite. Avec le réglage : « terminal prompts disabled », en quelques
  // dizaines de millisecondes.
  //
  // Le motif exact est l'assertion, et il n'est pas décoratif : sans terminal
  // (une CI), git échoue aussi, mais avec « No such device or address ». Seul
  // « terminal prompts disabled » prouve que la garde est posée ET honorée —
  // retirez-la de `workspace.ts`, ce banc rougit ici, et partout où il
  // tournerait sous un terminal il resterait bloqué.
  //
  // Les DEUX portes de clone du nœud sont éprouvées : elles portent chacune
  // leur copie de l'environnement de clone, et une copie se nettoie seule.

  it.each<[string, (dossier: string, url: string) => Promise<unknown>]>([
    [
      'prepareWorkspace, le clone d’une tâche',
      (dossier, url) => prepareWorkspace(dossier, tache('sans-identifiants'), url),
    ],
    [
      'cloneRepo, le clone d’un merge ou d’un chantier',
      (dossier, url) => cloneRepo(path.join(dossier, 'clone'), url),
    ],
  ])(
    '%s : sans identifiants, git échoue sur-le-champ au lieu d’ouvrir une invite',
    async (_porte, cloner) => {
      serveur.mode = 'identifiants';
      const dossier = mkdtempSync(path.join(racine, 'sans-identifiants-'));
      const issue = await issueSous(cloner(dossier, serveur.url('prive')), DELAI_ECHEC_RAPIDE_MS);
      expect(issue).toMatchObject({
        etat: 'rejetee',
        motif: expect.stringMatching(/terminal prompts disabled/),
      });
    },
  );

  it('des identifiants FAUX dans l’URL : refus sur-le-champ, et le secret ne ressort pas dans la raison', async () => {
    serveur.mode = 'identifiants';
    const secret = 'jeton-perime-9f3c2a';
    const avant = serveur.authentifications;
    const url = serveur.url('prive').replace('http://', `http://marie:${secret}@`);
    const issue = await issueSous(
      prepareWorkspace(travail, tache('identifiants-faux'), url),
      DELAI_ECHEC_RAPIDE_MS,
    );
    expect(issue).toMatchObject({
      etat: 'rejetee',
      motif: expect.stringMatching(/Authentication failed/),
    });
    // C'est bien un REFUS d'identifiants, pas leur absence : git les a envoyés.
    expect(serveur.authentifications).toBeGreaterThan(avant);
    // La raison part dans les journaux de la tâche, puis au hub et à l'écran :
    // le mot de passe de l'URL ne doit pas voyager avec elle.
    expect(issue.etat === 'rejetee' ? issue.motif : '').not.toContain(secret);
  });

  it(
    'LA TÂCHE FINIT `failed`, AVEC LA RAISON LISIBLE PAR L’OPÉRATEUR — et l’agent n’a jamais tourné',
    { timeout: 60_000 },
    async () => {
      // Le parcours ENTIER, parce que c'est lui que l'opérateur voit : une
      // vraie Reine, une vraie ouvrière, un projet dont le dépôt refuse. Ce
      // qu'il faut prouver n'est pas « prepareWorkspace lève » — c'est que la
      // levée devient une issue de tâche, et pas une tâche « running » à
      // jamais ni un succès vide (la doctrine interdit l'échec silencieux).
      serveur.mode = 'identifiants';
      const JETON = 'jeton-workflow-git-suffisant';
      const entetes = { 'content-type': 'application/json', 'x-hive-token': JETON };
      let lancementsAgent = 0;
      const agent: AgentAdapter = {
        name: 'temoin',
        async run() {
          lancementsAgent += 1;
          return { success: true, diff: '', logs: 'ok', subAgents: [] };
        },
      };
      const reine = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: JETON,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(racine, 'reine.db'),
        simulation: true,
        tickMs: 100,
      });
      const base = `http://127.0.0.1:${reine.port}`;
      const ouvriere = new HiveNodeClient({
        url: `ws://127.0.0.1:${reine.port}/ws`,
        token: JETON,
        name: 'sans-cles',
        ownerName: 'banc',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: 'noeud-sans-cles',
        workRoot: path.join(racine, 'ouvriere'),
        adapter: agent,
        quiet: true,
      });
      ouvriere.start();
      async function appel<T>(route: string, corps?: unknown): Promise<T> {
        const res = await fetch(
          `${base}${route}`,
          corps === undefined
            ? { headers: entetes }
            : { method: 'POST', headers: entetes, body: JSON.stringify(corps) },
        );
        expect(res.ok, `${route} → HTTP ${res.status}`).toBe(true);
        return (await res.json()) as T;
      }
      try {
        const projet = await appel<{ id: string }>('/api/projects', {
          name: 'Dépôt privé',
          repoUrl: serveur.url('prive'),
        });
        const [t] = await appel<Task[]>(`/api/projects/${projet.id}/tasks`, {
          tasks: [{ title: 'Toucher au privé', prompt: 'travail' }],
        });
        const taskId = (t as Task).id;

        const echeance = Date.now() + 30_000;
        let statut: string | undefined;
        while (Date.now() < echeance) {
          const etat = await appel<{ tasks: Task[] }>('/api/state');
          statut = etat.tasks.find((x) => x.id === taskId)?.status;
          if (statut === 'failed') break;
          await new Promise((r) => setTimeout(r, 150));
        }
        expect(statut).toBe('failed');

        // Chaque tentative est une PRODUCTION rangée, en échec, qui dit
        // pourquoi — c'est ce que l'écran de la tâche relit.
        const productions = await appel<TaskResult[]>(`/api/tasks/${taskId}/results`);
        expect(productions).toHaveLength(MAX_ATTEMPTS);
        for (const p of productions) {
          expect(p.success).toBe(false);
          expect(p.logs).toMatch(/terminal prompts disabled/);
          expect(p.durationMs).toBeLessThan(DELAI_ECHEC_RAPIDE_MS);
        }
        // Et l'agent n'a JAMAIS été lancé sur un espace sans dépôt : il aurait
        // « réussi » sur un répertoire vide, et le succès aurait menti.
        expect(lancementsAgent).toBe(0);
      } finally {
        ouvriere.stop();
        await reine.stop();
      }
    },
  );
});

// ─── 2. BRANCHE ABSENTE ──────────────────────────────────────────────────────

describe('branche absente', () => {
  // ─── DÉFAUT CONSIGNÉ — workspace.ts, `prepareWorkspace` et `cloneRepo` ─────
  //
  // Un dépôt bare fait à la main — `git init --bare` sur un NAS, un serveur
  // ssh — garde souvent HEAD → `master` pendant qu'on y pousse `main`. Le dépôt
  // a du code ; sa branche par défaut n'existe pas.
  //
  // Mesuré : git dit « You appear to have cloned an empty repository », le
  // clone RÉUSSIT, `prepareWorkspace` RÉSOUT, et l'espace de travail ne
  // contient que `.git`. L'agent part d'un projet vide qui ne l'est pas, et sa
  // tâche « réussit » en recréant de zéro ce qui existait. La fusion repart du
  // même clone vide (`cloneRepo`), où un diff de création s'applique sans un
  // conflit — c'est ce que `depot-vide.test.ts` mesure. Aucun signal nulle part.
  //
  // Le comportement juste : le DIRE, en nommant la branche qui manque. Le
  // dépôt vide, lui, doit continuer de se préparer (`depot-vide.test.ts`) —
  // la différence se lit chez le distant (`git ls-remote` y voit `main`).
  it.fails(
    'HEAD désigne une branche qui n’existe pas : la tâche doit le DIRE, pas recevoir un espace vide',
    async () => {
      const a = amont('tete-orpheline', { 'LISEZMOI.md': '# Du vrai code\n' });
      git(a.depot, 'symbolic-ref', 'HEAD', 'refs/heads/master');
      // Résolue, la préparation rend ce que l'agent recevrait — aujourd'hui
      // `['.git']`, et c'est ce que le message d'échec affichera.
      const recu = prepareWorkspace(travail, tache('tete-orpheline'), a.depot).then((ws) =>
        readdirSync(ws.cwd),
      );
      await expect(recu).rejects.toThrow(/master/);
    },
  );
});

// ─── 3. FICHIER NON SUIVI ────────────────────────────────────────────────────

describe('fichier non suivi — ce que l’agent laisse doit arriver ENTIER à la revue', () => {
  it('un fichier neuf dans un dossier neuf entre dans le diff et la fusion le recrée ; un fichier ignoré n’y entre pas', async () => {
    const a = amont('non-suivi', { 'app.txt': 'bonjour\n', '.gitignore': 'dist/\n' });
    const ws = await prepareWorkspace(travail, tache('non-suivi'), a.depot);
    try {
      ecrire(ws.cwd, { 'docs/guide/nouveau.md': '# Guide\n', 'dist/paquet.js': 'compilé\n' });
      const diff = await ws.collectDiff();
      expect(diff).toContain('docs/guide/nouveau.md');
      // Ignoré par le dépôt, donc hors de la revue : c'est ainsi que
      // `node_modules`, un `.env` ou un build ne partent pas au hub.
      expect(diff).not.toContain('dist/paquet.js');

      const { dossier, resultat } = await fusionnerSurClone(a, [{ taskId: 'non-suivi', diff }]);
      expect(resultat.conflicts).toEqual([]);
      expect(resultat.applied).toEqual(['non-suivi']);
      expect(lireTexte(dossier, 'docs/guide/nouveau.md')).toBe('# Guide\n');
    } finally {
      ws.cleanup();
    }
  });

  // ─── DÉFAUT CONSIGNÉ — workspace.ts, `collectDiff` (et `mergedDiff`) ───────
  //
  // `git diff` sans `--binary` résume un fichier binaire en « Binary files
  // /dev/null and b/logo.png differ » : le CONTENU n'y est pas. Mesuré : la
  // fusion refuse alors le diff ENTIER comme « conflit » — le texte d'à côté
  // part avec — alors qu'aucun conflit n'existe. Un binaire créé par l'agent
  // (une image, une police, un fixture) coûte toute la production, sous un
  // motif faux.
  it.fails('un fichier BINAIRE non suivi doit survivre au diff et à la fusion', async () => {
    const a = amont('binaire', { 'app.txt': 'bonjour\n' });
    const ws = await prepareWorkspace(travail, tache('binaire'), a.depot);
    try {
      const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x00]);
      ecrire(ws.cwd, { 'logo.png': logo, 'notes.txt': 'à côté\n' });
      const diff = await ws.collectDiff();
      const { dossier, resultat } = await fusionnerSurClone(a, [{ taskId: 'binaire', diff }]);
      expect(resultat.conflicts).toEqual([]);
      expect(readFileSync(path.join(dossier, 'logo.png')).equals(logo)).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  // ─── DÉFAUT CONSIGNÉ — workspace.ts, `collectDiff` ─────────────────────────
  //
  // Le diff se calcule entre l'INDEX et l'arbre de travail. Tout ce que
  // l'agent a lui-même mis en index (`git add`) ou committé sur sa branche
  // `hive/<id>` en sort donc. Mesuré : diff VIDE dans les deux cas — le
  // travail est perdu, et la tâche se déclare réussie avec rien.
  //
  // Claude Code (`acceptEdits`, sans Bash) et Codex (`.git` en lecture seule
  // dans son bac) ne le peuvent pas aujourd'hui ; un agent `custom`, Cursor ou
  // Cline le peuvent. Le juste : comparer au commit de départ du clone, pas à
  // l'index.
  it.fails(
    'une modification que l’agent a mise en index (`git add`) doit rester dans le diff',
    async () => {
      const a = amont('mis-en-index', { 'app.txt': 'bonjour\n' });
      const ws = await prepareWorkspace(travail, tache('mis-en-index'), a.depot);
      try {
        ecrire(ws.cwd, { 'app.txt': 'bonjour, ruche\n' });
        git(ws.cwd, 'add', 'app.txt');
        expect(await ws.collectDiff()).toContain('+bonjour, ruche');
      } finally {
        ws.cleanup();
      }
    },
  );

  it.fails('un commit que l’agent a fait sur sa branche doit rester dans le diff', async () => {
    const a = amont('committe', { 'app.txt': 'bonjour\n' });
    const ws = await prepareWorkspace(travail, tache('committe'), a.depot);
    try {
      ecrire(ws.cwd, { 'app.txt': 'bonjour, ruche\n' });
      git(ws.cwd, 'commit', '-q', '-a', '-m', 'l’agent committe lui-même');
      expect(await ws.collectDiff()).toContain('+bonjour, ruche');
    } finally {
      ws.cleanup();
    }
  });
});

// ─── 4. CHANGEMENT CONCURRENT ────────────────────────────────────────────────

describe('changement concurrent — l’amont bouge sous l’espace de travail', () => {
  // La tâche clone l'amont à l'instant T ; quelqu'un pousse pendant qu'elle
  // travaille ; le merge, lui, repart d'un clone FRAIS — la base a bougé. Deux
  // choses doivent tenir : un changement disjoint passe sans que le diff
  // soumis à la revue ne DÉFASSE l'amont, et un changement au même endroit est
  // un conflit, jamais un écrasement.
  //
  // Prudence assumée, consignée ici plutôt que figée en banc : `git apply`
  // n'a pas de fusion à trois voies. Une modification amont VOISINE (dans les
  // trois lignes de contexte d'un bloc de la tâche) est donc, elle aussi,
  // rendue en conflit. Faux positif possible, perte impossible.
  /** Vingt lignes, dont certaines (numérotées à partir de 1) sont réécrites. */
  const lignes = (reecrites: Record<number, string> = {}): string =>
    Array.from({ length: 20 }, (_, i) => reecrites[i + 1] ?? `ligne ${i + 1}`).join('\n') + '\n';

  async function diffDeTache(
    a: Amont,
    id: string,
    fichiers: Record<string, string>,
  ): Promise<string> {
    const ws = await prepareWorkspace(travail, tache(id), a.depot);
    try {
      ecrire(ws.cwd, fichiers);
      return await ws.collectDiff();
    } finally {
      ws.cleanup();
    }
  }

  it('un changement amont DISJOINT : le diff s’applique sur la nouvelle base, sans défaire l’amont', async () => {
    const a = amont('concurrent-disjoint', { 'app.txt': lignes() });
    const diff = await diffDeTache(a, 'concurrent-disjoint', {
      'app.txt': lignes({ 1: 'ligne 1 — la tâche' }),
    });
    pousser(a, { 'app.txt': lignes({ 20: 'ligne 20 — l’amont' }) }, 'l’amont avance');

    const { dossier, resultat } = await fusionnerSurClone(a, [
      { taskId: 'concurrent-disjoint', diff },
    ]);
    expect(resultat.conflicts).toEqual([]);
    expect(resultat.applied).toEqual(['concurrent-disjoint']);
    expect(lireTexte(dossier, 'app.txt')).toBe(
      lignes({ 1: 'ligne 1 — la tâche', 20: 'ligne 20 — l’amont' }),
    );
    // Le diff soumis à la revue est celui de la TÂCHE sur la base du jour : il
    // ne propose pas de revenir sur ce que l'amont a poussé entre-temps.
    expect(resultat.mergedDiff).toContain('+ligne 1 — la tâche');
    expect(resultat.mergedDiff).not.toMatch(/^[-+]ligne 20/m);
  });

  it('le MÊME endroit modifié en amont : conflit réel, et l’amont reste intact', async () => {
    const a = amont('concurrent-meme-ligne', { 'app.txt': lignes() });
    const diff = await diffDeTache(a, 'concurrent-meme-ligne', {
      'app.txt': lignes({ 1: 'ligne 1 — la tâche' }),
    });
    pousser(a, { 'app.txt': lignes({ 1: 'ligne 1 — l’amont' }) }, 'l’amont réécrit la même ligne');

    const { dossier, resultat } = await fusionnerSurClone(a, [
      { taskId: 'concurrent-meme-ligne', diff },
    ]);
    expect(resultat.applied).toEqual([]);
    expect(resultat.conflicts.map((c) => c.taskId)).toEqual(['concurrent-meme-ligne']);
    expect(lireTexte(dossier, 'app.txt')).toBe(lignes({ 1: 'ligne 1 — l’amont' }));
    expect(resultat.mergedDiff).toBe('');
  });

  it('l’espace de travail disparaît pendant la tâche : le diff ÉCHOUE, il ne revient jamais vide', async () => {
    // Un diff vide rendu ici se lirait « la tâche n'a rien changé » — un
    // succès creux, silencieux. Une levée devient une production en échec
    // (`[nœud] exception : …`), visible. Suite consignée : le motif rendu est
    // aujourd'hui « spawn git ENOENT », qui fait chercher un git absent là où
    // c'est le RÉPERTOIRE qui manque.
    const a = amont('espace-disparu', { 'app.txt': 'bonjour\n' });
    const ws = await prepareWorkspace(travail, tache('espace-disparu'), a.depot);
    ecrire(ws.cwd, { 'app.txt': 'bonjour, ruche\n' });
    renameSync(ws.cwd, `${ws.cwd}-deplace`);
    await expect(ws.collectDiff()).rejects.toThrow();
  });
});

// ─── 5. CLONE INTERROMPU ─────────────────────────────────────────────────────

describe('clone interrompu', () => {
  it('la connexion coupée en plein transfert : échec sur-le-champ, raison lisible — et la tentative suivante repart propre', async () => {
    // Assez lourd pour que la coupure tombe EN PLEIN pack : des octets
    // aléatoires ne se compressent pas.
    amont('lourd', { 'LISEZMOI.md': '# Lourd\n', 'donnees.bin': randomBytes(256 * 1024) });
    const t = tache('clone-coupe');

    serveur.mode = 'coupe';
    const coupe = await issueSous(
      prepareWorkspace(travail, t, serveur.url('lourd')),
      DELAI_ECHEC_RAPIDE_MS,
    );
    expect(coupe).toMatchObject({
      etat: 'rejetee',
      motif: expect.stringMatching(/early EOF|RPC failed|index-pack|transfer closed/),
    });

    serveur.mode = 'normal';
    const ws = await prepareWorkspace(travail, t, serveur.url('lourd'));
    try {
      expect(ws.branch).toBe('hive/clone-coupe');
      expect(lireTexte(ws.cwd, 'LISEZMOI.md')).toBe('# Lourd\n');
    } finally {
      ws.cleanup();
    }
  });

  it('les restes d’un clone TUÉ (nœud arrêté en plein clone) ne gênent pas la tentative suivante', async () => {
    const a = amont('restes', { 'LISEZMOI.md': '# Propre\n' });
    const t = tache('restes-de-clone');
    const cwd = path.join(travail, 'tasks', t.id);
    // Ce qu'un git tué laisse derrière lui — mesuré sur un clone bloqué puis
    // interrompu : un `.git` à moitié écrit, un pack temporaire ; et le TEMP
    // voisin d'une tentative précédente.
    ecrire(cwd, {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/objects/pack/tmp_pack_interrompu': 'tronqué',
      'LISEZMOI.md': '# Reste d’une autre tentative\n',
    });
    ecrire(`${cwd}.tmp`, { 'reste.txt': 'x' });

    const ws = await prepareWorkspace(travail, t, a.depot);
    try {
      expect(ws.branch).toBe('hive/restes-de-clone');
      expect(lireTexte(ws.cwd, 'LISEZMOI.md')).toBe('# Propre\n');
      expect(existsSync(path.join(ws.cwd, '.git', 'objects', 'pack', 'tmp_pack_interrompu'))).toBe(
        false,
      );
      expect(existsSync(path.join(`${cwd}.tmp`, 'reste.txt'))).toBe(false);
    } finally {
      ws.cleanup();
    }
  });

  // ─── DÉFAUT CONSIGNÉ — workspace.ts, `prepareWorkspace` et `cloneRepo` ─────
  //
  // Un serveur qui accepte la connexion puis se TAIT — en plein pack, ou dès
  // la première requête — et le clone attend. Mesuré : toujours en attente au
  // bout de 90 s, tué de l'extérieur ; git n'a pas de délai de transfert par
  // défaut (`http.lowSpeedLimit`/`lowSpeedTime` non posés), et le nœud n'en
  // pose aucun. Le signal d'annulation de la tâche n'atteint pas non plus le
  // clone. La tâche reste « running » sans fin, et son créneau avec elle.
  //
  // `todo` et pas `fails` : ce banc ne peut rougir qu'une fois la borne posée,
  // et il devra alors pouvoir la raccourcir — attendre la borne de production
  // ferait de lui le banc le plus lent de la suite.
  it.todo(
    'un serveur qui se tait en plein clone doit rendre la tâche en échec dans une borne (aujourd’hui : aucune)',
  );
});
