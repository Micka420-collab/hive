// L'AFFICHAGE DU RAYON — les décisions cosmétiques, sorties du rendu.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Même motif que `cerveau-designation.ts` (§ 2 quaterdecies du carnet des
// erreurs) : une règle enfouie dans le corps d'un composant `.tsx` ne s'éprouve
// qu'en montant tout le composant. L'icône d'une entrée du rayon est une
// fonction PURE — une entrée, une chaîne — sans rien du rendu. La sortir ici la
// rend jugeable au retour près, sans happy-dom ni React.

// La MÊME source que `EntreeRayon` de l'api (qui n'en est qu'un ré-export) —
// prise ici directement pour rester self-contained : importer `../api`
// entraînerait tout le graphe du dashboard dans le tsconfig racine, qui n'y est
// pas fait.
import type { Entree as EntreeRayon } from '../../../src/shared/rayon.js';

/**
 * L'icône d'une entrée du rayon.
 *
 * Un DOSSIER se départage AVANT l'extension : c'est un dossier, pas un fichier
 * nommé « .dossier ». Le départage `e.type === 'dossier'` mué en `!==`
 * inverserait tout — le dossier prendrait l'icône « fichier quelconque » (son
 * nom n'a pas d'extension), et un `.ts` prendrait celle d'un dossier. Sur un
 * rayon « lisible à 3 mètres », c'est lui retirer sa seule raison d'être.
 */
export function icone(e: EntreeRayon, ouvert: boolean): string {
  if (e.type === 'dossier') return ouvert ? '📂' : '📁';
  const n = e.nom.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(n)) return '📜';
  if (/\.(json|ya?ml|toml)$/.test(n)) return '⚙️';
  if (/\.(md|txt)$/.test(n)) return '📝';
  if (/\.(css|scss|html?)$/.test(n)) return '🎨';
  if (/\.(png|jpe?g|gif|svg|ico|webp)$/.test(n)) return '🖼';
  return '📄';
}
