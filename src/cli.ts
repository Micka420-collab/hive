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
//   npm run cli -- doctor [chemin] [--json]          diagnostic local : 11 causes de panne
//   npm run cli -- ghost                              anomalies (nœuds/tâches douteux)
//   npm run cli -- shift                              disponibilité heures creuses (HIVE_SHIFT, local)
//   npm run cli -- pulse                              signes vitaux de la ruche
//   npm run cli -- report <projectId>                 avancement d'un projet
//   npm run cli -- ask "<question>" [projectId]       parler à la Reine (état réel de la ruche)
//   npm run cli -- race <taskId> [facteur]            Drone Wars : course compétitive (2-5 nœuds)
//   npm run cli -- races                              Drone Wars : courses en vol
//
// Config : HIVE_HTTP (défaut http://localhost:7777) et HIVE_TOKEN (.env lu si présent).
// Format du fichier de tâches : [{ "id"?, "title", "prompt", "dependsOn"?: [] }, …]

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
import { aLeDrapeau, choisirDansListe, valeurApres } from './choix-cli.js';
import { corpsDuBillet } from './shared/cli-billet.js';
import { depuis, lignesReponseReine, lignesSurfaces, lignesWaggle } from './shared/cli-rendu.js';
import { decouperMergeArgv } from './shared/preparation.js';
import type { HiveEvent, StateSnapshot, Task } from './shared/types.js';
import { envSonde } from './node-client/agent-detect.js';

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
  methodesDeRepli,
  methodesInstallation,
  urlStable,
  urlTelechargement,
} from './node-client/cloudflare.js';

const BASE = process.env.HIVE_HTTP ?? 'http://localhost:7777';
const TOKEN = process.env.HIVE_TOKEN ?? 'change-me';

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  // `content-type: application/json` seulement quand il Y A un corps : l'annoncer
  // sur une requête vide (un DELETE, typiquement) est incorrect, et faisait
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

/**
 * `sinceId` en entier, ou le refus — AVANT toute requête.
 *
 * ─── CE QUE ÇA ÉVITE ────────────────────────────────────────────────────────
 *
 * `Number('abc')` rend `NaN`, qui se glisse tel quel dans l'URL
 * (`?since=NaN`). Le serveur répond 400, et l'appelant lit une erreur d'API
 * pour ce qui est une faute de frappe dans SON argument. Un refus local nomme
 * la vraie cause, et ne dérange pas la ruche pour rien.
 *
 * Rend `null` quand c'est refusé : le nombre `0` est valide, donc un code de
 * retour falsy serait ambigu.
 */
function sinceValide(sinceId: string): number | null {
  const n = Number(sinceId);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`sinceId invalide : « ${sinceId} » (entier ≥ 0 attendu)`);
    process.exitCode = 1;
    return null;
  }
  return n;
}

async function cmdEvents(sinceId = '0'): Promise<void> {
  const since = sinceValide(sinceId);
  if (since === null) return;
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
  console.log(
    '  Avec préparation    : npm run cli -- merge-run ' +
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

/** Déclenche l'exécution réelle du merge sur un nœud, puis attend le résultat. */
async function cmdMergeRun(projectId: string, queue: string[]): Promise<void> {
  const body = decouperMergeArgv(queue);
  if (body.prepareCommand) console.log(`  préparation : ${body.prepareCommand.join(' ')}`);
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
        : // L'environnement en échec n'est pas un test rouge : les tests n'ont
          // pas tourné, et le code n'est pas en cause.
          result.preparedOk === false
          ? '⚠ environnement non préparé — tests non lancés'
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
  const since = sinceValide(sinceId);
  if (since === null) return;
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
  if (r.finalCounts) console.log(`\n🍯 État final : ${taskBar(r.finalCounts.tasks)}`);
}

/** Waggle Board : classement des nœuds par contribution (nectar). */
async function cmdWaggle(): Promise<void> {
  const board = await api<WaggleBoard>('/api/waggle');
  // Les décisions d'affichage — tableau vide, médailles, durée inconnue — vivent
  // dans `shared/cli-rendu.ts`, pur et éprouvé : ce fichier n'exporte rien, donc
  // rien de ce qu'il décide ne peut être interrogé par un banc (§ 2 quaterdecies).
  for (const l of lignesWaggle(board)) console.log(l);
}

/** Parlement des Agents : consensus par vote sur les résultats d'une tâche. */
async function cmdConsensus(taskId: string): Promise<void> {
  const v = await api<Verdict>(`/api/tasks/${taskId}/consensus`);
  // « pas de consensus » se lisait comme un constat de désaccord. Sur du code
  // c'est l'inverse : deux agents qui font la MÊME correction ne rendent pas
  // les mêmes octets, donc `no_quorum` est le résultat normal et ne mesure
  // rien. Voir parliament.ts.
  const verdict: Record<string, string> = {
    elected: '✅ sorties identiques',
    no_quorum: `⚠ sorties toutes différentes (quorum ${v.quorum})`,
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

  // La SURFACE : le seul accord mesurable sur du code. Le bloc entier — y
  // compris son existence — est décidé par `lignesSurfaces`, pur et éprouvé.
  for (const l of lignesSurfaces(v)) console.log(l);
}

/**
 * `hive doctor` — un verdict par ligne, et pour chaque échec la commande exacte.
 *
 * ─── POURQUOI CETTE COMMANDE NE PARLE PAS À LA RUCHE ─────────────────────────
 *
 * Toutes les autres commandes de ce fichier appellent l'API. Celle-ci NON, et
 * c'est le point : on l'utilise justement quand la ruche ne répond pas. Une
 * commande de diagnostic qui a besoin de ce qu'elle diagnostique ne sert à rien
 * le jour où on en a besoin.
 *
 * Elle regarde donc le disque, essaie le port, et parle HTTP seulement pour
 * demander « es-tu une ruche ? » à ce qui occupe déjà le port.
 */
async function cmdDoctor(...args: string[]): Promise<void> {
  const { relever } = await import('./doctor-releve.js');
  const { codeDeSortie, diagnostiquer, pire } = await import('./shared/doctor.js');

  // Un CHEMIN facultatif : `hive doctor /srv/ma-ruche` examine une autre
  // installation que celle d'où l'on tape. Utile pour diagnostiquer depuis un
  // poste d'administration — et c'est ce qui rend la commande testable de bout
  // en bout, sans dépendre du répertoire courant du processus de test.
  const chemin = args.find((a) => !a.startsWith('--')) ?? process.cwd();
  const releve = await relever(chemin);
  const diags = diagnostiquer(releve);

  // `--json` est OBLIGATOIRE ici (mission §10) : c'est la commande qu'on
  // branche sur une supervision, et une supervision ne lit pas des puces.
  if (args.includes('--json')) {
    console.log(JSON.stringify({ verdict: pire(diags), diagnostics: diags }, null, 2));
    process.exitCode = codeDeSortie(diags);
    return;
  }

  const PUCE: Record<string, string> = {
    ok: '  ✔',
    risque: '  ⚠',
    inconnu: '  ?',
    bloquant: '  ✘',
  };
  console.log('\n🩺 hive doctor\n');
  const largeurCle = Math.max(...diags.map((d) => d.cle.length));
  for (const d of diags) {
    // La largeur suit la clé la PLUS LONGUE, calculée — pas un 13 écrit à la
    // main qui se décale au treizième contrôle. `secret_session` en fait 14, et
    // la colonne des constats s'est désalignée à la seconde où il est arrivé.
    console.log(`${PUCE[d.gravite] ?? '  ·'} ${d.cle.padEnd(largeurCle)} ${d.constat}`);
    // La réparation vient JUSTE SOUS le constat, indentée : c'est ce qu'on
    // copie-colle, et le chercher ailleurs dans la sortie casserait le geste.
    if (d.reparation) console.log(`       → ${d.reparation}`);
  }

  const p = pire(diags);
  const mot: Record<string, string> = {
    ok: 'tout est en ordre',
    risque: 'ça tourne, mais lisez les ⚠',
    inconnu: 'rien de cassé ; quelques points n’ont PAS pu être vérifiés (?)',
    bloquant: 'la ruche ne peut pas fonctionner en l’état — réparez les ✘, de haut en bas',
  };
  console.log(`\n${mot[p] ?? p}\n`);
  process.exitCode = codeDeSortie(diags);
}

/**
 * `hive desinstaller` — montrer son empreinte avant d'effacer quoi que ce soit.
 *
 * ─── POURQUOI LE DÉFAUT EST L'INVENTAIRE, PAS LA SUPPRESSION ─────────────────
 *
 * Installer sans pouvoir désinstaller est ce qui fait qu'on n'essaie pas un
 * outil. Mais un `uninstall` qui efface tout est pire : la base SQLite est la
 * MÉMOIRE de la ruche — projets, tâches, Hive Mind, grand livre — et `.env`
 * porte `HIVE_TOKEN`, dont la perte déconnecte tous les nœuds.
 *
 * L'ADR 0004 a tranché : `.env` et la base ne sont JAMAIS touchés, quel que
 * soit le drapeau. Cette commande les affiche, dit ce qu'ils pèsent et ce
 * qu'on perdrait, et donne la commande exacte — puis s'arrête. Le geste
 * définitif reste celui d'un humain qui l'a tapé.
 *
 * Et il n'y a pas de `--dry-run` : le DÉFAUT est sec. Un drapeau qu'on oublie
 * de taper ne doit jamais transformer un inventaire en effacement.
 */
async function cmdDesinstaller(...args: string[]): Promise<void> {
  const { contexteReel, relever, retirer, taillelisible } = await import('./desinstallation.js');
  const { horsDuDossier, trouvaillesDehors } = await import('./shared/empreinte.js');

  const racine = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
  const ctx = contexteReel(racine);
  const trouve = relever(ctx);

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          racine,
          horsDuDossier: horsDuDossier(ctx).map((e) => e.cle),
          emplacements: trouve.map((t) => ({
            cle: t.emplacement.cle,
            genre: t.emplacement.genre,
            retirable: t.emplacement.retirable,
            chemins: t.presents,
            octets: t.octets,
            quoi: t.emplacement.quoi,
            consequence: t.emplacement.consequence,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const PUCE: Record<string, string> = {
    etat: '  ✘',
    secret: '  ✘',
    travail: '  ▸',
    transitoire: '  ▸',
  };

  console.log(`\n🐝 Ce que Hive a écrit — ${racine}\n`);
  let riens = 0;
  for (const t of trouve) {
    if (t.presents.length === 0) {
      riens++;
      continue;
    }
    const taille = t.octets > 0 ? ` — ${taillelisible(t.octets)}` : '';
    console.log(`${PUCE[t.emplacement.genre] ?? '  ·'} ${t.emplacement.quoi}${taille}`);
    for (const c of t.presents) console.log(`       ${c}`);
    for (const c of t.contenu) console.log(`         · ${path.basename(c.chemin)} — ${c.quoi}`);
    console.log(`       ${t.emplacement.retirable ? '↻' : '⚠'} ${t.emplacement.consequence}\n`);
  }
  if (riens > 0) console.log(`  (${riens} emplacement(s) annoncé(s) mais absent(s) ici)\n`);

  // La nuance que la documentation taisait : `.hive-work` est relatif au
  // RÉPERTOIRE COURANT. Quelqu'un qui a fait `npx … join` depuis ailleurs a
  // une clé de nœud dans ce dossier-là, et pas de `~/hive` du tout.
  //
  // On affiche les chemins TROUVÉS, pas ceux qui étaient annoncés : pour un
  // emplacement balayé par préfixe, `chemin` est le dossier parent — écrire
  // « /tmp » ici ferait croire que la ruche revendique tout le dossier
  // temporaire.
  const clesDehors = new Set(horsDuDossier(ctx).map((e) => e.cle));
  const dehors = trouvaillesDehors(trouve, clesDehors);
  if (dehors.length > 0) {
    console.log('  Hors du dossier d’installation :');
    for (const t of dehors) {
      for (const c of t.presents) console.log(`    · ${c} — ${t.emplacement.quoi}`);
    }
    console.log('');
  }

  if (!args.includes('--oui')) {
    console.log('  Rien n’a été supprimé. Pour enlever ce qui est reconstructible :\n');
    console.log('    npm run cli -- desinstaller --oui\n');
    console.log('  L’état (✘) n’est jamais retiré par cette commande. Pour vous en');
    console.log('  séparer, en connaissance de cause :\n');
    for (const t of trouve) {
      if (t.emplacement.retirable || t.presents.length === 0) continue;
      console.log(`    rm -rf ${t.presents.join(' ')}`);
    }
    console.log('');
    return;
  }

  console.log('  Suppression de ce qui se reconstruit…\n');
  for (const g of retirer(trouve)) {
    if (g.issue === 'supprime') {
      console.log(`  ✔ ${g.cle} — ${taillelisible(g.octets)} libéré(s)`);
    } else if (g.issue === 'protege' && g.chemins.length > 0) {
      console.log(`  ⚠ ${g.cle} — conservé : ${g.chemins.join(' ')}`);
    }
  }
  console.log('');
}

/**
 * `hive service install | status | logs | uninstall`.
 *
 * ─── LE NIVEAU EST UNE QUESTION, JAMAIS UN DÉFAUT DEVINÉ ─────────────────────
 *
 * L'ADR 0004 : « Le choix du niveau (utilisateur / système) est une question
 * POSÉE, jamais un défaut deviné — et en `--non-interactive`, son absence est
 * une erreur de code 3, pas un défaut silencieux. »
 *
 * Ici, on va un cran plus loin que « poser la question » : le niveau
 * utilisateur est le défaut ANNONCÉ, et le niveau système ne s'obtient qu'avec
 * `--systeme` tapé à la main. Un niveau système posé par inadvertance réclame
 * l'administrateur, survit à tout, et se retire moins facilement qu'il ne
 * s'installe. Ce n'est pas quelque chose qu'on décide pour quelqu'un.
 */
async function cmdService(...args: string[]): Promise<void> {
  const { CODE } = await import('./codes-sortie.js');
  const svc = await import('./service-reel.js');
  const { AVERTISSEMENT_LINGER, codeJournal, planifier, rendreGestes } =
    await import('./shared/service.js');

  const sous = args.find((a) => !a.startsWith('--')) ?? 'status';
  const racine = process.cwd();

  // ─── LES DEUX FAÇONS DE DEMANDER LE NIVEAU SYSTÈME ─────────────────────────
  //
  // `--systeme` l'exige. `--niveau=…` existe pour les scripts, et parce qu'un
  // outil qui n'accepte qu'une seule orthographe force à lire sa documentation
  // pour rien.
  const niveauBrut = args.find((a) => a.startsWith('--niveau='))?.slice('--niveau='.length);
  if (niveauBrut !== undefined && niveauBrut !== 'utilisateur' && niveauBrut !== 'systeme') {
    console.error(
      `\n✘ Niveau inconnu : « ${niveauBrut} ». Les deux valeurs sont ` +
        '`utilisateur` et `systeme`.\n',
    );
    process.exitCode = CODE.REPONSE_MANQUANTE;
    return;
  }
  const demande = args.includes('--systeme')
    ? 'systeme'
    : args.includes('--utilisateur')
      ? 'utilisateur'
      : (niveauBrut ?? null);

  // ─── LE NIVEAU EST TOUJOURS EXIGÉ POUR `install`, PAS SEULEMENT EN CI ──────
  //
  // L'ADR 0004 n'exige ce refus qu'en `--non-interactive`. On va plus strict,
  // et plus simple : `install` sans niveau REFUSE, terminal ou pas. Deux
  // raisons.
  //
  //   · un défaut, même annoncé, reste un défaut deviné. Le niveau système
  //     réclame l'administrateur et se retire moins facilement qu'il ne
  //     s'installe ; le niveau utilisateur s'arrête à la fermeture de session.
  //     Aucun des deux n'est anodin au point d'être choisi pour quelqu'un ;
  //   · un comportement IDENTIQUE avec et sans terminal, c'est un mode de moins
  //     où se cacher un défaut. Ce dépôt a déjà payé pour des chemins que la
  //     CI n'empruntait pas.
  //
  // Les autres sous-commandes (`status`, `logs`, `uninstall`) prennent le
  // niveau utilisateur par défaut : elles ne POSENT rien, elles regardent.
  if (sous === 'install' && demande === null) {
    console.error('\n✘ À quel niveau installer le service ? Il faut le dire.\n');
    console.error('  --utilisateur   aucun droit administrateur. S’arrête à la fermeture');
    console.error('                  de session, sauf `loginctl enable-linger $USER`.');
    console.error('  --systeme       survit à la déconnexion, réclame l’administrateur.\n');
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
    // ─── LES AVERTISSEMENTS VIENNENT AVANT, PAS APRÈS ────────────────────────
    //
    // Le plan porte déjà ce qu'il faut savoir : que le niveau système réclame
    // l'administrateur, que `systemd --user` s'arrête à la fermeture de
    // session. Les afficher APRÈS l'installation, c'est prévenir quelqu'un
    // d'une conséquence qu'il vient de subir.
    //
    // On planifie d'abord, on dit, puis on agit. Ça retire aussi une
    // duplication : ce texte n'existe qu'à un seul endroit — le module pur, où
    // il est testé. La loupe avait fait survivre un `if (niveau === 'systeme')`
    // ici, sur une bannière qui redisait ce que le plan disait déjà.
    const avant = planifier(ctx);
    if (avant.genre === 'refus') return dire(avant);
    for (const a of avant.avertissements) console.log(`\n  ⚠ ${a}`);

    const r = svc.installer(ctx);
    if ('motif' in r) return dire(r);

    console.log(`\n🐝 Service « ${r.plan.nom} »\n`);
    console.log(`  ▸ fichier posé : ${r.plan.fichier.chemin}`);
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
    // L'exigence de l'ADR 0004 : après `uninstall`, aucun fichier ne subsiste.
    console.log(
      `\n  ${r.abouti ? '✔' : '✘'} ${r.plan.fichier.chemin} — ` +
        `${r.abouti ? 'retiré' : 'IL SUBSISTE'}\n`,
    );
    console.log('  Ni le `.env` ni la base n’ont été touchés — voir `hive desinstaller`.\n');
    if (!r.abouti) process.exitCode = CODE.ERREUR;
    return;
  }

  if (sous === 'logs') {
    const r = svc.journal(ctx);
    if ('motif' in r) return dire(r);
    console.log(r.sortie || '(rien dans le journal)');
    // Un journal illisible n'est pas un journal vide : la distinction est ce
    // qu'une supervision regarde. Voir `codeJournal`.
    process.exitCode = codeJournal(r.code, CODE.ERREUR);
    return;
  }

  if (sous === 'status') {
    const r = svc.statut(ctx);
    if ('motif' in r) return dire(r);
    // « inactif » et « jamais installé » sont deux situations différentes, et
    // la sortie de `systemctl` ne les distingue pas toujours.
    console.log(`\n  ${r.pose ? '✔ fichier de service posé' : '· aucun fichier de service'}`);
    console.log(r.sortie ? `\n${r.sortie}\n` : '\n');
    if (!r.pose) {
      console.log('  Pour en poser un :\n    npm run cli -- service install\n');
      console.log(`  ⚠ ${AVERTISSEMENT_LINGER}\n`);
    }
    return;
  }

  console.error('\nUsage : service <install | status | logs | uninstall> [--systeme]\n');
  process.exitCode = CODE.ERREUR;
}

/**
 * `hive sauvegarde` — une copie de la base, complète et cohérente.
 *
 * ─── POURQUOI CETTE COMMANDE PLUTÔT QU'UN `cp` ───────────────────────────────
 *
 * La base tourne en mode WAL : les écritures récentes vivent dans un fichier
 * `-wal` À CÔTÉ du fichier principal. Copier le `.db` à chaud donne une base
 * qui s'ouvre sans erreur, passe `integrity_check`, et à laquelle il MANQUE des
 * lignes. Mesuré, dans `tests/sauvegarde.test.ts` : sur 5 000 insertions, la
 * copie brute en rendait 4 741.
 *
 * `VACUUM INTO` lit par le moteur, WAL compris. On écrit sous un nom `.part`,
 * puis on renomme — un renommage est atomique, donc ce qui porte un nom
 * définitif est toujours complet.
 */
/**
 * `hive mode` — voir et changer ce que la ruche s'autorise, sans quitter le
 * clavier.
 *
 * ─── CE QUE CETTE COMMANDE EXISTE POUR CORRIGER ─────────────────────────────
 *
 * L'échelle d'autonomie existait, la route pour la changer aussi. Mais rien en
 * ligne de commande ne permettait de la LIRE ni de la POSER : il fallait
 * fabriquer un `curl` à la main. Un réglage qui gouverne ce qu'une IA fait
 * sans demander ne peut pas être le seul que l'outil ne sait pas montrer.
 */
async function cmdMode(...args: string[]): Promise<void> {
  const { CODE } = await import('./codes-sortie.js');
  const { PALIERS, basculer, estMode, palierDe } = await import('./shared/mode.js');

  const mots = args.filter((a) => !a.startsWith('--'));
  const accorde = args.includes('--oui');
  // `/api/state` ne porte PAS le niveau : il vit dans sa propre table et se lit
  // par projet. On liste donc, puis on demande — un appel par projet, ce qui
  // est le bon compromis pour une CLI, et zéro octet imposé aux tableaux de
  // bord qui reçoivent l'instantané en continu.
  const bruts = await api<{ projects: { id: string; name: string }[] }>('/api/state').then(
    (s) => s.projects ?? [],
  );
  const projets = await Promise.all(
    bruts.map(async (p) => ({
      ...p,
      autonomie: await api<{ niveau: string }>(`/api/projects/${p.id}/essaim`)
        .then((e) => e.niveau)
        .catch(() => 'off'),
    })),
  );

  // ─── SANS ARGUMENT : ON MONTRE, ON NE CHANGE RIEN ─────────────────────────
  if (mots.length === 0) {
    console.log('\n🎚️  Les quatre modes\n');
    for (const p of PALIERS) {
      console.log(`  ${p.mode.padEnd(9)} ${p.nom}`);
      console.log(`  ${' '.repeat(9)} fait      : ${p.fait}`);
      console.log(`  ${' '.repeat(9)} ne fait pas : ${p.neFaitPas}\n`);
    }
    if (projets.length === 0) {
      console.log('  Aucun projet pour l’instant.\n');
    } else {
      console.log('  Où en sont vos projets :\n');
      for (const pr of projets) {
        console.log(`    ${pr.name}  →  ${pr.autonomie ?? 'off'}   (${pr.id})`);
      }
      console.log('\n  Changer :  npm run cli -- mode <mode> [projectId]\n');
    }
    return;
  }

  const demande = mots[0] ?? '';
  const projetId = mots[1] ?? projets[0]?.id;
  if (projetId === undefined) {
    console.error('✘ Aucun projet. Créez-en un d’abord : npm run cli -- project "<nom>"');
    process.exitCode = CODE.ERREUR;
    return;
  }
  const projet = projets.find((p) => p.id === projetId);
  if (!projet) {
    console.error(`✘ Projet inconnu : ${projetId}`);
    process.exitCode = CODE.ERREUR;
    return;
  }

  const actuel = estMode(projet.autonomie ?? 'off') ? (projet.autonomie as never) : 'off';
  const d = basculer(actuel, demande, accorde);
  if (d.genre === 'refus') {
    console.error(`✘ ${d.motif}`);
    process.exitCode = CODE.ERREUR;
    return;
  }
  if (d.confirmation !== undefined) {
    // On DIT ce que ça implique, puis on s'arrête. La confirmation est un
    // second geste, jamais une question à laquelle on répond par réflexe.
    console.log(`\n⚠  ${d.confirmation}\n`);
    console.log(`   Pour confirmer :  npm run cli -- mode ${d.vers} ${projetId} --oui\n`);
    // Le code dit ce qui manque : une RÉPONSE, pas une erreur d'usage. Un
    // script qui automatise la bascule peut donc distinguer « mot inconnu »
    // de « il faut confirmer ».
    process.exitCode = CODE.REPONSE_MANQUANTE;
    return;
  }

  await api(`/api/projects/${projetId}/essaim`, {
    method: 'POST',
    body: JSON.stringify({ niveau: d.vers }),
  });
  const p = palierDe(d.vers);
  console.log(`\n✔ ${projet.name} → ${p.nom} (${d.vers})`);
  console.log(`   fait        : ${p.fait}`);
  console.log(`   ne fait pas : ${p.neFaitPas}\n`);
  if (d.vers !== 'off') {
    console.log(
      '   Rappel : `HIVE_RUNNER=on` est le SECOND interrupteur, côté hôte.\n' +
        '   Sans lui, aucun cycle ne part — c’est celui qui paie le temps-machine qui décide.\n',
    );
  }
}

async function cmdSauvegarde(...args: string[]): Promise<void> {
  const { CODE } = await import('./codes-sortie.js');
  const { contexteReel, sauvegarder } = await import('./sauvegarde-reelle.js');
  const { contexteReel: ctxEmpreinte } = await import('./desinstallation.js');
  const { taillelisible } = await import('./desinstallation.js');

  const racine = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
  const brut = args.find((a) => a.startsWith('--garder='))?.slice('--garder='.length);
  const garder = brut === undefined ? 7 : Number(brut);
  const vers = args.find((a) => a.startsWith('--vers='))?.slice('--vers='.length);

  // La base est là où l'empreinte dit qu'elle est : une seule vérité sur
  // l'emplacement, partagée avec `hive desinstaller`.
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
        { fichier: r.fichier, octets: r.octets, elaguees: r.elaguees, restes: r.restes },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\n  ✔ ${r.fichier}`);
  console.log(`    ${taillelisible(r.octets)} — copie complète, WAL compris\n`);
  if (r.elaguees.length > 0) {
    console.log(`  ◦ ${r.elaguees.length} plus ancienne(s) retirée(s) — borne : ${garder}\n`);
  }
  if (r.restes.length > 0) {
    console.log(`  ◦ ${r.restes.length} reste(s) d’un processus interrompu, ramassé(s)\n`);
  }
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
 * Génère un BILLET à envoyer à un ami : éphémère, à usage compté, révocable.
 *
 * Usage : invite [urlWS] [--uses N] [--hours H] [--insecure]
 */
async function cmdInvite(...args: string[]): Promise<void> {
  // Ce qui part sur le fil est décidé par `corpsDuBillet`, pur et éprouvé : un
  // billet est un droit d'entrée COMPTÉ, et se tromper sur le compte est une
  // faille, pas un détail (§ 2 quaterdecies).
  const body = corpsDuBillet(args);

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
          '  (prompts, logs, DIFFS DE CODE SOURCE) en clair sur l’Internet public.\n\n' +
          '  Trois issues, de la meilleure à la moins bonne :\n' +
          '    1. `npm run cli -- tunnel`   → une URL wss:// chiffrée, sans ouvrir de port\n' +
          '    2. un reverse proxy à vous, en HTTPS\n' +
          '    3. `--insecure` si vous savez précisément ce que vous faites\n',
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const restant = Math.max(0, inv.expiresAt - Date.now());
  const heuresRestantes = Math.round((restant / 3_600_000) * 10) / 10;
  console.log('\n🐝 Billet à envoyer à votre ami (ruche : ' + inv.url + ')\n');
  console.log('  Étape 1 — il récupère Hive puis, dans le dossier :  npm install');
  console.log('  Étape 2 — il colle cette commande :\n');
  console.log('    ' + inv.joinCommand + '\n');
  console.log('  Son Claude Code / Codex est détecté automatiquement. C’est tout.');
  console.log(
    `\n  Ce billet : ${inv.uses === 1 ? 'usage UNIQUE' : inv.uses + ' usages'} · expire dans ${heuresRestantes} h · id ${inv.id}`,
  );
  console.log(
    `  Transport : ${
      inv.transport === 'sur'
        ? 'wss:// chiffré ✔'
        : inv.transport === 'clair_prive'
          ? 'ws:// en clair, réseau privé (usuel en local)'
          : 'ws:// EN CLAIR sur adresse publique ⚠'
    }`,
  );
  console.log(
    '\n  Il ne donne aucun pouvoir sur la ruche : il ne sert qu’à obtenir une clé\n' +
      '  propre à la machine de votre ami. Vous pourrez l’exclure seul, sans toucher\n' +
      '  aux autres :  npm run cli -- membres  puis  npm run cli -- exclure <nodeId>\n',
  );
  console.log(
    '  ⚠ Passer le billet en argument le laisse dans l’historique du shell. Plus\n' +
      '    discret : l’ami lance `npm run join` seul, puis colle le billet demandé.\n',
  );
}

/** Qui a les clés de la ruche, et quels billets circulent encore. */
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

  console.log('\n🔑 Membres (clés de nœud)');
  if (r.noeuds.length === 0) {
    console.log('  — aucun. Les nœuds connectés utilisent encore le token maître.');
  }
  for (const n of r.noeuds) {
    const vu = n.lastSeenAt ? new Date(n.lastSeenAt).toLocaleString() : 'jamais';
    console.log(
      `  ${n.revoque ? '⛔' : '✔'} ${n.nodeId}  ${n.label ?? ''}  · vu ${vu}${n.revoque ? '  (RÉVOQUÉ)' : ''}`,
    );
  }

  console.log('\n🎫 Billets');
  if (r.billets.length === 0) console.log('  — aucun.');
  for (const b of r.billets) {
    const icone = { vivant: '✔', expire: '⌛', epuise: '∅', revoque: '⛔' }[b.etat] ?? '?';
    console.log(
      `  ${icone} ${b.id}  ${b.etat}  · ${b.usesLeft} usage(s) restant(s) · expire ${new Date(b.expiresAt).toLocaleString()}`,
    );
  }
  console.log('');
}

/** Exclure un membre — sans toucher aux autres. */
async function cmdExclure(nodeId: string): Promise<void> {
  await api(`/api/membres/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
  console.log(
    `\n⛔ ${nodeId} est exclu : sa clé ne vaut plus rien et sa connexion est coupée\n` +
      '   immédiatement. Les autres membres ne sont pas affectés.\n\n' +
      '   Cette ruche a désormais exclu quelqu’un : le token de ruche n’enregistre\n' +
      '   plus de machine INCONNUE — sans quoi l’exclu reviendrait sous un autre nom.\n' +
      '   Les machines déjà connues continuent normalement ; les nouvelles entrent\n' +
      '   par billet :  npm run cli -- invite\n',
  );
}

/** Révoquer un billet encore en circulation. */
async function cmdRevoquerBillet(id: string): Promise<void> {
  await api(`/api/billets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  console.log(`\n⛔ Billet ${id} révoqué : il ne peut plus être échangé.\n`);
}

/**
 * Ouvre un tunnel chiffré vers la ruche et émet un billet dessus.
 *
 * C'est la commande qui rend la connexion à distance réellement simple : aucun
 * port à ouvrir sur la box, aucun VPN, aucun nom de domaine — et le transport
 * est en `wss://`, donc chiffré. Le tunnel vit tant que la commande tourne :
 * c'est volontaire et affiché. Un tunnel qui survivrait à la fenêtre qui l'a
 * ouvert serait une porte laissée entrebâillée sans que personne s'en souvienne.
 */
/**
 * Configurer Cloudflare — diagnostic, installation, et URL stable.
 *
 *   npm run cli -- cloudflare                       où j'en suis, et quoi faire
 *   npm run cli -- cloudflare --install             binaire local, sans sudo
 *   npm run cli -- cloudflare --setup <hote>        tunnel nommé, URL STABLE
 *
 * Pourquoi le tunnel nommé mérite une commande : l'URL d'un tunnel rapide CHANGE
 * À CHAQUE REDÉMARRAGE. Les nœuds mémorisent leur clé et survivent donc aux
 * redémarrages, mais l'URL qu'ils ont apprise meurt avec le tunnel — il faudrait
 * réémettre un billet à chaque membre, à chaque relance. Une ruche communautaire
 * ne tient pas à ce prix.
 */
async function cmdCloudflare(...args: string[]): Promise<void> {
  const plateforme = { os: process.platform, arch: process.arch };
  const port = Number(new URL(BASE).port || 7777);
  // `valeurApres` / `aLeDrapeau` : la borne `>= 0` vit dans `choix-cli.ts`,
  // pur et éprouvé — zéro est une POSITION, et `--setup` en tête d'arguments
  // est justement l'invocation que la documentation montre.
  const hote = valeurApres(args, '--setup');

  const installe = await versionCloudflared();

  // ─── Diagnostic, toujours affiché : on dit d'abord où en est la machine ────
  console.log('\n☁️  Cloudflare — état de cette machine\n');
  console.log(`  Plateforme   : ${plateforme.os}/${plateforme.arch}`);
  console.log(`  cloudflared  : ${installe ? `✔ installé (${installe})` : '✘ absent'}`);
  const urlPublique = process.env.HIVE_PUBLIC_URL;
  console.log(`  HIVE_PUBLIC_URL : ${urlPublique ?? '(non défini — URL devinée sur le LAN)'}`);

  // ─── Installation ─────────────────────────────────────────────────────────
  if (args.includes('--install')) {
    if (installe) {
      console.log('\n✔ Déjà installé, rien à faire.\n');
      return;
    }
    await installerCloudflared(plateforme);
    return;
  }

  if (!installe) {
    console.log('\n📦 Installer cloudflared — au choix :\n');
    const methodes = methodesInstallation(plateforme);
    if (methodes.length === 0) {
      console.log(
        `  Aucune méthode connue pour ${plateforme.os}/${plateforme.arch}.\n` +
          '  Voir https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n',
      );
      return;
    }
    for (const [i, m] of methodes.entries()) {
      const marque = m.privilegie ? ' (demande sudo/admin)' : '';
      console.log(`  ${i + 1}. ${m.nom}${marque}\n     ${m.commande}\n`);
    }
    console.log('  Puis relancez cette commande pour la suite.\n');
    return;
  }

  // ─── Tunnel nommé : l'URL stable ──────────────────────────────────────────
  if (aLeDrapeau(args, '--setup')) {
    if (!hote || !hoteValide(hote)) {
      console.error(
        '\n✘ Nom d’hôte invalide.\n\n' +
          '  Attendu : un sous-domaine QUALIFIÉ d’un domaine que vous gérez sur Cloudflare,\n' +
          '  par exemple :  npm run cli -- cloudflare --setup ruche.mondomaine.com\n\n' +
          '  (Pas une URL, pas un chemin — juste le nom d’hôte.)\n',
      );
      process.exitCode = 1;
      return;
    }
    const nom = 'hive';
    console.log(`\n🔗 Tunnel NOMMÉ « ${nom} » → ${hote}\n`);
    console.log(
      '  Contrairement au tunnel rapide, cette URL est STABLE : elle survit aux\n' +
        '  redémarrages, donc vos invitations peuvent la contenir pour de bon.\n',
    );
    console.log('  Prérequis : un compte Cloudflare (gratuit) et ce domaine délégué chez eux.\n');

    for (const [i, e] of etapesTunnelNomme(nom, hote, port).entries()) {
      console.log(`  ${i + 1}. ${e.titre}${e.interactive ? '   ⏸ ouvre votre navigateur' : ''}`);
      console.log(`     ${e.commande}`);
      console.log(`     ↳ ${e.pourquoi}\n`);
    }
    console.log('  Enfin, pour que les billets annoncent cette URL :\n');
    console.log(`     HIVE_PUBLIC_URL=${urlStable(hote)}\n`);
    console.log('     (dans votre .env, puis relancez la ruche)\n');
    console.log(`  Vérification :  npm run cli -- invite\n`);
    return;
  }

  // ─── Sinon : que faire maintenant ─────────────────────────────────────────
  console.log('\n✔ cloudflared est prêt. Deux usages :\n');
  console.log('  • Dépanner un ami cet après-midi (URL jetable, rien à configurer) :');
  console.log('      npm run cli -- tunnel\n');
  console.log('  • Ruche durable (URL STABLE, survit aux redémarrages) :');
  console.log('      npm run cli -- cloudflare --setup ruche.mondomaine.com\n');
  console.log(
    '  L’URL d’un tunnel rapide change à CHAQUE redémarrage : vos membres devraient\n' +
      '  alors recevoir un nouveau billet à chaque relance. Le tunnel nommé règle cela.\n',
  );
}

/** Version de `cloudflared`, ou `null` s'il est absent. */
function versionCloudflared(): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('cloudflared', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      // Un binaire trouvé dans le PATH n'hérite d'aucun secret de la ruche —
      // la même garde que la sonde d'agent, portée ici aussi.
      env: envSonde(process.env),
    });
    let sortie = '';
    p.stdout?.on('data', (b: Buffer) => (sortie += b.toString()));
    p.stderr?.on('data', (b: Buffer) => (sortie += b.toString()));
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const m = sortie.match(/\d+\.\d+\.\d+/);
      resolve(sortie.trim() ? (m?.[0] ?? sortie.trim().split('\n')[0]!) : null);
    });
    setTimeout(() => {
      p.kill();
      resolve(null);
    }, 5_000).unref?.();
  });
}

/**
 * Télécharge le binaire dans `.hive-work/bin/`. Aucun sudo, aucune modification
 * du système : le binaire vit dans le dossier de travail du projet, et se
 * supprime en supprimant ce dossier.
 *
 * On AFFICHE l'URL avant de télécharger. Récupérer un exécutable depuis
 * Internet est une action à conséquence : l'utilisateur doit voir d'où il vient,
 * pas le découvrir après coup.
 */
async function installerCloudflared(plateforme: {
  os: NodeJS.Platform;
  arch: string;
}): Promise<void> {
  const methode = methodesInstallation(plateforme).find((m) => m.cle === 'local');
  const url = urlTelechargement(plateforme);
  if (!url || !methode?.automatisable) {
    console.log('\n📦 Installation automatique indisponible sur cette plateforme.\n');
    for (const m of methodesInstallation(plateforme)) {
      console.log(`  • ${m.nom}\n    ${m.commande}\n`);
    }
    if (estArchive(plateforme)) {
      console.log(
        '  (Cloudflare ne publie qu’une archive .tgz pour macOS : il faut la\n' +
          '   décompresser, d’où le choix de ne pas l’automatiser en silence.)\n',
      );
    }
    process.exitCode = 1;
    return;
  }

  const dossier = path.join('.hive-work', 'bin');
  const cible = path.join(dossier, plateforme.os === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  console.log(`\n📦 Téléchargement depuis :\n     ${url}\n   vers : ${cible}\n`);

  let empreinte: string;
  try {
    const rep = await fetch(url, { redirect: 'follow' });
    if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
    const octets = new Uint8Array(await rep.arrayBuffer());

    // On refuse ce qui n'est manifestement pas un exécutable AVANT d'écrire :
    // le mode d'echec reel n'est presque jamais une attaque, c'est un portail
    // captif ou un proxy qui renvoie une page HTML en HTTP 200. Ecrire ce
    // fichier puis le rendre executable produirait une erreur incomprehensible
    // au premier lancement.
    if (!enTeteValide(plateforme, octets)) {
      throw new Error(diagnosticContenu(octets));
    }
    empreinte = createHash('sha256').update(octets).digest('hex');
    mkdirSync(dossier, { recursive: true });
    writeFileSync(cible, Buffer.from(octets), { mode: 0o755 });
  } catch (err) {
    console.error(
      `\n✘ Téléchargement impossible : ${err instanceof Error ? err.message : String(err)}\n\n` +
        '  Repli — installez-le à la main :\n' +
        // La méthode `local` EST le téléchargement qui vient d'échouer : la
        // proposer en repli reviendrait à dire « refaites ce qui n'a pas
        // marché ». Le choix vit dans `methodesDeRepli`, pur et éprouvé.
        methodesDeRepli(plateforme)
          .map((m) => `    ${m.commande}`)
          .join('\n') +
        '\n',
    );
    process.exitCode = 1;
    return;
  }

  const absolu = path.resolve(cible);
  const attendu = enTeteAttendu(plateforme);
  console.log(
    `✔ Installé — en-tête ${attendu?.quoi ?? 'vérifié'}, ${(statSync(cible).size / 1048576).toFixed(1)} Mo.`,
  );
  console.log(`  SHA-256 : ${empreinte}`);
  console.log(
    '  (Cloudflare ne publie pas de manifeste de sommes à une URL stable : cette\n' +
      '   empreinte est là pour QUI VEUT la comparer à la source. Pour une intégrité\n' +
      '   réellement signée, passez par le dépôt de paquets Cloudflare — apt/rpm, GPG.)\n',
  );
  console.log('  Ce dossier n’est pas dans votre PATH. Deux options :\n');
  console.log(`    export PATH="${path.resolve(dossier)}:$PATH"      # cette session`);
  console.log(`    sudo ln -s ${absolu} /usr/local/bin/cloudflared   # définitif\n`);
  console.log('  Puis :  npm run cli -- cloudflare\n');
}

interface VueConseil {
  id: string;
  question: string;
  etat: string;
  tour: number;
  issue: string | null;
  motif: string | null;
  enVol: number;
  retenue: string | null;
  danses: {
    id: string;
    titre: string;
    corps: string;
    sources: string[];
    eclaireuse: string;
    famille: string;
    intensite: number;
    soutiens: string[];
    arrets: string[];
    familles: string[];
    quorum: boolean;
    raisons: { type: string; raison: string; eclaireuse: string }[];
  }[];
}

/** Ouvre un Conseil des Éclaireuses sur un projet. */
async function cmdConseil(projectId: string, question?: string): Promise<void> {
  const v = await api<VueConseil>(`/api/projects/${encodeURIComponent(projectId)}/conseil`, {
    method: 'POST',
    body: JSON.stringify(question ? { question } : {}),
  });
  console.log(`\n🔭 Conseil ouvert — ${v.id}\n`);
  console.log(`  Question : ${v.question}\n`);
  console.log(`  ${v.enVol} éclaireuses partent explorer, chacune sous un angle différent.`);
  console.log('  Elles chercheront sur le web, puis se vérifieront mutuellement.\n');
  console.log(`  Suivre :  npm run cli -- conseil-voir ${v.id}\n`);
  console.log(
    '  ⚠ Un conseil consomme du temps-ouvrière réel sur les machines des membres.\n' +
      '    La Balance le compte.\n',
  );
}

const ISSUE_LABEL: Record<string, string> = {
  quorum: '✅ une proposition a convergé',
  depart: '⚖️  deux propositions à égalité — à vous de trancher',
  sans_quorum: '… aucune convergence pour l’instant',
  epuise: '⌛ arrêté sans convergence',
  vide: '∅ aucune proposition',
};

/** Affiche l'état d'un conseil : les danses, classées. */
async function cmdConseilVoir(sessionId: string): Promise<void> {
  const v = await api<VueConseil>(`/api/conseil/${encodeURIComponent(sessionId)}`);
  console.log(`\n🔭 ${v.question}\n`);
  console.log(
    `  État : ${v.etat} · tour ${v.tour} · ${v.enVol} tâche(s) en vol` +
      `${v.issue ? `\n  Issue : ${ISSUE_LABEL[v.issue] ?? v.issue}` : ''}`,
  );
  if (v.motif) console.log(`  ${v.motif}`);
  console.log('');

  if (v.danses.length === 0) {
    console.log('  (aucune proposition — les éclaireuses n’ont pas encore rapporté)\n');
    return;
  }
  for (const d of v.danses) {
    const marque = d.id === v.retenue ? '★ RETENUE' : d.quorum ? '✓ quorum' : ' ';
    console.log(`  ${marque}  ${d.titre}`);
    console.log(
      `     intensité ${d.intensite.toFixed(1)} · ${d.soutiens.length} soutien(s)` +
        `${d.arrets.length ? ` · ${d.arrets.length} ARRÊT` : ''}` +
        ` · familles : ${d.familles.join(', ') || '—'}`,
    );
    console.log(`     proposé par ${d.eclaireuse} (${d.famille})`);
    if (d.corps) console.log(`     ${d.corps.slice(0, 200)}`);
    for (const r of d.raisons.slice(0, 3)) {
      console.log(`     ${r.type === 'arret' ? '⛔' : '↳'} ${r.raison.slice(0, 140)}`);
    }
    for (const s of d.sources.slice(0, 3)) console.log(`     🔗 ${s}`);
    console.log('');
  }
}

/** Liste les conseils récents. */
async function cmdConseils(): Promise<void> {
  const r = await api<{
    conseils: { id: string; question: string; etat: string; issue: string | null }[];
  }>('/api/conseils');
  console.log(`\n🔭 ${r.conseils.length} conseil(s)\n`);
  for (const c of r.conseils) {
    const badge =
      c.etat === 'clos' ? (ISSUE_LABEL[c.issue ?? ''] ?? c.issue ?? 'clos') : '⏳ en cours';
    console.log(`  ${badge}\n     ${c.question.slice(0, 90)}\n     ${c.id}\n`);
  }
}

interface DepotListe {
  fullName: string;
  description: string;
  prive: boolean;
  langage: string;
  pousseA: number;
  archive: boolean;
  importe: boolean;
  htmlUrl: string;
}

function afficherDepots(depots: DepotListe[], tronque: boolean): void {
  depots.forEach((d, i) => {
    const num = String(i + 1).padStart(3);
    const marque = d.importe ? '✔ déjà dans la ruche' : d.prive ? '🔒 privé' : '';
    const meta = [d.langage, depuis(d.pousseA), d.archive ? '📦 archivé' : '', marque]
      .filter(Boolean)
      .join(' · ');
    console.log(`  ${num}. ${d.fullName}`);
    if (meta) console.log(`       ${meta}`);
    if (d.description) console.log(`       ${d.description.slice(0, 100)}`);
  });
  if (tronque) {
    console.log(
      '\n  ⚠ Liste tronquée (beaucoup de dépôts). Affinez :  npm run cli -- github <filtre>',
    );
  }
}

/**
 * Liste les dépôts GitHub et propose d'en importer un par son NUMÉRO.
 *
 * Le choix par numéro est délibéré : retaper `owner/repo` à la main sur une
 * liste de cent lignes, c'est une faute de frappe garantie — et une faute de
 * frappe ici crée un projet vers le mauvais dépôt.
 */
async function cmdGithub(filtre?: string): Promise<void> {
  const qs = filtre ? `?q=${encodeURIComponent(filtre)}` : '';
  const r = await api<{ depots: DepotListe[]; total: number; tronque: boolean }>(
    `/api/github/repos${qs}`,
  );

  if (r.depots.length === 0) {
    console.log(
      filtre
        ? `\n  Aucun dépôt ne correspond à « ${filtre} » (${r.total} au total).\n`
        : '\n  Aucun dépôt visible avec ce jeton.\n',
    );
    return;
  }

  console.log(
    `\n🐙 ${r.depots.length} dépôt(s)${filtre ? ` correspondant à « ${filtre} »` : ''}\n`,
  );
  afficherDepots(r.depots, r.tronque);

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let reponse: string;
  try {
    reponse = (
      await rl.question('\n  Numéro du dépôt à connecter (Entrée pour quitter) : ')
    ).trim();
  } finally {
    rl.close();
  }
  if (!reponse) return;

  const choisi = choisirDansListe(reponse, r.depots);
  if (!choisi) {
    console.error(`\n✘ « ${reponse} » n’est pas un numéro de la liste (1 à ${r.depots.length}).\n`);
    process.exitCode = 1;
    return;
  }
  if (choisi.importe) {
    console.log(`\n  ${choisi.fullName} est déjà connecté à la ruche.\n`);
    return;
  }
  await cmdGithubImport(choisi.fullName);
}

/** Connecte un dépôt par son nom complet. */
async function cmdGithubImport(fullName: string): Promise<void> {
  const r = await api<{ projet: { id: string; name: string }; depot: DepotListe }>(
    '/api/github/import',
    { method: 'POST', body: JSON.stringify({ fullName }) },
  );
  console.log(`\n✔ ${r.depot.fullName} est connecté à la ruche.\n`);
  console.log(`  Projet : ${r.projet.id}\n`);
  console.log('  Et maintenant :');
  console.log(`    npm run cli -- brief ${r.projet.id} "ce que vous voulez faire"`);
  console.log(
    `    npm run cli -- conseil ${r.projet.id}      # demander à la ruche ce qu’elle en pense\n`,
  );
}

/**
 * Livre la production d'une tâche : branche + pull request sur le dépôt du
 * projet. NE FUSIONNE RIEN — la commande `fusionner` existe pour ça, et il faut
 * la taper.
 */
async function cmdLivrer(taskId: string, base?: string): Promise<void> {
  const r = await api<{ pr: number; urlPr: string; branche: string; fichiers: string[] }>(
    '/api/livraison',
    { method: 'POST', body: JSON.stringify({ taskId, ...(base ? { base } : {}) }) },
  );
  console.log(`\n✔ Pull request #${r.pr} ouverte.\n`);
  console.log(`  ${r.urlPr}`);
  console.log(`  Branche : ${r.branche}`);
  console.log(`  Fichiers : ${r.fichiers.length}\n`);
  console.log('  Rien n’est fusionné. Relisez, puis :');
  console.log(`    npm run cli -- fusionner <projectId> ${r.pr}\n`);
}

/**
 * Fusionne une pull request ouverte par la ruche.
 *
 * Cette commande est le SEUL chemin vers un merge, et il passe par un humain
 * qui la tape. Aucune partie de la ruche ne l'appelle.
 */
async function cmdFusionner(projectId: string, pr: string, methode?: string): Promise<void> {
  const m = methode === 'merge' || methode === 'rebase' ? methode : 'squash';
  const r = await api<{ fusionnee: boolean; sha: string }>('/api/livraison/fusion', {
    method: 'POST',
    body: JSON.stringify({ projectId, pr: Number(pr), methode: m }),
  });
  if (r.fusionnee) console.log(`\n✔ PR #${pr} fusionnée (${m}) — ${r.sha.slice(0, 8)}\n`);
  else console.log(`\n✘ PR #${pr} non fusionnée.\n`);
}

async function cmdTunnel(...args: string[]): Promise<void> {
  const port = Number(new URL(BASE).port || 7777);
  const fournisseur = await trouverFournisseur();
  if (!fournisseur) {
    console.error(
      '\n✘ Aucun outil de tunnel trouvé dans le PATH.\n\n' +
        '  Hive n’embarque volontairement AUCUNE dépendance de tunnel : faire transiter\n' +
        '  le code source de tous les membres par un tiers doit être VOTRE choix, pas un\n' +
        '  effet de bord d’un `npm install`.\n\n' +
        FOURNISSEURS.map((f) => `  • ${f.nom}  →  ${f.installation}`).join('\n') +
        '\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n🌍 Ouverture d’un tunnel via ${fournisseur.nom}…`);
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

  console.log(`   ✔ ${tunnel.url}  →  ${urlWs}\n`);
  try {
    await cmdInvite(urlWs, ...args);
  } catch (err) {
    tunnel.process.kill();
    throw err;
  }

  console.log(
    '  ⏳ Le tunnel reste ouvert TANT QUE cette commande tourne. Ctrl+C le referme —\n' +
      '     et la ruche redevient injoignable de l’extérieur. C’est voulu : une porte\n' +
      '     qui survit à la fenêtre qui l’a ouverte finit par être oubliée.\n',
  );
  const fermer = (): void => {
    console.log('\n🌍 Fermeture du tunnel…');
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

/** Parler à la Reine : question en langage naturel, réponse depuis l'état réel. */
async function cmdAsk(question: string, projectId?: string): Promise<void> {
  const res = await api<{ reply: string; source: 'live' | 'llm'; suggestions: string[] }>(
    '/api/chat',
    {
      method: 'POST',
      body: JSON.stringify({ message: question, ...(projectId ? { projectId } : {}) }),
    },
  );
  for (const l of lignesReponseReine(res)) console.log(l);
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

/** Drone Wars : liste des courses en vol (en mémoire du hub). */
async function cmdRaces(): Promise<void> {
  const { races } = await api<{ races: DroneRace[] }>('/api/races');
  if (races.length === 0) {
    console.log('Aucune course en vol — lancez-en une avec : npm run cli -- race <taskId>');
    return;
  }
  const icon: Record<string, string> = { running: '✈', succeeded: '✔', failed: '✘' };
  console.log(`⚔ ${races.length} course(s) en vol\n`);
  for (const r of races) {
    const flying = r.drones.filter((d) => d.status === 'running').length;
    console.log(`  Tâche ${r.taskId} — facteur ${r.factor}, ${flying} drone(s) encore en vol`);
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
  else if (cmd === 'conseil' && a1) await cmdConseil(a1, a2);
  else if (cmd === 'conseil-voir' && a1) await cmdConseilVoir(a1);
  else if (cmd === 'conseils') await cmdConseils();
  else if (cmd === 'github') await cmdGithub(a1);
  else if (cmd === 'github-import' && a1) await cmdGithubImport(a1);
  else if (cmd === 'livrer' && a1) await cmdLivrer(a1, a2);
  else if (cmd === 'fusionner' && a1 && a2) await cmdFusionner(a1, a2, a3);
  else if (cmd === 'membres') await cmdMembres();
  else if (cmd === 'exclure' && a1) await cmdExclure(a1);
  else if (cmd === 'revoquer' && a1) await cmdRevoquerBillet(a1);
  else {
    console.log(
      'Usage : npm run cli -- <state | mind ["<requête>"] | stings <projectId> | plan "<brief>" [heuristic|llm] | brief <projectId> "<brief>" | project <nom> [repoUrl] | tasks <projectId> <fichier.json> | watch <projectId> | cancel <taskId> | events [sinceId] | merge <projectId> | merge-run <projectId> [cmd test…] | replay [sinceId] | waggle | consensus <taskId> | doctor [chemin] [--json] | desinstaller [chemin] [--oui] [--json] | service <install|status|logs|uninstall> [--systeme] | sauvegarde [chemin] [--garder=N] [--vers=D] [--json] | mode [off|propose|gouverne|plein] [projectId] [--oui] | ghost | shift | pulse | report <projectId> | ask "<question>" [projectId] | race <taskId> [facteur] | races | invite [urlWS] [--uses N] [--hours H] [--insecure] | tunnel [--uses N] | cloudflare [--install | --setup <hote>] | github [filtre] | github-import <owner/repo> | livrer <taskId> [base] | fusionner <projectId> <pr> [squash|merge|rebase] | conseil <projectId> [question] | conseil-voir <sessionId> | conseils | membres | exclure <nodeId> | revoquer <billetId>>',
    );
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
