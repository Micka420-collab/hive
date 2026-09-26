// LA PREUVE V2 ALPHA, LANCÉE POUR DE VRAI — le script `preuve-v2-alpha.mjs`
// tourne dans son propre processus contre une vraie Reine, avec une vraie
// ouvrière (HiveNodeClient) qui déclare Claude Code, un modèle et un coût.
//
// L'agent lui-même est un adaptateur de banc : ce banc prouve la CHAÎNE (le
// script lit le `.env`, parle à la Reine, confie la mission, attend, relit et
// juge), pas qu'un vrai Claude écrit du code — c'est l'objet du script, lancé
// sur une ruche qui a un vrai agent.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-preuve-v2-alpha-assez-long';
const SCRIPT = fileURLToPath(new URL('../scripts/preuve-v2-alpha.mjs', import.meta.url));

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let dossier = '';

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
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

/** Lance le script dans son processus ; la Reine continue de servir pendant ce temps. */
function lancer(args: string[]): Promise<{ code: number; sortie: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { timeout: 60_000 }, (erreur, stdout, stderr) => {
      const code = erreur && typeof erreur.code === 'number' ? erreur.code : erreur ? 1 : 0;
      resolve({ code, sortie: `${stdout}${stderr}` });
    });
  });
}

describe('la preuve V2 Alpha — le script, contre une vraie Reine', () => {
  it('SANS --oui RIEN N’EST CRÉÉ ; AVEC --oui LA MISSION EST CONFIÉE, RELUE ET JUGÉE', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'preuve-v2-alpha-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${serveur.port}/ws`,
      token: JETON,
      name: 'poste-preuve',
      ownerName: 'banc',
      agentType: 'claude-code',
      modeles: ['sonnet'],
      // Le bac tel que `bac.ts` l'aurait décidé avec podman (#458).
      isolement: { niveau: 'conteneur', fournisseur: 'podman' },
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      adapter: {
        name: 'banc',
        async run() {
          await new Promise((r) => setTimeout(r, 30));
          return {
            success: true,
            diff: '--- /dev/null\n+++ b/somme.mjs\n@@ -0,0 +1 @@\n+export const somme = (a, b) => a + b;\n',
            logs: 'ok',
            subAgents: [],
            fournisseur: { source: 'claude-code', coutUsd: 0.0123, dureeApiMs: 1_500 },
          };
        },
      },
      quiet: true,
    });
    client.start();
    const s = serveur;
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    writeFileSync(path.join(dossier, '.env'), `HIVE_PORT=${s.port}\nHIVE_TOKEN=${JETON}\n`);

    const plan = await lancer(['--racine', dossier]);
    expect(plan.code, plan.sortie).toBe(0);
    expect(plan.sortie).toContain('1 ouvrière(s) réelle(s) — poste-preuve (claude-code)');
    expect(s.store.listProjects(), 'sans --oui, aucun projet créé').toHaveLength(0);

    const preuve = await lancer(['--racine', dossier, '--oui', '--patience', '30']);
    expect(preuve.code, preuve.sortie).toBe(0);
    expect(preuve.sortie).toMatch(/✔ A-agent\s+Agent réel — agent déclaré « claude-code »/);
    expect(preuve.sortie).toMatch(/✔ A-diff\s+Travail produit/);
    expect(preuve.sortie).toMatch(
      /✔ A-bac\s+Bac à sable — conteneur \(podman\), déclaré par le nœud/,
    );
    expect(preuve.sortie).toMatch(/✔ B\s+Coût fournisseur — 0\.0123 \$ déclarés par le CLI/);
    expect(preuve.sortie).toMatch(/✔ C\s+Latence ventilée — .*modèle 1\.5 s/);
    expect(preuve.sortie).toMatch(/✔ G\s+Routage expliqué — « sonnet »/);
    expect(preuve.sortie).toMatch(/✔ E\s+Genome — 1 rendu\(s\) rangé\(s\) sous « sonnet »/);
    expect(preuve.sortie).toContain('✔ Mission réelle prouvée');
    expect(s.store.listProjects()).toHaveLength(1);
  });

  it('MAL APPELÉ, IL LE DIT ET SORT EN 64', async () => {
    const r = await lancer([]);
    expect(r.code).toBe(64);
    expect(r.sortie).toContain('usage : npm run preuve:v2-alpha');
  });
});
