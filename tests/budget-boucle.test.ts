// G09a — LE BUDGET DANS LA BOUCLE DE L'AGENT, de la Reine jusqu'au CLI.
//
// ─── CE QUE CE BANC TIENT FERMÉ ──────────────────────────────────────────────
//
// La réservation de coût d'un enfant délégué (`costMicros`) était transportée
// jusqu'au nœud, puis jamais appliquée : l'agent dépensait sans borne, et seule
// l'enveloppe de la racine l'arrêtait — APRÈS sa tentative. Désormais :
//
//   · chaque tentative reçoit ce qui reste de la réservation de l'enfant (moins
//     le coût déclaré de ses tentatives précédentes), et Claude Code le reçoit
//     en `--max-budget-usd` ;
//   · l'arrêt sur ce plafond (`error_max_budget_usd`) est un ARRÊT BUDGÉTAIRE :
//     la tâche finit sans reprise, journalisée comme telle, et ni le registre
//     Genome, ni la Thermo, ni le Waggle ne l'imputent au modèle ou au nœud ;
//   · un Claude Code trop ancien pour TENIR ce plafond ne le reçoit pas, et le
//     journal de la tâche le dit ;
//   · la Reine ne croit un arrêt budgétaire que d'une tentative qu'elle a
//     plafonnée.
//
// Les bancs de bout en bout passent par le VRAI chemin — une Reine réelle,
// `HiveNodeClient`, le vrai adaptateur `claude-code` — contre un faux `claude`
// posé sur le PATH. Son arrêt REJOUE octet pour octet un flux enregistré sur le
// vrai Claude Code 2.1.289 (`claude -p --output-format stream-json --verbose
// --max-budget-usd 0.0001 --model haiku`, sortie 1), assaini comme ceux de
// `tests/fixtures/texte-final` : chemin de travail, identifiants de session et
// ligne `init` réduits ; la ligne `result` est intacte, à ses identifiants près.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  arretDuResultat,
  createClaudeCodeAdapter,
  VERSION_PLAFOND_CLAUDE,
} from '../src/adapters/claude-code.js';
import { declarationDepuisResultat } from '../src/adapters/fournisseur-parser.js';
import { versionAuMoins } from '../src/node-client/agent-detect.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { plafondCoutTentative } from '../src/orchestrator/delegation.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { lireTemperature } from '../src/orchestrator/thermo.js';
import { buildWaggleBoard } from '../src/orchestrator/waggle.js';
import {
  registreGenomeDepuisEvenements,
  type RegistreGenome,
} from '../src/shared/registre-genome.js';
import type { HiveEvent } from '../src/shared/types.js';
import { brancherFauxNoeud } from './aide/faux-noeud.js';

const TOKEN = 'jeton-budget-boucle-assez-long';
const headers = { 'x-hive-token': TOKEN };
const ENREGISTREMENT = path.join(
  import.meta.dirname,
  'fixtures',
  'budget',
  'claude-arret-budget.stream.jsonl',
);
/** La ligne `result` du flux enregistré sur le vrai CLI. */
const LIGNE_ARRET = readFileSync(ENREGISTREMENT, 'utf8').trim().split('\n').at(-1)!;

describe('le plafond d’une tentative, et ce que le CLI réel en dit', () => {
  it('la réservation MOINS le coût déclaré des tentatives terminées — jamais nul, jamais du coût inventé', () => {
    const depense = (micros: number, tentatives: number, sansCout = 0) => ({
      micros,
      tentatives,
      sansCout,
    });
    expect(plafondCoutTentative(50_000, depense(0, 0))).toBe(50_000);
    expect(plafondCoutTentative(50_000, depense(20_000, 1))).toBe(30_000);
    // Une tentative au coût inconnu ne se retranche pas : un majorant.
    expect(plafondCoutTentative(50_000, depense(20_000, 2, 1))).toBe(30_000);
    // Réservation dépensée : un micro-USD, le CLI refusant `0`.
    expect(plafondCoutTentative(50_000, depense(52_000, 1))).toBe(1);
    expect(plafondCoutTentative(0, depense(0, 0))).toBe(1);
  });

  it('LA LIGNE ENREGISTRÉE : un arrêt sur le coût, son coût entier, ni jetons ni temps modèle à zéro', () => {
    expect(arretDuResultat(LIGNE_ARRET)).toBe('cout');
    expect(arretDuResultat(JSON.stringify({ type: 'result', subtype: 'error_max_turns' }))).toBe(
      'tours',
    );
    for (const subtype of ['success', 'error_during_execution', 'constructor', 'toString']) {
      expect(arretDuResultat(JSON.stringify({ type: 'result', subtype })), subtype).toBeUndefined();
    }
    // `usage` et `duration_api_ms` y valent zéro alors que la réponse qui a
    // franchi le plafond a coûté : lus, ils déclareraient un faux.
    expect(declarationDepuisResultat(JSON.parse(LIGNE_ARRET), 'claude-code')).toEqual({
      source: 'claude-code',
      coutUsd: 0.0249456,
      modeles: ['claude-haiku-4-5-20251001'],
    });
  });

  it('l’image du bac conteneur épingle un Claude Code qui tient le plafond', () => {
    const image = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, '..', 'docker', 'agents', 'package.json'),
        'utf8',
      ),
    ) as { dependencies: Record<string, string> };
    const epingle = image.dependencies['@anthropic-ai/claude-code'];
    expect(epingle).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionAuMoins(epingle!, VERSION_PLAFOND_CLAUDE)).toBe(true);
  });

  it('un arrêt budgétaire n’est un échec ni pour le Genome, ni pour la Thermo, ni pour le Waggle', () => {
    const journal = (arret: boolean): HiveEvent[] => {
      const evenements: HiveEvent[] = [];
      for (let i = 0; i < 4; i += 1) {
        const taskId = `t${i}`;
        evenements.push(
          { id: 10 * i + 1, ts: 1_000, type: 'task_assigned', payload: { taskId, nodeId: 'n1' } },
          {
            id: 10 * i + 2,
            ts: 1_000,
            type: 'task_failed',
            payload: {
              taskId,
              nodeId: 'n1',
              attempts: 1,
              fournisseur: { source: 'claude-code', coutUsd: 0.05 },
              ...(arret ? { arretBudgetaire: 'cout' } : {}),
            },
          },
        );
      }
      return evenements;
    };
    const lire = (evenements: HiveEvent[]) => ({
      genome: registreGenomeDepuisEvenements(evenements, () => 'autre').sansModele,
      thermo: lireTemperature(evenements, 2_000).signaux.echecs,
      waggle: buildWaggleBoard(evenements).nodes.find((n) => n.nodeId === 'n1')?.tasksFailed ?? 0,
    });
    const arretes = lire(journal(true));
    expect(arretes.genome).toMatchObject({ affectations: 4, echecs: 0, interrompues: 4 });
    // La dépense reste déclarée : elle a eu lieu.
    expect(arretes.genome.coutFournisseur).toMatchObject({ declarees: 4, tentatives: 4 });
    expect(arretes.thermo).toBe(0);
    expect(arretes.waggle).toBe(0);
    // Le témoin : les mêmes issues SANS l'arrêt sont bien des échecs.
    const echoues = lire(journal(false));
    expect(echoues.genome).toMatchObject({ echecs: 4, interrompues: 0 });
    expect(echoues.thermo).toBe(4);
    expect(echoues.waggle).toBe(4);
  });
});

// ─── DE LA REINE AU CLI ───────────────────────────────────────────────────────

type IssueFausse = 'arret' | { coutUsd: number; reussie: boolean };

let server: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let racine = '';
const sockets: Array<{ arreter: () => Promise<void> }> = [];

afterEach(async () => {
  client?.stop();
  client = null;
  for (const s of sockets.splice(0)) await s.arreter();
  await server?.stop();
  server = null;
  vi.unstubAllEnvs();
  if (racine) rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
  racine = '';
});

async function attendre<T>(lire: () => T | undefined, message: string, ms = 20_000): Promise<T> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const v = lire();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

async function monterReine(): Promise<HiveServer> {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-budget-boucle-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(racine, 'hive.db'),
    simulation: false,
    tickMs: 20,
  });
  return server;
}

/**
 * Un faux `claude` : `--version` et `--help` répondent comme le vrai, sans
 * prompt ; chaque autre appel note ses arguments (`appel-<n>.json`) et rend
 * l'issue `n` — l'arrêt enregistré (sortie 1), ou une ligne `result` au coût dit.
 */
function poserFauxClaude(version: string, issues: readonly IssueFausse[]): string {
  const bin = path.join(racine, 'bin');
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, 'claude'),
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `const dossier = ${JSON.stringify(bin)};`,
      `const issues = ${JSON.stringify(issues)};`,
      "if (process.argv.includes('--version')) {",
      `  process.stdout.write(${JSON.stringify(`${version} (Claude Code)\n`)});`,
      '  process.exit(0);',
      '}',
      "if (process.argv.includes('--help')) { process.stdout.write('Usage: claude\\n'); process.exit(0); }",
      "const n = fs.readdirSync(dossier).filter((f) => f.startsWith('appel-')).length + 1;",
      "fs.writeFileSync(path.join(dossier, 'appel-' + n + '.json'), JSON.stringify(process.argv.slice(2)));",
      'const issue = issues[Math.min(n, issues.length) - 1];',
      "if (issue === 'arret') {",
      `  process.stdout.write(fs.readFileSync(${JSON.stringify(ENREGISTREMENT)}), () => process.exit(1));`,
      '} else {',
      '  const ligne = issue.reussie',
      "    ? { type: 'result', subtype: 'success', is_error: false, result: 'fait', total_cost_usd: issue.coutUsd }",
      "    : { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['échec simulé'], total_cost_usd: issue.coutUsd };",
      "  process.stdout.write(JSON.stringify(ligne) + '\\n', () => process.exit(issue.reussie ? 0 : 1));",
      '}',
    ].join('\n'),
  );
  chmodSync(path.join(bin, 'claude'), 0o755);
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
  return bin;
}

/** Les arguments de chaque appel du faux `claude`, dans l'ordre. */
function appels(bin: string): string[][] {
  return readdirSync(bin)
    .filter((f) => f.startsWith('appel-'))
    .sort((a, b) => Number(a.slice(6, -5)) - Number(b.slice(6, -5)))
    .map((f) => JSON.parse(readFileSync(path.join(bin, f), 'utf8')) as string[]);
}

/** Le plafond passé au CLI par un appel, ou `undefined`. */
function plafondPasse(argv: readonly string[]): string | undefined {
  const i = argv.indexOf('--max-budget-usd');
  if (i < 0) return undefined;
  // Une OPTION, jamais du texte de prompt (`prompt-argv.ts`).
  expect(i).toBeLessThan(argv.indexOf('--'));
  return argv[i + 1];
}

/**
 * Une racine tenue en file (aucune ouvrière `codex` : sa consigne la retient)
 * et son enfant délégué, qui réserve `costMicros` — c'est l'enfant que
 * l'ouvrière Claude Code reçoit.
 */
function deleguer(srv: HiveServer, costMicros: number): void {
  const projet = srv.store.createProject({ name: 'Budget dans la boucle' });
  srv.store.createTask({ id: 'racine', projectId: projet.id, title: 'Racine', prompt: 'délègue' });
  srv.store.poserConsigneRoutage('racine', { agent: 'codex' }, null, Date.now());
  const creation = srv.store.createDelegatedTask({
    childTaskId: 'enfant',
    parentTaskId: 'racine',
    title: 'Lot borné',
    prompt: 'Fais ce lot et rends les preuves.',
    durationMs: 60_000,
    costMicros,
    resourceUnits: 1,
  });
  expect(creation.ok).toBe(true);
}

function lancerOuvriereClaude(srv: HiveServer): void {
  client = new HiveNodeClient({
    url: `ws://127.0.0.1:${srv.port}/ws`,
    token: TOKEN,
    name: 'ouvriere-claude',
    ownerName: 'test',
    agentType: 'claude-code',
    nodeId: 'ouvriere-claude',
    maxConcurrency: 1,
    workRoot: path.join(racine, 'travail'),
    adapter: createClaudeCodeAdapter(TOKEN),
    quiet: true,
  });
  client.start();
}

const evenements = (srv: HiveServer, type: string, taskId: string): HiveEvent[] =>
  srv.store
    .evenementsParTypes([type], 1_000)
    .filter((e) => e.payload.taskId === taskId)
    .reverse();

const journalDe = (srv: HiveServer, taskId: string): string[] =>
  evenements(srv, 'task_progress', taskId).map((e) => String(e.payload.log ?? ''));

describe.skipIf(process.platform === 'win32')('le plafond, de la Reine au CLI réel', () => {
  it(
    'PREUVE G09a : un enfant à 0,05 $ s’arrête dans la boucle, l’arrêt est journalisé, le Genome n’est pas pénalisé',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const bin = poserFauxClaude('2.1.278', ['arret']);
      lancerOuvriereClaude(srv);
      deleguer(srv, 50_000);

      const fin = await attendre(
        () => evenements(srv, 'task_failed', 'enfant').at(0),
        'l’enfant n’a pas fini',
      );
      // Le CLI a reçu la réservation de l'enfant, en dollars, comme une option.
      expect(appels(bin).map(plafondPasse)).toEqual(['0.05']);
      expect(journalDe(srv, 'enfant')).toContainEqual(
        expect.stringContaining(
          'plafond de dépense de cette tentative : 0.05 USD (--max-budget-usd)',
        ),
      );
      // L'issue est un ARRÊT BUDGÉTAIRE, au coût déclaré par le CLI.
      expect(fin.payload).toMatchObject({
        taskId: 'enfant',
        attempts: 1,
        arretBudgetaire: 'cout',
        fournisseur: { coutUsd: 0.0249456 },
      });
      const resultat = srv.store.resultsForTask('enfant').at(-1);
      expect(resultat?.logs.split('\n')[0]).toBe(
        '[hive] arrêt budgétaire : l’agent s’est arrêté dans sa boucle sur son plafond de coût ' +
          '(0.05 USD) — ni un échec de l’agent, ni une panne',
      );
      // Sans reprise : la réservation est dépensée. Ni la Couveuse ni le
      // nœud ne relancent quoi que ce soit.
      await new Promise((r) => setTimeout(r, 300));
      expect(srv.store.getTask('enfant')).toMatchObject({ status: 'failed', attempts: 1 });
      expect(evenements(srv, 'task_retry', 'enfant')).toEqual([]);
      expect(evenements(srv, 'task_rejected', 'enfant')).toEqual([]);
      expect(appels(bin)).toHaveLength(1);
      // Le Genome : une affectation interrompue, aucun échec, aucune reprise.
      const genome = (await (
        await fetch(`http://127.0.0.1:${srv.port}/api/genome`, { headers })
      ).json()) as RegistreGenome;
      expect(genome.sansModele).toMatchObject({
        affectations: 1,
        echecs: 0,
        reprises: 0,
        corrections: 0,
        interrompues: 1,
      });
      // Sa dépense, elle, est comptée sur l'enveloppe de la racine.
      expect(srv.store.depenseDeclareeRacine('racine')).toEqual({
        micros: 24_946,
        tentatives: 1,
        sansCout: 0,
      });
    },
  );

  it(
    'une reprise reçoit la réservation MOINS le coût déclaré de la tentative précédente',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const bin = poserFauxClaude('2.1.278', [
        { coutUsd: 0.02, reussie: false },
        { coutUsd: 0.01, reussie: true },
      ]);
      lancerOuvriereClaude(srv);
      deleguer(srv, 50_000);

      await attendre(
        () => (srv.store.getTask('enfant')?.status === 'done' ? true : undefined),
        'l’enfant n’a pas abouti à sa seconde tentative',
      );
      // Chaque reprise est un processus neuf, et le plafond du CLI ne compte
      // que lui : 0,05 $ réservés, 0,02 $ déjà dépensés, il en reste 0,03 $.
      expect(appels(bin).map(plafondPasse)).toEqual(['0.05', '0.03']);
      // L'échec ordinaire, lui, reste une reprise : rien n'est maquillé.
      expect(evenements(srv, 'task_retry', 'enfant')).toHaveLength(1);
      expect(evenements(srv, 'task_retry', 'enfant')[0]?.payload.arretBudgetaire).toBeUndefined();
    },
  );

  it(
    'un Claude Code d’avant 2.1.217 ne reçoit pas le plafond — et le journal de la tâche le dit',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const bin = poserFauxClaude('2.1.200', [{ coutUsd: 0.01, reussie: true }]);
      lancerOuvriereClaude(srv);
      deleguer(srv, 50_000);

      await attendre(
        () => (srv.store.getTask('enfant')?.status === 'done' ? true : undefined),
        'l’enfant n’a pas abouti',
      );
      expect(appels(bin).map(plafondPasse)).toEqual([undefined]);
      expect(journalDe(srv, 'enfant')).toContainEqual(
        'Claude Code 2.1.200 : --max-budget-usd exige 2.1.217 — plafond de 0.05 USD NON passé : ' +
          'rien ne l’arrête dans sa boucle, seule l’enveloppe de la racine le borne, après ' +
          'chaque tentative rendue',
      );
    },
  );

  it(
    'la Reine ne croit un arrêt budgétaire que d’une tentative qu’elle a plafonnée',
    { timeout: 30_000 },
    async () => {
      const srv = await monterReine();
      const recues: Array<{ type: string; task?: { id: string }; plafondCoutMicros?: number }> = [];
      const noeud = await brancherFauxNoeud<(typeof recues)[number]>(
        srv.port,
        {
          token: TOKEN,
          name: 'faux',
          ownerName: 'test',
          agentType: 'claude-code',
          maxConcurrency: 2,
          nodeId: 'faux',
        },
        (m) => {
          if (m.type === 'assign_task') recues.push(m);
        },
      );
      sockets.push(noeud);
      const projet = srv.store.createProject({ name: 'Garde' });
      srv.store.createTask({ id: 'solo', projectId: projet.id, title: 'Solo', prompt: 'fais' });
      expect(
        srv.store.createDelegatedTask({
          childTaskId: 'enfant',
          parentTaskId: 'solo',
          title: 'Lot',
          prompt: 'fais ce lot',
          durationMs: 60_000,
          costMicros: 50_000,
          resourceUnits: 1,
        }).ok,
      ).toBe(true);
      const assignation = (id: string) =>
        attendre(() => recues.find((m) => m.task?.id === id), `${id} jamais assignée`);
      // Le plafond ne part qu'avec l'enfant délégué : une racine n'en a pas.
      expect((await assignation('solo')).plafondCoutMicros).toBeUndefined();
      expect((await assignation('enfant')).plafondCoutMicros).toBe(50_000);

      const arret = (taskId: string) =>
        noeud.ws.send(
          JSON.stringify({
            type: 'task_result',
            taskId,
            success: false,
            diff: '',
            logs: 'arrêt',
            durationMs: 5,
            subAgents: [],
            arretBudgetaire: 'cout',
          }),
        );
      // Un « arrêt » sur une tâche que la Reine n'a pas plafonnée est un
      // échec ordinaire : un seul message ne clôt pas une tâche sans reprise.
      arret('solo');
      const reprise = await attendre(
        () => evenements(srv, 'task_retry', 'solo').at(0),
        'la racine n’a pas été reprise',
      );
      expect(reprise.payload.arretBudgetaire).toBeUndefined();
      expect(evenements(srv, 'task_failed', 'solo')).toEqual([]);
      // Celui de l'enfant plafonné est cru : terminal, et dit tel.
      arret('enfant');
      const fin = await attendre(
        () => evenements(srv, 'task_failed', 'enfant').at(0),
        'l’enfant n’a pas fini',
      );
      expect(fin.payload.arretBudgetaire).toBe('cout');
    },
  );
});
