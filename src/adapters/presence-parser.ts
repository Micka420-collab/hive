// Présence Rayon — lit le flux stream-json et constate Read / Edit / Write.
//
// Tolérant : ligne non-JSON ou outil inconnu → ignoré (jamais d'erreur, jamais
// de faux fichier ouvert). Miroir de `subagent-parser.ts`.

import {
  PRESENCES_MAX,
  cheminDepuisInput,
  outilPresenceDe,
  type PresenceFichier,
} from '../shared/presence.js';

export interface PresenceTracker {
  /** Ingère une ligne du flux. Snapshot si changement, sinon null. */
  feed(line: string): PresenceFichier[] | null;
  /** Fichiers actuellement ouverts (tool_use sans tool_result). */
  list(): PresenceFichier[];
}

interface Block {
  type?: unknown;
  name?: unknown;
  id?: unknown;
  tool_use_id?: unknown;
  input?: unknown;
}

/**
 * Suit les fichiers ouverts : `tool_use` Read/Edit/Write ouvre ; le
 * `tool_result` correspondant ferme. Les autres outils (Bash, Task…) n'existent
 * pas ici — on n'invente pas une présence.
 */
export function createPresenceTracker(): PresenceTracker {
  const byToolId = new Map<string, PresenceFichier>();
  const order: string[] = [];

  const snapshot = (): PresenceFichier[] =>
    order.map((tid) => byToolId.get(tid)).filter((p): p is PresenceFichier => p !== undefined);

  return {
    feed(line: string): PresenceFichier[] | null {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return null;
      let ev: { message?: { content?: unknown } };
      try {
        ev = JSON.parse(trimmed) as { message?: { content?: unknown } };
      } catch {
        return null;
      }
      const content = ev?.message?.content;
      if (!Array.isArray(content)) return null;

      let changed = false;
      for (const raw of content) {
        if (typeof raw !== 'object' || raw === null) continue;
        const block = raw as Block;

        if (block.type === 'tool_use' && typeof block.name === 'string') {
          const outil = outilPresenceDe(block.name);
          if (!outil) continue;
          const toolId = typeof block.id === 'string' ? block.id : '';
          if (!toolId || byToolId.has(toolId)) continue;
          if (byToolId.size >= PRESENCES_MAX) continue;
          const chemin = cheminDepuisInput(block.input);
          if (!chemin.ok) continue;
          byToolId.set(toolId, { toolUseId: toolId, chemin: chemin.chemin, outil });
          order.push(toolId);
          changed = true;
        } else if (block.type === 'tool_result') {
          const toolId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
          if (toolId && byToolId.has(toolId)) {
            byToolId.delete(toolId);
            const i = order.indexOf(toolId);
            if (i >= 0) order.splice(i, 1);
            changed = true;
          }
        }
      }
      return changed ? snapshot() : null;
    },
    list: snapshot,
  };
}
