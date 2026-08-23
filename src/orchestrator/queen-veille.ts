// Veille techno légère — conseil injecté dans les prompts de planification.
// Canon : docs/QUEEN-INTELLIGENCE-CORE.md §3–4 (rechercher avant de coder).
//
// MODULE PUR — aucune I/O. OpenAlex et GitHub restent des surfaces séparées ;
// ici on signale au modèle QUAND la recherche est pertinente.

const DECLENCHEURS = [
  'recherche',
  'research',
  'état de l',
  'state of the art',
  'bibliographie',
  'literature',
  'alternative',
  'open source',
  'open-source',
  'existant',
  'existing',
  'framework',
  'librairie',
  'library',
  'comparer',
  'compare',
  'benchmark',
  'veille',
];

/**
 * Si le brief suggère une recherche techno, retourne une consigne courte pour
 * le planner / Queen Bee. Sinon `null`.
 */
export function conseilVeilleBrief(brief: string): string | null {
  const lower = brief.toLowerCase();
  if (!DECLENCHEURS.some((d) => lower.includes(d))) return null;
  return [
    'VEILLE TECHNO (Intelligence Core) : avant toute réimplémentation,',
    'inclure une tâche « évaluer / intégrer une solution existante »',
    '(npm, GitHub, doc officielle). Pour la littérature : Hive → Mémoire → OpenAlex.',
    'Justifier le choix techno dans rationale.',
  ].join(' ');
}
