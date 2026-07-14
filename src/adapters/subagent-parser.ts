// Reines & abeilles (Palier 3) : rendre visibles en direct les SOUS-AGENTS qu'un
// gros agent (ex. Claude Code) engendre. On lit le flux JSON de l'agent
// (`--output-format stream-json`) et on traduit les appels d'outil de délégation
// (Task/agent/subagent) en objets SubAgent remontés au hub → butineuses visibles
// sur le Swarm View.
//
// Tolérant par construction : toute ligne non-JSON ou de forme inattendue est
// ignorée (aucune sous-agent → dégradation propre, jamais d'erreur).

import { LIMITS } from '../shared/protocol.js';
import type { SubAgent } from '../shared/types.js';

/** Noms d'outils considérés comme « délégation à un sous-agent ». */
const DELEGATION_TOOLS = new Set(['task', 'agent', 'subagent', 'dispatch_agent', 'run_agent']);

const clampName = (s: string): string => {
  const clean = s.replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
  return clean.length > 0 ? clean : 'sous-agent';
};

export interface SubAgentTracker {
  /** Ingère une ligne du flux. Retourne la liste mise à jour si elle a changé, sinon null. */
  feed(line: string): SubAgent[] | null;
  /** Liste courante des sous-agents. */
  list(): SubAgent[];
}

interface Block {
  type?: unknown;
  name?: unknown;
  id?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  input?: { description?: unknown; prompt?: unknown };
}

/**
 * Suit les sous-agents à partir d'un flux stream-json : un `tool_use` de
 * délégation ouvre un sous-agent (running) ; le `tool_result` correspondant le
 * clôt (done, ou failed si erreur). Les ids exposés (`sa-N`) respectent
 * ID_PATTERN et le nombre est borné à LIMITS.subAgents (contrainte protocole).
 */
export function createSubAgentTracker(): SubAgentTracker {
  const byToolId = new Map<string, SubAgent>();
  const order: string[] = [];
  let counter = 0;

  const snapshot = (): SubAgent[] => order.map((tid) => byToolId.get(tid) as SubAgent);

  return {
    feed(line: string): SubAgent[] | null {
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
        if (
          block.type === 'tool_use' &&
          typeof block.name === 'string' &&
          DELEGATION_TOOLS.has(block.name.toLowerCase())
        ) {
          const toolId = typeof block.id === 'string' ? block.id : '';
          if (toolId && !byToolId.has(toolId) && byToolId.size < LIMITS.subAgents) {
            counter += 1;
            const label =
              (typeof block.input?.description === 'string' && block.input.description) ||
              (typeof block.input?.prompt === 'string' && block.input.prompt) ||
              `sous-agent ${counter}`;
            byToolId.set(toolId, {
              id: `sa-${counter}`,
              name: clampName(label),
              status: 'running',
            });
            order.push(toolId);
            changed = true;
          }
        } else if (block.type === 'tool_result') {
          const toolId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
          const sa = byToolId.get(toolId);
          if (sa && sa.status === 'running') {
            sa.status = block.is_error === true ? 'failed' : 'done';
            changed = true;
          }
        }
      }
      return changed ? snapshot() : null;
    },
    list: snapshot,
  };
}
