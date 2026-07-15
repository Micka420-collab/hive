// CLI Hive : piloter la ruche depuis le terminal via l'API REST.
//
// Usage :
//   npm run cli -- state                              état de la ruche
//   npm run cli -- mind ["<requête>"]                 interroger la mémoire (Hive Mind)
//   npm run cli -- stings <projectId>                 conflits potentiels (Sting Detector)
//   npm run cli -- plan "<brief>" [mode]              proposer un DAG (Queen Bee)
//   npm run cli -- project "Nom" [repoUrl]            créer un projet
//   npm run cli -- tasks <projectId> <fichier.json>   envoyer un lot de tâches
//   npm run cli -- watch <projectId>                  suivre l'avancement en direct
//   npm run cli -- cancel <taskId>                    annuler une tâche
//   npm run cli -- events [sinceId]                   journal d'événements
//   npm run cli -- merge <projectId>                  plan d'intégration (Honeycomb Merge)
//   npm run cli -- merge-run <projectId> [cmd test…]  exécuter réellement le merge sur un nœud
//   npm run cli -- replay [sinceId]                   time-lapse (rejeu du journal)
//   npm run cli -- waggle                             classement des contributeurs (nectar)
//   npm run cli -- consensus <taskId>                 vote des agents sur le résultat
//   npm run cli -- ghost                              anomalies (nœuds/tâches douteux)
//   npm run cli -- shift                              disponibilité heures creuses (HIVE_SHIFT, local)
//   npm run cli -- pulse                              signes vitaux de la ruche
//   npm run cli -- report <projectId>                 avancement d'un projet
//   npm run cli -- ask "<question>" [projectId]       parler à la Reine (état réel de la ruche)
//   npm run cli -- race <taskId> [facteur]            Drone Wars : course compétitive (2-5 nœuds)
//
// Config : HIVE_HTTP (défaut http://localhost:7777) et HIVE_TOKEN (.env lu si présent).
// Format du fichier de tâches : [{ "id"?, "title", "prompt", "dependsOn"?: [] }, …]

import { readFileSync } from 'node:fs';
import type { GhostReport } from './orchestrator/ghost.js';
import type { Verdict } from './orchestrator/parliament.js';
import type { ProjectReport } from './orchestrator/project-report.js';
import type { HivePulse } from './orchestrator/pulse.js';
import type { ReplayResult, TaskCounts } from './orchestrator/replay.js';
import type { WaggleBoard } from './orchestrator/waggle.js';
import {
  formatWindow,
  isOnShift,
  minutesUntilOpen,
  nightShiftFromEnv,
} from './shared/night-shift.js';
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

interface HiveMemory {
  id: number;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
  score: number | null;
}

/** Interroge la mémoire partagée (Hive Mind). Sans requête : souvenirs récents. */
async function cmdMind(query?: string): Promise<void> {
  const qs = query ? `?q=${encodeURIComponent(query)}&limit=8` : '?limit=10';
  const res = await api<{ total: number; memories: HiveMemory[] }>(`/api/hive-mind${qs}`);
  console.log(
    `\n🧠 Hive Mind — ${res.total} souvenir(s)${query ? ` · requête « ${query} »` : ''}\n`,
  );
  if (res.memories.length === 0) {
    console.log('  (aucun souvenir — la mémoire se remplit quand des tâches réussissent)');
    return;
  }
  for (const m of res.memories) {
    const score = m.score !== null ? `  [${m.score}]` : '';
    console.log(`  • ${m.title}${score}`);
    console.log(`    ${m.content.slice(0, 160)}`);
  }
}

interface Conflict {
  a: string;
  b: string;
  severity: 'high' | 'low';
  sharedPaths: string[];
  sharedTerms: string[];
}

/** Liste les conflits potentiels d'un projet (Sting Detector). */
async function cmdStings(projectId: string): Promise<void> {
  const res = await api<{ conflicts: Conflict[] }>(`/api/projects/${projectId}/conflicts`);
  console.log(`\n🐝 Sting Detector — ${res.conflicts.length} conflit(s) potentiel(s)\n`);
  if (res.conflicts.length === 0) {
    console.log('  (aucun conflit détecté)');
    return;
  }
  for (const c of res.conflicts) {
    const badge = c.severity === 'high' ? '⚠ FORT ' : '· faible';
    const detail = c.sharedPaths.length
      ? `fichiers : ${c.sharedPaths.join(', ')}`
      : `termes : ${c.sharedTerms.slice(0, 5).join(', ')}`;
    console.log(`  ${badge}  ${c.a} ↔ ${c.b}  (${detail})`);
  }
}

interface PlannedTaskLike {
  id: string;
  title: string;
  prompt: string;
  dependsOn: string[];
}

/**
 * Queen Bee (Palier 2) : propose un DAG à partir d'un brief. La sortie est
 * imprimée pour revue (arbre + JSON) — à enregistrer puis envoyer via `tasks`.
 */
async function cmdPlan(brief: string, mode?: string): Promise<void> {
  const m = mode === 'heuristic' || mode === 'llm' ? mode : 'auto';
  const res = await api<{ tasks: PlannedTaskLike[]; source: string; note?: string }>('/api/plan', {
    method: 'POST',
    body: JSON.stringify({ brief, mode: m }),
  });
  const origin = res.source === 'llm' ? '✨ IA' : '🐝 heuristique';
  console.log(
    `\n${origin} — ${res.tasks.length} tâche(s) proposée(s)${res.note ? `\n(${res.note})` : ''}\n`,
  );
  for (const t of res.tasks) {
    const deps = t.dependsOn.length ? `  ← ${t.dependsOn.join(', ')}` : '';
    console.log(`  ◇ ${t.title}  [${t.id}]${deps}`);
  }
  console.log(
    '\nJSON (enregistrez-le, ajustez, puis : npm run cli -- tasks <projectId> ce-fichier.json) :\n',
  );
  console.log(JSON.stringify(res.tasks, null, 2));
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

interface MergePlan {
  total: number;
  done: number;
  order: string[];
  conflicts: { a: string; b: string; file: string }[];
  mergeable: boolean;
}

/** Affiche le plan d'intégration d'un projet (Honeycomb Merge). */
async function cmdMerge(projectId: string): Promise<void> {
  const plan = await api<MergePlan>(`/api/projects/${projectId}/merge`);
  const verdict = plan.mergeable
    ? '🍯 intégrable (toutes les tâches terminées, aucun conflit)'
    : plan.conflicts.length
      ? `⚠ ${plan.conflicts.length} conflit(s) de merge`
      : `⏳ ${plan.done}/${plan.total} tâches terminées`;
  console.log(`\n🐝 Honeycomb Merge — ${verdict}\n`);
  if (plan.order.length) {
    console.log(`  Ordre de merge : ${plan.order.join(' → ')}`);
  }
  for (const c of plan.conflicts) {
    console.log(`  ⚠ ${c.a} ↔ ${c.b} : ${c.file}`);
  }
  console.log('\n  (Analyse advisory : ni merge git ni exécution de tests — différés côté nœud.)');
  console.log(
    '  Exécuter réellement : npm run cli -- merge-run ' + projectId + ' [-- cmd de test]',
  );
}

interface MergeResult {
  mergeId: string;
  applied: string[];
  conflicts: { taskId: string; reason: string }[];
  testsRun: boolean;
  testsPassed: boolean | null;
}

/** Déclenche l'exécution réelle du merge sur un nœud, puis attend le résultat. */
async function cmdMergeRun(projectId: string, testCmd: string[]): Promise<void> {
  const body = testCmd.length ? { testCommand: testCmd } : {};
  const run = await api<{ mergeId: string; nodeId: string; order: string[] }>(
    `/api/projects/${projectId}/merge/run`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  console.log(
    `\n🐝 Merge lancé (${run.mergeId.slice(0, 8)}…) sur ${run.nodeId.slice(0, 8)}… — ordre : ${run.order.join(' → ')}`,
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { result } = await api<{ result: MergeResult | null }>(
      `/api/projects/${projectId}/merge/result`,
    );
    if (result && result.mergeId === run.mergeId) {
      const verdict = result.conflicts.length
        ? `⚠ ${result.conflicts.length} conflit(s)`
        : result.testsRun
          ? result.testsPassed
            ? '✔ tests OK'
            : '✘ tests échoués'
          : '✔ appliqué (sans tests)';
      console.log(`  ${verdict} — ${result.applied.length} diff(s) appliqué(s)`);
      for (const c of result.conflicts) console.log(`  ⚠ ${c.taskId} : ${c.reason}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  console.log('  (timeout — résultat non revenu ; réessayez `merge-run` ou vérifiez le nœud.)');
}

/** Barre compacte des tâches par statut, réutilisant les badges d'affichage. */
function taskBar(tasks: TaskCounts): string {
  return Object.entries(BADGE)
    .map(([status, badge]) => `${badge}${tasks[status as keyof TaskCounts] ?? 0}`)
    .join(' ');
}

/** Time-Lapse Replay : rejoue le journal en frise chronologique dans le terminal. */
async function cmdReplay(sinceId = '0'): Promise<void> {
  const r = await api<ReplayResult>(`/api/replay?since=${Number(sinceId)}`);
  if (r.eventCount === 0) {
    console.log('Journal vide : rien à rejouer.');
    return;
  }
  console.log(`⏱  Time-Lapse : ${r.eventCount} événement(s), jusqu'à #${r.lastEventId}\n`);
  for (const f of r.frames) {
    console.log(
      `  #${String(f.eventId).padStart(4)} ${new Date(f.ts).toLocaleTimeString()} ` +
        `${f.type.padEnd(16)} P${f.projects} N${f.nodesOnline}/${f.nodesTotal}  ${taskBar(f.tasks)}`,
    );
  }
  if (r.finalCounts) console.log(`\n🍯 État final : ${taskBar(r.finalCounts.tasks)}`);
}

/** Waggle Board : classement des nœuds par contribution (nectar). */
async function cmdWaggle(): Promise<void> {
  const board = await api<WaggleBoard>('/api/waggle');
  if (board.nodes.length === 0) {
    console.log('Aucune contribution encore : la danse frétillante attend le premier nectar.');
    return;
  }
  console.log(
    `🍯 Waggle Board — ${board.totalTasksDone} tâche(s) butinée(s), ${board.totalTasksFailed} échec(s)\n`,
  );
  const medals = ['🥇', '🥈', '🥉'];
  board.nodes.forEach((n, i) => {
    const rank = medals[i] ?? `${i + 1}.`;
    const rate = `${Math.round(n.successRate * 100)}%`;
    const avg = n.avgDurationMs > 0 ? `${(n.avgDurationMs / 1000).toFixed(1)}s/tâche` : '—';
    console.log(
      `  ${rank} ${n.name} [${n.agentType}] — ${n.score} nectar ` +
        `(✔${n.tasksDone} ✘${n.tasksFailed}, ${rate}, ${avg})`,
    );
  });
}

/** Parlement des Agents : consensus par vote sur les résultats d'une tâche. */
async function cmdConsensus(taskId: string): Promise<void> {
  const v = await api<Verdict>(`/api/tasks/${taskId}/consensus`);
  const verdict: Record<string, string> = {
    elected: '✅ consensus atteint',
    no_quorum: `⚠ pas de consensus (quorum ${v.quorum})`,
    no_ballots: '∅ aucun résultat valide à départager',
  };
  console.log(`🏛  Parlement — ${verdict[v.outcome] ?? v.outcome}\n`);
  v.factions.forEach((f, i) => {
    const crown = v.winner && f.signature === v.winner.signature ? '👑 ' : '   ';
    console.log(
      `${crown}#${i + 1} sig ${f.signature} — ${f.votes} voix ` +
        `(${f.diversity} type(s) : ${f.agentTypes.join(', ')})`,
    );
  });
}

/** Ghost in the Hive : rapport d'anomalies (nœuds/tâches douteux). */
async function cmdGhost(): Promise<void> {
  const report = await api<GhostReport>('/api/ghost');
  const { events, nodes, tasks } = report.scanned;
  if (report.ghosts.length === 0) {
    console.log(`👻 Aucune anomalie (${events} événements, ${nodes} nœuds, ${tasks} tâches).`);
    return;
  }
  const icon: Record<string, string> = { high: '🔴', medium: '🟠', low: '🟡' };
  console.log(`👻 ${report.ghosts.length} anomalie(s) détectée(s) :\n`);
  for (const g of report.ghosts) {
    console.log(`  ${icon[g.severity] ?? '•'} [${g.kind}] ${g.target} — ${g.detail}`);
  }
}

/**
 * Night Shift : évalue LOCALEMENT la disponibilité du nœud d'après HIVE_SHIFT et
 * l'heure de la machine (aucun appel réseau — c'est une préférence du membre).
 */
function cmdShift(): void {
  const policy = nightShiftFromEnv();
  if (policy.windows.length === 0) {
    console.log('🌞 Disponibilité 24h/24 (HIVE_SHIFT non défini).');
    return;
  }
  const now = new Date();
  console.log(`🌙 Night Shift : ${policy.windows.map(formatWindow).join(', ')}`);
  if (isOnShift(policy, now)) {
    console.log('  ✅ De service maintenant : le nœud accepte du travail.');
  } else {
    const mins = minutesUntilOpen(policy, now);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    console.log(`  ⏾ Hors service. Prochaine ouverture dans ${h}h${String(m).padStart(2, '0')}.`);
  }
}

/** Hive Pulse : signes vitaux agrégés de la ruche. */
async function cmdPulse(): Promise<void> {
  const p = await api<HivePulse>('/api/pulse');
  const ms = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);
  console.log('💓 Hive Pulse');
  console.log(
    `  Tâches : ✔${p.totalDone} ✘${p.totalFailed} — succès ${Math.round(p.successRate * 100)}% · nœuds actifs ${p.activeNodes}`,
  );
  console.log(
    `  Latence : p50 ${ms(p.latency.p50)} · p95 ${ms(p.latency.p95)} · max ${ms(p.latency.max)} (n=${p.latency.count})`,
  );
  // Mini-histogramme du débit horaire (dernières tranches).
  const bars = ' ▁▂▃▄▅▆▇█';
  const peak = Math.max(1, ...p.throughput.map((b) => b.done + b.failed));
  const spark = p.throughput
    .slice(-24)
    .map((b) => bars[Math.min(8, Math.round(((b.done + b.failed) / peak) * 8))])
    .join('');
  if (spark) console.log(`  Débit/h : ${spark}`);
}

/** Rapport d'avancement d'un projet. */
async function cmdReport(projectId: string): Promise<void> {
  const r = await api<ProjectReport>(`/api/projects/${projectId}/report`);
  const filled = Math.round((r.progressPct / 100) * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  console.log(`📋 ${r.name} — ${bar} ${r.progressPct}%${r.complete ? ' ✅' : ''}`);
  console.log(
    `  ${r.total} tâche(s) : ✔${r.byStatus.done} ▶${r.byStatus.running} ◈${r.byStatus.assigned} ` +
      `◇${r.byStatus.ready} ·${r.byStatus.pending} ✘${r.byStatus.failed}`,
  );
  console.log(
    `  Nœuds contributeurs : ${r.contributingNodes.length || '—'} · tentatives cumulées : ${r.totalAttempts}`,
  );
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

/** Parler à la Reine : question en langage naturel, réponse depuis l'état réel. */
async function cmdAsk(question: string, projectId?: string): Promise<void> {
  const res = await api<{ reply: string; source: 'live' | 'llm'; suggestions: string[] }>(
    '/api/chat',
    {
      method: 'POST',
      body: JSON.stringify({ message: question, ...(projectId ? { projectId } : {}) }),
    },
  );
  const badge = res.source === 'llm' ? '✨ IA' : '📡 état réel';
  console.log(`\n👑 La Reine (${badge}) :\n`);
  console.log(res.reply.replace(/^/gm, '  '));
  if (res.suggestions.length > 0) {
    console.log(`\n  💡 À demander ensuite : ${res.suggestions.join(' · ')}`);
  }
}

/** Drone Wars : lance une course compétitive sur une tâche prête. */
async function cmdRace(taskId: string, factor?: string): Promise<void> {
  const body = factor ? { factor: Number(factor) } : {};
  const res = await api<{ taskId: string; drones: string[] }>(`/api/tasks/${taskId}/race`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  console.log(`\n⚔ Course lancée : ${res.drones.length} drone(s) sur la tâche ${res.taskId}`);
  for (const d of res.drones) console.log(`  🛸 ${d.slice(0, 8)}…`);
  console.log('  Le premier succès gagne — les perdants seront annulés automatiquement.');
}

const [cmd, a1, a2] = process.argv.slice(2);
try {
  if (cmd === 'state') await cmdState();
  else if (cmd === 'mind') await cmdMind(a1);
  else if (cmd === 'stings' && a1) await cmdStings(a1);
  else if (cmd === 'plan' && a1) await cmdPlan(a1, a2);
  else if (cmd === 'project' && a1) await cmdProject(a1, a2);
  else if (cmd === 'brief' && a1 && a2) await cmdBrief(a1, a2);
  else if (cmd === 'tasks' && a1 && a2) await cmdTasks(a1, a2);
  else if (cmd === 'watch' && a1) await cmdWatch(a1);
  else if (cmd === 'cancel' && a1) await cmdCancel(a1);
  else if (cmd === 'events') await cmdEvents(a1);
  else if (cmd === 'merge' && a1) await cmdMerge(a1);
  else if (cmd === 'merge-run' && a1) await cmdMergeRun(a1, process.argv.slice(4));
  else if (cmd === 'replay') await cmdReplay(a1);
  else if (cmd === 'waggle') await cmdWaggle();
  else if (cmd === 'consensus' && a1) await cmdConsensus(a1);
  else if (cmd === 'ghost') await cmdGhost();
  else if (cmd === 'shift') cmdShift();
  else if (cmd === 'pulse') await cmdPulse();
  else if (cmd === 'report' && a1) await cmdReport(a1);
  else if (cmd === 'ask' && a1) await cmdAsk(a1, a2);
  else if (cmd === 'race' && a1) await cmdRace(a1, a2);
  else if (cmd === 'invite') await cmdInvite(a1);
  else {
    console.log(
      'Usage : npm run cli -- <state | mind ["<requête>"] | stings <projectId> | plan "<brief>" [heuristic|llm] | brief <projectId> "<brief>" | project <nom> [repoUrl] | tasks <projectId> <fichier.json> | watch <projectId> | cancel <taskId> | events [sinceId] | merge <projectId> | merge-run <projectId> [cmd test…] | replay [sinceId] | waggle | consensus <taskId> | ghost | shift | pulse | report <projectId> | ask "<question>" [projectId] | race <taskId> [facteur] | invite [urlWS]>',
    );
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
