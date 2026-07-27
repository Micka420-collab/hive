// La rustine : appliquer un diff, ou refuser proprement.
//
// C'est le composant où une erreur ne se voit pas. Un hunk appliqué au mauvais
// endroit produit un fichier qui compile peut-être, passe peut-être la revue,
// et ne fait pas ce que le diff disait. Les tests ci-dessous vérifient donc
// deux choses en proportion égale : que ce qui DOIT s'appliquer s'applique au
// caractère près, et que tout le reste est REFUSÉ avec un motif utilisable.

import { describe, expect, it } from 'vitest';
import {
  ErreurRustine,
  MAX_FICHIERS,
  analyserRustine,
  appliquerFichier,
  appliquerRustine,
  cheminValide,
  cheminsDe,
  enLignes,
  enTexte,
} from '../src/orchestrator/rustine.js';

/** Un diff unifié minimal pour un fichier modifié. */
function diffModif(chemin: string, corps: string): string {
  return [`diff --git a/${chemin} b/${chemin}`, `--- a/${chemin}`, `+++ b/${chemin}`, corps].join(
    '\n',
  );
}

describe('rustine — découpage en lignes', () => {
  it('distingue un fichier terminé par un saut de celui qui ne l’est pas', () => {
    // Cette distinction décide de l'octet final du blob écrit sur GitHub, donc
    // du sha, donc de la présence d'un diff fantôme dans la PR.
    expect(enLignes('a\nb\n')).toEqual({ lignes: ['a', 'b'], sautFinal: true });
    expect(enLignes('a\nb')).toEqual({ lignes: ['a', 'b'], sautFinal: false });
    expect(enLignes('')).toEqual({ lignes: [], sautFinal: false });
  });

  it('fait l’aller-retour sans perte', () => {
    for (const s of ['a\nb\n', 'a\nb', '', '\n', 'x', 'a\n\nb\n']) {
      const { lignes, sautFinal } = enLignes(s);
      expect(enTexte(lignes, sautFinal), JSON.stringify(s)).toBe(s);
    }
  });
});

describe('rustine — chemins refusés', () => {
  it('refuse ce qui sort du dépôt', () => {
    // Le chemin vient d'un diff produit par un agent : c'est le seul endroit
    // qui le voit avant qu'il ne devienne une écriture sur le dépôt de quelqu'un.
    for (const mauvais of [
      '/etc/passwd',
      '../../.ssh/id_rsa',
      'src/../../etc/shadow',
      'C:/Windows/system32',
      'src\\windows\\a.ts',
      '',
      './a.ts',
      'src//a.ts',
    ]) {
      expect(cheminValide(mauvais), mauvais).toBe(false);
    }
  });

  it('refuse un chemin porteur d’un caractère de contrôle', () => {
    expect(cheminValide('src/a\nb.ts')).toBe(false);
    expect(cheminValide('src/a\u0000b.ts')).toBe(false);
  });

  it('accepte les chemins ordinaires', () => {
    for (const bon of [
      'src/a.ts',
      'a.ts',
      'src/sous/dossier/Fichier-1.test.tsx',
      '.github/ci.yml',
    ]) {
      expect(cheminValide(bon), bon).toBe(true);
    }
  });

  it('l’analyse rejette le diff entier sur un chemin hostile', () => {
    const diff = diffModif('../../etc/passwd', '@@ -1 +1 @@\n-a\n+b');
    expect(() => analyserRustine(diff)).toThrow(ErreurRustine);
  });
});

describe('rustine — application exacte', () => {
  it('applique un remplacement de ligne', () => {
    const r = analyserRustine(diffModif('a.ts', '@@ -2,1 +2,1 @@\n-const b = 2;\n+const b = 3;'));
    const e = appliquerFichier(r.fichiers[0]!, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    expect(e.contenu).toBe('const a = 1;\nconst b = 3;\nconst c = 3;\n');
    expect(e.operation).toBe('modification');
  });

  it('applique un ajout au milieu, contexte compris', () => {
    const r = analyserRustine(
      diffModif('a.ts', '@@ -1,2 +1,3 @@\n const a = 1;\n+const neuf = 0;\n const b = 2;'),
    );
    const e = appliquerFichier(r.fichiers[0]!, 'const a = 1;\nconst b = 2;\n');
    expect(e.contenu).toBe('const a = 1;\nconst neuf = 0;\nconst b = 2;\n');
  });

  it('applique une suppression de ligne', () => {
    const r = analyserRustine(diffModif('a.ts', '@@ -1,3 +1,2 @@\n a\n-b\n c'));
    expect(appliquerFichier(r.fichiers[0]!, 'a\nb\nc\n').contenu).toBe('a\nc\n');
  });

  it('applique plusieurs hunks dans le même fichier', () => {
    const base = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'].join('\n') + '\n';
    const r = analyserRustine(
      diffModif(
        'a.ts',
        ['@@ -2,1 +2,1 @@', '-l2', '+L2', '@@ -7,1 +7,1 @@', '-l7', '+L7'].join('\n'),
      ),
    );
    expect(appliquerFichier(r.fichiers[0]!, base).contenu).toBe(
      ['l1', 'L2', 'l3', 'l4', 'l5', 'l6', 'L7', 'l8'].join('\n') + '\n',
    );
  });

  it('crée un fichier neuf', () => {
    const diff = [
      'diff --git a/neuf.ts b/neuf.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/neuf.ts',
      '@@ -0,0 +1,2 @@',
      '+ligne 1',
      '+ligne 2',
    ].join('\n');
    const r = analyserRustine(diff);
    expect(r.fichiers[0]?.operation).toBe('creation');
    expect(appliquerFichier(r.fichiers[0]!, null).contenu).toBe('ligne 1\nligne 2\n');
  });

  it('supprime un fichier', () => {
    const diff = [
      'diff --git a/vieux.ts b/vieux.ts',
      'deleted file mode 100644',
      '--- a/vieux.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-adieu',
    ].join('\n');
    const r = analyserRustine(diff);
    expect(r.fichiers[0]?.operation).toBe('suppression');
    expect(appliquerFichier(r.fichiers[0]!, 'adieu\n').contenu).toBeNull();
  });

  it('respecte l’absence de saut de ligne final', () => {
    const diff = diffModif('a.ts', '@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file');
    const r = analyserRustine(diff);
    expect(r.fichiers[0]?.apresSansSaut).toBe(true);
    expect(appliquerFichier(r.fichiers[0]!, 'a\n').contenu).toBe('b');
  });

  it('le diff a le dernier mot sur la fin du fichier qu’il atteint', () => {
    // Sans marqueur « \ No newline », la ligne « +b » est une ligne COMPLÈTE :
    // le fichier produit se termine par un saut, même si la base n'en avait
    // pas. C'est ce que fait `git apply`, et c'est le seul choix cohérent —
    // sinon un diff identique donnerait deux résultats selon la base.
    const r = analyserRustine(diffModif('a.ts', '@@ -1,1 +1,1 @@\n-a\n+b'));
    expect(appliquerFichier(r.fichiers[0]!, 'a\n').contenu).toBe('b\n');
    expect(appliquerFichier(r.fichiers[0]!, 'a').contenu).toBe('b\n');
  });

  it('la base garde son octet final sur la queue que le diff ne touche pas', () => {
    // Le hunk s'arrête avant la fin : les dernières lignes sont recopiées
    // telles quelles, donc leur absence de saut final aussi.
    const r = analyserRustine(diffModif('a.ts', '@@ -1,1 +1,1 @@\n-a\n+A'));
    expect(appliquerFichier(r.fichiers[0]!, 'a\nqueue').contenu).toBe('A\nqueue');
    expect(appliquerFichier(r.fichiers[0]!, 'a\nqueue\n').contenu).toBe('A\nqueue\n');
  });

  it('préserve une ligne vide dans le contexte', () => {
    // Une ligne de contexte vide perd parfois son espace de tête en chemin.
    const r = analyserRustine(diffModif('a.ts', '@@ -1,3 +1,3 @@\n a\n\n-c\n+C'));
    expect(appliquerFichier(r.fichiers[0]!, 'a\n\nc\n').contenu).toBe('a\n\nC\n');
  });
});

describe('rustine — ce qui doit être REFUSÉ', () => {
  it('refuse un contexte qui ne correspond pas, en disant où et quoi', () => {
    // Le refus le plus important du module : la base a bougé.
    const r = analyserRustine(diffModif('a.ts', '@@ -2,1 +2,1 @@\n-const b = 2;\n+const b = 3;'));
    try {
      appliquerFichier(r.fichiers[0]!, 'const a = 1;\nconst b = 999;\n');
      expect.unreachable('un contexte divergent doit être refusé');
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurRustine);
      const err = e as ErreurRustine;
      expect(err.message).toMatch(/ligne 2/);
      expect(err.message).toMatch(/const b = 2;/); // ce qui était attendu
      expect(err.message).toMatch(/const b = 999;/); // ce qui est là
      expect(err.conseil, 'le conseil doit être actionnable').toMatch(/base à jour/);
      expect(err.chemin).toBe('a.ts');
    }
  });

  it('n’applique JAMAIS un hunk décalé', () => {
    // Même contenu, décalé d'une ligne : `patch` l'appliquerait, pas nous.
    const r = analyserRustine(diffModif('a.ts', '@@ -1,1 +1,1 @@\n-cible\n+CIBLE'));
    expect(() => appliquerFichier(r.fichiers[0]!, 'bruit\ncible\n')).toThrow(ErreurRustine);
  });

  it('refuse de modifier un fichier absent', () => {
    const r = analyserRustine(diffModif('fantome.ts', '@@ -1,1 +1,1 @@\n-a\n+b'));
    expect(() => appliquerFichier(r.fichiers[0]!, null)).toThrow(/introuvable/);
  });

  it('refuse de créer un fichier déjà présent', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- /dev/null',
      '+++ b/x.ts',
      '@@ -0,0 +1 @@',
      '+neuf',
    ].join('\n');
    const r = analyserRustine(diff);
    expect(() => appliquerFichier(r.fichiers[0]!, 'déjà là\n')).toThrow(/existe déjà/);
  });

  it('refuse un hunk qui vise au-delà de la fin du fichier', () => {
    const r = analyserRustine(diffModif('a.ts', '@@ -50,1 +50,1 @@\n-x\n+y'));
    expect(() => appliquerFichier(r.fichiers[0]!, 'a\n')).toThrow(/le fichier en compte 1/);
  });

  it('refuse des hunks qui se chevauchent', () => {
    const r = analyserRustine(
      diffModif(
        'a.ts',
        ['@@ -1,2 +1,2 @@', ' a', '-b', '+B', '@@ -1,1 +1,1 @@', '-a', '+A'].join('\n'),
      ),
    );
    expect(() => appliquerFichier(r.fichiers[0]!, 'a\nb\n')).toThrow(/chevauchants/);
  });

  it('refuse un diff binaire', () => {
    const diff = ['diff --git a/i.png b/i.png', 'GIT binary patch', 'literal 12345'].join('\n');
    expect(() => analyserRustine(diff)).toThrow(/binaire/);
  });

  it('refuse un diff sans aucun fichier', () => {
    expect(() => analyserRustine('')).toThrow(/aucun fichier/);
    expect(() => analyserRustine('bonjour, voici mon travail')).toThrow(/aucun fichier/);
  });

  it('refuse un hunk orphelin', () => {
    expect(() => analyserRustine('@@ -1,1 +1,1 @@\n-a\n+b')).toThrow(/orphelin/);
  });

  it('refuse un diff démesuré', () => {
    expect(() => analyserRustine('x'.repeat(1_000_001))).toThrow(/trop volumineux/);
  });

  it('refuse un diff qui touche trop de fichiers', () => {
    const diff = Array.from({ length: MAX_FICHIERS + 1 }, (_, i) =>
      diffModif(`f${i}.ts`, '@@ -1,1 +1,1 @@\n-a\n+b'),
    ).join('\n');
    expect(() => analyserRustine(diff)).toThrow(/trop de fichiers/);
  });
});

describe('rustine — tout ou rien', () => {
  const diff = [
    diffModif('bon.ts', '@@ -1,1 +1,1 @@\n-a\n+A'),
    diffModif('mauvais.ts', '@@ -1,1 +1,1 @@\n-attendu\n+neuf'),
  ].join('\n');

  it('applique les deux fichiers quand les deux bases concordent', () => {
    const r = analyserRustine(diff);
    const ecritures = appliquerRustine(
      r,
      new Map([
        ['bon.ts', 'a\n'],
        ['mauvais.ts', 'attendu\n'],
      ]),
    );
    expect(ecritures.map((e) => e.contenu)).toEqual(['A\n', 'neuf\n']);
  });

  it('ne rend RIEN si un seul fichier échoue', () => {
    // Un dépôt à moitié modifié est pire qu'un dépôt intact.
    const r = analyserRustine(diff);
    expect(() =>
      appliquerRustine(
        r,
        new Map([
          ['bon.ts', 'a\n'],
          ['mauvais.ts', 'a bougé\n'],
        ]),
      ),
    ).toThrow(ErreurRustine);
  });

  it('cheminsDe liste ce qu’il faut aller lire, trié et dédupliqué', () => {
    expect(cheminsDe(analyserRustine(diff))).toEqual(['bon.ts', 'mauvais.ts']);
  });
});

describe('rustine — un diff réel de bout en bout', () => {
  it('applique un diff git complet, en-têtes et index compris', () => {
    // La forme exacte que produit `git diff`, avec tout le bruit.
    const diff = [
      'diff --git a/src/calc.ts b/src/calc.ts',
      'index 83db48f..bf269f4 100644',
      '--- a/src/calc.ts',
      '+++ b/src/calc.ts',
      '@@ -1,7 +1,8 @@',
      ' export function somme(a: number, b: number): number {',
      '-  return a + b;',
      '+  // Somme bornée : un dépassement silencieux est pire qu’une erreur.',
      '+  return Math.min(Number.MAX_SAFE_INTEGER, a + b);',
      ' }',
      ' ', // ligne de contexte VIDE : un espace de signe, rien derrière
      ' export function produit(a: number, b: number): number {',
      '   return a * b;',
      ' }',
      '',
    ].join('\n');
    // La 4e ligne est VIDE : dans un diff unifié, git l'écrit « " " » — un
    // espace de signe suivi de rien. C'est exactement le cas que le parseur
    // doit distinguer d'une ligne contenant réellement un espace.
    const base = [
      'export function somme(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'export function produit(a: number, b: number): number {',
      '  return a * b;',
      '}',
      '',
    ].join('\n');

    const r = analyserRustine(diff);
    expect(r.fichiers).toHaveLength(1);
    expect(r.fichiers[0]?.chemin).toBe('src/calc.ts');
    const e = appliquerFichier(r.fichiers[0]!, base);
    expect(e.contenu).toContain('Math.min(Number.MAX_SAFE_INTEGER, a + b)');
    expect(e.contenu).not.toContain('  return a + b;');
    // Le reste du fichier est intact, au caractère près.
    expect(e.contenu).toContain(
      'export function produit(a: number, b: number): number {\n  return a * b;\n}\n',
    );
  });
});
