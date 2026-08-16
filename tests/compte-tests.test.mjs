// LE GARDE-BADGE, ÉPROUVÉ — y compris sur ce qui l'aurait rendu creux.
//
// L'outil compare le compte réel de la suite au chiffre des badges. Ses deux
// façons de mentir dans le sens rassurant sont ici :
//
//   · un rapport tronqué rend `undefined`, `Number(undefined)` rend `NaN`, et
//     `NaN !== n` est vrai pour tout n — sans garde, un rapport illisible
//     passerait pour « badges à jour » ;
//   · un README sans badge rend `null`, qu'il ne faut surtout pas confondre
//     avec « ce README annonce zéro test ».

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CIBLES,
  COMPTES,
  CONSTATS,
  DEFINITION,
  compteReel,
  groupe,
  lire,
  principal,
  reecrire,
  verdict,
  verdictDesConstats,
} from '../scripts/compte-tests.mjs';

/** Les cibles, par nom — pour éprouver chacune sur sa propre mise en forme. */
const cible = (nom) => CIBLES.find((c) => c.nom === nom);

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Les fichiers distincts que les cibles visent — deux d'entre elles partagent la vitrine. */
const FICHIERS = [...new Set(CIBLES.map((c) => c.fichier))];

const BADGE = (n) =>
  `![Tests](https://img.shields.io/badge/tests-${n}%20passing-F6C445?labelColor=17130C)`;

/**
 * Un rapport vitest COMPLET.
 *
 * Les quatre nombres, toujours : le tableau A les annonce tous les quatre, et un
 * rapport amputé n'est plus « un rapport avec un champ en moins » — c'est un
 * rapport sur lequel l'outil doit refuser de conclure.
 */
const RAPPORT = (total, reste = {}) => ({
  numTotalTests: total,
  numPassedTests: total,
  numPendingTests: 0,
  numFailedTests: 0,
  ...reste,
});

/** La ligne « Suite de bancs » du tableau A, dans sa forme réelle. */
const LIGNE_A = ({ total, verts, ignores, rouges }) =>
  `| Suite de bancs | \`npm test\` (vitest run) | ✅ **${total}** ` +
  `(${verts} verts, ${ignores} ignorés, **${rouges} rouge**) |\n`;

describe('LE CHIFFRE LU DANS UNE ANNONCE', () => {
  const README = cible('README.md');

  it('se lit dans la forme réellement employée par les READMEs', () => {
    expect(lire(BADGE(2821), README)).toBe(2821);
  });

  it('rend null — et non zéro — quand l’annonce est absente', () => {
    // Zéro ferait passer un README mutilé pour un README en retard : l'outil
    // « corrigerait » alors un fichier dont la forme est cassée.
    expect(lire('# Hive\n\nAucun badge ici.', README)).toBeNull();
  });

  it('ne se laisse pas prendre par un autre badge du même README', () => {
    const doc = `![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-F6C445)\n${BADGE(1234)}`;
    expect(lire(doc, README)).toBe(1234);
  });

  it('la correction ne touche QUE le chiffre', () => {
    const avant = `${BADGE(1)}\n\nDu texte avec 2820 dedans.\n`;
    const apres = reecrire(avant, README, 999);
    expect(apres).toContain('tests-999%20passing');
    expect(apres, 'la prose a été touchée').toContain('Du texte avec 2820 dedans.');
    expect(apres, 'la couleur du badge a été perdue').toContain('F6C445');
  });
});

// ─── CHAQUE ENDROIT GARDE SA MISE EN FORME ───────────────────────────────────
//
// Le français sépare les milliers par une espace, l'anglais par une virgule, et
// l'URL d'un badge n'accepte ni l'une ni l'autre. Un outil qui écrirait « 2846 »
// partout casserait la typographie des deux langues de la vitrine ; un outil
// qui écrirait « 2 846 » dans une URL casserait le badge.
describe('LA MISE EN FORME DES MILLIERS', () => {
  it.each([
    [2846, ' ', '2 846'],
    [2846, ',', '2,846'],
    [2846, '', '2846'],
    [999, ' ', '999'],
    [1234567, ' ', '1 234 567'],
  ])('%i avec « %s » → %s', (n, sep, attendu) => {
    expect(groupe(n, sep)).toBe(attendu);
  });

  it('la vitrine se relit dans ses DEUX langues, séparateurs compris', () => {
    const fr = cible('site/index.html (FR)');
    const en = cible('site/index.html (EN)');
    const page = `<span data-i18n="badge.tests"\n  >2 600 tests ✓</span>\n'badge.tests': '2,600 tests ✓',`;
    expect(lire(page, fr), 'le français ne se relit pas').toBe(2600);
    expect(lire(page, en), 'l’anglais ne se relit pas').toBe(2600);

    const corrige = reecrire(reecrire(page, fr, 2846), en, 2846);
    expect(corrige, 'le français a perdu son espace').toContain('>2 846 tests ✓');
    expect(corrige, 'l’anglais a perdu sa virgule').toContain("'2,846 tests ✓'");
  });
});

describe('LE COMPTE RÉEL LU DANS LE RAPPORT', () => {
  it('se lit quand il est là', () => {
    expect(compteReel({ numTotalTests: 2821 })).toBe(2821);
  });

  it.each([
    ['rapport vide', {}],
    ['champ absent', { numPassedTests: 12 }],
    ['zéro test', { numTotalTests: 0 }],
    ['pas un entier', { numTotalTests: 12.5 }],
    ['pas un nombre', { numTotalTests: 'beaucoup' }],
    ['rapport nul', null],
  ])('rend null sur : %s', (_, rapport) => {
    // C'est CETTE ligne qui empêche le faux vert : sans elle, `NaN` remonterait
    // jusqu'à la comparaison, où toute inégalité est vraie et toute égalité
    // fausse — l'outil dirait « à corriger » ou « à jour » au hasard.
    expect(compteReel(rapport)).toBeNull();
  });

  it('lit les quatre champs, chacun le sien', () => {
    const r = { numTotalTests: 10, numPassedTests: 9, numPendingTests: 1, numFailedTests: 0 };
    expect(Object.keys(COMPTES).map((champ) => compteReel(r, champ))).toEqual([10, 9, 1, 0]);
  });

  // ─── LA BORNE DE CHAQUE PLANCHER, VALEUR ÉGALE ─────────────────────────────
  //
  // Le plancher n'est pas le même partout, et c'est tout l'intérêt : zéro test
  // total est un rapport cassé, zéro ÉCHEC est une suite verte. Un unique
  // « > 0 » rendrait `null` sur le « 0 rouge » du tableau A — le nombre qu'on
  // espère lire deviendrait celui qu'on ne peut pas garder.
  it.each([
    ['numTotalTests', 1],
    ['numPassedTests', 1],
    ['numPendingTests', 0],
    ['numFailedTests', 0],
  ])('%s : la valeur ÉGALE au plancher (%i) est lue', (champ, plancher) => {
    expect(compteReel({ [champ]: plancher }, champ)).toBe(plancher);
  });

  it.each([
    ['numTotalTests', 0],
    ['numPassedTests', 0],
    ['numPendingTests', -1],
    ['numFailedTests', -1],
  ])('%s : juste SOUS le plancher (%i) est refusé', (champ, sous) => {
    expect(compteReel({ [champ]: sous }, champ)).toBeNull();
  });

  it('un champ inconnu JETTE au lieu de rendre un refus trompeur', () => {
    // La première version rendait `null` — et la loupe a montré que la garde ne
    // gardait rien : `n >= undefined` est faux pour tout `n`, donc `null`
    // arrivait par le chemin d'à côté. Le silence était le vrai défaut : une
    // faute de frappe dans une cible se lisait « rapport incomplet », un refus
    // juste pour une raison fausse, cherché dans le rapport au lieu de la liste.
    expect(() => compteReel({ numInvente: 5 }, 'numInvente')).toThrow(/champ de rapport inconnu/);

    // Et il nomme les champs qu'il connaît : un message qui dit seulement
    // « inconnu » laisse chercher l'orthographe exacte ailleurs.
    expect(() => compteReel({}, 'numFailledTests')).toThrow(/numFailedTests/);
  });
});

describe('LE VERDICT', () => {
  const b = (nom, annonce) => ({ nom, annonce });

  it('est vert quand les deux badges portent le compte réel', () => {
    const v = verdict(2821, [b('README.md', 2821), b('README.en.md', 2821)]);
    expect(v.ok).toBe(true);
    expect(v.aCorriger).toEqual([]);
    expect(v.message).toContain('2821');
  });

  it('REFUSE un rapport illisible plutôt que de conclure', () => {
    const v = verdict(null, [b('README.md', 2821), b('README.en.md', 2821)]);
    expect(v.ok, 'un rapport illisible a été pris pour un accord').toBe(false);
    expect(v.aCorriger, 'on a proposé de corriger sur un compte inconnu').toEqual([]);
    expect(v.message).toMatch(/numTotalTests/);
  });

  it('REFUSE de corriger un README dont le badge a disparu', () => {
    // Corriger ici voudrait dire réinventer une ligne de badge dont on ne
    // connaît ni la place ni la forme. On constate, on n'invente pas.
    const v = verdict(2821, [b('README.md', 2821), b('README.en.md', null)]);
    expect(v.ok).toBe(false);
    expect(v.aCorriger).toEqual([]);
    expect(v.message).toContain('README.en.md');
  });

  it('ne désigne QUE les README réellement en retard', () => {
    const v = verdict(2821, [b('README.md', 2730), b('README.en.md', 2821)]);
    expect(v.ok).toBe(false);
    expect(v.aCorriger, 'un README à jour a été désigné à la correction').toEqual(['README.md']);
    expect(v.message).toContain('README.md → 2730');
  });

  it('désigne les deux quand les deux sont en retard — le cas réel', () => {
    // C'est ce qui s'est produit deux fois : les deux badges d'accord, et faux
    // ensemble. La garde qui les compare l'un à l'autre ne pouvait rien y voir.
    const v = verdict(2821, [b('README.md', 2730), b('README.en.md', 2730)]);
    expect(v.aCorriger).toEqual(['README.md', 'README.en.md']);
  });
});

describe('LES CIBLES SONT BIEN CELLES DU DÉPÔT', () => {
  it('les six annonces publiques sont là', () => {
    // Une liste vide rendrait tous les verdicts verts sans rien avoir regardé.
    expect(CIBLES.map((c) => c.nom)).toEqual([
      'README.md',
      'README.en.md',
      'site/index.html (FR)',
      'site/index.html (EN)',
      'site/presentation/index.html (FR)',
      'site/presentation/index.html (EN)',
    ]);
  });

  it('chaque cible sait lire le fichier RÉEL qu’elle vise', () => {
    // Le motif d'une cible peut cesser de mordre sur un simple reformatage.
    // Sans ce test, l'outil dirait « compte introuvable » — un refus qu'on
    // finirait par contourner plutôt que par corriger.
    for (const c of CIBLES) {
      const source = readFileSync(path.join(RACINE, c.fichier), 'utf8');
      expect(lire(source, c), `${c.nom} : le motif ne mord plus`).not.toBeNull();
    }
  });
});

// ─── LE SEUL DOCUMENT DONT LE SUJET EST LA MESURE ────────────────────────────
//
// Le tableau A de la définition de sortie annonce quatre nombres, et rien ne les
// regardait. Le 16 août il disait encore 4071 quand la suite en rendait 4249 —
// daté, relu, et faux. § 9 duoquadragicenties : une précaution qui repose sur la
// vigilance du lecteur est une dette, pas une garde.
describe('LE TABLEAU DATÉ DE LA DÉFINITION DE SORTIE', () => {
  const SOURCE = () => readFileSync(path.join(RACINE, DEFINITION), 'utf8');

  it('LES QUATRE NOMBRES SE LISENT DANS LE FICHIER RÉEL — sinon rien ici ne mesure rien', () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ───────────────
    const source = SOURCE();
    for (const c of CONSTATS) {
      expect(lire(source, c), `${c.nom} : le motif ne mord plus`).not.toBeNull();
    }
  });

  it('CHAQUE ANCRE EST UNIQUE — sinon on corrigerait l’histoire du défaut', () => {
    // Le document RACONTE ses anciens comptes (« 4071 sur l'arbre 90c1694 ») et
    // une couverture de « 10 803 / 14 250 ». Une ancre lâche mordrait sur cette
    // prose : § 9 unquadragicenties, où un mutant s'est posé DANS UN COMMENTAIRE
    // faute d'avoir vérifié qu'un texte n'apparaissait qu'une fois.
    const source = SOURCE();
    for (const c of CONSTATS) {
      const partout = new RegExp(c.motif.source, 'g');
      expect(
        [...source.matchAll(partout)],
        `${c.nom} : l’ancre mord à plusieurs endroits du document`,
      ).toHaveLength(1);
    }
  });

  it('les quatre champs du rapport sont couverts, et tous dans le même fichier', () => {
    // Une liste vide, ou amputée du « 0 rouge », rendrait le verdict vert sans
    // avoir regardé le nombre qui compte le plus.
    expect(CONSTATS.map((c) => c.champ)).toEqual([
      'numTotalTests',
      'numPassedTests',
      'numPendingTests',
      'numFailedTests',
    ]);
    expect(CONSTATS.map((c) => c.fichier)).toEqual(Array(4).fill(DEFINITION));
  });
});

describe('LE VERDICT DU TABLEAU DATÉ', () => {
  const r = (nom, annonce, reel) => ({ nom, annonce, reel });
  const ACCORD = [r('total', 4250, 4250), r('verts', 4242, 4242), r('rouges', 0, 0)];

  it('est vert quand les nombres disent la mesure', () => {
    const v = verdictDesConstats(ACCORD);
    expect(v.ok).toBe(true);
    expect(v.aRemesurer).toEqual([]);
  });

  it('un écart REFUSE, nomme l’écart, et réclame la RE-DATATION — arbre compris', () => {
    // C'est le cœur du lot. Un message qui n'énoncerait que l'écart ferait
    // retoucher les quatre nombres en laissant le titre nommer l'arbre
    // précédent : le tableau suivrait HEAD sous une provenance périmée, ce qui
    // se lit comme une mesure sans en être une.
    const v = verdictDesConstats([r('total', 4071, 4250), ...ACCORD.slice(1)]);
    expect(v.ok).toBe(false);
    expect(v.aRemesurer, 'un nombre juste a été désigné à la re-mesure').toEqual(['total']);
    expect(v.message).toContain('annoncé 4071, mesuré 4250');
    expect(v.message, 'le refus n’exige pas de re-dater').toMatch(/re-dater/);
    expect(v.message, 'le refus ne dit pas que l’arbre est concerné').toMatch(/ARBRE/);
  });

  it('« 0 rouge » est gardé : un seul échec fait rougir le tableau', () => {
    // Le nombre le plus rassurant du tableau, et donc le moins vérifié : sans
    // ce cas, une suite qui casse laisserait « **0 rouge** » en place.
    const v = verdictDesConstats([...ACCORD.slice(0, 2), r('rouges', 0, 1)]);
    expect(v.ok, 'une suite avec un échec a laissé « 0 rouge » debout').toBe(false);
    expect(v.aRemesurer).toEqual(['rouges']);
  });

  it('REFUSE un rapport incomplet plutôt que de conclure', () => {
    const v = verdictDesConstats([...ACCORD.slice(0, 2), r('rouges', 0, null)]);
    expect(v.ok).toBe(false);
    expect(v.aRemesurer, 'on a proposé une re-mesure sur un compte inconnu').toEqual([]);
    expect(v.message).toContain('incomplet');
  });

  it('REFUSE quand la ligne du tableau a changé de forme', () => {
    // On constate, on n'invente pas : réécrire ici voudrait dire deviner où le
    // nombre est parti.
    const v = verdictDesConstats([...ACCORD.slice(0, 2), r('rouges', null, 0)]);
    expect(v.ok).toBe(false);
    expect(v.aRemesurer).toEqual([]);
    expect(v.message).toContain('introuvable');
  });
});

// ─── LE GESTE COMPLET, SUR DE VRAIS FICHIERS ─────────────────────────────────
//
// Les tests au-dessus n'exercent que les fonctions pures. La loupe a rendu
// TROIS survivants dans `principal` — l'absence d'argument, la porte de
// `--corriger`, la garde du point d'entrée. C'est la seule partie du fichier
// qui écrit sur le disque, et c'était la seule que rien ne regardait.
describe('LE GESTE COMPLET', () => {
  /**
   * Une racine jetable qui porte les QUATRE annonces, dans leurs vrais formats.
   *
   * La vitrine en porte deux à elle seule. C'est le cas qui compte : deux
   * cibles dans un même fichier, et une écriture qui doit les garder toutes les
   * deux — une version qui relisait le fichier entre les deux corrections
   * effaçait la première.
   */
  function racineJetable(compteAnnonce, rapport, constats = null) {
    const dir = mkdtempSync(path.join(tmpdir(), 'compte-tests-'));
    mkdirSync(path.join(dir, 'site'), { recursive: true });
    // Le tableau daté, accordé au rapport SAUF si le cas demande le contraire :
    // les bancs des badges n'ont rien à dire sur lui, et un désaccord imposé par
    // défaut les ferait tous rougir pour une raison qui n'est pas la leur.
    mkdirSync(path.join(dir, path.dirname(DEFINITION)), { recursive: true });
    writeFileSync(
      path.join(dir, DEFINITION),
      LIGNE_A(
        constats ?? {
          total: rapport?.numTotalTests ?? 0,
          verts: rapport?.numPassedTests ?? 0,
          ignores: rapport?.numPendingTests ?? 0,
          rouges: rapport?.numFailedTests ?? 0,
        },
      ),
      'utf8',
    );
    const fr = groupe(compteAnnonce, ' ');
    const en = groupe(compteAnnonce, ',');
    for (const nom of ['README.md', 'README.en.md']) {
      writeFileSync(
        path.join(dir, nom),
        `# Hive\n\n${BADGE(compteAnnonce)}\n\nDu texte.\n`,
        'utf8',
      );
    }
    writeFileSync(
      path.join(dir, 'site', 'index.html'),
      `<span data-i18n="badge.tests"\n  >${fr} tests ✓</span>\n'badge.tests': '${en} tests ✓',\n`,
      'utf8',
    );
    mkdirSync(path.join(dir, 'site', 'presentation'), { recursive: true });
    writeFileSync(
      path.join(dir, 'site', 'presentation', 'index.html'),
      `<span data-i18n="badge.tests"\n  >${fr} tests</span>\n'badge.tests': '${en} tests',\n`,
      'utf8',
    );
    writeFileSync(path.join(dir, 'rapport.json'), JSON.stringify(rapport), 'utf8');
    return dir;
  }

  /** Ce que le geste a écrit, et avec quel code il est sorti. */
  function lancer(dir, argv) {
    let sortie = '';
    let code = 0;
    principal(
      argv,
      dir,
      (s) => {
        sortie += s;
      },
      (c) => {
        code = c;
      },
    );
    return {
      sortie,
      code,
      annonces: CIBLES.map((c) => lire(readFileSync(path.join(dir, c.fichier), 'utf8'), c)),
    };
  }

  it('sans argument : il explique et sort en 2, sans rien écrire', () => {
    const dir = racineJetable(1, RAPPORT(9));
    const r = lancer(dir, []);
    expect(r.code, 'un appel sans rapport a été traité comme un succès').toBe(2);
    expect(r.sortie).toContain('usage');
    expect(r.annonces, 'il a touché aux README sans savoir à quoi les comparer').toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rapport introuvable : il sort en 2 plutôt que de conclure', () => {
    const dir = racineJetable(1, RAPPORT(9));
    const r = lancer(dir, ['rapport-qui-n-existe-pas.json']);
    expect(r.code).toBe(2);
    expect(r.sortie).toContain('illisible');
    rmSync(dir, { recursive: true, force: true });
  });

  // ─── « ILLISIBLE » NE DIT PAS POURQUOI, ET C'EST LE MOT QUI COMPTE ──────────
  //
  // La garde du dessus n'exigeait que le mot « illisible ». Retirer la RAISON du
  // message — `${e instanceof Error ? e.message : String(e)}` remplacé par rien —
  // la laissait VERTE, avec les 31 autres : mesuré, verdict affiché.
  //
  // Or ce message est ce qu'un mainteneur lit quand la CI barre sa livraison, et
  // les deux causes n'ont pas la même réparation :
  //
  //     fichier absent    → la suite n'a pas produit son rapport, on la relance
  //                         avec `--reporter=json --outputFile.json=…` ;
  //     JSON malformé     → le rapport EXISTE et il est cassé, relancer ne sert
  //                         à rien, il faut regarder ce qui l'a écrit.
  //
  // Confondre les deux, c'est envoyer chercher une panne inexistante — la faute
  // exacte du docteur qui sondait le port 0 (`ERREURS § 9 duotrigies` et la
  // famille de `src/shared/port.ts`). Un outil de diagnostic qui ne diagnostique
  // pas est pire qu'un outil muet : on le croit.
  //
  // Ce banc n'épingle donc AUCUN texte : il exige que les deux causes restent
  // DISTINGUABLES l'une de l'autre. Épingler « ENOENT » ferait rougir sur un
  // changement de Node qui n'a rien cassé — la garde deviendrait un piège.
  it('rapport illisible : le message dit POURQUOI, pas seulement que', () => {
    const dir = racineJetable(1, RAPPORT(9));

    const absent = lancer(dir, ['rapport-qui-n-existe-pas.json']);

    // Le fichier existe, et n'est pas du JSON : la lecture passe, l'analyse casse.
    writeFileSync(path.join(dir, 'pas-du-json.json'), 'ceci n’est pas du JSON', 'utf8');
    const casse = lancer(dir, ['pas-du-json.json']);

    expect(absent.code, 'un rapport absent a été traité autrement qu’en 2').toBe(2);
    expect(casse.code, 'un rapport cassé a été traité autrement qu’en 2').toBe(2);

    // Chaque message porte plus que le constat : le nom du fichier ET une raison.
    for (const [quoi, r] of [
      ['absent', absent],
      ['cassé', casse],
    ]) {
      const apresLeNom = r.sortie.slice(r.sortie.indexOf(')') + 1).trim();
      expect(
        apresLeNom.length,
        `rapport ${quoi} : le message s’arrête au constat, sans dire pourquoi`,
      ).toBeGreaterThan(0);
    }

    // Et surtout : les deux ne se ressemblent pas. C'est CE qui rend le message
    // utile — deux pannes différentes ne peuvent pas se lire pareil.
    const raison = (s) => s.slice(s.indexOf(')') + 1).replace(/[^a-zA-Z]/g, '');
    expect(
      raison(casse.sortie),
      'le rapport cassé et le rapport absent racontent la même chose',
    ).not.toBe(raison(absent.sortie));

    rmSync(dir, { recursive: true, force: true });
  });

  it('badge périmé, SANS --corriger : il refuse et n’écrit rien', () => {
    const dir = racineJetable(1, RAPPORT(42));
    const r = lancer(dir, ['rapport.json']);
    expect(r.code, 'un badge périmé est passé').toBe(1);
    expect(r.annonces, 'il a corrigé sans qu’on le lui demande').toEqual([1, 1, 1, 1, 1, 1]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('badge périmé, AVEC --corriger : il écrit et sort en 0', () => {
    const dir = racineJetable(1, RAPPORT(42));
    const r = lancer(dir, ['rapport.json', '--corriger']);
    expect(r.code).toBe(0);
    expect(r.annonces).toEqual([42, 42, 42, 42, 42, 42]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('badge à jour : --corriger n’écrit RIEN — il n’y a rien à écrire', () => {
    // La porte `corriger && aCorriger.length > 0` : sans son second terme, le
    // geste réécrirait des fichiers déjà justes à chaque passage.
    const dir = racineJetable(42, RAPPORT(42));
    const avant = FICHIERS.map((f) => readFileSync(path.join(dir, f), 'utf8'));
    const r = lancer(dir, ['rapport.json', '--corriger']);
    expect(r.code).toBe(0);
    expect(FICHIERS.map((f) => readFileSync(path.join(dir, f), 'utf8'))).toEqual(avant);
    rmSync(dir, { recursive: true, force: true });
  });

  // ─── LE TABLEAU DATÉ BARRE SEUL, ET NE SE LAISSE PAS RÉPARER ───────────────
  //
  // Les deux cas qui tiennent le lot. Le premier reproduit la situation du
  // 16 août : les six badges JUSTES, et le tableau A périmé — l'ancienne version
  // sortait en 0 et laissait passer. Le second interdit la réparation
  // automatique, qui produirait des chiffres frais sous une provenance périmée.
  const PERIME = { total: 41, verts: 41, ignores: 0, rouges: 0 };

  it('un tableau A périmé barre la livraison MÊME quand les six badges sont justes', () => {
    const dir = racineJetable(42, RAPPORT(42), PERIME);
    const r = lancer(dir, ['rapport.json']);
    expect(r.code, 'un tableau A périmé est passé').toBe(1);
    expect(r.annonces, 'les badges étaient justes et ont été touchés').toEqual([
      42, 42, 42, 42, 42, 42,
    ]);
    expect(r.sortie).toContain('annoncé 41, mesuré 42');
    rmSync(dir, { recursive: true, force: true });
  });

  it('--corriger NE répare PAS le tableau daté : il refuse, et le fichier ne bouge pas', () => {
    const dir = racineJetable(42, RAPPORT(42), PERIME);
    const avant = readFileSync(path.join(dir, DEFINITION), 'utf8');
    const r = lancer(dir, ['rapport.json', '--corriger']);
    expect(r.code, 'le tableau périmé est passé sous --corriger').toBe(1);
    expect(
      readFileSync(path.join(dir, DEFINITION), 'utf8'),
      'l’outil a réécrit une mesure datée dont il ne peut pas dater la provenance',
    ).toBe(avant);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rapport illisible, MÊME avec --corriger : il refuse d’inventer un chiffre', () => {
    const dir = racineJetable(1, { rien: 'du tout' });
    const r = lancer(dir, ['rapport.json', '--corriger']);
    expect(r.code, 'il a conclu sur un compte inconnu').toBe(1);
    expect(r.annonces, 'il a écrit un chiffre qu’il n’avait pas').toEqual([1, 1, 1, 1, 1, 1]);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── LANCÉ POUR DE VRAI ──────────────────────────────────────────────────────
//
// Tout ce qui précède IMPORTE le module. La garde du point d'entrée, elle, ne
// se vérifie qu'en le LANÇANT : c'est elle qui décide si `principal` tourne, et
// un mutant l'a survécue parce qu'aucun test ne passait par là.
//
// Deux propriétés, opposées, et il faut les deux : lancé, il travaille ;
// importé, il se tait. La seconde n'est pas une coquetterie — sans elle,
// importer ce fichier pendant une campagne de mutation RÉÉCRIRAIT les README.
describe('LE POINT D’ENTRÉE', () => {
  const SCRIPT = fileURLToPath(new URL('../scripts/compte-tests.mjs', import.meta.url));

  it('lancé sans argument, il sort en 2 et dit comment s’en servir', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', shell: false });
    expect(r.error, 'le script n’a pas pu être lancé').toBeUndefined();
    expect(r.status, 'le corps ne s’est pas exécuté : la garde d’entrée est morte').toBe(2);
    expect(r.stdout).toContain('usage');
  });

  it('importé, il ne fait rien du tout', () => {
    // On importe le module dans un processus qui reçoit des arguments dignes
    // d'un vrai appel. S'il s'exécutait à l'import, il sortirait en 2.
    const r = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`],
      { encoding: 'utf8', shell: false },
    );
    expect(r.status, 'l’import a déclenché le geste').toBe(0);
    expect(r.stdout, 'l’import a écrit quelque chose').toBe('');
  });
});
