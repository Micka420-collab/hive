// @vitest-environment happy-dom
//
// LA VITRINE, EXÉCUTÉE — le test que quarante-cinq autres ne faisaient pas.
//
// ─── LE DÉFAUT QUI A MOTIVÉ CE FICHIER ───────────────────────────────────────
//
// Le 1er août 2026, un mois avant la sortie, la page publique du projet portait
// ceci dans son dictionnaire anglais :
//
//     'mc.12.d':
//     'mc.13.t': 'h · Works',
//
// `mc.12.d` avait perdu sa valeur — mangée par une retouche —, si bien que
// l'analyseur lisait `'mc.12.d': 'mc.13.t'` puis butait sur le `:` suivant :
//
//     Uncaught SyntaxError: Unexpected token ':'
//
// Un script qui ne s'analyse pas ne s'exécute PAS DU TOUT. Sur la vitrine en
// ligne, cela voulait dire : le basculement FR/EN mort, le bouton « copier »
// mort, le journal de l'essaim vide, le décalage des ancres jamais appliqué.
// Tout, depuis la première ligne, sur la page que les visiteurs voient.
//
// ─── POURQUOI QUARANTE-CINQ TESTS N'ONT RIEN VU ──────────────────────────────
//
// Parce qu'ils lisaient tous le HTML COMME DU TEXTE. `tests/site.test.ts`
// vérifie même que « chaque clé du HTML a une traduction anglaise » — et cette
// garde-là passait au vert, parce que sa régulière trouvait bien `'mc.12.d':`
// dans le fichier. Elle cherchait une CLÉ ; il manquait une VALEUR.
//
// C'est le défaut signature de ce dépôt, dans sa forme la plus pure : un chemin
// que personne n'exécute et que tout le monde croit bon. La différence entre
// lire et exécuter n'est pas une nuance de rigueur : c'est la seule chose qui
// sépare une suite verte d'une page morte.
//
// ─── CE QUE CE FICHIER FAIT, DANS L'ORDRE DE CE QU'IL COÛTE ──────────────────
//
// 1. Il COMPILE chaque script que le navigateur exécuterait. Déterministe,
//    instantané, sans navigateur — c'est la garde qui aurait mordu.
// 2. Il ÉVALUE le dictionnaire anglais au lieu de le lire, ce qui rend une clé
//    sans valeur impossible à confondre avec une traduction.
// 3. Il MONTE la page et clique, parce qu'un script qui s'analyse peut encore
//    ne rien faire.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// ─── POURQUOI `process.cwd()` ET NON `import.meta.url` ───────────────────────
//
// Sous l'environnement `happy-dom`, `import.meta.url` devient une URL `http:`
// — le module se croit chargé par un navigateur — et `readFileSync` refuse :
// « The URL must be of scheme file ». Le reste du dépôt lit par `import.meta.url`
// et a raison de le faire ; ici c'est la seule ligne qui ne le peut pas.
// `vitest` pose son répertoire courant à la racine du projet.
const VITRINE = readFileSync(path.resolve(process.cwd(), 'site/index.html'), 'utf8');

interface BlocScript {
  readonly type: string;
  readonly code: string;
  readonly ligne: number;
}

/**
 * Les scripts que le NAVIGATEUR exécuterait — et eux seuls.
 *
 * `type="application/ld+json"` est une donnée : le navigateur ne l'exécute
 * jamais. La compiler ici échouerait à tous les coups et il faudrait alors
 * désarmer la garde entière — c'est ainsi qu'on perd un test.
 */
function scriptsExecutes(html: string): BlocScript[] {
  const blocs: BlocScript[] = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attributs = m[1] ?? '';
    const type = /type\s*=\s*"([^"]+)"/.exec(attributs)?.[1] ?? 'text/javascript';
    if (!/^(text\/javascript|application\/javascript|module)$/.test(type)) continue;
    blocs.push({ type, code: m[2] ?? '', ligne: html.slice(0, m.index).split('\n').length });
  }
  return blocs;
}

describe('CHAQUE SCRIPT DE LA VITRINE S’ANALYSE', () => {
  it('il y a bien un script à analyser — sinon la garde ne garde rien', () => {
    // Sans cette borne, un jour où le `<script>` change de forme, la boucle
    // ci-dessous tournerait à vide et rendrait un vert parfaitement creux.
    const blocs = scriptsExecutes(VITRINE);
    expect(blocs.length, 'aucun script exécutable trouvé dans la vitrine').toBeGreaterThan(0);
    const gros = blocs.reduce((a, b) => (a.code.length > b.code.length ? a : b));
    expect(gros.code.length, 'le script principal a maigri de façon suspecte').toBeGreaterThan(
      10_000,
    );
  });

  for (const bloc of scriptsExecutes(VITRINE)) {
    it(`le script de la ligne ${String(bloc.ligne)} se compile`, () => {
      // ─── L'ASSERTION QUI AURAIT MORDU ────────────────────────────────────
      //
      // `new Function` fait exactement ce que fait le navigateur au chargement :
      // il ANALYSE. Il n'exécute pas — on ne veut ni `document` ni minuterie
      // ici, seulement savoir si le fichier est du JavaScript valide.
      expect(() => new Function(bloc.code)).not.toThrow();
    });
  }
});

/**
 * Le dictionnaire anglais, ÉVALUÉ.
 *
 * `tests/site.test.ts` en lit les clés à la régulière. C'est ce qui a laissé
 * passer une clé sans valeur : la régulière voyait `'mc.12.d':` et concluait
 * « traduite ». Un objet, lui, ne peut pas avoir une clé sans valeur.
 */
function dictionnaireAnglais(): Record<string, unknown> {
  const debut = VITRINE.indexOf('var EN = {');
  expect(debut, 'dictionnaire EN introuvable').toBeGreaterThan(-1);
  const ouvrante = VITRINE.indexOf('{', debut);
  let profondeur = 0;
  let fin = -1;
  let dansChaine: string | null = null;
  for (let i = ouvrante; i < VITRINE.length; i++) {
    const c = VITRINE[i];
    if (dansChaine !== null) {
      if (c === '\\') i++;
      else if (c === dansChaine) dansChaine = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') dansChaine = c;
    else if (c === '{') profondeur++;
    else if (c === '}') {
      profondeur--;
      if (profondeur === 0) {
        fin = i;
        break;
      }
    }
  }
  expect(fin, 'accolade fermante du dictionnaire EN introuvable').toBeGreaterThan(ouvrante);
  const litteral = VITRINE.slice(ouvrante, fin + 1);
  return new Function(`return ${litteral}`)() as Record<string, unknown>;
}

describe('LE DICTIONNAIRE ANGLAIS EST UN OBJET, PAS DU TEXTE', () => {
  it('il s’évalue, et il est copieux', () => {
    const en = dictionnaireAnglais();
    expect(Object.keys(en).length, 'dictionnaire anglais suspicieusement maigre').toBeGreaterThan(
      100,
    );
  });

  it('AUCUNE CLÉ N’A PERDU SA VALEUR', () => {
    // Le défaut exact : `'mc.12.d':` suivi de `'mc.13.t': …` donnait, pour qui
    // lisait le texte, deux clés traduites ; pour l'analyseur, une erreur de
    // syntaxe. Ici, une valeur mangée devient soit une exception à
    // l'évaluation, soit une valeur qui ressemble à une clé — les deux mordent.
    const en = dictionnaireAnglais();
    const suspectes: string[] = [];
    for (const [cle, valeur] of Object.entries(en)) {
      if (typeof valeur !== 'string' || valeur.trim() === '') suspectes.push(`${cle} → vide`);
      // Une valeur qui a la forme d'une CLÉ du dictionnaire est le signe que la
      // vraie valeur a été mangée et que la clé suivante a glissé à sa place.
      else if (Object.prototype.hasOwnProperty.call(en, valeur))
        suspectes.push(`${cle} → « ${valeur} », qui est une autre clé`);
    }
    expect(suspectes, 'clé(s) dont la valeur a été mangée').toEqual([]);
  });
});

describe('LA PAGE MONTÉE FAIT CE QU’ELLE PROMET', () => {
  // Un script peut s'analyser et ne rien faire. Ces trois-là sont les gestes
  // que la page propose au visiteur ; ils passent par le même script.

  beforeEach(() => {
    document.documentElement.innerHTML = VITRINE.replace(/^[\s\S]*?<html[^>]*>/, '').replace(
      /<\/html>[\s\S]*$/,
      '',
    );
    // happy-dom n'exécute pas les scripts insérés par `innerHTML` : on prend
    // donc le script principal et on le lance nous-mêmes, ce qui est exactement
    // ce que fait le navigateur une fois le document analysé.
    const principal = scriptsExecutes(VITRINE).reduce((a, b) =>
      a.code.length > b.code.length ? a : b,
    );
    new Function(principal.code)();
  });

  /** Clique un bouton de langue et rend le titre qui en résulte. */
  function basculer(bouton: 'btn-fr' | 'btn-en'): string {
    document.getElementById(bouton)?.dispatchEvent(new Event('click', { bubbles: true }));
    return (document.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('LE BASCULEMENT CHANGE VRAIMENT LE TEXTE, DANS LES DEUX SENS', () => {
    // ─── ON NE SUPPOSE PAS LA LANGUE DE DÉPART ────────────────────────────
    //
    // La page choisit sa langue d'après celle du navigateur, et `happy-dom`
    // démarre en anglais comme Chromium. Une première version de ce test
    // affirmait « au départ, c'est du français » : elle a rougi tout de suite,
    // et elle aurait rougi pareil dans un navigateur configuré en anglais —
    // c'est-à-dire chez la moitié des visiteurs. On CLIQUE d'abord.
    expect(document.querySelector('h1'), 'pas de titre principal').not.toBeNull();

    const fr = basculer('btn-fr');
    expect(fr, 'le français doit parler d’essaim').toContain('essaim');

    const en = basculer('btn-en');
    expect(en, 'le clic sur EN n’a rien changé').not.toBe(fr);
    expect(en.toLowerCase()).toContain('swarm');
  });

  it('et le retour en FR remet EXACTEMENT le français d’origine', () => {
    // Le français n'est PAS dans le dictionnaire : il est capturé du HTML au
    // chargement. Un aller-retour est le seul moyen de vérifier que la capture
    // a eu lieu — un aller simple passerait même si elle manquait.
    const depart = basculer('btn-fr');
    basculer('btn-en');
    expect(basculer('btn-fr'), 'le français a été perdu en route').toBe(depart);
  });

  it('le journal de l’essaim se remplit — il était VIDE quand le script mourait', () => {
    expect(document.querySelectorAll('#journal li').length).toBeGreaterThan(0);
  });
});
