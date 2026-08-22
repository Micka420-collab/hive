import { describe, expect, it } from 'vitest';
import {
  estEchecCredential,
  requisitionDepuisEchecInfra,
} from '../src/shared/requisition-infra.js';

describe('requisition-infra', () => {
  it('détecte les échecs credentials dans les logs', () => {
    expect(estEchecCredential('Error 401 Unauthorized')).toBe(true);
    expect(estEchecCredential('invalid api key')).toBe(true);
    expect(estEchecCredential('syntax error in foo.ts')).toBe(false);
  });

  it('propose une réquisition cle_api sur échec auth', () => {
    const r = requisitionDepuisEchecInfra('codex', '401 missing OPENAI_API_KEY', 'Ma tâche', {});
    expect(r?.genre).toBe('cle_api');
    expect(r?.detail).toMatch(/Ma tâche/i);
  });

  it('silence si pas un échec credential', () => {
    expect(requisitionDepuisEchecInfra('codex', 'segfault', 'T', {})).toBeNull();
  });
});
