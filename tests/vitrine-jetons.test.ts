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
import { capacites, degrade } from '../src/tui/rendu.js';

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

// ─── LE MIEL EST LE MÊME DANS LE TERMINAL ET DANS LE NAVIGATEUR ──────────────

/**
 * Les deux bouts de la rampe du module pur, LUS DANS SON COMPORTEMENT.
 *
 * `RAMPE_MIEL` n'est pas exportée, et il ne faut pas l'exporter pour un test :
 * on élargirait l'API publique d'un module pour la commodité d'une assertion.
 * `degrade` d'une chaîne de deux caractères pose le premier à t=0 et le second
 * à t=1 — donc les deux extrémités exactes de la rampe.
 *
 * C'est la méthode que `installeurs.test.ts` emploie déjà : comparer au
 * COMPORTEMENT du module, jamais à une liste recopiée dans le test, qui
 * dériverait à son tour.
 */
function bornesDuMiel(): { bas: string; haut: string } {
  const caps = capacites({ COLORTERM: 'truecolor' }, { isTTY: true, columns: 80 });
  const rvb = [...degrade('AB', caps).matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map(
    (m) => `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`,
  );
  expect(rvb.length, 'deux couleurs attendues aux deux bouts de la rampe').toBe(2);
  return { bas: rvb[0]!, haut: rvb[1]! };
}

describe('UN SEUL MIEL POUR DEUX MÉDIAS', () => {
  const vitrine = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const jeton = (nom: string): string =>
    (new RegExp(`${nom}:\\s*(#[0-9a-f]{6})`, 'i').exec(vitrine)?.[1] ?? '').toLowerCase();

  it('L’ACCENT DE LA VITRINE EST CELUI DE L’INSTALLEUR', () => {
    // ─── POURQUOI CETTE GARDE VAUT PLUS QUE SON CONTENU ────────────────────
    //
    // « La même marque partout » est une phrase gratuite tant que rien ne la
    // vérifie. La vitrine peignait en `#f6b93b` et le terminal en `#f5b838` :
    // deux miels à trois points d'écart, invisibles côte à côte et différents
    // dans le fichier — c'est-à-dire une identité qu'on ne peut pas déplacer
    // d'un seul geste. Désormais, changer la rampe du module rougit ici.
    const { haut } = bornesDuMiel();
    expect(jeton('--gold-2'), 'la lumière du site = le haut de la rampe').toBe(haut);
  });

  it('AUCUN LITTÉRAL NE DOUBLE UN JETON', () => {
    // ─── LA CAUSE DU JETON MORT, ET NON SON SYMPTÔME ───────────────────────
    //
    // `--amber` traînait sans emploi alors que sa valeur, `#ff9f1a`, était
    // écrite ONZE fois en dur — neuf dans le SVG de l'essaim, deux dans les
    // données du journal. Le jeton n'était pas mort par oubli : il était mort
    // parce que tout le monde le contournait.
    //
    // Une palette qu'on ne peut pas déplacer d'un seul geste n'est pas une
    // palette, c'est une liste de suggestions.
    const racine = /:root \{[\s\S]*?\n {6}\}/.exec(vitrine);
    expect(racine, 'bloc :root introuvable').not.toBeNull();
    const valeurs = new Map<string, string>();
    for (const m of racine![0].matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
      valeurs.set(m[2]!.toLowerCase(), m[1]!);
    }
    // ─── LA SEULE EXCEPTION, ET ELLE EST NOMMÉE ────────────────────────────
    //
    // `<meta name="theme-color" content="#130f09">` colore la barre du
    // navigateur sur mobile. Ce n'est pas du CSS : l'attribut n'accepte PAS
    // `var()`, la valeur DOIT y être écrite en clair.
    //
    // On la retire donc de la comparaison, ligne par ligne et par son nom —
    // plutôt que d'assouplir la règle « aucun littéral ». Une exception large
    // rouvre la porte à toutes les autres ; une exception nommée se relit.
    const corps = (
      vitrine.slice(0, racine!.index) + vitrine.slice(racine!.index + racine![0].length)
    )
      .split('\n')
      .filter((l) => !l.includes('name="theme-color"'))
      .join('\n');

    const doublons: string[] = [];
    for (const [hex, nom] of valeurs) {
      const n = (corps.match(new RegExp(hex, 'gi')) ?? []).length;
      if (n > 0) doublons.push(`${hex} (${nom}) écrit ${String(n)} fois en dur`);
    }
    expect(doublons, 'valeur(s) de jeton recopiée(s) au lieu d’être employée(s)').toEqual([]);
  });
});
