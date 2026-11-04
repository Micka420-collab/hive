// La mission courante d'un projet, telle que l'accueil la montre.
//
// ─── D'OÙ VIENT CE QU'ON AFFICHE ─────────────────────────────────────────────
//
// La Reine suit les missions elle-même (`orchestrator/missions.ts`) : une
// mission s'OUVRE quand une tâche vit sur un projet qui n'en a pas d'ouverte,
// et se CLÔT quand plus rien n'y vole. `GET /api/projects/:id/missions` en rend
// la liste, avec un résumé compté sur ses propres tables.
//
// L'appartenance exacte d'une tâche à une mission est rangée côté Reine
// (`missions_taches`) et n'est pas exposée tâche par tâche. Pour l'affichage,
// on prend donc la règle que la Reine applique elle-même à l'ouverture :
//   · toute tâche EN VOL du projet appartient à sa mission ouverte ;
//   · une tâche dont le dernier mouvement est postérieur à l'ouverture en fait
//     partie (une tâche ranimée par l'Evaluator garde sa naissance, pas son
//     dernier mouvement — c'est pourquoi on lit `updatedAt`, pas `createdAt`).
// Le COMPTE, lui, vient du résumé de la Reine quand il existe : la barre de
// progression ne dépend jamais de cette approximation.
//
// Module PUR : aucune horloge, aucune lecture réseau — tout arrive en argument.

import type { Task, TaskStatus } from '../../../src/shared/types';

/** La mission telle que `GET /api/projects/:id/missions` la décrit (le strict nécessaire). */
export interface MissionLue {
  readonly id: string;
  readonly ouverteA: number;
  readonly closeA: number | null;
  readonly resume: {
    readonly taches: Readonly<Record<string, number>>;
    readonly reussie: boolean | 'inconnu';
  } | null;
}

export type StatutMissionAffiche =
  'execution' | 'attente_agent' | 'attente' | 'a_valider' | 'reussie' | 'echouee';

export interface CompteMission {
  readonly total: number;
  readonly faites: number;
  readonly enCours: number;
  readonly enAttente: number;
  readonly echouees: number;
}

export interface MissionAffichee {
  /** `aucune` : ni mission ouverte, ni mission passée connue. */
  readonly etat: 'aucune' | 'en_cours' | 'terminee';
  readonly missionId: string | null;
  readonly ouverteA: number | null;
  readonly closeA: number | null;
  readonly taches: readonly Task[];
  readonly compte: CompteMission;
  readonly statut: StatutMissionAffiche | null;
  /** D'où vient le compte : le résumé de la Reine, ou les tâches de l'instantané. */
  readonly source: 'reine' | 'instantane';
}

const EN_VOL: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'pending',
  'ready',
  'assigned',
  'running',
]);

export function enVol(t: Pick<Task, 'status'>): boolean {
  return EN_VOL.has(t.status);
}

/** Marge sur l'horloge : `updatedAt` et `ouverteA` sont posés par la même Reine, à la ms. */
const MARGE_MS = 1_000;

export function compterTaches(taches: readonly Pick<Task, 'status'>[]): CompteMission {
  let faites = 0;
  let enCours = 0;
  let enAttente = 0;
  let echouees = 0;
  for (const t of taches) {
    if (t.status === 'done') faites++;
    else if (t.status === 'failed') echouees++;
    else if (t.status === 'running' || t.status === 'assigned') enCours++;
    else enAttente++;
  }
  return { total: taches.length, faites, enCours, enAttente, echouees };
}

/** Le compte du résumé de la Reine (`Compte<StatutMission>`), ou `null` s'il est illisible. */
export function compteDuResume(resume: MissionLue['resume']): CompteMission | null {
  if (!resume) return null;
  const n = (k: string): number => {
    const v = resume.taches[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const faites = n('done');
  const echouees = n('failed') + n('cancelled');
  const enCours = n('running') + n('assigned');
  const enAttente = n('pending') + n('ready');
  const total = faites + echouees + enCours + enAttente;
  if (total === 0) return null;
  return { total, faites, enCours, enAttente, echouees };
}

function trier(taches: Task[]): Task[] {
  // L'ordre du plan : la naissance, puis l'identifiant (un brief crée ses
  // tâches dans la même milliseconde ; l'identifiant porte leur rang).
  return taches.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id, 'en'));
}

export interface EntreeMission {
  readonly projectId: string;
  readonly taches: readonly Task[];
  /** `null` : la liste n'a pas (encore) répondu, ou la Reine l'a refusée. */
  readonly missions: readonly MissionLue[] | null;
  /** Une IA réelle est-elle en ligne ? (`agents-connectes.ts`) */
  readonly iaEnLigne: boolean;
  /** Une production terminée attend-elle un verdict humain ? */
  readonly aRevoir: (t: Task) => boolean;
}

export function missionCourante(e: EntreeMission): MissionAffichee {
  const duProjet = e.taches.filter((t) => t.projectId === e.projectId && t.ombre !== true);
  const ouverte = e.missions?.find((m) => m.closeA === null) ?? null;
  const derniere =
    ouverte ?? [...(e.missions ?? [])].sort((a, b) => b.ouverteA - a.ouverteA)[0] ?? null;

  let taches: Task[];
  let etat: MissionAffichee['etat'];
  if (derniere) {
    const debut = derniere.ouverteA - MARGE_MS;
    const fin = derniere.closeA === null ? Infinity : derniere.closeA + MARGE_MS;
    taches = duProjet.filter(
      (t) => (derniere.closeA === null && enVol(t)) || (t.updatedAt >= debut && t.createdAt <= fin),
    );
    etat = derniere.closeA === null ? 'en_cours' : 'terminee';
  } else {
    // Sans la liste de la Reine, on ne dit que ce que l'instantané prouve : ce
    // qui vole. Une mission passée ne se reconstruit pas sur des dates.
    taches = duProjet.filter(enVol);
    etat = taches.length > 0 ? 'en_cours' : 'aucune';
  }
  trier(taches);

  const compteReine = derniere ? compteDuResume(derniere.resume) : null;
  const compteLocal = compterTaches(taches);
  const compte = compteReine ?? compteLocal;

  return {
    etat,
    missionId: derniere?.id ?? null,
    ouverteA: derniere?.ouverteA ?? null,
    closeA: derniere?.closeA ?? null,
    taches,
    compte,
    statut: etat === 'aucune' ? null : statutDe(etat, compteLocal, taches, e),
    source: compteReine ? 'reine' : 'instantane',
  };
}

function statutDe(
  etat: 'en_cours' | 'terminee',
  c: CompteMission,
  taches: readonly Task[],
  e: EntreeMission,
): StatutMissionAffiche {
  const aValider = taches.some((t) => t.status === 'done' && e.aRevoir(t));
  if (etat === 'en_cours') {
    if (c.enCours > 0) return 'execution';
    if (c.enAttente > 0) return e.iaEnLigne ? 'attente' : 'attente_agent';
    if (aValider) return 'a_valider';
    return c.echouees > 0 ? 'echouee' : 'execution';
  }
  if (c.echouees > 0) return 'echouee';
  if (aValider) return 'a_valider';
  return 'reussie';
}

/** Pourcentage ENTIER des tâches terminées — `null` sans tâche (rien à diviser). */
export function pourcentage(c: CompteMission): number | null {
  if (c.total === 0) return null;
  return Math.round((100 * c.faites) / c.total);
}

/** Le titre d'une mission : le brief si ce navigateur l'a lancée, sinon sa première tâche. */
export function titreMission(
  m: Pick<MissionAffichee, 'taches'>,
  briefs: Readonly<Record<string, string>>,
): string | null {
  for (const t of m.taches) {
    const b = briefs[t.id];
    if (b) return b;
  }
  return m.taches[0]?.title ?? null;
}
