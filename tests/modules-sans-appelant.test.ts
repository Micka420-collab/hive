// LE CODE QUE PERSONNE N'APPELLE — écrit, éprouvé, jamais exécuté.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Ce dépôt connaît bien ce défaut : il porte déjà, dans son journal, « le setter
// que personne n'appelle ». Un module pur, bien nommé, avec son banc vert et son
// en-tête soigné, ressemble EXACTEMENT à du code livré. Il en a toutes les
// marques sauf une : rien ne l'invoque quand la ruche tourne.
//
// Et rien ne le disait. La couverture ne le voit pas — le banc du module le
// couvre parfaitement. La loupe ne le voit pas — ses mutants meurent, tués par
// ce même banc. Le typage ne le voit pas. Un vert complet, sur du code mort.
//
// ─── CE QUI A ÉTÉ MESURÉ EN ÉCRIVANT CE BANC ─────────────────────────────────
//
// Dix modules de `src/` sont importés PAR LEUR PROPRE BANC et par rien d'autre.
// Ce n'était pas une intuition : le point de sortie du 29 août en nommait deux
// (`butineuse`, `fraicheur-version`), et le balayage en a trouvé huit de plus.
// Quatre d'entre eux forment une seule chaîne inachevée — celle du butinage.
//
// ─── CE QUE CE BANC FAIT, ET SURTOUT CE QU'IL NE FAIT PAS ────────────────────
//
// Il ne demande à personne de câbler quoi que ce soit. Câbler dix modules, ce
// serait dix fonctionnalités neuves, et la décision n'appartient pas à un banc.
//
// Il rend la classe VISIBLE et NON SILENCIEUSE : chaque module sans appelant
// doit être rangé — point d'entrée (le système d'exploitation l'invoque) ou
// moitié assumée (une raison écrite, ici même). Un onzième ne peut plus
// apparaître sans que quelqu'un dise lequel des deux il est.
//
// La liste se nettoie toute seule dans l'autre sens aussi : un module déclaré
// « sans appelant » qui EN GAGNE un fait rougir. Sans cela, la liste
// deviendrait ce qu'elle décrit — une affirmation que plus rien ne vérifie.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

/** Tous les fichiers d'un dossier du dépôt, chemins relatifs à la racine. */
function fichiers(dossier: string, extensions: readonly string[]): string[] {
  const abs = path.join(RACINE, dossier);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .map((f) => `${dossier}/${f}`.replace(/\\/g, '/'))
    .filter((f) => extensions.some((e) => f.endsWith(e)) && existsSync(path.join(RACINE, f)));
}

/** Les modules dont on demande des comptes : tout `src/`, sauf les déclarations de types. */
const MODULES = fichiers('src', ['.ts']).filter((f) => !f.endsWith('.d.ts'));

/**
 * Le code qui S'EXÉCUTE quand la ruche tourne — bancs EXCLUS, c'est tout l'objet.
 *
 * `scripts/` en fait partie : un module que seul un outil du dépôt appelle est
 * appelé pour de bon, même si aucun serveur ne le touche.
 */
const PRODUCTION = new Map(
  [
    ...fichiers('src', ['.ts', '.tsx']),
    ...fichiers('dashboard/src', ['.ts', '.tsx']),
    ...fichiers('scripts', ['.mjs', '.js']),
  ].map((f) => [f, lire(f)] as const),
);

/**
 * Ce qui NOMME un module hors du code : `package.json`, l'image, les installeurs.
 *
 * Un point d'entrée n'est importé par personne — c'est le système qui le lance.
 * Le chercher ici plutôt que dans une liste écrite à la main évite d'avoir à
 * tenir cette liste : ajouter un script npm suffit à déclarer son entrée.
 */
const DECLARATIFS = [
  'package.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.cloud.yml',
  'install.sh',
  'install.ps1',
]
  .filter((f) => existsSync(path.join(RACINE, f)))
  .map(lire)
  .join('\n');

/** `src/bin.ts` est cité sous sa forme compilée `dist/bin.js` : on regarde les deux. */
function estUnPointDEntree(module: string): boolean {
  const compile = `${module.replace(/^src\//, 'dist/').slice(0, -3)}.js`;
  return DECLARATIFS.includes(module) || DECLARATIFS.includes(compile);
}

/** Un fichier de production importe-t-il ce module ? (statiquement OU dynamiquement) */
function aUnAppelantDeProduction(module: string): boolean {
  const base = path.basename(module, '.ts').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const motif = new RegExp(`['"][^'"]*${base}\\.js['"]`);
  for (const [fichier, texte] of PRODUCTION) {
    if (fichier !== module && motif.test(texte)) return true;
  }
  return false;
}

/**
 * Les moitiés ASSUMÉES — chacune avec la raison pour laquelle elle attend.
 *
 * Une dette écrite est une dette ; une dette tue est un piège. Ces dix modules
 * sont écrits, éprouvés et verts ; aucun n'est invoqué quand la ruche tourne.
 * Les lister ici ne les excuse pas, ça les EMPÊCHE de passer pour livrés.
 */
const MOITIES_ASSUMEES: Readonly<Record<string, string>> = {
  // La chaîne du butinage : quatre modules, un seul manque — l'appel.
  'src/orchestrator/butineuse.ts':
    'le seul fetch qui rapporte un fichier ; ni route ni planificateur ne l’appelle (#105)',
  'src/shared/nectar-suspect.ts': 'lit ce qu’une butineuse rapporte — en aval d’un appel absent',
  'src/shared/deballage.ts': 'garde le CONTENU d’une archive — en aval d’un appel absent',
  'src/shared/licence-butinee.ts': 'juge la licence d’un butin — en aval d’un appel absent',

  // Les moitiés qui se calculent, dont l’autre moitié demande une décision humaine.
  'src/shared/fraicheur-version.ts':
    'compare deux versions ; ALLER CHERCHER la dernière suppose des étiquettes publiées (#112)',
  'src/shared/paliers.ts': 'ce que chaque plan ouvre — la facturation n’est pas dans ce dépôt',

  // Écrits pour un écran ou un hôte qui ne les consomme pas encore.
  'src/shared/agents-connectes.ts':
    'plie l’état des nœuds pour l’en-tête ; l’en-tête ne le lit pas',
  'src/shared/outils-du-noeud.ts':
    'croise les constats d’un nœud avec le catalogue ; aucun écran ne l’affiche',
  'src/shared/demarrage.ts':
    'ce que « lancer la ruche » veut dire ; `ruche.mjs` ne passe pas par lui',
  'src/atelier/reveil.ts': 'crochets de réveil du conteneur ; rien ne les déclenche dans l’image',
};

const SANS_APPELANT = MODULES.filter((m) => !aUnAppelantDeProduction(m));

describe('AUCUN MODULE NE VIT SANS ÊTRE RANGÉ', () => {
  it('le balayage voit bien les modules — sinon il tournerait à vide', () => {
    // Un balayage qui ne trouve RIEN passerait au vert en ne regardant rien.
    expect(MODULES.length, 'aucun module lu sous src/').toBeGreaterThan(50);
    expect(PRODUCTION.size, 'aucun fichier de production lu').toBeGreaterThan(50);
  });

  it('la détection d’appelant fonctionne — éprouvée sur un module notoirement appelé', () => {
    // Sans ce cas, une régulière cassée rendrait TOUT le dépôt orphelin, et la
    // garde se contenterait de le dire — bruyamment, et sans rien mesurer.
    expect(
      aUnAppelantDeProduction('src/shared/protocol.ts'),
      'protocol.ts est importé partout : la détection est cassée',
    ).toBe(true);
  });

  it('chaque module sans appelant est un POINT D’ENTRÉE ou une MOITIÉ ASSUMÉE', () => {
    const inconnus = SANS_APPELANT.filter((m) => !estUnPointDEntree(m) && !(m in MOITIES_ASSUMEES));
    expect(
      inconnus,
      'ces modules ne sont appelés par rien : point d’entrée, ou moitié assumée avec sa raison ?',
    ).toEqual([]);
  });

  it('une moitié assumée qui GAGNE un appelant sort de la liste', () => {
    // Le sens inverse, et il compte autant : sans lui, la liste survivrait à ce
    // qu'elle décrit et redeviendrait une affirmation que rien ne vérifie.
    const desormaisAppeles = Object.keys(MOITIES_ASSUMEES).filter((m) =>
      aUnAppelantDeProduction(m),
    );
    expect(
      desormaisAppeles,
      'ces modules ont enfin un appelant : retirez-les de MOITIES_ASSUMEES',
    ).toEqual([]);
  });

  it('aucune moitié assumée ne nomme un fichier disparu', () => {
    const fantomes = Object.keys(MOITIES_ASSUMEES).filter((m) => !existsSync(path.join(RACINE, m)));
    expect(fantomes, 'ces entrées désignent des fichiers qui n’existent plus').toEqual([]);
  });

  it('chaque moitié assumée porte une raison, pas une case cochée', () => {
    const muettes = Object.entries(MOITIES_ASSUMEES)
      .filter(([, raison]) => raison.trim().length < 25)
      .map(([m]) => m);
    expect(muettes, 'une raison d’un mot est une case cochée, pas une dette écrite').toEqual([]);
  });
});
