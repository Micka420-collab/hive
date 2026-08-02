// LES JETONS DE COULEUR DE LA VITRINE — déclarés, employés, et pas l'inverse.
//
// ─── LE DÉFAUT QUI A MOTIVÉ CE FICHIER ───────────────────────────────────────
//
// La vitrine employait QUATRE fois des variables CSS qui n'ont jamais été
// déclarées :
//
//     .etape h3          { color: var(--gold-soft); }   ← jeton fantôme
//     .btn.ghost         { color: var(--gold-soft); }   ← jeton fantôme
//     .rc-adresse input  { color: var(--gold-soft); }   ← jeton fantôme
//     .rc-cmd            { background: var(--bg-2); }   ← jeton fantôme
//
// Une `var()` non résolue et sans repli rend la déclaration INVALIDE : le
// navigateur la jette et la propriété retombe sur l'héritage. Trois de ces
// quatre lignes tombaient par chance sur quelque chose de lisible — vérifié
// dans un vrai Chromium, `getComputedStyle` à l'appui, plutôt que déduit.
//
// La quatrième se voyait : `.rc-cmd` n'avait aucun fond, et le bloc qui montre
// la commande AVANT qu'on la copie ne ressemblait pas à un bloc de code.
//
// ─── POURQUOI CE N'EST PAS UN DÉTAIL DE FEUILLE DE STYLE ─────────────────────
//
// Le vrai coût n'est pas le pixel : c'est qu'une ligne de CSS qui ne s'applique
// pas SE LIT COMME SI ELLE S'APPLIQUAIT. La prochaine personne qui voudra
// changer la couleur de `.etape h3` modifiera `--gold-soft`, ne verra rien
// bouger, et cherchera ailleurs. C'est le § 1 du journal — ce qui n'est pas
// exécuté n'est pas vérifié — appliqué à une feuille de style.
//
// Et il n'y avait aucune garde : le CSS n'est ni compilé ni typé, personne ne
// prévient. Celle-ci coûte trente lignes et une milliseconde.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGES = ['../site/index.html', '../site/rush/index.html'] as const;

/** Les jetons déclarés dans un bloc `:root` — ou n'importe où ailleurs. */
function declares(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]!));
}

/**
 * Les jetons employés, SANS repli.
 *
 * `var(--x, #fff)` porte sa propre valeur de secours : la déclaration reste
 * valide même si `--x` n'existe pas. On ne la compte donc pas comme une
 * dépendance — la signaler ferait du bruit, et un test bruyant finit désarmé.
 */
function employes(css: string): Set<string> {
  const vus = new Set<string>();
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
    if (m[2] === ')') vus.add(m[1]!);
  }
  return vus;
}

for (const page of PAGES) {
  const html = readFileSync(new URL(page, import.meta.url), 'utf8');
  const nom = page.replace('../', '');

  describe(`${nom} — les jetons de couleur`, () => {
    it('il y a bien des jetons à vérifier', () => {
      // Sans cette borne, un jour où le CSS change de forme, les deux
      // assertions suivantes compareraient deux ensembles vides et
      // rendraient un vert parfaitement creux.
      expect(declares(html).size, 'aucun jeton déclaré lu').toBeGreaterThan(5);
      expect(employes(html).size, 'aucun jeton employé lu').toBeGreaterThan(5);
    });

    it('AUCUN JETON FANTÔME — tout `var(--x)` sans repli est déclaré', () => {
      const manquants = [...employes(html)].filter((j) => !declares(html).has(j)).sort();
      expect(
        manquants,
        'jeton(s) employé(s) et jamais déclaré(s) : la déclaration CSS est jetée en silence',
      ).toEqual([]);
    });

    it('AUCUN JETON MORT — tout jeton déclaré sert quelque part', () => {
      // `--amber: #ff9f1a` traînait ici sans un seul usage. Un jeton mort n'a
      // pas de coût d'exécution ; il a un coût de LECTURE — il fait croire à
      // une palette de sept accents là où six sont employés, et le septième
      // devient le candidat naturel de la prochaine retouche.
      const inutiles = [...declares(html)].filter((j) => !html.includes(`var(${j})`)).sort();
      expect(inutiles, 'jeton(s) déclaré(s) et jamais employé(s)').toEqual([]);
    });
  });
}
