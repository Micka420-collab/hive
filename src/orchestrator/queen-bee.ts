// Queen Bee — L'IA qui découpe un brief projet en DAG de tâches.
// Palier 2 : première brique de l'intelligence collective de la ruche.
//
// Appelle un LLM (OpenRouter / OpenAI-compatible) pour analyser un brief
// et produire une liste de tâches avec dépendances, prête à être injectée
// dans le scheduler. Les clés API restent sur l'orchestrateur, jamais
// transmises aux nœuds.
//
// Config via variables d'environnement :
//   QUEEN_BEE_API_KEY   — clé API (obligatoire)
//   QUEEN_BEE_BASE_URL  — URL de base (défaut : https://openrouter.ai/api/v1)
//   QUEEN_BEE_MODEL     — modèle (défaut : anthropic/claude-sonnet-4)

import { LIMITS } from '../shared/protocol.js';
import { QUEEN_BEE_SYSTEM_PROMPT } from './queen-intelligence-core.js';

export interface QueenBeeConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Langue de réponse attendue (défaut : français). */
  language?: string;
}

export interface BeeTask {
  id?: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
}

export interface BriefResult {
  tasks: BeeTask[];
  /** Explication du découpage par le LLM. */
  rationale: string;
  /** Modèle utilisé. */
  model: string;
}

function buildUserPrompt(brief: string, language: string): string {
  return `Analyse ce brief de projet et découpe-le en tâches atomiques pour des agents de codage.

Langue : ${language}

BRIEF :
${brief}`;
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

/**
 * Appelle un LLM pour découper un brief en DAG de tâches.
 * Lance une erreur si l'API répond mal, si le JSON est invalide, ou si aucune tâche n'est produite.
 */
export async function briefToDAG(brief: string, config: QueenBeeConfig): Promise<BriefResult> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? DEFAULT_MODEL;
  const language = config.language ?? 'français';

  if (!config.apiKey || config.apiKey.length < 10) {
    throw new Error('QUEEN_BEE_API_KEY est requis (clé API OpenRouter ou compatible)');
  }
  if (!brief || brief.trim().length < 10) {
    throw new Error('Le brief doit faire au moins 10 caractères');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: QUEEN_BEE_SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(brief, language) },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API LLM erreur ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      model: string;
    };

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Réponse LLM vide');

    let parsed: { rationale?: string; tasks?: BeeTask[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`JSON invalide dans la réponse LLM : ${raw.slice(0, 300)}`);
    }

    const tasks = parsed.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error("Le LLM n'a produit aucune tâche");
    }
    if (tasks.length > 20) {
      throw new Error(`Trop de tâches (${tasks.length}) — max 20`);
    }

    // Validation de chaque tâche
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      if (!t.title || typeof t.title !== 'string' || t.title.length > LIMITS.title) {
        throw new Error(`Tâche ${i + 1}: titre invalide`);
      }
      if (!t.prompt || typeof t.prompt !== 'string') {
        throw new Error(`Tâche ${i + 1}: prompt manquant`);
      }
      // Tronquer le prompt si trop long
      if (t.prompt.length > LIMITS.prompt) {
        t.prompt = t.prompt.slice(0, LIMITS.prompt - 3) + '...';
      }
      if (t.id !== undefined && (typeof t.id !== 'string' || t.id.length > 64)) {
        throw new Error(`Tâche ${i + 1}: id invalide`);
      }
      if (t.dependsOn !== undefined && !Array.isArray(t.dependsOn)) {
        throw new Error(`Tâche ${i + 1}: dependsOn doit être un tableau`);
      }
    }

    return {
      tasks,
      rationale: parsed.rationale ?? 'Découpage automatique par Queen Bee',
      model: data.model ?? model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Charge la config Queen Bee depuis les variables d'environnement.
 * Lit le .env si présent.
 */
export function loadQueenBeeConfig(env: NodeJS.ProcessEnv = process.env): QueenBeeConfig {
  return {
    apiKey: env.QUEEN_BEE_API_KEY ?? env.OPENROUTER_API_KEY ?? '',
    baseUrl: env.QUEEN_BEE_BASE_URL ?? env.OPENROUTER_BASE_URL,
    model: env.QUEEN_BEE_MODEL,
    language: env.QUEEN_BEE_LANGUAGE ?? 'français',
  };
}
