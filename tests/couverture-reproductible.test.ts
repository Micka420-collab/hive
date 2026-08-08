// La couverture doit se relancer depuis un clone NEUF, pas seulement sur la
// machine où on l'a écrite.
//
// ─── LE TROU QUI A MOTIVÉ CE FICHIER ─────────────────────────────────────────
//
// `npm run couverture` (`vitest run --coverage`) exige un FOURNISSEUR — le
// paquet qui instrumente le code, ici `@vitest/coverage-v8`. Or ce paquet est
// une dépendance de pair OPTIONNELLE de vitest : il n'entre PAS avec lui. Tant
// qu'il n'est pas déclaré à part dans `devDependencies`, un `npm ci` propre ne
// l'installe jamais, et la commande meurt sur :
//
//   MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'
//
// C'est exactement ce qui s'était produit : le lot qui a introduit
// `npm run couverture` (commit 70cd3ad) l'a cru « déjà présent via vitest ».
// Il ne l'était que par accident — un reliquat dans `node_modules` d'une
// installation antérieure. Le chiffre de couverture annoncé « reproductible »
// ne l'était donc pas depuis un clone vierge : la seule preuve qui compte pour
// un instrument de mesure lui manquait.
//
// ─── POURQUOI UNE GARDE, ET POURQUOI ELLE PEUT ROUGIR ────────────────────────
//
// Sur une machine de développement, tout est installé et la commande marche :
// le trou est invisible au quotidien, comme la mauvaise place d'un paquet dans
// `paquet.test.ts`. Retirer la déclaration ne casse RIEN localement — ça brise
// seulement le clone neuf de quelqu'un d'autre, sans que personne s'en aperçoive
// avant d'essayer.
//
// Ce banc lie le fournisseur DÉCLARÉ au fournisseur CONFIGURÉ (`provider` dans
// `vitest.config.ts`) et exige qu'il soit RÉSOLVABLE. Il rougit si l'un
// manque — c'est précisément l'état d'avant le correctif.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Paquet {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const paquet = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as Paquet;

const configVitest = readFileSync(
  fileURLToPath(new URL('../vitest.config.ts', import.meta.url)),
  'utf8',
);

/** Le paquet-fournisseur qu'exige chaque valeur de `provider` de vitest. */
const FOURNISSEUR_POUR = {
  v8: '@vitest/coverage-v8',
  istanbul: '@vitest/coverage-istanbul',
} as const;

/** Le `provider` réellement écrit dans la config de couverture. */
function providerConfigure(): keyof typeof FOURNISSEUR_POUR {
  const trouve = configVitest.match(/provider:\s*['"](\w+)['"]/);
  if (trouve === null) {
    throw new Error("Aucun `provider` de couverture n'est configuré dans vitest.config.ts.");
  }
  const nom = trouve[1] as keyof typeof FOURNISSEUR_POUR;
  if (!(nom in FOURNISSEUR_POUR)) {
    throw new Error(`Fournisseur de couverture inconnu : « ${nom} ».`);
  }
  return nom;
}

describe('la couverture se relance depuis un clone neuf', () => {
  it('a un script `couverture` qui demande bien --coverage', () => {
    expect(paquet.scripts?.couverture).toContain('--coverage');
  });

  it('DÉCLARE le fournisseur configuré dans les dépendances', () => {
    // Le fournisseur nommé dans vitest.config.ts doit figurer noir sur blanc
    // dans package.json — sinon `npm ci` ne l'installe pas et la commande meurt.
    const fournisseur = FOURNISSEUR_POUR[providerConfigure()];
    const declare = {
      ...paquet.dependencies,
      ...paquet.devDependencies,
    };
    expect(Object.keys(declare)).toContain(fournisseur);
  });

  it('RÉSOUT le fournisseur (il est réellement installé, pas juste déclaré)', () => {
    // Déclaré ne suffit pas : la preuve qu'`npm run couverture` ne meurt pas
    // sur « MISSING DEPENDENCY », c'est que le module se résout ici et maintenant.
    const fournisseur = FOURNISSEUR_POUR[providerConfigure()];
    const require = createRequire(import.meta.url);
    expect(() => require.resolve(fournisseur)).not.toThrow();
  });
});
