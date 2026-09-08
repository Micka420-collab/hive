// LES RENVOIS DES DOCUMENTS RÉSOLVENT — tous les documents, toutes les formes.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Une garde contre les liens morts existait déjà, dans `tests/readme.test.ts`.
// Elle était juste, elle était verte, et elle regardait DEUX fichiers sur
// trente-sept — en ne reconnaissant qu'une seule syntaxe sur deux.
//
// ─── CE QUI A ÉTÉ MESURÉ AVANT D'ÉCRIRE CE BANC ──────────────────────────────
//
// Le dépôt porte 37 documents Markdown et 59 renvois locaux distincts.
// L'ancienne garde en couvrait 22. Deux liens morts posés à la main — l'un dans
// `docs/INSTALLATION.md`, l'autre dans `README.md` — ont laissé la suite
// ENTIÈRE verte : 400 fichiers, 5484 bancs, 0 rouge, code de sortie 0.
//
// Le second est le plus parlant : `README.md` renvoie vers `README.en.md`, et
// l'ancienne garde ne voyait pas ce lien-là, DANS un fichier qu'elle prétendait
// couvrir. Son motif exigeait un nom tout en majuscules ; le `en` minuscule du
// README anglais passait au travers. Le tout premier lien du dépôt — celui qui
// fait passer un arrivant d'une langue à l'autre — n'était gardé par rien.
//
// Douze images échappaient au même motif pour une autre raison : elles sont
// écrites en HTML (`<img src=…>`), et une garde qui ne connaît que `](…)` ne
// voit pas une balise. Ce sont les images du PREMIER écran d'un arrivant.
//
// ─── CE QUE CE BANC GARDE, ET CE QU'IL NE GARDE PAS ──────────────────────────
//
// Il garde ce qu'un renvoi local PROMET : le fichier visé existe. Il balaie
// tous les documents, dans les deux syntaxes, et n'énumère aucune cible à la
// main — c'est précisément la faute qu'il corrige.
//
// Il ne garde ni les adresses externes (les vérifier demanderait le réseau, et
// une garde qui dépend du réseau rougit sans que le dépôt ait changé) ni les
// ancres `#section` (les résoudre demanderait de rejouer les règles de
// fabrication des ancres du rendu Markdown, ce qu'aucun banc d'ici ne fait).
// Ces deux limites sont ÉCRITES et vérifiées plus bas, plutôt que laissées à
// deviner : un lecteur qui croirait la garde plus large qu'elle n'est se
// fierait à un vert qui ne dit rien de son cas.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const HORS_DEPOT = new Set(['node_modules', '.git', 'dist', 'coverage', '.vite']);

/** Tous les documents du dépôt, chemins relatifs à la racine, séparateurs `/`. */
function documents(dossier = RACINE, prefixe = ''): string[] {
  const sortie: string[] = [];
  for (const e of readdirSync(dossier, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (HORS_DEPOT.has(e.name)) continue;
    const rel = prefixe ? `${prefixe}/${e.name}` : e.name;
    if (e.isDirectory()) sortie.push(...documents(path.join(dossier, e.name), rel));
    else if (e.name.endsWith('.md')) sortie.push(rel);
  }
  return sortie;
}

/**
 * Le texte d'un document, ses portions de code retirées.
 *
 * `docs/ERREURS.md` cite du TypeScript en prose ; un `tableau[i](argument)` y
 * ressemble à un lien à s'y méprendre. Une garde qui accuse à tort finit
 * désactivée, et c'est pire que pas de garde du tout.
 */
function horsCode(texte: string): string {
  return texte.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

type Renvoi = { readonly source: string; readonly brut: string; readonly cible: string };

/** Une cible qu'aucun fichier du dépôt ne peut satisfaire : elle n'en désigne pas un. */
const AILLEURS = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * Tout ce qu'un document prétend pouvoir ouvrir DANS le dépôt.
 *
 * Deux syntaxes, parce que le dépôt en utilise deux : `](…)` pour les liens et
 * les images Markdown, `<img src=…>` et `<a href=…>` pour celles que le README
 * pose en HTML afin de leur donner une largeur.
 */
function renvois(source: string, texte: string): Renvoi[] {
  const propre = horsCode(texte);
  const bruts = [
    ...[...propre.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!),
    ...[...propre.matchAll(/<(?:img\s+src|a\s+href)="([^"]+)"/g)].map((m) => m[1]!),
  ];
  const vus = new Set<string>();
  const sortie: Renvoi[] = [];
  for (const brut of bruts) {
    if (AILLEURS.test(brut) || vus.has(brut)) continue;
    vus.add(brut);
    const cible = brut.split('#')[0]!;
    if (cible) sortie.push({ source, brut, cible });
  }
  return sortie;
}

/** Le chemin du dépôt qu'un renvoi désigne, lu depuis le dossier de sa source. */
function vise(r: Renvoi): string {
  const depuis = r.cible.startsWith('/')
    ? path.join(RACINE, r.cible)
    : path.join(path.dirname(path.join(RACINE, r.source)), r.cible);
  return depuis;
}

const DOCUMENTS = documents();
const TOUS: Renvoi[] = DOCUMENTS.flatMap((f) =>
  renvois(f, readFileSync(path.join(RACINE, f), 'utf8')),
);
const QUI_RENVOIENT = [...new Set(TOUS.map((r) => r.source))];

describe('LES RENVOIS DES DOCUMENTS RÉSOLVENT', () => {
  it.each(QUI_RENVOIENT)('%s ne renvoie vers aucun fichier absent', (nom) => {
    const morts = TOUS.filter((r) => r.source === nom && !existsSync(vise(r))).map((r) => r.brut);
    expect(morts, `renvoi(s) mort(s) dans ${nom}`).toEqual([]);
  });
});

describe('LA SONDE VOIT VRAIMENT LES RENVOIS', () => {
  // Sans ces trois cas, casser le motif rendrait le banc VIDE — donc vert.
  // C'est la panne la plus dangereuse d'une garde qui balaie : elle ne se
  // signale pas, elle se tait.

  it('elle en trouve autant que le dépôt en porte, au moins', () => {
    // Un PLANCHER, pas un compte exact : ajouter un lien à un document est un
    // acte banal et sain, et une garde qui rougirait pour cela serait retirée.
    // Mesuré le 31 août 2026 : 37 documents, 59 renvois locaux distincts.
    expect(DOCUMENTS.length).toBeGreaterThanOrEqual(30);
    expect(TOUS.length).toBeGreaterThanOrEqual(50);
  });

  it('elle voit le lien que l’ancienne garde manquait — le passage d’une langue à l’autre', () => {
    const vus = TOUS.filter((r) => r.source === 'README.md').map((r) => r.brut);
    expect(vus).toContain('README.en.md');
  });

  it('elle voit les renvois écrits en HTML, pas seulement en Markdown', () => {
    const vus = TOUS.filter((r) => r.source === 'README.md').map((r) => r.brut);
    expect(vus).toContain('docs/images/banniere-clair.png');
    expect(vus).toContain('docs/media/chambre-presentation-demo.mp4');
  });
});

describe('CE QUE LA GARDE NE PRÉTEND PAS VÉRIFIER', () => {
  // Écrit plutôt que simulé : la limite d'une garde vaut d'être lisible.

  it('une adresse externe n’est pas cherchée sur le disque', () => {
    const texte = 'Voir [le site](https://exemple.invalide/absent) et [écrire](mailto:x@y.z).';
    expect(renvois('faux.md', texte)).toEqual([]);
  });

  it('une ancre seule ne désigne aucun fichier', () => {
    expect(renvois('faux.md', 'Voir [plus bas](#une-section-qui-nexiste-pas).')).toEqual([]);
  });

  it('mais l’ancre d’un AUTRE fichier ne dispense pas ce fichier d’exister', () => {
    const trouves = renvois('faux.md', 'Voir [là](docs/INSTALLATION.md#une-section).');
    expect(trouves.map((r) => r.cible)).toEqual(['docs/INSTALLATION.md']);
  });

  it('un lien montré en exemple dans un bloc de code n’est pas une promesse', () => {
    const texte = ['Exemple :', '```md', '[modèle](CHEMIN-A-REMPLACER.md)', '```'].join('\n');
    expect(renvois('faux.md', texte)).toEqual([]);
  });
});
