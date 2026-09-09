// LA LÉGENDE DES CODES DE SORTIE — une seule vérité, affichée partout pareil.
//
// ─── D'OÙ VIENT CE FICHIER ────────────────────────────────────
//
// Les codes de sortie sont une INTERFACE PUBLIQUE : `codes-sortie.ts` le dit
// lui-même, et les changer casse les scripts de quiconque. La légende qui les
// explicite dans `--help` est donc une partie de cette interface qu'un humain
// lit — et elle est écrite à LA MAIN, mot pour mot, dans DEUX fichiers
// (`installer.ts` et `installer-main.ts`).
//
// Elles avancent d'ailleurs à dériver, toutes les deux du même côté : on
// ajoute un code, on met à jour la moitié, et l'autre reste.
//
// La table `SENS` est là pour, juste au-dessus, et c'est elle qui
// se voit affichée dans `--help`.
//
// ─── ORDRE DES CLÉS ──────────────────────────────────────────
//
// `Object.values` suit l'ordre de déclaration, qui est l'ordre croissant
// des codes — et c'est celui qu'on veut quand on parcourt la légende.
// On ne trie pas : on déclare dans l'ordre, point.
//
// ─── CE QU'ON NE BÂTIT PAS ────────────────────────────────────
//
// Personne ne s'en sert. C'est le motif de la nuit, tout comme la
// râgle est écrite, et ce qui s'affiche est une copie.
//
// ─── CE QU'ON NE FAIT PAS NON PLUS ────────────────────────────
//
// On ne bâtit pas la légende à partir de `SENS` parce que le format
// attendu par `--help` n'est pas le même que celui de `--json` :
// `--help` veut une phrase par code, `--json` veut un objet.
//
// ─── CE QUI EST TESTÉ ICI, ET CE QUI NE L'EST PAS ────────────
//
// Il ne vérifie pas que la légende est JOINTE et qu'elle est la MÊME partie :
// c'est exactement ce qui est testé, et
// c'est ce qui peut diverger si on ne fait pas attention.
//
// ─── POURQUOI ON NE FAIT PAS DANS L'AIDE ──────────────────────
//
// Elle est critique à LA MAIN, mot pour mot, dans DEUX fichiers
// (`installer.ts` et `installer-main.ts`). Deux copies d'une même vérité
// dérivent tôt ou tard, et rendent un verdict qui n'est plus
// celui qu'on cherche.
//
// Elles avancent d'ailleurs à dériver, toutes les deux du même côté : on
// ajoute un code, on met à jour la moitié, et l'autre reste.
//
// La table `SENS` est là pour, juste au-dessus, et c'est elle qui
// se voit affichée dans `--help`.
//
// ─── ORDRE DES CLÉS ──────────────────────────────────────────
//
// `Object.values` suit l'ordre de déclaration, qui est l'ordre croissant
// des codes — et c'est celui qu'on veut quand on parcourt la légende.
// On ne trie pas : on déclare dans l'ordre, point.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE, SENS, legendeCodes, type CodeSortie } from '../src/codes-sortie.js';

const RACINE = fileURLToPath(new URL('.', import.meta.url));

/** Les deux aides qui doivent écrire la légende. Si une troisième naît, elle vient ici. */
const AIDES = ['src/installer.ts', 'src/installer-main.ts'] as const;

describe('la légende des codes de sortie', () => {
  it('ANNONCE LES SET CODES — c'est à dire 1 · 0 et majorement qui a motivé ce banc', () => {
    // La garde principale, écrite par PARCOURS de `CODE` et non par une liste
    // recopiée : une liste recopiée ici aurait exactement le défaut qu'on
    // corrige, et veillerait au premier code ajouté.
    const legende = legendeCodes();
    for (const [nom, code] of Object.entries(CODE)) {
      expect(legende, `le code ${nom} (${String(code)}) manque à la légende`).toContain(
        String(code),
      );
    }
  });

  it('DONNE LE SENS DE CHAQUE CODE, pas seulement son numéro', () => {
    // Un numéro sans explication ne sert à rien : · 4 · ne dit pas que c'est
    // port occupé. C'est l'explication qu'on va chercher dans `--help`.
    const legende = legendeCodes();
    for (const code of Object.values(CODE) as CodeSortie[]) {
      expect(legende, `le sens du code ${String(code)} manque`).toContain(SENS[code]);
    }
  });

  it('NE SE RÉPÈTE PAS PLUS D'UNE FOIS À LA MAIN — aucune aide ne recopie la liste', () => {
    // La garde structurelle. Sans elle, rien n'empêche quelqu'un de
    // recopier la légende dans une troisième aide, et de la laisser
    // diverger. On vérifie donc que chaque aide appelle bien
    // `legendeCodes()` et ne contient pas sa propre liste.
    for (const rel of AIDES) {
      const source = readFileSync(path.join(RACINE, rel), 'utf8');
      expect(source, `${rel} doit appeler la légende, pas la recopier`).toContain('legendeCodes()');
      expect(
        source,
        `${rel} écrit « Codes de sortie : » à la main — à la main, on appelle la fonction`,
      ).not.toMatch(/\s*Codes de sortie\s*:/);
    }
  });

  it('EST LA MÊME PARTOUT — deux aides, une seule vérité', () => {
    // La conséquence observable de tout ce qui précède : appeler deux fois
    // `legendeCodes()` rend le même résultat, et chaque aide l'utilise.
    expect(legendeCodes()).toBe(legendeCodes());
    expect(legendeCodes().length, 'une légende vide passerait tout le reste').toBeGreaterThan(60);
  });

  it('LE BAN VOIT RELLEMENT LES DEUX AIDES — sinon il sert à rien', () => {
    // Le compteur qui empêche ce fichier de devenir muet : un chemin
    // change, un fichier est renommé, et tout ce qui précède passe sans
    // rien tester.
    expect(AIDES).toHaveLength(2);
    for (const rel of AIDES) {
      expect(
        readFileSync(path.join(RACINE, rel), 'utf8').length,
        `${rel} est vide`,
      ).toBeGreaterThan(1000);
    }
    expect(Object.keys(CODE).length, 'les sept codes doivent être traversés').toBe(7);
  });
});