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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  READMES,
  badgeCorrige,
  compteReel,
  nombreDuBadge,
  principal,
  verdict,
} from '../scripts/compte-tests.mjs';

const BADGE = (n) =>
  `![Tests](https://img.shields.io/badge/tests-${n}%20passing-F6C445?labelColor=17130C)`;

describe('LE CHIFFRE LU DANS UN BADGE', () => {
  it('se lit dans la forme réellement employée par les READMEs', () => {
    expect(nombreDuBadge(BADGE(2821))).toBe(2821);
  });

  it('rend null — et non zéro — quand le badge est absent', () => {
    // Zéro ferait passer un README mutilé pour un README en retard : l'outil
    // « corrigerait » alors un fichier dont la forme est cassée.
    expect(nombreDuBadge('# Hive\n\nAucun badge ici.')).toBeNull();
  });

  it('ne se laisse pas prendre par un autre badge du même README', () => {
    const doc = `![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-F6C445)\n${BADGE(1234)}`;
    expect(nombreDuBadge(doc)).toBe(1234);
  });

  it('la correction ne touche QUE le chiffre', () => {
    const avant = `${BADGE(1)}\n\nDu texte avec 2820 dedans.\n`;
    const apres = badgeCorrige(avant, 999);
    expect(apres).toContain('tests-999%20passing');
    expect(apres, 'la prose a été touchée').toContain('Du texte avec 2820 dedans.');
    expect(apres, 'la couleur du badge a été perdue').toContain('F6C445');
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

describe('LES DEUX README SONT BIEN CEUX DU DÉPÔT', () => {
  it('la liste ne s’est pas vidée', () => {
    // Une liste vide rendrait tous les verdicts verts sans rien avoir regardé.
    expect(READMES).toEqual(['README.md', 'README.en.md']);
  });
});

// ─── LE GESTE COMPLET, SUR DE VRAIS FICHIERS ─────────────────────────────────
//
// Les tests au-dessus n'exercent que les fonctions pures. La loupe a rendu
// TROIS survivants dans `principal` — l'absence d'argument, la porte de
// `--corriger`, la garde du point d'entrée. C'est la seule partie du fichier
// qui écrit sur le disque, et c'était la seule que rien ne regardait.
describe('LE GESTE COMPLET', () => {
  /** Une racine jetable, avec ses deux README et son rapport. */
  function racineJetable(compteBadge, rapport) {
    const dir = mkdtempSync(path.join(tmpdir(), 'compte-tests-'));
    for (const nom of READMES) {
      writeFileSync(path.join(dir, nom), `# Hive\n\n${BADGE(compteBadge)}\n\nDu texte.\n`, 'utf8');
    }
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
      badges: READMES.map((n) => nombreDuBadge(readFileSync(path.join(dir, n), 'utf8'))),
    };
  }

  it('sans argument : il explique et sort en 2, sans rien écrire', () => {
    const dir = racineJetable(1, { numTotalTests: 9 });
    const r = lancer(dir, []);
    expect(r.code, 'un appel sans rapport a été traité comme un succès').toBe(2);
    expect(r.sortie).toContain('usage');
    expect(r.badges, 'il a touché aux README sans savoir à quoi les comparer').toEqual([1, 1]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rapport introuvable : il sort en 2 plutôt que de conclure', () => {
    const dir = racineJetable(1, { numTotalTests: 9 });
    const r = lancer(dir, ['rapport-qui-n-existe-pas.json']);
    expect(r.code).toBe(2);
    expect(r.sortie).toContain('illisible');
    rmSync(dir, { recursive: true, force: true });
  });

  it('badge périmé, SANS --corriger : il refuse et n’écrit rien', () => {
    const dir = racineJetable(1, { numTotalTests: 42 });
    const r = lancer(dir, ['rapport.json']);
    expect(r.code, 'un badge périmé est passé').toBe(1);
    expect(r.badges, 'il a corrigé sans qu’on le lui demande').toEqual([1, 1]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('badge périmé, AVEC --corriger : il écrit et sort en 0', () => {
    const dir = racineJetable(1, { numTotalTests: 42 });
    const r = lancer(dir, ['rapport.json', '--corriger']);
    expect(r.code).toBe(0);
    expect(r.badges).toEqual([42, 42]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('badge à jour : --corriger n’écrit RIEN — il n’y a rien à écrire', () => {
    // La porte `corriger && aCorriger.length > 0` : sans son second terme, le
    // geste réécrirait des fichiers déjà justes à chaque passage.
    const dir = racineJetable(42, { numTotalTests: 42 });
    const avant = READMES.map((n) => readFileSync(path.join(dir, n), 'utf8'));
    const r = lancer(dir, ['rapport.json', '--corriger']);
    expect(r.code).toBe(0);
    expect(READMES.map((n) => readFileSync(path.join(dir, n), 'utf8'))).toEqual(avant);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rapport illisible, MÊME avec --corriger : il refuse d’inventer un chiffre', () => {
    const dir = racineJetable(1, { rien: 'du tout' });
    const r = lancer(dir, ['rapport.json', '--corriger']);
    expect(r.code, 'il a conclu sur un compte inconnu').toBe(1);
    expect(r.badges, 'il a écrit un chiffre qu’il n’avait pas').toEqual([1, 1]);
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
