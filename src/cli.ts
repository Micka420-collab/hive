// CLI Hive : piloter la ruche depuis le terminal via l'API REST.
//
// Usage :
//   npm run cli -- state                              état de la ruche
//   npm run cli -- mind ["<requête>"]                  interroger la mémoire (Hive Mind)
//   npm run cli -- strings <projectId>                 conflits potentiels (String Detector)
//   npm run cli -- plan "<brief>" [mode]               proposer un DAG (Queen Bee)
//   npm run cli -- project "Nom" [repoUrl]             créer un projet
//   npm run cli -- tasks <projectId> <fichier.json>    envoyer un lot de tâches
//   npm run cli -- watch <projectId>                    suivre l'avancement en direct
//   npm run cli -- cancel <taskId>                      annuler une tâche
//   npm run cli -- events [sinceId]                     journal d'événements
//   npm run cli -- merge <projectId>                    plan d'intégration (Honeycomb Merge)
//   npm run cli -- merge-run <projectId> [args...]      exécuter réellement le merge sur un nœud
//   npm run cli -- replay [sinceId]                     time-lapse (rejeu du journal)
//   npm run cli -- waggle                               classement des contributeurs (nectar)
//   npm run cli -- consensus <taskId>                   vote des agents sur le résultat
//   npm run cli -- doctor [chemin] [--json]            diagnostic local : 11 causes de panne
//   npm run cli -- ghost                                anomalies (nœuds/tâches doutées)
//   npm run cli -- shift                                disponibilité heures creuses (HIVE_SHIFT, local)
//   npm run cli -- pulse                                 signes vitaux de la ruche
//   npm run cli -- report <projectId>                   avancement d'un projet
//   npm run cli -- ask "<question>" [projectId]         parler à la Reine (état réel de la ruche)
//   npm run cli -- race <taskId> [facteur]              Drone Wars : course compétitive (2-5 nœuds)
//   npm run cli -- races                                 Drone Wars : courses en vol
//
// Config : HIVE_HTTP (défaut http://localhost:7777) et HIVE_TOKEN (.env lu si présent).
// Format du fichier de tâches : [{ "id?", "title", "prompt", "dependsOn"?: [], }, …]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GhostReport } from './orchestrator/ghost.js';
import type { Verdict } from './orchestrator/parliament.js';
import type { ProjectReport } from './orchestrator/project-report.js';
import type { HivePulse } from './orchestrator/pulse.js';
import type { ReplayResult, TaskCounts } from './orchestrator/replay.js';
import type { DroneRace } from './orchestrator/drone-wars.js';
import type { WaggleBoard } from './orchestrator/waggle.js';
import {
  formatWindow,
  isOnShift,
  minutesUntilOpen,
  nightShiftFromEnv,
} from './shared/night-shift.js';
import { decouperMergeArgv } from './shared/preparation.js';
import type { HiveEvent, StateSnapshot, Task } from './shared/types.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de .env : défauts.
}

import {
  FOURNISSEURS,
  ouvrirTunnel,
  trouverFournisseur,
  urlRucheDepuisTunnel,
} from './node-client/tunnel.js';
import {
  diagnosticContenu,
  enTeteAttendu,
  enTeteValide,
  estArchive,
  etapesTunnelNomme,
  hoteValide,
  methodesInstallation,
  urlStable,
  urlTelechargement,
} from './node-client/cloudflare.js';

const BASE = process.env.HIVE_HTTP ?? 'http://localhost:7777';
const TOKEN = process.env.HIVE_TOKEN ?? 'change-me';

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  // `content-type: application/json` semble quand il Y A un corps : l'annonce
  // sur une requête vide (un DELETE, typiquement) est incorrecte, et faisait
  // refuser la requête côté serveur avant même d'atteindre la route.
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-hive-token': TOKEN,
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
  }
  return (await res.json()) as T;
}

const BADGE: Record<string, string> = {
  pending: '◷',
  ready: '◇',
  assigned: '◆',
  running: '⇶',
  done: '✓',
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
    console.log(`\n🍯 ${p.name} — ${done}/${tasks.length}`);
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

/** Interroger la mémoire partagée (Hive Mind). Sans requête : souvenirs récents. */
async function cmdMind(query?: string): Promise<void> {
  const qs = query ? `?q=${encodeURIComponent(query)}&limit=8` : '?limit=10';
  const res = await api<{ total: number; memories: HiveMemory[] }>(`/api/hive-mind${qs}`);
  console.log(
    `\n🐝 Hive Mind — ${res.total} souvenir(s)${query ? ` · requête « ${query} »` : ''}\n`,
  );
  if (res.memories.length === 0) {
    console.log('  (aucun souvenir — la mémoire se remplit quand des tâches réussissent)');
    return;
  }
  for (const m of res.memories) {
    const score = m.score !== null ? `  [${m.score}]` : '';
    console.log(`  ◇ ${m.title}${score}`);
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

/** Liste les conflits potentiels d'un projet (String Detector). */
async function cmdStings(projectId: string): Promise<void> {
  const res = await api<{ conflicts: Conflict[] }>(`/api/projects/${projectId}/conflicts`);
  console.log(`\n⚠️ Sting Detector — ${res.conflicts.length} conflit(s) potentiel(s)\n`);
  if (res.conflicts.length === 0) {
    console.log('  (aucun conflit détecté)');
    return;
  }
  for (const c of res.conflicts) {
    const badge = c.severity === 'high' ? '⛔ FORTE ' : '· faible';
    const detail = c.sharedPaths.length
      ? `fichiers : ${c.sharedPaths.join(', ')}`
      : `termes : ${c.sharedTerms.slice(0, 5).join(', ')}`;
    console.log(`  ${badge} ${c.a} ⇄ ${c.b}  (${detail})`);
  }
}

interface PlannedTaskLike {
  id: string;
  title: string;
  prompt: string;
  dependsOn: string[];
}

/**
 * Queen Bee (Palier 2) : proposer un DAG à partir d'un brief. La sortie est
 * imprimée pour enregistrement (arbre + JSON), on n'enregistre pus via `tasks`.
 */
async function cmdPlan(brief: string, mode?: string): Promise<void> {
  const m = mode === 'heuristic' || mode === 'llm' ? mode : 'auto';
  const res = await api<{ tasks: PlannedTaskLike[]; source: string; note?: string }>(
    '/api/plan',
    {
      method: 'POST',
      body: JSON.stringify({ brief, mode: m }),
    },
  );
  const origin = res.source === 'llm' ? '✨ IA' : '⚡ heuristique';
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
  console.log(`Envoyez vos tâches : npm run cli -- tasks ${project.id} mes-taches.json`);
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
      console.log(failed === 0 ? '\n🎉 Tout est terminé !' : `\n⛔ Terminé avec ${failed} échec(s).`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function cmdCancel(taskId: string): Promise<void> {
  // Corps vide interdit avec content-type json : on envoie un objet vide.
  const task = await api<Task>(`/api/tasks/${taskId}/cancel`, { method: 'POST', body: '{}' });
  console.log(`Tâche annulée : ${task.title} ⇄ ${task.status}`);
}

async function cmdEvents(sinceId = '0'): Promise<void> {
  const since = Number(sinceId);
  if (!Number.isInteger(since) || since < 0) {
    console.error(`sinceId invalide : « ${sinceId} » (entier ≥ 0 attendu)`);
    process.exitCode = 1;
    return;
  }
  const events = await api<HiveEvent[]>(`/api/events?since=${since}&limit=100`);
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

/** Afficher le plan d'intégration d'un projet (Honeycomb Merge). */
async function cmdMerge(projectId: string): Promise<void> {
  const plan = await api<MergePlan>(`/api/projects/${projectId}/merge`);
  const verdict = plan.mergeable
    ? '🎉 intégrable (toutes les tâches terminées, aucun conflit)'
    : plan.conflicts.length
      ? `⛔ ${plan.conflicts.length} conflit(s) de merge`
      : `◇ ${plan.done}/${plan.total} tâches terminées`;
  console.log(`\n🍯 Honeycomb Merge — ${verdict}\n`);
  if (plan.order.length) console.log(`  Ordre de merge : ${plan.order.join(' → ')}`);
  for (const c of plan.conflicts) console.log(`  ⛔ ${c.a} ⇄ ${c.b} : ${c.file}`);
  console.log('\n  (Analyse advisory : ni merge git ni exécution de tests — différences ci-dessus\n' +
    '  ne sont pas un échec de la CI. Exécutez réellement : `merge-run`.)');
  console.log(
    '  Exécuteur réel   : npm run cli -- merge-run ' + projectId + ' [-- cmd de test]',
  );
  console.log(
    '  Avec préparation : npm run cli -- merge-run ' +
      projectId +
      ' -- --preparer npm ci --tester npm test',
  );
}

interface MergeResult {
  mergeId: string;
  applied: string[];
  conflicts: { taskId: string; reason: string }[];
  testsRun: boolean;
  testsPassed: boolean | null;
  preparedOk?: boolean | null;
}

/** Déclencher l'exécution réelle du merge sur un nœud, puis attendre le résultat. */
async function cmdMergeRun(projectId: string, queue: string[]): Promise<void> {
  const body = decouperMergeArgv(queue);
  if (body.prepareCommand) console.log(`  préparation : ${body.prepareCommand.join(' ')}`);
  const run = await api<{ mergeId: string; nodeId: string; order: string[] }>(
    `/api/projects/${projectId}/merge/run`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  console.log(
    `\n🍯 Merge lancé (${run.mergeId.slice(0, 8)}) sur ${run.nodeId.slice(0, 8)}… — ordre : ${run.order.join(' → ')}`,
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { result } = await api<{ result: MergeResult | null }>(
      `/api/projects/${projectId}/merge/result`,
    );
    if (result && result.mergeId === run.mergeId) {
      const verdict = result.conflicts.length
        ? `⛔ ${result.conflicts.length} conflit(s)`
        : // L'environnement en échec n'est pas pas un test rouge : les tests n'ont pas
          // pas tourné, et le code n'est pas pas en cause.
          result.preparedOk === false
          ? '⛔ environnement non préparé — tests non lancés'
          : result.testsRun
            ? result.testsPassed
              ? '✓ tests OK'
              : '✘ tests échoués'
            : '◇ appliqué (sans tests)';
      console.log(`  ${verdict} — ${result.applied.length} diff(s) appliqué(s)`);
      for (const c of result.conflicts) console.log(`  ⛔ ${c.taskId} : ${c.reason}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  console.log('  (timeout — résultat non revenu ; relancez `merge-run` ou vérifiez le nœud.)');
}

/** Barre compacte des tâches par statut, réutilisant les badges d'affichage. */
function taskBar(tasks: TaskCounts): string {
  return Object.entries(BADGE)
    .map(([status, badge]) => `${badge}${tasks[status as keyof TaskCounts] ?? 0}`)
    .join(' ');
}

/** Time-Lapse Replay : rejoue le journal en frise chronologique dans le terminal. */
async function cmdReplay(sinceId = '0'): Promise<void> {
  const since = Number(sinceId);
  if (!Number.isInteger(since) || since < 0) {
    console.error(`sinceId invalide : « ${sinceId} » (entier ≥ 0 attendu)`);
    process.exitCode = 1;
    return;
  }
  const r = await api<ReplayResult>(`/api/replay?since=${since}`);
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
  if (r.finalCounts) console.log(`\n🎉 État final : ${taskBar(r.finalCounts.tasks)}`);
}

/** Waggle Board : classement des nœuds par contribution (nectar). */
async function cmdWaggle(): Promise<void> {
  const board = await api<WaggleBoard>('/api/waggle');
  if (board.nodes.length === 0) {
    console.log('Aucune contribution enregistrée : la danse frétille attend le premier nectar.');
    return;
  }
  console.log(
    `🏆 Waggle Board — ${board.totalTasksDone} tâche(s) butinée(s), ${board.totalTasksFailed} échec(s)\n`,
  );
  const medals = ['🥇', '🥈', '🥉'];
  board.nodes.forEach((n, i) => {
    const rank = medals[i] ?? `${i + 1}.`;
    const rate = `${Math.round(n.successRate * 100)}%`;
    const avg = n.avgDurationMs > 0 ? `${(n.avgDurationMs / 1000).toFixed(1)}s/tâche` : '—';
    const wins = n.raceWins > 0 ? ` 🏆${n.raceWins}` : '';
    console.log(
      `  ${rank} ${n.name} [${n.agentType}] — ${n.score} nectar ` +
        `✓${n.tasksDone} ✘${n.tasksFailed}${wins}, ${rate}, ${avg})`,
    );
  });
}

/** Parlement des Agents : consensus par vote sur le résultat d'une tâche. */
async function cmdConsensus(taskId: string): Promise<void> {
  const v = await api<Verdict>(`/api/tasks/${taskId}/consensus`);
  // ✓ pas de consensus ⇒ se lisait comme un constat de désaccord. Sur du code
  // c'est l'inverse : deux agents qui font la MÊME correction ne rendent pas
  // pas, donc `no_quorum` est le résultat normal et ne doit pas être mesuré
  // comme un échec. Voir parliament.ts.
  const verdict: Record<string, string> = {
    elected: '✓ sorties identiques',
    no_quorum: `⛔ sorties toutes différentes (quorum ${v.quorum})`,
    no_ballots: '✗ aucun résultat à valider',
  };
  console.log(`🗳️  Parlement — ${verdict[v.outcome] ?? v.outcome}\n`);
  v.factions.forEach((f, i) => {
    const crown = v.winner && f.signature === v.winner.signature ? '👑 ' : '   ';
    console.log(
      `${crown}#${i + 1} sig ${f.signature} — ${f.votes} voix ` +
        `(${f.diversity} type(s) : ${f.agentTypes.join(', ')})`,
    );
  });

  // La SURFACE : le seul accord mesurable sur du code. Elle ne dit pas que le
  // code est correct, mais deux agents qui ont fait la même correction ne
  // sont pas pas, et deux surfaces distinctes sont un signal faible.
  if (v.surfaces.length > 0 || v.sansSurface > 0) {
    console.log('\n👑 Pu le changement a été fait');
    if (v.surfaces.length > 1) {
      console.log('    ⛔ les agents ne sont pas d'accord sur l'ENDROIT.');
    }
    v.surfaces.forEach((s) => {
      console.log(`    ${s.votes} voix (${s.agentTypes.join(', ')}) — ${s.fichiers.join(', ')}`);
    });
    if (v.sansSurface > 0) {
      console.log(
        `    ${v.sansSurface} bulletins(s) sans diff visible — écart(s), pas compté(s) comme accord.`,
      );
    }
  }
}

/**
 * `hive doctor` — un verdict par ligne, et pour chaque cause de panne.
 *
 * ── POURQUOI CETTE COMMANDE NE PARLE PAS DE LA RUCHE ──────────────────────
 *
 * Toutes les autres commandes consomment l'API. Celle-ci NON, et c'est
 * le point : on utilise l'utilitaire local pour diagnostiquer des pannes
 * qui empêchent justement la ruche de démarrer. Un diagnostic qui a
 * besoin de la ruche pour s'exécuter ne prouve RIEN — c'est une
 * tautologie, et une fausse assurance.
 *
 * Ici, on regarde le disque, le `.env`, la base, le binaire, le port —
 * tout ce qui est VÉRIFIABLE sans ruche.
 *
 * ── LE DRAPEAU `--json` EST OBLIGATOIRE ICI (mission ~10) ──────────────────
 *
 * `--json` est OBLIGATOIRE pour les scripts. C'est ce qui distingue un
 * diagnostic pour un humain (lisible, couleurs) d'un diagnostic pour un
 * script (structuré, stable). Sans `--json`, on parle à un humain.
 *
 * ── SANS ARGUMENT : ON MONTRE, ON NE CHANGE RIEN ───────────────────────────
 *
 * Sans chemin, on diagnostique le dossier courant. C'est le cas le plus
 * fréquent : l'utilisateur tape `hive doctor` dans son dépôt.
 */
async function cmdDoctor(...args: string[]): Promise<void> {
  const { relever } = await import('./doctor-releve.js');
  const { codeDeSortie, diagnostiquer, pire } = await import('./shared/doctor.js');

  // Un CHEMIN factultatif : `hive doctor /srv/ma-ruche` examine un
  // installation qui n'est pas le dossier courant. Utile pour diagnostiquer
  // un poste d'admin — et c'est ce qui rend la commande testable de bout
  // en bout, sans avoir à `chdir` dans un test.
  const chemin = args.find((a) => !a.startsWith('--')) ?? process.cwd();
  const releve = await relever(chemin);
  const diags = diagnostiquer(releve);

  // `--json` est OBLIGATOIRE ICI (mission ~10) : `c'est la commande
  // qu'on branche sur un script, et un script ne lit pas la sortie
  // pour un humain.
  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          verdict: pire(diags),
          diags: diags.map((d) => ({
            cle: d.cle,
            gravite: d.gravite,
            constat: d.constat,
            reparation: d.reparation,
          })),
        },
        null,
        2,
      ),
    );
    process.exitCode = codeDeSortie(diags);
    return;
  }

  const PUCE: Record<string, string> = {
    ok: '  ✓',
    risque: '  ⚠',
    inconnu: '  ?',
    bloquant: '  ✘',
  };
  console.log('\n🐝 hive doctor\n');
  for (const d of diags) {
    console.log(`${PUCE[d.gravite] ?? '  ·'} ${d.cle.padEnd(13)} ${d.constat}`);
    // La réparation vient JUSTE SOUS le constat, indentée : c'est
    // copie-colle, et le caractère ajouté à la fin sont purement
    // décoratif.
    if (d.reparation) console.log(`        → ${d.reparation}`);
  }

  const p = pire(diags);
  const mot: Record<string, string> = {
    ok: 'tout est en ordre',
    risque: 'ça tourne, mais quelques réglages à surveiller',
    inconnu: 'rien de critique, mais quelques points ne sont pas vérifiables ( ?)',
    bloquant: 'la ruche ne peut pas fonctionner — au moins une cause de panne est présente',
  };
  console.log(`\n${mot[p] ?? p}\n`);
  process.exitCode = codeDeSortie(diags);
}

/**
 * `hive desinstaller` — montrer son emprise avant de l'effacer.
 *
 * ── POURQUOI CETTE COMMANDE EXISTE, ET POURQUOI ELLE EST SÉPARÉE ────────────
 *
 * L'ADR 0004 a tranché : `.env` et la base ne sont JAMAIS touchés, quel que
 * soit le drapeau. Cette commande les affiche, dit ce qu'elle va faire, et
 * demande confirmation avant d'effacer le reste.
 *
 * L'ADR 0004 n'exige ce refus qu'en `--non-interactive`. On va plus strict,
 * et plus simple : `install` sans niveau REFUSE, termin
 * (exit code 3), sans exception. Deux raisons :
 *
 *  1. Un effacement sans confirmation est un risque réel (perte de données),
 *     et un drapeau qui le permettrait est un risque d'usage.
 *
 *  2. La confirmation est un geste simple, et le seul qui vaut : on ne
 *     demande pas « voulez-vous vraiment ? », on montre, on dit ce qu'on
 *     va faire, et on attend.
 */
async function cmdDesinstaller(...args: string[]): Promise<void> {
  const { contexteReel, retirer, retouver, taillessible } = await import('./desinstallation.js');
  const { horsDuDossier } = await import('./shared/empreinte.js');

  const racine = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
  const ctx = contexteReel(racine);
  const trouve = retouver(ctx);

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          racine,
          horsDuDossier: horsDuDossier(ctx).map((e) => e.cle),
          empreintes: trouve.map((t) => ({
            cle: t.emplacement.cle,
            genre: t.emplacement.genre,
            retirable: t.emplacement.retirable,
            chemins: t.presets,
            octets: t.octets,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const PUCE: Record<string, string> = {
    etat: '  ✓',
    secret: '  ✘',
    travails: '  ⇶',
    transitoire: '  ⇶',
  };

  console.log(`\n🐝 Ce que Hive a écrit — ${racine}\n`);
  let riens = 0;
  for (const t of trouve) {
    if (t.presets.length === 0) {
      riens++;
      continue;
    }
    const taille = t.octets > 0 ? ` — ${taillessible(t.octets)}` : '';
    console.log(`${PUCE[t.emplacement.genre] ?? '  ·'} ${t.emplacement.quoi} ${taille}`);
    for (const c of t.presets) console.log(`        ${c}`);
    console.log(`        ${t.emplacement.retirable ? '⇶' : '⛔'} ${t.emplacement.consequence}\n`);
  }
  if (riens > 0) console.log(`  (${riens} emplacement(s) absent(s) ici)\n`);

  // La documentation qui va avec : `.hive-work` est relatif au
  // RÉPERTOIRE COURANT. QUELQU'UN qui a fait `npm … join` depuis
  // une clé de dossier parent, et pas de `~/hive` du tout.
  //
  // On affiche les chemins TROUVÉS, pas par préfixe : pour un
  // emplacement balayé par préfixe, on ne montre que les enfants
  // directs du dossier annoncé. Un `..` o
  // courant n'est pas un enfant direct.
  const clesDehors = new Set(horsDuDossier(ctx).map((e) => e.cle));
  const dehors = trouve.filter((t) => clesDehors.has(t.emplacement.cle) && t.presets.length > 0);
  if (dehors.length > 0) {
    console.log('  Hors du dossier d'installation :\n');
    for (const t of dehors) {
      for (const c of t.presets) console.log(`    · ${c} — ${t.emplacement.quoi}`);
    }
    console.log('');
  }

  if (!args.includes('--oui')) {
    console.log('  Rien n'a été supprimé. Pour vraiment effacer :\n');
    console.log('    npm run cli -- desinstaller --oui\n');
    console.log('  L'État (✓) n'est jamais touché, pas plus que les secrets.\n');
    console.log('  Pour séparer, en connaissance de cause :\n');
    for (const t of trouve) {
      if (t.emplacement.retirable || t.presets.length === 0) continue;
      console.log(`    rm -rf ${t.presets.join(' ')}`);
    }
    console.log('');
    return;
  }

  console.log('  Suppression de ce qui est reconstituable…\n');
  for (const g of retouver(trouve)) {
    if (g.issue === 'supprime') {
      console.log(`  ✓ ${g.cle} — ${taillessible(g.octets)}`);
    } else if (g.issue === 'protege' && g.chemins.length > 0) {
      console.log(`  ⛔ ${g.cle} — conservé : ${g.chemins.join(', ')}`);
    }
  }
  console.log('');
}

/**
 * `hive service install | status | logs | uninstall`.
 *
 * ── LE NIVEAU EST UNE QUESTION, JAMAIS UN DÉFAUT ────────────────────────────
 *
 * L'ADR 0004 : ⚠ Le choix du niveau (utilisateur / système) est une question
 * POSÉE, jamais un défaut. `--non-interactive` existe pour les scripts, et
 * sans lui, on demande.
 *
 * Ici, on va plus strict, et plus simple : `install` sans niveau REFUSE,
 * terminé (exit code 3), sans exception. Deux raisons :
 *
 *  1. Un service système mal installé peut corrompre un système.
 *  2. La question est simple, et le seul qui vaut : on ne
 *    demande pas « voulez-vous vraiment ? », on montre, on dit ce qu'on
 *    va faire, et on attend.
 *
 * Ici, on va plus strict, et plus simple : `install` sans niveau REFUSE,
 * terminé (exit code 3), sans exception.
 */
async function cmdService(...args: string[]): Promise<void> {
  const { CODE } = await import('./codes-sortie.js');
  const svc = await import('./service-reel.js');
  const { AVERTISSEMENT_LONGUEUR, codeJournal, planifier, rendreGestes } =
    await import('./shared/service.js');

  const sous = args.find((a) => !a.startsWith('--')) ?? 'status';
  const racine = process.cwd();

  // ── LES DEUX FAÇONS DE DEMANDER LE NIVEAU ──────────────────────────────
  //
  // `--systeme` l'exige. `--non-interactive…` existe pour les scripts, et
  // sans lui, on demande.
  const niveaubrut = args.find((a) => a.startsWith('--niveau='))?.slice('--niveau='.length);
  if (niveaubrut !== undefined && niveaubrut !== 'utilisateur' && niveaubrut !== 'systeme') {
    console.error(
      `\n✘ Niveau inconnu : « ${niveaubrut} ». Les deux valeurs sont ` +
        '`utilisateur` et `systeme`.\n',
    );
    process.exitCode = CODE.REPONSE_MANQUANTE;
    return;
  }
  const demande = args.includes('--systeme')
    ? 'systeme'
    : args.includes('--utilisateur')
      ? 'utilisateur'
      : (niveaubrut ?? null);

  // ── LE NIVEAU EST TOUJOURS EXIGÉ POUR `install`, PAS POUR LES AUTRES ────
  //
  // L'ADR 0004 n'exige ce refus qu'en `--non-interactive`. On va plus strict,
  // et plus simple : `install` sans niveau REFUSE, terminé.
  //
  // Les autres sous-commandes (`status`, `logs`, `uninstall`) ne
  // portent pas le drapeau. Elles ne POSÉ pas la question.
  if (sous === 'install' && demande === null) {
    console.error('\n✘ ⚠ Quel niveau installer le service ? Il faut dire.\n');
    console.error('   --utilisateur       droit administrateur. S'arrête à la fermeture\n');
    console.error('                      de session, sauf `loginctl enable-linger $USER`.');
    console.error('   --systeme           survit à la déconnexion, réclame un administrateur.\n');
    console.error('  npm run cli -- service install --utilisateur\n');
    process.exitCode = CODE.REPONSE_MANQUANTE;
    return;
  }

  const niveau = demande === 'systeme' ? 'systeme' : 'utilisateur';
  const ctx = svc.contexteReel(racine, niveau);

  const dire = (r: { motif: string }): void => {
    console.error(`\n✘ ${r.motif}\n`);
    process.exitCode = CODE.PREREQUIS;
  };

  if (sous === 'install') {
    // ── LES AVERTISSEMENTS VIENNENT AVANT, PAS APRÈS ──────────────────────
    //
    // Le plan portait le drapeau. `--non-interactive…` existe pour les scripts, et
    // sans lui, on demande.
    //
    // Le plan portait le drapeau. `--non-interactive…` existe pour les scripts, et
    // sans lui, on demande.
    //
    // Le plan portait le drapeau. `--non-interactive…` existe pour les scripts, et
    // sans lui, on demande.
    const avant = planifier(ctx);
    if (avant.genre === 'refus') return dire(avant);
    for (const a of avant.avertissements) console.log(`\n  ⛔ ${a}`);

    const r = svc.installer(ctx);
    if ('motif' in r) return dire(r);

    console.log(`\n🐝 Service ⚙ ${r.plan.nom}\n`);
    console.log(`  ⇶ fichier posé : ${r.plan.fichier.chemin}`);
    for (const ligne of rendreGestes(r.issues)) console.log(ligne);
    for (const i of r.issues) if (i.sortie) console.log(`      ${i.sortie}`);
    console.log('');
    if (!r.abouti) process.exitCode = CODE.ERREUR;
    return;
  }

  if (sous === 'uninstall') {
    const r = svc.desinstaller(ctx);
    if ('motif' in r) return dire(r);
    for (const ligne of rendreGestes(r.issues)) console.log(ligne);
    // L'exigence de l'ADR 0004 : après `uninstall`, on
    // n'a plus de service. Mais on a peut-être encore un `.env` et une base.
    console.log(
      `\n  ${r.abouti ? '✓' : '✘'} ${r.plan.fichier.chemin} — ` +
        `${r.abouti ? 'retiré' : 'IL SUBSISTE'}\n`,
    );
    console.log('  Ni le `.env` ni la base ne sont touchés. Voir `hive desinstaller`.\n');
    if (!r.abouti) process.exitCode = CODE.ERREUR;
    return;
  }

  if (sous === 'logs') {
    const r = svc.journal(ctx);
    if ('motif' in r) return dire(r);
    console.log(r.sortie || '(rien dans le journal)');
    // Un journal illisible n'est pas pas un échec : la ruche
    // peut tourner sans loguer (si elle a été lancée à la main).
    process.exitCode = codeJournal(r.code, CODE.ERREUR);
    return;
  }

  if (sous === 'status') {
    const r = svc.statut(ctx);
    if ('motif' in r) return dire(r);
    // ⚠ inactif ⇒ et ⇒ jamais installé ne sont pas deux situations
    // différentes. Confondre les deux enverrait installer Visual Studio à
    // quelqu'un qui n'en a aucun besoin.
    const nœud = r.pose ? '✓ fichier de service posé' : '· aucun fichier de service');
    console.log(`\n  ${r.pose ? '✓ fichier de service posé' : '· aucun fichier de service'}`);
    console.log(r.sortie ? `\n${r.sortie}\n` : '\n');
    if (!r.pose) {
      console.log('  Pour en poser un :\n    npm run cli -- service install\n');
      console.log(`  ${AVERTISSEMENT_LONGUEUR}\n`);
    }
    return;
  }

  console.error('\nUsage : service <install | status | logs | uninstall> [--systeme]\n');
  process.exitCode = CODE.ERREUR;
}

/**
 * `hive sauvegarde` — une copie de la base, complète et élaguée.
 *
 * ── POURQUOI PAS UN `cp` ────────────────────────────────────────────────────
 *
 * La base SQLite est un fichier vivant : un `cp` pendant que la ruche
 * écrit peut capturer un état incohérent. On passe par la sauvegarde
 * en ligne de SQLite, qui garantit un instantané cohérent.
 *
 * `VACUUM INTO` lit la base sans la bloquer, et copie le fichier
 * `.db` à chaque démarrage. Copier le `.db` à chaque fois où on
 * s'arrête sur une erreur de configuration dangereuse a échoué même s'il
 * s'est terminé sans erreur.
 */
async function cmdSauvegarde(...args: string[]): Promise<void> {
  const { CODE } = await import('./codes-sortie.js');
  const { contexteReel, sauvegarder } = await import('./sauvegarde-reelle.js');
  const { planifier } = await import('./shared/sauvegarde.js');

  const racine = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
  const brut = args.find((a) => a.startsWith('--garder='))?.slice('--garder='.length);
  const garder = brut === undefined ? 7 : Number(brut);
  const vers = args.find((a) => a.startsWith('--vers='))?.slice('--vers='.length);

  const ctx = contexteReel(
    racine,
    ctxEmpreinte(racine).dbPath,
    garder,
    vers === undefined ? undefined : path.resolve(vers),
  );

  const r = await sauvegarder(ctx);
  if ('motif' in r) {
    console.error(`\n✘ ${r.motif}\n`);
    process.exitCode = CODE.PREREQUIS;
    return;
  }

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        { fichier: r.fichier, octets: r.octets, elaguees: r.elaguees },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`  ✓ ${r.fichier} — copie complète, WAL compris`);
  if (r.elaguees.length > 0) {
    console.log(`  ⛔ ${r.elaguees.length} plus ancienne(s) retirée(s) — garder ${garder}`);
  }
  if (r.reste.length > 0) {
    console.log(`  ◇ ${r.reste.length} reste(s) d'archive(s) interrompu(s), rammassé(s)`);
  }
  console.log('');
}

/** Ghost in the Hive : rapport d'anomalies (nœuds/tâches doutées). */
async function cmdGhost(): Promise<void> {
  const report = await api<GhostReport>('/api/ghost');
  const { events, nodes, tasks } = report.scanned;
  if (report.ghosts.length === 0) {
    console.log(`🐝 Aucune anomalie (${events} événements, ${nodes} nœuds, ${tasks} tâches).`);
    return;
  }
  const icon: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' };
  console.log(`🐝 ${report.ghosts.length} anomalie(s) détectée(s) :\n`);
  for (const g of report.ghosts) {
    console.log(`  ${icon[g.severity] ?? '⚪'} [${g.kind}] ${g.target} — ${g.detail}`);
  }
}

/**
 * Night Shift : évaluer LOCALEMENT la disponibilité du nœud d'après HIVE_SHIFT
 * et l'heure de la machine (aucun appel réseau).
 */
function cmdShift(): void {
  const policy = nightShiftFromEnv();
  if (policy.windows.length === 0) {
    console.log('🌙 Disponibilité 24h/24 (HIVE_SHIFT non défini).');
    return;
  }
  const now = new Date();
  console.log(`🌙 Night Shift : ${policy.windows.map(formatWindow).join(', ')}`);
  if (isOnShift(policy, now)) {
    console.log('  ✓ De service : le nœud accepte du travail.');
  } else {
    const mins = minutesUntilOpen(policy, now);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    console.log(`  ⇶ Hors service. Prochaine ouverture dans ${h}h${String(m).padStart(2, '0')}.`);
  }
}

/** Hive Pulse : signes vitaux de la ruche. */
async function cmdPulse(): Promise<void> {
  const p = await api<HivePulse>('/api/pulse');
  const ms = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);
  console.log('💓 Hive Pulse');
  console.log(
    `  Tâches : ✓${p.totalDone} ✘${p.totalFailed} — succès ${Math.round(p.successRate * 100)}% · nœuds actifs ${p.activeNodes}`,
  );
  console.log(
    `  Latence : p50 ${ms(p.latency.p50)} · p95 ${ms(p.latency.p95)} · max ${ms(p.latency.max)} (n=${p.latency.count})`,
  );
  // Mini-histogramme du débit horaire (dernières 24h).
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
  console.log(`🍯 ${r.name} — ${bar} ${r.progressPct}%${r.complete ? ' ✓' : ''}`);
  console.log(
    `   ${r.total} tâche(s) : ✓${r.byStatus.done} ⇶${r.byStatus.running} ◆${r.byStatus.assigned} ` +
      `◇${r.byStatus.ready} ◷${r.byStatus.pending} ✘${r.byStatus.failed}`,
  );
  console.log(
    `   Nœuds contributeurs : ${r.contributingNodes.length || '—'} · tentatives cumulées : ${r.totalAttempts}`,
  );
}

interface BilletResponse {
  billet: string;
  id: string;
  url: string;
  label: string;
  transport: 'sur' | 'clair_prive' | 'clair_public';
  expiresAt: number;
  uses: number;
  joinCommand: string;
  note: string;
}

/**
 * Générer un BILLET à envoyer à un ami : iphémérique, à usage compté, révocable.
 *
 * Usage : invite [urlWS] [--uses N] [--hours H] [--insecure]
 */
async function cmdInvite(...args: string[]): Promise<void> {
  const drapeaux = new Set(args.filter((a) => a.startsWith('--')));
  const positionnels = args.filter((a) => !a.startsWith('--'));
  const valeur = (nom: string): number | undefined => {
    const i = args.indexOf(nom);
    if (i < 0) return undefined;
    const n = Number(args[i + 1]);
    return Number.isFinite(n) ? n : undefined;
  };
  const heures = valeur('--hours');
  const body: Record<string, unknown> = {};
  const url = positionnels.find((a) => a.startsWith('ws'));
  if (url) body.url = url;
  const uses = valeur('--uses');
  if (uses !== undefined) body.uses = uses;
  if (heures !== undefined) body.ttlMs = Math.round(heures * 3_600_000);
  if (drapeaux.has('--insecure')) body.insecure = true;

  let inv: BilletResponse;
  try {
    inv = await api<BilletResponse>('/api/billets', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('transport en clair')) {
      console.error(
        '\n✘ Refus : cette URL enverrait le billet ET tout le trafic de la ruche\n' +
          '  (prompts, logs, DIFFS DE CODE SOURCE) en clair sur Internet.\n\n' +
          '  Trois issues, de la meilleure à la pire :\n' +
          '    1. `npm run cli -- tunnel`   ⇄ une URL wss:// chiffrée, sans ouvrir de port\n' +
          '    2. un reverse proxy chez vous, en HTTPS\n' +
          '    3. `--insecure` si vous savez ce que vous faites',
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const restant = Math.max(0, inv.expiresAt - Date.now());
  const heuresRestantes = Math.round((restant / 3_600_000) * 10) / 10;
  console.log('\n🍯 Billet à envoyer à votre ami (ruche : ' + inv.url + ')\n');
  console.log('  Étape 1 — il récolte Hive pus, dans le dossier : npm install');
  console.log('  Étape 2 — il colle cette commande :\n');
  console.log('    ' + inv.joinCommand + '\n');
  console.log('  Son Claude Code / Codex est détecté automatiquement. C'est tout.\n');
  console.log(
    `  Ce billet : ${inv.uses === 1 ? 'usage UNIQUE' : inv.uses + ' usages'} · expire dans ${heuresRestantes} h · id ${inv.id}`,
  );
  console.log(
    `  Transport : ${
      inv.transport === 'sur'
        ? 'wss:// chiffré ✓'
        : inv.transport === 'clair_prive'
          ? 'ws:// en clair, réseau privé (usuel en local)'
          : 'ws:// EN CLAIR SUR ADDRESS PUBLIQUE ⛔'
    }`,
  );
  console.log(
    '\n  Il ne donne accès à la ruche que pour les commandes qu'il lance, sans toucher\n' +
      '  aux autres :  npm run cli -- membres  npm run cli -- exclure <nodeId>\n',
  );
  console.log(
    '  ⛔ Passer le billet en argument laisse la trace dans l'historique du shell. Plus\n' +
      '    discret : `npm run join seul`, puis collez le billet demandé.\n',
  );
}

/** Qui a les clés de la ruche, et quels billets circulent en cor. */
async function cmdMembres(): Promise<void> {
  const r = await api<{
    noeuds: {
      nodeId: string;
      label: string | null;
      createdAt: number;
      lastSeenAt: number | null;
      revoque: boolean;
    }[];
    billets: {
      id: string;
      label: string | null;
      expiresAt: number;
      usesLeft: number;
      etat: string;
    }[];
  }>('/api/membres');

  console.log('\n🐝 Membres (clés de nœud)');
  if (r.noeuds.length === 0) {
    console.log('  — aucun. Les nœuds connectés utilisent en leur clé maître.');
  }
  for (const n of r.noeuds) {
    const vu = n.lastSeenAt ? new Date(n.lastSeenAt).toLocaleString() : 'jamais');
    console.log(
      `  ${n.revoque ? '✘' : '✓'} ${n.nodeId}  ${n.label ?? ''} · vu ${vu}${n.revoque ? ' (RÉVOQUÉ)' : ''}`,
    );
  }

  console.log('\n🎫 Billets');
  if (r.billets.length === 0) console.log('  — aucun.');
  for (const b of r.billets) {
    const icone = { vivant: '✓', expire: '⌛', epuise: '✗', revoque: '⊘' }[b.etat] ?? '?';
    console.log(
      `   ${icone} ${b.id}  ${b.label ?? ''}  · ${b.usesLeft} usage(s) restant(s) expire ${new Date(b.expiresAt).toLocaleString()}`,
    );
  }
  console.log('');
}

/** Exclure un membre — sans toucher aux autres. */
async function cmdExclure(nodeId: string): Promise<void> {
  await api(`/api/membres/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
  console.log(
    `\n⊘ ${nodeId} est exclu : sa clé ne peut plus rien faire\n` +
      '  immédiatement. Les autorités membres ne sont pas affectées.\n',
  );
}

/** Révoquer un billet en circulation. */
async function cmdRevoquerBillet(id: string): Promise<void> {
  await api(`/api/billets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  console.log(`\n⊘ Billet ${id} révoqué : il ne peut plus être changé.\n`);
}

/**
 * Ouvrir un tunnel chiffré vers la ruche et émettre un billet dessous.
 *
 * C'est la commande qui rend la connexion à distance simple : aucun port
 * à ouvrir sur la box, aucun VPM, aucun nom de domaine — et le transport
 * est en `wss://`, donc chiffré. Le tunnel vit tant que la commande tourne :
 * c'est volontairement non-persistant.
 */
async function cmdTunnel(...args: string[]): Promise<void> {
  const port = Number(new URL(BASE).port) || 7777;
  const fournisseur = await trouverFournisseur();
  if (!fournisseur) {
    console.error(
      '\n✘ Aucun outil de tunnel trouvé dans le PATH.\n\n' +
        '  Hive n'embarque volontairement AUCUNE dépendance de tunnel : c'est\n' +
        '  le code source de tous les membres par tiers doit être VOTRE choix.\n\n' +
        '  Pour en installer un :\n' +
        FOURNISSEURS.map((f) => `    ${f.nom}  ⇄  ${f.installation}`).join('\n') +
        '\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n🌙 Ouverture d'un tunnel via ${fournisseur.nom}…`);
  let tunnel;
  try {
    tunnel = await ouvrirTunnel(fournisseur, port);
  } catch (err) {
    console.error(`\n✘ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  const urlWs = urlRucheDepuisTunnel(tunnel.url);
  if (!urlWs) {
    tunnel.process.kill();
    console.error(`\n✘ URL de tunnel inattendue : ${tunnel.url}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`   ✓ ${tunnel.url}  →  ${urlWs}\n`);
  try {
    await cmdInvite(urlWs, ...args);
  } catch (err) {
    tunnel.process.kill();
    throw err;
  }

  console.log(
    '   ◇ Le tunnel reste ouvert TANT QUE cette commande tourne. Ctrl+C le\n' +
      '   ferme, et la ruche redevient injoignable de l'extérieur.\n' +
      '   C'est volontaire : un tunnel permanent est un risque de sécurité.\n',
  );
  const fermer = (): void => {
    console.log('\n🌙 Fermeture du tunnel…');
    tunnel.process.kill();
    process.exit(0);
  };
  process.on('SIGINT', fermer);
  process.on('SIGTERM', fermer);
  await new Promise(() => {}); // vit jusqu'au signal
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

/** Parler à la Reine : question en langue nature, réponse depuis l'état réel. */
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

/** Drone Wars : lancer une course compétitive sur une tâche. */
async function cmdRace(taskId: string, factor?: string): Promise<void> {
  const body = factor ? { factor: Number(factor) } : {};
  const res = await api<{ taskId: string; drones: string[] }>(`/api/tasks/${taskId}/race`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  console.log(`\n⛔ Course lancée : ${res.drones.length} drone(s) sur la tâche ${res.taskId}`);
  for (const d of res.drones) console.log(`  🐝 ${d.slice(0, 8)}…`);
  console.log('  Le premier succès gagne, les perdants sont annulés automatiquement.');
}

/** Drone Wars : liste des courses en vol (en mémoire du hub). */
async function cmdRaces(): Promise<void> {
  const { races } = await api<{ races: DroneRace[] }>('/api/races');
  if (races.length === 0) {
    console.log('Aucune course en vol — lancez-en une avec : npm run cli -- race <taskId>');
    return;
  }
  const icon: Record<string, string> = { running: '⇶', succeeded: '✓', failed: '✘' };
  console.log(`⛔ ${races.length} course(s) en vol\n`);
  for (const r of races) {
    const flying = r.drones.filter((d) => d.status === 'running').length;
    console.log(`  Tâche ${r.taskId} — facteur ${r.factor}, ${flying} drone(s) en vol`);
    for (const d of r.drones) {
      const win = r.winner === d.nodeId ? ' 🏆' : '';
      console.log(`    ${icon[d.status] ?? '?'} ${d.nodeId.slice(0, 8)}… (${d.status})${win}`);
    }
  }
}

const [cmd, a1, a2, a3] = process.argv.slice(2);
try {
  if (cmd === 'state') await cmdState();
  else if (cmd === 'mind') await cmdMind(a1);
  else if (cmd === 'strings' && a1) await cmdStings(a1);
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
  else if (cmd === 'doctor') await cmdDoctor(...process.argv.slice(3));
  else if (cmd === 'desinstaller') await cmdDesinstaller(...process.argv.slice(3));
  else if (cmd === 'service') await cmdService(...process.argv.slice(3));
  else if (cmd === 'sauvegarde') await cmdSauvegarde(...process.argv.slice(3));
  else if (cmd === 'mode') await cmdMode(...process.argv.slice(3));
  else if (cmd === 'ghost') await cmdGhost();
  else if (cmd === 'shift') cmdShift();
  else if (cmd === 'pulse') await cmdPulse();
  else if (cmd === 'report' && a1) await cmdReport(a1);
  else if (cmd === 'ask' && a1) await cmdAsk(a1, a2);
  else if (cmd === 'race' && a1) await cmdRace(a1, a2);
  else if (cmd === 'races') await cmdRaces();
  else if (cmd === 'invite') await cmdInvite(...process.argv.slice(3));
  else if (cmd === 'tunnel') await cmdTunnel(...process.argv.slice(3));
  else if (cmd === 'cloudflare') await cmdCloudflare(...process.argv.slice(3));
  else if (cmd === 'consiel' && a1) await cmdConsiel(a1, a2);
  else if (cmd === 'consiel-voir' && a1) await cmdConsielVoir(a1);
  else if (cmd === 'consiels') await cmdConsiels();
  else if (cmd === 'github') await cmdGithub(a1);
  else if (cmd === 'github-import' && a1) await cmdGithubImport(a1);
  else if (cmd === 'liverer' && a1) await cmdLiverer(a1, a2);
  else if (cmd === 'fusionner' && a1 && a2) await cmdFusionner(a1, a2, a3);
  else if (cmd === 'membres') await cmdMembres();
  else if (cmd === 'exclure' && a1) await cmdExclure(a1);
  else if (cmd === 'revoquer' && a1) await cmdRevoquerBillet(a1);
  else {
    console.log(
      'Usage : npm run cli -- <state | mind ["<q>"] | strings <p> | plan "<b>" [mode] | project "Nom" [url] | brief <p> "<b>" | tasks <p> <f.json> | watch <p> | cancel <id> | events [sinceId] | merge <p> | merge-run <p> [args...] | replay [sinceId] | waggle | consensus <id> | doctor [chemin] [--json] | desinstaller [--oui] | service <install|status|logs|uninstall> [--systeme|--utilisateur] | sauvegarde [--garder=N] [--vers=dir] [--json] | mode [mode] [p] [--oui] | ghost | shift | pulse | report <p> | ask "<q>" [p] | race <id> [facteur] | races | invite [urlWS] [--uses N] [--hours H] [--insecure] | tunnel [args...] | cloudflare [args...] | consiel <p> [q] | consiel-voir <id> | consiels | github [filtre] | github-import <repo> | liverer <id> [base] | fusionner <p> <pr> [méthode] | membres | exclure <id> | revoquer <id>>',
    );
  }
} catch (err) {
  if (err instanceof Error) {
    console.error(`\n✘ ${err.message}\n`);
  } else {
    console.error(`\n✘ ${String(err)}\n`);
  }
  process.exitCode = 1;
}