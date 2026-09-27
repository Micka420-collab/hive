// LE NOM DE VARIABLE D'UNE CLÉ, DÉDUIT DE SON LIBELLÉ — module PUR.
//
// « Clé OpenAI (Codex) » → `OPENAI_API_KEY`. La Reine s'en sert pour poser la
// clé qu'un humain accorde (`server.ts`), et la Chambre pour PRÉREMPLIR le nom
// dans le formulaire d'accord (`Chambre.tsx`). Une seule règle, deux lecteurs.
//
// ─── POURQUOI ELLE N'EST PLUS DANS `orchestrator/requisition-env.ts` ─────────
//
// Elle y vivait, à côté de ce qui lit et écrit le `.env` de la Reine. La
// Chambre l'importait donc DEPUIS UN MODULE DE NODE : `requisition-env` tire
// `node:fs` et `installer.ts`, qui tire `orchestrator/auth.ts`, qui tire un
// secret au chargement (`randomBytes(32)`). Dans le navigateur, Vite remplace
// `node:crypto` par un module vide : le morceau de la Chambre levait dès son
// chargement, et le tableau de bord entier devenait une page blanche.
//
// Ce module n'importe RIEN, et c'est sa raison d'être : il peut partir au
// navigateur. `tests/paquet-navigateur.test.ts` refuse qu'un module de Node y
// reparte, par ce chemin-ci ou par un autre.

/** Catalogue optionnel pour libellés ambigus (clé normalisée minuscule). */
const CATALOGUE_ENV: Record<string, string> = {
  'clé seedance': 'SEEDANCE_API_KEY',
  'cle seedance': 'SEEDANCE_API_KEY',
  seedance: 'SEEDANCE_API_KEY',
  'clé openai': 'OPENAI_API_KEY',
  'cle openai': 'OPENAI_API_KEY',
  'clé openai (codex)': 'OPENAI_API_KEY',
  'cle openai (codex)': 'OPENAI_API_KEY',
  'clé ou session anthropic (claude code)': 'ANTHROPIC_API_KEY',
  'cle ou session anthropic (claude code)': 'ANTHROPIC_API_KEY',
  'clé anthropic': 'ANTHROPIC_API_KEY',
  'cle anthropic': 'ANTHROPIC_API_KEY',
  'clé xai': 'XAI_API_KEY',
  'cle xai': 'XAI_API_KEY',
  'clé xai ou session grok': 'XAI_API_KEY',
  'cle xai ou session grok': 'XAI_API_KEY',
  'clé ou session cursor': 'CURSOR_API_KEY',
  'cle ou session cursor': 'CURSOR_API_KEY',
  'clé cursor': 'CURSOR_API_KEY',
  'cle cursor': 'CURSOR_API_KEY',
  'clé openrouter': 'OPENROUTER_API_KEY',
  'cle openrouter': 'OPENROUTER_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'clé queen bee': 'QUEEN_BEE_API_KEY',
  'cle queen bee': 'QUEEN_BEE_API_KEY',
  'queen bee': 'QUEEN_BEE_API_KEY',
};

/** Indices dans le libellé (après normalisation) → variable d’environnement. */
const INDICES_ENV: Array<{ re: RegExp; nom: string }> = [
  { re: /seedance/, nom: 'SEEDANCE_API_KEY' },
  { re: /openrouter|queen\s*bee/, nom: 'OPENROUTER_API_KEY' },
  { re: /openai|codex/, nom: 'OPENAI_API_KEY' },
  { re: /anthropic|claude/, nom: 'ANTHROPIC_API_KEY' },
  { re: /\bcursor\b/, nom: 'CURSOR_API_KEY' },
  { re: /\bxai\b|grok/, nom: 'XAI_API_KEY' },
];

/** Le nom de variable d’environnement que désigne un libellé humain de clé. */
export function nomEnvDepuisLibelle(libelle: string): string {
  const norm = libelle.trim().toLowerCase();
  if (CATALOGUE_ENV[norm]) return CATALOGUE_ENV[norm];
  for (const { re, nom } of INDICES_ENV) {
    if (re.test(norm)) return nom;
  }
  const slug = libelle
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^(clé|cle|key)\s+/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  if (!slug) return 'API_KEY';
  if (slug.endsWith('_KEY') || slug.endsWith('_API_KEY')) return slug;
  return `${slug}_API_KEY`;
}
