// LA SORTIE EN DIRECT TRAVERSE LA RUCHE — et le secret, lui, reste au nœud.
//
// Un vrai nœud (HiveNodeClient) lance un vrai processus (`runCommand`) qui
// écrit sa clé d'API sur sa sortie, puis la recopie dans son diff et sa réponse
// finale — exactement ce qu'un agent égaré peut faire. Un vrai tableau de bord
// est abonné à la vraie Reine. On vérifie, à la frontière :
//
//   · la sortie arrive à l'écran PENDANT l'exécution (`task_output`), caviardée ;
//   · elle n'entre JAMAIS au journal (élagué par nombre : une exécution bavarde
//     effacerait l'histoire de la ruche) ;
//   · logs, diff et texte final rangés par la Reine sont caviardés aussi ;
//   · un morceau arrivé après le résultat n'est pas relayé (ici, c'est la
//     garde d'exécution du NŒUD qui le tait : l'échec est relancé aussitôt
//     sur ce même nœud, la tâche est déjà réassignée quand il arrive) ;
//   · ce que l'agent écrit d'autre et que le nœud relaie — noms de sous-agents,
//     demande de délégation — part caviardé lui aussi, et reste sous les bornes
//     du protocole : un nom PILE à sa borne qu'un `[secret]` allongeait faisait
//     refuser le `task_result` entier (socket fermée, résultat perdu).
//
// Le faux agent est un script lancé par `process.execPath` (ni shebang ni
// chmod : le banc tourne sur les trois OS de la CI) et il ATTEND un fichier
// témoin que le banc ne pose qu'après avoir vu sa sortie à l'écran : « pendant
// l'exécution » est prouvé par construction, pas par une fenêtre de 600 ms.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { runCommand } from '../src/adapters/exec.js';
import type { WorkerDelegationOutcome } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { LIMITS } from '../src/shared/protocol.js';

const JETON = 'jeton-sortie-directe-suffisamment-long';
const NOM_CLE = 'HIVE_BANC_SORTIE_API_KEY';
const CLE = 'cle-du-banc-que-nul-ne-doit-lire-0123456789';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let ecran: WebSocket | null = null;
let dossier = '';

afterEach(async () => {
  ecran?.close();
  ecran = null;
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  delete process.env[NOM_CLE];
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

describe('la sortie en direct — d’un vrai processus jusqu’à l’écran, caviardée au nœud', () => {
  it('ARRIVE PENDANT L’EXÉCUTION, SANS LA CLÉ, ET SANS ENTRER AU JOURNAL', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'sortie-directe-ruche-'));
    process.env[NOM_CLE] = CLE;
    const agent = path.join(dossier, 'agent.js');
    const temoin = path.join(dossier, 'vu');
    // L'agent lit SA clé dans SON environnement (transmise par keepEnv) et la
    // recopie : sur stdout, dans un jeton GitHub inventé, puis en réponse —
    // une fois que l'écran a vu le début (fichier témoin).
    writeFileSync(
      agent,
      "'use strict';\nconst fs = require('node:fs');\n" +
        `const cle = process.env.${NOM_CLE};\n` +
        "process.stdout.write('lecture du dépôt\\n');\n" +
        "process.stdout.write('export CLE=' + cle + ' ghp_abcdefghij0123456789\\n');\n" +
        `const t = setInterval(() => { if (!fs.existsSync(${JSON.stringify(temoin)})) return;\n` +
        "  clearInterval(t); process.stdout.write('réponse : ' + cle + '\\n');\n" +
        // Vivant au-delà d'un intervalle de cadence : ce dernier morceau part
        // en direct, avant la fin.
        '  setTimeout(() => {}, 600); }, 20);\n' +
        // Un ÉCHEC : c'est lui dont la Reine range le texte final (Couveuse,
        // leçons croisées) — donc lui qui prouve le caviardage de ce texte.
        'process.exitCode = 1;\n',
    );

    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    const s = serveur;

    const recus: Array<Record<string, unknown>> = [];
    ecran = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    const e = ecran;
    await new Promise<void>((ok, ko) => {
      e.once('open', () => ok());
      e.once('error', ko);
    });
    e.on('message', (brut: Buffer) => recus.push(JSON.parse(brut.toString()) as never));
    e.send(JSON.stringify({ type: 'subscribe', token: JETON }));
    await attendre(() => recus.some((m) => m.type === 'state'), 'l’écran n’est pas abonné');

    let fini = false;
    let delegation: WorkerDelegationOutcome | undefined;
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${s.port}/ws`,
      token: JETON,
      name: 'ouvriere-sortie',
      ownerName: 'banc',
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      keepEnv: [NOM_CLE],
      adapter: {
        name: 'banc',
        async run(_task, ctx) {
          // Ce que l'agent déclare d'autre, et que le nœud relaie : un
          // sous-agent nommé d'après la clé, une délégation qui la recopie.
          const sousAgent = { id: 'sa-1', name: `lit ${CLE}`, status: 'running' as const };
          // Coupé PILE à la borne par l'adaptateur (subagent-parser.ts), et
          // finissant par un motif plus court que `[secret]`.
          const nomBorne = 'Explorer le module de paiement '.repeat(5).slice(0, LIMITS.name - 6);
          const sousAgentBorne = {
            id: 'sa-2',
            name: `${nomBorne} sk-v1`,
            status: 'running' as const,
          };
          ctx.onProgress({ subAgents: [sousAgent, sousAgentBorne] });
          const raison = `vérifier avec ${CLE} `;
          delegation = await ctx.delegate?.({
            childTaskId: 'enfant-sortie',
            reason: raison + 'x'.repeat(LIMITS.delegationReason - raison.length - 6) + ' sk-v1',
            title: `Enfant ${CLE}`,
            prompt: `Utilise la clé ${CLE} pour lire l'API.`,
            durationMs: 60_000,
            costMicros: 1_000,
            resourceUnits: 1,
          });
          const r = await runCommand(process.execPath, [agent], ctx, 10_000, 'sortie-standard');
          fini = true;
          // Un morceau APRÈS la fin : le hub doit le laisser tomber.
          setTimeout(() => ctx.onProgress({ sortie: 'morceau posthume\n' }), 300);
          return {
            ...r,
            subAgents: [sousAgent, sousAgentBorne],
            diff: `@@ -0,0 +1 @@\n+const cle = '${CLE}';\n`,
          };
        },
      },
      quiet: true,
    });
    client.start();
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({ projectId: p.id, title: 'Lire', prompt: 'x' });
    s.store.patchTask(t.id, { status: 'ready' });

    // PENDANT : le premier morceau est à l'écran avant la fin du processus.
    await attendre(
      () => recus.some((m) => m.type === 'task_output' && m.taskId === t.id),
      'aucune sortie en direct n’atteint l’écran',
    );
    expect(fini).toBe(false);
    writeFileSync(temoin, '');

    await attendre(
      () => s.store.resultsForTask(t.id).length > 0,
      'aucun résultat ne revient du nœud',
    );
    await new Promise((r) => setTimeout(r, 400));

    const sorties = recus
      .filter((m) => m.type === 'task_output' && m.taskId === t.id)
      .map((m) => String(m.sortie));
    const vu = sorties.join('');
    expect(vu).toContain('lecture du dépôt');
    expect(vu).toContain('export CLE=[secret]');
    expect(vu).toContain('réponse : [secret]');
    expect(vu).not.toContain('ghp_abcdefghij');
    expect(vu).not.toContain('morceau posthume');
    // Rien de ce qu'a reçu l'écran — état, événements, sortie — ne porte la clé.
    expect(JSON.stringify(recus)).not.toContain(CLE);

    // Le journal ne garde que les jalons : pas un octet de la sortie brute.
    const journal = JSON.stringify(
      s.store.evenementsDeTache(t.id, ['task_progress', 'task_started', 'task_retry']),
    );
    expect(journal).not.toContain('lecture du dépôt');
    expect(journal).not.toContain(CLE);

    const [resultat] = s.store.resultsForTask(t.id);
    // Le nom borné a été ramené sous sa borne — le résultat est arrivé.
    const nomRecu = resultat?.subAgents.find((a) => a.id === 'sa-2')?.name ?? '';
    expect(nomRecu.length).toBeLessThanOrEqual(LIMITS.name);
    expect(nomRecu).not.toContain('sk-v1');
    expect(resultat?.logs).toContain('export CLE=[secret]');
    expect(resultat?.diff).toBe("@@ -0,0 +1 @@\n+const cle = '[secret]';\n");
    expect(JSON.stringify(resultat)).not.toContain(CLE);
    // La délégation est admise, et la tâche enfant qu'en a tirée la Reine ne
    // porte la clé ni dans son titre, ni dans son prompt.
    expect(delegation?.ok).toBe(true);
    const enfants = s.store.listTasks().filter((x) => x.id !== t.id);
    expect(enfants).toHaveLength(1);
    expect(enfants[0]?.prompt).toContain(`Utilise la clé ${'[secret]'} pour lire l'API.`);
    expect(JSON.stringify(enfants)).not.toContain(CLE);
    const [texteFinal] = s.store.evenementsDeTache(t.id, ['worker_final_text']);
    expect(texteFinal?.payload.finalText).toContain('réponse : [secret]');
    expect(JSON.stringify(texteFinal)).not.toContain(CLE);
  });
});
