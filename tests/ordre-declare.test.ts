// LA PORTE DÉROBÉE DE L'ORDRE, ET SA SERRURE.
//
// ─── CE QUI S'EST PASSÉ ──────────────────────────────────────────────────────
//
// Passée sous `--sequence.shuffle`, la suite perdait 14 tests — et toujours
// les mêmes à graine égale. Ni la charge (la même graine rend deux fois les
// mêmes échecs), ni l'ordre des FICHIERS (les rejouer dans l'ordre exact du
// mélange les laisse verts) : l'ordre des TESTS À L'INTÉRIEUR d'un fichier.
//
// Le motif était partout le même. Un test posait un état, le suivant le lisait
// sans jamais le dire. Chacun était vert à sa place, et seulement à sa place.
// Ce n'est pas un détail d'hygiène : « NE TOUCHE PAS AUX LIENS VIVANTS » ne
// vérifiait la moitié de sa borne qu'un ordre sur deux, et rien ne pouvait le
// signaler.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Dix-sept fichiers ont été rendus autonomes : chaque test pose sa prémisse.
// Un seul ne pouvait pas l'être — `caste-boucle`, où l'ordre EST le sujet :
// une ouvrière monte de caste sur ses productions, puis la reperd. Vitest sait
// l'entendre, avec `describe(nom, { shuffle: false }, …)`.
//
// Et c'est précisément le danger. `shuffle: false` est aussi la manière la plus
// commode de faire TAIRE un couplage accidentel : deux mots à ajouter, et le
// tamis se tait. Une exemption qu'on peut prendre sans rien dire finit par être
// prise partout.
//
// Alors elle se déclare ICI. Ajouter `shuffle: false` quelque part rend ce
// fichier rouge tant que la suite n'est pas inscrite ci-dessous avec sa raison.
// La porte reste ouverte ; elle ne s'ouvre plus en silence.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');

/**
 * Les seules suites autorisées à figer leur ordre — et pourquoi.
 *
 * La clé est le nom exact passé à `describe`. La valeur n'est pas décorative :
 * c'est elle qu'on relit le jour où on se demande si l'exemption tient encore.
 */
const EXEMPTIONS: Record<string, string> = {
  'de la production réelle à la caste, puis au cadre':
    'Une trajectoire : la caste monte sur des productions propres, puis se perd ' +
    'sur des productions creuses. Reconstruire le corpus à chaque test coûterait ' +
    'trois fois SEUIL_BATISSEUSE tours sur un fichier déjà budgété à 90 s.',
};

/** Tous les fichiers de test du dépôt, où qu'ils vivent. */
function fichiersDeTest(): string[] {
  const trouves: string[] = [];
  const visiter = (dossier: string): void => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) visiter(complet);
      else if (/\.test\.(ts|tsx|mjs)$/.test(entree.name)) trouves.push(complet);
    }
  };
  visiter(RACINE);
  return trouves;
}

/**
 * Les suites qui figent leur ordre, telles qu'écrites dans le source.
 *
 * On lit le TEXTE plutôt que d'interroger vitest : une exemption posée dans un
 * fichier qui n'est pas chargé par cette exécution resterait invisible d'un
 * relevé à l'exécution, et c'est justement celle-là qu'on veut voir.
 */
function suitesFigees(): { fichier: string; nom: string }[] {
  const motif = /describe\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*\{([^}]*)\}/g;
  const trouvees: { fichier: string; nom: string }[] = [];
  for (const fichier of fichiersDeTest()) {
    const source = readFileSync(fichier, 'utf8');
    for (const m of source.matchAll(motif)) {
      if (/\bshuffle\s*:\s*false\b/.test(m[3] ?? '')) {
        trouvees.push({ fichier: path.relative(RACINE, fichier), nom: m[2] ?? '' });
      }
    }
  }
  return trouvees;
}

describe('l’ordre des tests ne se fige pas en silence', () => {
  it('LE TAMIS SAIT LIRE — il retrouve l’exemption qui existe', () => {
    // Sans cette vérification, une expression régulière cassée rendrait tout le
    // fichier vert en ne trouvant plus rien : la garde la plus rassurante qui
    // soit, et la plus creuse. Elle a déjà été prise deux fois dans ce dépôt.
    const noms = suitesFigees().map((s) => s.nom);
    expect(noms, 'le relevé ne trouve plus rien : c’est le tamis qui est cassé').toContain(
      'de la production réelle à la caste, puis au cadre',
    );
  });

  it('LE TAMIS SAIT LIRE — et il ne voit pas d’exemption là où il n’y en a pas', () => {
    // L'autre moitié : un motif trop large classerait toute suite à options
    // (`{ timeout: … }`, `{ concurrent: true }`) comme figée, et la liste
    // d'exemptions deviendrait un mur de faux positifs qu'on cesserait de lire.
    const surLesOptions = /describe\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*\{([^}]*)\}/g;
    const echantillon = [
      "describe('une suite ordinaire', () => {});",
      "describe('une suite à délai', { timeout: 30_000 }, () => {});",
      "describe('une suite mélangée exprès', { shuffle: true }, () => {});",
    ].join('\n');
    const figees = [...echantillon.matchAll(surLesOptions)].filter((m) =>
      /\bshuffle\s*:\s*false\b/.test(m[3] ?? ''),
    );
    expect(figees).toHaveLength(0);
  });

  it('CHAQUE SUITE FIGÉE EST DÉCLARÉE, AVEC SA RAISON', () => {
    const nonDeclarees = suitesFigees().filter((s) => !(s.nom in EXEMPTIONS));
    expect(
      nonDeclarees,
      'Une suite fige son ordre sans le dire. Si l’ordre est vraiment le sujet ' +
        '(une trajectoire, un état qui s’accumule), inscris-la dans EXEMPTIONS ' +
        'avec la raison. Sinon, rends ses tests autonomes : chacun pose sa ' +
        'prémisse. C’est le geste par défaut, et il n’a presque rien coûté sur ' +
        'les seize autres fichiers.',
    ).toEqual([]);
  });

  it('AUCUNE EXEMPTION NE SURVIT À LA SUITE QU’ELLE PROTÉGEAIT', () => {
    // Une exemption laissée derrière une suite renommée ou supprimée protège du
    // vide et rassure pour rien.
    const vivantes = new Set(suitesFigees().map((s) => s.nom));
    const orphelines = Object.keys(EXEMPTIONS).filter((nom) => !vivantes.has(nom));
    expect(orphelines, 'exemption sans suite : à retirer').toEqual([]);
  });

  it('L’EXEMPTION RESTE L’EXCEPTION', () => {
    // Pas un plafond arbitraire : un déclencheur d'escalade. Au-delà, ce n'est
    // plus « un cas particulier », c'est une manière de travailler — et il
    // faudra alors se demander pourquoi les tests s'accrochent les uns aux
    // autres, pas relever ce chiffre.
    expect(Object.keys(EXEMPTIONS).length).toBeLessThanOrEqual(3);
  });
});
