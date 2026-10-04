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
//     journal de la tâche le dit, avec `claude update` ; un nœud qui ne tient
//     aucun plafond (Codex, Cursor, Cline, shell, nœud ancien) ne le reçoit
//     pas non plus, et la Reine le dit à l'envoi ;
//   · la Reine ne croit un arrêt budgétaire que de la tentative qu'elle a
//     plafonnée, en échec, au coût déclaré arrivé sur CE plafond ;
//   · une réservation déjà dépensée n'est plus envoyée : la Reine clôt
//     l'enfant et le dit au parent ;
//   · aucun lecteur — Genome, Thermo, Waggle, Ghost, Pulse, chronologie,
//     graphe d'expérience — ne compte l'arrêt comme un échec.
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
  createClaudeCodeAdapter,
  verdictPlafondClaude,
  VERSION_PLAFOND_CLAUDE,
} from '../src/adapters/claude-code.js';
import { definitionsOutilsDelegation } from '../src/adapters/delegation-bridge.js';
import { createDeclarationFournisseurTracker } from '../src/adapters/fournisseur-parser.js';
import { versionAuMoins } from '../src/node-client/agent-detect.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { jugerDelegation, plafondCoutTentative } from '../src/orchestrator/delegation.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { lireTemperature } from '../src/orchestrator/thermo.js';
import { buildWaggleBoard } from '../src/orchestrator/waggle.js';
import { ligneArretBudgetaire } from '../src/shared/arret-budgetaire.js';
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
/** Le flux enregistré sur le vrai CLI, ligne à ligne ; sa ligne `result` est la dernière. */
const FLUX_ARRET = readFileSync(ENREGISTREMENT, 'utf8').trim().split('\n');

/** Ce que le suivi de l'adaptateur retient d'un flux : la déclaration, et l'arrêt. */
function suivre(lignes: readonly string[]) {
  const suivi = createDeclarationFournisseurTracker('claude-code');
  for (const ligne of lignes) suivi.feed(ligne);
  return { declaration: suivi.declaration(), arret: suivi.arret() };
}

describe('le plafond d’une tentative, et ce que le CLI réel en dit', () => {
  it('la réservation MOINS le coût déclaré des tentatives terminées — nul ou négatif : dépensée, jamais un plancher', () => {
    const depense = (micros: number, tentatives: number, sansCout = 0) => ({
      micros,
      tentatives,
      sansCout,
    });
    expect(plafondCoutTentative(50_000, depense(0, 0))).toBe(50_000);
    expect(plafondCoutTentative(50_000, depense(20_000, 1))).toBe(30_000);
    // Une tentative au coût inconnu ne se retranche pas : un majorant.
    expect(plafondCoutTentative(50_000, depense(20_000, 2, 1))).toBe(30_000);
    // Réservation dépensée : rien à passer — pas un plancher d'un micro-USD,
    // qui paierait encore une réponse entière. La Reine clôt alors l'enfant.
    expect(plafondCoutTentative(50_000, depense(50_000, 1))).toBe(0);
    expect(plafondCoutTentative(50_000, depense(52_000, 1))).toBe(-2_000);
  });

  it('LA LIGNE ENREGISTRÉE : un arrêt sur le coût, lu en une passe — coût entier, jetons de `modelUsage`, temps modèle tu', () => {
    // `usage` et `duration_api_ms` y valent zéro alors que la réponse qui a
    // franchi le plafond a coûté : lus, ils déclareraient un faux. `modelUsage`
    // la compte (10 + 13 796 + 11 118 jetons d'entrée, 264 de sortie).
    expect(suivre(FLUX_ARRET)).toEqual({
      arret: 'cout',
      declaration: {
        source: 'claude-code',
        coutUsd: 0.0249456,
        jetonsEntree: 24_924,
        jetonsSortie: 264,
        modeles: ['claude-haiku-4-5-20251001'],
      },
    });
    // Hive ne passe aucun plafond de tours : `error_max_turns` n'est pas un arrêt.
    for (const subtype of [
      'error_max_turns',
      'success',
      'error_during_execution',
      'constructor',
      'toString',
    ]) {
      expect(suivre([JSON.stringify({ type: 'result', subtype })]).arret, subtype).toBeUndefined();
    }
    // Une ligne `result` ULTÉRIEURE remplace l'arrêt : c'est la dernière qui dit l'issue.
    const ensuite = JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.03 });
    expect(suivre([...FLUX_ARRET, ensuite])).toMatchObject({
      arret: undefined,
      declaration: { coutUsd: 0.03 },
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
    expect(verdictPlafondClaude(epingle!)).toEqual({ tenu: true });
  });

  it('un CLI qui ne tiendrait pas le plafond le dit — avec la mise à jour à faire', () => {
    const ancien = verdictPlafondClaude('2.1.200');
    expect(ancien).toMatchObject({ tenu: false });
    expect(ancien.tenu ? '' : ancien.motif).toBe(
      'Claude Code 2.1.200 : --max-budget-usd n’est tenu, sous-agents compris, qu’à partir de ' +
        '2.1.217 — mettez-le à jour : `claude update`',
    );
    const illisible = verdictPlafondClaude(null);
    expect(illisible.tenu ? '' : illisible.motif).toContain('`claude update`');
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
  it('CE QUE LIT LE PARENT, ET CE QUE LIT LE MODÈLE QUI RÉSERVE : la dépense, la suite, un ordre de grandeur', () => {
    // La ligne d'arrêt dit la borne, la dépense, le diff joint, et que le
    // même childTaskId ne ferait que rejouer l'enfant arrêté.
    expect(
      ligneArretBudgetaire({ plafondMicros: 50_000, coutUsd: 0.0249456, diffJoint: true }),
    ).toBe(
      '[hive] arrêt budgétaire : l’agent s’est arrêté dans sa boucle sur son plafond de coût ' +
        '(0.05 USD), 0.0249456 USD dépensés (estimation du CLI) — ni un échec, ni une panne ; ' +
        'diff partiel joint. Pour continuer, redélègue sous un NOUVEL childTaskId avec une ' +
        'réservation plus large : le même childTaskId rejoue cet enfant arrêté.',
    );
    expect(
      ligneArretBudgetaire({ plafondMicros: 50_000, coutUsd: undefined, diffJoint: false }),
    ).toContain('dépense non déclarée — ni un échec, ni une panne ; aucun diff produit.');
    // Une réservation NULLE n'est pas un plafond : refusée à l'admission, avec
    // de quoi réserver — le parent lit ce motif.
    const refus = jugerDelegation(
      {
        childTaskId: 'enfant',
        parentTaskId: 'racine',
        title: 'Lot',
        prompt: 'fais ce lot',
        durationMs: 60_000,
        costMicros: 0,
        resourceUnits: 1,
      },
      [
        {
          taskId: 'racine',
          rootTaskId: 'racine',
          parentTaskId: null,
          depth: 0,
          status: 'running',
          origine: 'hive',
        },
      ],
    );
    expect(refus).toMatchObject({ ok: false, code: 'cout' });
    expect(refus.ok ? '' : refus.motif).toBe(
      'costMicros invalide : entier de 1 à 5000000 µUSD attendu — c’est aussi le plafond de ' +
        'l’enfant dans la boucle de son agent, et une seule réponse coûte déjà de 13000 à 25000 ' +
        'µUSD sur le plus petit modèle',
    );
    // L'outil le dit AVANT : minimum 1, et l'ordre de grandeur d'une réponse.
    const [delegue] = definitionsOutilsDelegation();
    const cout = (
      delegue!.inputSchema as {
        properties: Record<string, { minimum?: number; description: string }>;
      }
    ).properties.costMicros!;
    expect(cout.minimum).toBe(1);
    expect(cout.description).toContain(
      'Une seule réponse coûte déjà 13000 à 25000 µUSD sur le plus petit modèle : réserve moins, ' +
        'et l’enfant s’arrête après sa première réponse.',
    );
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
    'PREUVE G09a : un enfant s’arrête dans la boucle sur sa réservation, l’arrêt est journalisé, le Genome n’est pas pénalisé',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const bin = poserFauxClaude('2.1.278', ['arret']);
      lancerOuvriereClaude(srv);
      // 100 µUSD : le plafond exact sous lequel le flux rejoué a été enregistré
      // (`--max-budget-usd 0.0001`). Rejoué sous un plafond plus haut que ce
      // qu'il a dépensé, ce ne serait plus un arrêt sur CE plafond — et la
      // Reine ne le croirait pas (`arretCru`).
      deleguer(srv, 100);

      const fin = await attendre(
        () => evenements(srv, 'task_failed', 'enfant').at(0),
        'l’enfant n’a pas fini',
      );
      // Le CLI a reçu la réservation de l'enfant, en dollars, comme une option.
      expect(appels(bin).map(plafondPasse)).toEqual(['0.0001']);
      expect(journalDe(srv, 'enfant')).toContainEqual(
        expect.stringContaining(
          'plafond de dépense de cette tentative : 0.0001 USD (--max-budget-usd)',
        ),
      );
      // L'issue est un ARRÊT BUDGÉTAIRE, au coût déclaré par le CLI.
      expect(fin.payload).toMatchObject({
        taskId: 'enfant',
        attempts: 1,
        arretBudgetaire: 'cout',
        fournisseur: { coutUsd: 0.0249456 },
      });
      // Les logs s'ouvrent sur ce que le parent doit lire : la borne, la
      // dépense déclarée, ce qui est joint, et quoi faire ensuite.
      const resultat = srv.store.resultsForTask('enfant').at(-1);
      expect(resultat?.logs.split('\n')[0]).toBe(
        ligneArretBudgetaire({ plafondMicros: 100, coutUsd: 0.0249456, diffJoint: false }),
      );
      // Le fait est porté sur la TÂCHE : les écrans la disent arrêtée, pas échouée.
      expect(srv.store.getTask('enfant')?.result?.arretBudgetaire).toBe('cout');
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
        'plafond de 0.05 USD NON passé à l’agent : Claude Code 2.1.200 : --max-budget-usd n’est ' +
          'tenu, sous-agents compris, qu’à partir de 2.1.217 — mettez-le à jour : `claude ' +
          'update` — seule l’enveloppe de la racine le borne, après chaque tentative rendue',
      );
    },
  );
});

// ─── LA PORTE DE LA REINE : un faux nœud, des résultats choisis ──────────────

/** Ce que le faux nœud reçoit, et ce qu'il peut rendre. */
type Recu = {
  type: string;
  task?: { id: string };
  plafondCoutMicros?: number;
  childTaskId?: string;
  logs?: string;
};

async function fauxNoeud(
  srv: HiveServer,
  inscription: { agentType: string; plafondCout?: boolean },
): Promise<{ recus: Recu[]; rendre: (taskId: string, r: Record<string, unknown>) => void }> {
  const recus: Recu[] = [];
  const noeud = await brancherFauxNoeud<Recu>(
    srv.port,
    {
      token: TOKEN,
      name: 'faux',
      ownerName: 'test',
      maxConcurrency: 2,
      nodeId: 'faux',
      ...inscription,
    },
    (m) => {
      if (m.type === 'assign_task' || m.type === 'delegation_result') recus.push(m);
    },
  );
  sockets.push(noeud);
  return {
    recus,
    rendre: (taskId, r) =>
      noeud.ws.send(
        JSON.stringify({
          type: 'task_result',
          taskId,
          success: false,
          diff: '',
          logs: 'échec simulé',
          durationMs: 5,
          subAgents: [],
          ...r,
        }),
      ),
  };
}

/** Une racine `solo` et son enfant délégué, qui réserve 0,05 $. */
function arbre(srv: HiveServer): void {
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
}

const assignations = (recus: readonly Recu[], id: string): Recu[] =>
  recus.filter((m) => m.type === 'assign_task' && m.task?.id === id);

const declare = (coutUsd: number) => ({ fournisseur: { source: 'claude-code', coutUsd } });

describe('la porte de la Reine : un plafond, tenu et cru par la tentative qu’il borne', () => {
  it(
    'UN ARRÊT N’EST CRU QUE DE LA TENTATIVE BORNÉE — en échec, au coût arrivé sur SON plafond',
    { timeout: 30_000 },
    async () => {
      const srv = await monterReine();
      const { recus, rendre } = await fauxNoeud(srv, {
        agentType: 'claude-code',
        plafondCout: true,
      });
      arbre(srv);
      const assignee = (id: string, n = 1) =>
        attendre(() => assignations(recus, id).at(n - 1), `${id} jamais assignée (${n})`);
      // Le plafond ne part qu'avec l'enfant délégué : une racine n'en a pas.
      expect((await assignee('solo')).plafondCoutMicros).toBeUndefined();
      expect((await assignee('enfant')).plafondCoutMicros).toBe(50_000);

      // Un « arrêt » sur une tâche que la Reine n'a pas plafonnée est un
      // échec ordinaire : un seul message ne clôt pas une tâche sans reprise.
      rendre('solo', { arretBudgetaire: 'cout', ...declare(1) });
      const reprise = await attendre(
        () => evenements(srv, 'task_retry', 'solo').at(0),
        'la racine n’a pas été reprise',
      );
      expect(reprise.payload.arretBudgetaire).toBeUndefined();
      expect(evenements(srv, 'task_failed', 'solo')).toEqual([]);

      // Un « arrêt » dont le coût déclaré n'a pas atteint le plafond de CETTE
      // tentative n'en est pas un : la tâche suit son cours, et sa reprise
      // reçoit le reste — 0,05 $ moins les 0,01 $ déclarés.
      rendre('enfant', { arretBudgetaire: 'cout', ...declare(0.01) });
      expect((await assignee('enfant', 2)).plafondCoutMicros).toBe(40_000);
      expect(evenements(srv, 'task_retry', 'enfant')[0]?.payload.arretBudgetaire).toBeUndefined();
      expect(evenements(srv, 'task_failed', 'enfant')).toEqual([]);

      // L'arrêt sur CE plafond, lui, est cru : terminal, et dit tel.
      rendre('enfant', { arretBudgetaire: 'cout', ...declare(0.04) });
      const fin = await attendre(
        () => evenements(srv, 'task_failed', 'enfant').at(0),
        'l’enfant n’a pas fini',
      );
      expect(fin.payload).toMatchObject({ arretBudgetaire: 'cout', attempts: 2 });
      expect(srv.store.getTask('enfant')?.result?.arretBudgetaire).toBe('cout');
    },
  );

  it(
    'UN NŒUD QUI NE TIENT AUCUN PLAFOND ne le reçoit pas — la Reine le dit à l’envoi, et ne croit pas son « arrêt »',
    { timeout: 30_000 },
    async () => {
      const srv = await monterReine();
      // Un nœud d'avant ce contrat, ou un Codex : aucune capacité déclarée.
      const { recus, rendre } = await fauxNoeud(srv, { agentType: 'codex' });
      arbre(srv);
      const envoi = await attendre(
        () => assignations(recus, 'enfant').at(0),
        'enfant jamais assigné',
      );
      expect(envoi.plafondCoutMicros).toBeUndefined();
      expect(journalDe(srv, 'enfant')).toContainEqual(
        'plafond de 0.05 USD non tenu : l’ouvrière faux (codex) ne déclare tenir aucun plafond ' +
          'de coût dans la boucle de son agent — seule l’enveloppe de la racine le borne, ' +
          'après chaque tentative rendue',
      );
      // Rien ne l'a borné : son « arrêt » est un échec ordinaire, repris.
      rendre('enfant', { arretBudgetaire: 'cout', ...declare(0.02) });
      await attendre(
        () => evenements(srv, 'task_retry', 'enfant').at(0),
        'l’enfant n’a pas été repris',
      );
      expect(evenements(srv, 'task_failed', 'enfant')).toEqual([]);
    },
  );

  it(
    'UNE RÉSERVATION DÉPENSÉE N’EST PLUS ENVOYÉE : la Reine clôt l’enfant et dit au parent quoi faire',
    { timeout: 30_000 },
    async () => {
      const srv = await monterReine();
      const { recus, rendre } = await fauxNoeud(srv, {
        agentType: 'claude-code',
        plafondCout: true,
      });
      arbre(srv);
      await attendre(() => assignations(recus, 'enfant').at(0), 'enfant jamais assigné');
      // Un échec ORDINAIRE qui a dépensé toute la réservation (0,06 $ pour
      // 0,05 $ réservés) : une reprise n'aurait plus rien à dépenser.
      rendre('enfant', declare(0.06));
      const fin = await attendre(
        () => evenements(srv, 'task_failed', 'enfant').at(0),
        'l’enfant n’a pas été clos',
      );
      // Clos à la Reine, avant tout envoi : aucune tentative, aucun nœud nommé.
      expect(fin.payload).toMatchObject({
        reason: 'reservation_depensee',
        arretBudgetaire: 'cout',
        attempts: 1,
      });
      expect(fin.payload).not.toHaveProperty('nodeId');
      // La tentative, elle, reste l'échec ordinaire qu'elle était.
      expect(evenements(srv, 'task_retry', 'enfant')).toHaveLength(1);
      // Le parent l'apprend tout de suite, avec la suite à donner.
      const prevenu = await attendre(
        () => recus.find((m) => m.type === 'delegation_result' && m.childTaskId === 'enfant'),
        'le parent n’a pas été prévenu',
      );
      expect(prevenu.logs).toContain('réservation de coût de cette sous-tâche dépensée');
      expect(prevenu.logs).toContain('redélègue sous un NOUVEL childTaskId');
      await new Promise((r) => setTimeout(r, 300));
      // Ni relancé, ni écrasé : la tentative ordinaire ne remplace pas ce motif.
      expect(assignations(recus, 'enfant')).toHaveLength(1);
      expect(
        recus.filter((m) => m.type === 'delegation_result' && m.childTaskId === 'enfant'),
      ).toHaveLength(1);
      expect(srv.store.getTask('enfant')?.status).toBe('failed');
    },
  );
});
