// LA FRAÎCHEUR DU SITE VITRINE — une page qui vieillit sans que personne le voie.
//
// `site.test.ts` verrouille ce que la page ne doit pas PERDRE : ses
// traductions, ses fontes, ses liens. Ce fichier-ci verrouille autre chose,
// et c'est un mode d'échec différent : ce que la page ne doit pas CONTINUER DE
// DIRE. Rien ne casse, rien ne devient invalide — la page s'affiche
// parfaitement et raconte le projet d'il y a six mois.
//
// Trois dérives cohabitaient sur la page au moment d'écrire ces lignes, et
// aucune n'était rattrapable par une relecture :
//
//   · le bandeau annonçait « 561 tests » alors qu'il y en a plus de 1 800 ;
//   · le badge disait « Palier 4 livré » au-dessus d'une frise qui en montre
//     sept, tous marqués livrés ;
//   · Mission Control listait dix vues, avec les mauvaises touches, et il
//     manquait celle qui ouvre le code du projet.
//
// Une vitrine qui sous-estime son propre projet d'un facteur trois est pire
// qu'une vitrine absente : elle décourage exactement les gens qu'elle cherche
// à convaincre, et elle le fait avec l'autorité d'un chiffre. Ces gardes ne
// défendent donc pas la page — elles défendent sa VÉRACITÉ.
//
// ─── POURQUOI DES TOLÉRANCES, ET PAS L'ÉGALITÉ ───────────────────────────────
//
// Un test qui exigerait le chiffre exact rendrait rouge tout commit qui ajoute
// un test, et on finirait par le désactiver. La garde vise la dérive, pas la
// décimale : elle laisse 10 % de jeu et mord quand l'écart devient un
// mensonge. C'est le seuil qui compte, pas le compte.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const vitrine = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const DOSSIER_TESTS = fileURLToPath(new URL('.', import.meta.url));

/** La valeur anglaise d'une clé du dictionnaire embarqué. */
function enAnglais(cle: string): string {
  const m = vitrine.match(new RegExp(`'${cle.replace(/\./g, '\\.')}':\\s*'((?:[^'\\\\]|\\\\.)*)'`));
  expect(m?.[1], `clé anglaise introuvable : ${cle}`).toBeTruthy();
  return m?.[1] ?? '';
}

/** Le texte français d'un élément, tel qu'il est écrit dans le HTML. */
function enFrancais(cle: string): string {
  const m = vitrine.match(
    new RegExp(`data-i18n="${cle.replace(/\./g, '\\.')}"[^>]*>([^<]*)<`, 's'),
  );
  expect(m?.[1], `élément introuvable dans le HTML : ${cle}`).toBeTruthy();
  return (m?.[1] ?? '').trim();
}

/** Le premier entier d'un texte, séparateurs de milliers compris. */
function chiffre(texte: string): number {
  return Number(texte.replace(/[^\d]/g, ''));
}

describe('le bandeau ne ment pas sur le nombre de tests', () => {
  /**
   * Les tests DÉCLARÉS dans `tests/`, comptés dans le texte.
   *
   * Ce n'est pas le compte de vitest — le lancer ici doublerait la suite. Le
   * comptage textuel sous-estime légèrement (`it.each` déroule une boucle),
   * ce qui est le bon sens de l'erreur pour une garde de vantardise.
   */
  const declares = (): number => {
    let n = 0;
    for (const f of readdirSync(DOSSIER_TESTS)) {
      if (!f.endsWith('.test.ts')) continue;
      // Les commentaires D'ABORD : un `it(` mis en commentaire pendant une
      // enquête gonflerait le compte et rendrait la garde complaisante.
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      n += (src.match(/^[ \t]*(?:it|test)(?:\.\w+)?\s*\(/gm) ?? []).length;
    }
    return n;
  };

  it('le chiffre affiché reste dans 10 % du nombre réel de tests', () => {
    const reels = declares();
    expect(reels, 'aucun test compté — le comptage est cassé').toBeGreaterThan(100);
    const affiche = chiffre(enFrancais('badge.tests'));

    expect(
      affiche,
      `la vitrine annonce ${affiche} tests pour ${reels} déclarés : elle se vante`,
    ).toBeLessThanOrEqual(Math.round(reels * 1.1));
    expect(
      affiche,
      `la vitrine annonce ${affiche} tests pour ${reels} déclarés : le chiffre a vieilli`,
    ).toBeGreaterThanOrEqual(Math.round(reels * 0.9));
  });

  it('les deux langues annoncent le même chiffre', () => {
    // « 1 855 » d'un côté, « 1,855 » de l'autre : la mise en forme change, pas
    // le nombre. Une traduction oubliée fige l'ancien chiffre pour les seuls
    // anglophones — c'est-à-dire pour la moitié des visiteurs, sans témoin.
    expect(chiffre(enAnglais('badge.tests'))).toBe(chiffre(enFrancais('badge.tests')));
  });
});

describe('la version affichée est celle du paquet', () => {
  it('l’en-tête cite la version de package.json', () => {
    // Une version figée dans l'en-tête est le mensonge le moins coûteux à
    // commettre et le plus embarrassant à découvrir : elle est sur CHAQUE
    // écran de la page, juste à côté du nom du projet.
    const paquet = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    const affichee = vitrine.match(/<span class="ver">v([\d.]+)/)?.[1];
    expect(affichee, 'version absente de l’en-tête').toBeTruthy();
    expect(affichee, `l’en-tête annonce v${affichee}, le paquet est en ${paquet.version}`).toBe(
      paquet.version,
    );
  });
});

describe('la frise des paliers est d’accord avec elle-même', () => {
  const frise = (): string => {
    const debut = vitrine.indexOf('<section id="roadmap"');
    expect(debut, 'section roadmap introuvable').toBeGreaterThan(-1);
    return vitrine.slice(debut, vitrine.indexOf('</section>', debut));
  };

  /** Les paliers marqués livrés dans la frise. */
  const livres = (): number => (frise().match(/class="ok"/g) ?? []).length;

  const MOTS_FR: Record<string, number> = {
    Un: 1,
    Deux: 2,
    Trois: 3,
    Quatre: 4,
    Cinq: 5,
    Six: 6,
    Sept: 7,
    Huit: 8,
    Neuf: 9,
    Dix: 10,
  };
  const MOTS_EN: Record<string, number> = {
    One: 1,
    Two: 2,
    Three: 3,
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9,
    Ten: 10,
  };

  it('le badge du bandeau annonce le dernier palier de la frise', () => {
    // La dérive typique : on ajoute un palier en bas de page et on oublie le
    // badge en haut. Les deux se contredisent alors sur le même écran.
    const n = livres();
    expect(n, 'aucun palier livré dans la frise').toBeGreaterThan(0);
    expect(chiffre(enFrancais('badge.tier')), 'badge FR ≠ frise').toBe(n);
    expect(chiffre(enAnglais('badge.tier')), 'badge EN ≠ frise').toBe(n);
  });

  it('le chapeau de la frise compte les mêmes paliers que la frise', () => {
    const n = livres();
    const motFr = enFrancais('rm.headline').split(' ')[0] ?? '';
    const motEn = enAnglais('rm.headline').split(' ')[0] ?? '';
    expect(MOTS_FR[motFr], `« ${motFr} » n’est pas un nombre écrit`).toBe(n);
    expect(MOTS_EN[motEn], `« ${motEn} » n’est pas un nombre écrit`).toBe(n);
  });

  it('les paliers se suivent sans trou ni doublon', () => {
    const numeros = [...frise().matchAll(/<div class="hex">(\d+)<\/div>/g)].map((m) =>
      Number(m[1]),
    );
    expect(numeros).toEqual(Array.from({ length: livres() }, (_, i) => i + 1));
  });
});

describe('Mission Control montre le vrai tableau de bord', () => {
  /**
   * Les vues du tableau de bord, lues dans la SOURCE du tableau de bord.
   *
   * C'est le seul juge honnête : la page vitrine décrit un produit qui vit
   * dans un autre dossier, et personne ne pense à la rouvrir quand il ajoute
   * une vue. Ici, ajouter une vue rend la vitrine rouge le jour même.
   */
  const nav = (): { titreFr: string; titreEn: string }[] => {
    const src = readFileSync(new URL('../dashboard/src/App.tsx', import.meta.url), 'utf8');
    const bloc = src.slice(src.indexOf('const NAV: NavItem[] = ['), src.indexOf('\n];'));
    return [...bloc.matchAll(/\{[^}]*\}/g)].map((m) => {
      const e = m[0];
      const label = e.match(/label:\s*'([^']+)'/)?.[1] ?? '';
      const labelEn = e.match(/labelEn:\s*'([^']+)'/)?.[1] ?? '';
      const key = e.match(/key:\s*'([^']+)'/)?.[1] ?? '';
      return { titreFr: `${key} · ${label}`, titreEn: `${key} · ${labelEn}` };
    });
  };

  /** Les cartes de la section Mission Control, dans l'ordre de la page. */
  const cartes = (): { cle: string; fr: string }[] => {
    const debut = vitrine.indexOf('<section id="mission"');
    const bloc = vitrine.slice(debut, vitrine.indexOf('</section>', debut));
    return [...bloc.matchAll(/<div class="t" data-i18n="(mc\.[\w.]+)">([^<]+)<\/div>/g)].map(
      (m) => ({ cle: m[1] ?? '', fr: (m[2] ?? '').trim() }),
    );
  };

  it('chaque vue du tableau de bord a sa carte, avec la BONNE touche', () => {
    // Une touche fausse sur la vitrine est un piège discret : le visiteur
    // essaie « 9 », tombe ailleurs, et conclut que le clavier ne marche pas.
    const attendues = nav().map((v) => v.titreFr);
    expect(cartes().map((c) => c.fr)).toEqual(attendues);
  });

  it('les cartes anglaises portent les mêmes touches et les mêmes noms', () => {
    const attendues = nav().map((v) => v.titreEn);
    expect(cartes().map((c) => enAnglais(c.cle))).toEqual(attendues);
  });

  it('le chapeau annonce le bon nombre de vues', () => {
    const n = nav().length;
    expect(n, 'aucune vue lue dans App.tsx').toBeGreaterThan(5);
    expect(chiffre(enFrancais('mc.headline')), 'chapeau FR').toBe(n);
    expect(chiffre(enAnglais('mc.headline')), 'chapeau EN').toBe(n);
  });
});
