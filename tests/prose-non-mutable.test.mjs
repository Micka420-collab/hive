// AUCUNE LIGNE DE PROSE DU DÉPÔT NE DOIT ÊTRE MUTABLE PAR LA LOUPE.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// La loupe a rendu un verdict rouge sur de la PROSE : une continuation de
// commentaire JSX qui énonçait une condition en toutes lettres, sans marque en
// tête (§ 9 quaternonagies).
//
//     ════ CODE NEUF QUE RIEN NE DÉFEND ════
//     · dashboard/src/views/Balance.tsx — === → !==
//         `global.totalMs === 0` et n'affiche PAS ce tableau dans ce
//
// Le remède retenu était de marquer les continuations d'un `*`. Deux lots plus
// tard, un balayage complet du même fichier trouvait la consignation VOISINE,
// quinze lignes plus loin, toujours nue : le remède avait été appliqué à
// l'endroit qui avait fait mal, pas partout (§ 9 septnonagies).
//
// ─── CE QUE CE BANC TIENT, ET POURQUOI IL VAUT MIEUX QU'UN BALAYAGE ──────────
//
// Un balayage manuel dit ce qui est vrai aujourd'hui. Cette garde dit ce qui
// restera vrai — et elle rougit sur la ligne exacte, avec la mutation exacte
// que la loupe en tirerait, le jour où quelqu'un écrit à nouveau une
// continuation sans marque.
//
// C'est le § 9 sexnonagies câblé : une note dans le fichier qui a subi le
// défaut ne protège que ce fichier ; une garde protège le dépôt.
//
// ─── POURQUOI CE BANC EST EN `.mjs` ─────────────────────────────────────────
//
// Il importe `scripts/loupe.mjs` et `scripts/plages-commentaires.mjs`, qui n'ont
// pas de déclarations de types — `tsc` refuse (« implicitly has an 'any' type »).
// Le dépôt a déjà tranché cette question : `loupe-verdict`, `tamis-ordres`,
// `vitest-forks` et `deps-optionnelles` sont tous des bancs `.mjs` pour la même
// raison. On suit la convention plutôt que d'ajouter des types postiches à un
// outil qui n'en a pas besoin.
//
// ─── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
//
// Il ne corrige pas `ligneMutable` « par le haut ». Rendre la loupe elle-même
// capable de lire les plages de commentaires reste un lot à part : il touche
// l'instrument qui juge tout le reste, donc il demande sa propre mutation et un
// rejeu de bout en bout. En attendant, la contrainte est portée par la PROSE,
// et elle est vérifiée.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lignesDeCommentaire } from '../scripts/plages-commentaires.mjs';
import { ligneMutable, marqueeEquivalente, mutationsDeLigne } from '../scripts/loupe.mjs';

const RACINE = process.cwd();
const lire = (f) => readFileSync(path.resolve(RACINE, f), 'utf8');

/**
 * Les fichiers que la loupe balaie — sa portée par défaut, moins elle-même.
 *
 * ─── `--others` N'EST PAS UN DÉTAIL ──────────────────────────────────────────
 *
 * `git ls-files` seul ne rend que les fichiers SUIVIS. Un fichier tout juste
 * écrit y échappe donc — et c'est exactement le moment où sa prose est neuve,
 * où la loupe la verra pour la première fois, et où cette garde a le plus à
 * dire. Mesuré en écrivant ce banc : `scripts/plages-commentaires.mjs`, créé
 * dans le même lot, était invisible à la découverte.
 *
 * `--exclude-standard` écarte ce que `.gitignore` écarte : `node_modules`, les
 * artefacts de compilation, tout ce que la loupe ne regarde pas non plus.
 */
function fichiersDeLaLoupe() {
  return execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      'src',
      'dashboard/src',
      'scripts',
      'site',
    ],
    {
      cwd: RACINE,
      encoding: 'utf8',
      shell: false,
    },
  )
    .split('\n')
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && f !== 'scripts/loupe.mjs');
}

describe('lignesDeCommentaire — savoir où l’on est dans un fichier', () => {
  it('voit les CONTINUATIONS d’un bloc, pas sa première ligne', () => {
    // La première ligne porte `/*` : `ligneMutable` la reconnaît déjà. Ce qu'on
    // cherche, ce sont les suivantes — celles qui n'ont aucune marque.
    const src = ['const a = 1;', '/* ouverture', 'continuation', 'fin */', 'const b = 2;'].join(
      '\n',
    );
    expect([...lignesDeCommentaire(src)].sort((x, y) => x - y)).toEqual([2, 3]);
  });

  it('un `/*` DANS UNE CHAÎNE n’ouvre rien', () => {
    // ─── L'ASSERTION QUI ÉVITE UN VERDICT SUR N'IMPORTE QUOI ───────────────
    //
    // Sans le suivi des chaînes, une seule URL commentée (« https://… /* … »)
    // ou un motif de glob déclarerait tout le reste du fichier « commentaire ».
    // La garde deviendrait alors muette sur le fichier entier — verte, et
    // aveugle.
    //
    // LE PREMIER ÉCRIT NE DÉPARTAGEAIT PAS. Avec `'/* …'`, le `/*` suit
    // immédiatement le guillemet : un scanner qui refermerait la chaîne au
    // premier caractère venu la refermerait AVANT lui, et rendrait zéro comme
    // le bon. Mesuré : mutant survivant. Il faut un caractère ordinaire
    // d'abord, pour que la mauvaise fermeture laisse le `/*` à découvert.
    const src = ["const m = 'a /* pas un commentaire';", 'const n = 1 === 1;', 'const p = 2;'].join(
      '\n',
    );
    expect(lignesDeCommentaire(src).size, 'une chaîne a ouvert un commentaire').toBe(0);
  });

  it('un `/*` NON REFERMÉ dans un gabarit n’emporte pas la suite du fichier', () => {
    // ─── UN CAS QUI DÉPARTAGE, ET LA PREMIÈRE VERSION N'EN ÉTAIT PAS UN ────
    //
    // Le premier écrit était `` `un /* faux */ bloc` `` : le `/*` s'y refermait
    // sur la MÊME ligne, donc le scanner sans suivi des gabarits n'aurait rien
    // marqué non plus. Mesuré : le mutant survivait, verdict affiché
    // « 7 passed ». Le cas ne mesurait pas ce qu'il annonçait.
    //
    // Un `/*` qui reste OUVERT dans le gabarit, lui, départage : sans le suivi,
    // il déclare commentaire tout le reste du fichier.
    const src = ['const t = `un /* jamais refermé`;', 'const n = 2 > 1;', 'const p = 3;'].join(
      '\n',
    );
    expect(
      lignesDeCommentaire(src).size,
      'un gabarit a ouvert un commentaire qui avale le fichier',
    ).toBe(0);
  });

  it('un commentaire de LIGNE n’ouvre pas de bloc — et n’avale pas la suite', () => {
    // ─── DEUX MOITIÉS, ET LA SECONDE EST NÉE D'UNE CORRECTION ──────────────
    //
    // La première : un `/*` dans un `//` n'ouvre rien.
    //
    // La seconde : le saut jusqu'au bout de la ligne doit s'arrêter AU SAUT DE
    // LIGNE. Écrit `i = finDeLigne === -1 ? src.length : finDeLigne`, ce choix
    // est une décision neuve — introduite en retirant une boucle que la loupe
    // mutait. Inversée, le scanner saute à la fin du FICHIER dès le premier
    // `//` : tout ce qui suit devient invisible, y compris les blocs de
    // commentaire que cette garde existe pour trouver.
    const src = [
      '// un /* qui ne compte pas',
      'const n = 3 >= 3;',
      '/* un vrai bloc',
      'sa continuation',
      'fin */',
    ].join('\n');
    const dedans = lignesDeCommentaire(src);
    expect(
      [...dedans].sort((x, y) => x - y),
      'un `//` a ouvert un bloc, ou avalé la suite',
    ).toEqual([3, 4]);
  });

  it('un commentaire JSX se referme comme les autres', () => {
    const src = ['{/* une note', 'qui continue', 'et finit */}', 'const n = 4 === 4;'].join('\n');
    expect([...lignesDeCommentaire(src)].sort((x, y) => x - y)).toEqual([1, 2]);
  });
});

describe('LA PROSE DU DÉPÔT N’EST PAS DU CODE', () => {
  const FICHIERS = fichiersDeLaLoupe();

  it('la découverte ratisse vraiment la portée de la loupe', () => {
    // Une garde qui ne trouve pas sa cible ne garde rien — et une découverte
    // qui rend zéro fichier rendrait le cas suivant vert sans rien regarder.
    expect(FICHIERS.length, 'la marche des sources ne ramène presque rien').toBeGreaterThan(80);
    for (const attendu of [
      'dashboard/src/views/Balance.tsx',
      'src/orchestrator/server.ts',
      'scripts/plages-commentaires.mjs',
    ]) {
      expect(FICHIERS, `la découverte ne voit pas ${attendu}`).toContain(attendu);
    }
  });

  it('aucune continuation de commentaire ne porte d’opérateur mutable', () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Pour chaque ligne SITUÉE dans un bloc de commentaire, on demande à la
    // loupe ce qu'elle en ferait. Si elle la juge mutable et en tire au moins
    // une mutation, c'est une ligne de prose qui sera un jour comptée comme du
    // code neuf non défendu.
    //
    // Le remède est toujours le même et il tient en un caractère : une marque
    // `*` en tête de la continuation.
    const coupables = [];
    for (const f of FICHIERS) {
      const src = lire(f);
      const dedans = lignesDeCommentaire(src);
      const lignes = src.split('\n');
      for (const [i, texte] of lignes.entries()) {
        if (!dedans.has(i)) continue;
        if (!ligneMutable(texte, f)) continue;
        // La loupe exige une ligne UNIQUE dans le fichier — sinon elle ne
        // saurait pas laquelle elle a mutée, et elle l'écarte.
        if (src.split(texte).length - 1 !== 1) continue;
        const muts = mutationsDeLigne(texte).filter(
          (m) => !marqueeEquivalente(src, texte, m.quoi, f),
        );
        if (muts.length === 0) continue;
        coupables.push(
          `${f}:${i + 1} [${muts.map((m) => m.quoi).join(', ')}] ${texte.trim().slice(0, 70)}`,
        );
      }
    }
    expect(
      coupables,
      'ces lignes de PROSE seront mutées par la loupe : mettez une marque `*` en tête',
    ).toEqual([]);
  });
});
