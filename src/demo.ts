// Démo `npm run demo` : orchestrateur + 2 nœuds simulés + un projet de
// 7 tâches avec dépendances, visibles en temps réel sur le Swarm View à
// http://localhost:7777.
//
// Persistance : l'état vit dans data/hive.db. Stoppez la démo (Ctrl+C) en
// pleine exécution puis relancez-la : le projet et son avancement sont
// toujours là, et les tâches orphelines reprennent proprement.
//
// Sécurité : mode simulation strictement local (adaptateur shell simulé,
// aucun processus lancé). Le token par défaut n'est toléré qu'ici.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HiveNodeClient } from './node-client/client.js';
import { createServer, loadConfigFromEnv } from './orchestrator/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // Pas de .env : défauts de la démo.
}

// ─── 1. Dashboard : construit à la volée s'il manque (premier lancement) ────
if (!existsSync(path.join(root, 'dashboard', 'dist', 'index.html'))) {
  console.log('🔨 Premier lancement : construction du dashboard (quelques secondes)…');
  const { build } = await import('vite');
  await build({ root: path.join(root, 'dashboard'), logLevel: 'warn' });
}

// ─── 2. Orchestrateur en mode simulation ─────────────────────────────────────
process.env.HIVE_SIMULATION = '1';
const config = loadConfigFromEnv();
config.simulation = true;
config.dbPath = process.env.HIVE_DB ?? path.join(root, 'data', 'hive.db');
const server = await createServer(config);

console.log('🐝 Hive — démo');
console.log(`   Swarm View : ${server.url}`);
console.log(`   Base       : ${config.dbPath}`);

// Les rappels console ne rejouent pas l'historique des exécutions précédentes.
let lastEventId = server.store.lastEventId();

// ─── 3. Projet de démo : repris s'il est en cours, recréé sinon ─────────────
const PROJECT_NAME = 'Démo Hive — mini SaaS';
let project = server.store.findProjectByName(PROJECT_NAME);
const existingTasks = project ? server.store.listTasks(project.id) : [];
const finished =
  existingTasks.length > 0 &&
  existingTasks.every((t) => t.status === 'done' || t.status === 'failed');

if (!project || existingTasks.length === 0 || finished) {
  project = server.store.createProject({
    name: PROJECT_NAME,
    description: 'Projet de démonstration : 7 tâches de construction d’un mini SaaS (DAG).',
  });
  server.store.appendEvent('project_created', { projectId: project.id, name: project.name });

  const ids = new Map<string, string>(); // clé logique → id réel
  const add = (key: string, title: string, prompt: string, deps: string[] = []): void => {
    const task = server.store.createTask({
      projectId: project!.id,
      title,
      prompt,
      dependsOn: deps.map((d) => ids.get(d) as string),
    });
    ids.set(key, task.id);
    server.store.appendEvent('task_created', { taskId: task.id, title });
  };

  add('t1', 'Échafauder le dépôt', 'Créer la structure du projet SaaS');
  add('t2', 'Schéma de base de données', 'Modéliser comptes, abonnements et factures', ['t1']);
  add('t3', "API d'authentification", 'Endpoints signup/login + sessions', ['t2']);
  // [flaky] : échoue à la 1re tentative pour démontrer le retry en direct.
  add('t4', 'API de facturation', '[flaky] Intégration paiement + webhooks', ['t2']);
  add('t5', 'Interface utilisateur', 'Dashboard client React', ['t1']);
  add('t6', "Tests d'intégration", 'Couvrir auth + facturation + UI', ['t3', 't4', 't5']);
  add('t7', 'Pipeline de déploiement', 'CI/CD et mise en production', ['t6']);

  console.log('📋 Projet créé : 7 tâches avec dépendances (t4 échouera une fois → retry visible).');
} else {
  const done = existingTasks.filter((t) => t.status === 'done').length;
  console.log(
    `📋 Reprise du projet en cours : ${done}/${existingTasks.length} tâches déjà terminées (persistance ✔).`,
  );
}
server.scheduler.tick();

// ─── 4. Deux nœuds membres rejoignent la ruche ───────────────────────────────
const nodes = [
  { name: 'ruche-alpha', owner: 'alice' },
  { name: 'ruche-beta', owner: 'bob' },
].map(
  ({ name, owner }) =>
    new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: config.token,
      name,
      ownerName: owner,
      agentType: 'shell',
      maxConcurrency: 2,
      nodeId: `demo-${name}`, // identité stable d'un lancement à l'autre
      workRoot: path.join(root, '.hive-work', name),
    }),
);
for (const n of nodes) n.start();

console.log('👀 Ouvrez le Swarm View, puis testez la persistance : Ctrl+C et relancez.\n');

// ─── 5. Rappels console (le Swarm View reste la vraie vitrine) ──────────────
const NOTABLE = new Set(['task_done', 'task_retry', 'task_failed', 'task_requeued']);
const reporter = setInterval(() => {
  for (const ev of server.store.listEvents(lastEventId, 500)) {
    lastEventId = ev.id;
    if (!NOTABLE.has(ev.type)) continue;
    const taskId = typeof ev.payload.taskId === 'string' ? ev.payload.taskId : '';
    const title = server.store.getTask(taskId)?.title ?? taskId.slice(0, 8);
    if (ev.type === 'task_done') console.log(`   🍯 terminé : ${title}`);
    if (ev.type === 'task_retry')
      console.log(`   🔁 échec de « ${title} », nouvel essai ${String(ev.payload.attempt)}/3`);
    if (ev.type === 'task_failed') console.log(`   ✘ échec définitif : ${title}`);
    if (ev.type === 'task_requeued') console.log(`   ↩ réaffectée : ${title}`);
  }

  const all = server.store.listTasks(project.id);
  if (all.length > 0 && all.every((t) => t.status === 'done')) {
    clearInterval(reporter);
    console.log(`\n🍯 Projet terminé : ${all.length}/${all.length} tâches butinées.`);
    console.log('   Le Swarm View reste ouvert — Ctrl+C pour arrêter la démo.');
  }
}, 1_000);

// ─── Arrêt propre ────────────────────────────────────────────────────────────
let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log('\nArrêt de la démo…');
  clearInterval(reporter);
  for (const n of nodes) n.stop();
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
