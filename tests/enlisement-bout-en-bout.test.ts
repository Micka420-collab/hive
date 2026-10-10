// G13 — DE BOUT EN BOUT : une vraie Reine, un vrai nœud (`HiveNodeClient`), les
// VRAIS adaptateurs `claude-code` et `codex`, contre un faux CLI — comme
// `budget-boucle.test.ts`. Le faux `claude` tourne sur les trois systèmes :
// sur le PATH sous POSIX, et sous Windows là où `argvAgent` trouve le paquet
// npm (`npm_config_prefix`, comme tests/agent-windows-spawn.test.ts). Le faux
// `codex`, lui, n'a pas d'équivalent Windows (`PAQUETS_AGENTS`) : POSIX.
//
//   · un agent qui boucle est ARRÊTÉ par la vigie bien avant son délai dur
//     (15 min), et l'issue `enlisement` est rangée sur le fait de chaque
//     tentative, dite au journal de la tâche, dans sa console en direct, et
//     comptée contre le modèle — plus de « délai dépassé » muet ;
//   · un agent qui ne boucle PAS n'est jamais arrêté : la même commande qui
//     échoue chaque fois autrement, l'attente d'un travail de fond, des
//     relances que le CLI borne lui-même au-delà de dix ;
//   · un fournisseur épuisé (les flux ENREGISTRÉS sur Claude Code 2.1.289 et
//     codex-cli 0.156.0, voir `vigie-enlisement.test.ts`) devient un refus
//     d'infrastructure qui dit `epuisement_fournisseur` et ce que la tentative
//     a coûté : aucune tentative brûlée, rien au Génome contre le modèle, rien
//     dans ce qu'apprend l'Aiguillage — et la tâche part à une autre famille.
//
// Sur le code d'avant la vigie, l'agent qui boucle tenait jusqu'au délai dur,
// et le 529 de Claude Code comme la surcharge de Codex revenaient en ÉCHEC de
// tentative (`task_retry`). Sur la première vigie (58bf919b), la commande aux
// sorties changeantes, l'attente du fond et les relances bornées à 20 étaient
// tuées.

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { antecedentsDuVecu } from '../src/orchestrator/aiguillage.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { PAQUETS_AGENTS } from '../src/shared/agent-windows.js';
import type { RegistreGenome } from '../src/shared/registre-genome.js';
import type { HiveEvent } from '../src/shared/types.js';

const TOKEN = 'jeton-enlisement-bout-en-bout-long';
const WINDOWS = process.platform === 'win32';
const lignes = (dossier: string, nom: string): string[] =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', dossier, nom), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');

/**
 * Ce que le faux CLI écrit : des lignes, puis un cycle répété sans fin, ou une
 * attente, ou — après `pauseMs`, le temps qu'une vigie trop prompte l'abatte —
 * une suite et une sortie.
 */
interface Scenario {
  lignes: string[];
  /** Rejouées en boucle, `__N__` remplacé par le numéro du tour. */
  repeter?: string[];
  pendre?: boolean;
  pauseMs?: number;
  suite?: string[];
  /** Écrite en dernier, SANS fin de ligne : le nœud ne la lit qu'à la sortie. */
  derniere?: string;
  code?: number;
}

let server: HiveServer | null = null;
const clients: HiveNodeClient[] = [];
let racine = '';

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
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
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-enlisement-'));
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

/** Le script du faux CLI : il rejoue le scénario, et répond à ses sondes comme le vrai. */
function scriptFaux(scenario: Scenario): string {
  return [
    "'use strict';",
    "if (process.argv.includes('--version')) { process.stdout.write('2.1.289 (Claude Code)\\n'); process.exit(0); }",
    "if (process.argv.includes('--help')) { process.stdout.write('Usage: claude\\n'); process.exit(0); }",
    // La sonde du bac de Codex (`codex sandbox … -- true`).
    "if (process.argv[2] === 'sandbox') process.exit(0);",
    `const s = ${JSON.stringify(scenario)};`,
    "const ecrire = (ls) => { for (const l of ls) process.stdout.write(l + '\\n'); };",
    'ecrire(s.lignes);',
    'if (s.repeter) {',
    '  let n = 0;',
    "  const tour = () => { n += 1; ecrire(s.repeter.map((l) => l.split('__N__').join(String(n)))); setTimeout(tour, 15); };",
    '  tour();',
    '} else if (s.pendre) setInterval(() => {}, 1000);',
    'else setTimeout(() => {',
    '  ecrire(s.suite ?? []);',
    '  if (s.derniere) process.stdout.write(s.derniere);',
    '  process.exitCode = s.code ?? 0;',
    '}, s.pauseMs ?? 0);',
  ].join('\n');
}

/**
 * Un faux CLI là où l'adaptateur le cherche : sur le PATH (POSIX), ou dans le
 * paquet npm que `argvAgent` lance sous Windows.
 */
function poserFaux(nom: 'claude' | 'codex', scenario: Scenario): void {
  const script = scriptFaux(scenario);
  if (WINDOWS && nom === 'claude') {
    const paquet = PAQUETS_AGENTS.claude!;
    const prefixe = path.join(racine, 'npm');
    const fichier = path.join(prefixe, 'node_modules', ...paquet.paquet.split('/'), paquet.entree);
    mkdirSync(path.dirname(fichier), { recursive: true });
    writeFileSync(fichier, script);
    vi.stubEnv('npm_config_prefix', prefixe);
    return;
  }
  const bin = path.join(racine, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, nom), `#!/usr/bin/env node\n${script}`);
  chmodSync(path.join(bin, nom), 0o755);
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
}

function lancerOuvriere(srv: HiveServer, agentType: 'claude-code' | 'codex', modele: string): void {
  const client = new HiveNodeClient({
    url: `ws://127.0.0.1:${srv.port}/ws`,
    token: TOKEN,
    name: `ouvriere-${agentType}`,
    ownerName: 'banc',
    agentType,
    nodeId: `ouvriere-${agentType}`,
    modeles: [modele],
    maxConcurrency: 1,
    workRoot: path.join(racine, `travail-${agentType}`),
    adapter: agentType === 'codex' ? createCodexAdapter(TOKEN) : createClaudeCodeAdapter(TOKEN),
    quiet: true,
  });
  clients.push(client);
  client.start();
}

function tache(srv: HiveServer): string {
  const projet = srv.store.createProject({ name: 'Vigie' });
  const t = srv.store.createTask({
    projectId: projet.id,
    title: 'Corriger la route',
    prompt: 'corrige le bug de la route',
  });
  srv.store.patchTask(t.id, { status: 'ready' });
  return t.id;
}

const evenements = (srv: HiveServer, type: string, taskId: string): HiveEvent[] =>
  srv.store
    .evenementsParTypes([type], 1_000)
    .filter((e) => e.payload.taskId === taskId)
    .reverse();

const journal = (srv: HiveServer, taskId: string): unknown[] =>
  evenements(srv, 'task_progress', taskId).map((e) => e.payload.log);

async function genome(srv: HiveServer, modele: string) {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/genome`, {
    headers: { 'x-hive-token': TOKEN },
  });
  const registre = (await r.json()) as RegistreGenome;
  return registre.lignes.find((l) => l.modele === modele);
}

async function chronologie(srv: HiveServer, taskId: string) {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${taskId}/chronologie`, {
    headers: { 'x-hive-token': TOKEN },
  });
  return (
    (await r.json()) as {
      chronologie: { tentatives: Array<Record<string, unknown>> };
    }
  ).chronologie;
}

const terminee = (srv: HiveServer, id: string, message: string) =>
  attendre(() => (srv.store.getTask(id)?.status === 'done' ? true : undefined), message);

// ─── Les flux ─────────────────────────────────────────────────────────────────

const INIT = lignes('enlisement', 'claude-429.stream.jsonl').filter((l) =>
  l.includes('"subtype":"init"'),
);
const [, APPEL, RETOUR] = lignes('texte-final', 'claude-echec-api-400.stream.jsonl');
/** Le même `Read`, le même retour : la forme enregistrée, un identifiant par tour. */
const LECTURE_EN_BOUCLE = [
  APPEL!.replaceAll('toolu_faux_0001', 'toolu_boucle___N__'),
  RETOUR!.replaceAll('toolu_faux_0001', 'toolu_boucle___N__'),
];
const FIN_REUSSIE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'fait',
});

/** Un appel d'outil et son retour, à la forme enregistrée sur 2.1.289. */
function outil(id: string, nom: string, input: unknown, retour: string, erreur = false): string[] {
  const appel = JSON.parse(APPEL!) as { message: { content: unknown[] } };
  appel.message.content = [{ type: 'tool_use', id, name: nom, input }];
  const resultat = JSON.parse(RETOUR!) as { message: { content: unknown[] } };
  resultat.message.content = [
    {
      tool_use_id: id,
      type: 'tool_result',
      content: retour,
      ...(erreur ? { is_error: true } : {}),
    },
  ];
  return [JSON.stringify(appel), JSON.stringify(resultat)];
}

describe('la vigie, de la Reine au CLI', () => {
  it(
    'UN AGENT QUI BOUCLE : arrêté bien avant son délai, `enlisement` rangé, dit, et compté contre le modèle',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      poserFaux('claude', { lignes: INIT, repeter: LECTURE_EN_BOUCLE });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      const echec = await attendre(
        () => evenements(srv, 'task_failed', id)[0],
        'l’agent qui boucle n’est jamais arrêté : seul le délai dur l’aurait fait',
      );
      const enlisement = { motif: 'repetition', fois: 4, outil: 'Read' };
      expect(echec.payload).toMatchObject({ attempts: 3, enlisement });
      const reprises = evenements(srv, 'task_retry', id);
      expect(reprises.map((e) => e.payload.enlisement)).toEqual([enlisement, enlisement]);
      for (const e of [...reprises, echec]) expect(e.payload.durationMs).toBeLessThan(10_000);
      const ligne =
        '[hive] enlisé : même appel d’outil répété 4 fois, même résultat (Read) — agent arrêté avant son délai';
      expect(journal(srv, id).filter((l) => l === ligne)).toHaveLength(3);
      const logs = srv.store.resultsForTask(id).map((r) => r.logs);
      expect(logs).toHaveLength(3);
      for (const l of logs) {
        expect(l.trimEnd().endsWith(ligne)).toBe(true);
        expect(l).not.toContain('timeout');
        expect(l).not.toContain('tâche annulée');
      }
      const { tentatives } = await chronologie(srv, id);
      expect(tentatives).toEqual([
        expect.objectContaining({ issue: 'reprise', enlisement }),
        expect.objectContaining({ issue: 'reprise', enlisement }),
        expect.objectContaining({ issue: 'echec', enlisement }),
      ]);
      expect(await genome(srv, 'modele-banc')).toMatchObject({ reprises: 2, echecs: 1, refus: 0 });
    },
  );

  it(
    'SORTI DE LUI-MÊME, sa boucle lue sur sa dernière ligne à la sortie : enlisé — mais personne ne l’a arrêté, et le journal ne le dit pas',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const tours = [1, 2, 3, 4].flatMap((n) =>
        LECTURE_EN_BOUCLE.map((l) => l.split('__N__').join(String(n))),
      );
      // La 4e lecture identique est la DERNIÈRE ligne, sans fin de ligne : la
      // vigie la lit quand le CLI est déjà sorti, en échec, de lui-même.
      poserFaux('claude', {
        lignes: [...INIT, ...tours.slice(0, -1)],
        derniere: tours.at(-1),
        code: 1,
      });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      const reprise = await attendre(() => evenements(srv, 'task_retry', id)[0], 'aucune reprise');
      expect(reprise.payload).toMatchObject({
        enlisement: { motif: 'repetition', fois: 4, outil: 'Read' },
      });
      expect(journal(srv, id)).toContain(
        '[hive] enlisé : même appel d’outil répété 4 fois, même résultat (Read)',
      );
      expect(journal(srv, id)).not.toContainEqual(expect.stringContaining('agent arrêté'));
    },
  );

  it(
    'LA MÊME COMMANDE QUI ÉCHOUE CHAQUE FOIS AUTREMENT n’est pas une boucle : l’agent conclut',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      // Cinq `npm test` qui sortent en 1, leur durée changeant ; puis l'agent
      // conclut. La première vigie les comptait comme des « erreurs ».
      const essais = Array.from({ length: 5 }, (_, i) =>
        outil(
          `toolu_test_${i}`,
          'Bash',
          { command: 'npm test' },
          `Exit code 1\n FAIL  a.test.ts\n Duration  ${578 + i * 53}ms`,
          true,
        ),
      ).flat();
      poserFaux('claude', { lignes: [...INIT, ...essais], pauseMs: 1_500, suite: [FIN_REUSSIE] });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      await terminee(srv, id, 'la commande aux sorties changeantes a été tuée comme une boucle');
      expect(journal(srv, id)).not.toContainEqual(expect.stringContaining('enlisé'));
    },
  );

  it(
    'ATTENDRE UN TRAVAIL DE FOND n’est pas une boucle : relire sa sortie inchangée, puis conclure',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const fond = (taches: unknown[]) =>
        JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: taches });
      const relectures = Array.from({ length: 6 }, (_, i) =>
        outil(
          `toolu_relis_${i}`,
          'Read',
          { file_path: '/tmp/bash-1.out' },
          'Wasted call — file unchanged since your last Read.',
        ),
      ).flat();
      const enCours = [{ task_id: 'b1', task_type: 'local_bash', description: 'npm run build' }];
      poserFaux('claude', {
        lignes: [...INIT, fond(enCours), ...relectures, fond([])],
        pauseMs: 1_500,
        suite: [FIN_REUSSIE],
      });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      await terminee(srv, id, 'l’attente d’un travail de fond a été tuée comme une boucle');
    },
  );

  it(
    'DES RELANCES QUE LE CLI BORNE LUI-MÊME (`max_retries: 20`) ne sont jamais devancées',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const relances = Array.from({ length: 15 }, (_, i) =>
        JSON.stringify({
          type: 'system',
          subtype: 'api_retry',
          attempt: i + 1,
          max_retries: 20,
          retry_delay_ms: 1_000,
          error_status: 529,
          error: 'overloaded',
        }),
      );
      poserFaux('claude', {
        lignes: [...INIT, ...relances],
        pauseMs: 1_500,
        suite: [...outil('toolu_apres', 'Read', { file_path: 'a.ts' }, 'ok'), FIN_REUSSIE],
      });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      await terminee(srv, id, 'des relances bornées par le CLI ont été devancées');
      expect(evenements(srv, 'task_rejected', id)).toEqual([]);
    },
  );

  it(
    'UN 529 EN SÉRIE (Claude Code 2.1.289 enregistré) : refus `epuisement_fournisseur` qui dit ce que la tentative a coûté — aucune tentative brûlée, hors de la note',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      poserFaux('claude', { lignes: lignes('enlisement', 'claude-529.stream.jsonl'), code: 1 });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      const refus = await attendre(
        () => evenements(srv, 'task_rejected', id)[0],
        'le 529 n’est pas lu comme un épuisement du fournisseur',
      );
      expect(refus.payload).toMatchObject({
        infra: true,
        epuisement: { cause: 'surcharge' },
        // Ce que le CLI a déclaré de sa tentative (zéro : aucun appel n'a abouti).
        fournisseur: { source: 'claude-code', coutUsd: 0 },
      });
      expect(refus.payload.durationMs).toEqual(expect.any(Number));
      // La raison dit ce qui le PROUVE : la ligne du CLI.
      expect(String(refus.payload.reason)).toContain('API Error: 529 Overloaded');
      expect(journal(srv, id)).toContain(
        '[hive] fournisseur épuisé : surchargé ; tentative réaffectée sans être comptée — ce qu’elle a écrit n’est pas repris',
      );
      expect(evenements(srv, 'task_retry', id)).toEqual([]);
      expect(srv.store.getTask(id)?.attempts).toBe(0);
      const { tentatives } = await chronologie(srv, id);
      expect(tentatives[0]).toMatchObject({
        issue: 'epuisement',
        coutUsd: 0,
        epuisement: { cause: 'surcharge' },
      });
      expect(tentatives[0]?.dureeWorkerMs).toEqual(expect.any(Number));
      expect(await genome(srv, 'modele-banc')).toMatchObject({ refus: 1, reprises: 0, echecs: 0 });
      expect(antecedentsDuVecu(srv.store.observationsAiguillage(), []).modeles.size).toBe(0);
    },
  );

  it.skipIf(WINDOWS)(
    'ÉPUISÉE CHEZ CLAUDE CODE, la tâche part à une autre famille — la réaffectation d’infrastructure existante',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      poserFaux('claude', { lignes: lignes('enlisement', 'claude-529.stream.jsonl'), code: 1 });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      await attendre(() => evenements(srv, 'task_rejected', id)[0], 'aucun refus');
      poserFaux('codex', {
        lignes: lignes('flux-codex', 'relecture-outil.json.stdout.jsonl'),
        code: 0,
      });
      lancerOuvriere(srv, 'codex', 'modele-de-test');
      await terminee(srv, id, 'la tâche n’est pas reprise par une autre famille');
      expect(evenements(srv, 'task_done', id)[0]?.payload.nodeId).toBe('ouvriere-codex');
    },
  );

  it(
    'TUÉE PENDANT DES RELANCES (chien de garde de Claude Code, enregistré), sans issue finale : un épuisement, pas un échec du modèle',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      // Le flux enregistré sous `CLAUDE_CODE_RETRY_WATCHDOG=1`, coupé comme
      // par le délai dur : aucune ligne `result`.
      poserFaux('claude', {
        lignes: lignes('enlisement', 'claude-529-watchdog.stream.jsonl'),
        code: 143,
      });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      const refus = await attendre(() => evenements(srv, 'task_rejected', id)[0], 'aucun refus');
      expect(refus.payload).toMatchObject({ infra: true, epuisement: { cause: 'surcharge' } });
      expect(evenements(srv, 'task_retry', id)).toEqual([]);
    },
  );

  it(
    'UNE LIMITE D’ABONNEMENT (contrat) : le fait porte la remise à zéro déclarée',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const remise = Math.floor(Date.now() / 1000) + 3_600;
      const flux = lignes('enlisement', 'claude-limite-abonnement.contrat.stream.jsonl').map((l) =>
        l.replace('"resetsAt":1791141300', `"resetsAt":${remise}`),
      );
      poserFaux('claude', { lignes: flux, code: 1 });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      const refus = await attendre(() => evenements(srv, 'task_rejected', id)[0], 'aucun refus');
      expect(refus.payload).toMatchObject({
        infra: true,
        epuisement: { cause: 'limite', remiseA: remise * 1000 },
      });
    },
  );

  describe.skipIf(WINDOWS)('Codex 0.156.0 (POSIX : le faux `codex` vit sur le PATH)', () => {
    it.each([
      ['codex-503.json.stdout.jsonl', 'surcharge'],
      ['codex-usage.json.stdout.jsonl', 'limite'],
      ['codex-injoignable.json.stdout.jsonl', 'injoignable'],
    ])(
      'CODEX enregistré (%s) : épuisement du fournisseur, jamais un échec de tentative',
      { timeout: 40_000 },
      async (nom, cause) => {
        const srv = await monterReine();
        poserFaux('codex', { lignes: lignes('enlisement', nom), code: 1 });
        lancerOuvriere(srv, 'codex', 'modele-de-test');
        const id = tache(srv);
        const refus = await attendre(() => evenements(srv, 'task_rejected', id)[0], 'aucun refus');
        expect(refus.payload).toMatchObject({ infra: true, epuisement: { cause } });
        expect(evenements(srv, 'task_retry', id)).toEqual([]);
      },
    );
  });

  it(
    'UN AGENT QUI PROGRESSE n’est jamais arrêté : la même commande, des sorties qui changent, et il conclut',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      const tours = Array.from({ length: 12 }, (_, i) => [
        APPEL!.replaceAll('toolu_faux_0001', `toolu_progres_${i}`),
        RETOUR!
          .replaceAll('toolu_faux_0001', `toolu_progres_${i}`)
          .replace('return jeton.length > 0;', `return jeton.length > ${i};`),
      ]).flat();
      poserFaux('claude', { lignes: [...INIT, ...tours, FIN_REUSSIE], code: 0 });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      await terminee(srv, id, 'l’agent qui progresse n’a pas conclu');
      expect(journal(srv, id)).not.toContainEqual(expect.stringContaining('enlisé'));
    },
  );
});
