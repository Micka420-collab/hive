// Phéromones — le routage par affinité apprise.
//
// Chez l'abeille, les phéromones déposées sur une source de nectar guident les
// butineuses suivantes vers ce qui a déjà réussi. Ici, la ruche apprend quel
// NŒUD réussit le mieux quel TYPE de tâche (api, ui, db…) en repliant les
// résultats récents, et s'en sert pour DÉPARTAGER les nœuds à charge égale au
// moment de l'assignation — jamais pour renverser le critère principal.
//
// Comme le Waggle Board ou le Pulse, ce module est PUR : aucune I/O, aucun
// état global — une vue dérivée des résultats, testable et réutilisable côté
// serveur comme dashboard. Le signal s'évapore avec le temps (demi-vie de
// 7 jours), comme une vraie phéromone.

/** Types de tâches que la ruche sait distinguer (heuristique par mots-clés). */
export type Domaine = 'api' | 'ui' | 'db' | 'tests' | 'docs' | 'infra' | 'general';

/**
 * Mots-clés FR/EN par domaine, dans l'ORDRE DE DÉCLARATION (qui départage les
 * égalités de comptage). Les mots sont comparés sans accents ni casse, en mots
 * entiers (pluriel en `s` toléré) — « construire » ne compte pas pour 'ui'.
 */
const MOTS_CLES: ReadonlyArray<readonly [Domaine, readonly string[]]> = [
  ['api', ['api', 'endpoint', 'route', 'rest', 'graphql', 'serveur', 'server', 'backend']],
  [
    'ui',
    [
      'ui',
      'interface',
      'css',
      'react',
      'composant',
      'component',
      'bouton',
      'button',
      'frontend',
      'ecran',
    ],
  ],
  ['db', ['sql', 'sqlite', 'schema', 'migration', 'base de donnees', 'database', 'bdd']],
  ['tests', ['test', 'spec', 'vitest', 'couverture', 'coverage', 'unitaire', 'e2e']],
  ['docs', ['readme', 'doc', 'documentation', 'guide', 'tutoriel', 'tutorial', 'changelog']],
  ['infra', ['ci', 'cd', 'docker', 'deploy', 'deploiement', 'deployment', 'pipeline', 'k8s']],
];

/** Réduit un texte à une forme comparable : minuscules, sans accents. */
function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase();
}

/**
 * Occurrences d'un mot-clé en MOT ENTIER (pluriel en `s` toléré). Le tiret est
 * exclu des frontières : « celui-ci » ne compte pas pour 'ci', mais « ci/cd »
 * et « ci : … » comptent bien.
 */
function compter(texte: string, motCle: string): number {
  const echappe = motCle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![a-z0-9-])${echappe}s?(?![a-z0-9-])`, 'g');
  return texte.match(re)?.length ?? 0;
}

/**
 * Devine le domaine d'une tâche par comptage de mots-clés FR/EN. Le titre est
 * concaténé DEUX fois avant le prompt : en cas d'ambiguïté, il pèse double —
 * c'est lui qui nomme l'intention. Le max gagne ; égalité → ordre de
 * déclaration ; aucun mot-clé → 'general'.
 */
export function domaineDeTache(title: string, prompt: string): Domaine {
  const texte = `${normaliser(title)} ${normaliser(title)} ${normaliser(prompt)}`;
  let meilleur: Domaine = 'general';
  let meilleurCompte = 0;
  for (const [domaine, mots] of MOTS_CLES) {
    let compte = 0;
    for (const mot of mots) compte += compter(texte, mot);
    if (compte > meilleurCompte) {
      meilleur = domaine;
      meilleurCompte = compte;
    }
  }
  return meilleur;
}

/** Trace de phéromone : l'affinité apprise d'un nœud pour un domaine. */
export interface TraceePheromone {
  nodeId: string;
  domaine: Domaine;
  score: number;
  reussites: number;
  echecs: number;
}

/** Demi-vie du signal : un résultat vieux de 7 jours pèse moitié moins. */
const DEMI_VIE_MS = 7 * 24 * 60 * 60 * 1_000;

/** Dépôt d'une réussite / d'un échec, avant évaporation. */
const DEPOT_REUSSITE = 10;
const DEPOT_ECHEC = -6;

/**
 * Replie les résultats récents en traces de phéromones : chaque résultat
 * contribue (+10 réussite / −6 échec) × exp(−ln2 × âge / demi-vie) au couple
 * (nœud, domaine de sa tâche). Un résultat dont la tâche est inconnue (purgée)
 * n'a pas de domaine imputable : ignoré. Retour trié par score décroissant
 * (départage stable par nodeId puis domaine), scores arrondis à 2 décimales.
 */
export function calculerPheromones(
  taches: Array<{ id: string; title: string; prompt: string }>,
  resultats: Array<{ taskId: string; nodeId: string; success: boolean; createdAt: number }>,
  now: number,
): TraceePheromone[] {
  const domaines = new Map<string, Domaine>();
  for (const t of taches) domaines.set(t.id, domaineDeTache(t.title, t.prompt));

  const traces = new Map<string, TraceePheromone>();
  for (const r of resultats) {
    const domaine = domaines.get(r.taskId);
    if (!domaine) continue;
    // Une horloge légèrement en retard ne doit pas AMPLIFIER un dépôt : âge ≥ 0.
    const age = Math.max(0, now - r.createdAt);
    const poids = Math.exp((-Math.LN2 * age) / DEMI_VIE_MS);
    const cle = `${r.nodeId}|${domaine}`;
    let trace = traces.get(cle);
    if (!trace) {
      trace = { nodeId: r.nodeId, domaine, score: 0, reussites: 0, echecs: 0 };
      traces.set(cle, trace);
    }
    trace.score += (r.success ? DEPOT_REUSSITE : DEPOT_ECHEC) * poids;
    if (r.success) trace.reussites += 1;
    else trace.echecs += 1;
  }

  return [...traces.values()]
    .map((t) => ({ ...t, score: Math.round(t.score * 100) / 100 }))
    .sort(
      (a, b) =>
        b.score - a.score || a.nodeId.localeCompare(b.nodeId) || a.domaine.localeCompare(b.domaine),
    );
}

/**
 * Départage : parmi les candidats, le nœud au score le plus élevé pour ce
 * domaine — SEULEMENT si ce score est strictement positif ET strictement
 * supérieur à celui de tous les autres candidats (candidat sans trace = 0).
 * Sinon null : les phéromones ne décident que sur un vrai signal, jamais sur
 * du bruit ni une égalité.
 */
export function meilleurNoeud(
  candidats: string[],
  domaine: Domaine,
  traces: TraceePheromone[],
): string | null {
  const scores = new Map<string, number>();
  for (const t of traces) {
    if (t.domaine === domaine) scores.set(t.nodeId, t.score);
  }
  let meilleurScore = -Infinity;
  for (const id of candidats) {
    meilleurScore = Math.max(meilleurScore, scores.get(id) ?? 0);
  }
  if (meilleurScore <= 0) return null;
  const tetes = candidats.filter((id) => (scores.get(id) ?? 0) === meilleurScore);
  return tetes.length === 1 ? (tetes[0] ?? null) : null;
}
