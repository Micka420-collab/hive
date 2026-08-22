// Le baptême — la Reine nomme l'ouvrière ; le nœud ne s'auto-nomme pas.
//
// Doctrine (ADR 0010) : le nom affiché n'est PAS `RegisterMsg.name`, PAS le
// type d'agent (« claude-code »), PAS un prénom inventé par le nœud. La Reine
// baptise ; la collision est refusée ; sans baptême on n'invente rien à
// l'écran.
//
// MODULE PUR — famille de polyethisme.ts : aucune I/O, aucun aléa, aucune
// horloge. Le store persiste ; ce fichier juge.

/**
 * Version de la règle de baptême. Une v2 (nouveaux refus, nouvelle
 * normalisation) se distinguera sans migration silencieuse.
 */
export const VERSION_BAPTEME = 1;

/** Longueur minimale d'un nom baptisé (après normalisation). */
export const NOM_BAPTEME_MIN = 2;

/**
 * Longueur maximale. Plus courte que `LIMITS.name` (120) : un baptême est un
 * prénom de coéquipière, pas une bannière.
 */
export const NOM_BAPTEME_MAX = 40;

/**
 * Identifiants techniques d'agent / de simulation — ce ne sont PAS des
 * baptêmes. Les comparer en minuscules après normalisation.
 */
export const NOMS_TECHNIQUES_REFUSES: readonly string[] = Object.freeze([
  'claude-code',
  'claude_code',
  'claudecode',
  'cursor',
  'cursor-agent',
  'codex',
  'shell',
  'sim',
  'simulation',
  'node',
  'worker',
  'agent',
  'hive',
  'reine',
  'queen',
]);

export type MotifRefusBapteme =
  'vide' | 'trop_court' | 'trop_long' | 'caracteres' | 'technique' | 'collision' | 'noeud_inconnu';

export type VerdictBapteme = { ok: true; nom: string } | { ok: false; motif: MotifRefusBapteme };

/**
 * Normalise un candidat : trim, espaces internes repliés. Ne change pas la
 * casse — « Léa » reste « Léa ».
 */
export function normaliserNomBapteme(brut: string): string {
  return brut.replace(/\s+/g, ' ').trim();
}

/**
 * Caractères admis : lettres (unicode), chiffres, espace, tiret, apostrophe
 * typographique ou droite. Pas de `@`, `/`, contrôle, emoji obligatoire.
 */
const NOM_OK = /^[\p{L}\p{M}\d '’-]+$/u;

function estTechnique(nom: string): boolean {
  const cle = nom.toLowerCase().replace(/['’\s-]/g, '');
  const cleEspace = nom.toLowerCase();
  for (const refuse of NOMS_TECHNIQUES_REFUSES) {
    if (cleEspace === refuse) return true;
    if (cle === refuse.replace(/['’\s-_]/g, '')) return true;
  }
  return false;
}

/**
 * Valide la forme d'un baptême, sans regarder les collisions.
 */
export function validerNomBapteme(brut: string): VerdictBapteme {
  if (typeof brut !== 'string') return { ok: false, motif: 'vide' };
  const nom = normaliserNomBapteme(brut);
  if (nom.length === 0) return { ok: false, motif: 'vide' };
  if (nom.length < NOM_BAPTEME_MIN) return { ok: false, motif: 'trop_court' };
  if (nom.length > NOM_BAPTEME_MAX) return { ok: false, motif: 'trop_long' };
  if (!NOM_OK.test(nom)) return { ok: false, motif: 'caracteres' };
  if (estTechnique(nom)) return { ok: false, motif: 'technique' };
  return { ok: true, nom };
}

/** Collision insensible à la casse (NFC). */
export function collisionBapteme(candidat: string, pris: Iterable<string>): boolean {
  const cible = normaliserNomBapteme(candidat).toLocaleLowerCase('fr');
  if (!cible) return false;
  for (const p of pris) {
    if (normaliserNomBapteme(p).toLocaleLowerCase('fr') === cible) return true;
  }
  return false;
}

/**
 * Jugement complet avant écriture : forme + collision.
 *
 * `pris` = noms déjà baptisés des AUTRES nœuds. Rebaptiser la même ouvrière
 * avec le même nom (casse différente) n'est pas une collision — l'appelant
 * retire son propre nom de `pris`.
 */
export function jugerBapteme(brut: string, pris: Iterable<string>): VerdictBapteme {
  const forme = validerNomBapteme(brut);
  if (!forme.ok) return forme;
  if (collisionBapteme(forme.nom, pris)) return { ok: false, motif: 'collision' };
  return forme;
}

/**
 * Phrase courte pour l'humain (API / CLI). Jamais le secret, jamais un conseil
 * qui inventerait un prénom.
 */
export function expliquerRefusBapteme(motif: MotifRefusBapteme, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifRefusBapteme, string> = {
    vide: 'Le nom de baptême est vide.',
    trop_court: `Le nom de baptême doit faire au moins ${NOM_BAPTEME_MIN} caractères.`,
    trop_long: `Le nom de baptême ne peut pas dépasser ${NOM_BAPTEME_MAX} caractères.`,
    caracteres:
      'Le nom de baptême ne peut contenir que des lettres, chiffres, espaces, tirets ou apostrophes.',
    technique:
      'Ce nom est un identifiant technique d’agent (ex. claude-code, codex) — ce n’est pas un baptême.',
    collision: 'Ce nom de baptême est déjà porté par une autre ouvrière.',
    noeud_inconnu: 'Aucune ouvrière ne porte cet identifiant.',
  };
  const en: Record<MotifRefusBapteme, string> = {
    vide: 'The baptismal name is empty.',
    trop_court: `The baptismal name must be at least ${NOM_BAPTEME_MIN} characters.`,
    trop_long: `The baptismal name cannot exceed ${NOM_BAPTEME_MAX} characters.`,
    caracteres:
      'The baptismal name may only contain letters, digits, spaces, hyphens, or apostrophes.',
    technique:
      'That name is a technical agent id (e.g. claude-code, codex) — not a baptismal name.',
    collision: 'That baptismal name is already held by another worker.',
    noeud_inconnu: 'No worker has that id.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
