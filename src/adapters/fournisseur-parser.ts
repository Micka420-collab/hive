// Lecture de la DÉCLARATION fournisseur dans le flux stream-json de Claude Code.
//
// `claude -p --output-format stream-json` termine par une ligne
// `{"type":"result", …}` qui porte ce que le CLI sait de l'exécution :
// `total_cost_usd`, `duration_api_ms` (le temps passé dans les appels au
// modèle), `usage` (jetons de la boucle principale), `modelUsage` (une entrée
// par modèle exact, sous-agents compris) et son `subtype` — dont l'arrêt sur
// plafond de coût.
//
// La déclaration n'en retient que des NOMBRES et des NOMS DE MODÈLE : ni le
// texte de la réponse (`result`), ni l'identifiant de session n'y entrent. La
// réponse a son propre canal, borné et nommé — `finalText` (texte-final.ts) ;
// l'identifiant de session, aucun. Un champ absent ou illisible est laissé
// absent — jamais remplacé par une estimation.
// Si le format change, la déclaration disparaît et l'écran dit « inconnu » :
// l'échec est muet, pas faux.

import type { ArretBudgetaire } from '../shared/arret-budgetaire.js';
import type { UsageFournisseur } from '../shared/types.js';

function nombre(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function entier(v: unknown): number | undefined {
  const n = nombre(v);
  return n === undefined ? undefined : Math.round(n);
}

/** Somme des parts DÉCLARÉES ; `undefined` quand aucune ne l'est. */
function somme(parts: ReadonlyArray<number | undefined>): number | undefined {
  if (parts.every((p) => p === undefined)) return undefined;
  return parts.reduce<number>((total, p) => total + (p ?? 0), 0);
}

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Les jetons déclarés : d'entrée (directs + écrits en cache + lus en cache) et
 * de sortie.
 *
 * `modelUsage` d'abord, sommé sur ses modèles : « the correct field for
 * token/cost accounting » — boucle principale, sous-agents (outil Task) et
 * compactions — quand `usage` ne compte que la boucle principale (« MAIN
 * AGENT LOOP ONLY », @anthropic-ai/claude-agent-sdk sdk.d.ts, `SDKResultError`
 * / `ModelUsage`). Lus dans `usage`, les jetons d'un agent qui délègue à ses
 * sous-agents étaient sous-déclarés. `usage` reste la source d'un CLI dont
 * `modelUsage` ne porte aucun jeton — sauf sur un arrêt de plafond, qui en
 * laisse la réponse fatale dehors (`declarationDepuisResultat`).
 */
function jetons(
  r: Record<string, unknown>,
  usageFiable: boolean,
): { entree?: number; sortie?: number } {
  const parModele = estObjet(r.modelUsage) ? Object.values(r.modelUsage).filter(estObjet) : [];
  const entreeModeles = somme(
    parModele.flatMap((m) =>
      [m.inputTokens, m.cacheCreationInputTokens, m.cacheReadInputTokens].map(entier),
    ),
  );
  const sortieModeles = somme(parModele.map((m) => entier(m.outputTokens)));
  if (entreeModeles !== undefined || sortieModeles !== undefined) {
    return { entree: entreeModeles, sortie: sortieModeles };
  }
  if (!usageFiable || !estObjet(r.usage)) return {};
  const usage = r.usage;
  return {
    entree: somme(
      [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].map(
        entier,
      ),
    ),
    sortie: entier(usage.output_tokens),
  };
}

/**
 * L'arrêt sur plafond que DÉCLARE le `subtype` d'une ligne `result`
 * (`SDKResultError`). Une Map, pas un objet : un `subtype` nommé `constructor`
 * n'est pas un arrêt. `error_max_turns` n'y est pas : Hive ne passe aucun
 * plafond de tours, ce serait un échec ordinaire.
 */
const ARRET_PAR_SOUS_TYPE: ReadonlyMap<unknown, ArretBudgetaire> = new Map<
  unknown,
  ArretBudgetaire
>([['error_max_budget_usd', 'cout']]);

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
  // Un ARRÊT SUR PLAFOND de coût laisse hors de `usage` la réponse qui l'a
  // franchi — « usage leaves out the response that crossed the budget, while
  // total_cost_usd and modelUsage include it » (agent-sdk/cost-tracking).
  // Mesuré deux fois sur 2.1.289 : `usage` ET `duration_api_ms` à zéro, quand
  // `modelUsage` compte 24 924 jetons d'entrée et 264 de sortie. Le temps
  // modèle n'a pas d'autre source : il reste non déclaré ; les jetons se
  // lisent dans `modelUsage`, qui les compte tous.
  const plafondAtteint = ARRET_PAR_SOUS_TYPE.has(r.subtype);
  const dureeApi = plafondAtteint ? undefined : entier(r.duration_api_ms);
  if (dureeApi !== undefined) declaration.dureeApiMs = dureeApi;
  const { entree, sortie } = jetons(r, !plafondAtteint);
  if (entree !== undefined) declaration.jetonsEntree = entree;
  if (sortie !== undefined) declaration.jetonsSortie = sortie;
  if (typeof r.modelUsage === 'object' && r.modelUsage !== null) {
    const modeles = Object.keys(r.modelUsage).filter((m) => m.length > 0);
    if (modeles.length > 0) declaration.modeles = modeles;
  }
  return Object.keys(declaration).length > 1 ? declaration : undefined;
}

/**
 * Suit un flux stream-json ligne à ligne : la DERNIÈRE déclaration lue, et
 * l'arrêt sur plafond que dit la DERNIÈRE ligne `result` — une ligne `result`
 * ultérieure le remplace, arrêt ou pas. Chaque ligne candidate n'est analysée
 * qu'UNE fois pour les deux. Les lignes qui ne sont pas du JSON (bannières,
 * avertissements) sont ignorées.
 */
export function createDeclarationFournisseurTracker(source: string): {
  feed(line: string): void;
  declaration(): UsageFournisseur | undefined;
  arret(): ArretBudgetaire | undefined;
} {
  let derniere: UsageFournisseur | undefined;
  let arret: ArretBudgetaire | undefined;
  return {
    feed(line: string) {
      const texte = line.trim();
      if (!texte.startsWith('{') || !texte.includes('"result"')) return;
      let ligne: unknown;
      try {
        ligne = JSON.parse(texte);
      } catch {
        return; // ligne tronquée ou non JSON : elle ne déclare rien
      }
      if (!estObjet(ligne) || ligne.type !== 'result') return;
      derniere = declarationDepuisResultat(ligne, source) ?? derniere;
      arret = ARRET_PAR_SOUS_TYPE.get(ligne.subtype);
    },
    declaration: () => derniere,
    arret: () => arret,
  };
}
