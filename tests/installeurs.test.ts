// Les installeurs une-commande — `install.sh` et `install.ps1`.
//
// ─── POURQUOI CES TESTS EXISTENT ─────────────────────────────────────────────
//
// Ces deux scripts sont la PORTE D'ENTRÉE du projet : c'est ce qu'on tuyaute
// dans `sh` ou dans `iex` sans l'avoir lu. Un installeur cassé ne se découvre
// pas en relisant du TypeScript — il se découvre par quelqu'un qui abandonne.
//
// Et ils ont un défaut de naissance : ils vivent hors de la compilation, hors
// du typage, hors de tout. Rien ne les regarde. C'est exactement la forme des
// défauts que ce dépôt a passé sa journée à sortir — une promesse écrite que
// rien n'exerce.
//
// Ce qui est vérifié ICI, et ce qui l'est AILLEURS :
//   · ici : les invariants lisibles sans lancer les scripts, et l'exécution
//     RÉELLE de `install.sh` là où un shell POSIX existe ;
//   · en CI : `install.sh --dry-run` sur Linux et macOS, `install.ps1 -DryRun`
//     sous Windows. C'est le workflow qui les exerce pour de vrai, sur les
//     trois plateformes.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NODE_MIN, conseilServeur, messagePrerequisNode, nodeSuffisant } from '../src/installer.js';
import { NODE_MINIMUM } from '../src/shared/doctor.js';
import {
  type Capacites,
  BLOCS_HIVE,
  LARGEUR_MAX,
  LARGEUR_MIN_CADRES,
  banniere,
  cadre,
  symbole,
  teinter,
} from '../src/tui/rendu.js';

const RACINE = new URL('..', import.meta.url);
/**
 * La racine EN CHEMIN DE FICHIER — par `fileURLToPath`, jamais `.pathname`.
 *
 * `new URL('.', RACINE).pathname` rend « /D:/a/hive/ » sous Windows, avec une
 * barre AVANT la lettre de lecteur, et un `spawn` qui reçoit ça en `cwd`
 * échoue. Ici la mine DORMAIT : `lancer()` ne part que sous
 * `runIf(shellPosix)`, faux sous Windows. Elle n'en était pas moins amorcée.
 */
const RACINE_CHEMIN = fileURLToPath(RACINE);
const lire = (f: string): string => readFileSync(new URL(f, RACINE), 'utf8');

/** La source sans ses commentaires — sinon la prose ferait passer les gardes. */
const sansCommentaires = (s: string, marque: '#' | '#ps'): string =>
  marque === '#'
    ? s.replace(/^\s*#.*$/gm, '')
    : s.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');

const SH = lire('install.sh');
const PS = lire('install.ps1');
const SH_NU = sansCommentaires(SH, '#');

/**
 * Peut-on lancer `install.sh` DANS SON ENVIRONNEMENT CIBLE ?
 *
 * ─── DEUX CONDITIONS, ET J'AI MIS DEUX RUNS À LES TROUVER ────────────────────
 *
 * 1. Un shell POSIX doit exister. Ma première version lançait `sh` sans poser
 *    la question ; la CI Windows a rendu un `spawn` en échec, code -1.
 *
 * 2. ET la plateforme doit être POSIX. Correction suivante : j'ai sondé la
 *    présence de `sh`… qui EXISTE sous Windows, parce que Git Bash est sur le
 *    PATH des runners GitHub. La sonde disait donc vrai, les tests tournaient,
 *    et ils testaient une configuration QUE PERSONNE N'UTILISE : `install.sh`
 *    vise Linux et macOS ; sous Windows on lance `install.ps1`.
 *
 * Sonder une CAPACITÉ ne suffit pas quand ce qui compte est la CIBLE. Le fait
 * qu'une chose soit possible ne veut pas dire qu'elle est pertinente.
 *
 * La sonde reste au chargement du module : `it.runIf(...)` s'évalue à la
 * COLLECTE, et posée dans un `beforeAll` elle désactiverait tout, partout.
 */
const shellPosix = ((): boolean => {
  if (process.platform === 'win32') return false;
  try {
    execFileSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const PS_NU = sansCommentaires(PS, '#ps');

describe('LES DEUX INSTALLEURS EXISTENT', () => {
  it('à la racine, là où les one-liners du README les cherchent', () => {
    expect(existsSync(new URL('install.sh', RACINE))).toBe(true);
    expect(existsSync(new URL('install.ps1', RACINE))).toBe(true);
  });
});

describe('LA CHARTE VISUELLE EST LA MÊME PARTOUT', () => {
  // ─── POURQUOI CETTE SECTION EXISTE ─────────────────────────────────────────
  //
  // La marque de Hive est ÉCRITE, dans `src/tui/rendu.ts` : un hexagone, un
  // seul accent, un alphabet de cinq symboles, un repli ASCII où chacun fait
  // exactement une colonne. Les deux installeurs ne peuvent pas importer ce
  // module — l'un est du `sh`, l'autre du PowerShell — donc ils le RECOPIENT.
  //
  // Trois copies d'une même vérité divergent le jour où l'une bouge. Ces
  // gardes-ci comparent les installeurs au COMPORTEMENT du module pur, pas à
  // une liste écrite une seconde fois dans le test : si `rendu.ts` change de
  // symbole, ce sont les installeurs qui rougissent, et c'est bien ce qu'on
  // veut.

  /** Un terminal capable, tel que le module pur le décrit. */
  const capable: Capacites = {
    couleur: 256,
    unicode: true,
    cadres: true,
    interactif: false,
    largeur: LARGEUR_MAX,
  };
  const pauvre: Capacites = { ...capable, couleur: 0, unicode: false };

  it('LA MARQUE EN BLOCS EST LA MÊME DES DEUX CÔTÉS', () => {
    // ─── DEUX MARQUES POUR UN PRODUIT, C'EST ZÉRO MARQUE ────────────────────
    //
    // `src/tui/rendu.ts` dessine « HIVE » en demi-blocs ; `install.sh` montrait
    // un titre d'une ligne — sur le MÊME terminal, la même machine, la même
    // installation. Et c'était le chemin le PLUS fréquenté qui était en retard :
    // `install.sh` est ce qu'on voit en premier du projet.
    //
    // Cette garde compare les trois lignes du script au tableau du module. Elle
    // ne recopie pas le dessin dans le test : une troisième copie divergerait
    // à son tour.
    for (const [i, ligne] of BLOCS_HIVE.entries()) {
      expect(
        SH,
        `install.sh : BLOC_${String(i + 1)} devrait valoir la ligne ${String(i + 1)} de BLOCS_HIVE`,
      ).toContain(`BLOC_${String(i + 1)}='${ligne}'`);
      // Et le troisième porteur de la marque. Deux copies confrontées à
      // l'original valent mieux que deux copies confrontées l'une à l'autre :
      // celles-là peuvent dériver ENSEMBLE.
      expect(PS, `install.ps1 : ligne ${String(i + 1)} de la marque`).toContain(`'${ligne}'`);
    }
  });

  it('les trois conditions d’affichage de la marque sont les mêmes', () => {
    // Le module exige Unicode, cadres ET couleur vraie. Si le script se
    // contentait de l'Unicode, le même terminal verrait des blocs d'un côté et
    // un titre de l'autre — une divergence qu'aucun des deux ne signalerait.
    expect(SH, 'install.sh doit lire COLORTERM, la seule annonce fiable du 24 bits').toMatch(
      /COLORTERM/,
    );
    expect(SH, 'install.sh doit exiger les trois conditions à la fois').toMatch(
      /UNICODE" = 1 \] && \[ "\$VRAIE_COULEUR" = 1 \]/,
    );
  });

  it('les cinq symboles, et leur repli, sont ceux du module pur', () => {
    for (const [etat, ou] of [
      ['fait', 'S_FAIT'],
      ['curseur', 'S_CURSEUR'],
      ['avenir', 'S_AVENIR'],
      ['alerte', 'S_ALERTE'],
      ['echec', 'S_ECHEC'],
    ] as const) {
      const unicode = symbole(etat, capable);
      const ascii = symbole(etat, pauvre);
      expect(SH, `install.sh : ${ou} devrait valoir « ${unicode} »`).toContain(
        `${ou}='${unicode}'`,
      );
      expect(SH, `install.sh : repli de ${ou} devrait valoir « ${ascii} »`).toContain(
        `${ou}='${ascii}'`,
      );
      const cle = ou.replace('S_', '').toLowerCase();
      const clePs = {
        fait: 'fait',
        curseur: 'curseur',
        avenir: 'avenir',
        alerte: 'alerte',
        echec: 'echec',
      }[cle as 'fait' | 'curseur' | 'avenir' | 'alerte' | 'echec'];
      expect(PS, `install.ps1 : ${clePs} devrait valoir « ${unicode} »`).toContain(
        `${clePs} = '${unicode}'`,
      );
      expect(PS, `install.ps1 : repli de ${clePs}`).toContain(`${clePs} = '${ascii}'`);
    }
  });

  it('les bordures de cadre sont celles du module pur', () => {
    // On demande un cadre au module et on en extrait les caractères, plutôt
    // que de les réécrire ici : une troisième copie serait une troisième
    // vérité à tenir.
    const [hautU] = cadre(['x'], capable);
    const [hautA] = cadre(['x'], pauvre);
    for (const [nom, u, a] of [
      ['B_HG', hautU![0]!, hautA![0]!],
      ['B_H', hautU![1]!, hautA![1]!],
    ] as const) {
      expect(SH, `install.sh : ${nom}`).toContain(`${nom}='${u}'`);
      expect(SH, `install.sh : repli de ${nom}`).toContain(`${nom}='${a}'`);
    }
    expect(PS).toContain(`hg = '${hautU![0]!}'`);
    expect(PS).toContain(`h = '${hautU![1]!}'`);
  });

  it('LA BANNIÈRE EST LA MÊME MARQUE — hexagone, nom espacé, sous-titre', () => {
    const officielle = banniere('0.0.0', capable).join('\n');
    // On ne compare pas les lignes caractère par caractère : la bannière du
    // module porte un numéro de version, celle des installeurs porte
    // « installation » — à cet instant, le dépôt n'est pas encore là pour en
    // donner un. Ce qui doit coïncider, c'est la MARQUE.
    for (const morceau of ['⬡', 'H I V E', "Orchestration communautaire d'agents IA"]) {
      expect(officielle, `le module pur ne rend plus « ${morceau} »`).toContain(morceau);
      expect(SH, `install.sh a perdu « ${morceau} »`).toContain(morceau);
      expect(PS, `install.ps1 a perdu « ${morceau} »`).toContain(morceau);
    }
    // Et le repli ASCII de l'hexagone, qui doit tenir en deux colonnes.
    const replié = banniere('0.0.0', pauvre).join('\n');
    expect(replié).toContain('<>');
    expect(SH).toContain("HEXAGONE='<>'");
    expect(PS).toContain("HEXAGONE = '<>'");
  });

  it('UN SEUL ACCENT, ET C’EST L’AMBRE — la charte §6.1', () => {
    // « Deux accents, c'est zéro accent — plus rien ne ressort. »
    //
    // Les installeurs peignaient en vert, jaune, rouge et blanc. C'est la
    // faute la plus facile à commettre et la plus difficile à voir : chaque
    // couleur prise isolément semble justifiée.
    const ambre256 = teinter('X', 'accent', capable);
    const ambre16 = teinter('X', 'accent', { ...capable, couleur: 16 });
    expect(ambre256, 'le module pur a changé d’ambre').toContain('38;5;214');
    expect(ambre16).toContain('[33m');

    expect(SH, 'install.sh n’utilise plus l’ambre 256 du module').toContain('38;5;214');
    expect(PS, 'install.ps1 n’utilise plus l’ambre 256 du module').toContain('38;5;214');

    // AUCUNE autre couleur. On regarde la source NUE : un `#` de commentaire
    // qui parlerait de vert ne doit pas faire rougir.
    for (const [nom, nu] of [
      ['install.sh', SH_NU],
      ['install.ps1', PS_NU],
    ] as const) {
      expect(nu, `${nom} : rouge ANSI`).not.toMatch(/\\033\[31m|\[31m/);
      expect(nu, `${nom} : vert ANSI`).not.toMatch(/\\033\[32m|\[32m/);
    }
    expect(PS_NU, 'install.ps1 : couleur de console interdite').not.toMatch(
      /-ForegroundColor\s+(Green|Red|Yellow|White|Cyan|Magenta|Blue)/,
    );
  });

  it('les deux seuils de largeur sont ceux du module pur', () => {
    expect(SH, 'install.sh : LARGEUR').toContain(`LARGEUR=${LARGEUR_MAX}`);
    expect(SH, 'install.sh : seuil des cadres').toContain(`-ge ${LARGEUR_MIN_CADRES}`);
    expect(PS, 'install.ps1 : LARGEUR_MAX').toContain(`$LARGEUR_MAX = ${LARGEUR_MAX}`);
    expect(PS, 'install.ps1 : seuil des cadres').toContain(
      `$LARGEUR_MIN_CADRES = ${LARGEUR_MIN_CADRES}`,
    );
  });

  it('`install.ps1` POSE L’ENCODAGE DE LA CONSOLE — sans quoi tout sort en « ? »', () => {
    // Une console PowerShell 5.1 démarre en page de codes 850 ou 437. Le plus
    // beau des cadres y sort en « ????? » : un dessin invisible et une
    // impression de logiciel cassé, ce qui est pire que pas de dessin du tout.
    //
    // C'est le pendant du BOM : l'un fait que PowerShell LIT bien ce fichier,
    // l'autre fait que la console AFFICHE bien ce qu'il écrit.
    expect(PS_NU).toMatch(/\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8/);
    // Et si le système refuse, on retombe sur l'alphabet ASCII plutôt que
    // d'écrire des caractères que la console ne sait pas rendre.
    expect(PS_NU).toMatch(/\$Unicode\s*=\s*\$false/);
  });
});

describe('`install.ps1` COMMENCE PAR UN BOM UTF-8', () => {
  // ─── UNE GARDE POUR TROIS OCTETS QUI NE SE VOIENT PAS ──────────────────────
  //
  // Windows PowerShell 5.1 — `powershell.exe`, celui qui est livré avec l'OS et
  // que `#Requires -Version 5.1` prétend servir — décode un fichier SANS BOM
  // avec la page ANSI. « détecté » devient « dÃ©tectÃ© », « — » devient
  // « â€” », l'abeille disparaît. PowerShell 7 suppose UTF-8, donc la CI
  // passait au vert sans que rien ne se voie : le pas ne lançait que `pwsh`.
  //
  // Mesuré, pas supposé : `install.ps1` relu en cp1252 rend bien du charabia.
  // La CI le vérifie maintenant en lançant 5.1 POUR DE VRAI, et refuse une
  // sortie contenant « Ã » — signature d'un UTF-8 relu en ANSI.
  //
  // Cette garde-ci existe parce qu'un BOM est INVISIBLE. Aucune relecture ne
  // remarque sa disparition, et le premier éditeur qui réenregistre le fichier
  // « sans rien changer » peut l'ôter.

  // ─── ET LA PORTÉE, QUI FAISAIT PARTIE DU DÉFAUT ────────────────────────────
  //
  // Cette garde nommait `install.ps1` À LA MAIN. Le jour où un SECOND fichier
  // PowerShell est né — `scripts/essai-installation.ps1`, l'essai du seuil
  // Windows — il est entré sans BOM, sans que rien ne bronche.
  //
  // La CI l'a dit à sa façon, en refusant de démarrer :
  //
  //     + ... ssai non concluant â€” le port par dÃ©faut Ã©tait tenu sur le runner"
  //     The string is missing the terminator: ".
  //
  // 5.1 avait décodé le fichier en ANSI ; le tiret cadratin y devient trois
  // octets dont un GUILLEMET, et l'analyse syntaxique meurt avant la première
  // instruction. Le mojibake n'était donc pas cosmétique : il empêchait le
  // script d'exister.
  //
  // C'est le § 9 quinoctogies pour la troisième fois — la portée d'une garde
  // fait partie de la garde. On ne liste plus : on DÉCOUVRE.
  const RACINE_FS = process.cwd();
  const IGNORES = new Set(['node_modules', '.git', 'dist', 'coverage', 'data', '.hive-work']);

  function tousLes(extension: string, depuis = RACINE_FS, relatif = ''): string[] {
    const trouves: string[] = [];
    for (const e of readdirSync(depuis, { withFileTypes: true })) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const rel = relatif === '' ? e.name : `${relatif}/${e.name}`;
      if (e.isDirectory()) {
        if (IGNORES.has(e.name)) continue;
        trouves.push(...tousLes(extension, path.join(depuis, e.name), rel));
      } else if (e.name.endsWith(extension)) {
        trouves.push(rel);
      }
    }
    return trouves;
  }

  const aLeBom = (f: string): boolean => {
    const o = readFileSync(path.resolve(RACINE_FS, f));
    return o[0] === 0xef && o[1] === 0xbb && o[2] === 0xbf;
  };

  it('la découverte voit vraiment les fichiers PowerShell du dépôt', () => {
    // Une découverte qui ne trouve rien rendrait la garde suivante verte sans
    // rien regarder — le défaut qu'on est en train de fermer, un cran plus haut.
    const ps = tousLes('.ps1');
    expect(ps, 'la marche du dépôt ne voit pas install.ps1').toContain('install.ps1');
    expect(ps.length, 'un seul .ps1 trouvé : la découverte est trop étroite').toBeGreaterThan(1);
  });

  it('TOUT fichier .ps1 du dépôt commence par EF BB BF', () => {
    const sansBom = tousLes('.ps1').filter((f) => !aLeBom(f));
    expect(
      sansBom,
      `PowerShell 5.1 lira ces fichiers en ANSI : mojibake, et l’analyse syntaxique peut en mourir — ${sansBom.join(', ')}`,
    ).toEqual([]);
  });

  it('AUCUNE apostrophe TYPOGRAPHIQUE dans une ligne de code PowerShell', () => {
    // ─── LE SECOND DÉFAUT, DISTINCT DU BOM, ET INVISIBLE SANS EXÉCUTION ────
    //
    // Le BOM posé, la jambe Windows a rougi une SECONDE fois — pour une autre
    // raison :
    //
    //     + ...  (la permission 0600 n’a PAS d’équivalent Windows — voir …)'
    //     The Try statement is missing its Catch or Finally block.
    //     Unexpected token ')' in expression or statement.
    //
    // PowerShell traite les apostrophes COURBES (U+2018, U+2019) comme des
    // délimiteurs de chaîne, exactement comme l'apostrophe droite. Dans
    // « n’a PAS d’équivalent », la chaîne se referme au milieu du mot, le reste
    // de la ligne devient du code, et le fichier ENTIER cesse d'être
    // analysable.
    //
    // Rien ne le voit à la lecture : le texte est parfaitement correct en
    // français, et un éditeur qui « corrige » les apostrophes en typographiques
    // casserait le script sans qu'aucun caractère ne paraisse suspect.
    //
    // Les COMMENTAIRES, eux, peuvent tout se permettre : PowerShell ignore la
    // ligne entière après un `#`, et l'intérieur d'un bloc `<# … #>`.
    const fautives: string[] = [];
    for (const f of tousLes('.ps1')) {
      let dansBloc = false;
      readFileSync(path.resolve(RACINE_FS, f), 'utf8')
        .split('\n')
        .forEach((ligne, i) => {
          const ouvre = /<#/.test(ligne);
          if (ouvre) dansBloc = true;
          const estDuCode = !dansBloc && !/^\s*#/.test(ligne);
          if (/#>/.test(ligne)) dansBloc = false;
          if (estDuCode && /[\u2018\u2019]/.test(ligne)) {
            fautives.push(`${f}:${i + 1} ${ligne.trim().slice(0, 60)}`);
          }
        });
    }
    expect(
      fautives,
      'PowerShell referme une chaîne sur une apostrophe courbe : ces lignes rendent le fichier inanalysable',
    ).toEqual([]);
  });

  it('…et AUCUN fichier .sh n’en a', () => {
    // Symétrie inverse, et elle compte : un BOM en tête d'un script `sh` est
    // envoyé à l'interpréteur AVANT le `#!`. Le noyau ne reconnaît plus le
    // shebang, et l'on obtient un « command not found » sur la première ligne.
    const avecBom = tousLes('.sh').filter(aLeBom);
    expect(avecBom, `un BOM casserait le shebang de : ${avecBom.join(', ')}`).toEqual([]);
  });
});

describe('LE PLANCHER DE NODE N’EXISTE QU’UNE FOIS — en SIX endroits', () => {
  // ─── LE PIÈGE QUE CETTE GARDE FERME ────────────────────────────────────────
  //
  // La version minimale de Node est écrite plusieurs fois : `NODE_MINIMUM` dans
  // le module pur, `engines.node` dans le paquet, et une constante dans chacun
  // des deux installeurs. Ces derniers ne sont ni typés ni compilés : rien ne
  // les relierait aux trois autres.
  //
  // Ce dépôt a DÉJÀ payé cette divergence une fois, sur la liste des paquets
  // de la ruche complète (`RUCHE_COMPLETE`). Le jour où elles divergent, un
  // installeur laisse passer une version que la ruche refusera ensuite — et
  // la personne se retrouve avec une installation « réussie » qui ne démarre
  // pas.
  //
  // ─── ET LE PIÈGE QU'ELLE A LAISSÉ PASSER ───────────────────────────────────
  //
  // Ce bloc s'intitulait « en quatre endroits ». Il y en avait SIX. Les deux
  // oubliés vivaient dans `src/` — donc typés, donc compilés, donc réputés
  // sûrs : `NODE_MIN` dans `src/installer.ts`, qui valait **20** sous un
  // commentaire affirmant « telle que le `package.json` la déclare » ; et la
  // ligne « nvm install 20 » que l'installeur affiche à qui est bloqué,
  // c'est-à-dire la commande exacte pour le rester.
  //
  // Le prix, mesuré en lançant les DEUX chemins sur la même machine (Node 22) :
  //
  //   · `sh install.sh`        → refus, code 2, « Hive exige 24 ou plus »
  //   · `npm run install:hive` → « ✔ Node v22.22.2 (20 minimum) », .env écrit,
  //                               « Lancer la ruche : npm run dev »
  //
  // Une installation « réussie » sur une machine où `better-sqlite3` n'a pas de
  // binaire prébuilt : la panne de l'image morte, atteinte par l'autre porte.
  //
  // Une garde qui compte les copies doit les compter TOUTES — et la seule
  // manière de ne pas se tromper est que les copies de `src/` soient IMPORTÉES,
  // pas relues. C'est maintenant le cas : `NODE_MIN` vaut `NODE_MINIMUM`.

  it('`NODE_MIN` de l’installeur EST `NODE_MINIMUM` — le cinquième endroit', () => {
    expect(NODE_MIN).toBe(NODE_MINIMUM);
    // L'assertion qui compte vraiment : le COMPORTEMENT. Les tests existants
    // s'écrivaient tous en fonction de `NODE_MIN` lui-même
    // (`nodeSuffisant(\`v${NODE_MIN}.0.0\`)`), donc restaient verts pour 20
    // comme pour 24 — un miroir, pas une garde.
    expect(nodeSuffisant(`v${NODE_MINIMUM - 1}.99.0`), 'accepte une version trop vieille').toBe(
      false,
    );
    expect(nodeSuffisant(`v${NODE_MINIMUM}.0.0`)).toBe(true);
  });

  it('LA COMMANDE DE SECOURS N’ENVOIE PAS VERS UNE VERSION PÉRIMÉE', () => {
    // Le sixième endroit, et le SEUL que la personne bloquée copie. Il disait
    // « nvm install 20 » : suivre l'installeur à la lettre laissait bloqué.
    //
    // La première version de ce test relisait la source de `installer-main.ts`
    // — et rougissait sur la mention « nvm install 20 » écrite dans le
    // commentaire qui racontait le défaut. Un test qui rougit sur un
    // commentaire est un test qu'on apprend à contourner. Le message est donc
    // sorti dans le module pur, et c'est LUI qu'on lit.
    const message = messagePrerequisNode('v20.11.0').join('\n');
    for (const m of message.matchAll(/nvm install (\d+)/g)) {
      expect(Number(m[1]), `« ${m[0]} » ne suit plus NODE_MINIMUM`).toBe(NODE_MINIMUM);
    }
    expect(message).toContain(`nvm install ${NODE_MINIMUM}`);
    // Et il nomme la version qu'on a, sinon « trop vieux » ne dit pas
    // laquelle il faut changer.
    expect(message).toContain('v20.11.0');
  });

  it('install.sh exige la MÊME version que `NODE_MINIMUM`', () => {
    const m = /NODE_MIN=(\d+)/.exec(SH_NU);
    expect(m, 'NODE_MIN introuvable dans install.sh').toBeTruthy();
    expect(Number(m?.[1])).toBe(NODE_MINIMUM);
  });

  it('install.ps1 exige la MÊME version', () => {
    const m = /\$NODE_MIN\s*=\s*(\d+)/.exec(PS_NU);
    expect(m, '$NODE_MIN introuvable dans install.ps1').toBeTruthy();
    expect(Number(m?.[1])).toBe(NODE_MINIMUM);
  });

  it('…et `engines.node` du paquet aussi', () => {
    const paquet = JSON.parse(lire('package.json')) as { engines?: { node?: string } };
    const m = /(\d+)/.exec(paquet.engines?.node ?? '');
    expect(Number(m?.[1])).toBe(NODE_MINIMUM);
  });
});

describe('CE QU’UN INSTALLEUR NE DOIT JAMAIS FAIRE', () => {
  it('AUCUN des deux ne s’élève en privilèges pour installer', () => {
    // Un script qu'on tuyaute dans `sh` et qui appelle `sudo` demande une
    // confiance qu'il n'a pas méritée. Les seules mentions de `sudo` tolérées
    // sont dans un message qui SUGGÈRE une commande à taper soi-même — jamais
    // dans une commande exécutée.
    //
    // On regarde donc la source NUE : les commentaires et les chaînes
    // d'affichage sont exclus du reproche, l'exécution ne l'est pas.
    for (const ligne of SH_NU.split('\n')) {
      const nu = ligne.trim();
      if (nu.startsWith('dire ') || nu.startsWith('echec ') || nu.startsWith('alerte ')) continue;
      expect(nu, 'sudo exécuté dans install.sh').not.toMatch(/(^|[;&|(]\s*)sudo\s/);
    }
    expect(PS_NU, 'élévation dans install.ps1').not.toMatch(/Start-Process.*-Verb\s+RunAs/i);
  });

  it('aucun des deux n’installe Node à la place de la personne', () => {
    // On DIT la commande, on ne la lance pas. Toucher au gestionnaire de
    // paquets d'une machine qu'on ne connaît pas, en aveugle, est le genre de
    // geste qui fait qu'on ne devrait pas exécuter le script.
    for (const [nom, nu] of [
      ['install.sh', SH_NU],
      ['install.ps1', PS_NU],
    ] as const) {
      expect(nu, `${nom} lance winget`).not.toMatch(/^\s*winget\s+install/m);
      expect(nu, `${nom} lance apt`).not.toMatch(/^\s*(sudo\s+)?apt(-get)?\s+install/m);
      expect(nu, `${nom} lance brew`).not.toMatch(/^\s*brew\s+install/m);
    }
  });

  it('install.ps1 ne passe AUCUN guillemet double à une commande native', () => {
    // ─── CE QUE WINDOWS POWERSHELL 5.1 FAIT DES ARGUMENTS ────────────────────
    //
    // 5.1 réécrit les arguments d'une commande native avec ses propres règles,
    // et MANGE les guillemets doubles qu'ils contiennent. PowerShell 7.3 a
    // corrigé ce passage d'arguments ; 5.1 ne le sera jamais — c'est le
    // composant du système, pas une application qu'on met à jour.
    //
    // Le défaut vécu : `node -p 'process.versions.node.split(".")[0]'`.
    // Impeccable sous `pwsh`. Sous 5.1, Node recevait
    // `process.versions.node.split(.)[0]` et rendait « [eval]:1 SyntaxError ».
    // Comme `$ErrorActionPreference` vaut `Stop`, la sortie d'erreur native
    // devient une exception : l'installeur mourait à sa TOUTE PREMIÈRE
    // vérification, sous l'interpréteur que la plupart des gens ont.
    //
    // On juge L'EXÉCUTION, pas l'affichage — même partage que la garde `sudo`
    // plus haut. Une ligne qui MONTRE une commande à taper n'invoque rien.
    //
    // (Première version de ce test : une regex qui traversait les retours à la
    //  ligne. Elle a attrapé un `Dire "… npm run install:hive …"` et rougi pour
    //  la mauvaise raison. Une garde qui se trompe de sujet est une garde qui
    //  sera désactivée le jour où elle gênera.)
    const affichage = /^\s*(Dire|Ok|Echec|Alerte|Etape|Write-Host)\b/;
    let vus = 0;
    for (const ligne of PS_NU.split('\n')) {
      if (affichage.test(ligne)) continue;
      const natif = /\b(node|npm|git)\b/.exec(ligne);
      if (!natif) continue;
      for (const arg of ligne.matchAll(/'([^'\n]*)'/g)) {
        vus++;
        expect(
          arg[1],
          `argument simple-quoté de \`${natif[1]}\` contenant un guillemet ` +
            `double : Windows PowerShell 5.1 le mangera — ${ligne.trim()}`,
        ).not.toMatch(/"/);
      }
    }
    // SANS CECI, LA GARDE EST DÉCOR. Si un remaniement retirait le seul
    // argument simple-quoté du script, la boucle ne tournerait plus et le test
    // resterait vert en n'ayant rien regardé — c'est le § 1.2 de `ERREURS.md`.
    expect(vus, 'aucun argument natif inspecté : la garde ne regarde plus rien').toBeGreaterThan(0);
  });

  it('les deux passent la main à l’installeur du projet, sans le réécrire', () => {
    // Dupliquer ici la génération du jeton, l'écriture du `.env` en 600 et la
    // détection d'agent ferait DEUX installeurs à maintenir — dont un que rien
    // ne teste. Celui du projet est testé par `tests/installer.test.ts`.
    expect(SH_NU).toMatch(/npm run install:hive/);
    expect(PS_NU).toMatch(/npm run install:hive/);
  });
});

describe('`install.sh` LANCÉ POUR DE VRAI', () => {
  // Pas une lecture : une exécution. C'est la règle n° 1 de `docs/ERREURS.md`,
  // et elle est née d'un `require()` en ESM qui rendait `null` pour toujours
  // sans que trois relectures le voient.
  //
  // ─── CE QUI SE VÉRIFIE OÙ ──────────────────────────────────────────────────
  //
  // `install.sh` est un script POSIX : il ne s'exécute pas sous Windows, et
  // c'est normal — Windows a `install.ps1`. La couverture est donc RÉPARTIE,
  // pas trouée :
  //   · ici, sur Linux et macOS : `install.sh` lancé pour de vrai ;
  //   · en CI sous Windows : `install.ps1 -DryRun`, par un pas du workflow ;
  //   · partout : les gardes sur la source des DEUX scripts, plus haut.

  it('cette machine a-t-elle un shell POSIX ? — la question doit être posée', () => {
    if (!shellPosix) {
      console.warn(
        '⚠ `install.sh` n’est PAS exécuté ici : ce n’est pas sa plateforme cible. ' +
          'Il l’est sur Linux et macOS à chaque CI, et `install.ps1` est exercé ' +
          'sous Windows par un pas du workflow.',
      );
    }
    // SUR POSIX, LA SONDE DOIT DIRE OUI. Sans cette assertion, une sonde
    // cassée désactiverait ces tests partout et la suite resterait verte —
    // c'est déjà arrivé dans ce dépôt, sur les gardes du miroir.
    if (process.platform !== 'win32') {
      expect(shellPosix, 'un système POSIX doit avoir `sh`').toBe(true);
    }
  });

  const lancer = (args: string[], chemin?: string): { code: number; sortie: string } => {
    try {
      const sortie = execFileSync('sh', ['install.sh', ...args], {
        cwd: RACINE_CHEMIN,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', ...(chemin ? { PATH: chemin } : {}) },
      });
      return { code: 0, sortie };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it.runIf(shellPosix)('`--help` sort en 0 et explique les drapeaux', () => {
    const { code, sortie } = lancer(['--help']);
    expect(code).toBe(0);
    expect(sortie).toMatch(/--dir/);
    expect(sortie).toMatch(/--dry-run/);
  });

  it.runIf(shellPosix)('`--dry-run` N’ÉCRIT RIEN — pas même le dossier de destination', () => {
    // ─── POURQUOI CE TEST FABRIQUE UN FAUX `node` ────────────────────────────
    //
    // Première version : on lançait `install.sh --dry-run` tel quel. Elle
    // passait — et pour la MAUVAISE raison. Cette machine tourne sous le
    // plancher de Node, donc le script sortait au contrôle de version AVANT
    // d'atteindre le clone. Le chemin `--dry-run` n'était jamais observé.
    //
    // Prouvé par mutation : en faisant cloner `--dry-run` de force, le test
    // restait VERT. C'est le défaut § 2 de `docs/ERREURS.md`, commis dans le
    // test censé le prévenir.
    //
    // On pose donc la couture : un `node` factice, en tête de PATH, qui
    // annonce une version suffisante. Le script franchit alors le contrôle et
    // le vrai comportement de `--dry-run` devient observable — sur n'importe
    // quelle machine, quelle que soit sa version de Node.
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-inst-'));
    const cible = path.join(bac, 'ruche');
    const faux = path.join(bac, 'bin');
    try {
      mkdirSync(faux, { recursive: true });
      writeFileSync(path.join(faux, 'node'), `#!/bin/sh\necho ${NODE_MINIMUM}\n`, { mode: 0o755 });

      const chemin = [faux, process.env.PATH ?? ''].join(path.delimiter);
      const r = lancer(['--dry-run', `--dir=${cible}`], chemin);
      expect(r.code, `--dry-run devrait aboutir :\n${r.sortie}`).toBe(0);
      // La garantie qui fait qu'on ose lancer un script inconnu.
      expect(existsSync(cible), '--dry-run a créé le dossier').toBe(false);
      // Et il DIT ce qu'il aurait fait, sinon « rien écrit » n'apprend rien.
      expect(r.sortie).toMatch(/serait cloné/);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it.runIf(shellPosix)('LA COMMANDE QU’IL AFFICHE EST CELLE QU’IL LANCERAIT', () => {
    // ─── LE DÉFAUT QUE CE TEST FERME, TROUVÉ EN LISANT UN JOURNAL DE CI ──────
    //
    // `--dry-run` finit par « sans --dry-run, la suite serait : … ». Cette
    // ligne affichait :
    //
    //     cd … && npm run install:hive --dry-run
    //
    // alors que l'appel réel, vingt lignes plus bas, est :
    //
    //     npm run install:hive -- --dry-run
    //
    // Le `--` manquait. Sans lui, npm GARDE le drapeau pour lui — et npm a son
    // propre `--dry-run` : la commande copiée depuis cet écran ne lançait donc
    // pas l'installeur du tout. Une ligne qui dit « voilà ce qui va se passer »
    // et qui se trompe est pire que pas de ligne.
    //
    // Aucune relecture ne l'a vu, parce qu'à l'œil les deux formes se
    // ressemblent. Ce qui l'a rendu visible, c'est la SORTIE RÉELLE d'un
    // `--dry-run` en CI. D'où ce test : il compare l'affichage à l'appel.
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-inst-'));
    const faux = path.join(bac, 'bin');
    try {
      mkdirSync(faux, { recursive: true });
      writeFileSync(path.join(faux, 'node'), `#!/bin/sh\necho ${NODE_MINIMUM}\n`, { mode: 0o755 });
      const chemin = [faux, process.env.PATH ?? ''].join(path.delimiter);

      // AVEC un argument à transmettre : le `--` doit être là, et séparer.
      const avec = lancer(
        ['--dry-run', `--dir=${path.join(bac, 'r1')}`, '--non-interactive'],
        chemin,
      );
      expect(avec.code, avec.sortie).toBe(0);
      expect(avec.sortie, 'le `--` qui sépare npm de l’installeur manque').toMatch(
        /npm run install:hive -- .*--non-interactive/,
      );

      // SANS argument : pas de `--` pendu dans le vide.
      const sans = lancer(['--dry-run', `--dir=${path.join(bac, 'r2')}`], chemin);
      expect(sans.code, sans.sortie).toBe(0);
      expect(sans.sortie).toMatch(/npm run install:hive\s*$/m);
      expect(sans.sortie, '`--` affiché sans rien à séparer').not.toMatch(
        /npm run install:hive --\s*$/m,
      );
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it('install.ps1 AUSSI n’affiche le `--` que s’il sépare quelque chose', () => {
    // Le pendant du test précédent, en garde de source : `install.ps1` ne
    // s'exécute pas ici (voir la sonde), mais son défaut était SYMÉTRIQUE — un
    // `--` toujours présent, pendu dans le vide quand `$Reste` est vide. Les
    // deux sortaient de la même faute : une ligne d'affichage écrite pour
    // RESSEMBLER à la commande réelle au lieu d'en être dérivée.
    expect(PS_NU, 'la branche « sans arguments » manque').toMatch(
      /if\s*\(\s*\$Reste\s*\)[\s\S]*?npm run install:hive --[\s\S]*?else[\s\S]*?npm run install:hive['"]/,
    );
  });

  it.runIf(shellPosix)('UNE VERSION DE NODE TROP ANCIENNE SORT EN 2, pas en 1', () => {
    // Le code 2 est `PREREQUIS` dans `src/codes-sortie.ts`. La distinction
    // compte pour un script appelant : « il te manque quelque chose » et « ça
    // a planté » appellent des gestes différents.
    //
    // Ce test ne s'exécute que si la machine est SOUS le plancher — sinon il
    // n'aurait rien à observer, et le dire vaut mieux que de le simuler.
    const majeur = Number(process.versions.node.split('.')[0]);
    if (majeur >= NODE_MINIMUM) {
      expect(true, 'machine au-dessus du plancher : cas non observable ici').toBe(true);
      return;
    }
    const { code, sortie } = lancer(['--dry-run', '--dir=/tmp/jamais-cree']);
    expect(code, 'prérequis manquant ⇒ code 2').toBe(2);
    expect(sortie).toMatch(new RegExp(String(NODE_MINIMUM)));
  });
});

describe('le conseil du chemin « serveur » — la survivante qui vivait dans une chaîne', () => {
  it('ENCHAÎNE build PUIS dev : `&&`, jamais `||`', () => {
    // La survivante du balayage loupe du 3 août vivait DANS la chaîne
    // imprimée, en dur dans `installer-main.ts` où aucun test ne pouvait la
    // lire (`main()` court à l'import, le bloc n'existe qu'au clavier).
    // Mutée en `||`, la commande copiée-collée ne lancerait `dev` QUE si le
    // build échoue — un conseil est du code qu'un humain exécute.
    const ligne = conseilServeur().find((l) => l.includes('build:dashboard'));
    expect(ligne, 'la ligne de commande doit exister').toBeDefined();
    expect(ligne).toContain('npm run build:dashboard && npm run dev');
    expect(ligne).not.toContain('||');
  });

  it('les secrets passent par l’environnement — la ligne montre la forme, le texte dit pourquoi', () => {
    const texte = conseilServeur().join('\n');
    expect(texte).toContain('HIVE_TOKEN=… HIVE_JWT_SECRET=… npm run install:hive');
    expect(texte).toContain('jamais en argument');
  });

  it('installer-main CONSOMME la fonction — pas une copie qui divergerait en silence', () => {
    // Sans cette garde, l'extraction serait du décor : le module pur dirait
    // vrai pendant que l'écran continuerait d'imprimer une copie mutée.
    const source = readFileSync(new URL('../src/installer-main.ts', import.meta.url), 'utf8');
    expect([...source.matchAll(/conseilServeur\(\)/g)]).toHaveLength(1);
    expect(source, 'l’ancienne copie en dur doit avoir disparu').not.toContain(
      'build:dashboard &&',
    );
  });
});
