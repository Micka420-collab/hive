// Test de garde du site vitrine (site/index.html).
//
// Le site est une page unique, sans build ni framework : rien ne la typecheck,
// rien ne la lint au-delà du formatage. Une clé de traduction oubliée, une
// fonte repartie chez Google, un bouton pointant vers un formulaire supprimé —
// tout cela passerait la CI et n'apparaîtrait qu'en production, sur la seule
// page que voient les gens qui découvrent le projet.
//
// Ce fichier ne teste donc pas un comportement : il VERROUILLE les propriétés
// de la page qu'on ne peut pas se permettre de perdre par inadvertance.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

/** Le dictionnaire anglais, isolé du reste du script. */
function dictionnaireEn(): string {
  const debut = html.indexOf('var EN = {');
  expect(debut, 'dictionnaire EN introuvable').toBeGreaterThan(-1);
  // Le littéral se ferme sur la première ligne « }; » à son niveau d'indentation.
  const fin = html.indexOf('\n        };', debut);
  expect(fin, 'fin du dictionnaire EN introuvable').toBeGreaterThan(debut);
  return html.slice(debut, fin);
}

/** Toutes les clés référencées par le HTML, y compris celles de data-i18n-attr. */
function clesUtilisees(): Set<string> {
  const cles = new Set<string>();
  for (const m of html.matchAll(/data-i18n(?:-attr)?="([^"]+)"/g)) {
    const brut = m[1] ?? '';
    // `data-i18n-attr` porte des paires « attribut:clé », séparées par des virgules.
    if (/^[a-z-]+:/.test(brut)) {
      for (const paire of brut.split(',')) {
        const cle = paire.split(':')[1]?.trim();
        if (cle) cles.add(cle);
      }
    } else {
      cles.add(brut);
    }
  }
  return cles;
}

/** Les clés déclarées dans EN — citées ('nav.x') ou nues (skip). */
function clesTraduites(): string[] {
  const dict = dictionnaireEn();
  return [...dict.matchAll(/^\s{10}(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

describe('site vitrine — bilinguisme', () => {
  it('chaque clé du HTML a une traduction anglaise', () => {
    const traduites = new Set(clesTraduites());
    const manquantes = [...clesUtilisees()].filter((c) => !traduites.has(c)).sort();
    expect(manquantes, `clés sans traduction EN : ${manquantes.join(', ')}`).toEqual([]);
  });

  it('aucune clé anglaise en double', () => {
    // Un doublon est silencieux en JS — la seconde écrase la première. Deux
    // valeurs divergentes donneraient un texte anglais imprévisible.
    const cles = clesTraduites();
    const doublons = [...new Set(cles.filter((c, i) => cles.indexOf(c) !== i))].sort();
    expect(doublons, `clés EN déclarées deux fois : ${doublons.join(', ')}`).toEqual([]);
  });

  it('aucune traduction orpheline', () => {
    // Une clé traduite mais plus référencée signale un bout de page supprimé
    // à moitié — le mort-bois d'aujourd'hui est la confusion de demain.
    const utilisees = clesUtilisees();
    const orphelines = clesTraduites()
      .filter((c) => !utilisees.has(c))
      .sort();
    expect(orphelines, `traductions inutilisées : ${orphelines.join(', ')}`).toEqual([]);
  });
});

describe('site vitrine — vie privée', () => {
  it('ne charge aucune fonte depuis un tiers', () => {
    // Une page qui va chercher sa fonte chez Google transmet à Google l'IP de
    // chaque visiteur, sans qu'il l'ait demandé. Les fichiers sont dans le dépôt.
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(html).toMatch(/@font-face/);
  });

  it('les fichiers de fonte référencés existent et sont livrés sous licence', () => {
    const refs = [...html.matchAll(/url\('(fonts\/[^']+\.woff2)'\)/g)].map((m) => m[1]);
    expect(refs.length, 'aucune fonte auto-hébergée référencée').toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(existsSync(new URL(`../site/${ref}`, import.meta.url)), `absent : ${ref}`).toBe(true);
    }
    // La SIL OFL autorise la redistribution embarquée À CONDITION que l'avis de
    // copyright et la licence accompagnent les fichiers.
    const licence = readFileSync(new URL('../site/fonts/LICENSE.txt', import.meta.url), 'utf8');
    expect(licence).toMatch(/SIL Open Font License/);
    expect(licence).toMatch(/Space Grotesk/);
    expect(licence).toMatch(/JetBrains Mono/);
  });

  it("n'appelle aucun tiers hors l'API GitHub publique", () => {
    // Seul appel réseau toléré : le compteur d'étoiles, en amélioration
    // progressive (la page reste entière s'il échoue).
    const appels = [...html.matchAll(/fetch\(\s*'(https?:\/\/[^']+)'/g)].map((m) => m[1] ?? '');
    for (const url of appels) {
      expect(new URL(url).host, `appel réseau inattendu : ${url}`).toBe('api.github.com');
    }
  });
});

describe('site vitrine — section communauté', () => {
  it('le bouton « proposer » pointe vers un gabarit qui existe', () => {
    const m = html.match(/issues\/new\?template=([\w.-]+\.yml)/);
    expect(m, 'lien vers le formulaire de proposition introuvable').toBeTruthy();
    const gabarit = `.github/ISSUE_TEMPLATE/${m?.[1]}`;
    expect(existsSync(new URL(gabarit, `file://${RACINE}`)), `gabarit absent : ${gabarit}`).toBe(
      true,
    );
  });

  it('le lien « voir les projets » filtre sur le label posé par le gabarit', () => {
    const gabarit = readFileSync(
      new URL('../.github/ISSUE_TEMPLATE/proposer-un-projet.yml', import.meta.url),
      'utf8',
    );
    const label = gabarit.match(/labels:\s*\['([^']+)'\]/)?.[1];
    expect(label, 'label absent du gabarit').toBeTruthy();
    // Le lien du site doit filtrer sur CE label, sinon il rend une liste vide.
    // On lit `q` comme GitHub le lira : en paramètre de requête, où « + » vaut
    // espace — d'où URLSearchParams plutôt qu'un decodeURIComponent.
    const lien = html.match(/https:\/\/github\.com\/[^"]*issues\?q=[^"]+/)?.[0] ?? '';
    const q = new URL(lien).searchParams.get('q') ?? '';
    expect(q, `requête du lien : ${q}`).toContain(`label:"${label}"`);
  });

  it('la section est atteignable depuis la navigation', () => {
    expect(html).toMatch(/<a href="#communaute"/);
    expect(html).toMatch(/<section id="communaute"/);
  });

  it('le bloc Hive Cloud dit clairement qu’il n’existe pas encore', () => {
    // Annoncer une offre payante sur une page publique sans dire qu'elle n'est
    // pas disponible, c'est promettre. On ne promet pas.
    const bloc = html.match(/<div class="cloud">[\s\S]*?<\/div>\s*<\/section>/)?.[0] ?? '';
    expect(bloc, 'bloc cloud introuvable').not.toBe('');
    expect(bloc).toMatch(/cloud-honest/);
    expect(bloc).toMatch(/n’existe pas encore|n'existe pas encore/);
  });
});

describe('site vitrine — ancres', () => {
  it('chaque lien de navigation vise une section réelle', () => {
    const nav = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
    const cibles = [...nav.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
    expect(cibles.length).toBeGreaterThan(3);
    for (const id of cibles) {
      expect(html, `ancre morte dans la nav : #${id}`).toMatch(
        new RegExp(`id="${id}"[\\s>]|id='${id}'[\\s>]`),
      );
    }
  });

  it("le décalage des ancres suit la hauteur mesurée de l'en-tête", () => {
    // L'en-tête est collant et sa hauteur varie du simple au double selon que
    // la nav tient sur une ligne (72 px) ou passe à la ligne (jusqu'à 176 px).
    // Une valeur en dur y laissait les titres de section cachés derrière la
    // barre sur mobile ; le décalage doit rester lié à la mesure.
    expect(html).toMatch(/scroll-margin-top:\s*calc\(var\(--h-entete/);
    expect(html).toMatch(/setProperty\(\s*'--h-entete'/);
  });
});
