// Point d'entrée de l'orchestrateur : `npm run dev`.

// Statiques : ces modules n'ont aucune dépendance optionnelle (cf. plus bas).
import { annonceSimulation } from '../shared/annonce-simulation.js';
import type { AnnonceReine } from '../shared/demarrage.js';
import { chargerEnvQueen } from '../shared/env-queen.js';
import { adresseLocale } from '../shared/port.js';
import { lireConfianceProxy } from '../shared/proxy-confiance.js';

try {
  // Le `.env` du dossier, puis le fichier de clés de la Reine s'il est ailleurs
  // (`HIVE_ENV_FILE`, cf. `shared/env-queen.ts`).
  chargerEnvQueen(process.env, process.cwd());
} catch {
  // Fichier illisible : les valeurs par défaut / variables d'environnement s'appliquent.
}

// ─── UNE CONFIANCE REFUSÉE ARRÊTE LE DÉMARRAGE ───────────────────────────────
//
// `HIVE_TRUST_PROXY=true`, un nombre de sauts (`1`), une faute de frappe : la
// Reine n'accorde aucune de ces confiances (`shared/proxy-confiance.ts`). Elle
// démarrait quand même, avec une ligne ⚠ dans le journal — et derrière Caddy,
// tous les clients partageaient alors l'IP du proxy : débit REST, verrou des
// connexions ratées, plafond des sockets /ws anonymes. Un seul client bruyant
// bloquait tout le monde, et la seule trace était une ligne qu'on ne relit
// pas. Celui qui a écrit la variable voulait une confiance : on lui dit
// laquelle écrire, AVANT d'ouvrir le port.
const confianceProxy = lireConfianceProxy(process.env.HIVE_TRUST_PROXY);
if (confianceProxy.refus !== null) {
  // Écrit PUIS quitté : vers un tuyau (un service, un banc), l'écriture peut
  // être asynchrone, et `exit` immédiat perdrait la seule ligne qui explique.
  const message = `\n✘ L'orchestrateur ne démarre pas : ${confianceProxy.refus}\n\n`;
  await new Promise<void>((ecrit) => process.stderr.write(message, () => ecrit()));
  process.exit(2);
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
// L'adresse où SE CONNECTER, pas celle d'écoute : sur `HIVE_HOST=` vide ou
// `::`, le gabarit brut imprimait `ws://:7777/ws` — une URL que personne ne
// peut ouvrir. Même règle que celle que reçoivent les ouvrières du lanceur.
const adresse = adresseLocale(config.host, server.port);
console.log(`   Dashboard : ${adresse.http}`);
console.log(`   WebSocket : ${adresse.ws}`);
console.log(`   Base      : ${config.dbPath}`);
if (config.simulation) console.log(`   ${annonceSimulation(config.token)}`);
if (confianceProxy.valeur !== false) {
  console.log(`   IP client  : X-Forwarded-For cru depuis ${String(confianceProxy.valeur)}`);
}

// ─── LE LANCEUR DE LA RUCHE ATTEND CE FAIT ───────────────────────────────────
//
// `npm run ruche` ne démarre ses ouvrières et son écran qu'à cette annonce, et
// leur passe l'adresse qu'elle porte (`AnnonceReine`, `shared/demarrage.ts`).
// Sans elle, ils visaient `:7777` quel que soit le port ouvert ici — et sur
// `HIVE_PORT=0`, seul ce processus le connaît. Hors du lanceur, aucun canal
// IPC : `process.send` est absent, et rien n'est dit. Le rappel avale l'erreur
// d'un lanceur déjà parti : il n'y a plus personne à qui l'annoncer.
const annonce: AnnonceReine = { type: 'reine-en-ligne', hote: config.host, port: server.port };
process.send?.(annonce, undefined, undefined, () => undefined);

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
