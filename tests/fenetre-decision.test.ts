// LA FENÊTRE DE DÉCISION (G12) SUIT LES HORLOGES DU RUN — jamais le temps mur.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// Une action irréversible proposée par le CLI ouvre une réquisition dans la
// Chambre, et le temps laissé à l'humain se borne à ce qui reste au run. Or
// les horloges d'un run se SUSPENDENT (Sandbox Live : le délai dur de
// l'agent, le budget d'un enfant délégué). L'échéance que l'adaptateur posait
// au départ, en temps mur, ignorait la pause : après elle, une décision était
// refusée « budget du run épuisé » à un run qui avait encore tout son temps.
//
//   · après une pause plus longue que le délai dur, la réquisition s'ouvre,
//     bornée par ce que le minuteur garde — et quand le run a VRAIMENT
//     consommé son temps, le refus dit toujours pourquoi ;
//   · le budget de durée d'un enfant délégué est une horloge du run : la
//     Chambre n'attend pas un humain au-delà de ce qui reste à l'enfant.
//
// Le vrai chemin, de bout en bout : l'adaptateur Claude Code, son pont MCP et
// l'enfant du pont, le pilote qui gèle l'arbre (SIGSTOP), le nœud qui décide,
// face à un hub minimal. Seul le CLI est faux : il propose l'action comme le
// réel (`--permission-prompt-tool` → `hive_approve_action`). Le temps mur est
// simulé — `Date.now` avance d'un jour PENDANT la pause, sans l'attendre ; les
// minuteurs réels, eux, ne mesurent que le temps où l'agent court.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { HIVE_APPROVE_TOOL } from '../src/adapters/delegation-bridge.js';
import { HiveNodeClient, MARGE_DECISION_ACTION_MS } from '../src/node-client/client.js';
import type { DecisionAction } from '../src/shared/politique-actions.js';

const TOKEN = 'jeton-fenetre-de-decision-long';
const NOEUD = 'n-fenetre';
const TACHE = 't-fenetre';
const PUSH = { tool_name: 'Bash', input: { command: 'git push origin main' } };
/** Plus long que n'importe quel délai dur d'agent : le temps mur seul dirait « épuisé ». */
const PAUSE_SIMULEE_MS = 24 * 3_600_000;

type Message = Record<string, unknown>;

let racine = '';
let client: HiveNodeClient | null = null;
let hub: WebSocketServer | null = null;

afterEach(async () => {
  client?.stop();
  client = null;
  const h = hub;
  hub = null;
  if (h) await new Promise<void>((ok) => h.close(() => ok()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (racine) rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
  racine = '';
});

/** Le temps mur du processus, déplaçable : `Date.now` avance, les minuteurs réels non. */
function tempsMur(): { avancer(ms: number): void } {
  const vrai = Date.now.bind(Date);
  let decalage = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => vrai() + decalage);
  return {
    avancer: (ms) => {
      decalage += ms;
    },
  };
}

/** Attente bornée en temps MONOTONE : `Date.now`, lui, saute pendant le banc. */
async function attendre<T>(lire: () => T | undefined, message: string, delai = 20_000): Promise<T> {
  const fin = performance.now() + delai;
  while (performance.now() < fin) {
    const vu = lire();
    if (vu !== undefined) return vu;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(message);
}

/**
 * Un faux `claude` : de sa ligne de commande, il ne lit que `--mcp-config`,
 * lance l'enfant du pont qu'elle décrit — comme le CLI réel —, puis propose
 * `git push` par `hive_approve_action` (ce que `--permission-prompt-tool` fait
 * faire au vrai) chaque fois que le banc pose `go-<n>`, et écrit la décision
 * reçue dans `decision-<n>.json`. Sans `--mcp-config` (la sonde `--help` des
 * efforts), il n'annonce rien.
 */
function fauxClaude(banc: string, propositions: number): string {
  const bin = path.join(racine, 'bin');
  mkdirSync(bin);
  const dossier = JSON.stringify(banc);
  const script = `#!${process.execPath}
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
const i = argv.indexOf('--mcp-config');
if (i < 0) process.exit(0);
const serveur = Object.values(JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')).mcpServers)[0];
const mcp = spawn(serveur.command, serveur.args, {
  env: { ...process.env, ...serveur.env },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const attentes = new Map();
let tampon = '';
mcp.stdout.setEncoding('utf8');
mcp.stdout.on('data', (morceau) => {
  tampon += morceau;
  for (let n; (n = tampon.indexOf('\\n')) >= 0; tampon = tampon.slice(n + 1)) {
    const reponse = JSON.parse(tampon.slice(0, n));
    attentes.get(reponse.id)?.(reponse);
  }
});
let id = 0;
const appeler = (method, params) =>
  new Promise((ok) => {
    attentes.set(++id, ok);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
  });
const pose = (nom) =>
  new Promise((ok) => {
    const t = setInterval(() => {
      if (fs.existsSync(path.join(${dossier}, nom))) {
        clearInterval(t);
        ok();
      }
    }, 20);
  });
(async () => {
  await appeler('initialize', {});
  fs.writeFileSync(path.join(${dossier}, 'pret'), '');
  for (let n = 1; n <= ${propositions}; n += 1) {
    await pose('go-' + n);
    const r = await appeler('tools/call', {
      name: ${JSON.stringify(HIVE_APPROVE_TOOL)},
      arguments: ${JSON.stringify(PUSH)},
    });
    fs.writeFileSync(path.join(${dossier}, 'decision-' + n + '.json'), r.result.content[0].text);
  }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'fini' }));
  mcp.kill();
})();
`;
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, script);
  chmodSync(claude, 0o755);
  return bin;
}

/**
 * Un nœud Claude Code RÉEL face à un hub minimal : inscription, puis une
 * tâche à l'autonomie `gouverne` (un `git push` y va en Chambre). Rend ce que
 * le nœud a envoyé, de quoi lui parler, et le dossier où le faux CLI écrit.
 */
async function demarrer(
  assignation: Message,
  propositions: number,
): Promise<{ banc: string; recus: Message[]; envoyer: (m: Message) => void }> {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-fenetre-decision-'));
  const banc = path.join(racine, 'banc');
  mkdirSync(banc);
  const bin = fauxClaude(banc, propositions);
  // Le nœud lance `claude` par le PATH de la tâche, relu de celui-ci.
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
  const recus: Message[] = [];
  let socket: WebSocket | null = null;
  hub = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  hub.on('connection', (ws) => {
    socket = ws;
    ws.on('message', (brut) => {
      const msg = JSON.parse(String(brut)) as Message;
      recus.push(msg);
      if (msg.type !== 'register') return;
      ws.send(JSON.stringify({ type: 'registered', nodeId: NOEUD }));
      ws.send(
        JSON.stringify({
          type: 'assign_task',
          task: {
            id: TACHE,
            projectId: 'p-fenetre',
            title: 'Pousser',
            prompt: 'pousse la branche',
            status: 'assigned',
            dependsOn: [],
            attempts: 0,
            createdAt: 1,
            updatedAt: 1,
            assignedNodeId: NOEUD,
            branch: null,
          },
          repoUrl: null,
          autonomie: 'gouverne',
          ...assignation,
        }),
      );
    });
  });
  await new Promise<void>((ok) => hub!.once('listening', () => ok()));
  const { port } = hub.address() as { port: number };
  client = new HiveNodeClient({
    url: `ws://127.0.0.1:${port}/ws`,
    token: TOKEN,
    name: 'poste-fenetre',
    ownerName: 'banc',
    agentType: 'claude-code',
    nodeId: NOEUD,
    maxConcurrency: 1,
    workRoot: path.join(racine, 'travail'),
    adapter: createClaudeCodeAdapter(TOKEN),
    quiet: true,
    // Le temps mur saute d'un jour : la veille ne doit pas y lire un hub muet.
    silenceMaxMs: 7 * 24 * 3_600_000,
  });
  client.start();
  return { banc, recus, envoyer: (m) => socket?.send(JSON.stringify(m)) };
}

const estDemandeAction = (m: Message): boolean =>
  m.type === 'requisition_open' && m.genre === 'action' && m.taskId === TACHE;

const decisionLue = (banc: string, n: number): DecisionAction | undefined => {
  const fichier = path.join(banc, `decision-${n}.json`);
  return existsSync(fichier)
    ? (JSON.parse(readFileSync(fichier, 'utf8')) as DecisionAction)
    : undefined;
};

/** L'état en direct de la tâche, tel que le nœud l'a dit APRÈS `depuis`. */
const enPauseDit = (recus: Message[], depuis: number, valeur: boolean): true | undefined =>
  recus
    .slice(depuis)
    .some(
      (m) =>
        m.type === 'task_update' &&
        m.taskId === TACHE &&
        (m.direct as { enPause?: boolean } | undefined)?.enPause === valeur,
    )
    ? true
    : undefined;

/** La première issue d'une proposition : la réquisition de la Chambre, ou le refus du nœud sans elle. */
async function premiereIssue(
  banc: string,
  recus: Message[],
  n: number,
): Promise<{ demande: Message | undefined; refus: DecisionAction | undefined }> {
  await attendre(
    () => (recus.some(estDemandeAction) || decisionLue(banc, n) ? true : undefined),
    `la proposition ${n} n’a reçu ni réquisition ni décision`,
  );
  return { demande: recus.find(estDemandeAction), refus: decisionLue(banc, n) };
}

/** La Chambre tranche (le hub relaie ack puis résultat, comme la Reine). */
function trancher(envoyer: (m: Message) => void, demande: Message, statut: string): void {
  const id = 'req-fenetre';
  envoyer({
    type: 'requisition_ack',
    id,
    genre: 'action',
    libelle: demande.libelle,
    requestId: demande.requestId,
    expiresAt: Date.now() + Number(demande.budgetMs),
  });
  envoyer({ type: 'requisition_result', id, statut });
}

describe.skipIf(process.platform === 'win32')(
  'la fenêtre de décision suit les horloges du run (G12 × Sandbox Live)',
  () => {
    it('après une pause plus longue que le délai dur, la Chambre est demandée — et « budget épuisé » reste vrai quand il l’est', async () => {
      const mur = tempsMur();
      const { banc, recus, envoyer } = await demarrer({}, 2);
      await attendre(
        () => (existsSync(path.join(banc, 'pret')) ? true : undefined),
        'le faux claude n’a jamais démarré',
      );

      // ── La pause : un jour de temps mur, que le délai dur ne compte pas ───
      envoyer({ type: 'pause_task', taskId: TACHE });
      await attendre(() => enPauseDit(recus, 0, true), 'la pause n’a jamais pris');
      mur.avancer(PAUSE_SIMULEE_MS);
      const avantReprise = recus.length;
      envoyer({ type: 'resume_task', taskId: TACHE });
      await attendre(() => enPauseDit(recus, avantReprise, false), 'la reprise n’a jamais pris');

      // ── L'action, proposée après la reprise : le run a encore son temps ───
      writeFileSync(path.join(banc, 'go-1'), '');
      const { demande, refus } = await premiereIssue(banc, recus, 1);
      expect(
        demande,
        `refusée au lieu d’être demandée à la Chambre : ${JSON.stringify(refus)}`,
      ).toBeDefined();
      const budgetMs = Number(demande!.budgetMs);
      expect(
        budgetMs,
        'le budget dit ce que le minuteur garde : la pause n’en a rien pris',
      ).toBeGreaterThan(0);
      trancher(envoyer, demande!, 'accordee');
      expect(
        await attendre(() => decisionLue(banc, 1), 'la décision accordée n’est pas revenue'),
      ).toEqual({ behavior: 'allow', updatedInput: PUSH.input });

      // ── Le run consomme VRAIMENT son temps : moins que la marge de décision ─
      mur.avancer(budgetMs + MARGE_DECISION_ACTION_MS - 5_000);
      writeFileSync(path.join(banc, 'go-2'), '');
      const refusVrai = await attendre(
        () => decisionLue(banc, 2),
        'la seconde proposition est restée sans réponse',
      );
      expect(refusVrai.behavior).toBe('deny');
      expect((refusVrai as { message: string }).message).toContain('budget du run');
      expect(
        recus.filter(estDemandeAction),
        'aucune réquisition morte dans la Chambre',
      ).toHaveLength(1);

      const fin = await attendre(
        () => recus.find((m) => m.type === 'task_result' && m.taskId === TACHE),
        'la tâche n’a jamais rendu son résultat',
        60_000,
      );
      expect(fin.success, String(fin.logs)).toBe(true);
    }, 90_000);

    it('le budget de durée d’un enfant délégué borne la fenêtre — la Chambre n’attend pas au-delà', async () => {
      const dureeEnfantMs = 60_000;
      const { banc, recus, envoyer } = await demarrer(
        {
          delegationBudget: { durationMs: dureeEnfantMs, costMicros: 0, resourceUnits: 0 },
          delegationRootTaskId: 't-racine',
        },
        1,
      );
      await attendre(
        () => (existsSync(path.join(banc, 'pret')) ? true : undefined),
        'le faux claude n’a jamais démarré',
      );
      writeFileSync(path.join(banc, 'go-1'), '');
      const { demande, refus } = await premiereIssue(banc, recus, 1);
      expect(demande, `refusée sans réquisition : ${JSON.stringify(refus)}`).toBeDefined();
      const budgetMs = Number(demande!.budgetMs);
      expect(budgetMs).toBeGreaterThan(0);
      expect(
        budgetMs,
        'la fenêtre se borne au budget de l’enfant, pas au délai dur (quinze minutes) de l’adaptateur',
      ).toBeLessThanOrEqual(dureeEnfantMs - MARGE_DECISION_ACTION_MS);
      trancher(envoyer, demande!, 'refusee');
      const decision = await attendre(() => decisionLue(banc, 1), 'le refus n’est pas revenu');
      expect(decision.behavior).toBe('deny');
      expect((decision as { message: string }).message).toContain('refusée depuis la Chambre');
      await attendre(
        () => recus.find((m) => m.type === 'task_result' && m.taskId === TACHE),
        'la tâche n’a jamais rendu son résultat',
        60_000,
      );
    }, 90_000);
  },
);
