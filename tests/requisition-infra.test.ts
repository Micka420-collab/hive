import { describe, expect, it } from 'vitest';
import {
  estEchecBinaire,
  estEchecCredential,
  nomBinaireDepuisLogs,
  requisitionDepuisEchecInfra,
} from '../src/shared/requisition-infra.js';

describe('requisition-infra', () => {
  it('détecte les échecs credentials dans les logs', () => {
    expect(estEchecCredential('Error 401 Unauthorized')).toBe(true);
    expect(estEchecCredential('invalid api key')).toBe(true);
    expect(estEchecCredential('syntax error in foo.ts')).toBe(false);
  });

  it('détecte les échecs binaire / ENOENT', () => {
    expect(estEchecBinaire('spawn claude ENOENT')).toBe(true);
    expect(estEchecBinaire('[hive] échec du lancement de « agent » : spawn agent ENOENT')).toBe(
      true,
    );
    expect(estEchecBinaire('bash: codex: command not found')).toBe(true);
    expect(estEchecBinaire('Error 401 Unauthorized')).toBe(false);
  });

  it('extrait le nom du binaire depuis le message hive', () => {
    expect(nomBinaireDepuisLogs('[hive] échec du lancement de « claude » : spawn ENOENT')).toBe(
      'claude',
    );
    expect(nomBinaireDepuisLogs('rien')).toBeNull();
  });

  it('propose une réquisition cle_api sur échec auth', () => {
    const r = requisitionDepuisEchecInfra('codex', '401 missing OPENAI_API_KEY', 'Ma tâche', {});
    expect(r?.genre).toBe('cle_api');
    expect(r?.detail).toMatch(/Ma tâche/i);
  });

  it('propose une réquisition binaire sur ENOENT (pas cle_api)', () => {
    const logs = '[hive] échec du lancement de « claude » : spawn claude ENOENT';
    const r = requisitionDepuisEchecInfra('claude-code', logs, 'Écrire le pont', {});
    expect(r?.genre).toBe('binaire');
    expect(r?.libelle).toMatch(/claude/i);
    expect(r?.detail).toMatch(/Écrire le pont/i);
    expect(r?.detail).toMatch(/Installez/i);
  });

  it('credentials prioritaire si les deux motifs apparaissent', () => {
    const logs = '401 Unauthorized — also spawn ENOENT';
    const r = requisitionDepuisEchecInfra('codex', logs, 'T', {});
    expect(r?.genre).toBe('cle_api');
  });

  it('silence si pas un échec credential ni binaire', () => {
    expect(requisitionDepuisEchecInfra('codex', 'segfault', 'T', {})).toBeNull();
  });
});
