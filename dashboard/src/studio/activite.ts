// L'activité récente, telle que la colonne de droite la raconte.
//
// Le Journal dit TOUT, dans le vocabulaire de la ruche (`ligneDuJournal`). La
// colonne ne garde que ce qui répond à « que se passe-t-il ? » pour une
// personne qui regarde son projet : une tâche finie, une tâche qui échoue, une
// tâche confiée, une machine qui arrive ou s'en va, une mission qui s'ouvre ou
// se clôt, un verdict, une fusion. Le reste est à un clic (« Voir tout »).
//
// Module PUR : les titres des tâches arrivent par une table, l'heure par
// l'événement — rien n'est inventé, et un événement dont la tâche n'est plus
// dans l'instantané garde son identifiant court plutôt qu'un titre deviné.

import type { HiveEvent, HiveNode, Task } from '../../../src/shared/types';
import type { Translate } from '../i18n';

export type GenreActivite = 'succes' | 'echec' | 'encours' | 'info' | 'attention';

export interface ItemActivite {
  readonly id: number;
  readonly ts: number;
  readonly genre: GenreActivite;
  readonly texte: string;
  readonly tacheId: string | null;
}

const court = (id: unknown): string => (typeof id === 'string' ? id.slice(0, 8) : '?');

interface Contexte {
  readonly taches: ReadonlyMap<string, Pick<Task, 'title' | 'projectId'>>;
  readonly noeuds: ReadonlyMap<string, Pick<HiveNode, 'name'>>;
  readonly t: Translate;
}

function titre(c: Contexte, taskId: unknown): string {
  const tache = typeof taskId === 'string' ? c.taches.get(taskId) : undefined;
  return tache ? `« ${tache.title} »` : c.t(`la tâche ${court(taskId)}`, `task ${court(taskId)}`);
}

function machine(c: Contexte, p: Record<string, unknown>): string {
  if (typeof p.name === 'string' && p.name !== '') return p.name;
  if (typeof p.label === 'string' && p.label !== '') return p.label;
  const n = typeof p.nodeId === 'string' ? c.noeuds.get(p.nodeId) : undefined;
  return n?.name ?? court(p.nodeId);
}

/** Un événement → une ligne, ou `null` s'il n'a pas sa place dans la colonne. */
export function itemDe(ev: HiveEvent, c: Contexte): Omit<ItemActivite, 'id' | 'ts'> | null {
  const p = ev.payload;
  const tacheId = typeof p.taskId === 'string' ? p.taskId : null;
  const { t } = c;
  switch (ev.type) {
    case 'task_done':
      return {
        genre: 'succes',
        texte: t(`${titre(c, p.taskId)} terminée`, `${titre(c, p.taskId)} done`),
        tacheId,
      };
    case 'task_failed':
      return {
        genre: 'echec',
        texte: t(`${titre(c, p.taskId)} a échoué`, `${titre(c, p.taskId)} failed`),
        tacheId,
      };
    case 'task_cancelled':
      return {
        genre: 'info',
        texte: t(`${titre(c, p.taskId)} arrêtée`, `${titre(c, p.taskId)} stopped`),
        tacheId,
      };
    case 'task_started':
    case 'task_assigned':
      return {
        genre: 'encours',
        texte: t(
          `${titre(c, p.taskId)} confiée à ${machine(c, p)}`,
          `${titre(c, p.taskId)} handed to ${machine(c, p)}`,
        ),
        tacheId,
      };
    case 'task_reviewed':
      return p.state === 'approved'
        ? {
            genre: 'succes',
            texte: t(`${titre(c, p.taskId)} validée`, `${titre(c, p.taskId)} approved`),
            tacheId,
          }
        : p.state === 'rejected'
          ? {
              genre: 'attention',
              texte: t(`${titre(c, p.taskId)} refusée`, `${titre(c, p.taskId)} rejected`),
              tacheId,
            }
          : null;
    case 'node_online':
      return {
        genre: 'info',
        texte: t(`${machine(c, p)} est en ligne`, `${machine(c, p)} is online`),
        tacheId: null,
      };
    case 'node_offline':
      return {
        genre: 'attention',
        texte: t(`${machine(c, p)} s’est déconnectée`, `${machine(c, p)} went offline`),
        tacheId: null,
      };
    case 'node_joined':
      return {
        genre: 'succes',
        texte: t(`${machine(c, p)} a rejoint la ruche`, `${machine(c, p)} joined the hive`),
        tacheId: null,
      };
    case 'porte_ouverte':
      return {
        genre: 'info',
        texte: t('Un lien d’invitation a été ouvert', 'An invitation link was opened'),
        tacheId: null,
      };
    case 'mission_ouverte': {
      const n = typeof p.taches === 'number' ? p.taches : null;
      return {
        genre: 'encours',
        texte:
          n === null
            ? t('Mission ouverte', 'Mission opened')
            : t(`Mission ouverte — ${n} tâche(s) au plan`, `Mission opened — ${n} planned task(s)`),
        tacheId: null,
      };
    }
    case 'mission_close':
      return p.reussie === true
        ? {
            genre: 'succes',
            texte: t('Mission terminée avec succès', 'Mission completed successfully'),
            tacheId: null,
          }
        : p.reussie === false
          ? {
              genre: 'echec',
              texte: t('Mission terminée avec des échecs', 'Mission ended with failures'),
              tacheId: null,
            }
          : { genre: 'info', texte: t('Mission terminée', 'Mission ended'), tacheId: null };
    case 'merge_completed':
      return { genre: 'succes', texte: t('Fusion terminée', 'Merge completed'), tacheId: null };
    case 'merge_failed':
      return { genre: 'echec', texte: t('Fusion échouée', 'Merge failed'), tacheId: null };
    default:
      return null;
  }
}

/** Le projet d'un événement : porté par lui, ou par sa tâche. */
function projetDe(ev: HiveEvent, c: Contexte): string | null {
  if (typeof ev.payload.projectId === 'string') return ev.payload.projectId;
  if (typeof ev.payload.taskId === 'string')
    return c.taches.get(ev.payload.taskId)?.projectId ?? null;
  return null;
}

/**
 * Les `limite` derniers faits dignes de la colonne, du plus récent au plus
 * ancien. Avec un projet, on garde les faits de CE projet et ceux de la ruche
 * entière (une machine qui arrive concerne tout le monde) ; jamais ceux d'un
 * autre projet.
 */
export function activiteRecente(
  events: readonly HiveEvent[],
  taches: readonly Task[],
  noeuds: readonly HiveNode[],
  t: Translate,
  opts: { projetId?: string | null; limite?: number } = {},
): ItemActivite[] {
  const c: Contexte = {
    taches: new Map(taches.map((x) => [x.id, x])),
    noeuds: new Map(noeuds.map((n) => [n.id, n])),
    t,
  };
  const limite = opts.limite ?? 6;
  const out: ItemActivite[] = [];
  // `task_assigned` puis `task_started` disent deux fois « confiée » : on ne
  // garde que le premier rencontré (le plus récent) pour une même tâche.
  const confiees = new Set<string>();
  for (let i = events.length - 1; i >= 0 && out.length < limite; i--) {
    const ev = events[i]!;
    if (opts.projetId) {
      const projet = projetDe(ev, c);
      if (projet !== null && projet !== opts.projetId) continue;
    }
    const item = itemDe(ev, c);
    if (!item) continue;
    if (item.genre === 'encours' && item.tacheId) {
      if (confiees.has(item.tacheId)) continue;
      confiees.add(item.tacheId);
    }
    out.push({ ...item, id: ev.id, ts: ev.ts });
  }
  return out;
}

/** « il y a 2 min » — l'heure relative, ou l'heure tout court au-delà d'un jour. */
export function ilYA(ts: number, maintenant: number, t: Translate): string {
  const s = Math.max(0, Math.round((maintenant - ts) / 1000));
  if (s < 45) return t('à l’instant', 'just now');
  const min = Math.round(s / 60);
  if (min < 60) return t(`il y a ${min} min`, `${min} min ago`);
  const h = Math.round(min / 60);
  if (h < 24) return t(`il y a ${h} h`, `${h} h ago`);
  return new Date(ts).toLocaleDateString(t('fr-FR', 'en-GB'), { day: 'numeric', month: 'short' });
}
