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

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { lancerBorneTuyaute, reprendreTous } from './harnais-processus.js';

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
 */
const SUPERVISEUR =
  "import { spawn } from 'node:child_process';\n" +
  'const [bin, ...args] = process.argv.slice(2);\n' +
  "const enfant = spawn(bin, args, { stdio: 'inherit' });\n" +
  'console.log(`NOEUD ${enfant.pid}`);\n' +
  "enfant.on('exit', (code, signal) => console.log(`SORTIE ${code} ${signal}`));\n" +
  'setInterval(() => {}, 60_000);\n';

/**
 * L'agent : il dit qui il est, puis travaille « pour toujours ».
 *
 * Un FICHIER PAR AGENT, nommé par son pid, et vide : le nom apparaît d'un coup
 * avec le fichier. Un fichier UNIQUE réécrit par chaque agent laisserait une
 * fenêtre (la troncature d'un `writeFileSync` concurrent) où le banc lirait
 * '', donc le pid 0 — et il ne surveillerait de toute façon qu'UN agent.
 */
const AGENT =
  "import { writeFileSync } from 'node:fs';\n" +
  "import path from 'node:path';\n" +
  'writeFileSync(path.join(process.argv[2], String(process.pid)), "");\n' +
  'setInterval(() => {}, 60_000);\n';

/**
 * Vrai tant que le processus existe ET n'est pas un zombie.
 *
 * `kill(pid, 0)` seul répondrait « vivant » pour un zombie : un agent mort
 * que personne n'a encore ramassé. C'est l'init qui ramasse l'orphelin, et
 * il n'est pas tenu de le faire à la milliseconde — `ps` dit l'état exact.
 */
function vivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const etat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    return etat.trim() !== '' && !etat.trim().startsWith('Z');
  } catch {
    return false; // `ps` sort en 1 quand le pid n'existe plus
  }
}

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

describe.runIf(POSIX)('le nœud — SIGTERM, le signal des superviseurs', () => {
  let server: HiveServer;
  let racine: string;
  let base = '';
  let adminToken = '';

  // UNE RUCHE PAR PORTE. Partagée, la tâche de la première porte — remise en
  // file (`ws_closed`) quand son nœud s'arrête — partirait chez le nœud de la
  // seconde, qui ferait alors tourner DEUX agents : le banc dépendrait de
  // l'ordre de ses cas.
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
    const auth = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@hive.test',
        password: 'mot-de-passe-test',
        displayName: 'Admin',
      }),
    });
    adminToken = ((await auth.json()) as { token: string }).token;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(racine, { recursive: true, force: true });
  });

  const PORTES: Porte[] = [
    {
      nom: 'npm run node',
      entree: 'src/node-client/main.ts',
      preparer: async () => ({
        args: [],
        env: { HIVE_URL: `ws://127.0.0.1:${server.port}/ws`, HIVE_TOKEN: TOKEN },
      }),
    },
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

  it.each(PORTES)(
    '$nom : SIGTERM annule l’agent en cours et sort en 0',
    async (porte) => {
      const dossier = mkdtempSync(path.join(racine, 'noeud-'));
      const pidsAgents = path.join(dossier, 'agents');
      mkdirSync(pidsAgents);
      const agent = path.join(dossier, 'agent.mjs');
      const superviseur = path.join(dossier, 'superviseur.mjs');
      writeFileSync(agent, AGENT, 'utf8');
      writeFileSync(superviseur, SUPERVISEUR, 'utf8');
      // `HIVE_AGENT_CMD` est découpé sur les espaces, sans shell (§ 5.1) : un
      // chemin qui en porterait casserait la commande AVANT le signal, et le
      // banc échouerait sur une cause qui n'est pas la sienne.
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
        const m = /^NOEUD (\d+)$/m.exec(sortie);
        return m ? Number(m[1]) : undefined;
      };
      const finNoeud = (): string | undefined => /^SORTIE (\S+ \S+)$/m.exec(sortie)?.[1];

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

      const agents = (): number[] => readdirSync(pidsAgents).map(Number);
      await scruter(
        () => agents().length > 0,
        () => `l’agent n’a jamais démarré :\n${sortie}`,
        45_000,
      );
      // Une ruche, un nœud, une tâche : UN agent. Deux diraient qu'une tâche
      // d'ailleurs s'est invitée, et le banc ne mesurerait plus ce qu'il dit.
      const lances = agents();
      expect(lances, `un seul agent attendu :\n${sortie}`).toHaveLength(1);
      const noeudPid = pidNoeud();
      expect(noeudPid, `le superviseur n’a pas dit le pid du nœud :\n${sortie}`).toBeTypeOf(
        'number',
      );
      expect(lances.filter(vivant), 'l’agent doit tourner avant le signal').toEqual(lances);

      // Le NŒUD seul, comme `ruche.mjs` — voir l'en-tête.
      process.kill(noeudPid as number, 'SIGTERM');
      await scruter(
        () => finNoeud() !== undefined,
        () => `le nœud ignore SIGTERM :\n${sortie}`,
        15_000,
      );

      // L'agent D'ABORD : c'est lui, l'enjeu. Un nœud mort en silence se
      // relance ; un agent orphelin, personne ne sait qu'il tourne encore.
      // Relu APRÈS le signal : un agent lancé entre-temps compte aussi.
      await scruter(
        () => !agents().some(vivant),
        () =>
          `l’agent ${agents().filter(vivant).join(', ')} a survécu à son nœud — orphelin, il travaille pour personne :\n${sortie}`,
        5_000,
      );
      expect(
        finNoeud(),
        `un arrêt demandé n’est pas une mort par signal — le nœud n’écoute pas SIGTERM :\n${sortie}`,
      ).toBe('0 null');
      expect(sortie, 'l’arrêt doit se dire, pas seulement se produire').toContain(
        'Déconnexion de la ruche…',
      );
    },
    90_000,
  );
});
