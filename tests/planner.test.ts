// Tests du planner « Queen Bee » (Palier 2) : découpage heuristique déterministe,
// nettoyage/acyclicité des plans, planner IA (via LLM injecté) et son repli, et
// intégration REST via POST /api/plan.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildPlannerPrompt,
  briefDeMaintenance,
  contientMotCle,
  heuristicPlan,
  llmPlan,
  parsePlannerResponse,
  planBrief,
  sanitizePlan,
  slugify,
  type LlmFn,
  type PlannedTask,
} from '../src/orchestrator/planner.js';
import { createServer, findCycle } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { ID_PATTERN, LIMITS } from '../src/shared/protocol.js';

const TOKEN = 'jeton-planner-assez-long';

/** Vérifie qu'un plan respecte les contraintes de l'API de tâches. */
function assertValidPlan(tasks: PlannedTask[]): void {
  const ids = new Set(tasks.map((t) => t.id));
  expect(ids.size).toBe(tasks.length); // ids uniques
  for (const t of tasks) {
    expect(ID_PATTERN.test(t.id)).toBe(true);
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.title.length).toBeLessThanOrEqual(LIMITS.title);
    expect(t.prompt.length).toBeGreaterThan(0);
    for (const d of t.dependsOn) {
      expect(ids.has(d)).toBe(true); // dépendance interne au lot
      expect(d).not.toBe(t.id); // pas d'auto-dépendance
    }
  }
  expect(findCycle(tasks)).toBeNull(); // DAG acyclique
}

describe('slugify', () => {
  it('produit un id conforme à ID_PATTERN', () => {
    expect(slugify('API Facturation !!')).toBe('api-facturation');
    expect(slugify('Échafauder le dépôt')).toBe('echafauder-le-depot');
    expect(ID_PATTERN.test(slugify('   '))).toBe(true); // repli 'tache'
    expect(slugify('   ')).toBe('tache');
  });
});

describe('planner heuristique', () => {
  it('découpe un brief riche en un DAG valide et complet', () => {
    const tasks = heuristicPlan(
      'Un SaaS de facturation avec authentification, API REST, dashboard et déploiement',
    );
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain('socle');
    expect(ids).toContain('auth');
    expect(ids).toContain('api');
    expect(ids).toContain('billing');
    expect(ids).toContain('ui');
    expect(ids).toContain('tests');
    expect(ids).toContain('deploy');
    // Les tests dépendent des composants ; le déploiement dépend des tests.
    expect(tasks.find((t) => t.id === 'tests')?.dependsOn).toEqual(
      expect.arrayContaining(['auth', 'api', 'billing', 'ui']),
    );
    expect(tasks.find((t) => t.id === 'deploy')?.dependsOn).toEqual(['tests']);
    assertValidPlan(sanitizePlan(tasks));
  });

  it('est déterministe (même brief → même plan)', () => {
    const brief = 'API REST avec base de données et tests';
    expect(heuristicPlan(brief)).toEqual(heuristicPlan(brief));
  });

  it('retombe sur une tâche unique pour un brief vague', () => {
    const tasks = heuristicPlan('faire quelque chose de sympa');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe('tache');
    assertValidPlan(tasks);
  });

  // ─── MESURÉ EN E2E RÉEL : « PUIS » N'EST PAS UNE INTERFACE ──────────────────
  //
  // Le brief « … corrige-la, puis lance npm test » est parti, depuis l'accueil
  // de Hive Studio, en trois tâches pour une vraie ouvrière Claude Code :
  // « Échafauder le projet » (installer lint, tests et build dans un dépôt qui
  // les a), « Interface » (« puis » contient « ui ») et « Tests ».
  it('UN MOT-CLÉ COMMENCE UN MOT — « puis », « rapide », « merci » ne sont ni ui, ni api, ni ci', () => {
    expect(contientMotCle('corrige-la, puis lance', '=ui')).toBe(false);
    expect(contientMotCle('une ui sobre', '=ui')).toBe(true);
    expect(contientMotCle('un retour rapide', '=api')).toBe(false);
    expect(contientMotCle('les apis publiques', '=api')).toBe(true);
    expect(contientMotCle('merci, ici', '=ci')).toBe(false);
    expect(contientMotCle('la ci de github', '=ci')).toBe(true);
    // Les radicaux restent des radicaux.
    expect(contientMotCle('authentification forte', 'auth')).toBe(true);
    expect(contientMotCle('les donnees clients', 'donnee')).toBe(true);
    const ids = heuristicPlan('Un tableau de bord rapide, merci').map((t) => t.id);
    expect(ids).not.toContain('api');
    expect(ids).not.toContain('deploy');
  });

  it('UN BRIEF DE MAINTENANCE RESTE UNE TÂCHE — rien à échafauder dans un dépôt qui existe', () => {
    for (const brief of [
      'Dans calc.js, la fonction add soustrait au lieu d’additionner : corrige-la, puis lance npm test pour vérifier.',
      'Analyse ce repository, identifie les bugs, propose les corrections et lance les tests.',
      'Fix the login redirect bug on the dashboard page',
      'Refactorer l’API de facturation sans changer son comportement',
    ]) {
      const tasks = heuristicPlan(brief);
      expect(tasks, brief).toHaveLength(1);
      expect(tasks[0]!.id).toBe('tache');
      // La consigne est le brief entier : l'ouvrière analyse, corrige et
      // vérifie dans le MÊME espace de travail.
      expect(tasks[0]!.prompt).toBe(brief);
      assertValidPlan(tasks);
    }
    expect(briefDeMaintenance('corrige le parseur')).toBe(true);
    expect(briefDeMaintenance('cree un parseur')).toBe(false);
  });

  it('…mais un brief qui CONSTRUIT garde son découpage, même s’il corrige aussi', () => {
    const ids = heuristicPlan(
      'Corrige le bug de connexion et ajoute une page de profil utilisateur avec son API',
    ).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['socle', 'auth', 'api', 'ui', 'tests']));
  });
});

describe('sanitizePlan', () => {
  it('brise les cycles et écarte les dépendances invalides', () => {
    const cleaned = sanitizePlan([
      { id: 'a', title: 'A', prompt: 'pa', dependsOn: ['b', 'inconnue', 'a'] },
      { id: 'b', title: 'B', prompt: 'pb', dependsOn: ['a'] },
    ]);
    expect(findCycle(cleaned)).toBeNull();
    // La dépendance vers une tâche hors lot est retirée.
    for (const t of cleaned) {
      for (const d of t.dependsOn) expect(['a', 'b']).toContain(d);
    }
  });

  it('rend les ids uniques et valides', () => {
    const cleaned = sanitizePlan([
      { title: 'API Client', prompt: 'p1' },
      { title: 'API Client', prompt: 'p2' }, // collision de slug
      { id: 'Bad Id!', title: 'x', prompt: 'p3' },
    ]);
    assertValidPlan(cleaned);
    expect(cleaned).toHaveLength(3);
  });

  it('ignore les entrées non-objets et comble les champs manquants', () => {
    const cleaned = sanitizePlan([null, 'texte', 42, { title: 'Seulement un titre' }] as unknown[]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]!.prompt.length).toBeGreaterThan(0);
  });
});

describe('planner IA (parsing)', () => {
  it('extrait un tableau JSON même entouré de texte et de balises Markdown', () => {
    const raw =
      'Voici le plan :\n```json\n[{"id":"socle","title":"Socle","prompt":"Créer","dependsOn":[]},' +
      '{"id":"api","title":"API","prompt":"Coder","dependsOn":["socle"]}]\n```\nBon courage !';
    const tasks = parsePlannerResponse(raw);
    expect(tasks.map((t) => t.id)).toEqual(['socle', 'api']);
    assertValidPlan(tasks);
  });

  it('lève sur une réponse sans tableau JSON', () => {
    expect(() => parsePlannerResponse("désolé je n'ai pas compris")).toThrow();
  });

  it('buildPlannerPrompt place le brief dans le message utilisateur', () => {
    const { system, user } = buildPlannerPrompt('  mon brief  ');
    expect(user).toBe('mon brief');
    expect(system).toContain('Queen Bee');
  });

  it('llmPlan nettoie la sortie du LLM injecté', async () => {
    const stub: LlmFn = async () =>
      '[{"id":"x","title":"X","prompt":"p","dependsOn":["y","x"]},{"id":"y","title":"Y","prompt":"p","dependsOn":[]}]';
    const tasks = await llmPlan('brief', { llm: stub, model: 'test' });
    assertValidPlan(tasks);
  });
});

describe('planBrief (orchestration)', () => {
  const okLlm: LlmFn = async () => '[{"id":"a","title":"A","prompt":"pa","dependsOn":[]}]';
  const failLlm: LlmFn = async () => {
    throw new Error('réseau indisponible');
  };

  it('utilise l’IA quand elle est injectée', async () => {
    const res = await planBrief('brief', { llm: okLlm, env: {} });
    expect(res.source).toBe('llm');
    expect(res.tasks).toHaveLength(1);
  });

  it('en mode auto, retombe sur l’heuristique si l’IA échoue (jamais bloquant)', async () => {
    const res = await planBrief('API avec base de données et tests', { llm: failLlm, env: {} });
    expect(res.source).toBe('heuristic');
    expect(res.note).toContain('réseau indisponible');
    assertValidPlan(res.tasks);
  });

  it('en mode llm explicite, propage l’erreur', async () => {
    await expect(planBrief('brief', { mode: 'llm', llm: failLlm, env: {} })).rejects.toThrow(
      'réseau indisponible',
    );
  });

  it('en mode heuristic, ignore l’IA disponible', async () => {
    const res = await planBrief('API REST', { mode: 'heuristic', llm: okLlm, env: {} });
    expect(res.source).toBe('heuristic');
  });

  it('sans clé ni LLM injecté, reste heuristique', async () => {
    const res = await planBrief('un dashboard web', { env: {} });
    expect(res.source).toBe('heuristic');
    assertValidPlan(res.tasks);
  });
});

describe('POST /api/plan (intégration)', () => {
  let server: HiveServer;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-plan-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 200,
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  it('génère un DAG heuristique ingérable par l’API de tâches', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ brief: 'API REST avec authentification et tests', mode: 'heuristic' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: PlannedTask[]; source: string };
    expect(body.source).toBe('heuristic');
    assertValidPlan(body.tasks);

    // Le plan est directement acceptable par la création de tâches.
    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Projet planifié' }),
      })
    ).json()) as { id: string };
    const created = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: body.tasks }),
    });
    expect(created.status).toBe(201);
  });

  it('refuse un brief vide (422) et exige le token', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const empty = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ brief: '   ' }),
    });
    expect(empty.status).toBe(422);

    const noAuth = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: 'API REST' }),
    });
    expect(noAuth.status).toBe(401);
  });
});
