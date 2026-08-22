import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nomEnvDepuisLibelle,
  poserCleQueenEnv,
  validerSecretRequisition,
} from '../src/orchestrator/requisition-env.js';

describe('requisition-env', () => {
  it('mappe Seedance et agents courants', () => {
    expect(nomEnvDepuisLibelle('Clé Seedance')).toBe('SEEDANCE_API_KEY');
    expect(nomEnvDepuisLibelle('Clé Anthropic')).toBe('ANTHROPIC_API_KEY');
    expect(nomEnvDepuisLibelle('Clé OpenAI (Codex)')).toBe('OPENAI_API_KEY');
    expect(nomEnvDepuisLibelle('Clé ou session Anthropic (Claude Code)')).toBe('ANTHROPIC_API_KEY');
    expect(nomEnvDepuisLibelle('Clé xAI ou session Grok')).toBe('XAI_API_KEY');
    expect(validerSecretRequisition('sk-test')).toEqual({ ok: true, secret: 'sk-test' });
    expect(validerSecretRequisition('')).toEqual({ ok: false, motif: 'vide' });
    expect(validerSecretRequisition('a b')).toEqual({ ok: false, motif: 'forme' });
  });

  it('écrit et remplace dans .env sans exposer ailleurs', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-reqenv-'));
    const envPath = path.join(dir, '.env');
    try {
      poserCleQueenEnv(envPath, 'SEEDANCE_API_KEY', 'sk-un', 'test');
      expect(readFileSync(envPath, 'utf8')).toContain('SEEDANCE_API_KEY=sk-un');
      poserCleQueenEnv(envPath, 'SEEDANCE_API_KEY', 'sk-deux', 'test');
      const contenu = readFileSync(envPath, 'utf8');
      expect(contenu).toContain('SEEDANCE_API_KEY=sk-deux');
      expect(contenu).not.toContain('sk-un');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
