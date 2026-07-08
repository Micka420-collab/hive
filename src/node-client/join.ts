// `npm run join <invitation>` — la façon la plus simple de rejoindre une ruche.
//
// Un ami reçoit une invitation (une longue chaîne « hive1_… »). Il lance :
//     npm run join -- hive1_eyJ2Ijox...
// et c'est tout : le token et l'URL sont dans l'invitation, son agent IA
// (Claude Code / Codex) est détecté automatiquement, son identité de nœud est
// mémorisée pour les reconnexions. Aucun fichier de config à éditer.
//
// Sans argument, l'invitation est demandée de façon interactive.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { detectAllAgents, detectBestAgent } from './agent-detect.js';
import type { AgentType } from './agent-detect.js';
import { HiveNodeClient } from './client.js';
import { decodeInvite } from '../shared/invite.js';
import { ID_PATTERN } from '../shared/protocol.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de .env : tout vient de l'invitation et des valeurs par défaut.
}

/** Identité de nœud stable, mémorisée localement pour garder sa place à la reconnexion. */
function stableNodeId(workRoot: string): string {
  const file = path.join(workRoot, 'node-id.txt');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (ID_PATTERN.test(existing)) return existing;
  } catch {
    // premier lancement
  }
  const id = `node-${randomUUID()}`.slice(0, 64);
  try {
    mkdirSync(workRoot, { recursive: true });
    writeFileSync(file, id, 'utf8');
  } catch {
    // impossible d'écrire : on garde l'id en mémoire pour cette session
  }
  return id;
}

async function askInvite(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('🐝 Collez votre invitation Hive puis Entrée :\n> ')).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const raw =
    process.argv.slice(2).join(' ').trim() || process.env.HIVE_INVITE || (await askInvite());
  const invite = decodeInvite(raw);
  if (!invite) {
    console.error(
      '✘ Invitation invalide. Demandez à l’hôte de la ruche une nouvelle invitation\n' +
        '  (dans le dashboard : « Inviter un ami », ou `npm run cli -- invite`).',
    );
    process.exit(1);
  }

  // Le token de l'invitation sert aussi de garde-fou aux adaptateurs réels
  // (claude-code/codex refusent un token trivial) : on l'expose à l'environnement.
  process.env.HIVE_TOKEN = invite.token;

  // Choix de l'agent : HIVE_AGENT force le choix, sinon détection automatique.
  const forced = process.env.HIVE_AGENT as AgentType | undefined;
  const detected = forced ? { agent: forced, label: forced } : await detectBestAgent();
  const allAgents = await detectAllAgents();

  const workRoot = process.env.HIVE_WORKDIR ?? path.join('.hive-work', 'join');
  const maxConcurrency = clampConcurrency(process.env.HIVE_MAX_CONCURRENCY);
  const nodeId = stableNodeId(workRoot);

  const hasRealAgent = allAgents.some((a) => a !== 'shell');
  console.log(`\n🐝 Connexion à la ruche : ${invite.label ?? invite.url}`);
  console.log(`   Agents détectés : ${allAgents.join(', ')}`);
  console.log(`   Agent utilisé   : ${detected.label}`);
  if (detected.agent === 'shell' && !hasRealAgent) {
    console.log(
      '   ℹ Aucun agent IA détecté : mode « shell simulé » (sûr, sans exécution réelle).\n' +
        '     Installez Claude Code ou Codex, ou définissez HIVE_AGENT, pour du vrai travail.',
    );
  } else if (detected.agent === 'shell' && hasRealAgent) {
    console.log(
      '   ℹ Agent « shell simulé » forcé (HIVE_AGENT) alors que des agents réels sont disponibles.',
    );
  }

  const client = new HiveNodeClient({
    url: invite.url,
    token: invite.token,
    name: process.env.HIVE_NODE_NAME ?? os.hostname(),
    ownerName: process.env.HIVE_OWNER_NAME ?? os.userInfo().username,
    agentType: detected.agent,
    maxConcurrency,
    workRoot,
    nodeId,
  });

  client.start();
  console.log('\n✔ Nœud démarré — vous butinez pour la ruche. Ctrl+C pour quitter.\n');

  process.on('SIGINT', () => {
    console.log('\nDéconnexion de la ruche…');
    client.stop();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => console.error('[hive] exception non catchée :', err));
  process.on('unhandledRejection', (reason) => console.error('[hive] rejet non géré :', reason));
}

function clampConcurrency(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '2', 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), 16) : 2;
}

await main();
