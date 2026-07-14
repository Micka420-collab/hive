// Tests du suivi des sous-agents (reines & abeilles, Palier 3) : traduire un flux
// stream-json d'agent en objets SubAgent, en direct et de façon tolérante.

import { describe, expect, it } from 'vitest';
import { createSubAgentTracker } from '../src/adapters/subagent-parser.js';
import { ID_PATTERN } from '../src/shared/protocol.js';

const line = (obj: unknown): string => JSON.stringify(obj);
const toolUse = (id: string, name: string, input: Record<string, unknown>): string =>
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (toolUseId: string, isError = false): string =>
  line({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }] },
  });

describe('createSubAgentTracker', () => {
  it('ouvre un sous-agent sur un tool_use de délégation, le clôt sur son résultat', () => {
    const t = createSubAgentTracker();

    const s1 = t.feed(toolUse('toolu_a', 'Task', { description: 'Analyser le module auth' }));
    expect(s1).toEqual([{ id: 'sa-1', name: 'Analyser le module auth', status: 'running' }]);

    // Un outil non-délégation (Bash) n'ouvre pas de sous-agent.
    expect(t.feed(toolUse('toolu_x', 'Bash', { command: 'ls' }))).toBeNull();

    const s2 = t.feed(toolUse('toolu_b', 'Task', { prompt: 'Écrire les tests' }));
    expect(s2?.map((s) => s.id)).toEqual(['sa-1', 'sa-2']);
    expect(s2?.[1]?.name).toBe('Écrire les tests');

    const s3 = t.feed(toolResult('toolu_a'));
    expect(s3?.find((s) => s.id === 'sa-1')?.status).toBe('done');

    const s4 = t.feed(toolResult('toolu_b', true));
    expect(s4?.find((s) => s.id === 'sa-2')?.status).toBe('failed');
  });

  it('ignore lignes non-JSON, JSON invalide et messages sans contenu', () => {
    const t = createSubAgentTracker();
    expect(t.feed('bienvenue dans claude code')).toBeNull();
    expect(t.feed('{pas du json')).toBeNull();
    expect(t.feed(line({ type: 'result', total_cost: 0.1 }))).toBeNull();
    expect(
      t.feed(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } })),
    ).toBeNull();
    expect(t.list()).toEqual([]);
  });

  it('produit des ids conformes à ID_PATTERN et des noms non vides', () => {
    const t = createSubAgentTracker();
    t.feed(toolUse('toolu_1', 'Task', {})); // sans description ni prompt → nom par défaut
    for (const sa of t.list()) {
      expect(ID_PATTERN.test(sa.id)).toBe(true);
      expect(sa.name.length).toBeGreaterThan(0);
    }
  });

  it('borne le nombre de sous-agents suivis (contrainte protocole)', () => {
    const t = createSubAgentTracker();
    for (let i = 0; i < 40; i++) t.feed(toolUse(`toolu_${i}`, 'Task', { description: `s${i}` }));
    expect(t.list().length).toBeLessThanOrEqual(32);
  });
});
