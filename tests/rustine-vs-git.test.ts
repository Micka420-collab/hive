// La rustine confrontée à de VRAIS diffs de git.
//
// Les tests de rustine.test.ts sont écrits à la main : ils vérifient que le
// module fait ce que je crois que git produit. C'est exactement le genre de
// certitude qui se révèle fausse en production, sur un cas de forme que je
// n'avais pas imaginé — une ligne vide, un fichier sans saut final, un hunk
// collé au bord du fichier.
//
// Ici, on ne suppose plus : on demande à `git diff` de produire le diff, on
// l'applique avec `appliquerRustine`, et on exige que le résultat soit
// EXACTEMENT le fichier d'arrivée. Aller-retour complet, oracle externe.
//
// Le test s'abstient proprement si git n'est pas installé — il vérifie une
// interopérabilité, pas une règle métier, et n'a pas à casser une CI minimale.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyserRustine, appliquerRustine } from '../src/orchestrator/rustine.js';

// ─── POURQUOI UN DÉLAI ÉLARGI POUR TOUT CE FICHIER ───────────────────────────
//
// Chacun de ces 16 tests lance de VRAIES commandes git dans un dépôt jetable —
// c'est tout leur intérêt : comparer notre rustine à `git apply` sur le disque,
// pas sur une simulation. Le prix, c'est plusieurs processus par test.
//
// Sous Windows, deux d'entre eux ont dépassé les 5 000 ms par défaut de vitest
// sur un runner chargé — alors qu'ils étaient passés au run précédent, sur le
// MÊME code. Ce n'est donc pas un blocage mais de la variance : le lancement de
// processus y coûte plus cher, et 5 s laissent trop peu de marge.
//
// LE DÉLAI EST POSÉ SUR LE FICHIER, pas sur les deux tests qui ont rougi
// aujourd'hui. Ils font tous exactement le même genre de travail : n'élargir
// que ceux-là ne ferait que déplacer la bascule sur leurs voisins au prochain
// runner lent.
//
// À ne pas confondre avec les blocages : trois tests du miroir tapaient les
// 30 000 ms AU MILLIÈME PRÈS, ce qui trahissait une attente sans fin. Ceux-là
// ont été CORRIGÉS — git y attendait des identifiants — et non rallongés. Un
// test qui touche exactement son plafond n'est pas lent, il attend.
vi.setConfig({ testTimeout: 20_000 });

function gitDisponible(): boolean {
  try {
    execFileSync('git', ['--version'], { shell: false, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const AVEC_GIT = gitDisponible();

describe.skipIf(!AVEC_GIT)('rustine — aller-retour contre git', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: dir ?? '.', shell: false, encoding: 'utf8' });

  /** Écrit un jeu de fichiers dans le dépôt (chemins relatifs). */
  function ecrire(fichiers: Record<string, string | null>): void {
    for (const [rel, contenu] of Object.entries(fichiers)) {
      const abs = path.join(dir ?? '.', rel);
      if (contenu === null) {
        rmSync(abs, { force: true });
        continue;
      }
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, contenu);
    }
  }

  /**
   * Prend un état AVANT et un état APRÈS, fait produire le diff par git, puis
   * l'applique avec la rustine et compare au fichier d'arrivée réel.
   */
  function allerRetour(avant: Record<string, string>, apres: Record<string, string | null>): void {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-rustine-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@hive.local']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'core.autocrlf', 'false']);
    ecrire(avant);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);

    ecrire(apres);
    git(['add', '-A']);
    // `--binary` non demandé : on veut le diff textuel que la ruche recevra.
    const diff = git(['diff', '--cached', '--no-color', '-U3']);
    expect(diff.length, 'git n’a produit aucun diff').toBeGreaterThan(0);

    const rustine = analyserRustine(diff);
    const bases = new Map<string, string | null>();
    for (const f of rustine.fichiers) bases.set(f.chemin, avant[f.chemin] ?? null);
    const ecritures = appliquerRustine(rustine, bases);

    for (const e of ecritures) {
      const attendu = apres[e.chemin] === undefined ? avant[e.chemin] : apres[e.chemin];
      expect(e.contenu, `contenu de ${e.chemin}`).toBe(attendu ?? null);
    }
    // Tout ce que git a touché a bien été rendu.
    const touches = new Set(ecritures.map((e) => e.chemin));
    for (const chemin of Object.keys(apres)) {
      expect(touches.has(chemin), `${chemin} absent des écritures`).toBe(true);
    }
  }

  it('une modification au milieu d’un fichier', () => {
    allerRetour(
      { 'src/a.ts': 'un\ndeux\ntrois\nquatre\ncinq\nsix\nsept\nhuit\n' },
      { 'src/a.ts': 'un\ndeux\nTROIS\nquatre\ncinq\nsix\nsept\nhuit\n' },
    );
  });

  it('une modification en toute première ligne', () => {
    allerRetour({ 'a.txt': 'a\nb\nc\n' }, { 'a.txt': 'A\nb\nc\n' });
  });

  it('une modification en toute dernière ligne', () => {
    allerRetour({ 'a.txt': 'a\nb\nc\n' }, { 'a.txt': 'a\nb\nC\n' });
  });

  it('deux zones éloignées dans le même fichier (deux hunks)', () => {
    const base = Array.from({ length: 40 }, (_, i) => `ligne ${i}`).join('\n') + '\n';
    const apres = base.replace('ligne 3\n', 'LIGNE 3\n').replace('ligne 30\n', 'LIGNE 30\n');
    allerRetour({ 'long.txt': base }, { 'long.txt': apres });
  });

  it('un fichier créé', () => {
    allerRetour({ 'garde.txt': 'x\n' }, { 'nouveau/fichier.ts': 'export const a = 1;\n' });
  });

  it('un fichier supprimé', () => {
    allerRetour({ 'garde.txt': 'x\n', 'aSupprimer.ts': 'adieu\n' }, { 'aSupprimer.ts': null });
  });

  it('plusieurs fichiers en une seule fois', () => {
    allerRetour(
      { 'a.ts': 'a1\na2\n', 'b.ts': 'b1\nb2\n', 'c.ts': 'c1\n' },
      { 'a.ts': 'a1\nA2\n', 'b.ts': 'B1\nb2\n' },
    );
  });

  it('des lignes vides dans le contexte', () => {
    allerRetour({ 'v.txt': 'un\n\ndeux\n\n\ntrois\n' }, { 'v.txt': 'un\n\nDEUX\n\n\ntrois\n' });
  });

  it('un fichier sans saut de ligne final', () => {
    // Le cas qui produit « \ No newline at end of file » et qui décide de
    // l'octet final du blob écrit sur GitHub.
    allerRetour({ 'sansfin.txt': 'a\nb' }, { 'sansfin.txt': 'a\nB' });
  });

  it('un fichier qui GAGNE un saut de ligne final', () => {
    allerRetour({ 'fin.txt': 'a\nb' }, { 'fin.txt': 'a\nb\n' });
  });

  it('un fichier qui PERD son saut de ligne final', () => {
    allerRetour({ 'fin2.txt': 'a\nb\n' }, { 'fin2.txt': 'a\nb' });
  });

  it('un fichier vidé de tout son contenu', () => {
    allerRetour({ 'vide.txt': 'a\nb\nc\n' }, { 'vide.txt': '' });
  });

  it('des caractères non-ASCII et des espaces significatifs', () => {
    allerRetour(
      { 'accents.txt': 'éléphant\n  indenté\n\ttabulé\nœuf\n' },
      { 'accents.txt': 'éléphant\n    réindenté\n\ttabulé\nœuf\n' },
    );
  });

  it('une ligne qui ressemble à un marqueur de diff', () => {
    // Un fichier dont le contenu commence par « --- » ou « +++ » : le parseur
    // ne doit pas le confondre avec un en-tête.
    allerRetour(
      { 'piege.md': '# Titre\n\n--- une règle\n+++ autre chose\n@@ pas un hunk @@\nfin\n' },
      { 'piege.md': '# Titre\n\n--- une règle\n+++ autre chose\n@@ pas un hunk @@\nFIN\n' },
    );
  });

  it('un ajout en tête et une suppression en queue, même fichier', () => {
    allerRetour({ 'bords.txt': 'l1\nl2\nl3\nl4\nl5\n' }, { 'bords.txt': 'l0\nl1\nl2\nl3\nl4\n' });
  });

  it('un fichier profondément imbriqué', () => {
    allerRetour(
      { 'a/b/c/d/e/f.ts': 'export const x = 1;\n' },
      { 'a/b/c/d/e/f.ts': 'export const x = 2;\n' },
    );
  });
});
