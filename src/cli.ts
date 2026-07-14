// CLI Hive : piloter la ruche depuis le terminal via l'API REST.
//
// Usage :
//   npm run cli -- state                              état de la ruche
//   npm run cli -- project "Nom" [repoUrl]            créer un projet
//   npm run cli -- tasks <projectId> <fichier.json>   envoyer un lot de tâches
//   npm run cli -- watch <projectId>                  suivre l'avancement en direct
//   npm run cli -- cancel <taskId>                    annuler une tâche
//   npm run cli -- events [sinceId]                   journal d'événements
//
// Config : HIVE_HTTP (défaut http://localhost:7777) et HIVE_TOKEN (.env lu si présent).
// Format du fichier de tâches : [{ "id"?, "title", "prompt", "dependsOn"?: [] }, …]

import { readFileSync } from 'node:fs';
import type { HiveEvent, StateSnapshot, Task } from './shared/types.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de .env : défauts.
}

const BASE = process.env.HIVE_HTTP ?? 'http://localhost:7777';
const TOKEN = process.env.HIVE_TOKEN ?? 'change-me';

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
  }
  return (await res.json()) as T;
}

const BADGE: Record<string, string> = {
  pending: '·',
  ready: '◇',
  assigned: '◈',
  running: '▶',
  done: '✔',
  failed: '✘',
};

function printTasks(tasks: Task[]): void {
  for (const t of tasks) {
    const badge = BADGE[t.status] ?? '?';
    const tries = t.attempts > 0 ? ` (${t.attempts} tentative(s))` : '';
    console.log(`  ${badge} [${t.status.padEnd(8)}] ${t.title}${tries}  ${t.id}`);
  }
}

async function cmdState(): Promise<void> {
  const s = await api<StateSnapshot>('/api/state');
  console.log(
    `Projets : ${s.projects.length} · Nœuds : ${s.nodes.length} · Tâches : ${s.tasks.length}`,
  );
  for (const n of s.nodes) {
    console.log(`  🐝 ${n.name} — ${n.status} (${n.running}/${n.maxConcurrency}, ${n.agentType})`);
  }
  for (const p of s.projects) {
    const tasks = s.tasks.filter((t) => t.projectId === p.id);
    const done = tasks.filter((t) => t.status === 'done').length;
    console.log(`\n📋 ${p.name} — ${done}/${tasks.length}`);
    printTasks(tasks);
  }
}

async function cmdProject(name: string, repoUrl?: string): Promise<void> {
  const project = await api<{ id: string }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, ...(repoUrl ? { repoUrl } : {}) }),
  });
  console.log(`Projet créé : ${project.id}`);
  console.log(`Envoyez ses tâches : npm run cli -- tasks ${project.id} mes-taches.json`);
}

async function cmdTasks(projectId: string, file: string): Promise<void> {
  const tasks: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(tasks)) throw new Error('le fichier doit contenir un tableau de tâches');
  const created = await api<Task[]>(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
  console.log(`${created.length} tâche(s) créée(s) :`);
  printTasks(created);
}

async function cmdWatch(projectId: string): Promise<void> {
  // Suivi simple par polling : suffisant pour un terminal (le Swarm View reste
  // la vue temps réel de référence).
  for (;;) {
    const s = await api<StateSnapshot>('/api/state');
    const tasks = s.tasks.filter((t) => t.projectId === projectId);
    if (tasks.length === 0) throw new Error('projet inconnu ou sans tâches');
    const done = tasks.filter((t) => t.status === 'done').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    console.clear();
    console.log(`🐝 ${done}/${tasks.length} terminées${failed ? ` · ${failed} échouées` : ''}\n`);
    printTasks(tasks);
    if (done + failed === tasks.length) {
      console.log(failed === 0 ? '\n🍯 Tout est butiné !' : `\n⚠ Terminé avec ${failed} échec(s).`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function cmdCancel(taskId: string): Promise<void> {
  // Corps vide interdit avec content-type json : on envoie un objet vide.
  const task = await api<Task>(`/api/tasks/${taskId}/cancel`, { method: 'POST', body: '{}' });
  console.log(`Tâche annulée : ${task.title} → ${task.status}`);
}

async function cmdEvents(sinceId = '0'): Promise<void> {
  const events = await api<HiveEvent[]>(`/api/events?since=${Number(sinceId)}&limit=100`);
  for (const ev of events) {
    console.log(
      `  #${ev.id} ${new Date(ev.ts).toLocaleTimeString()} ${ev.type} ${JSON.stringify(ev.payload)}`,
    );
  }
}

interface InviteResponse {
  invite: string;
  url: string;
  label: string;
  joinCommand: string;
  note: string;
}

/** Génère une invitation à envoyer à un ami (URL éventuelle en 1er argument). */
async function cmdInvite(url?: string): Promise<void> {
  const query = url ? `?url=${encodeURIComponent(url)}` : '';
  const inv = await api<InviteResponse>(`/api/invite${query}`);
  console.log('\n🐝 Invitation à envoyer à votre ami (ruche : ' + inv.url + ')\n');
  console.log('  Étape 1 — il récupère Hive puis, dans le dossier :  npm install');
  console.log('  Étape 2 — il colle cette commande :\n');
  console.log('    ' + inv.joinCommand + '\n');
  console.log('  Son Claude Code / Codex est détecté automatiquement. C’est tout.');
  console.log('\n  ⚠ ' + inv.note);
  console.log(
    '  ⚠ Passer l’invitation en argument la laisse dans l’historique du shell et\n' +
      '    la rend visible aux autres comptes de la machine. Alternative plus discrète :\n' +
      '    l’ami lance `npm run join` seul, puis colle l’invitation quand elle est demandée.\n',
  );
}

async function cmdBrief(projectId: string, brief: string): Promise<void> {
  const result = await api<{ tasks: Task[]; rationale: string; model: string }>(
    `/api/projects/${projectId}/brief`,
    { method: 'POST', body: JSON.stringify({ brief }) },
  );
  console.log(`🐝 Queen Bee (${result.model}) — ${result.rationale}`);
  console.log(`\n${result.tasks.length} tâche(s) générée(s) :`);
  printTasks(result.tasks);
}

async function cmdMemory(projectId: string): Promise<void> {
  const mem = await api<{ total: number; recent: Array<{ id: number; kind: string; title: string; createdAt: number }> }>(
    `/api/projects/${projectId}/memory`,
  );
  console.log(`🧠 Hive Mind — ${mem.total} apprentissage(s) pour ce projet`);
  if (mem.recent.length === 0) {
    console.log('  (vide — les tâches terminées nourriront la mémoire automatiquement)');
    return;
  }
  for (const m of mem.recent) {
    const emoji = m.kind === 'pattern' ? '✅' : m.kind === 'lesson' ? '⚠️' : m.kind === 'snippet' ? '📋' : '📝';
    console.log(`  ${emoji} [${m.kind}] ${m.title}`);
  }
}

async function cmdMemorySearch(projectId: string, query: string): Promise<void> {
  const result = await api<{ query: string; count: number; results: Array<{ id: number; kind: string; title: string; content: string; rank: number }> }>(
    `/api/projects/${projectId}/memory/search?q=${encodeURIComponent(query)}&limit=10`,
  );
  console.log(`🧠 Recherche "${result.query}" — ${result.count} résultat(s)`);
  for (const m of result.results) {
    const emoji = m.kind === 'pattern' ? '✅' : m.kind === 'lesson' ? '⚠️' : m.kind === 'snippet' ? '📋' : '📝';
    console.log(`\n  ${emoji} ${m.title} (rank: ${m.rank.toFixed(1)})`);
    console.log(`  ${m.content.slice(0, 200)}`);
  }
}

const [cmd, a1, a2] = process.argv.slice(2);
try {
  if (cmd === 'state') await cmdState();
  else if (cmd === 'project' && a1) await cmdProject(a1, a2);
  else if (cmd === 'brief' && a1 && a2) await cmdBrief(a1, a2);
  else if (cmd === 'memory' && a1) await cmdMemory(a1);
  else if (cmd === 'memory-search' && a1 && a2) await cmdMemorySearch(a1, a2);
  else if (cmd === 'tasks' && a1 && a2) await cmdTasks(a1, a2);
  else if (cmd === 'watch' && a1) await cmdWatch(a1);
  else if (cmd === 'cancel' && a1) await cmdCancel(a1);
  else if (cmd === 'events') await cmdEvents(a1);
  else if (cmd === 'invite') await cmdInvite(a1);
  else {
    console.log(
      'Usage : npm run cli -- <state | project <nom> [repoUrl] | brief <projectId> "<brief>" | memory <projectId> | memory-search <projectId> "<query>" | tasks <projectId> <fichier.json> | watch <projectId> | cancel <taskId> | events [sinceId] | invite [urlWS]>',
    );
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
