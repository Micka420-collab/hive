// LES DEUX INSTALLEURS SONT DES JUMEAUX — ils doivent connaître les mêmes mots.
//
// ─── LE DÉFAUT, MESURÉ ───────────────────────────────────────────────────────
//
// `install.sh` lit trois réglages d'environnement :
//
//     HIVE_DEPOT   dépôt d'où tirer Hive (défaut : GitHub)
//     HIVE_DIR     où installer
//     HIVE_REF     branche ou tag
//
// `install.ps1` n'en lit que DEUX. `HIVE_DEPOT` lui est inconnu.
//
// Ce n'est pas une asymétrie cosmétique :
//
//   · POUR UN UTILISATEUR — quelqu'un qui a forké Hive et veut installer DEPUIS
//     SON FORK peut le faire sous Linux et macOS, et pas sous Windows. Rien ne
//     le lui dit ; le drapeau est simplement ignoré.
//   · POUR LA RUCHE ELLE-MÊME — c'est ce réglage qui permet à la CI d'éprouver
//     L'ARBRE QU'ON VIENT D'ÉCRIRE plutôt que du code déjà fusionné. La jambe
//     « l'installation va jusqu'à une ruche qui répond » s'en sert sous Linux et
//     macOS. Elle ne pouvait pas exister sous Windows : l'essai n'aurait pas su
//     viser la bonne révision.
//
// Autrement dit, le trou du point 3a du point de sortie — « le chemin réel
// d'installation Windows n'est mesuré nulle part » — avait un verrou en amont,
// et c'est celui-ci.
//
// ─── POURQUOI UNE DÉCOUVERTE, ET PAS UNE LISTE ───────────────────────────────
//
// Une liste écrite à la main garde ce qu'on a pensé à y mettre, le jour où on
// l'a écrite (§ 9 quinoctogies : la portée d'une garde fait partie de la garde).
// Le quatrième réglage, celui qu'on ajoutera dans six mois, doit être couvert
// sans que personne n'y repense. On lit donc les DEUX fichiers et on compare les
// ensembles.
//
// ─── ET POURQUOI ON EXIGE UNE LECTURE, PAS UNE MENTION ───────────────────────
//
// Un nom peut apparaître dans un commentaire, dans une ligne d'aide, dans un
// message d'erreur. Aucun de ces trois ne LIT le réglage. La garde cherche donc
// la forme qui le lit vraiment — `$env:NOM` en PowerShell, `$NOM` ou
// `${NOM…}` en shell — pour qu'on ne puisse pas la satisfaire en écrivant une
// phrase.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = process.cwd();
const lire = (f: string): string => readFileSync(path.resolve(RACINE, f), 'utf8');

/** Le source, sans ses lignes de commentaire — les deux langages disent `#`. */
function sansCommentaires(source: string): string {
  return source
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/** Les réglages `HIVE_*` que ce shell LIT vraiment (`$NOM`, `${NOM…}`). */
function luParLeShell(source: string): Set<string> {
  const vus = new Set<string>();
  for (const m of sansCommentaires(source).matchAll(/\$\{?(HIVE_[A-Z_]+)/g)) vus.add(m[1]!);
  return vus;
}

/** Les réglages `HIVE_*` que ce PowerShell LIT vraiment (`$env:NOM`). */
function luParPowerShell(source: string): Set<string> {
  const vus = new Set<string>();
  for (const m of sansCommentaires(source).matchAll(/\$env:(HIVE_[A-Z_]+)/g)) vus.add(m[1]!);
  return vus;
}

const trie = (s: Set<string>): string[] => [...s].sort();

describe('les deux installeurs connaissent les mêmes réglages', () => {
  const POSIX = lire('install.sh');
  const WINDOWS = lire('install.ps1');

  it('la lecture trouve vraiment des réglages des DEUX côtés', () => {
    // Une garde qui ne trouve pas sa cible ne garde rien : si l'un des deux
    // extracteurs rendait l'ensemble vide, la comparaison ci-dessous serait
    // verte en ne comparant rien — ou rouge pour la mauvaise raison.
    expect(trie(luParLeShell(POSIX)), 'aucun réglage lu dans install.sh').not.toEqual([]);
    expect(trie(luParPowerShell(WINDOWS)), 'aucun réglage lu dans install.ps1').not.toEqual([]);
  });

  it('une MENTION ne compte pas — seule une lecture compte', () => {
    // Ce que la garde refuse : qu'on la satisfasse en écrivant le nom quelque
    // part. On le vérifie sur des sources fabriquées, pour que la règle soit
    // éprouvée et pas seulement énoncée.
    expect(luParPowerShell('# HIVE_DEPOT serait bien\n$x = 1').size).toBe(0);
    expect(luParPowerShell("Write-Host 'HIVE_DEPOT'").size).toBe(0);
    // ─── LE CAS QUI DÉPARTAGE VRAIMENT ─────────────────────────────────────
    //
    // Les deux lignes ci-dessus ne prouvent PAS que les commentaires sont
    // écartés : elles n'y écrivent pas la forme qui lit. Mesuré — en retirant
    // le filtre des commentaires, la garde restait verte. Il faut la forme
    // LUE, dans un commentaire, pour que le filtre soit le seul à trancher.
    expect(
      luParPowerShell('# $env:HIVE_FANTOME, un jour peut-être').size,
      'une lecture COMMENTÉE est comptée comme réelle',
    ).toBe(0);
    expect(luParPowerShell('$d = $env:HIVE_DEPOT'), 'une vraie lecture doit compter').toEqual(
      new Set(['HIVE_DEPOT']),
    );
    expect(luParLeShell('# HIVE_DEPOT en commentaire').size).toBe(0);
    expect(
      luParLeShell('# ${HIVE_FANTOME:-x} — envisagé, pas fait').size,
      'une lecture COMMENTÉE est comptée comme réelle',
    ).toBe(0);
    expect(luParLeShell('D="${HIVE_DEPOT:-x}"'), 'une vraie lecture doit compter').toEqual(
      new Set(['HIVE_DEPOT']),
    );
  });

  it('LES DEUX INSTALLEURS LISENT LE MÊME JEU DE RÉGLAGES', () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Un réglage que l'un honore et que l'autre ignore EN SILENCE est un
    // mensonge par omission : l'utilisateur le passe, rien ne proteste, et rien
    // ne se produit. C'est pire qu'une option absente, qui, elle, se signale.
    const surPosix = trie(luParLeShell(POSIX));
    const surWindows = trie(luParPowerShell(WINDOWS));
    const manquantsWindows = surPosix.filter((n) => !surWindows.includes(n));
    const manquantsPosix = surWindows.filter((n) => !surPosix.includes(n));

    expect(
      manquantsWindows,
      `install.ps1 ignore en silence des réglages qu'install.sh honore : ${manquantsWindows.join(', ')}`,
    ).toEqual([]);
    expect(
      manquantsPosix,
      `install.sh ignore en silence des réglages qu'install.ps1 honore : ${manquantsPosix.join(', ')}`,
    ).toEqual([]);
  });

  it('LES TROIS SYSTÈMES ONT CHACUN UNE JAMBE DE SEUIL', () => {
    // ─── LA DÉRIVE QUE CETTE GARDE FERME ───────────────────────────────────
    //
    // Le commentaire du travail `seuil` affirmait que Windows n'avait pas besoin
    // d'y entrer, « PowerShell 7 et 5.1, tous deux déjà exercés AU SEUIL ».
    // C'était vrai de l'INVOCATION et faux du SEUIL : les deux pas Windows
    // lancent `install.ps1 -DryRun`, qui s'arrête avant le clone, avant
    // `npm install`, avant l'installeur.
    //
    // Une phrase juste sur un point et fausse sur l'autre, dans le fichier même
    // qui décide de ce qu'on mesure : c'est la forme exacte des défauts que ce
    // dépôt sort à la chaîne. Rien ne la contredisait, parce que rien ne
    // regardait l'écart entre ce que la CI PROMET et ce qu'elle LANCE.
    //
    // On ne garde pas la prose : on garde les jambes. Chaque système sur lequel
    // le README promet une installation en une commande doit avoir un travail
    // qui la mène jusqu'à une ruche qui répond.
    // ─── ET LA PREMIÈRE VERSION DE CETTE GARDE ÉTAIT FAUSSE ────────────────
    //
    // Elle cherchait le libellé littéral « … · ubuntu-latest » dans le fichier.
    // Or les jambes POSIX passent par une matrice : le fichier ne contient que
    // « … · ${{ matrix.os }} ». La garde exigeait une forme que SEULE la jambe
    // Windows a, et rougissait sur une CI parfaitement correcte.
    //
    // Ce qu'il faut lire, c'est ce que le travail COUVRE : son `runs-on` quand
    // il est littéral, sa liste de matrice quand il en a une.
    const ci = lire('.github/workflows/ci.yml');
    const PROMESSE = "L'installation va jusqu'à une ruche qui répond";
    const couverts = new Set<string>();
    // Un travail = un bloc indenté de deux espaces sous `jobs:`. On découpe
    // là-dessus plutôt que d'analyser tout le YAML : le dépôt n'a pas
    // d'analyseur en dépendance, et en ajouter un pour une garde serait payer
    // cher un problème qui tient en dix lignes.
    for (const bloc of ci.split(/\n(?= {2}[a-z][\w-]*:\n)/)) {
      if (!bloc.includes(PROMESSE)) continue;
      for (const m of bloc.matchAll(/runs-on:\s*([a-z]+-latest)/g)) couverts.add(m[1]!);
      const matrice = /matrix:\s*\n\s*os:\s*\[([^\]]+)\]/.exec(bloc);
      if (matrice) for (const os of matrice[1]!.split(',')) couverts.add(os.trim());
    }

    expect(couverts.size, 'aucune jambe de seuil trouvée : la lecture est cassée').toBeGreaterThan(
      0,
    );
    const manquants = ['ubuntu-latest', 'macos-latest', 'windows-latest'].filter(
      (os) => !couverts.has(os),
    );
    expect(
      manquants,
      `ces systèmes n'ont aucune jambe qui mène l'installation à son terme : ${manquants.join(', ')}`,
    ).toEqual([]);
  });

  it('LES DEUX ESSAIS DE SEUIL MÈNENT LE MÊME PARCOURS', () => {
    // ─── LA DIVERGENCE QUE CETTE GARDE FERME AVANT QU'ELLE N'ARRIVE ────────
    //
    // Les deux essais d'installation s'arrêtaient à « la ruche répond ». Ils
    // vont maintenant jusqu'à « j'ouvre le tableau, je crée mon premier
    // projet » — les deux pas que le point de sortie classait sans aucune
    // mesure.
    //
    // Ces deux pas sont en Node, PARTAGÉS, précisément parce que ce fichier
    // existe : les installeurs avaient déjà divergé en silence, et les réécrire
    // dans les deux langages aurait refait le même trou en plus cher.
    //
    // Mais partager l'instrument ne suffit pas — encore faut-il que les deux
    // s'en servent. Le jour où l'un des deux essais perdrait son appel, sa
    // jambe resterait VERTE en ne mesurant plus que trois pas sur cinq. C'est
    // la forme exacte du défaut d'origine : une couverture qui rétrécit sans
    // que rien ne le dise.
    const INSTRUMENT = 'essai-parcours.mjs';
    const essaiPosix = lire('scripts/essai-installation.sh');
    const essaiWindows = lire('scripts/essai-installation.ps1');

    // Une MENTION ne compte pas, ici non plus : le nom apparaît dans les
    // commentaires des deux fichiers. On exige la forme qui LANCE.
    expect(
      new RegExp(`node[^\\n]*${INSTRUMENT.replace('.', '\\.')}`).test(sansCommentaires(essaiPosix)),
      'scripts/essai-installation.sh ne lance plus le parcours : sa jambe mesure 3 pas sur 5',
    ).toBe(true);
    expect(
      new RegExp(`\\$parcours|${INSTRUMENT.replace('.', '\\.')}`).test(
        sansCommentaires(essaiWindows),
      ),
      'scripts/essai-installation.ps1 ne lance plus le parcours : sa jambe mesure 3 pas sur 5',
    ).toBe(true);

    // Et l'instrument lui-même doit exister — une garde qui vérifie qu'on
    // appelle un fichier absent ne garde rien.
    expect(
      lire(`scripts/${INSTRUMENT}`).length,
      'l’instrument du parcours est vide',
    ).toBeGreaterThan(0);
  });

  it('et TOUT réglage lu est nommé dans la doc d’installation', () => {
    // ─── UN CAS QUI A FAILLI ÊTRE DU DÉCOR ─────────────────────────────────
    //
    // Premier écrit : « chaque installeur contient le nom des réglages qu'il
    // lit ». Toujours vrai par construction — le bloc `param` et l'affectation
    // CONTIENNENT le nom qu'ils lisent. Un cas qui ne peut pas rougir.
    //
    // Ce qui peut rougir, et qui compte pour un arrivant, c'est l'endroit où il
    // va CHERCHER : `docs/INSTALLATION.md`. Mesuré au moment d'écrire ces
    // lignes, la page nommait `HIVE_DIR` et `HIVE_REF`, et pas `HIVE_DEPOT` —
    // pourtant honoré par `install.sh` depuis toujours. Un réglage qui marche et
    // que rien n'annonce n'existe que pour celui qui a lu le code.
    const doc = lire('docs/INSTALLATION.md');
    const tousLesReglages = trie(new Set([...luParLeShell(POSIX), ...luParPowerShell(WINDOWS)]));
    expect(tousLesReglages, 'aucun réglage lu : le cas ne mesure rien').not.toEqual([]);

    const muets = tousLesReglages.filter((r) => !doc.includes(r));
    expect(
      muets,
      `ces réglages sont honorés mais absents de docs/INSTALLATION.md : ${muets.join(', ')}`,
    ).toEqual([]);
  });
});
