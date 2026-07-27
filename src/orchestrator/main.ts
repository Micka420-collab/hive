// Point d'entrée de l'orchestrateur : `npm run dev`.

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : les valeurs par défaut / variables d'environnement s'appliquent.
}

// ─── L'orchestrateur est chargé DYNAMIQUEMENT, et ce n'est pas un détail ─────
//
// Fastify et better-sqlite3 sont des `optionalDependencies` : un ami qui veut
// seulement prêter du temps-machine installe `hive` avec `--omit=optional` et
// obtient 2 Mo au lieu de 40 — il ne compile pas un moteur SQLite natif pour
// un serveur qu'il ne lancera jamais.
//
// La contrepartie, c'est qu'ils peuvent manquer. Un `import` statique donnerait
// alors un `ERR_MODULE_NOT_FOUND` brut, qui ne dit ni lequel manque, ni
// pourquoi, ni quoi taper. On charge donc à la demande, et on TRADUIT.
let createServer: typeof import('./server.js').createServer;
let loadConfigFromEnv: typeof import('./server.js').loadConfigFromEnv;
try {
  ({ createServer, loadConfigFromEnv } = await import('./server.js'));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const manquant = /Cannot find (?:module|package) '([^']+)'/.exec(message)?.[1];
  console.error(
    `\n✘ L'orchestrateur ne peut pas démarrer : ${manquant ?? 'une dépendance'} est absent.\n\n` +
      '  La ruche complète a besoin de dépendances que le nœud membre n’a pas.\n' +
      '  Réinstallez-les avec :\n\n' +
      '      npm install --include=optional\n\n' +
      '  (Un nœud qui prête seulement du temps-machine n’en a pas besoin :\n' +
      '   c’est pour lui qu’elles sont optionnelles.)\n',
  );
  process.exit(2);
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

// Dernier recours : une exception non catchée ne doit pas laisser la ruche dans
// un état incohérent silencieux. On journalise (les handlers WS/tick catchent
// déjà les erreurs SQLite courantes ; ceci couvre l'imprévu).
process.on('uncaughtException', (err) => {
  console.error('[hive] exception non catchée (orchestrateur) :', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[hive] rejet de promesse non géré (orchestrateur) :', reason);
});
