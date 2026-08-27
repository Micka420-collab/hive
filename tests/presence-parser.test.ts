// Parser de présence Rayon — flux stream-json → fichiers ouverts constatés.

import { describe, expect, it } from 'vitest';
import { createPresenceTracker } from '../src/adapters/presence-parser.js';
import { PRESENCES_MAX } from '../src/shared/presence.js';

const line = (obj: unknown): string => JSON.stringify(obj);
const toolUse = (id: string, name: string, input: Record<string, unknown>): string =>
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (toolUseId: string, isError = false): string =>
  line({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }] },
  });

describe('createPresenceTracker', () => {
  it('ouvre sur Read/Edit/Write, ignore Bash/Task, ferme sur tool_result', () => {
    const t = createPresenceTracker();

    const s1 = t.feed(toolUse('toolu_a', 'Edit', { file_path: 'src/a.ts' }));
    expect(s1).toEqual([{ toolUseId: 'toolu_a', chemin: 'src/a.ts', outil: 'Edit' }]);

    expect(t.feed(toolUse('toolu_x', 'Bash', { command: 'ls' }))).toBeNull();
    expect(t.feed(toolUse('toolu_y', 'Task', { description: 'sous' }))).toBeNull();

    const s2 = t.feed(toolUse('toolu_b', 'Read', { path: '/tmp/w/b.md' }));
    expect(s2?.map((p) => p.toolUseId)).toEqual(['toolu_a', 'toolu_b']);

    const s3 = t.feed(toolResult('toolu_a'));
    expect(s3?.map((p) => p.toolUseId)).toEqual(['toolu_b']);

    const s4 = t.feed(toolResult('toolu_b'));
    expect(s4).toEqual([]);
    expect(t.list()).toEqual([]);
  });

  it('mappe StrReplace → Edit ; refuse chemin traversant', () => {
    const t = createPresenceTracker();
    const s = t.feed(toolUse('toolu_s', 'StrReplace', { path: 'src/x.ts' }));
    expect(s?.[0]?.outil).toBe('Edit');
    expect(t.feed(toolUse('toolu_bad', 'Write', { file_path: '../secret' }))).toBeNull();
  });

  it('ignore lignes non-JSON et messages sans outil', () => {
    const t = createPresenceTracker();
    expect(t.feed('pas json')).toBeNull();
    expect(t.feed('{nope')).toBeNull();
    expect(
      t.feed(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })),
    ).toBeNull();
    expect(t.list()).toEqual([]);
  });

  it('borne le nombre de présences suivies', () => {
    const t = createPresenceTracker();
    for (let i = 0; i < PRESENCES_MAX + 10; i++) {
      t.feed(toolUse(`toolu_${i}`, 'Read', { file_path: `f${i}.ts` }));
    }
    expect(t.list().length).toBeLessThanOrEqual(PRESENCES_MAX);
  });
});
