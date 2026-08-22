// Pose clé Queen — mapping libellé → .env (ADR 0010 lot 7).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nomEnvDepuisLibelle,
  poserCleQueenEnv,
  validerSecretRequisition,
} from '../src/orchestrator/requisition-env.js';

describe('requisition-env — forme', () => {
  it('mappe Seedance et valide le secret', () => {
    expect(nomEnvDepuisLibelle('Clé Seedance')).toBe('SEEDANCE_API_KEY');
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
