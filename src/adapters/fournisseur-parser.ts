// Lecture de la DÉCLARATION fournisseur dans le flux stream-json de Claude Code.
//
// `claude -p --output-format stream-json` termine par une ligne
// `{"type":"result", …}` qui porte ce que le CLI sait de l'exécution :
// `total_cost_usd`, `duration_api_ms` (le temps passé dans les appels au
// modèle), `usage` (jetons) et `modelUsage` (une entrée par modèle exact).
//
// On n'en retient que des NOMBRES et des NOMS DE MODÈLE : ni le texte de la
// réponse (`result`), ni l'identifiant de session ne quittent le nœud. Un champ
// absent ou illisible est laissé absent — jamais remplacé par une estimation.
// Si le format change, la déclaration disparaît et l'écran dit « inconnu » :
// l'échec est muet, pas faux.

import type { UsageFournisseur } from '../shared/types.js';

function nombre(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function entier(v: unknown): number | undefined {
  const n = nombre(v);
  return n === undefined ? undefined : Math.round(n);
}

/** Somme des jetons d'entrée : directs + écrits en cache + lus en cache. */
function jetonsEntree(usage: Record<string, unknown>): number | undefined {
  const parts = [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
  ].map(entier);
  if (parts.every((p) => p === undefined)) return undefined;
  return parts.reduce<number>((total, p) => total + (p ?? 0), 0);
}

/** Replie UNE ligne `result` ; `undefined` si ce n'en est pas une. */
export function declarationDepuisResultat(
  ligne: unknown,
  source: string,
): UsageFournisseur | undefined {
  if (typeof ligne !== 'object' || ligne === null) return undefined;
  const r = ligne as Record<string, unknown>;
  if (r.type !== 'result') return undefined;
  const declaration: UsageFournisseur = { source };
  const cout = nombre(r.total_cost_usd);
  if (cout !== undefined) declaration.coutUsd = cout;
  const dureeApi = entier(r.duration_api_ms);
  if (dureeApi !== undefined) declaration.dureeApiMs = dureeApi;
  if (typeof r.usage === 'object' && r.usage !== null) {
    const usage = r.usage as Record<string, unknown>;
    const entree = jetonsEntree(usage);
    if (entree !== undefined) declaration.jetonsEntree = entree;
    const sortie = entier(usage.output_tokens);
    if (sortie !== undefined) declaration.jetonsSortie = sortie;
  }
  if (typeof r.modelUsage === 'object' && r.modelUsage !== null) {
    const modeles = Object.keys(r.modelUsage).filter((m) => m.length > 0);
    if (modeles.length > 0) declaration.modeles = modeles;
  }
  return Object.keys(declaration).length > 1 ? declaration : undefined;
}

/**
 * Suit un flux stream-json ligne à ligne et garde la DERNIÈRE déclaration
 * lue. Les lignes qui ne sont pas du JSON (bannières, avertissements) sont
 * ignorées.
 */
export function createDeclarationFournisseurTracker(source: string): {
  feed(line: string): void;
  declaration(): UsageFournisseur | undefined;
} {
  let derniere: UsageFournisseur | undefined;
  return {
    feed(line: string) {
      const texte = line.trim();
      if (!texte.startsWith('{') || !texte.includes('"result"')) return;
      try {
        derniere = declarationDepuisResultat(JSON.parse(texte), source) ?? derniere;
      } catch {
        // Ligne tronquée ou non JSON : rien n'est déclaré par elle.
      }
    },
    declaration: () => derniere,
  };
}
