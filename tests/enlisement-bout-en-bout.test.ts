// G13 — DE BOUT EN BOUT : une vraie Reine, un vrai nœud (`HiveNodeClient`), les
// VRAIS adaptateurs `claude-code` et `codex`, contre un faux CLI posé sur le
// PATH — comme `budget-boucle.test.ts`.
//
//   · un agent qui boucle est ARRÊTÉ par la vigie bien avant son délai dur
//     (15 min), et l'issue `enlisement` est rangée sur le fait de chaque
//     tentative, dite au journal de la tâche, dans sa console en direct, et
//     comptée contre le modèle — plus de « délai dépassé » muet ;
//   · un fournisseur épuisé (les flux ENREGISTRÉS sur Claude Code 2.1.289 et
//     codex-cli 0.156.0, voir `vigie-enlisement.test.ts`) devient un refus
//     d'infrastructure qui dit `epuisement_fournisseur` : aucune tentative
//     brûlée, rien au Génome contre le modèle, rien dans ce qu'apprend
//     l'Aiguillage — et la tâche part à une autre famille ;
//   · un agent qui progresse n'est jamais arrêté.
//
// Sur le code d'avant la vigie, l'agent qui boucle et l'attente sans fin
// tenaient jusqu'au délai dur (ces bancs expirent), et le 529 de Claude Code
// comme la surcharge de Codex revenaient en ÉCHEC de tentative (`task_retry`).

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { antecedentsDuVecu } from '../src/orchestrator/aiguillage.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import type { RegistreGenome } from '../src/shared/registre-genome.js';
import type { HiveEvent } from '../src/shared/types.js';

const TOKEN = 'jeton-enlisement-bout-en-bout-long';
const lignes = (dossier: string, nom: string): string[] =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', dossier, nom), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');

/** Ce que le faux CLI écrit : des lignes, puis un cycle répété sans fin, ou une attente, ou une sortie. */
interface Scenario {
  lignes: string[];
  /** Rejouées en boucle, `__N__` remplacé par le numéro du tour. */
  repeter?: string[];
  pendre?: boolean;
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

/** Un faux CLI sur le PATH : il rejoue le scénario, et répond à ses sondes comme le vrai. */
function poserFaux(nom: 'claude' | 'codex', scenario: Scenario): void {
  const bin = path.join(racine, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(bin, nom),
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "if (process.argv.includes('--version')) { process.stdout.write('2.1.289 (Claude Code)\\n'); process.exit(0); }",
      "if (process.argv.includes('--help')) { process.stdout.write('Usage: claude\\n'); process.exit(0); }",
      // La sonde du bac de Codex (`codex sandbox … -- true`).
      "if (process.argv[2] === 'sandbox') process.exit(0);",
      `const s = ${JSON.stringify(scenario)};`,
      "for (const l of s.lignes) process.stdout.write(l + '\\n');",
      'if (s.repeter) {',
      '  let n = 0;',
      "  const tour = () => { n += 1; for (const l of s.repeter) process.stdout.write(l.split('__N__').join(String(n)) + '\\n'); setTimeout(tour, 15); };",
      '  tour();',
      '} else if (s.pendre) setInterval(() => {}, 1000);',
      'else process.exitCode = s.code ?? 0;',
    ].join('\n'),
  );
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

async function genome(srv: HiveServer, modele: string) {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/genome`, {
    headers: { 'x-hive-token': TOKEN },
  });
  const registre = (await r.json()) as RegistreGenome;
  return registre.lignes.find((l) => l.modele === modele);
}

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

describe.skipIf(process.platform === 'win32')('la vigie, de la Reine au CLI', () => {
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
      // Trois tentatives, chacune arrêtée en quelques instants — pas en 15 min.
      expect(echec.payload).toMatchObject({ attempts: 3, enlisement });
      const reprises = evenements(srv, 'task_retry', id);
      expect(reprises.map((e) => e.payload.enlisement)).toEqual([enlisement, enlisement]);
      for (const e of [...reprises, echec]) expect(e.payload.durationMs).toBeLessThan(10_000);
      // Dit au journal de la tâche au moment de l'arrêt, et en clôture des logs.
      const ligne =
        '[hive] enlisé : même appel d’outil répété 4 fois, même résultat (Read) — agent arrêté avant son délai';
      const journal = evenements(srv, 'task_progress', id).map((e) => e.payload.log);
      expect(journal.filter((l) => l === ligne)).toHaveLength(3);
      const logs = srv.store.resultsForTask(id).map((r) => r.logs);
      expect(logs).toHaveLength(3);
      for (const l of logs) {
        expect(l.trimEnd().endsWith(ligne)).toBe(true);
        expect(l).not.toContain('timeout');
        expect(l).not.toContain('tâche annulée');
      }
      // Le tiroir le dit, tentative par tentative.
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${id}/chronologie`, {
        headers: { 'x-hive-token': TOKEN },
      });
      const { chronologie } = (await r.json()) as {
        chronologie: { tentatives: Array<{ issue: string; enlisement?: unknown }> };
      };
      expect(chronologie.tentatives).toEqual([
        expect.objectContaining({ issue: 'reprise', enlisement }),
        expect.objectContaining({ issue: 'reprise', enlisement }),
        expect.objectContaining({ issue: 'echec', enlisement }),
      ]);
      // Compté contre le modèle, comme tout échec : c'est LUI qui tournait en rond.
      expect(await genome(srv, 'modele-banc')).toMatchObject({ reprises: 2, echecs: 1, refus: 0 });
    },
  );

  it(
    'UN 529 EN SÉRIE (Claude Code 2.1.289 enregistré) : refus d’infrastructure `epuisement_fournisseur`, aucune tentative brûlée, hors de la note — et une autre famille reprend la tâche',
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
      expect(refus.payload).toMatchObject({ infra: true, epuisement: { cause: 'surcharge' } });
      expect(String(refus.payload.reason)).toContain('fournisseur épuisé : surchargé');
      expect(String(refus.payload.reason)).toContain('API Error: 529 Overloaded');
      expect(evenements(srv, 'task_retry', id)).toEqual([]);
      expect(srv.store.getTask(id)?.attempts).toBe(0);
      // Hors de la note : un refus au Génome, rien appris par l'Aiguillage.
      expect(await genome(srv, 'modele-banc')).toMatchObject({ refus: 1, reprises: 0, echecs: 0 });
      expect(antecedentsDuVecu(srv.store.observationsAiguillage(), []).modeles.size).toBe(0);
      // La réaffectation d'infrastructure existante : une autre famille la prend.
      poserFaux('codex', {
        lignes: lignes('flux-codex', 'relecture-outil.json.stdout.jsonl'),
        code: 0,
      });
      lancerOuvriere(srv, 'codex', 'modele-de-test');
      await attendre(
        () => (srv.store.getTask(id)?.status === 'done' ? true : undefined),
        'la tâche n’est pas reprise par une autre famille',
      );
      const fait = evenements(srv, 'task_done', id)[0];
      expect(fait?.payload.nodeId).toBe('ouvriere-codex');
    },
  );

  it(
    'UNE ATTENTE SANS FIN (chien de garde de Claude Code, enregistré) : arrêtée EN VOL au-delà de la borne du CLI',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      // Le flux enregistré, puis le CLI qui attend encore — comme le vrai.
      poserFaux('claude', {
        lignes: lignes('enlisement', 'claude-529-watchdog.stream.jsonl'),
        pendre: true,
      });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      const refus = await attendre(
        () => evenements(srv, 'task_rejected', id)[0],
        'l’attente sans fin tient jusqu’au délai dur',
      );
      expect(refus.payload).toMatchObject({ infra: true, epuisement: { cause: 'surcharge' } });
      const journal = evenements(srv, 'task_progress', id).map((e) => e.payload.log);
      expect(journal).toContain(
        '[hive] fournisseur épuisé : surchargé — agent arrêté avant son délai',
      );
    },
  );

  it(
    'UNE LIMITE D’ABONNEMENT (contrat) : le fait porte la remise à zéro déclarée',
    { timeout: 40_000 },
    async () => {
      const srv = await monterReine();
      poserFaux('claude', {
        lignes: lignes('enlisement', 'claude-limite-abonnement.contrat.stream.jsonl'),
        code: 1,
      });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      const refus = await attendre(() => evenements(srv, 'task_rejected', id)[0], 'aucun refus');
      expect(refus.payload).toMatchObject({
        infra: true,
        epuisement: { cause: 'limite', remiseA: 1_791_141_300_000 },
      });
    },
  );

  it.each([
    ['codex-503.json.stdout.jsonl', false, 'surcharge'],
    ['codex-usage.json.stdout.jsonl', false, 'limite'],
    ['codex-injoignable.json.stdout.jsonl', true, 'injoignable'],
  ])(
    'CODEX 0.156.0 enregistré (%s) : épuisement du fournisseur, jamais un échec de tentative',
    { timeout: 40_000 },
    async (nom, pendre, cause) => {
      const srv = await monterReine();
      poserFaux('codex', {
        lignes: lignes('enlisement', nom),
        ...(pendre ? { pendre } : { code: 1 }),
      });
      lancerOuvriere(srv, 'codex', 'modele-de-test');
      const id = tache(srv);
      const refus = await attendre(() => evenements(srv, 'task_rejected', id)[0], 'aucun refus');
      expect(refus.payload).toMatchObject({ infra: true, epuisement: { cause } });
      expect(evenements(srv, 'task_retry', id)).toEqual([]);
    },
  );

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
      const fin = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'fait',
      });
      poserFaux('claude', { lignes: [...INIT, ...tours, fin], code: 0 });
      lancerOuvriere(srv, 'claude-code', 'modele-banc');
      const id = tache(srv);
      await attendre(
        () => (srv.store.getTask(id)?.status === 'done' ? true : undefined),
        'l’agent qui progresse n’a pas conclu',
      );
      expect(evenements(srv, 'task_progress', id).map((e) => e.payload.log)).not.toContainEqual(
        expect.stringContaining('enlisé'),
      );
    },
  );
});
