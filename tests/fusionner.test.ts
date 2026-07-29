// Le script de fusion — ses REFUS, exercés.
//
// ─── POURQUOI CE FICHIER PÈSE PLUS QUE LE SCRIPT ─────────────────────────────
//
// `scripts/fusionner.sh` POUSSE SUR LA BRANCHE PAR DÉFAUT. C'est le geste le
// moins rattrapable du dépôt : un historique publié ne se corrige qu'en le
// réécrivant, et tous ceux qui l'avaient récupéré gardent l'ancien.
//
// Ce qui protège, dans ce script, ce n'est donc pas ce qu'il fait — c'est ce
// qu'il REFUSE de faire. Et un refus non exercé n'est pas un refus : c'est une
// intention. On éprouve donc les trois portes, chacune sur un vrai dépôt git.
//
// ─── CE QU'IL REMPLACE, ET POURQUOI ──────────────────────────────────────────
//
// Fusionner par l'API GitHub fait fabriquer le commit de fusion PAR GITHUB :
// son committer est `noreply@github.com`, quel que soit l'auteur du code. Les
// huit dernières fusions du dépôt (#80 à #87) sont toutes dans ce cas, et
// arrivent « Unverified ».
//
// L'avance rapide ne fabrique AUCUN commit : `main` se déplace sur des commits
// déjà écrits et déjà relus. Il n'y a plus de committer à corriger parce qu'il
// n'y a plus de commit de trop.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// `fileURLToPath`, jamais `.pathname` : sous Windows ce dernier rend `/D:/…`,
// que `path.resolve` préfixe de la racine du lecteur (§ 6.1 du journal).
const SCRIPT = fileURLToPath(new URL('../scripts/fusionner.sh', import.meta.url));

/** Ce banc lance `sh` et `git` : sous Windows, `sh` n'est pas garanti. */
const POSIX = process.platform !== 'win32';

const IDENTITE = ['-c', 'user.email=noreply@anthropic.com', '-c', 'user.name=Claude'];

describe('fusionner.sh — les portes qu’il ferme', () => {
  let racine: string | null = null;

  afterEach(() => {
    if (racine) rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
    racine = null;
  });

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', [...IDENTITE, ...args], { cwd, encoding: 'utf8' });

  /**
   * Un vrai « origin » et un vrai clone — pas un simulacre.
   *
   * Le script interroge `git merge-base`, `git status` et `git log` ; les
   * simuler éprouverait ma compréhension de git plutôt que le script.
   */
  function depot(): { local: string } {
    racine = mkdtempSync(path.join(os.tmpdir(), 'hive-fusion-'));
    const origin = path.join(racine, 'origin.git');
    const local = path.join(racine, 'local');
    execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', origin, local], { stdio: 'ignore' });
    writeFileSync(path.join(local, 'a.txt'), 'un\n');
    git(local, 'add', '-A');
    git(local, 'commit', '-m', 'racine');
    git(local, 'push', '-u', 'origin', 'main');
    git(local, 'checkout', '-b', 'travaux');
    return { local };
  }

  /** Lance le script et rend son code et sa sortie. */
  function lancer(cwd: string, ...args: string[]): { code: number; sortie: string } {
    try {
      return {
        code: 0,
        sortie: execFileSync('sh', [SCRIPT, ...args], {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, GIT_AUTHOR_NAME: 'Claude', GIT_COMMITTER_NAME: 'Claude' },
        }),
      };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  function commiter(local: string, fichier: string, email: string): void {
    writeFileSync(path.join(local, fichier), 'contenu\n');
    execFileSync('git', ['-c', `user.email=${email}`, '-c', 'user.name=Qui', 'add', '-A'], {
      cwd: local,
    });
    execFileSync(
      'git',
      ['-c', `user.email=${email}`, '-c', 'user.name=Qui', 'commit', '-m', `ajoute ${fichier}`],
      { cwd: local, stdio: 'ignore' },
    );
  }

  it('le script est du sh valide, sans bashisme de syntaxe', () => {
    // Même règle qu'`install.sh` : les images minimales n'ont pas bash.
    expect(() => execFileSync('sh', ['-n', SCRIPT], { encoding: 'utf8' })).not.toThrow();
  });

  it.runIf(POSIX)('UN ARBRE SALE NE SE POUSSE PAS', { timeout: 60_000 }, () => {
    // On ne publie pas un état qu'on n'a pas vu passer la barrière.
    const { local } = depot();
    commiter(local, 'b.txt', 'noreply@anthropic.com');
    writeFileSync(path.join(local, 'sale.txt'), 'non commité\n');
    const r = lancer(local);
    expect(r.code).toBe(1);
    expect(r.sortie).toMatch(/sale/i);
  });

  it.runIf(POSIX)('UN COMMITTER INATTENDU EST NOMMÉ, PAS LAISSÉ FILER', { timeout: 60_000 }, () => {
    // ─── LA RAISON D'ÊTRE DU SCRIPT ──────────────────────────────────────
    //
    // C'est exactement ce qu'on cherche à empêcher. Le signaler APRÈS l'avoir
    // poussé ne sert plus à rien : l'historique publié ne se corrige qu'en le
    // réécrivant.
    const { local } = depot();
    commiter(local, 'b.txt', 'quelquun@autre.part');
    const r = lancer(local);
    expect(r.code).toBe(3);
    expect(r.sortie).toMatch(/quelquun@autre\.part/);
    expect(r.sortie, 'et le geste exact pour corriger').toMatch(/--reset-author/);
  });

  it.runIf(POSIX)('UNE BASE QUI A BOUGÉ REND LA MAIN', { timeout: 60_000 }, () => {
    // ─── LE REFUS QUI ÉVITE UN COMMIT DE FUSION ────────────────────────────
    //
    // Si `main` a avancé, l'avance rapide est impossible : la porter demanderait
    // soit un commit de fusion — ce qu'on veut supprimer — soit un rebase, qui
    // RÉÉCRIT. Le script ne réécrit rien dans le dos de personne.
    const { local } = depot();
    commiter(local, 'b.txt', 'noreply@anthropic.com');
    // quelqu'un d'autre publie sur main entre-temps
    git(local, 'checkout', 'main');
    commiter(local, 'ailleurs.txt', 'noreply@anthropic.com');
    git(local, 'push', 'origin', 'main');
    git(local, 'checkout', 'travaux');

    const r = lancer(local);
    expect(r.code).toBe(2);
    expect(r.sortie).toMatch(/rebase/);
    expect(r.sortie, 'il dit ce qui s’est passé, pas seulement « échec »').toMatch(/ancêtre/i);
  });

  it.runIf(POSIX)('`--essai` NE POUSSE RIEN', { timeout: 60_000 }, () => {
    // Un essai qui pousserait quand même serait la pire des trahisons : on le
    // lance justement pour regarder sans risque.
    const { local } = depot();
    commiter(local, 'b.txt', 'noreply@anthropic.com');
    const avant = git(local, 'rev-parse', 'origin/main').trim();
    const r = lancer(local, '--essai');
    expect(r.code).toBe(0);
    expect(r.sortie).toMatch(/essai/i);
    git(local, 'fetch', 'origin', 'main');
    expect(git(local, 'rev-parse', 'origin/main').trim(), 'origin/main a bougé !').toBe(avant);
  });

  it.runIf(POSIX)(
    'LE CAS NOMINAL : `main` avance SANS commit de fusion',
    { timeout: 60_000 },
    () => {
      // ─── L'ASSERTION QUI PORTE LE FICHIER ────────────────────────────────
      //
      // Après coup, `main` porte le commit qu'on a écrit — et RIEN DE PLUS.
      // Aucun commit de fusion, donc aucun committer à corriger. C'est tout
      // l'objet de l'exercice, et ça se vérifie en comptant.
      const { local } = depot();
      commiter(local, 'b.txt', 'noreply@anthropic.com');
      const tete = git(local, 'rev-parse', 'HEAD').trim();

      const r = lancer(local);
      expect(r.code, r.sortie).toBe(0);

      git(local, 'fetch', 'origin', 'main');
      expect(
        git(local, 'rev-parse', 'origin/main').trim(),
        'main doit pointer sur MON commit',
      ).toBe(tete);

      const fusions = git(local, 'log', '--merges', '--format=%h', 'origin/main').trim();
      expect(fusions, 'aucun commit de fusion ne doit exister').toBe('');

      const committers = git(local, 'log', '--format=%ce', 'origin/main')
        .trim()
        .split('\n')
        .filter(Boolean);
      expect([...new Set(committers)]).toEqual(['noreply@anthropic.com']);
    },
  );

  it.runIf(POSIX)('RIEN À PORTER se dit, et ne rate pas', { timeout: 60_000 }, () => {
    // Un « rien à faire » n'est pas un échec. Un script de livraison qui rend
    // un code non nul quand tout va bien finit enveloppé dans un `|| true`,
    // et c'est alors ses VRAIS refus qu'on cesse de voir.
    const { local } = depot();
    const r = lancer(local);
    expect(r.code).toBe(0);
    expect(r.sortie).toMatch(/à jour|rien à porter/i);
  });
});
