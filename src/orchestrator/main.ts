// Point d'entrée de l'orchestrateur : `npm run dev`.

import { createServer, loadConfigFromEnv } from './server.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : les valeurs par défaut / variables d'environnement s'appliquent.
}

const config = loadConfigFromEnv();
const server = await createServer(config);

console.log('🐝 Hive — orchestrateur (Queen) en ligne');
console.log(`   Dashboard : ${server.url}`);
console.log(`   WebSocket : ws://${config.host}:${server.port}/ws`);
console.log(`   Base      : ${config.dbPath}`);
if (config.simulation) {
  console.log('   ⚠ Mode simulation actif (token par défaut toléré, démo locale uniquement).');
}

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} reçu, arrêt de l'orchestrateur…`);
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
