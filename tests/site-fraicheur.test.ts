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
   * Le nombre d'éléments d'un littéral de tableau, à profondeur 0.
   *
   * `['a', 'b']` → 2 ; `[['a', 1], ['b', 2]]` → 2. On ne compte que les virgules
   * qui séparent les éléments du tableau lui-même, jamais celles de ce qu'ils
   * contiennent — sinon un tableau de paires compterait double.
   */
  /**
   * Le littéral de tableau qui COMMENCE à `debut`, crochets appariés.
   *
   * Une expression régulière ne sait pas faire ça : gourmande elle avale le
   * fichier, non gourmande elle s'arrête au premier `]` — donc au premier
   * élément d'un tableau de paires. On apparie à la main, en sautant ce qui est
   * entre guillemets.
   */
  const litteral = (src: string, debut: number): string => {
    if (debut < 0 || src[debut] !== '[') return '[]';
    let profondeur = 0;
    let chaine: string | null = null;
    for (let i = debut; i < src.length; i++) {
      const c = src[i];
      if (chaine !== null) {
        if (c === chaine && src[i - 1] !== '\\') chaine = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') chaine = c;
      else if (c === '[') profondeur++;
      else if (c === ']') {
        profondeur--;
        if (profondeur === 0) return src.slice(debut, i + 1);
      }
    }
    return '[]';
  };

  const cardinalite = (litteral: string): number => {
    let profondeur = 0;
    let n = 1;
    let chaine: string | null = null;
    for (let i = 1; i < litteral.length - 1; i++) {
      const c = litteral[i];
      if (chaine !== null) {
        if (c === chaine && litteral[i - 1] !== '\\') chaine = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') chaine = c;
      else if (c === '[' || c === '{' || c === '(') profondeur++;
      else if (c === ']' || c === '}' || c === ')') profondeur--;
      else if (c === ',' && profondeur === 0) n++;
    }
    return litteral.replace(/\s/g, '') === '[]' ? 0 : n;
  };

  /**
   * Les tests DÉCLARÉS dans `tests/`, comptés dans le texte.
   *
   * Ce n'est pas le compte de vitest — le lancer ici doublerait la suite.
   *
   * ─── L'ANGLE MORT QUI A FINI PAR MORDRE ──────────────────────────────────
   *
   * Ce compteur ne voyait qu'une déclaration par `it(` écrit. Un banc
   * PARAMÉTRÉ — `for (const v of LISTE) it(…)` — en déclare autant que la liste
   * a d'entrées, et il n'en comptait qu'une.
   *
   * Tant que ces bancs étaient rares, l'écart tenait dans les 10 % de jeu, et
   * le commentaire d'origine appelait ça « sous-estimer légèrement ». Trois
   * fichiers paramétrés plus tard, l'écart est passé à 10,3 % et la garde a
   * rougi — sur un chiffre de badge pourtant JUSTE, mesuré sur le rapport de
   * vitest.
   *
   * La garde avait raison de mordre : son compte était faux. On le lui apprend
   * plutôt que d'élargir sa tolérance — élargir aurait fait taire le symptôme
   * en gardant le compteur menteur.
   *
   * Ce qu'il ne sait toujours PAS voir, et c'est dit : une liste construite
   * ailleurs qu'en littéral (`Object.keys(…)`, un import) ne se compte pas. Le
   * repli reste 1, donc l'erreur reste du bon côté pour une garde de
   * vantardise.
   */
  const declares = (): number => {
    let n = 0;
    for (const f of readdirSync(DOSSIER_TESTS)) {
      // ─── `.mjs` AUSSI, ET C'EST UNE LEÇON FRAÎCHE ─────────────────────────
      //
      // Ce compteur n'a longtemps lu que `.test.ts`, parce qu'il n'existait que
      // ça. Le jour où `tests/amorce.test.mjs` est arrivé — trente et un tests
      // écrits en JavaScript nu, parce qu'ils éprouvent le code qui doit tourner
      // là où `tsx` n'existe pas — ils sont devenus INVISIBLES à la garde de
      // vantardise, qui a donc continué à valider un chiffre vieilli.
      //
      // Une garde dont le périmètre est figé par le dépôt d'hier se met à mentir
      // le jour où le dépôt change de forme, et rien ne le dit.
      if (!f.endsWith('.test.ts') && !f.endsWith('.test.mjs')) continue;
      // Les commentaires D'ABORD : un `it(` mis en commentaire pendant une
      // enquête gonflerait le compte et rendrait la garde complaisante.
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      n += (src.match(/^[ \t]*(?:it|test)(?:\.\w+)?\s*\(/gm) ?? []).length;

      // ─── LES BANCS PARAMÉTRÉS ─────────────────────────────────────────────
      //
      // Une boucle ou un `.each` qui contient un `it(` en déclare autant que sa
      // liste a d'entrées. On en a déjà compté 1 au-dessus : on ajoute le reste.
      //
      // Le premier jet cherchait la liste par `\[[\s\S]*?\]` — NON GOURMAND,
      // donc il s'arrêtait au premier `]`. Sur un tableau de paires, il ne
      // voyait que la première paire, et rendait 1. On apparie les crochets
      // pour de vrai.
      const listes = new Map<string, number>();
      for (const m of src.matchAll(/(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g)) {
        const debut = src.indexOf('[', m.index + m[0].length - 1);
        listes.set(m[1] ?? '', cardinalite(litteral(src, debut)));
      }

      /** Combien de cas cette source d'itération déclare-t-elle ? */
      const combien = (source: string, apres: number): number => {
        if (source.startsWith('[')) return cardinalite(litteral(src, apres));
        return listes.get(source) ?? 1;
      };

      for (const m of src.matchAll(
        /for\s*\(\s*const\s+[^)]*?\s+of\s+([\s\S]*?)\)\s*\{([\s\S]*?)\n\s*\}/g,
      )) {
        if (!/^[ \t]*(?:it|test)(?:\.\w+)?\s*\(/m.test(m[2] ?? '')) continue;
        const source = (m[1] ?? '').trim();
        n += Math.max(0, combien(source, src.indexOf('[', m.index)) - 1);
      }

      // `it.each` / `test.each` / `describe.each` : même chose, autre écriture.
      for (const m of src.matchAll(/(?:it|test|describe)\.each\s*\(\s*/g)) {
        const apres = m.index + m[0].length;
        const source = src.slice(apres).trimStart();
        n += Math.max(
          0,
          combien(source.startsWith('[') ? '[' : (source.split(/[\s,)]/)[0] ?? ''), apres) - 1,
        );
      }
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

describe('LA VITRINE N’EXIGE PAS UN AUTRE NODE QUE LA RUCHE', () => {
  it('le bandeau annonce la version MINIMALE de `engines.node`', () => {
    // ─── UN CHIFFRE QUE PERSONNE NE RELISAIT ────────────────────────────────
    //
    // La vitrine a annoncé « Node ≥ 20 » pendant que `package.json` exigeait 24,
    // que le README expliquait sur six lignes POURQUOI Node 20 casse
    // `better-sqlite3`, et que `hive doctor` refusait la version. Quatre
    // endroits énonçaient la même exigence ; le seul que le visiteur lit en
    // premier était le seul à se tromper.
    //
    // C'est le § 9 ter du journal : un document que rien ne vérifie ment plus
    // longtemps que du code — et celui-ci mentait DANS LE SENS DANGEREUX, en
    // invitant à installer sous une version qui produit une ruche morte-née.
    const paquet = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { engines: { node: string } };
    const exige = /(\d+)/.exec(paquet.engines.node)?.[1];
    expect(exige, 'engines.node est illisible').toBeTruthy();

    const annonce = /Node\s*(?:≥|&ge;|>=)\s*(\d+)/.exec(vitrine)?.[1];
    expect(annonce, 'aucun bandeau « Node ≥ N » dans la vitrine').toBeTruthy();
    expect(
      annonce,
      `la vitrine annonce Node ≥ ${String(annonce)} alors que la ruche exige ${String(exige)}`,
    ).toBe(exige);
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

describe('le badge « palier » ne diverge pas entre les langues', () => {
  // ─── CE QUI RESTE MESURABLE QUAND LA FRISE PART ─────────────────────────────
  //
  // Ici vivaient trois gardes qui recoupaient le badge « Palier 7 livré » du
  // héros contre une FRISE de paliers en bas de page : le badge devait annoncer
  // le dernier palier livré, le chapeau compter les mêmes, les numéros se suivre
  // sans trou. Cette frise a été retirée — elle racontait des paliers déjà
  // livrés, de l'histoire et pas un argument —, et l'arbitrage a gardé le badge
  // seul comme porteur du « où en est le projet », épaulé du lien CHANGELOG du
  // pied.
  //
  // Retirer la frise retire donc AUSSI son recoupement : le badge n'a plus de
  // référent sur la page. Le CHANGELOG, lui, n'énonce les paliers qu'en prose
  // (« paliers 2 → 4 fusionnés ») — aucun numéro parsable dont on pourrait faire
  // une source de vérité. La seule dérive encore MESURABLE est donc le désaccord
  // ENTRE LES DEUX LANGUES : un « Palier 7 » français figé au-dessus d'un
  // « Tier 8 » anglais, que personne ne relit. On garde cette parité — la même
  // classe de garde que « les deux langues annoncent le même chiffre » pour le
  // badge des tests — et on ne feint pas d'en prouver davantage.
  it('les deux langues annoncent le même palier', () => {
    const fr = chiffre(enFrancais('badge.tier'));
    const en = chiffre(enAnglais('badge.tier'));
    expect(fr, 'aucun numéro de palier dans le badge FR').toBeGreaterThan(0);
    expect(en, `le badge FR annonce le palier ${fr}, le badge EN le palier ${en}`).toBe(fr);
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

  // Ici vivaient deux gardes qui recoupaient les TREIZE cartes de la section
  // « Mission Control » (une par vue, avec sa touche) contre la nav d'App.tsx.
  // Le lot D de la consolidation 13→7 a fondu cette section dans « features » et
  // l'énumération n'a pas suivi : c'était l'inventaire que la refonte coupe —
  // l'aperçu à onglets MONTRE le tableau de bord, il ne le récite plus.
  //
  // Retirer l'énumération retire donc AUSSI son recoupement carte à carte. Ce
  // qui reste MESURABLE — et qui reste gardé, ci-dessous — est le NOMBRE : la
  // phrase « 13 vues navigables au clavier » a suivi l'aperçu dans features
  // (clé `mc.headline` intacte), et son chiffre est toujours confronté à la
  // source vraie, la nav d'App.tsx. Ajouter une quatorzième vue rend la vitrine
  // rouge le jour même ; se tromper de touche ne se voit plus ici — le
  // tableau de bord lui-même l'enseigne, et on ne feint pas d'en prouver plus.
  it('la phrase « N vues » annonce le vrai compte d’App.tsx', () => {
    const n = nav().length;
    expect(n, 'aucune vue lue dans App.tsx').toBeGreaterThan(5);
    expect(chiffre(enFrancais('mc.headline')), 'chapeau FR').toBe(n);
    expect(chiffre(enAnglais('mc.headline')), 'chapeau EN').toBe(n);
  });
});
