// SIGTERM ARRÊTE LE NŒUD COMME UN CTRL+C — et l'agent en cours part avec lui.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// Les deux portes du nœud (`npm run node` → `main.ts`, `hive join` →
// `join.ts`) n'écoutaient que SIGINT. Or SIGINT n'arrive que d'un terminal :
// ce qui SUPERVISE un nœud envoie SIGTERM — `npm run ruche` à l'arrêt
// (`scripts/ruche.mjs` : `e.kill('SIGTERM')`, au seul pid de l'ouvrière),
// systemd, launchd, un `kill` sans option. Sans gestionnaire, SIGTERM tuait le
// nœud NET, sans `client.stop()`, donc sans annuler ses tâches.
//
// L'agent lancé pour la tâche en cours est un enfant du nœud, pas un membre de
// son sort : il SURVIVAIT, rattaché à l'init, à écrire dans l'espace de travail
// et à consommer le quota de l'agent pour une tâche que la Reine venait de
// remettre en file — et qu'un autre nœud allait refaire. Mesuré ici, avant
// correctif, sur les deux portes : nœud mort par signal (code `null`,
// `SIGTERM`), agent toujours vivant.
//
// ─── CE QUE LE BANC FAIT, ET POURQUOI COMME ÇA ───────────────────────────────
//
// Une ruche réelle (`createServer`, base jetable), un nœud RÉEL lancé par la
// porte des humains (`scripts/lancer.mjs` : un seul processus, le signal va à
// celui qui doit le traiter), et un agent RÉEL : l'adaptateur `custom`
// (`HIVE_AGENT_CMD`) lance un petit script Node qui écrit son pid puis attend
// indéfiniment.
//
// LE NŒUD N'EST PAS LANCÉ DIRECTEMENT PAR LE HARNAIS, et c'est délibéré. Le
// harnais balaie le GROUPE d'un processus à l'instant où celui-ci meurt
// (`lancerBorne`, « la mort du père n'est pas la fin du groupe ») — l'agent,
// dans le groupe du nœud, aurait donc été abattu par le filet du banc, et le
// banc aurait prouvé sa propre action au lieu de celle du nœud. Mesuré : la
// première version passait AVANT correctif. On intercale donc un SUPERVISEUR
// minimal, qui est exactement la forme de `ruche.mjs` : il lance le nœud dans
// son groupe à lui, et ne meurt pas avec lui. Le harnais tient le superviseur ;
// le filet reste entier (`reprendreTous` reprend le groupe, orphelin compris),
// il tombe simplement APRÈS le constat.
//
// Le SIGTERM vise le NŒUD SEUL, comme `ruche.mjs` : frapper le groupe tuerait
// l'agent par le banc lui-même.
//
// ─── L'ARBRE, ET WINDOWS ─────────────────────────────────────────────────────
//
// L'agent de ce banc lance un PETIT-ENFANT et IGNORE SIGTERM — la forme d'un
// agent réel qui lance ses outils, et d'un runner mal élevé. L'annulation ne
// visait que l'agent : son SIGTERM tombait dans le vide, et le petit-enfant
// n'en recevait aucun. Tout l'arbre doit partir (`arbre-processus.ts`).
//
// Sous Windows, `npm run ruche` tuait ses ouvrières par `kill('SIGTERM')`,
// c'est-à-dire `TerminateProcess` : aucun `stop()`, des agents orphelins. Elle
// leur envoie désormais l'ordre d'arrêt par leur canal IPC (`ORDRE_ARRET`). Le
// dernier cas l'éprouve sur les TROIS systèmes — c'est le seul chemin d'arrêt
// propre sous Windows, et c'est là qu'il doit se voir.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import {
  lancerBorneTuyaute,
  processusVivant,
  reprendreTous,
  retenirPid,
} from './harnais-processus.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const LANCER = path.join(RACINE, 'scripts', 'lancer.mjs');
const POSIX = process.platform !== 'win32';
const TOKEN = 'jeton-de-ruche-arret-signal-suffisamment-long';

// Sans condition : si le correctif manque, c'est un agent ORPHELIN qui reste —
// toujours dans le groupe du superviseur, donc repris ici avec lui (§ 2
// duovicies du carnet).
afterEach(() => reprendreTous());

/**
 * Le superviseur : lance la commande reçue en argument, dit le pid de son
 * enfant, dit comment il finit — et reste en vie, comme `ruche.mjs` le temps
 * de son arrêt.
 *
 * Avec `ORDRE_PAR_CANAL` (un chemin), il ouvre un canal IPC vers son enfant,
 * comme `ruche.mjs` vers ses ouvrières, et y envoie l'ordre d'arrêt dès que ce
 * fichier paraît : c'est ainsi que le banc le déclenche sans signal, donc sur
 * les trois systèmes.
 */
const SUPERVISEUR =
  "import { spawn } from 'node:child_process';\n" +
  "import { existsSync } from 'node:fs';\n" +
  'const [bin, ...args] = process.argv.slice(2);\n' +
  'const declencheur = process.env.ORDRE_PAR_CANAL;\n' +
  'const enfant = spawn(bin, args, {\n' +
  "  stdio: declencheur ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',\n" +
  '});\n' +
  'console.log(`NOEUD ${enfant.pid}`);\n' +
  "enfant.on('exit', (code, signal) => console.log(`SORTIE ${code} ${signal}`));\n" +
  'if (declencheur) {\n' +
  '  const guet = setInterval(() => {\n' +
  '    if (!existsSync(declencheur)) return;\n' +
  '    clearInterval(guet);\n' +
  "    enfant.send({ type: 'arret' });\n" +
  '  }, 100);\n' +
  '}\n' +
  'setInterval(() => {}, 60_000);\n';

/**
 * L'agent : il dit qui il est, lance un PETIT-ENFANT qui dit qui IL est, ignore
 * SIGTERM, puis travaille « pour toujours ».
 *
 * Un FICHIER PAR PROCESSUS, nommé par son pid, et vide : le nom apparaît d'un
 * coup avec le fichier. Un fichier UNIQUE réécrit par chaque agent laisserait
 * une fenêtre (la troncature d'un `writeFileSync` concurrent) où le banc lirait
 * '', donc le pid 0 — et il ne surveillerait de toute façon qu'UN agent.
 */
const PETIT =
  "require('node:fs').writeFileSync(require('node:path').join(process.argv[1], " +
  "'petit-' + process.pid), ''); setInterval(() => {}, 60_000);";
const AGENT =
  "import { spawn } from 'node:child_process';\n" +
  "import { writeFileSync } from 'node:fs';\n" +
  "import path from 'node:path';\n" +
  'writeFileSync(path.join(process.argv[2], `agent-${process.pid}`), "");\n' +
  `spawn(process.execPath, ['-e', ${JSON.stringify(PETIT)}, process.argv[2]], { stdio: 'inherit' });\n` +
  "process.on('SIGTERM', () => {});\n" +
  'setInterval(() => {}, 60_000);\n';

/**
 * Scrute une condition jusqu'à l'échéance — l'asynchrone s'ATTEND, il ne
 * s'affirme pas. Le message est calculé À L'ÉCHÉANCE : il porte la sortie du
 * nœud telle qu'elle est au moment de l'échec, pas au moment de l'appel.
 */
async function scruter(
  condition: () => boolean,
  quoi: () => string,
  echeanceMs: number,
): Promise<void> {
  const depart = Date.now();
  while (!condition()) {
    if (Date.now() - depart > echeanceMs) throw new Error(`échéance : ${quoi()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Porte {
  /** Ce que tape l'humain. */
  nom: string;
  /** Le point d'entrée réel, relatif à la racine. */
  entree: string;
  /** Arguments et variables propres à cette porte. */
  preparer: () => Promise<{ args: string[]; env: NodeJS.ProcessEnv }>;
}

/**
 * Les pid qu'un agent et ses petits-enfants ont écrits, relus À CHAQUE appel :
 * un agent lancé entre-temps compte aussi. Chacun est retenu pour le filet —
 * chef de son propre groupe, un agent orphelin échappe au balayage du groupe
 * du superviseur (`retenirPid`).
 */
function arbreDesAgents(dossier: string): { agents: number[]; petits: number[] } {
  const noms = readdirSync(dossier);
  const lire = (prefixe: string): number[] =>
    noms.filter((n) => n.startsWith(`${prefixe}-`)).map((n) => Number(n.slice(prefixe.length + 1)));
  const arbre = { agents: lire('agent'), petits: lire('petit') };
  for (const pid of [...arbre.agents, ...arbre.petits]) retenirPid(pid);
  return arbre;
}

describe('le nœud — SIGTERM, le signal des superviseurs, et l’ordre de la ruche', () => {
  let server: HiveServer;
  let racine: string;
  let base = '';
  let adminToken = '';

  // UNE RUCHE PAR CAS. Partagée, la tâche du premier cas — remise en file
  // (`ws_closed`) quand son nœud s'arrête — partirait chez le nœud du second,
  // qui ferait alors tourner DEUX agents : le banc dépendrait de l'ordre de
  // ses cas.
  beforeEach(async () => {
    racine = mkdtempSync(path.join(os.tmpdir(), 'ruche-arret-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(racine, 'ruche.db'),
      simulation: false,
      tickMs: 200,
    });
    base = `http://127.0.0.1:${server.port}`;
    // Le premier compte ne se crée qu'avec le jeton de ruche (#467).
    const auth = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({
        email: 'admin@hive.test',
        password: 'mot-de-passe-test',
        displayName: 'Admin',
      }),
    });
    adminToken = ((await auth.json()) as { token: string }).token;
  });

  afterEach(async () => {
    // Le filet AVANT le ménage : le superviseur, vivant par construction, a
    // son `cwd` dans ce dossier — et sous Windows, un dossier qui est le `cwd`
    // d'un processus vivant ne s'efface pas (EPERM, mesuré sur `windows-latest`).
    reprendreTous();
    await server.stop();
    rmSync(racine, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const PORTE_NODE: Porte = {
    nom: 'npm run node',
    entree: 'src/node-client/main.ts',
    preparer: async () => ({
      args: [],
      env: { HIVE_URL: `ws://127.0.0.1:${server.port}/ws`, HIVE_TOKEN: TOKEN },
    }),
  };
  const PORTES: Porte[] = [
    PORTE_NODE,
    {
      nom: 'hive join',
      entree: 'src/node-client/join.ts',
      // Un billet NEUF par la vraie route : la porte des amis l'échange contre
      // sa clé propre, exactement comme chez l'invité.
      preparer: async () => {
        const rep = await fetch(`${base}/api/billets`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hive-token': TOKEN,
            authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ uses: 1, url: `ws://127.0.0.1:${server.port}/ws` }),
        });
        expect(rep.status, 'la ruche a refusé de créer le billet').toBe(201);
        const { billet } = (await rep.json()) as { billet: string };
        return { args: [billet], env: {} };
      },
    },
  ];

  /**
   * Un nœud réel, sous superviseur, au travail sur UNE tâche ; `arreter` le
   * frappe comme le fait son superviseur réel ; le banc constate ensuite que
   * le nœud est sorti en 0 et que tout l'arbre de l'agent est parti.
   */
  async function arreterEnPleinTravail(
    porte: Porte,
    arreter: (ctx: { noeud: number; declencheur: string }) => void,
    parCanal: boolean,
  ): Promise<void> {
    const dossier = mkdtempSync(path.join(racine, 'noeud-'));
    const pidsAgents = path.join(dossier, 'agents');
    mkdirSync(pidsAgents);
    const agent = path.join(dossier, 'agent.mjs');
    const superviseur = path.join(dossier, 'superviseur.mjs');
    const declencheur = path.join(dossier, 'arret');
    writeFileSync(agent, AGENT, 'utf8');
    writeFileSync(superviseur, SUPERVISEUR, 'utf8');
    // `HIVE_AGENT_CMD` est découpé sur les espaces, sans shell (§ 5.1) : un
    // chemin qui en porterait casserait la commande AVANT l'arrêt, et le banc
    // échouerait sur une cause qui n'est pas la sienne.
    for (const morceau of [process.execPath, agent, pidsAgents]) {
      expect(morceau, 'chemin avec espace : HIVE_AGENT_CMD le couperait').not.toMatch(/\s/);
    }

    const { args, env: propre } = await porte.preparer();
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
    Object.assign(env, propre, {
      HIVE_AGENT: 'custom',
      // Le prompt, que `custom` ajoute en dernier argument, est ignoré.
      HIVE_AGENT_CMD: `${process.execPath} ${agent} ${pidsAgents}`,
      HIVE_WORKDIR: path.join(dossier, 'travail'),
      HIVE_ISOLEMENT: 'off',
      HIVE_NODE_NAME: `arret-${path.basename(dossier)}`,
      ...(parCanal ? { ORDRE_PAR_CANAL: declencheur } : {}),
    });

    // cwd = le dossier jetable : les deux portes lisent le `.env` du
    // répertoire courant, et celui du dépôt n'a rien à faire dans ce banc.
    const proc = lancerBorneTuyaute(
      process.execPath,
      [superviseur, process.execPath, LANCER, porte.entree, ...args],
      { cwd: dossier, env },
    );
    let sortie = '';
    proc.stdout.on('data', (m: Buffer) => (sortie += m.toString('utf8')));
    proc.stderr.on('data', (m: Buffer) => (sortie += m.toString('utf8')));
    const pidNoeud = (): number | undefined => {
      const m = /^NOEUD (\d+)\r?$/m.exec(sortie);
      return m ? Number(m[1]) : undefined;
    };
    const finNoeud = (): string | undefined => /^SORTIE (\S+ \S+)\r?$/m.exec(sortie)?.[1];

    // Une tâche, par la vraie route : le hub l'assigne au seul nœud présent.
    const entetes = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
    const projet = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: entetes,
        body: JSON.stringify({ name: `Arrêt ${porte.nom}` }),
      })
    ).json()) as { id: string };
    const creation = await fetch(`${base}/api/projects/${projet.id}/tasks`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({ tasks: [{ title: 'travail sans fin', prompt: 'attendre' }] }),
    });
    expect(creation.status, 'la ruche a refusé la tâche').toBe(201);

    // L'agent ET son petit-enfant : c'est l'arbre entier qu'on attend.
    await scruter(
      () => {
        const a = arbreDesAgents(pidsAgents);
        return a.agents.length > 0 && a.petits.length > 0;
      },
      () => `l’agent et son petit-enfant n’ont jamais démarré :\n${sortie}`,
      90_000,
    );
    // Une ruche, un nœud, une tâche : UN agent. Deux diraient qu'une tâche
    // d'ailleurs s'est invitée, et le banc ne mesurerait plus ce qu'il dit.
    const lances = arbreDesAgents(pidsAgents);
    expect(lances.agents, `un seul agent attendu :\n${sortie}`).toHaveLength(1);
    const tous = (): number[] => {
      const a = arbreDesAgents(pidsAgents);
      return [...a.agents, ...a.petits];
    };
    expect(tous().filter(processusVivant), 'l’arbre doit tourner avant l’arrêt').toEqual(tous());
    const noeud = pidNoeud();
    expect(noeud, `le superviseur n’a pas dit le pid du nœud :\n${sortie}`).toBeTypeOf('number');

    arreter({ noeud: noeud as number, declencheur });
    await scruter(
      () => finNoeud() !== undefined,
      () => `le nœud n’a pas entendu l’arrêt :\n${sortie}`,
      30_000,
    );

    // L'arbre D'ABORD : c'est lui, l'enjeu. Un nœud mort en silence se
    // relance ; un agent orphelin, personne ne sait qu'il tourne encore.
    // Relu APRÈS l'arrêt : un processus lancé entre-temps compte aussi.
    await scruter(
      () => !tous().some(processusVivant),
      () =>
        `${tous().filter(processusVivant).join(', ')} a survécu à son nœud — orphelin, il ` +
        `travaille pour personne :\n${sortie}`,
      10_000,
    );
    expect(
      finNoeud(),
      `un arrêt demandé n’est pas une mort par signal — le nœud ne l’a pas traité :\n${sortie}`,
    ).toBe('0 null');
    expect(sortie, 'l’arrêt doit se dire, pas seulement se produire').toContain(
      'Déconnexion de la ruche…',
    );
  }

  it.runIf(POSIX).each(PORTES)(
    '$nom : SIGTERM emporte l’agent en cours et sa descendance, et sort en 0',
    async (porte) => {
      // Le NŒUD seul, comme `ruche.mjs` — voir l'en-tête.
      await arreterEnPleinTravail(porte, ({ noeud }) => process.kill(noeud, 'SIGTERM'), false);
    },
    150_000,
  );

  it('l’ordre de la ruche par le canal IPC emporte l’arbre de l’agent — sur les trois systèmes', async () => {
    await arreterEnPleinTravail(
      PORTE_NODE,
      ({ declencheur }) => writeFileSync(declencheur, ''),
      true,
    );
  }, 150_000);
});
