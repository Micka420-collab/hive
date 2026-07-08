// Liaison temps réel avec l'orchestrateur : le dashboard s'abonne au flux
// WebSocket (snapshots d'état + journal d'événements). Le token est mémorisé
// localement ; en mode simulation, la valeur par défaut suffit.

import { parseServerMessage } from '../../src/shared/protocol';
import type { HiveEvent, Project, StateSnapshot, Task, TaskResult } from '../../src/shared/types';

const TOKEN_KEY = 'hive.token';
export const DEFAULT_TOKEN = 'change-me';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? DEFAULT_TOKEN;
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** fetch authentifié qui lève une erreur lisible sur réponse non-OK. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-hive-token': getToken(), ...init?.headers },
  });
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      // Endpoints custom → { error } (déjà précis). Validation de schéma Fastify
      // → { message } détaillé + { error: "Bad Request" } générique : le message
      // est alors le plus utile, on le préfère quand il est présent.
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* corps non-JSON */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface NewTaskInput {
  id?: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
}

/** Crée un projet. */
export function createProject(input: {
  name: string;
  repoUrl?: string;
  description?: string;
}): Promise<Project> {
  return api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) });
}

/** Ajoute un lot de tâches (DAG) à un projet. */
export function addTasks(projectId: string, tasks: NewTaskInput[]): Promise<Task[]> {
  return api<Task[]>(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
}

export interface PlanResponse {
  tasks: NewTaskInput[];
  source: 'heuristic' | 'llm';
  note?: string;
}

/** Queen Bee : génère un DAG de tâches à partir d'un brief (Palier 2). */
export function planBrief(
  brief: string,
  mode: 'auto' | 'heuristic' | 'llm' = 'auto',
): Promise<PlanResponse> {
  return api<PlanResponse>('/api/plan', { method: 'POST', body: JSON.stringify({ brief, mode }) });
}

/** Résultats (diff/logs) d'une tâche, pour revue humaine. */
export function fetchResults(taskId: string): Promise<TaskResult[]> {
  return api<TaskResult[]>(`/api/tasks/${taskId}/results`);
}

export interface Memory {
  id: number;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
  score: number | null;
}

/** Hive Mind : souvenirs pertinents (avec `q`) ou récents. */
export function fetchMemories(
  q?: string,
  limit = 8,
): Promise<{ total: number; memories: Memory[] }> {
  const query =
    q && q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=${limit}` : `?limit=${limit}`;
  return api<{ total: number; memories: Memory[] }>(`/api/hive-mind${query}`);
}

export interface Conflict {
  a: string;
  b: string;
  severity: 'high' | 'low';
  sharedPaths: string[];
  sharedTerms: string[];
}

/** Sting Detector : conflits potentiels d'un projet. */
export function fetchConflicts(projectId: string): Promise<{ conflicts: Conflict[] }> {
  return api<{ conflicts: Conflict[] }>(`/api/projects/${projectId}/conflicts`);
}

/** Annule une tâche (le nœud abandonne). */
export function cancelTask(taskId: string): Promise<Task> {
  return api<Task>(`/api/tasks/${taskId}/cancel`, { method: 'POST', body: '{}' });
}

export interface InviteResponse {
  invite: string;
  url: string;
  label: string;
  joinCommand: string;
  note: string;
}

/** Demande une invitation à l'orchestrateur (URL WS optionnelle à annoncer). */
export async function fetchInvite(url?: string): Promise<InviteResponse> {
  const query = url ? `?url=${encodeURIComponent(url)}` : '';
  const res = await fetch(`/api/invite${query}`, { headers: { 'x-hive-token': getToken() } });
  if (!res.ok) throw new Error(`invitation refusée (${res.status})`);
  return (await res.json()) as InviteResponse;
}

export interface FeedHandlers {
  onState: (snapshot: StateSnapshot) => void;
  onEvent: (event: HiveEvent) => void;
  onStatus: (connected: boolean) => void;
}

export interface HiveFeed {
  close(): void;
}

/** Connexion WebSocket auto-reconnectante au flux d'état de la ruche. */
export function connectFeed(handlers: FeedHandlers): HiveFeed {
  let ws: WebSocket | null = null;
  let closed = false;
  let retryMs = 1_000;
  let timer: number | undefined;

  const open = (): void => {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      retryMs = 1_000;
      handlers.onStatus(true);
      ws?.send(JSON.stringify({ type: 'subscribe', token: getToken() }));
    };

    ws.onmessage = (e: MessageEvent) => {
      const msg = parseServerMessage(typeof e.data === 'string' ? e.data : '');
      if (!msg) return;
      if (msg.type === 'state') handlers.onState(msg.snapshot);
      else if (msg.type === 'event') handlers.onEvent(msg.event);
    };

    ws.onclose = () => {
      handlers.onStatus(false);
      if (!closed) {
        timer = window.setTimeout(open, retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      }
    };
  };

  open();
  return {
    close(): void {
      closed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      ws?.close();
    },
  };
}
