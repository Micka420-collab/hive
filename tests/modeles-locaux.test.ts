import { describe, expect, it } from 'vitest';
import {
  inventorierModelesLocaux,
  modeleLocalValide,
  modelesDepuisClaudeSettings,
  modelesDepuisCursorConfig,
  modelesDepuisToml,
} from '../src/node-client/modeles-locaux.js';

describe('inventaire local des modèles — aucune promesse de compte', () => {
  it('lit les modèles configurés de Claude sans perdre les suggestions', () => {
    const fichiers: Record<string, string> = {
      '/home/test/.claude/settings.json': JSON.stringify({
        model: 'claude-configure',
        fallbackModel: 'claude-repli',
        availableModels: ['claude-equipe'],
        modelPicker: { options: [{ model: 'claude-menu' }] },
      }),
    };
    const modeles = inventorierModelesLocaux(
      'claude-code',
      { HOME: '/home/test', ANTHROPIC_MODEL: 'claude-env' },
      {
        existe: (p) => p in fichiers,
        lire: (p) => fichiers[p] ?? '',
        plateforme: 'linux',
      },
    );
    expect(modeles).toEqual(
      expect.arrayContaining([
        { id: 'claude-env', source: 'environnement' },
        { id: 'claude-configure', source: 'configuration' },
        { id: 'claude-menu', source: 'configuration' },
        { id: 'sonnet', source: 'suggestion' },
      ]),
    );
  });

  it('lit le modèle Cursor sélectionné dans cli-config.json', () => {
    expect(
      modelesDepuisCursorConfig({ model: { modelId: 'cursor-fast', displayModelId: 'ancien' } }),
    ).toEqual(['cursor-fast']);
    expect(modelesDepuisCursorConfig({ model: { inconnu: true } })).toEqual([]);
  });

  it('ne sort jamais le provider-id ni les secrets d’une table Grok', () => {
    const toml = [
      'model = "gpt-configure"',
      '[model."equipe"]',
      'model = "deployment-prive"',
      'api_key = "SECRET-INTERDIT"',
      'base_url = "https://interne.invalid"',
    ].join('\n');
    const modeles = modelesDepuisToml(toml);
    expect(modeles).toEqual(['gpt-configure', 'equipe']);
    expect(modeles.join(' ')).not.toMatch(/deployment|SECRET|https/);
  });

  it('tolère les configurations malformées et borne les sélecteurs', () => {
    expect(modelesDepuisClaudeSettings(null)).toEqual([]);
    expect(modeleLocalValide('sonnet')).toBe(true);
    expect(modeleLocalValide('--danger')).toBe(false);
    expect(modeleLocalValide('modele\ninjecte')).toBe(false);
    expect(modeleLocalValide('\u001b[31mrouge')).toBe(false);
  });
});
