// Point d'entrée d'un nœud membre : `npm run node`.
// Configuration par variables d'environnement (voir .env.example).
// Le membre garde le contrôle : rien ne s'exécute sans lancer ce client.

import os from 'node:os';
import { bornerConcurrence } from './identite-noeud.js';
import {
  agentCredentialEnv,
  detectAllAgents,
  detectBestAgent,
  messageAgent,
} from './agent-detect.js';
import type { AgentType } from './agent-detect.js';
import { libelleAgent } from '../shared/agent-libelle.js';
import { HiveNodeClient } from './client.js';
import { optionBac, preparerBac } from './bac.js';
import { parseModeles } from './modeles.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : les valeurs par défaut / variables d'environnement s'appliquent.
}

// La MÊME borne que l'autre porte (`join.ts`). Elle existait déjà et disait
// pourquoi : un `NaN` propagé jusqu'à la boucle de travail donnerait un nœud
// connecté qui n'accepte jamais rien, et l'invité verrait « ✔ Nœud démarré »
// sans qu'il ne se passe jamais rien. Cette porte-ci ne l'avait jamais reçue.
const maxConcurrency = bornerConcurrence(process.env.HIVE_MAX_CONCURRENCY);

// Les modèles déclarés par l'opérateur pour l'Aiguillage appris, sanitisés.
const modelesDeclares = parseModeles(process.env.HIVE_MODELES);

// L'agent réel doit retrouver sa config/clé API dans la sandbox ; on fusionne
// avec un éventuel HIVE_KEEP_ENV explicite. Le shell simulé ne reçoit rien.
const extraKeep = (process.env.HIVE_KEEP_ENV ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ─── L'isolement ───────────────────────────────────────────────────────────
//
// Décidé, annoncé et appliqué par `bac.ts`, qui sert AUSSI à `join.ts`. Le
// code vivait ici seul, et `join.ts` — le chemin des amis — n'en avait aucune
// copie : un nœud rejoint tournait toujours sans conteneur.
const bac = await preparerBac();
for (const l of bac.lignes) console.log(l);

if (bac.refuse) {
  console.error('✘ Ce nœud ne démarre pas.\n');
  // `bac.codeSortie`, jamais un `1` écrit à la main : un refus de sécurité a
  // son propre code, et c'est ce qui permet à un superviseur de s'arrêter au
  // lieu de relancer sans fin une machine qui ne pourra jamais travailler.
  process.exit(bac.codeSortie);
}

// ─── QUEL AGENT, ET POURQUOI CE N'EST PLUS « shell » PAR DÉFAUT ─────────────
//
// Cette ligne disait : `const agentType = process.env.HIVE_AGENT ?? 'shell'`.
//
// Conséquence mesurée : sur la machine de celui qui INSTALLE la ruche — donc
// le cas de tout le monde au premier essai — `npm run node` tournait en
// SIMULÉ. L'installeur n'écrit pas `HIVE_AGENT` dans `.env` ; rien ne venait
// donc jamais le mettre à autre chose, et un Claude Code parfaitement
// installé n'était jamais utilisé. La ruche avait l'air de travailler et
// rendait de faux diffs.
//
// Le plus révélateur : `join.ts` — le chemin de l'AMI qu'on invite — détecte
// automatiquement depuis toujours. L'invité avait donc un vrai agent, et
// l'hôte un simulacre. Exactement l'inverse de ce qu'on attend.
//
// La détection vient APRÈS le bac à sable : un nœud que l'isolement refuse
// n'a pas à sonder quoi que ce soit, et l'humain lit d'abord ce qui l'arrête.
//
// `HIVE_AGENT` garde le dernier mot : le forcer à `shell` reste la façon
// d'avoir un nœud de test qui n'exécute rien pour de vrai.
const forceAgent = (process.env.HIVE_AGENT ?? '').trim() as AgentType | '';
const detecte = forceAgent
  ? { agent: forceAgent, label: libelleAgent(forceAgent) }
  : await detectBestAgent();
const agentType: AgentType = detecte.agent;
const tousAgents = await detectAllAgents();

console.log(`   Agents détectés : ${tousAgents.map((a) => libelleAgent(a)).join(', ')}`);
console.log(`   Agent utilisé   : ${detecte.label}`);
// Le dire ICI, et pas seulement dans `hive doctor` : personne ne lance le
// docteur avant de voir sa ruche « travailler ». Un simulacre silencieux
// coûte une soirée à qui croit que ça tourne.
//
// Le CHOIX de la phrase vit dans `messageAgent`, pur et éprouvé : la loupe a
// montré qu'ici, inversé, rien ne rougissait.
const aDire = messageAgent(agentType, tousAgents);
if (aDire) console.log(aDire);

const variables = [...new Set([...agentCredentialEnv(agentType), ...extraKeep])];

const client = new HiveNodeClient({
  url: process.env.HIVE_URL ?? 'ws://localhost:7777/ws',
  token: process.env.HIVE_TOKEN ?? 'change-me',
  name: process.env.HIVE_NODE_NAME ?? os.hostname(),
  ownerName: process.env.HIVE_OWNER_NAME ?? os.userInfo().username,
  agentType,
  maxConcurrency: Number.isInteger(maxConcurrency) ? Math.min(Math.max(maxConcurrency, 1), 16) : 2,
  workRoot: process.env.HIVE_WORKDIR,
  keepEnv: variables,
  // Les modèles que l'opérateur déclare (HIVE_MODELES), pour l'Aiguillage appris.
  ...(modelesDeclares ? { modeles: modelesDeclares } : {}),
  ...optionBac(bac, variables),
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
