// Tests unitaires pour Queen Bee — mock du LLM pour que les tests
// s'exécutent sans appel réseau ni clé API.

import { describe, expect, test } from 'vitest';
import { briefToDAG, loadQueenBeeConfig } from '../src/orchestrator/queen-bee.js';

const FAKE_KEY = 'sk-test-12345678901234567890';

describe('Queen Bee', () => {
  test('loadQueenBeeConfig lit les variables', () => {
    const cfg = loadQueenBeeConfig({
      QUEEN_BEE_API_KEY: FAKE_KEY,
      QUEEN_BEE_MODEL: 'openai/gpt-4o',
    });
    expect(cfg.apiKey).toBe(FAKE_KEY);
    expect(cfg.model).toBe('openai/gpt-4o');
  });

  test('loadQueenBeeConfig fallback sur OPENROUTER_API_KEY', () => {
    const cfg = loadQueenBeeConfig({
      OPENROUTER_API_KEY: FAKE_KEY,
    });
    expect(cfg.apiKey).toBe(FAKE_KEY);
  });

  test('briefToDAG rejette une clé vide', async () => {
    await expect(briefToDAG('Construis une API REST', { apiKey: '' })).rejects.toThrow(
      'QUEEN_BEE_API_KEY',
    );
  });

  test('briefToDAG rejette un brief trop court', async () => {
    await expect(briefToDAG('court', { apiKey: FAKE_KEY })).rejects.toThrow(
      '10 caractères',
    );
  });

  test('briefToDAG rejette un JSON invalide du LLM', async () => {
    // Mock fetch pour renvoyer du texte non-JSON
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'pas du json' } }],
        model: 'test',
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await expect(briefToDAG('Construis un système de cache Redis', { apiKey: FAKE_KEY }))
      .rejects.toThrow('JSON invalide');

    globalThis.fetch = origFetch;
  });

  test('briefToDAG rejette une réponse sans tâches', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"tasks": []}' } }],
        model: 'test',
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await expect(briefToDAG('Projet test', { apiKey: FAKE_KEY }))
      .rejects.toThrow("n'a produit aucune tâche");

    globalThis.fetch = origFetch;
  });

  test('briefToDAG accepte une réponse valide', async () => {
    const validResponse = {
      rationale: 'Découpage en 3 étapes indépendantes',
      tasks: [
        { id: 'init', title: 'Initialiser le projet', prompt: 'npm init + deps', dependsOn: [] },
        {
          id: 'api',
          title: 'Créer les routes API',
          prompt: 'Implémente GET /users et POST /users',
          dependsOn: ['init'],
        },
        {
          id: 'tests',
          title: 'Écrire les tests',
          prompt: 'Tests unitaires pour les routes',
          dependsOn: ['api'],
        },
      ],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(validResponse) } }],
        model: 'test-model',
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const result = await briefToDAG('Crée une API REST avec tests', { apiKey: FAKE_KEY });
    expect(result.tasks.length).toBe(3);
    expect(result.tasks[0]!.title).toBe('Initialiser le projet');
    expect(result.tasks[1]!.dependsOn).toEqual(['init']);
    expect(result.model).toBe('test-model');

    globalThis.fetch = origFetch;
  });

  test('briefToDAG gère les tâches sans ids', async () => {
    const noIdResponse = {
      tasks: [
        { title: 'Setup', prompt: 'Initialiser' },
        { title: 'Feature', prompt: 'Implémenter', dependsOn: [] },
      ],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(noIdResponse) } }],
        model: 'test',
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const result = await briefToDAG('Projet simple', { apiKey: FAKE_KEY });
    expect(result.tasks.length).toBe(2);

    globalThis.fetch = origFetch;
  });

  test("briefToDAG rejette une erreur HTTP de l'API", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(briefToDAG('Projet test', { apiKey: FAKE_KEY })).rejects.toThrow('401');

    globalThis.fetch = origFetch;
  });
});