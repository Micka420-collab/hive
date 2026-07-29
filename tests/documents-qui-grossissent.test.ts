// Les documents qui GROSSISSENT à chaque livraison.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// `CHANGELOG.md`, `docs/ERREURS.md`, `docs/ETAPES.md` et les deux README ont
// une propriété que le reste du dépôt n'a pas : **on ne fait qu'y ajouter**.
// Personne ne les relit en entier, jamais. Un défaut qui s'y installe n'a donc
// aucune raison d'en ressortir.
//
// C'est arrivé. Un bloc de 144 lignes du `CHANGELOG` s'est retrouvé écrit
// TROIS FOIS — 286 lignes, un cinquième du fichier — et la troisième copie
// avait atterri dans la section `[0.2.0]`, c'est-à-dire dans de l'histoire
// DÉJÀ PUBLIÉE. Le défaut a grossi à chaque commit pendant huit livraisons :
//
//     7a40c6f   25 lignes × 3
//     8157f3f   46 lignes × 3
//     24a33de   60 lignes × 3
//     9e9bc98   79 lignes × 3
//     145d932   97 lignes × 3
//     43582fc  117 lignes × 3
//     f7f327e  146 lignes × 3
//
// Huit occasions de le voir, huit relectures qui ne l'ont pas vu. Rien
// d'étonnant : la duplication est invisible dans un diff, puisque le diff ne
// montre que la ligne ajoutée, jamais qu'elle existe déjà trois écrans plus
// bas. Seule une garde qui lit le fichier ENTIER pouvait l'attraper.
//
// ─── LE SEUIL ────────────────────────────────────────────────────────────────
//
// Mesuré sur les cinq fichiers après nettoyage, le plus long bloc identique
// répété naturellement fait **3 lignes** (un en-tête, une ligne vide, un
// début de puce). Le seuil est à 8 : assez haut pour qu'une répétition
// légitime de prose ne le déclenche pas, assez bas pour qu'une catastrophe à
// 144 lignes n'ait aucune chance de passer.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

/** Au-delà de ce nombre de lignes consécutives identiques, c'est un copier-coller. */
const SEUIL = 8;

const DOCUMENTS = [
  'CHANGELOG.md',
  'docs/ERREURS.md',
  'docs/ETAPES.md',
  'README.md',
  'README.en.md',
] as const;

interface Repetition {
  readonly taille: number;
  readonly premiere: number;
  readonly seconde: number;
}

/**
 * Le plus long bloc de lignes CONSÉCUTIVES qui apparaisse deux fois.
 *
 * On compare des lignes entières, blanches comprises : c'est ce qui distingue
 * un copier-coller d'une simple ressemblance de prose. Deux entrées qui
 * emploient la même tournure ne produisent pas huit lignes identiques d'affilée
 * — un bloc dupliqué, si.
 */
function plusLongBlocRepete(texte: string): Repetition {
  const lignes = texte.split('\n');
  const positions = new Map<string, number[]>();
  lignes.forEach((l, i) => {
    const v = positions.get(l);
    if (v) v.push(i);
    else positions.set(l, [i]);
  });

  let meilleur: Repetition = { taille: 0, premiere: 0, seconde: 0 };
  for (let i = 0; i < lignes.length; i++) {
    for (const j of positions.get(lignes[i]!) ?? []) {
      if (j <= i) continue;
      let k = 0;
      while (i + k < lignes.length && j + k < lignes.length && lignes[i + k] === lignes[j + k]) k++;
      if (k > meilleur.taille) meilleur = { taille: k, premiere: i + 1, seconde: j + 1 };
    }
  }
  return meilleur;
}

describe('AUCUN BLOC NE SE RÉPÈTE DANS LES DOCUMENTS QUI GROSSISSENT', () => {
  for (const doc of DOCUMENTS) {
    it(`${doc} ne contient pas de copier-coller`, () => {
      const r = plusLongBlocRepete(lire(doc));
      expect(
        r.taille,
        `${doc} : ${r.taille} lignes identiques d’affilée aux lignes ${r.premiere} et ${r.seconde}. ` +
          'Un bloc dupliqué ne se voit pas dans un diff — celui du CHANGELOG a grossi ' +
          'pendant huit livraisons avant qu’on le remarque.',
      ).toBeLessThan(SEUIL);
    });
  }
});

describe('LE CHANGELOG RESTE LISIBLE COMME UN CHANGELOG', () => {
  const CHANGELOG = lire('CHANGELOG.md');

  it('chaque version n’est annoncée qu’UNE FOIS', () => {
    // Deux sections portant la même version, c'est deux histoires concurrentes
    // du même jour — et rien ne dit laquelle est la bonne.
    const versions = [...CHANGELOG.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]!);
    expect(versions.length, 'aucune section de version').toBeGreaterThan(0);
    expect(new Set(versions).size, `versions en double : ${versions.join(', ')}`).toBe(
      versions.length,
    );
  });

  it('`[Unreleased]` existe et vient en PREMIER', () => {
    // C'est là qu'atterrit tout ce qui n'est pas encore publié. Une entrée
    // ajoutée sous une version DÉJÀ SORTIE réécrit l'histoire — c'est
    // exactement ce qu'avait fait la troisième copie, tombée dans `[0.2.0]`.
    const versions = [...CHANGELOG.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]!);
    expect(versions[0]).toBe('Unreleased');
  });
});
