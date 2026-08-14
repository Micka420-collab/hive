// La commande d'installation ANNONCÉE — celle que quelqu'un va copier.
//
// ─── LE DÉFAUT, RAPPORTÉ PAR UN UTILISATEUR ──────────────────────────────────
//
// Le README, le README anglais, `docs/INSTALLATION.md` et l'en-tête
// d'`install.ps1` annonçaient tous les quatre :
//
//     irm https://…/install.ps1 | iex
//
// Ça ne pouvait marcher sur AUCUNE machine :
//
//     iex : Au caractère Ligne:53 : 1
//     + [CmdletBinding()]
//     Attribut inattendu « CmdletBinding ».
//     + param(
//     Jeton inattendu « param » dans l'expression ou l'instruction.
//
// `iex` évalue une EXPRESSION ; `param()` n'est valide qu'au début d'un SCRIPT.
// Et même sans ça, `install.ps1` appelle `exit` sept fois : dans un `iex`, `exit`
// s'évalue au niveau de la SESSION et ferme la fenêtre de l'utilisateur — les
// sept codes de sortie, qui sont toute l'interface du script, deviennent
// inobservables.
//
// ─── CE QUE LA CI FAISAIT PENDANT CE TEMPS ───────────────────────────────────
//
// Elle lançait `install.ps1` par `-File`, sous PowerShell 5.1 ET 7, avec des
// assertions sur l'encodage. Tout était vert. **Elle exerçait le script ; elle
// n'exerçait pas la phrase qui dit comment l'appeler.**
//
// C'est la même forme que le shim `.cmd` et que le nœud qui simulait : un
// chemin que personne n'exécute et que tout le monde croit. Un défaut qu'aucune
// suite verte ne pouvait montrer, parce qu'il ne vivait pas dans le code.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// Que la commande annoncée soit celle que la CI exécute, et qu'elle soit
// IDENTIQUE aux quatre endroits. Quatre copies d'une même phrase dérivent —
// c'est la leçon § 9 ter, et ici elles ont dérivé de la RÉALITÉ toutes
// ensemble.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

/** Tous les endroits qui disent à quelqu'un comment installer sous Windows. */
const ANNONCES = ['README.md', 'README.en.md', 'docs/INSTALLATION.md', 'install.ps1'] as const;

// ─── LA PORTÉE, QUI FAISAIT PARTIE DU TROU ───────────────────────────────────
//
// Cette garde est née avec une liste de QUATRE fichiers écrite à la main. Elle
// a tenu ces quatre-là — et `irm … | iex` a survécu dans deux autres, mesurés :
//
//   · MISSION-ACCUEIL.md   § 7.2.1, un document qui dit « tous les points
//                          ci-dessous sont exigés » ;
//   · docs/adr/0002        l'ADR des one-liners eux-mêmes, c'est-à-dire le
//                          dossier de décision de cette question précise.
//
// Une liste écrite à la main garde ce qu'on a pensé à y mettre, le jour où on
// l'a écrite. Elle ne garde rien de ce qui naîtra ensuite. C'est le § 9
// quinoctogies (« la portée d'une garde fait partie de la garde ») appliqué à
// la garde qui existait DÉJÀ pour ce défaut-là.
//
// D'où la bascule : on ne liste plus, on DÉCOUVRE.

const IGNORES = new Set(['node_modules', '.git', 'dist', 'coverage', 'data', '.hive-work']);
const LISIBLES = /\.(md|ps1|sh|ya?ml|html?|tsx?|txt)$/i;

/** Tout fichier du dépôt qui pourrait porter une commande d'installation. */
function fichiersDuDepot(depuis = RACINE, relatif = ''): string[] {
  const trouves: string[] = [];
  for (const e of readdirSync(depuis, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const rel = relatif === '' ? e.name : `${relatif}/${e.name}`;
    if (e.isDirectory()) {
      if (IGNORES.has(e.name)) continue;
      trouves.push(...fichiersDuDepot(path.join(depuis, e.name), rel));
    } else if (LISIBLES.test(e.name)) {
      trouves.push(rel);
    }
  }
  return trouves;
}

/** Le motif fautif, et la RAISON pour laquelle il l'est. */
const TUYAU_FAUTIF = /install\.ps1\s*\|\s*iex/;
const LA_RAISON = /param\(/;

/**
 * Distance, en lignes, entre le motif fautif et l'explication la plus proche.
 *
 * `Infinity` quand le fichier montre la commande sans jamais dire pourquoi elle
 * ne peut pas marcher.
 */
function distanceALaRaison(source: string): number {
  const lignes = source.split('\n');
  const fautives = lignes.flatMap((l, i) => (TUYAU_FAUTIF.test(l) ? [i] : []));
  const raisons = lignes.flatMap((l, i) => (LA_RAISON.test(l) ? [i] : []));
  if (fautives.length === 0) return 0;
  if (raisons.length === 0) return Infinity;
  return Math.max(...fautives.map((f) => Math.min(...raisons.map((r) => Math.abs(r - f)))));
}

/**
 * La borne est MESURÉE, pas choisie. Sur les trois documents qui racontent
 * légitimement le défaut, la cause se trouve à 3 lignes (`ci.yml`), 7
 * (ce fichier-ci) et 10 (`docs/ERREURS.md`). Sur les deux qui l'annonçaient
 * sans rien dire, elle était à l'infini. 15 laisse de la marge au plus éloigné
 * des trois sans rien rapprocher des deux autres.
 */
const PORTEE_DE_L_EXPLICATION = 15;

/** La ligne qui mentionne `install.ps1` et qu'on va copier-coller. */
function commandes(source: string): string[] {
  return source
    .split('\n')
    .map((l) => l.replace(/^#\s*/, '').trim())
    .filter((l) => l.startsWith('irm ') && l.includes('install.ps1'));
}

describe('LA COMMANDE D’INSTALLATION WINDOWS ANNONCÉE', () => {
  it.each(ANNONCES)('%s en annonce exactement une', (f) => {
    // Si l'extraction ne trouve rien, tout le reste de ce fichier passe au vert
    // sans rien vérifier. Une garde qui ne trouve pas sa cible ne garde rien.
    expect(commandes(lire(f)), `commande d’installation introuvable dans ${f}`).toHaveLength(1);
  });

  it('AUCUNE NE TUYAUTE LE SCRIPT DANS `iex`', () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // C'est le défaut exact, rapporté par un utilisateur sur sa machine. Il ne
    // doit pas revenir — et il reviendrait sans bruit : c'est l'idiome que tout
    // le monde connaît, et il est juste pour un script SANS paramètres.
    const fautives = ANNONCES.filter((f) => /install\.ps1\s*\|\s*iex/.test(lire(f)));
    expect(fautives, '`| iex` échoue sur `param()`, et `exit` fermerait la session').toEqual([]);
  });

  it('TOUTES LES QUATRE DISENT LA MÊME CHOSE, AU CARACTÈRE PRÈS', () => {
    // Quatre copies d'une phrase dérivent (§ 9 ter). Ici elles avaient dérivé
    // de la réalité toutes ensemble — mais rien n'empêche qu'on n'en corrige
    // que trois.
    const vues = ANNONCES.map((f) => commandes(lire(f))[0]);
    expect(new Set(vues).size, `versions différentes :\n${[...new Set(vues)].join('\n')}`).toBe(1);
  });

  it('ELLE LANCE UN FICHIER, avec les drapeaux qui la rendent possible', () => {
    const cmd = commandes(lire('README.md'))[0]!;
    // `-OutFile` : on écrit le script sur le disque au lieu de l'évaluer.
    expect(cmd, 'le script doit être téléchargé, pas évalué').toMatch(/-OutFile/);
    // `-File` : c'est ce qui rend `param()` valide et `exit` inoffensif.
    expect(cmd, '`-File` est ce qui fait fonctionner `param()`').toMatch(/-File/);
    // Un `.ps1` sur le disque est soumis à la politique d'exécution — ce qu'un
    // `iex` contournait par construction. L'omettre rendrait la commande
    // refusée sur une machine par défaut.
    expect(cmd, 'sans ça, Windows refuse un `.ps1` téléchargé').toMatch(
      /-ExecutionPolicy\s+Bypass/,
    );
  });

  it('LA CI EXERCE CETTE INVOCATION-LÀ, pas une autre', () => {
    // ─── LE TROU QUI A LAISSÉ PASSER LE DÉFAUT ─────────────────────────────
    //
    // La CI lançait `-File` pendant que la doc annonçait `| iex`. Les deux
    // étaient cohérents avec eux-mêmes et incohérents entre eux, et rien ne
    // regardait l'écart. Cette garde le regarde.
    const ci = lire('.github/workflows/ci.yml');
    const cmd = commandes(lire('README.md'))[0]!;
    for (const drapeau of ['-NoProfile', '-ExecutionPolicy Bypass', '-File']) {
      expect(cmd, `la commande annoncée devrait porter ${drapeau}`).toContain(drapeau);
      expect(ci, `la CI devrait exercer ${drapeau}`).toContain(drapeau);
    }
    // Et sous les DEUX PowerShell : 5.1 est celui que les gens ont.
    expect(ci).toMatch(/pwsh\b/);
    expect(ci).toMatch(/shell: powershell/);
  });
});

describe('`| iex` NE PEUT APPARAÎTRE QU’À CÔTÉ DE LA RAISON QUI LE CONDAMNE', () => {
  const TOUS = fichiersDuDepot();

  it('la découverte ratisse vraiment le dépôt', () => {
    // ─── LA GARDE QUI GARDE LA GARDE ───────────────────────────────────────
    //
    // Une découverte qui ne trouve rien rendrait tout le reste de ce bloc vert
    // sans rien vérifier — exactement le défaut qu'on est en train de fermer,
    // reproduit un cran plus haut. Elle doit donc PROUVER qu'elle voit les
    // fichiers connus, y compris ceux que la liste écrite à la main manquait.
    expect(TOUS.length, 'la marche du dépôt ne ramène presque rien').toBeGreaterThan(100);
    for (const attendu of [
      'README.md',
      'install.ps1',
      'MISSION-ACCUEIL.md',
      'docs/adr/0002-distribution-one-liners.md',
      '.github/workflows/ci.yml',
    ]) {
      expect(TOUS, `la découverte ne voit pas ${attendu}`).toContain(attendu);
    }
  });

  it('aucun fichier ne montre le tuyau fautif sans dire pourquoi il l’est', () => {
    // ─── L'ASSERTION QUI PORTE LE BLOC ─────────────────────────────────────
    //
    // On n'INTERDIT pas le motif : trois documents le citent à bon droit — la
    // CI raconte l'histoire, `docs/ERREURS.md` en tire la leçon, et ce fichier
    // le décrit. Interdire ferait mentir le dossier ; ce qui compte, c'est que
    // personne ne puisse le montrer SEUL.
    //
    // Un ADR ne se réécrit pas : sa section « Contexte » cite fidèlement ce que
    // la mission demandait, et c'est bien qu'elle le fasse. Ce qu'on exige,
    // c'est qu'elle porte la correction à côté.
    const muets = TOUS.filter((f) => distanceALaRaison(lire(f)) > PORTEE_DE_L_EXPLICATION).map(
      (f) => `${f} (cause à ${String(distanceALaRaison(lire(f)))} lignes)`,
    );
    expect(
      muets,
      'ces fichiers montrent `install.ps1 | iex` sans dire que `param()` le rend impossible',
    ).toEqual([]);
  });
});
