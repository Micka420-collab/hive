// L'EFFORT de raisonnement d'une exécution — une dimension du bras de
// l'Aiguillage, à côté du harness (l'agent) et du modèle.
//
// ─── SEULEMENT LES NIVEAUX QUE LE CLI DOCUMENTE ──────────────────────────────
//
// Un niveau que le CLI ne connaît pas ne « retombe » pas gentiment sur son
// défaut : selon la version il échoue, ou il est ignoré sans le dire. Le
// premier cas brûle une tentative en échec d'infrastructure (jamais un
// verdict : l'Aiguillage n'apprendrait même pas à l'éviter) ; le second range
// un verdict sous un effort qui n'a jamais tourné. D'où la règle : un
// adaptateur ne déclare que les niveaux que SON CLI documente, et un nœud ne
// reçoit jamais un effort qu'il n'a pas déclaré (`efforts` à l'inscription).
//
//   · Claude Code : `claude --effort <level>` — « low, medium, high, xhigh,
//     max » (`claude --help`, relevé sur 2.1.283).
//   · Codex : AUCUN. `model_reasoning_effort` existe, mais ses valeurs sont
//     annoncées par CHAQUE modèle (`ReasoningEffort::Custom`, « a
//     model-defined effort value », codex-rs/protocol/src/openai_models.rs) et
//     `codex exec --help` n'en documente aucune : il faudrait interroger le
//     catalogue du modèle, ce que Hive ne fait pas encore.
//
// L'ORDRE compte : il va du moins au plus coûteux, et c'est lui qui départage
// deux bras ex æquo (`aiguillage.ts`) — à mérite égal, le moindre effort.

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

const CONNUS: ReadonlySet<string> = new Set(EFFORTS);

export function estEffort(v: unknown): v is Effort {
  return typeof v === 'string' && CONNUS.has(v);
}

/**
 * Rang d'un effort dans `EFFORTS` ; `-1` pour « aucun effort commandé » (le
 * défaut du CLI), qui passe donc devant tous les niveaux explicites.
 */
export function rangEffort(effort: Effort | null): number {
  return effort === null ? -1 : EFFORTS.indexOf(effort);
}

/**
 * Une liste d'efforts déclarée par le réseau : non vide, sans doublon, que des
 * niveaux connus. Mal formée, le message entier est refusé — même sévérité que
 * `modeles`.
 */
export function estListeEfforts(v: unknown): v is Effort[] {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= EFFORTS.length &&
    v.every(estEffort) &&
    new Set(v).size === v.length
  );
}
