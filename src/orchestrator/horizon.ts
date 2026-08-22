// Horizon — ledger faits ≠ hypothèses (idée Magentic-One, ADR 0010 lot 9).
//
// Queen Bee reste le lot COURT. L'horizon N'INJECTE PAS des milliers de tâches
// dans l'instantané. Stall → la dérive / essaim décident déjà `halte` ; ici on
// tient un carnet lisible, borné.
//
// MODULE PUR — aucune I/O. `now` est un paramètre si besoin.

export const VERSION_HORIZON = 1;

export const KINDS_HORIZON = ['fait', 'hypothese'] as const;
export type KindHorizon = (typeof KINDS_HORIZON)[number];

/** Plafond de lignes renvoyées à l'écran / API — loin sous LIMITE_TACHES_INSTANTANE. */
export const HORIZON_LECTURE_MAX = 80;

export const HORIZON_TEXTE_MAX = 500;

export type MotifRefusHorizon =
  'vide' | 'kind_inconnu' | 'trop_long' | 'projet_inconnu' | 'trop_dentrees';

export interface EntreeHorizon {
  id: string;
  projectId: string;
  kind: KindHorizon;
  texte: string;
  source: string;
  creeA: number;
}

export type VerdictKind = { ok: true; kind: KindHorizon } | { ok: false; motif: MotifRefusHorizon };

export type VerdictTexte = { ok: true; texte: string } | { ok: false; motif: MotifRefusHorizon };

const KINDS = new Set<string>(KINDS_HORIZON);

export function estKindHorizon(brut: string): brut is KindHorizon {
  return KINDS.has(brut);
}

export function validerKindHorizon(brut: string): VerdictKind {
  if (typeof brut !== 'string' || brut.trim().length === 0) {
    return { ok: false, motif: 'vide' };
  }
  const cle = brut.trim().toLowerCase();
  if (!estKindHorizon(cle)) return { ok: false, motif: 'kind_inconnu' };
  return { ok: true, kind: cle };
}

export function validerTexteHorizon(brut: string): VerdictTexte {
  if (typeof brut !== 'string') return { ok: false, motif: 'vide' };
  const texte = brut.replace(/\s+/g, ' ').trim();
  if (!texte) return { ok: false, motif: 'vide' };
  if (texte.length > HORIZON_TEXTE_MAX) return { ok: false, motif: 'trop_long' };
  return { ok: true, texte };
}

/**
 * Résumé pour l'écran : faits et hypothèses SÉPARÉS.
 * Une hypothèse ne doit jamais être listée comme fait.
 */
export function resumeHorizon(
  entrees: readonly EntreeHorizon[],
  limite = HORIZON_LECTURE_MAX,
): { faits: EntreeHorizon[]; hypotheses: EntreeHorizon[] } {
  const cap = Math.max(0, Math.min(limite, HORIZON_LECTURE_MAX));
  const faits: EntreeHorizon[] = [];
  const hypotheses: EntreeHorizon[] = [];
  // Plus récentes d'abord
  const triees = [...entrees].sort((a, b) => b.creeA - a.creeA);
  for (const e of triees) {
    if (faits.length + hypotheses.length >= cap) break;
    if (e.kind === 'fait') faits.push(e);
    else if (e.kind === 'hypothese') hypotheses.push(e);
  }
  return { faits, hypotheses };
}

/** L'horizon ne doit pas gonfler l'instantané de tâches. */
export function horizonDepasseBudgetTaches(
  entreesHorizon: number,
  plafondInstantane: number,
): boolean {
  // Garde-fou : même le ledger entier doit rester << instantané.
  return entreesHorizon > Math.min(HORIZON_LECTURE_MAX * 5, Math.floor(plafondInstantane / 10));
}

/** Source stable des faits auto-écrits quand la dérive est dégradée. */
export const SOURCE_HORIZON_DERIVE = 'derive';

/** Fenêtre anti-spam : un fait « dérive dégradée » au plus toutes les 6 h. */
export const FENETRE_FAIT_DERIVE_MS = 6 * 60 * 60 * 1000;

/** Texte borné d'un fait auto-posé à la halte pour dérive dégradée. */
export function texteFaitDeriveDegradee(motif: string): string {
  const base = 'Dérive dégradée';
  const m = motif.replace(/\s+/g, ' ').trim();
  if (!m) return base;
  const sep = ' — ';
  const budget = HORIZON_TEXTE_MAX - base.length - sep.length;
  if (budget <= 0) return base.slice(0, HORIZON_TEXTE_MAX);
  return `${base}${sep}${m.slice(0, budget)}`;
}

/** Préfixe stable des faits auto « à surveiller » (seuil resserré, pas encore halte). */
export const PREFIXE_FAIT_DERIVE_SURVEILLER = 'Dérive à surveiller';

/** Texte borné d'un fait auto-posé quand la dérive passe en `a_surveiller`. */
export function texteFaitDeriveASurveiller(motif: string): string {
  const base = PREFIXE_FAIT_DERIVE_SURVEILLER;
  const m = motif.replace(/\s+/g, ' ').trim();
  if (!m) return base;
  const sep = ' — ';
  const budget = HORIZON_TEXTE_MAX - base.length - sep.length;
  if (budget <= 0) return base.slice(0, HORIZON_TEXTE_MAX);
  return `${base}${sep}${m.slice(0, budget)}`;
}

/**
 * Faut-il encore écrire un fait « dérive dégradée » ?
 * Évite de saturer le carnet à chaque GET / cycle runner.
 */
export function doitNoterFaitDeriveDegradee(
  entrees: readonly EntreeHorizon[],
  now: number,
  fenetreMs = FENETRE_FAIT_DERIVE_MS,
): boolean {
  return !entrees.some(
    (e) =>
      e.kind === 'fait' &&
      e.source === SOURCE_HORIZON_DERIVE &&
      e.texte.startsWith('Dérive dégradée') &&
      now - e.creeA < fenetreMs,
  );
}

/**
 * Faut-il encore écrire un fait « dérive à surveiller » ?
 * Même fenêtre anti-spam que la dégradée — deux niveaux, deux préfixes.
 */
export function doitNoterFaitDeriveASurveiller(
  entrees: readonly EntreeHorizon[],
  now: number,
  fenetreMs = FENETRE_FAIT_DERIVE_MS,
): boolean {
  return !entrees.some(
    (e) =>
      e.kind === 'fait' &&
      e.source === SOURCE_HORIZON_DERIVE &&
      e.texte.startsWith(PREFIXE_FAIT_DERIVE_SURVEILLER) &&
      now - e.creeA < fenetreMs,
  );
}

export function expliquerRefusHorizon(motif: MotifRefusHorizon, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifRefusHorizon, string> = {
    vide: 'Entrée d’horizon incomplète.',
    kind_inconnu: 'Kind inconnu — fait ou hypothese.',
    trop_long: `Le texte dépasse ${HORIZON_TEXTE_MAX} caractères.`,
    projet_inconnu: 'Projet inconnu.',
    trop_dentrees: 'Trop d’entrées d’horizon — le carnet est borné.',
  };
  const en: Record<MotifRefusHorizon, string> = {
    vide: 'Incomplete horizon entry.',
    kind_inconnu: 'Unknown kind — fait or hypothese.',
    trop_long: `Text exceeds ${HORIZON_TEXTE_MAX} characters.`,
    projet_inconnu: 'Unknown project.',
    trop_dentrees: 'Too many horizon entries — the ledger is capped.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
