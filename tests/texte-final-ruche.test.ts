// La ruche lit la RÉPONSE FINALE d'un agent — relectures, Conseil, leçons.
//
// ─── CE QUE CE FICHIER VERROUILLE ────────────────────────────────────────────
//
// Trois lecteurs cherchaient la parole d'un agent dans ses LOGS bruts :
//
//   · la contre-expertise (`noterVerdict`) lisait `logs + diff` ;
//   · le Conseil (`conseil-runner`) y cherchait `HIVE_PROPOSITION` / `HIVE_AVIS` ;
//   · la Couveuse et l'essaim y cherchaient les lignes « error ».
//
// Chaque cas ci-dessous rejoue une sortie ENREGISTRÉE sur le vrai binaire
// (tests/fixtures/texte-final, provenance dans texte-final.test.ts) et échoue
// sur le code d'avant ce contrat (7b80ccc) :
//
//   · Codex a répondu « valide » — lu « conteste », parce que stderr répète la
//     consigne, qui contient « valide » ou « conteste » ;
//   · Claude Code a écrit deux objections — ZÉRO retenue, parce que le
//     stream-json échappe les retours à la ligne ;
//   · une éclaireuse Claude Code a proposé — rien rapporté, le marqueur n'y
//     commence aucune ligne ;
//   · deux erreurs d'API DIFFÉRENTES sur trois nœuds — une leçon « systémique »,
//     parce que leur signature était le même préfixe d'événement JSON ;
//   · une ouvrière Claude Code a échoué — la suivante recevait en « leçon » des
//     préfixes d'événements JSON au lieu de l'erreur ; et, bout en bout, le
//     nœud ne rendait même pas l'échec : la clé `apiKeySource` de la ligne
//     `init` le faisait passer pour une panne d'identifiants (réquisition) ;
//   · une relecture SANS texte final — lue dans les logs avant ce contrat, puis
//     comptée contestée par sa première version, qui relançait le producteur
//     pour un défaut du relecteur.
//
// Ce fichier n'importe que des symboles qui existaient avant ce contrat : sur
// l'ancien code, il se charge, et ses cas échouent pour la raison qu'ils
// décrivent — pas pour un import manquant.

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
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { leconsDesEchecs } from '../src/orchestrator/brood.js';
import { leconsCroisees, signatureEchec } from '../src/orchestrator/essaim.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveStore } from '../src/orchestrator/store.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'texte-final');
const fixture = (nom: string): string => readFileSync(path.join(FIXTURES, nom), 'utf8');

/** Le `result` final d'un flux stream-json enregistré. */
function resultatDe(flux: string): string {
  for (const ligne of flux.trim().split('\n').reverse()) {
    const e = JSON.parse(ligne) as { type?: string; result?: unknown };
    if (e.type === 'result' && typeof e.result === 'string') return e.result;
  }
  throw new Error('flux sans ligne result');
}

const TOKEN = 'jeton-texte-final-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

interface Assignation {
  type: string;
  task?: { id: string; prompt?: string };
}

let server: HiveServer | null = null;
let dir: string | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  dir = null;
});

async function ruche(opts: { simulation: boolean; tickMs: number }): Promise<HiveServer> {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-texte-final-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'hive.db'),
    ...opts,
  });
  return server;
}

async function noeud(srv: HiveServer, nodeId: string, agentType: string) {
  const recues: Assignation[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  sockets.push(ws);
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString()) as Assignation;
    if (m.type === 'assign_task') recues.push(m);
  });
  await new Promise<void>((r, j) => {
    ws.once('open', () => r());
    ws.once('error', j);
  });
  ws.send(
    JSON.stringify({
      type: 'register',
      token: TOKEN,
      name: nodeId,
      ownerName: 'test',
      agentType,
      maxConcurrency: 1,
      nodeId,
    }),
  );
  return { ws, recues };
}

async function attendre<T>(lire: () => T | undefined, ms = 8_000): Promise<T | undefined> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const v = lire();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
  return undefined;
}

// ─── LA CONTRE-EXPERTISE ──────────────────────────────────────────────────────

describe('la contre-expertise lit la réponse finale du relecteur', () => {
  /**
   * Fait produire un diff par `producteur`, attend la relecture chez
   * `relecteur`, lui fait rendre `resultat`, et rend le verdict journalisé.
   */
  async function relire(
    agents: { producteur: string; relecteur: string },
    resultat: { logs: string; finalText?: string },
  ): Promise<{ srv: HiveServer; production: string | undefined }> {
    const srv = await ruche({ simulation: true, tickMs: 60 });
    const producteur = await noeud(srv, 'producteur', agents.producteur);
    const relecteur = await noeud(srv, 'relecteur', agents.relecteur);

    const projet = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({ projectId: projet.id, title: 'Garde du jeton', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });
    const production = await attendre(() => producteur.recues[0]);
    expect(production, 'le producteur n’a rien reçu').toBeDefined();
    producteur.ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: production?.task?.id,
        success: true,
        diff: 'diff --git a/src/auth.ts b/src/auth.ts\n+  if (jeton === undefined) return false;',
        logs: 'ok',
        durationMs: 5,
        subAgents: [],
      }),
    );

    const relecture = await attendre(() => relecteur.recues[0]);
    expect(relecture?.task?.prompt, 'aucune relecture lancée').toMatch(/CONTRE-EXPERTISE/);
    relecteur.ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: relecture?.task?.id,
        success: true,
        diff: '',
        durationMs: 5,
        subAgents: [],
        ...resultat,
      }),
    );
    return { srv, production: production?.task?.id };
  }

  /** Le verdict journalisé de la relecture. */
  const verdictDe = (srv: HiveServer) =>
    attendre(
      () =>
        srv.store.listEvents(0, 500).find((e) => e.type === 'contre_expertise_verdict')?.payload as
          { conteste?: boolean; objections?: string[] } | undefined,
    );

  it('CODEX a répondu « valide » : la consigne répétée sur stderr ne le rend plus contesté', async () => {
    // Ce que le nœud remonte : stderr et stdout MÊLÉS dans les logs (exec.ts),
    // la sortie standard seule dans `finalText`.
    const stdout = fixture('codex-relecture.stdout.txt');
    const { srv } = await relire(
      { producteur: 'claude-code', relecteur: 'codex' },
      { logs: fixture('codex-relecture.stderr.txt') + stdout, finalText: stdout.trim() },
    );
    const v = await verdictDe(srv);

    expect(v, 'aucun verdict').toBeDefined();
    expect(v?.conteste, JSON.stringify(v)).toBe(false);
    expect(v?.objections).toEqual([]);
  }, 30_000);

  it('CLAUDE CODE conteste avec deux objections : les DEUX arrivent', async () => {
    const flux = fixture('claude-relecture.stream.jsonl');
    const { srv } = await relire(
      { producteur: 'codex', relecteur: 'claude-code' },
      { logs: flux, finalText: resultatDe(flux) },
    );
    const v = await verdictDe(srv);

    expect(v?.conteste).toBe(true);
    expect(v?.objections).toEqual([
      "`verifier('')` rend toujours `false` sans le dire : la garde traite `undefined`, pas le jeton vide.",
      "Aucun test ne couvre `jeton === ''` : la garde peut disparaître sans qu'un banc rougisse.",
    ]);
  }, 30_000);

  it('SANS texte final : relecture échouée, motif écrit — ni avis, ni correction du producteur', async () => {
    // Un nœud Claude Code antérieur à ce contrat envoie son flux brut, dont le
    // `result` dit « valide », et aucun `finalText`. Ce n'est pas dans les logs
    // qu'on va le chercher : c'est exactement là que la lecture était fausse.
    // Mais ce n'est pas non plus un avis CONTESTÉ : c'était relancer le
    // PRODUCTEUR (jusqu'à la borne d'essais) pour un défaut du RELECTEUR, et
    // retirer un point à son modèle dans l'Aiguillage.
    const { srv, production } = await relire(
      { producteur: 'codex', relecteur: 'claude-code' },
      { logs: fixture('claude-relecture.stream.jsonl').replaceAll('conteste', 'valide') },
    );

    const echec = await attendre(
      () =>
        srv.store.listEvents(0, 500).find((e) => e.type === 'contre_expertise_review_failed')
          ?.payload,
    );
    expect(echec).toMatchObject({ taskId: production, terminal: true });
    expect(String(echec?.motif)).toMatch(/sans réponse finale/);

    // Laisser à une éventuelle relance le temps de partir.
    await new Promise((r) => setTimeout(r, 600));
    const evenements = srv.store.listEvents(0, 500);
    expect(evenements.filter((e) => e.type === 'contre_expertise_verdict')).toEqual([]);
    expect(
      evenements.filter((e) => e.type === 'task_retry' && e.payload.taskId === production),
    ).toEqual([]);
    expect(srv.store.contreVisiteDe(production!), 'aucune contre-visite rangée').toBeNull();
  }, 30_000);
});

// ─── LE CONSEIL ───────────────────────────────────────────────────────────────

describe('le Conseil lit la réponse finale de ses éclaireuses', () => {
  it('une éclaireuse Claude Code rapporte sa proposition, puis une vérificatrice son avis', async () => {
    const srv = await ruche({ simulation: false, tickMs: 50 });
    const socle = `http://127.0.0.1:${srv.port}`;
    const projet = srv.store.createProject({ name: 'Conseil', description: 'd' }).id;
    const ouverture = await fetch(`${socle}/api/projects/${projet}/conseil`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: 'Que faire ensuite pour fiabiliser la ruche ?' }),
    });
    const sessionId = ((await ouverture.json()) as { id: string }).id;
    const eclaireuse = srv.store.registerNode({
      name: 'eclaireuse',
      ownerName: 'o',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });

    /** Ce qu'un nœud Claude Code range pour une tâche du Conseil. */
    const rapporter = (taskId: string, flux: string): void => {
      srv.store.insertResult({
        taskId,
        nodeId: eclaireuse.id,
        success: true,
        diff: '',
        logs: flux,
        finalText: resultatDe(flux),
        durationMs: 10,
        subAgents: [],
      });
      srv.store.patchTask(taskId, { status: 'done' });
    };

    const exploration = srv.store.tachesADepouiller(sessionId);
    rapporter(exploration[0]!.taskId, fixture('claude-eclaireuse-proposition.stream.jsonl'));
    for (const t of exploration.slice(1)) srv.store.patchTask(t.taskId, { status: 'failed' });

    const proposition = await attendre(() => srv.store.listPropositions(sessionId)[0]);
    expect(proposition?.titre, 'la proposition rapportée n’a pas été lue').toBe(
      "Fermer l'entrée standard des agents",
    );

    // Le tour suivant envoie la proposition en vérification.
    const verifications = await attendre(() => {
      const v = srv.store.tachesADepouiller(sessionId);
      return v.length > 0 && v.every((t) => t.role === 'verification') ? v : undefined;
    });
    expect(verifications, 'aucune vérification lancée').toBeDefined();
    for (const t of verifications!) {
      rapporter(t.taskId, fixture('claude-eclaireuse-avis.stream.jsonl'));
    }

    const avis = await attendre(() => {
      const a = srv.store.listAvis(sessionId);
      return a.length === verifications!.length ? a : undefined;
    });
    expect(avis?.map((a) => a.type)).toEqual(verifications!.map(() => 'soutien'));
  }, 30_000);
});

// ─── LE JOURNAL ───────────────────────────────────────────────────────────────

describe('le journal range le texte final là où un lecteur différé l’attend', () => {
  it('échec et éclaireuse attendue : rangés et relus ; succès ordinaire : rien', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'hive-texte-final-store-'));
    const store = new HiveStore(path.join(d, 's.db'));
    try {
      const projectId = store.createProject({ name: 'P' }).id;
      const n = store.registerNode({
        name: 'n',
        ownerName: 'o',
        agentType: 'x',
        maxConcurrency: 1,
      });
      const resultat = (taskId: string, success: boolean, finalText: string) =>
        store.insertResult({
          taskId,
          nodeId: n.id,
          success,
          diff: '',
          logs: '',
          finalText,
          durationMs: 1,
          subAgents: [],
        });

      const echouee = store.createTask({ projectId, title: 'e', prompt: 'p' }).id;
      const ordinaire = store.createTask({ projectId, title: 'o', prompt: 'p' }).id;
      const eclaireuse = store.createTask({ projectId, title: 'c', prompt: 'p' }).id;
      store.creerSession({ id: 's', question: 'q', projectId, version: 1, now: 1 });
      store.lierTache({ taskId: eclaireuse, sessionId: 's', role: 'exploration', tour: 1 });

      const idEchec = resultat(echouee, false, 'Prompt is too long');
      const idOrdinaire = resultat(ordinaire, true, 'fini');
      const idEclaireuse = resultat(eclaireuse, true, 'HIVE_PROPOSITION {}');

      const textes = store.textesFinauxPour([idEchec, idOrdinaire, idEclaireuse]);
      expect([...textes.entries()]).toEqual([
        [idEchec, 'Prompt is too long'],
        [idEclaireuse, 'HIVE_PROPOSITION {}'],
      ]);
      expect(store.listFailedResultsForTask(echouee)[0]?.finalText).toBe('Prompt is too long');
      expect(store.listRecentFailures()[0]?.finalText).toBe('Prompt is too long');
      expect(store.listProductionsPourDerive().find((r) => !r.success)?.finalText).toBe(
        'Prompt is too long',
      );
    } finally {
      store.close();
      rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

// ─── LES LEÇONS D'ÉCHEC ───────────────────────────────────────────────────────

describe('les leçons d’échec lisent ce que l’échec DIT, pas les événements JSON', () => {
  const echec = (nom: string) => {
    const logs = fixture(nom);
    return { logs, finalText: resultatDe(logs) };
  };
  const tropLong = echec('claude-echec-prompt-trop-long.stream.jsonl');
  const api400 = echec('claude-echec-api-400.stream.jsonl');
  const blocVide = echec('claude-echec-api-400-bloc-vide.stream.jsonl');

  it('chaque signature nomme SON erreur, et aucune n’est un préfixe JSON', () => {
    const signatures = [tropLong, api400, blocVide].map((e) => signatureEchec(e.logs, e.finalText));
    expect(signatures).toEqual([
      'prompt is too long',
      'api error: <n> due to tool use concurrency issues.',
      'api error: <n> messages: text content blocks must be non-empty',
    ]);
  });

  it('deux erreurs d’API DIFFÉRENTES sur trois nœuds ne font PAS une leçon systémique', () => {
    // Une leçon systémique, en mode autonome, ouvre un chantier « Corriger : … ».
    // Sur un préfixe `{"type":"assistant",…` commun à toutes les erreurs d'API
    // de Claude Code, la ruche aurait « corrigé » un événement JSON.
    const lecons = leconsCroisees([
      { nodeId: 'a', taskId: 't1', ...api400, createdAt: 1 },
      { nodeId: 'b', taskId: 't2', ...api400, createdAt: 2 },
      { nodeId: 'c', taskId: 't3', ...blocVide, createdAt: 3 },
    ]);

    expect(lecons.map((l) => [l.portee, l.noeuds])).toEqual([
      ['confirmee', 2],
      ['isolee', 1],
    ]);
    expect(lecons[0]?.extrait).toBe('API Error: 400 due to tool use concurrency issues.');
  });

  it('la Couveuse sert à l’ouvrière suivante la parole de l’agent, pas un préfixe JSON', () => {
    const bloc = leconsDesEchecs([{ attempt: 1, nodeName: 'n', ...tropLong, createdAt: 1 }], 4_000);
    const ligne = JSON.parse(bloc.split('\n').find((l) => l.startsWith('{"tentative'))!) as {
      extrait: string;
    };
    expect(ligne.extrait).toBe('Prompt is too long');
  });
});

// ─── LA COUVEUSE, DU NŒUD À LA TENTATIVE SUIVANTE ────────────────────────────

describe.skipIf(process.platform === 'win32')(
  'bout en bout : l’ouvrière suivante hérite de l’erreur, pas du flux JSON',
  () => {
    it('le VRAI adaptateur claude-code rend l’échec ; la leçon arrive à la tentative suivante', async () => {
      // Pas un adaptateur de test : le vrai `createClaudeCodeAdapter`, contre un
      // faux `claude` posé sur le PATH qui REJOUE l'enregistrement (sortie 1),
      // puis réussit en notant le prompt reçu. La ligne `init` du flux porte
      // `"apiKeySource"` : lu sur les logs bruts, l'échec passait pour une panne
      // d'identifiants, le nœud ouvrait une réquisition au lieu de le rendre,
      // et rien n'atteignait la Couveuse.
      const srv = await ruche({ simulation: true, tickMs: 80 });
      const faux = path.join(dir!, 'bin');
      mkdirSync(faux);
      const flux = path.join(FIXTURES, 'claude-echec-prompt-trop-long.stream.jsonl');
      const ok = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'corrigé',
      });
      writeFileSync(
        path.join(faux, 'claude'),
        [
          '#!/usr/bin/env node',
          "'use strict';",
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          // La sonde des efforts du nœud (`claude --help`, au démarrage) n'est
          // pas une tentative : comme le vrai CLI, l'aide sort sans prompt.
          "if (process.argv.includes('--help')) { process.stdout.write('Usage: claude\\n'); process.exit(0); }",
          `const compteur = path.join(${JSON.stringify(faux)}, 'appels');`,
          "const n = fs.existsSync(compteur) ? Number(fs.readFileSync(compteur, 'utf8')) + 1 : 1;",
          'fs.writeFileSync(compteur, String(n));',
          `fs.writeFileSync(path.join(${JSON.stringify(faux)}, 'prompt-' + n), process.argv[process.argv.length - 1]);`,
          'if (n === 1) {',
          `  process.stdout.write(fs.readFileSync(${JSON.stringify(flux)}), () => process.exit(1));`,
          '} else {',
          `  process.stdout.write(${JSON.stringify(ok + '\n')});`,
          '}',
        ].join('\n'),
      );
      chmodSync(path.join(faux, 'claude'), 0o755);
      const promptRecu = (n: number): string | undefined => {
        const f = path.join(faux, `prompt-${n}`);
        return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
      };

      const pathAvant = process.env.PATH;
      process.env.PATH = `${faux}${path.delimiter}${pathAvant ?? ''}`;
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${srv.port}/ws`,
        token: TOKEN,
        name: 'ouvriere-claude',
        ownerName: 'test',
        agentType: 'claude-code',
        maxConcurrency: 1,
        workRoot: path.join(dir!, 'work'),
        adapter: createClaudeCodeAdapter(TOKEN),
        quiet: true,
      });
      client.start();
      try {
        const projet = srv.store.createProject({ name: 'Couveuse' });
        const t = srv.store.createTask({
          projectId: projet.id,
          title: 'Fragile',
          prompt: 'réparer',
        });
        srv.store.patchTask(t.id, { status: 'ready' });

        const seconde = await attendre(() => promptRecu(2), 15_000);
        // Filtrée sur la TÂCHE : un poste sans identifiants Claude (la CI)
        // ouvre aussi, dès l'enregistrement, une réquisition proactive sans
        // tâche — elle ne dit rien de cet échec.
        expect(
          srv.store.listerRequisitions({ statut: 'ouverte' }).filter((r) => r.taskId === t.id),
          'un prompt trop long n’est pas une panne d’identifiants',
        ).toEqual([]);
        expect(seconde, 'aucune seconde tentative').toBeDefined();
        expect(seconde).toContain('Couveuse');
        expect(seconde).toContain('Prompt is too long');
        expect(seconde, 'la leçon ne doit pas être un événement JSON').not.toMatch(
          /\\"type\\":\\"(system|assistant|user|result)\\"/,
        );
        expect(srv.store.listFailedResultsForTask(t.id)[0]?.finalText).toBe('Prompt is too long');
      } finally {
        client.stop();
        process.env.PATH = pathAvant;
      }
    }, 30_000);
  },
);
