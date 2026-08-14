// Un téléchargement COUPÉ ne doit rien exécuter du tout.
//
// ─── LE DÉFAUT, MESURÉ AVANT D'ÊTRE ÉCRIT ────────────────────────────────────
//
// Le README propose la commande d'entrée de Hive :
//
//     curl -fsSL https://raw.githubusercontent.com/.../install.sh | sh
//
// `sh` ne lit pas le script d'un bloc. Il lit ce qui arrive, l'exécute, et
// redemande la suite. Tant que `install.sh` est une suite d'ordres de PREMIER
// NIVEAU, une coupure du tuyau — wifi qui tombe, mandataire qui expire, CDN qui
// hoquette — laisse derrière elle tout ce qui était déjà arrivé.
//
// Mesuré sur l'arbre, en coupant juste avant le clone :
//
//     head -416 install.sh | sh   →   CODE=0
//
//     +------------------------------------------------------------------+
//     | <>  H I V E                                          installation |
//     +------------------------------------------------------------------+
//       o  Vérification des prérequis
//       |  + Node 24 (≥ 24 exigé)
//       |  + git 2.43.0
//
// **Code 0.** Une bannière, deux coches vertes, et rien d'installé. Un
// utilisateur croit que c'est fini ; un script appelant croit que ça a marché.
// C'est le pire des trois résultats possibles — pire qu'un échec bruyant.
//
// ─── LE REMÈDE, ET CE QU'IL GARANTIT EXACTEMENT ──────────────────────────────
//
// Tout le travail entre dans une fonction, appelée à la DERNIÈRE ligne. `sh` ne
// peut alors rien lancer avant d'avoir lu le fichier entier :
//
//   · coupure DANS le corps       → « end of file unexpected », rien d'exécuté ;
//   · coupure APRÈS la fonction   → la fonction est définie, jamais appelée,
//                                   rien d'exécuté.
//
// La propriété gardée ici est donc « JAMAIS D'EXÉCUTION PARTIELLE », et pas
// « toute coupure est signalée » : couper sur la toute dernière ligne rend
// encore 0 sans rien faire. Ne rien faire est sans danger ; faire la moitié ne
// l'est pas. On garde ce qui est vrai, pas ce qui sonne mieux.
//
// ─── POURQUOI CE BANC NE REGARDE PAS install.ps1 ─────────────────────────────
//
// Le README ne canalise RIEN vers PowerShell : il télécharge dans un fichier
// (`-OutFile`) puis lance `powershell -File`. PowerShell analyse le fichier
// entier avant d'en exécuter la première ligne — la forme de la commande le
// protège déjà. Étendre ce banc à `install.ps1` garderait une propriété que
// personne ne peut casser depuis le chemin recommandé.
//
// ─── POURQUOI IL JOUE VRAIMENT LE SCRIPT ─────────────────────────────────────
//
// Un banc qui chercherait `principal()` dans la source garderait une FORME.
// Celui-ci coupe le fichier et le donne à `sh` par l'entrée standard — le geste
// exact de `curl | sh` — puis regarde ce qui est sorti. C'est le comportement
// qui est gardé, pas l'orthographe.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = readFileSync(path.join(RACINE, 'install.sh'), 'utf8');
const LIGNES = SOURCE.split('\n');

/** Les bacs créés par ce fichier, effacés à la fin quoi qu'il arrive. */
const BACS: string[] = [];

afterAll(() => {
  for (const bac of BACS) rmSync(bac, { recursive: true, force: true });
});

/**
 * Joue un texte de script comme `curl … | sh` le ferait : par l'ENTRÉE
 * STANDARD, sans fichier intermédiaire.
 *
 * Le `PATH` est le vrai — un `PATH` vide priverait le script de `tr` et `wc`,
 * et sa bannière s'effondrerait AVANT d'avoir rien affiché : le banc serait
 * vert pour une raison qui n'a rien à voir avec la coupure (mesuré). Ce qui
 * borne l'exécution ici, c'est le DÉPÔT : `HIVE_DEPOT` désigne un chemin qui
 * n'existe pas, donc le clone échoue sur-le-champ, sans réseau et sans rien
 * écrire. Le script a le droit d'aller aussi loin qu'il le peut ; il ne peut
 * simplement pas aboutir.
 */
function jouer(texte: string): { sortie: string; erreur: string; cible: string } {
  const bac = mkdtempSync(path.join(tmpdir(), 'hive-tuyau-'));
  BACS.push(bac);
  const cible = path.join(bac, 'ruche');
  const r = spawnSync('/bin/sh', ['-s'], {
    input: texte,
    encoding: 'utf8',
    shell: false,
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: bac,
      HIVE_DIR: cible,
      HIVE_DEPOT: path.join(bac, 'depot-qui-n-existe-pas'),
      NO_COLOR: '1',
    },
  });
  return { sortie: r.stdout ?? '', erreur: r.stderr ?? '', cible };
}

/** Le préfixe des `part` premiers pour cent des lignes — un tuyau coupé là. */
function prefixe(part: number): string {
  const n = Math.max(1, Math.floor((LIGNES.length * part) / 100));
  return LIGNES.slice(0, n).join('\n');
}

/** Les points de coupure éprouvés — au-delà de l'en-tête de commentaires. */
const COUPURES = [20, 30, 40, 50, 60, 70, 80, 90, 95, 99] as const;

describe.skipIf(process.platform === 'win32')(
  'UN TÉLÉCHARGEMENT COUPÉ N’EXÉCUTE RIEN (install.sh)',
  () => {
    it.each(COUPURES)('coupé à %i%% des lignes, le script n’écrit rien', (part) => {
      const { sortie, cible } = jouer(prefixe(part));

      // ─── L'ASSERTION QUI PORTE LE FICHIER ────────────────────────────────
      //
      // Pas « le code de sortie est non nul » : couper après la dernière
      // accolade rend 0 légitimement. Ce qui ne doit JAMAIS arriver, c'est
      // qu'un demi-script parle — la bannière, une étape, une coche. Une
      // sortie standard vide est la preuve que rien n'a tourné.
      expect(
        sortie,
        `coupé à ${String(part)} % : le script a parlé, donc il a agi\n${sortie.slice(0, 400)}`,
      ).toBe('');

      // Et il n'a rien posé sur le disque non plus.
      expect(existsSync(cible), `coupé à ${String(part)} % : ${cible} a été créé`).toBe(false);
    });

    it('le script ENTIER, lui, atteint bien son travail', () => {
      // Le pendant indispensable : un `install.sh` qui ne ferait plus rien du
      // tout passerait les dix assertions ci-dessus. Joué en entier dans le
      // même bac nu, il doit au contraire parler — et échouer sur les prérequis
      // manquants, ce qui prouve qu'il est ARRIVÉ jusque-là.
      const { sortie } = jouer(SOURCE);
      expect(sortie, "le script entier n'a rien affiché — il ne fait plus rien").not.toBe('');
      expect(sortie).toMatch(/H I V E/);
    });
  },
);

describe('LA FORME QUI REND CETTE PROPRIÉTÉ TENABLE', () => {
  it('le dernier ordre de install.sh est l’appel, et rien ne le suit', () => {
    // Le banc de comportement ci-dessus attrape la régression ; celui-ci dit
    // POURQUOI en une ligne, et il attrape le geste exact qui la produirait :
    // ajouter « une petite étape de plus » à la fin du fichier, après l'appel.
    const significatives = LIGNES.map((l) => l.trim()).filter(
      (l) => l !== '' && !l.startsWith('#'),
    );
    const dernier = significatives[significatives.length - 1];
    expect(dernier, 'install.sh ne se termine pas par l’appel de « principal »').toBe(
      'principal "$@"',
    );
  });
});
