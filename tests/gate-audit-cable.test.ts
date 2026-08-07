// LE GATE `npm audit` RESTE CÂBLÉ DANS LA CI — et rien ne doit pouvoir le
// retirer, ni l'affaiblir, en silence.
//
// ─── MÊME LEÇON QUE `bornes-cablees.test.ts` (§ 6.5), APPLIQUÉE À UN PAS DE CI ─
//
// Une garde ÉCRITE mais que rien ne surveille disparaît à la première retouche
// sans qu'aucun banc ne rougisse. On l'a vu sur les bornes d'élagage du store ;
// c'est vrai aussi d'une ÉTAPE de `.github/workflows/ci.yml`. Or ce gate-ci est
// le seul rempart AUTOMATIQUE de la ruche contre une vulnérabilité HAUTE d'une
// dépendance (`docs/DEFINITION-DE-SORTIE.md § C`) : il a fermé deux vulns à sa
// naissance (#193). Le laisser nu, ce serait rouvrir sans bruit la porte qu'il
// a fermée — et pire, un gate AFFAIBLI (seuil relevé à « critical ») aurait
// encore l'air présent tout en laissant passer une vuln haute.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('LE GATE npm audit RESTE CÂBLÉ DANS LA CI', () => {
  it('la CI lance `npm audit`, et elle BARRE sur HAUTE', () => {
    // Deux affirmations distinctes, parce que deux façons de le neutraliser :
    // retirer l'étape, ou relever le seuil pour que la haute passe.
    expect(ci, 'la CI ne lance plus `npm audit` — le gate a disparu').toMatch(/\bnpm audit\b/);
    expect(
      ci,
      'le seuil `--audit-level=high` a sauté — une vuln haute passerait, gate ou pas',
    ).toMatch(/npm audit[^\n]*--audit-level=high/);
  });
});
