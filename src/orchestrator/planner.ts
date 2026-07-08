// Planner « Queen Bee » (Palier 2) : transforme un brief en langage naturel en
// un DAG de tâches de codage prêtes à distribuer.
//
// Conception « pluggable » : deux implémentations partagent la même sortie.
//   1. heuristique — déterministe, hors-ligne, sans coût ni clé API. Défaut.
//   2. IA — appelle l'API Messages de Claude avec la clé de l'orchestrateur
//      (facturation locale, jamais la clé d'un nœud). Activée dès qu'une clé est
//      présente ; repli automatique sur l'heuristique en cas d'indisponibilité.
//
// Toute sortie passe par `sanitizePlan` : ids valides et uniques, dépendances
// bornées au lot, et garantie d'acyclicité — le serveur peut donc l'ingérer tel
// quel via POST /api/projects/:id/tasks.

import { LIMITS } from '../shared/protocol.js';

/** Tâche produite par le planner : la forme exacte attendue par l'API de tâches. */
export interface PlannedTask {
  id: string;
  title: string;
  prompt: string;
  dependsOn: string[];
}

/** Résultat d'une planification : les tâches, leur origine, et une note éventuelle. */
export interface PlannerResult {
  tasks: PlannedTask[];
  source: 'heuristic' | 'llm';
  note?: string;
}

/**
 * Appel LLM abstrait (injectable pour les tests). Reçoit un system + user et un
 * modèle, retourne le texte brut de la réponse.
 */
export type LlmFn = (args: {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
}) => Promise<string>;

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/** Réduit une chaîne à un slug `[a-z0-9-]` compatible avec ID_PATTERN. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'tache';
}

const clamp = (s: string, max: number): string => s.trim().slice(0, max);

/**
 * Nettoie et sécurise un plan brut (issu de l'IA ou de l'heuristique) :
 * ids valides et uniques, titres/prompts non vides et bornés, dépendances
 * restreintes au lot, et retrait des arêtes qui créeraient un cycle.
 */
export function sanitizePlan(raw: unknown[]): PlannedTask[] {
  const rows = raw.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');

  // 1. Attribuer des ids valides et uniques.
  const used = new Set<string>();
  const withIds = rows.map((r, i) => {
    const seed = typeof r.id === 'string' && r.id ? r.id : String(r.title ?? `tache-${i + 1}`);
    const base = slugify(seed);
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base.slice(0, 44)}-${n++}`;
    used.add(id);
    const title = clamp(String(r.title ?? id), LIMITS.title) || id;
    const prompt = clamp(String(r.prompt ?? r.title ?? title), LIMITS.prompt) || title;
    const rawDeps = Array.isArray(r.dependsOn) ? r.dependsOn.map((d) => slugify(String(d))) : [];
    return { id, title, prompt, rawDeps };
  });

  const valid = new Set(withIds.map((t) => t.id));

  // 2. Accepter les dépendances valides, en écartant toute arête cyclique.
  const accepted = new Map<string, string[]>();
  for (const t of withIds) accepted.set(t.id, []);

  // `dep` peut-il déjà atteindre `target` via les arêtes acceptées ? (→ cycle)
  const reaches = (dep: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [dep];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of accepted.get(cur) ?? []) stack.push(d);
    }
    return false;
  };

  for (const t of withIds) {
    const deps = accepted.get(t.id) as string[];
    for (const d of t.rawDeps) {
      if (d === t.id || !valid.has(d) || deps.includes(d)) continue;
      if (reaches(d, t.id)) continue; // ajouter t→d bouclerait : on écarte
      deps.push(d);
    }
  }

  return withIds.map((t) => ({
    id: t.id,
    title: t.title,
    prompt: t.prompt,
    dependsOn: accepted.get(t.id) as string[],
  }));
}

// ─── Planner heuristique (hors-ligne, déterministe) ──────────────────────────

/**
 * Découpe un brief par détection de mots-clés (FR/EN) en un DAG standard :
 * socle → composants (modèle, auth, API, facturation, UI) → tests → déploiement.
 * À défaut de tout composant reconnaissable, produit une tâche unique.
 */
export function heuristicPlan(brief: string): PlannedTask[] {
  const b = brief.trim();
  const norm = b
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const has = (...kw: string[]): boolean => kw.some((k) => norm.includes(k));

  const wants = {
    data: has(
      'donnee',
      'modele',
      'schema',
      'bdd',
      'base de donnees',
      'database',
      'model',
      'sql',
      'entite',
    ),
    auth: has(
      'auth',
      'login',
      'connexion',
      'compte',
      'utilisateur',
      'user',
      'signup',
      'inscription',
      'session',
    ),
    api: has('api', 'endpoint', 'backend', 'serveur', 'server', 'rest', 'graphql'),
    ui: has(
      'ui',
      'interface',
      'front',
      'dashboard',
      'page',
      'ecran',
      'site',
      'web',
      'mobile',
      'app',
    ),
    billing: has(
      'paiement',
      'payment',
      'facturation',
      'billing',
      'abonnement',
      'subscription',
      'stripe',
    ),
    deploy: has('deploiement', 'deploy', 'ci', 'cd', 'production', 'docker', 'kubernetes', 'k8s'),
  };

  const ctx = `Dans le cadre du projet « ${clamp(b, 160)} »`;
  const tasks: PlannedTask[] = [];
  const components: string[] = [];
  const add = (id: string, title: string, prompt: string, dependsOn: string[]): void => {
    tasks.push({ id, title, prompt, dependsOn });
  };

  add(
    'socle',
    'Échafauder le projet',
    `${ctx}, mettre en place la structure du dépôt, l'outillage (lint, tests, build) et un squelette exécutable.`,
    [],
  );

  if (wants.data) {
    add(
      'modele',
      'Modèle de données',
      `${ctx}, concevoir le schéma de données (entités, relations, migrations).`,
      ['socle'],
    );
  }
  const dataDep = wants.data ? ['modele'] : ['socle'];

  if (wants.auth) {
    add(
      'auth',
      'Authentification',
      `${ctx}, implémenter l'inscription, la connexion et la gestion de session.`,
      dataDep,
    );
    components.push('auth');
  }
  if (wants.api) {
    add(
      'api',
      'API',
      `${ctx}, implémenter les endpoints métier avec validation et gestion d'erreurs.`,
      dataDep,
    );
    components.push('api');
  }
  if (wants.billing) {
    add(
      'billing',
      'Facturation',
      `${ctx}, intégrer le paiement, les abonnements et les webhooks associés.`,
      dataDep,
    );
    components.push('billing');
  }
  if (wants.ui) {
    add(
      'ui',
      'Interface',
      `${ctx}, réaliser l'interface utilisateur (écrans principaux, navigation, états de chargement).`,
      ['socle'],
    );
    components.push('ui');
  }

  // Brief trop vague (aucun composant, aucune donnée) → une seule tâche utile,
  // sans socle isolé superflu.
  if (components.length === 0 && !wants.data) {
    return [
      {
        id: 'tache',
        title: clamp(b, LIMITS.title) || 'Réaliser le projet',
        prompt: b || 'Décrire puis réaliser le projet.',
        dependsOn: [],
      },
    ];
  }

  const testDeps = components.length ? components.slice() : wants.data ? ['modele'] : ['socle'];
  add(
    'tests',
    'Tests',
    `${ctx}, écrire les tests couvrant ${
      components.length ? 'les composants réalisés' : 'le socle et le modèle'
    } (unitaires + intégration).`,
    testDeps,
  );

  if (wants.deploy) {
    add(
      'deploy',
      'Déploiement',
      `${ctx}, mettre en place l'intégration continue et le déploiement (build, CI/CD, publication).`,
      ['tests'],
    );
  }

  return tasks;
}

// ─── Planner IA (API Messages de Claude, via fetch, sans SDK) ─────────────────

/** Construit le couple (system, user) demandant un DAG au format JSON strict. */
export function buildPlannerPrompt(brief: string): { system: string; user: string } {
  const system = [
    'Tu es « Queen Bee », la planificatrice de Hive.',
    "On te donne le brief d'un projet logiciel. Découpe-le en un DAG minimal de tâches de codage, chacune réalisable indépendamment par une IA de codage.",
    'Contraintes :',
    '- 2 à 12 tâches, chacune atomique et confiable.',
    '- id : slug court en minuscules, caractères [a-z0-9-] uniquement.',
    "- dependsOn : liste d'ids de tâches du même lot devant être terminées avant celle-ci. Aucun cycle.",
    "- prompt : consigne complète et autoportante pour l'agent qui réalisera la tâche.",
    'Réponds UNIQUEMENT par un tableau JSON, sans texte ni balises Markdown autour.',
    'Exemple : [{"id":"socle","title":"Échafauder","prompt":"Créer la structure du dépôt.","dependsOn":[]}]',
  ].join('\n');
  return { system, user: brief.trim() };
}

/**
 * Extrait le premier tableau JSON d'un texte (tolère des balises ``` et du texte
 * autour). Retourne null si rien d'exploitable.
 */
function extractJsonArray(text: string): unknown[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try {
    const v: unknown = JSON.parse(cleaned);
    if (Array.isArray(v)) return v;
  } catch {
    /* pas du JSON pur : on cherche un sous-tableau équilibré */
  }
  const start = cleaned.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        try {
          const v: unknown = JSON.parse(cleaned.slice(start, i + 1));
          return Array.isArray(v) ? v : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Transforme la réponse brute du modèle en plan nettoyé et acyclique. */
export function parsePlannerResponse(text: string): PlannedTask[] {
  const arr = extractJsonArray(text);
  if (!arr) throw new Error('réponse du planner illisible (aucun tableau JSON trouvé).');
  return sanitizePlan(arr);
}

/** Modèle utilisé par le planner IA (configurable ; défaut rapide et économique). */
export function plannerModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIVE_PLANNER_MODEL?.trim() || 'claude-haiku-4-5';
}

/** Le planner IA est-il activable ? (une clé API locale suffit). */
export function llmPlannerAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Implémentation `LlmFn` par défaut : appel HTTP direct à l'API Messages de
 * Claude (aucune dépendance SDK, conforme à la pile légère imposée). La clé
 * reste locale à l'orchestrateur.
 */
export function anthropicLlm(env: NodeJS.ProcessEnv = process.env): LlmFn {
  const apiKey = env.ANTHROPIC_API_KEY;
  const baseUrl = (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  return async ({ system, user, model, maxTokens }) => {
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY absente : le planner IA requiert une clé API (elle reste locale à l'orchestrateur).",
      );
    }
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(`appel API Claude échoué : ${data?.error?.message ?? `HTTP ${res.status}`}`);
    }
    if (data?.stop_reason === 'refusal') {
      throw new Error('requête refusée par le modèle.');
    }
    const text = (data?.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    if (!text.trim()) throw new Error('réponse vide du modèle.');
    return text;
  };
}

/** Planifie via l'IA (parse + nettoyage inclus). Lève si l'appel/parse échoue. */
export async function llmPlan(
  brief: string,
  opts: { llm: LlmFn; model: string },
): Promise<PlannedTask[]> {
  const { system, user } = buildPlannerPrompt(brief);
  const text = await opts.llm({ system, user, model: opts.model, maxTokens: 2048 });
  const tasks = parsePlannerResponse(text);
  if (tasks.length === 0) throw new Error("le planner IA n'a produit aucune tâche.");
  return tasks;
}

export interface PlanOptions {
  /** 'auto' (défaut) : IA si disponible, repli heuristique. 'heuristic'/'llm' : forcé. */
  mode?: 'auto' | 'heuristic' | 'llm';
  env?: NodeJS.ProcessEnv;
  /** Injection de l'appel LLM (tests, ou back-end alternatif). */
  llm?: LlmFn;
  model?: string;
}

/**
 * Point d'entrée du planner. Ne lève jamais en mode 'auto' : en cas d'échec de
 * l'IA, il retombe sur l'heuristique avec une note explicative (robustesse).
 */
export async function planBrief(brief: string, opts: PlanOptions = {}): Promise<PlannerResult> {
  const env = opts.env ?? process.env;
  const trimmed = brief.trim();
  if (!trimmed) return { tasks: [], source: 'heuristic', note: 'brief vide' };

  const model = opts.model ?? plannerModel(env);
  const useLlm =
    opts.mode === 'llm' ||
    (opts.mode !== 'heuristic' && (opts.llm != null || llmPlannerAvailable(env)));

  if (useLlm) {
    const llm = opts.llm ?? anthropicLlm(env);
    try {
      return { tasks: await llmPlan(trimmed, { llm, model }), source: 'llm' };
    } catch (e) {
      if (opts.mode === 'llm') throw e instanceof Error ? e : new Error(String(e));
      // Mode auto : jamais bloquant, on sert un découpage déterministe.
      return {
        tasks: sanitizePlan(heuristicPlan(trimmed)),
        source: 'heuristic',
        note: `planner IA indisponible (${e instanceof Error ? e.message : String(e)}) — découpage heuristique utilisé.`,
      };
    }
  }

  return { tasks: sanitizePlan(heuristicPlan(trimmed)), source: 'heuristic' };
}
