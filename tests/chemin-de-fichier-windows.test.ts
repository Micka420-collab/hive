// La garde mécanique du § 6.1 : `.pathname` n'est JAMAIS un chemin de fichier.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Le dépôt connaît cette morsure. Il l'a écrite en toutes lettres dans
// `docs/ERREURS.md`, puis RECOPIÉE en tête de six fichiers : `loupe.mjs`,
// `lancer.mjs`, `ruche.mjs`, `empreinte.test.ts`, `fusionner.test.ts`,
// `essai-installation.test.ts`. Six avertissements, en prose, dans les
// fichiers déjà corrigés.
//
// Et la morsure est revenue une cinquième fois, dans un fichier NEUF qui ne
// les lisait pas : `tests/connexion-noeud.test.ts` faisait
// `new URL('…', import.meta.url).pathname`, et la jambe windows-latest a
// rougi sur `ENOENT … 'D:\D:\a\hive\hive\src\node-client\agent-detect.ts'`.
//
// La leçon n'est pas « il faut mieux lire les commentaires ». C'est qu'un
// avertissement écrit dans les fichiers DÉJÀ corrigés ne protège jamais le
// prochain fichier. Seule une garde qui BALAIE l'arbre le fait.
//
// ─── CE QUE CETTE GARDE VISE, ET CE QU'ELLE LAISSE PASSER ────────────────────
//
// `url.pathname` est parfaitement légitime sur une URL HTTP : c'est ainsi que
// `src/atelier/outil.ts` route `/sante` et que les faux serveurs des bancs
// reconnaissent leurs routes. La garde ne les touche pas.
//
// Elle ne vise que le `.pathname` pris sur une URL de FICHIER — celle bâtie
// depuis `import.meta.url`, directement ou par une constante du fichier. Là,
// et seulement là, `.pathname` est faux : sous Windows il rend « /D:/a/… »,
// avec une barre AVANT la lettre de lecteur. Passé à `readFileSync` il donne
// « D:\D:\a\… » ; passé en `cwd` d'un `spawn` il échoue. `fileURLToPath` est
// la seule conversion correcte, et elle l'est sur les trois plateformes.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Le chemin de la racine — par `fileURLToPath`, évidemment. */
const RACINE = fileURLToPath(new URL('..', import.meta.url));

const TERRAINS = ['src', 'tests', 'scripts', 'dashboard/src'] as const;
const EXTENSIONS = /\.(ts|tsx|mjs|cjs|js)$/;

function fichiersDe(dossier: string): string[] {
  const trouves: string[] = [];
  const marcher = (abs: string, rel: string): void => {
    for (const entree of readdirSync(abs)) {
      const suivantAbs = path.join(abs, entree);
      const suivantRel = `${rel}/${entree}`;
      if (statSync(suivantAbs).isDirectory()) marcher(suivantAbs, suivantRel);
      else if (EXTENSIONS.test(entree)) trouves.push(suivantRel);
    }
  };
  marcher(path.join(RACINE, dossier), dossier);
  return trouves;
}

/**
 * Le fichier sans ses lignes de PROSE, à numérotation conservée.
 *
 * Ce fichier-ci parle de `.pathname` une trentaine de fois en commentaire ;
 * les six fichiers déjà corrigés en parlent aussi. Sans ce blanchiment, la
 * garde rougirait sur les avertissements qui la justifient — l'ironie serait
 * complète, l'utilité nulle. Les lignes vidées restent des lignes vides : les
 * numéros annoncés dans le verdict restent donc justes.
 */
export function sansProse(source: string): string {
  return source
    .split('\n')
    .map((ligne) => {
      const t = ligne.trimStart();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : ligne;
    })
    .join('\n');
}

/** Un `.pathname` pris sur une URL de fichier — fichier, ligne, extrait. */
export interface Morsure {
  fichier: string;
  ligne: number;
  extrait: string;
}

// `(?:[^()]|\([^()]*\))*?` : le contenu d'un `new URL(…)`, en tolérant UN
// niveau d'appel imbriqué (`new URL(join(a, b), import.meta.url)`), sans
// jamais franchir la parenthèse fermante de trop.
const APPEL_URL = /new URL\((?:[^()]|\([^()]*\))*?\)\s*\.pathname/g;

export function morsures(fichier: string, source: string): Morsure[] {
  const code = sansProse(source);

  // Les constantes du fichier qui TIENNENT une URL de fichier. `empreinte` et
  // `installeurs` font toutes deux `const RACINE = new URL('..',
  // import.meta.url)` puis s'en resservent : sans ce relevé, un
  // `new URL('.', RACINE).pathname` passerait sous le radar — c'est
  // exactement la forme qui dormait dans `tests/installeurs.test.ts`.
  const porteuses = [
    ...new Set(
      [...code.matchAll(/const\s+(\w+)\s*=\s*new URL\([^;]*?import\.meta\.url/g)].map((m) => m[1]!),
    ),
  ];

  const suspects: { index: number; texte: string }[] = [];
  for (const m of code.matchAll(APPEL_URL)) {
    const dedans = m[0];
    if (dedans.includes('import.meta.url') || porteuses.some((p) => dedans.includes(p))) {
      suspects.push({ index: m.index!, texte: dedans });
    }
  }
  for (const p of porteuses) {
    for (const m of code.matchAll(new RegExp(`\\b${p}\\.pathname`, 'g'))) {
      suspects.push({ index: m.index!, texte: m[0] });
    }
  }

  return suspects
    .sort((a, b) => a.index - b.index)
    .map(({ index, texte }) => ({
      fichier,
      ligne: code.slice(0, index).split('\n').length,
      extrait: texte.replace(/\s+/g, ' ').slice(0, 100),
    }));
}

/**
 * Le seul fichier soustrait au balayage : celui-ci.
 *
 * Ses fixtures CONTIENNENT les formes fautives — c'est tout leur objet : sans
 * elles, personne n'aurait jamais vu le détecteur mordre. Une garde qui
 * s'exclut elle-même doit dire lesquels et combien, sinon l'exclusion
 * s'élargit un jour sans que rien ne rougisse. D'où l'assertion sur sa taille
 * juste en dessous.
 */
const EXCLUS: readonly string[] = ['tests/chemin-de-fichier-windows.test.ts'];

describe('`.pathname` n’est jamais un chemin de fichier — la garde qui balaie', () => {
  const tous = TERRAINS.flatMap(fichiersDe);
  const fichiers = tous.filter((f) => !EXCLUS.includes(f));

  it('LE BALAYAGE REGARDE VRAIMENT QUELQUE CHOSE', () => {
    // Le § 1.2 du journal : une garde qui boucle sur zéro élément PASSE, en
    // n'ayant rien regardé. `empreinte.test.ts` s'est fait prendre exactement
    // comme ça — par un `readdir` sur un chemin en `.pathname`, d'ailleurs.
    // Cette assertion est le prix d'entrée de toutes celles qui suivent.
    expect(fichiers.length).toBeGreaterThan(200);
    // L'exclusion ne couvre QUE ce fichier, et il existe bien : un nom mal
    // orthographié dans `EXCLUS` n'exclurait rien et passerait inaperçu.
    expect(tous.length - fichiers.length, 'l’exclusion a changé de taille').toBe(1);
    expect(tous).toContain(EXCLUS[0]);
    for (const terrain of TERRAINS) {
      expect(
        fichiers.filter((f) => f.startsWith(`${terrain}/`)).length,
        `aucun fichier balayé sous ${terrain}/`,
      ).toBeGreaterThan(0);
    }
  });

  it('LE DÉTECTEUR MORD — éprouvé sur les formes qu’il doit attraper', () => {
    // Une garde dont on n'a jamais vu le détecteur rougir n'est pas une
    // garde : c'est un décor. On lui donne donc les quatre formes connues,
    // dont les deux qui ont réellement mordu ce dépôt.
    const casPositifs = [
      // la forme qui a rougi windows-latest, sur une seule ligne
      `readFileSync(new URL('../src/a.ts', import.meta.url).pathname, 'utf8');`,
      // la même, coupée par le formateur — le balayage par lignes la ratait
      `readFileSync(\n  new URL(\n    '../src/a.ts',\n    import.meta.url,\n  ).pathname,\n);`,
      // la mine qui dormait dans `installeurs.test.ts`
      `const RACINE = new URL('..', import.meta.url);\nspawn('sh', [], { cwd: new URL('.', RACINE).pathname });`,
      // la constante consommée toute seule
      `const RACINE = new URL('..', import.meta.url);\nreaddirSync(RACINE.pathname);`,
    ];
    for (const cas of casPositifs) {
      expect(morsures('essai.ts', cas), cas.slice(0, 40)).not.toHaveLength(0);
    }

    const casNegatifs = [
      // le routage HTTP : parfaitement légitime, jamais visé
      `if (url.pathname === '/sante') return ok();`,
      `const d = DEPOTS.get(u.pathname.replace(/^\\/repos\\//, ''));`,
      // la forme CORRECTE : c'est elle qu'on veut voir partout
      `readFileSync(fileURLToPath(new URL('../src/a.ts', import.meta.url)), 'utf8');`,
      // la prose qui met en garde ne doit pas déclencher la garde
      '// ' + "new URL('..', import.meta.url).pathname est faux sous Windows",
    ];
    for (const cas of casNegatifs) {
      expect(morsures('essai.ts', cas), cas.slice(0, 40)).toHaveLength(0);
    }
  });

  it('AUCUN FICHIER DE L’ARBRE NE PREND `.pathname` POUR UN CHEMIN', () => {
    const trouvees = fichiers.flatMap((f) =>
      morsures(f, readFileSync(path.join(RACINE, f), 'utf8')),
    );
    expect(
      trouvees.map((m) => `${m.fichier}:${m.ligne} — ${m.extrait}`),
      'remplacer par `fileURLToPath(new URL(…))` : `.pathname` rend « /D:/… » sous Windows',
    ).toEqual([]);
  });
});
