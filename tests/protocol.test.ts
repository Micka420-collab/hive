// Tests de validation du protocole WebSocket : les messages malformés ou
// malveillants sont rejetés, les champs inconnus ne sont jamais propagés.

import { describe, expect, it } from 'vitest';
import { LIMITS, parseClientMessage, parseServerMessage } from '../src/shared/protocol.js';

const register = {
  type: 'register',
  token: 'jeton',
  name: 'noeud',
  ownerName: 'membre',
  agentType: 'shell',
  maxConcurrency: 2,
};

describe('parseClientMessage', () => {
  it('accepte un register valide et ne conserve que les champs connus', () => {
    const msg = parseClientMessage(JSON.stringify({ ...register, injecte: 'nope' }));
    expect(msg).not.toBeNull();
    expect(msg).not.toHaveProperty('injecte');
    expect(msg?.type).toBe('register');
  });

  it('rejette JSON invalide, tableaux, non-chaînes et types inconnus', () => {
    expect(parseClientMessage('pas du json')).toBeNull();
    expect(parseClientMessage('[1,2]')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage(42 as unknown as string)).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'hack' }))).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('rejette un register invalide (bornes, types, identifiants)', () => {
    expect(parseClientMessage(JSON.stringify({ ...register, maxConcurrency: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, maxConcurrency: 999 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, maxConcurrency: '2' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, token: '' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, name: 'x'.repeat(200) }))).toBeNull();
    // Un nodeId ne peut pas contenir de caractères de chemin (anti-traversal).
    expect(parseClientMessage(JSON.stringify({ ...register, nodeId: '../evil' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, nodeId: 'a/b' }))).toBeNull();
  });

  it('rejette task_update et task_result malformés', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'task_update', taskId: 'a b', status: 'running' })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: 'task_update', taskId: 't1', status: 'done' })),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'task_update',
          taskId: 't1',
          status: 'running',
          subAgents: [{ id: 'x', name: '', status: 'running' }],
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't1',
          success: 'oui',
          diff: '',
          logs: '',
          durationMs: 1,
          subAgents: [],
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't1',
          success: true,
          diff: '',
          logs: '',
          durationMs: -1,
          subAgents: [],
        }),
      ),
    ).toBeNull();
  });

  it('rejette un message dépassant la taille maximale', () => {
    const big = JSON.stringify({
      type: 'task_result',
      taskId: 't1',
      success: true,
      diff: 'x'.repeat(LIMITS.message),
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    expect(parseClientMessage(big)).toBeNull();
  });

  it('accepte un task_result valide aux limites', () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: 'task_result',
        taskId: 't-1_A',
        success: false,
        diff: '',
        logs: 'journal',
        durationMs: 0,
        subAgents: [{ id: 'sa1', name: 'ouvrière', status: 'done' }],
      }),
    );
    expect(msg?.type).toBe('task_result');
  });
});

describe('parseServerMessage', () => {
  it('accepte les types connus et rejette le reste', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'registered', nodeId: 'n1' }))).not.toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'intrus' }))).toBeNull();
    expect(parseServerMessage('')).toBeNull();
    expect(parseServerMessage('{}')).toBeNull();
  });
});
