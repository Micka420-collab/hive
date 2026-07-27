// Point d'entrée d'un nœud membre : `npm run node`.
// Configuration par variables d'environnement (voir .env.example).
// Le membre garde le contrôle : rien ne s'exécute sans lancer ce client.

import os from 'node:os';
import { agentCredentialEnv } from './agent-detect.js';
import type { AgentType } from './agent-detect.js';
import { HiveNodeClient } from './client.js';
import { constat, decider, modeDepuisEnv, trouverFournisseur } from './isolement.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : les valeurs par défaut / variables d'environnement s'appliquent.
}

const maxConcurrency = Number.parseInt(process.env.HIVE_MAX_CONCURRENCY ?? '2', 10);
const agentType = (process.env.HIVE_AGENT ?? 'shell') as AgentType;

// L'agent réel doit retrouver sa config/clé API dans la sandbox ; on fusionne
// avec un éventuel HIVE_KEEP_ENV explicite. Le shell simulé ne reçoit rien.
const extraKeep = (process.env.HIVE_KEEP_ENV ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ─── L'isolement, décidé UNE FOIS au démarrage ─────────────────────────────
//
// Sonder un moteur de conteneurs coûte un `spawn` ; le faire par tâche
// coûterait un `spawn` de plus par butinage pour une réponse qui ne change
// pas. La décision est donc prise ici, dite à l'humain, et transmise telle
// quelle au client.
const modeIsolement = modeDepuisEnv();
const fournisseur = modeIsolement === 'off' ? null : await trouverFournisseur();
const decision = decider(modeIsolement, fournisseur);
const etat = constat(decision.niveau, fournisseur);

console.log(`\n🛡  Isolement : ${decision.motif}`);
if (etat.protege.length > 0) {
  console.log('   Protégé :');
  for (const l of etat.protege) console.log(`     ✔ ${l}`);
}
// TOUJOURS affiché, même au meilleur niveau : une interface qui dirait
// « isolé ✓ » sans dire ce qui passe encore ferait prendre un risque à
// quelqu'un qui croit ne pas en prendre.
console.log('   Passe quand même :');
for (const l of etat.laissePasser) console.log(`     • ${l}`);
console.log();

// FERMÉ PAR DÉFAUT en « exige » : mieux vaut un nœud qui ne prend pas de tâche
// qu'un nœud qui en prend une sans bac à sable en croyant le contraire.
if (decision.refuse) {
  console.error('✘ Ce nœud ne démarre pas.\n');
  process.exit(1);
}

const client = new HiveNodeClient({
  url: process.env.HIVE_URL ?? 'ws://localhost:7777/ws',
  token: process.env.HIVE_TOKEN ?? 'change-me',
  name: process.env.HIVE_NODE_NAME ?? os.hostname(),
  ownerName: process.env.HIVE_OWNER_NAME ?? os.userInfo().username,
  agentType,
  maxConcurrency: Number.isInteger(maxConcurrency) ? Math.min(Math.max(maxConcurrency, 1), 16) : 2,
  workRoot: process.env.HIVE_WORKDIR,
  keepEnv: [...new Set([...agentCredentialEnv(agentType), ...extraKeep])],
  ...(decision.isole && fournisseur
    ? {
        bac: {
          fournisseur,
          // Les MÊMES variables que la sandbox laisse passer : le bac ne doit
          // ni en ajouter (fuite) ni en retirer (agent non authentifié, donc
          // échec d'infrastructure en boucle).
          variables: [...new Set([...agentCredentialEnv(agentType), ...extraKeep])],
        },
      }
    : {}),
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
