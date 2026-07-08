// Point d'entrée d'un nœud membre : `npm run node`.
// Configuration par variables d'environnement (voir .env.example).
// Le membre garde le contrôle : rien ne s'exécute sans lancer ce client.

import os from 'node:os';
import { HiveNodeClient } from './client.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : les valeurs par défaut / variables d'environnement s'appliquent.
}

const maxConcurrency = Number.parseInt(process.env.HIVE_MAX_CONCURRENCY ?? '2', 10);

const client = new HiveNodeClient({
  url: process.env.HIVE_URL ?? 'ws://localhost:7777/ws',
  token: process.env.HIVE_TOKEN ?? 'change-me',
  name: process.env.HIVE_NODE_NAME ?? os.hostname(),
  ownerName: process.env.HIVE_OWNER_NAME ?? os.userInfo().username,
  agentType: process.env.HIVE_AGENT ?? 'shell',
  maxConcurrency: Number.isInteger(maxConcurrency) ? Math.min(Math.max(maxConcurrency, 1), 16) : 2,
  workRoot: process.env.HIVE_WORKDIR,
  keepEnv: (process.env.HIVE_KEEP_ENV ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});

client.start();
console.log('🐝 Nœud Hive démarré — Ctrl+C pour quitter la ruche.');

process.on('SIGINT', () => {
  client.stop();
  process.exit(0);
});

// Dernier recours : un imprévu ne doit pas tuer le nœud en silence et perdre la
// reconnexion. On journalise et on laisse le client continuer/reconnecter.
process.on('uncaughtException', (err) => {
  console.error('[hive] exception non catchée (nœud) :', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[hive] rejet de promesse non géré (nœud) :', reason);
});
