// LA BOUCLE V3, LANCÉE POUR DE VRAI — `npm run boucle:v3` dans son propre
// processus, contre une vraie Reine et deux ouvrières de familles différentes.
//
// Ce que la ruche de laboratoire (`boucle-v3.test.ts`) ne peut pas prouver :
// le coureur lit le `.env` de la ruche, parle à ses vraies routes, et — sans
// `--oui`, ou quand le rapport de risques ne pourrait pas être joint — ne crée
// RIEN dans la vraie base : ni projet, ni tâche.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-boucle-v3-assez-long-42';
const JETON_GITHUB = 'jeton-github-boucle-v3-de-test';
const RACINE_DEPOT = fileURLToPath(new URL('..', import.meta.url));
const MISSION = 'Ajouter une ligne d’aide à la commande hive doctor';

let serveur: HiveServer | null = null;
const clients: HiveNodeClient[] = [];
let dossier = '';
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

/** Le coureur dans son processus, SANS le jeton GitHub de l'environnement du banc. */
function lancer(args: string[]): Promise<{ code: number; sortie: string }> {
  const env = { ...process.env };
  delete env.HIVE_GITHUB_TOKEN;
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['scripts/lancer.mjs', 'src/boucle-v3/main.ts', ...args],
      { cwd: RACINE_DEPOT, env, timeout: 90_000 },
      (erreur, stdout, stderr) => {
        const code = erreur && typeof erreur.code === 'number' ? erreur.code : erreur ? 1 : 0;
        resolve({ code, sortie: `${stdout}${stderr}` });
      },
    );
  });
}

/** Une Reine qui SAIT livrer (jeton GitHub) et deux ouvrières de familles distinctes. */
async function ruche(envRuche: string): Promise<HiveServer> {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'boucle-v3-'));
  process.env.HIVE_GITHUB_TOKEN = JETON_GITHUB;
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
  writeFileSync(
    path.join(dossier, '.env'),
    `HIVE_PORT=${s.port}\nHIVE_TOKEN=${JETON}\n${envRuche}`,
  );
  const inerte: AgentAdapter = {
    name: 'banc',
    async run() {
      throw new Error('la boucle ne devait rien confier');
    },
  };
  for (const agentType of ['claude-code', 'codex']) {
    const client = new HiveNodeClient({
      url: `ws://127.0.0.1:${s.port}/ws`,
      token: JETON,
      name: `poste-${agentType}`,
      ownerName: 'banc',
      agentType,
      nodeId: `n-${agentType}`,
      modeles: [`${agentType}-modele`],
      maxConcurrency: 1,
      workRoot: path.join(dossier, agentType),
      adapter: inerte,
      quiet: true,
    });
    client.start();
    clients.push(client);
  }
  const fin = Date.now() + 15_000;
  while (s.store.listNodes().filter((n) => n.status === 'online').length < 2) {
    if (Date.now() > fin) throw new Error('les ouvrières ne rejoignent pas la ruche');
    await dormir(25);
  }
  return s;
}

describe('la boucle V3 — le coureur, contre une vraie Reine', () => {
  it(
    'SANS --oui, RIEN N’EST CRÉÉ : la boucle lit la ruche et dit ce qu’elle ferait',
    { timeout: 60_000 },
    async () => {
      const s = await ruche(`HIVE_GITHUB_TOKEN=${JETON_GITHUB}\n`);
      const plan = await lancer(['--racine', dossier, '--mission', MISSION]);
      expect(plan.code, plan.sortie).toBe(0);
      expect(plan.sortie).toContain('prête : 2 ouvrière(s) réelle(s) de 2 famille(s)');
      expect(plan.sortie).toContain('Micka420-collab/hive');
      expect(plan.sortie).not.toContain(JETON_GITHUB);
      expect(s.store.listProjects(), 'sans --oui, aucun projet créé').toHaveLength(0);
      expect(s.store.listTasks(), 'sans --oui, aucune tâche créée').toHaveLength(0);
    },
  );

  it(
    'AVEC --oui MAIS SANS JETON POUR LE RAPPORT : refusé avant de rien créer',
    { timeout: 60_000 },
    async () => {
      const s = await ruche('');
      const r = await lancer(['--racine', dossier, '--mission', MISSION, '--oui']);
      expect(r.code, r.sortie).toBe(1);
      expect(r.sortie).toContain('rapport de risques');
      expect(s.store.listProjects()).toHaveLength(0);
      expect(s.store.listTasks()).toHaveLength(0);
    },
  );
});
