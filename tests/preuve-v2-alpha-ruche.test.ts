// LA PREUVE V2 ALPHA, LANCÉE POUR DE VRAI — le script `preuve-v2-alpha.mjs`
// tourne dans son propre processus contre une vraie Reine, avec de vraies
// ouvrières (HiveNodeClient) qui déclarent leur agent, leurs modèles, un coût
// et leur bac.
//
// Les agents eux-mêmes sont des adaptateurs de banc : ces bancs prouvent la
// CHAÎNE (le script lit le `.env`, parle à la Reine, confie la mission, attend
// qu'elle soit réglée, relit et juge), pas qu'un vrai Claude écrit du code —
// c'est l'objet du script, lancé sur une ruche qui a de vrais agents.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterResult, AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import type { IsolementDeclare } from '../src/shared/types.js';

const JETON = 'jeton-preuve-v2-alpha-assez-long';
const SCRIPT = fileURLToPath(new URL('../scripts/preuve-v2-alpha.mjs', import.meta.url));
// Le bac tel que `bac.ts` l'aurait décidé avec podman (#458).
const PODMAN: IsolementDeclare = { niveau: 'conteneur', fournisseur: 'podman' };

let serveur: HiveServer | null = null;
const clients: HiveNodeClient[] = [];
let dossier = '';
// La Reine lit HIVE_GITHUB_TOKEN à sa création : un jeton présent dans
// l'environnement du développeur ne doit pas changer ce que ces bancs prouvent.
const jetonGithubAmbiant = process.env.HIVE_GITHUB_TOKEN;

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
  if (jetonGithubAmbiant === undefined) delete process.env.HIVE_GITHUB_TOKEN;
  else process.env.HIVE_GITHUB_TOKEN = jetonGithubAmbiant;
});

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await dormir(25);
  }
  throw new Error(message);
}

/** Lance le script dans son processus ; la Reine continue de servir pendant ce temps. */
function lancer(args: string[]): Promise<{ code: number; sortie: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { timeout: 90_000 }, (erreur, stdout, stderr) => {
      const code = erreur && typeof erreur.code === 'number' ? erreur.code : erreur ? 1 : 0;
      resolve({ code, sortie: `${stdout}${stderr}` });
    });
  });
}

/** Une Reine réelle sur un port libre, et le `.env` que le script lira. */
async function reine(): Promise<HiveServer> {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'preuve-v2-alpha-'));
  const s = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: JETON,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dossier, 'hive.db'),
    simulation: false,
    tickMs: 40,
  });
  serveur = s;
  writeFileSync(path.join(dossier, '.env'), `HIVE_PORT=${s.port}\nHIVE_TOKEN=${JETON}\n`);
  return s;
}

function ouvriere(s: HiveServer, nom: string, agentType: string, adapter: AgentAdapter): void {
  const client = new HiveNodeClient({
    url: `ws://127.0.0.1:${s.port}/ws`,
    token: JETON,
    name: nom,
    ownerName: 'banc',
    agentType,
    nodeId: `n-${nom}`,
    modeles: [`${agentType}-modele`],
    isolement: PODMAN,
    // Assez de place pour qu'une relecture ne soit jamais refusée par
    // saturation : remise en file, elle pourrait partir vers n'importe quel nœud.
    maxConcurrency: 4,
    workRoot: path.join(dossier, nom),
    adapter,
    quiet: true,
  });
  client.start();
  clients.push(client);
}

const diffDe = (fichier: string, ligne: string): string =>
  `--- /dev/null\n+++ b/${fichier}\n@@ -0,0 +1 @@\n+${ligne}\n`;

const rendu = (diff: string, logs = 'ok'): AdapterResult => ({
  success: true,
  diff,
  logs,
  subAgents: [],
  fournisseur: { source: 'claude-code', coutUsd: 0.0123, dureeApiMs: 1_500 },
});

const avis = (texte: string): AdapterResult => ({
  success: true,
  diff: '',
  logs: texte,
  subAgents: [],
});

const estRelecture = (titre: string): boolean => titre.startsWith('Contre-expertise —');

describe('la preuve V2 Alpha — le script, contre une vraie Reine', () => {
  it('SANS --oui RIEN N’EST CRÉÉ ; AVEC --oui LA MISSION EST CONFIÉE, RELUE ET JUGÉE', async () => {
    const s = await reine();
    ouvriere(s, 'poste-preuve', 'claude-code', {
      name: 'banc',
      async run() {
        await dormir(30);
        return rendu(diffDe('somme.mjs', 'export const somme = (a, b) => a + b;'));
      },
    });
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );

    const plan = await lancer(['--racine', dossier]);
    expect(plan.code, plan.sortie).toBe(0);
    expect(plan.sortie).toContain('1 ouvrière(s) réelle(s) — poste-preuve (claude-code)');
    expect(s.store.listProjects(), 'sans --oui, aucun projet créé').toHaveLength(0);

    const preuve = await lancer(['--racine', dossier, '--oui', '--exige-bac', '--patience', '30']);
    expect(preuve.code, preuve.sortie).toBe(0);
    expect(preuve.sortie).toMatch(/✔ A-agent\s+Agent réel — agent déclaré « claude-code »/);
    expect(preuve.sortie).toMatch(/✔ A-diff\s+Travail produit/);
    expect(preuve.sortie).toMatch(
      /✔ A-bac\s+Bac à sable — conteneur \(podman\), déclaré par le nœud/,
    );
    expect(preuve.sortie).toMatch(/✔ B\s+Coût fournisseur — 0\.0123 \$ déclarés par le CLI/);
    expect(preuve.sortie).toMatch(/✔ C\s+Latence ventilée — .*modèle 1\.5 s/);
    expect(preuve.sortie).toMatch(/✔ G\s+Routage expliqué — « claude-code-modele »/);
    expect(preuve.sortie).toMatch(
      /✔ E\s+Genome — 1 rendu\(s\) rangé\(s\) sous « claude-code-modele »/,
    );
    expect(preuve.sortie).toMatch(/\? Git\s+Livraison Git — sans --depot/);
    expect(preuve.sortie).toContain('✔ Mission réelle prouvée');
    expect(s.store.listProjects()).toHaveLength(1);
  });

  it(
    'LA PREUVE ATTEND LA CONTRE-REVUE : relue après le verdict, jamais au premier `done`',
    { timeout: 60_000 },
    async () => {
      // Deux familles : la production est relue par l'autre, et le verdict
      // arrive TARD. Lu au premier `done`, le rapport dirait « aucune
      // contre-visite » et prendrait une décision provisoire de l'Evaluator
      // pour un ✔.
      const s = await reine();
      const banc: AgentAdapter = {
        name: 'banc',
        async run(task) {
          if (estRelecture(task.title)) {
            await dormir(3_000);
            return avis('valide');
          }
          await dormir(30);
          return rendu(diffDe('somme.mjs', 'export const somme = (a, b) => a + b;'));
        },
      };
      ouvriere(s, 'poste-claude', 'claude-code', banc);
      ouvriere(s, 'poste-codex', 'codex', banc);
      await attendre(
        () => s.store.listNodes().filter((n) => n.status === 'online').length === 2,
        'les deux ouvrières ne rejoignent pas la ruche',
      );

      const preuve = await lancer(['--racine', dossier, '--oui', '--patience', '40']);
      expect(preuve.code, preuve.sortie).toBe(0);
      // Le verdict de la relectrice est dans le rapport : la preuve l'a attendu.
      expect(preuve.sortie).toMatch(/✔ F\s+Réputation par catégorie — \S+ 1 jugement\(s\)/);
      // Sans validation apportée, l'Evaluator ne peut pas accepter : ce n'est
      // pas un ✔, quelle que soit sa décision.
      expect(preuve.sortie).toMatch(/\? Evaluator\s+Évaluation — décision « /);
      expect(preuve.sortie).toContain('✔ Mission réelle prouvée');
    },
  );

  it(
    'L’ESSAIM : trois ouvrières de deux familles travaillent ensemble, délèguent, se relisent et se reprennent',
    { timeout: 90_000 },
    async () => {
      const s = await reine();
      const relues = new Map<string, number>();
      const banc: AgentAdapter = {
        name: 'banc',
        async run(task, ctx) {
          if (estRelecture(task.title)) {
            const vues = (relues.get(task.title) ?? 0) + 1;
            relues.set(task.title, vues);
            await dormir(150);
            // La PREMIÈRE relecture d'ajoute1 objecte : c'est le trajet
            // objection → retry de l'Evaluator → seconde production approuvée.
            return avis(
              task.title.endsWith('ajoute1') && vues === 1
                ? 'conteste\n- ajoute un test du cas négatif'
                : 'valide',
            );
          }
          const enfant = /childTaskId « ([^»]+) »/.exec(task.prompt)?.[1];
          if (task.title === 'Preuve V2 Alpha — délégation' && enfant) {
            const note = /`(delegation-[^`]+\.md)`/.exec(task.prompt)?.[1] ?? 'delegation.md';
            if (!ctx.delegate || !ctx.waitForDelegationResult) {
              return { success: false, diff: '', logs: 'délégation impossible', subAgents: [] };
            }
            const admise = await ctx.delegate({
              childTaskId: enfant,
              reason: 'prouver la délégation',
              title: 'Preuve V2 Alpha — double',
              prompt: 'Crée double.mjs et son test.',
              durationMs: 600_000,
              costMicros: 1_000_000,
              resourceUnits: 1,
            });
            if (!admise.ok) return { success: false, diff: '', logs: admise.code, subAgents: [] };
            const fin = await ctx.waitForDelegationResult(enfant);
            const issue = fin.ok && fin.success ? 'réussie' : 'échouée';
            return rendu(diffDe(note, `${enfant} ${issue}`));
          }
          if (task.title === 'Preuve V2 Alpha — double') {
            await dormir(100);
            return rendu(diffDe('double.mjs', 'export const double = (x) => 2 * x;'));
          }
          const k = /ajoute(\d+)$/.exec(task.title)?.[1] ?? '0';
          // Assez long pour que les productions se chevauchent.
          await dormir(600);
          return rendu(diffDe(`ajoute-${k}.mjs`, `export const ajoute${k} = (x) => x + ${k};`));
        },
      };
      ouvriere(s, 'alpha', 'claude-code', banc);
      ouvriere(s, 'beta', 'codex', banc);
      ouvriere(s, 'gamma', 'claude-code', banc);
      await attendre(
        () => s.store.listNodes().filter((n) => n.status === 'online').length === 3,
        'les trois ouvrières ne rejoignent pas la ruche',
      );

      const preuve = await lancer([
        '--racine',
        dossier,
        '--oui',
        '--workers',
        '3',
        '--exige-bac',
        '--patience',
        '60',
      ]);
      expect(preuve.code, preuve.sortie).toBe(0);
      expect(preuve.sortie).toContain('Preuve V2 Alpha — essaim de 3 ouvrières');
      expect(preuve.sortie).toMatch(
        /✔ Ouvrières\s+Ouvrières réelles — 3 ouvrière\(s\) réelle\(s\) de 2 famille\(s\)/,
      );
      expect(preuve.sortie).toMatch(
        /✔ Parallèle\s+Travail en parallèle — jusqu’à [23] ouvrières en même temps sur les tâches indépendantes/,
      );
      // Qui a rendu l'enfant est nommé, et OÙ par rapport au parent est dit :
      // l'Aiguillage peut le rendre à l'ouvrière du parent (la Reine ne
      // l'épingle pas), et c'est arrivé sur ce banc sous charge.
      expect(preuve.sortie).toMatch(
        /✔ Délégation\s+Délégation — « Preuve V2 Alpha — délégation » → v2a-\w+-double, rendue par (alpha|beta|gamma) \((claude-code|codex)\)(, sur l’ouvrière même de la tâche parente| pour (alpha|beta|gamma) \()/,
      );
      expect(preuve.sortie).toMatch(/✔ Relecture\s+Relecture croisée — /);
      expect(preuve.sortie).toMatch(
        /✔ Reprise\s+Reprise après objection — « Preuve V2 Alpha — ajoute1 » reprise après l’objection « ajoute un test du cas négatif »/,
      );
      expect(preuve.sortie).toMatch(/\? Git\s+Livraison Git/);
      expect(preuve.sortie).toContain('✔ Essaim prouvé');

      // Relue APRÈS la reprise : la Reine a bien deux productions d'ajoute1,
      // la seconde relue et approuvée.
      const ajoute1 = s.store.listTasks().find((t) => t.title === 'Preuve V2 Alpha — ajoute1');
      expect(ajoute1?.status).toBe('done');
      expect(s.store.resultsForTask(ajoute1?.id ?? '').filter((r) => r.success)).toHaveLength(2);
    },
  );

  it('MAL APPELÉ, IL LE DIT ET SORT EN 64 — un drapeau mal écrit compris', async () => {
    const r = await lancer([]);
    expect(r.code).toBe(64);
    expect(r.sortie).toContain('usage : npm run preuve:v2-alpha');

    const faute = await lancer(['--racine', '.', '--oui', '--exige-bacs']);
    expect(faute.code).toBe(64);
    expect(faute.sortie).toContain('argument inconnu : --exige-bacs');

    // Un dépôt que la Reine ne saurait pas livrer est une faute d'appel.
    const ssh = await lancer(['--racine', '.', '--depot', 'git@github.com:demo/hive.git']);
    expect(ssh.code).toBe(64);
    expect(ssh.sortie).toContain('--depot attend l’URL https d’un dépôt GitHub');
  });

  it('--depot SANS JETON GITHUB CÔTÉ REINE : REFUSÉ AVANT DE RIEN CRÉER', async () => {
    // Sans la sonde, la Reine aurait répondu 501 à la livraison — APRÈS la
    // mission, donc après avoir fait payer les agents.
    delete process.env.HIVE_GITHUB_TOKEN;
    const s = await reine();
    ouvriere(s, 'poste-depot', 'claude-code', {
      name: 'banc',
      async run() {
        return rendu(diffDe('somme.mjs', 'export const somme = (a, b) => a + b;'));
      },
    });
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );

    const r = await lancer([
      '--racine',
      dossier,
      '--oui',
      '--depot',
      'https://github.com/demo/hive.git',
    ]);
    expect(r.code, r.sortie).toBe(1);
    expect(r.sortie).toContain('--depot : la Reine n’a pas de jeton GitHub');
    expect(s.store.listProjects(), 'rien n’est créé').toHaveLength(0);
  });
});
