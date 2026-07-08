// Hive Mind v0 (Palier 2) : mémoire partagée de la ruche. Chaque tâche réussie
// laisse un « souvenir » ; avant d'assigner une nouvelle tâche, on récupère les
// souvenirs les plus pertinents et on les injecte dans son prompt.
//
// Récupération 100 % hors-ligne, sans embeddings ni API : scoring lexical de
// type BM25 (TF pondéré par IDF sur le corpus). Suffisant et déterministe pour
// un v0 ; un backend vectoriel pourra s'y substituer plus tard derrière la même
// interface (rankMemories).

/** Un souvenir : ce qu'a produit une tâche terminée, réutilisable par la ruche. */
export interface Memory {
  id: number;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
}

// Mots vides FR/EN : trop fréquents pour porter du sens, écartés de l'index.
const STOP_WORDS = new Set([
  'les',
  'des',
  'une',
  'aux',
  'avec',
  'pour',
  'dans',
  'par',
  'sur',
  'sous',
  'que',
  'qui',
  'quoi',
  'dont',
  'est',
  'sont',
  'ete',
  'etre',
  'avoir',
  'fait',
  'faire',
  'son',
  'ses',
  'leur',
  'nos',
  'vos',
  'cette',
  'cet',
  'ces',
  'plus',
  'moins',
  'tres',
  'puis',
  'donc',
  'mais',
  'car',
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'into',
  'their',
  'your',
  'are',
  'was',
  'has',
  'have',
  'not',
  'but',
  'all',
  'any',
  'can',
  'will',
  'its',
  'via',
  'ainsi',
  'entre',
]);

/** Découpe un texte en termes indexables (accents retirés, mots vides écartés). */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Classe les souvenirs d'un corpus par pertinence vis-à-vis d'une requête
 * (BM25, k1=1.5, b=0.75). L'IDF est calculé sur le corpus fourni ; les souvenirs
 * de score nul sont écartés. À score égal, le plus récent gagne.
 */
export function rankMemories(query: string, corpus: Memory[], limit = 3): ScoredMemory[] {
  const qTerms = new Set(tokenize(query));
  if (qTerms.size === 0 || corpus.length === 0) return [];

  const docTerms = corpus.map((m) => tokenize(`${m.title} ${m.content}`));
  const n = corpus.length;
  const df = new Map<string, number>();
  for (const terms of docTerms) {
    for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const totalLen = docTerms.reduce((s, t) => s + t.length, 0);
  const avgdl = totalLen / n || 1;
  const k1 = 1.5;
  const b = 0.75;

  const scored: ScoredMemory[] = corpus.map((memory, i) => {
    const terms = docTerms[i] ?? [];
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTerms) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const dfq = df.get(q) ?? 0;
      const idf = Math.log(1 + (n - dfq + 0.5) / (dfq + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * terms.length) / avgdl));
    }
    return { memory, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score || b2.memory.createdAt - a.memory.createdAt)
    .slice(0, limit);
}

/** Construit le texte d'un souvenir compact à partir d'une tâche réussie. */
export function summarizeTask(title: string, prompt: string, logs: string): string {
  const cleanPrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 400);
  const cleanLogs = logs.replace(/\s+/g, ' ').trim().slice(0, 600);
  return [cleanPrompt, cleanLogs].filter(Boolean).join(' — ') || title;
}

/** En-tête du bloc de contexte injecté — sert aussi de marqueur repérable. */
export const HIVE_CONTEXT_HEADER = '[Hive Mind — savoir de tâches passées de la ruche]';

/**
 * Assemble le contexte à préfixer au prompt d'une tâche à partir des souvenirs
 * pertinents. Vide si aucun souvenir. Borné en longueur.
 */
export function buildHiveContext(scored: ScoredMemory[], maxLen = 8000): string {
  if (scored.length === 0) return '';
  const lines = [
    HIVE_CONTEXT_HEADER,
    'Des tâches proches ont déjà été réalisées dans la ruche. Inspire-t’en si utile :',
  ];
  for (const { memory } of scored) {
    lines.push(`• ${memory.title} : ${memory.content}`);
  }
  return lines.join('\n').slice(0, maxLen);
}
