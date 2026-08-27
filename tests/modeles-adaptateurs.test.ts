import { describe, expect, it } from 'vitest';
import { argvCodex } from '../src/adapters/codex.js';
import { argvGrok } from '../src/adapters/grok.js';

describe('modèle choisi transmis aux applications IA', () => {
  it('Codex reçoit --model avant le terminateur et le prompt', () => {
    expect(argvCodex('-prompt', 'gpt-codex-local')).toEqual([
      'exec',
      '--model',
      'gpt-codex-local',
      '--',
      '-prompt',
    ]);
    expect(argvCodex('prompt')).toEqual(['exec', '--', 'prompt']);
  });

  it('Grok reçoit --model avant le terminateur et le prompt', () => {
    expect(argvGrok('-prompt', 'grok-equipe')).toEqual([
      '-p',
      '--yolo',
      '--model',
      'grok-equipe',
      '--',
      '-prompt',
    ]);
    expect(argvGrok('prompt')).toEqual(['-p', '--yolo', '--', 'prompt']);
  });
});
