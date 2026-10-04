// Le verdict du banc de fumée : ce qu'un rapport `--diagnostic` doit porter
// pour dire « l'app installée marche ».
//
// Le rapport est écrit par l'app elle-même (`diagnostic.ts`) ; ce verdict est
// relu par le banc (`scripts/fumee.mjs`), en CI sur les trois systèmes et à la
// main ici. Il vit dans un module pur pour que la règle soit la même des deux
// côtés — et éprouvée sans lancer d'app.

export interface RapportDiagnostic {
  readonly version: string;
  readonly plateforme: string;
  readonly reine: { readonly enLigne: boolean; readonly origine: string | null };
  readonly sante: { readonly statut: number | null; readonly corps: unknown };
  readonly ecran: {
    readonly url: string | null;
    readonly rendu: boolean;
    readonly titre: string | null;
  };
  /** `posee` : l'en-tête CSP de la coquille a atteint la page (`eval` y est refusé). */
  readonly csp: { readonly posee: boolean; readonly violations: readonly string[] };
  /**
   * Un document d'Aperçu (Rayon) a exécuté son script inline dans son cadre
   * `sandbox`, sous la CSP de l'écran — ce qu'un `srcdoc` ne pouvait plus.
   */
  readonly apercu: boolean;
  /** L'entrée « lancer à l'ouverture de session » se lit comme posée (le banc Windows la pose). */
  readonly session: boolean;
  readonly ouvrieres: number;
  readonly capture: string | null;
  readonly erreur: string | null;
}

/** Les raisons pour lesquelles un rapport n'est PAS vert — vide s'il l'est. */
export function defautsDuRapport(r: RapportDiagnostic): string[] {
  const d: string[] = [];
  if (r.erreur !== null) d.push(`erreur : ${r.erreur}`);
  if (!r.reine.enLigne || r.reine.origine === null) d.push('la Reine ne s’est pas annoncée');
  const corps = r.sante.corps as { ok?: unknown } | null;
  if (r.sante.statut !== 200 || corps?.ok !== true) {
    d.push(`/api/health ne répond pas { ok: true } (statut ${String(r.sante.statut)})`);
  }
  if (
    r.reine.origine !== null &&
    (r.ecran.url === null || !r.ecran.url.startsWith(`${r.reine.origine}/`))
  ) {
    d.push(`la fenêtre n’est pas sur l’origine de la Reine (${String(r.ecran.url)})`);
  }
  if (!r.ecran.rendu) d.push('l’écran ne s’est pas rendu (#root vide)');
  if (!r.csp.posee) d.push('la CSP n’est pas posée sur l’écran');
  if (r.csp.violations.length > 0) d.push(`${String(r.csp.violations.length)} violation(s) de CSP`);
  if (!r.apercu) d.push('l’Aperçu du Rayon n’exécute pas ses scripts sous la CSP de l’écran');
  if (r.capture === null) d.push('aucune capture');
  return d;
}
