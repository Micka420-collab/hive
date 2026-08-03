// Le rendu de l'accueil, éprouvé sans terminal.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// `src/tui/rendu.ts` est pur pour une raison très concrète : les cinq
// dégradations du §6.4 de la mission (non-TTY, `NO_COLOR`, `TERM=dumb`, moins
// de 60 colonnes, 200 colonnes) sont exactement celles qu'on ne vérifie jamais
// quand on ne peut pas les tester. On les teste donc ici, par assertion, sans
// jamais ouvrir de terminal.
//
// La garde qui compte est la première : `NO_COLOR` posé ⇒ AUCUN octet `\x1b`
// dans la sortie COMPLÈTE. Elle est exercée sur une page entière, pas fonction
// par fonction — une seule fonction oubliée suffirait à remplir un fichier de
// log de séquences illisibles, et c'est précisément ce genre d'oubli qu'un
// test par fonction laisse passer.

import { describe, expect, it } from 'vitest';
import {
  BLOCS_HIVE,
  CADENCE_SPINNER_MS,
  LARGEUR_MAX,
  LARGEUR_MIN_CADRES,
  SPINNER_ASCII,
  SPINNER_UNICODE,
  aideTouches,
  banniere,
  barreProgression,
  cadre,
  capacites,
  constatEnroule,
  degrade,
  encadreJeton,
  enrouler,
  espacer,
  etapeLineaire,
  imageSpinner,
  largeurVisible,
  ligneVerification,
  menu,
  recapEcritures,
  symbole,
  teinter,
  titreSection,
  tronquer,
  type Capacites,
  type Verification,
} from '../src/tui/rendu.js';

const TTY = { isTTY: true, columns: 100 };

/** Un vrai terminal (cadres, couleur) et un tuyau (ni l'un ni l'autre). */
const ECRAN = capacites({ TERM: 'xterm-256color' }, TTY);
const TUYAU = capacites({ NO_COLOR: '1' }, { isTTY: false, columns: undefined });

const VERIFS: Verification[] = [
  { etat: 'fait', libelle: 'Node v24.8.0', note: '(≥ 24 requis)' },
  { etat: 'fait', libelle: 'Port 7777 libre' },
  { etat: 'fait', libelle: 'Espace disque', valeur: '2,1 Go' },
  { etat: 'fait', libelle: 'Agent de codage', valeur: 'Claude Code' },
  {
    etat: 'avenir',
    libelle: 'Bac à sable',
    valeur: 'podman absent, docker absent  →  mode direct',
  },
];

const CHOIX = [
  { libelle: 'Ouvrir ma propre ruche', aide: 'orchestrateur + dashboard' },
  { libelle: 'Rejoindre une ruche', aide: 'j’ai reçu un billet' },
  { libelle: 'Installer sur un serveur', aide: 'sans écran' },
];

/**
 * Une page complète, telle que le lot 2 l'affichera.
 *
 * Toutes les gardes globales (aucun ANSI, aucun débordement) s'exercent sur
 * CE texte : ajouter un composeur sans le brancher ici serait le sortir de
 * leur portée, ce qui est justement le trou qu'on veut éviter.
 */
function page(caps: Capacites): string[] {
  return espacer(
    banniere('0.2.0', caps),
    titreSection('Vérifications', caps),
    VERIFS.map((v) => (caps.cadres ? ligneVerification(v, caps) : etapeLineaire(v, caps))),
    titreSection('Que voulez-vous faire ?', caps),
    menu(CHOIX, 0, caps),
    aideTouches(caps),
    encadreJeton('a1b2c3d4e5f60718293a4b5c6d7e8f90', caps),
    recapEcritures(['.env', 'data/hive.db'], caps),
  );
}

describe('les capacités du terminal (§6.4)', () => {
  it('SANS TTY : aucune couleur, aucun cadre — c’est ce que lit une CI', () => {
    const caps = capacites({}, { isTTY: false, columns: 100 });
    expect(caps.couleur).toBe(0);
    expect(caps.cadres).toBe(false);
    expect(caps.interactif).toBe(false);
  });

  it('un `stdout` inconnu est traité comme non-TTY', () => {
    // `isTTY` vaut `undefined` sur un flux redirigé. Le prendre pour un
    // terminal remplirait le fichier de destination de séquences ANSI.
    expect(capacites({}, {}).interactif).toBe(false);
    expect(capacites({}, {}).couleur).toBe(0);
  });

  it('NO_COLOR coupe la couleur ET passe les cadres en ASCII', () => {
    const caps = capacites({ NO_COLOR: '1' }, TTY);
    expect(caps.couleur).toBe(0);
    expect(caps.unicode).toBe(false);
    expect(caps.cadres, 'les cadres restent, en ASCII').toBe(true);
  });

  it('NO_COLOR vide ne compte pas (convention no-color.org)', () => {
    expect(capacites({ NO_COLOR: '' }, TTY).couleur).not.toBe(0);
  });

  it('TERM=dumb coupe tout aussi', () => {
    const caps = capacites({ TERM: 'dumb' }, TTY);
    expect(caps.couleur).toBe(0);
    expect(caps.unicode).toBe(false);
  });

  it('SOUS 60 COLONNES, les cadres sont abandonnés', () => {
    expect(capacites({}, { isTTY: true, columns: LARGEUR_MIN_CADRES - 1 }).cadres).toBe(false);
    expect(capacites({}, { isTTY: true, columns: LARGEUR_MIN_CADRES }).cadres).toBe(true);
  });

  it('la largeur est bornée à 76, quelle que soit celle du terminal', () => {
    expect(capacites({}, { isTTY: true, columns: 200 }).largeur).toBe(LARGEUR_MAX);
    expect(capacites({}, { isTTY: true, columns: 64 }).largeur).toBe(64);
  });

  it('REPLI 16 COULEURS quand rien n’annonce la palette 256', () => {
    // ConHost — la console Windows historique — n'affiche pas les 256
    // couleurs. Lui envoyer `\x1b[38;5;214m` ne donne pas de l'ambre
    // approximatif, ça donne du texte illisible.
    expect(capacites({ TERM: 'xterm' }, TTY).couleur).toBe(16);
    expect(capacites({}, TTY).couleur).toBe(16);
    expect(capacites({ TERM: 'xterm-256color' }, TTY).couleur).toBe(256);
    expect(capacites({ WT_SESSION: 'x' }, TTY).couleur).toBe(256);
    expect(capacites({ TERM_PROGRAM: 'vscode' }, TTY).couleur).toBe(256);
  });

  it('LE 24 BITS EST ANNONCÉ, JAMAIS DEVINÉ', () => {
    // ─── LA MÊME PRUDENCE QU'UN CRAN PLUS BAS ──────────────────────────────
    //
    // `COLORTERM` est la seule annonce fiable de la couleur vraie. Un terminal
    // qui ne la sait pas et à qui l'on envoie `\x1b[38;2;…m` n'affiche pas un
    // ambre approximatif : il affiche la séquence en clair au milieu du texte.
    //
    // C'est exactement le raisonnement qui fait replier 256 → 16 sur ConHost.
    // On ne déduit donc PAS le 24 bits de `TERM`, ni de Windows Terminal, ni de
    // VS Code — même si ces deux-là le savent souvent.
    expect(capacites({ COLORTERM: 'truecolor' }, TTY).couleur).toBe(16777216);
    expect(capacites({ COLORTERM: '24bit' }, TTY).couleur).toBe(16777216);
    expect(capacites({ TERM: 'xterm-256color' }, TTY).couleur, 'TERM ne suffit pas').toBe(256);
    expect(capacites({ WT_SESSION: 'x' }, TTY).couleur, 'WT_SESSION ne suffit pas').toBe(256);
  });

  it('FORCE_COLOR a le dernier mot dans les deux sens', () => {
    expect(capacites({ FORCE_COLOR: '0', TERM: 'xterm-256color' }, TTY).couleur).toBe(0);
    expect(capacites({ FORCE_COLOR: '1' }, TTY).couleur).toBe(16);
    expect(capacites({ FORCE_COLOR: '2' }, TTY).couleur).toBe(256);
    // `3` est la convention pour « 24 bits » — et elle DOIT primer sur un
    // COLORTERM absent, sinon on ne pourrait jamais forcer le dégradé.
    expect(capacites({ FORCE_COLOR: '3' }, TTY).couleur).toBe(16777216);
  });
});

describe('LA GARDE : aucun octet d’échappement quand la couleur est coupée', () => {
  const SANS_COULEUR: Array<[string, Capacites]> = [
    ['NO_COLOR', capacites({ NO_COLOR: '1' }, TTY)],
    ['TERM=dumb', capacites({ TERM: 'dumb' }, TTY)],
    ['non-TTY', capacites({ TERM: 'xterm-256color' }, { isTTY: false, columns: 100 })],
    ['FORCE_COLOR=0', capacites({ FORCE_COLOR: '0' }, TTY)],
    ['60 colonnes', capacites({ NO_COLOR: '1' }, { isTTY: true, columns: 60 })],
    ['200 colonnes', capacites({ NO_COLOR: '1' }, { isTTY: true, columns: 200 })],
  ];

  for (const [nom, caps] of SANS_COULEUR) {
    it(`${nom} : la page entière ne contient pas un seul \\x1b`, () => {
      const texte = page(caps).join('\n');
      expect(texte).not.toContain('\x1b');
      // Contrôle négatif : sans lui, une page vide passerait ce test.
      expect(texte).toContain('H I V E');
      expect(texte.length).toBeGreaterThan(200);
    });
  }

  it('avec la couleur, l’accent EST là — sinon le test ci-dessus est vide de sens', () => {
    const texte = page(capacites({ TERM: 'xterm-256color' }, TTY)).join('\n');
    expect(texte).toContain('\x1b[38;5;214m');
  });

  it('en 16 couleurs, c’est le jaune et jamais la séquence 256', () => {
    const texte = page(capacites({ TERM: 'xterm' }, TTY)).join('\n');
    expect(texte).toContain('\x1b[33m');
    expect(texte).not.toContain('38;5;214');
  });
});

describe('rien ne déborde, jamais', () => {
  const LARGEURS = [60, 64, 80, 100, 200];

  for (const colonnes of LARGEURS) {
    it(`à ${colonnes} colonnes, aucune ligne ne dépasse la largeur retenue`, () => {
      const caps = capacites({ TERM: 'xterm-256color' }, { isTTY: true, columns: colonnes });
      for (const ligne of page(caps)) {
        expect(largeurVisible(ligne), `« ${ligne} »`).toBeLessThanOrEqual(caps.largeur);
      }
    });
  }

  it('sous 60 colonnes non plus, cadres abandonnés compris', () => {
    const caps = capacites({}, { isTTY: true, columns: 40 });
    expect(caps.cadres).toBe(false);
    for (const ligne of page(caps)) {
      expect(largeurVisible(ligne), `« ${ligne} »`).toBeLessThanOrEqual(caps.largeur);
    }
  });

  it('UN LIBELLÉ HOSTILE NE CREVE NI LE CADRE NI LE STYLE', () => {
    // Un libellé de billet vient du dehors. `acces.ts` le borne déjà à 120
    // caractères sans caractère de contrôle ; cette garde-ci protège la mise
    // en page, et vérifie surtout qu'une séquence ANSI glissée dans un nom ne
    // repeint pas l'écran de l'hôte.
    const caps = capacites({ TERM: 'xterm-256color' }, TTY);
    const hostile = `\x1b[41m${'très-long-nom-de-machine-'.repeat(20)}`;
    const lignes = [
      ligneVerification({ etat: 'fait', libelle: hostile }, caps),
      ...menu([{ libelle: hostile, aide: hostile }], 0, caps),
      ...cadre([tronquer(hostile, caps.largeur - 4, caps.unicode)], caps),
    ];
    for (const ligne of lignes) {
      expect(largeurVisible(ligne)).toBeLessThanOrEqual(caps.largeur);
      expect(ligne, 'le fond rouge du libellé a fui').not.toContain('\x1b[41m');
    }
  });

  it('un cadre est rectangulaire : toutes ses lignes font la même largeur', () => {
    const caps = capacites({ TERM: 'xterm-256color' }, TTY);
    const lignes = cadre(['court', 'un peu plus long', ''], caps);
    const largeurs = new Set(lignes.map(largeurVisible));
    expect(largeurs.size, `largeurs vues : ${[...largeurs].join(', ')}`).toBe(1);
    expect([...largeurs][0]).toBe(caps.largeur);
  });
});

describe('mesurer et couper', () => {
  it('les séquences ANSI ne comptent pas comme du texte', () => {
    expect(largeurVisible('\x1b[38;5;214mruche\x1b[0m')).toBe(5);
  });

  it('UN EMOJI COMPTE POUR UN, pas pour deux', () => {
    // Une paire de substitution UTF-16 : `'🐝'.length` vaut 2. Compter les
    // unités plutôt que les points de code décalerait le cadre qui la
    // contient. (Les glyphes réellement doubles comptent tout de même pour
    // un — limite assumée, voir l'ADR 0006.)
    expect('🐝'.length).toBe(2);
    expect(largeurVisible('🐝')).toBe(1);
  });

  it('couper marque la coupe et respecte la borne', () => {
    expect(tronquer('abcdefghij', 5)).toBe('abcd…');
    expect(largeurVisible(tronquer('abcdefghij', 5))).toBe(5);
    expect(tronquer('abcdefghij', 5, false)).toBe('ab...');
    expect(tronquer('court', 40)).toBe('court');
    expect(tronquer('rien', 0)).toBe('');
  });

  it('couper RETIRE toujours le style — c’est ce qu’on veut d’un texte du dehors', () => {
    expect(tronquer('\x1b[41mrouge et long', 6)).not.toContain('\x1b');
  });
});

describe('ENROULER PLUTÔT QUE COUPER — la moitié qui dit quoi faire', () => {
  // Mesuré sur un `.env` issu du `cp .env.example .env` que le docteur
  // conseille : les deux avertissements de sécurité de l'installeur font 178 et
  // 281 caractères, la largeur vaut 76. On coupait donc 102 et 205 caractères,
  // et à chaque fois la fin — c'est-à-dire la phrase qui dit quoi faire.
  const ALERTE =
    'Votre HIVE_JWT_SECRET est vide, trop court, ou porte encore l’ancienne valeur publiée ' +
    'avec le code : n’importe qui pourrait se fabriquer la session de votre administrateur. ' +
    'Remplacez-le dans .env par au moins 24 caractères tirés au hasard — la ruche refusera ' +
    'de démarrer autrement.';

  it('AUCUN MOT NE SE PERD — c’est toute la raison d’être de cette fonction', () => {
    const lignes = enrouler(ALERTE, 40);
    expect(lignes.join(' ')).toBe(ALERTE.replace(/\s+/g, ' '));
  });

  it('et aucune ligne ne déborde', () => {
    for (const largeur of [12, 40, 76]) {
      for (const l of enrouler(ALERTE, largeur)) {
        expect(largeurVisible(l), `« ${l} »`).toBeLessThanOrEqual(largeur);
      }
    }
  });

  it('UN MOT QUI REMPLIT LA LIGNE EXACTEMENT Y RESTE', () => {
    // La loupe a nommé ce trou : `<= largeur` muté en `< largeur` survivait.
    // Aucune ligne ne débordait — elles s'arrêtaient simplement une colonne
    // trop tôt — et « aucun mot ne se perd » restait vrai lui aussi. Le
    // résultat n'était pas FAUX, il était inutilement déchiqueté : et un
    // enrouleur qui gaspille une colonne sur chaque ligne fait perdre, sur les
    // avertissements de sécurité, exactement ce qu'on vient de lui faire gagner.
    //
    // « abc » (3) + l'espace (1) + « defghi » (6) = 10, soit la largeur pile.
    expect(enrouler('abc defghi', 10)).toEqual(['abc defghi']);
    // Un caractère de plus, et il descend : c'est la borne, des deux côtés.
    expect(enrouler('abc defghij', 10)).toEqual(['abc', 'defghij']);
  });

  it('UN MOT PLUS LONG QUE LA LIGNE EST DÉBITÉ, PAS JETÉ', () => {
    // Une URL de 200 caractères dans une fenêtre étroite doit rester lisible en
    // entier : la repousser à la ligne suivante ne ferait que déplacer le
    // débordement, et la couper ferait disparaître le chemin qu'on donne.
    const url = `https://exemple.test/${'a'.repeat(60)}`;
    const lignes = enrouler(`voir ${url} pour la suite`, 20);
    expect(lignes.join('')).toContain(url);
    for (const l of lignes) expect(largeurVisible(l)).toBeLessThanOrEqual(20);
  });

  it('les retours à la ligne écrits à la main sont des respirations, pas du bruit', () => {
    expect(enrouler('premier\nsecond', 40)).toEqual(['premier', 'second']);
  });

  it('une largeur nulle ou négative ne rend rien — et ne boucle pas', () => {
    expect(enrouler('quoi que ce soit', 0)).toEqual([]);
    expect(enrouler('quoi que ce soit', -5)).toEqual([]);
  });

  it('LE CONSTAT ENROULÉ N’ANNONCE QU’UNE SEULE ALERTE', () => {
    // Une marque par ligne ferait lire quatre alertes là où il n'y en a qu'une.
    const lignes = constatEnroule({ etat: 'alerte', libelle: ALERTE }, TUYAU);
    expect(lignes.length).toBeGreaterThan(1);
    expect(lignes.filter((l) => l.includes('ATTENTION'))).toHaveLength(1);
    expect(lignes[0]?.startsWith('[ATTENTION] ')).toBe(true);
  });

  it('…et les lignes de suite sont alignées sous le libellé', () => {
    const lignes = constatEnroule({ etat: 'alerte', libelle: ALERTE }, TUYAU);
    const marge = '[ATTENTION] '.length;
    for (const l of lignes.slice(1)) {
      expect(l.startsWith(' '.repeat(marge))).toBe(true);
      expect(l[marge]).not.toBe(' ');
    }
  });

  it('LE TEXTE SURVIT ENTIER AU RENDU — la garde qui compte', () => {
    // C'est l'assertion qui aurait rougi avant ce lot : la fin du message,
    // celle qui donne le geste, n'atteignait jamais personne.
    // Les lignes de suite portent leur marge d'alignement : on la neutralise
    // avant de chercher la phrase, sinon c'est la mise en page qu'on teste.
    const rendu = constatEnroule({ etat: 'alerte', libelle: ALERTE }, TUYAU)
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(rendu).toContain('la ruche refusera de démarrer autrement.');
  });

  it('sous cadres aussi, et sans jamais déborder de la largeur', () => {
    const lignes = constatEnroule({ etat: 'alerte', libelle: ALERTE }, ECRAN);
    expect(lignes.join(' ').replace(/\s+/g, ' ')).toContain('démarrer autrement.');
    for (const l of lignes) expect(largeurVisible(l)).toBeLessThanOrEqual(ECRAN.largeur);
  });
});

describe('l’alphabet et le spinner (§6.1)', () => {
  const couleur = capacites({ TERM: 'xterm-256color' }, TTY);
  const ascii = capacites({ NO_COLOR: '1' }, TTY);

  it('les symboles d’état ont un repli ASCII d’exactement une colonne', () => {
    for (const etat of ['fait', 'curseur', 'avenir', 'alerte', 'echec'] as const) {
      expect(largeurVisible(symbole(etat, couleur)), etat).toBe(1);
      expect(largeurVisible(symbole(etat, ascii)), etat).toBe(1);
      expect(symbole(etat, ascii)).toMatch(/^[ -~]$/);
    }
  });

  it('le spinner tourne en boucle, dans les deux sens', () => {
    expect(SPINNER_UNICODE).toHaveLength(10);
    expect(imageSpinner(0, couleur)).toBe(SPINNER_UNICODE[0]);
    expect(imageSpinner(10, couleur)).toBe(SPINNER_UNICODE[0]);
    expect(imageSpinner(23, couleur)).toBe(SPINNER_UNICODE[3]);
    // Un compteur qui repasse négatif ne doit pas rendre `undefined`.
    expect(imageSpinner(-1, couleur)).toBe(SPINNER_UNICODE[9]);
    expect(imageSpinner(3, ascii)).toBe(SPINNER_ASCII[3]);
  });

  it('la cadence est celle de la charte', () => {
    expect(CADENCE_SPINNER_MS).toBe(80);
  });
});

describe('les blocs', () => {
  const caps = capacites({ TERM: 'xterm-256color' }, TTY);

  it('espacer sépare d’une ligne vide, sans jamais en doubler', () => {
    expect(espacer(['a'], [], ['b'])).toEqual(['a', '', 'b']);
    expect(espacer([], [])).toEqual([]);
    expect(espacer(['a'])).toEqual(['a']);
  });

  it('la bannière tient en quatre lignes au plus, et dit la version', () => {
    const lignes = banniere('0.2.0', caps);
    expect(lignes.length).toBeLessThanOrEqual(4);
    expect(lignes.join('\n')).toContain('0.2.0');
  });

  it('LE CURSEUR DU MENU NE REPOSE PAS SUR LA SEULE COULEUR', () => {
    // Se reposer sur la couleur pour dire « vous êtes ici » rend le menu
    // inutilisable pour qui ne la distingue pas — ou l'a coupée.
    const sans = capacites({ NO_COLOR: '1' }, TTY);
    const lignes = menu(CHOIX, 1, sans);
    expect(lignes[1]).toContain(symbole('curseur', sans));
    expect(lignes[0]).not.toContain(symbole('curseur', sans));
    expect(lignes[2]).not.toContain(symbole('curseur', sans));
  });

  it('le jeton est montré, et la consigne avec lui', () => {
    const texte = encadreJeton('SECRET-DE-LA-RUCHE-0123456789', caps).join('\n');
    expect(texte).toContain('SECRET-DE-LA-RUCHE-0123456789');
    expect(texte).toMatch(/Ne le publiez jamais/);
    expect(texte).toMatch(/billet/);
  });

  it('le récapitulatif nomme les chemins — et se tait quand il n’y a rien', () => {
    const texte = recapEcritures(['.env', 'data/hive.db'], caps).join('\n');
    expect(texte).toContain('.env');
    expect(texte).toContain('data/hive.db');
    expect(recapEcritures([], caps).join('\n')).toMatch(/Rien à écrire/);
  });

  it('une vérification aligne son constat et pousse sa note à droite', () => {
    const ligne = ligneVerification(
      { etat: 'fait', libelle: 'Node v24.8.0', note: '(≥ 24 requis)' },
      capacites({ NO_COLOR: '1' }, TTY),
    );
    expect(ligne).toMatch(/^ {2}\+ {2}Node v24\.8\.0 {2,}\(≥ 24 requis\)$/);
  });

  it('la forme linéaire est lisible sans terminal', () => {
    const caps = capacites({}, { isTTY: false, columns: 100 });
    expect(etapeLineaire({ etat: 'fait', libelle: 'Node v22.4.0' }, caps)).toBe(
      '[OK] Node v22.4.0',
    );
    expect(etapeLineaire({ etat: 'echec', libelle: 'Port 7777' }, caps)).toContain('[ECHEC]');
    expect(etapeLineaire({ etat: 'fait', libelle: 'Disque', valeur: '2,1 Go' }, caps)).toBe(
      '[OK] Disque — 2,1 Go',
    );
  });

  it('le rappel des touches a un repli sans flèches', () => {
    expect(aideTouches(caps).join('')).toContain('↑↓');
    expect(aideTouches(capacites({ NO_COLOR: '1' }, TTY)).join('')).not.toContain('↑↓');
  });

  it('teinter en « neutre » ne produit rien, même en couleur', () => {
    expect(teinter('texte', 'neutre', caps)).toBe('texte');
    expect(teinter('', 'accent', caps)).toBe('');
  });

  it('un titre de section reste dans la largeur', () => {
    const etroit = capacites({ NO_COLOR: '1' }, { isTTY: true, columns: 60 });
    const ligne = titreSection(
      'un titre volontairement beaucoup trop long pour tenir ici',
      etroit,
    )[0]!;
    expect(largeurVisible(ligne)).toBeLessThanOrEqual(etroit.largeur);
  });
});

// ═══ LES ORNEMENTS, ET SURTOUT LEUR DISPARITION ══════════════════════════════
//
// Un « bel effet » est une promesse faite au terminal qui sait l'afficher. Sur
// tous les autres, c'est une dette : une séquence en clair au milieu du texte,
// une frise qui vole l'attention aux prérequis, une barre qui déborde du cadre.
//
// Ce bloc éprouve donc l'inverse de ce qu'on a écrit : non pas que le dégradé
// est joli, mais qu'il S'EFFACE partout où il ne peut pas l'être.

/**
 * L'octet d'échappement, CONSTRUIT et non écrit.
 *
 * `no-control-regex` interdit de poser `\x1b` littéralement dans un motif, et
 * cette règle est utile : elle protège d'un octet de contrôle glissé par
 * inadvertance. On ne la désactive donc pas — on la contourne proprement, en
 * fabriquant le caractère par son point de code.
 */
const ESC = String.fromCharCode(27);
const ECHAPPEMENT = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const VINGT_QUATRE_BITS = new RegExp(`${ESC}\\[38;2;\\d+;\\d+;\\d+m`, 'g');

describe('LE DÉGRADÉ DE MIEL', () => {
  const VRAI = {
    couleur: 16777216 as const,
    unicode: true,
    cadres: true,
    interactif: true,
    largeur: 76,
  };
  const C256 = { ...VRAI, couleur: 256 as const };
  const NOIR = { ...VRAI, couleur: 0 as const };

  it('EN 24 BITS : une nuance par caractère', () => {
    const vu = degrade('HIVE', VRAI);
    // Quatre lettres, quatre couleurs distinctes, et une remise à zéro.
    const couleurs = [...vu.matchAll(VINGT_QUATRE_BITS)].map((m) => m[0]);
    expect(couleurs).toHaveLength(4);
    expect(new Set(couleurs).size, 'un dégradé qui répète n’est pas un dégradé').toBe(4);
    expect(vu.endsWith('\x1b[0m')).toBe(true);
  });

  it('SOUS 24 BITS : l’ambre plat, pas un dégradé approximatif', () => {
    // Imiter un dégradé sans les couleurs pour le faire, c'est un clignotement
    // de teintes fausses. On rend exactement ce que `teinter` rendrait.
    expect(degrade('HIVE', C256)).toBe(teinter('HIVE', 'accent', C256));
    expect(degrade('HIVE', C256)).not.toMatch(/38;2;/);
  });

  it('SANS COULEUR : aucun octet d’échappement', () => {
    expect(degrade('HIVE', NOIR)).toBe('HIVE');
  });

  it('les espaces ne sont pas peints', () => {
    // Huit octets d'échappement pour un blanc, c'est huit occasions de se
    // tromper de largeur dans le cadre qui mesure la ligne.
    const vu = degrade('A B', VRAI);
    expect([...vu.matchAll(/38;2;/g)]).toHaveLength(2);
  });
});

describe('LA BARRE DE PROGRESSION', () => {
  const VRAI = {
    couleur: 16777216 as const,
    unicode: true,
    cadres: true,
    interactif: true,
    largeur: 76,
  };
  const ASCII = { ...VRAI, unicode: false, couleur: 0 as const };

  const nu = (s: string): string => s.replace(ECHAPPEMENT, '');

  it('NE DÉBORDE JAMAIS de la largeur demandée', () => {
    // ─── L'ASSERTION QUI PORTE LE BLOC ─────────────────────────────────────
    //
    // Une barre qui fait une colonne de trop casse le cadre qui la contient, et
    // le défaut n'apparaît qu'à un ratio particulier — donc jamais au premier
    // essai. On balaie.
    for (let i = 0; i <= 100; i++) {
      const vu = nu(barreProgression(i / 100, 20, VRAI));
      expect([...vu], `ratio ${i}%`).toHaveLength(20);
    }
  });

  it('BORNE ce qu’on lui donne, au lieu de le croire', () => {
    // Une division par zéro chez l'appelant ne doit pas produire une barre de
    // largeur négative — `repeat(-1)` jette.
    for (const r of [-1, 0, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect([...nu(barreProgression(r, 10, VRAI))], `ratio ${String(r)}`).toHaveLength(10);
    }
  });

  it('progresse par HUITIÈMES, pas par colonnes entières', () => {
    // Sur vingt colonnes, une barre en blocs pleins ne bouge qu'un pas sur 5 %
    // de progrès et paraît bloquée entre deux. Deux ratios proches doivent
    // donner deux images différentes.
    expect(nu(barreProgression(0.11, 20, VRAI))).not.toBe(nu(barreProgression(0.13, 20, VRAI)));
  });

  it('EN ASCII : encadrée, pour que le vide se distingue sans couleur', () => {
    const vu = barreProgression(0.5, 10, ASCII);
    expect(vu).toBe('[#####-----]');
    expect(vu, 'aucun échappement quand la couleur est coupée').not.toContain(ESC);
  });

  it('un ratio EXACT ne fabrique pas de huitième fantôme (&&, pas ||)', () => {
    // La survivante du balayage loupe du 3 août : `pleins < cases && reste > 0`
    // mutée en `||`. À 2/4 exactement, il n'y a AUCUN reste : deux pleins, deux
    // vides. Mutée, la barre afficherait '██▏░' — un huitième entamé qui
    // n'existe pas, et une colonne de vide avalée pour lui faire de la place.
    // (La garde de largeur ne rougissait pas : le total reste bon, c'est le
    // CONTENU qui ment.)
    expect(nu(barreProgression(0.5, 4, VRAI))).toBe('██░░');
    expect(nu(barreProgression(1, 4, VRAI))).toBe('████');
  });
});

describe('LA MARQUE EN LETTRES DE BLOCS', () => {
  const base = { unicode: true, cadres: true, interactif: true, largeur: 76 };

  it('n’apparaît QU’EN 24 bits — ailleurs, le titre d’une ligne', () => {
    // Sans dégradé, trois lignes de blocs pleins ne sont pas une marque : c'est
    // un mur d'ambre au-dessus des prérequis, qui sont la seule chose à lire.
    const riche = banniere('9.9.9', { ...base, couleur: 16777216 }).join('\n');
    const plate = banniere('9.9.9', { ...base, couleur: 256 }).join('\n');
    expect(riche).toMatch(/█/);
    expect(plate, '256 couleurs garde le titre court').toMatch(/H I V E/);
    expect(plate).not.toMatch(/█/);
  });

  it('LES TROIS LIGNES ONT LA MÊME LARGEUR', () => {
    // ─── CE QUI CASSE UN DESSIN DE LETTRES ─────────────────────────────────
    //
    // Une ligne plus courte que les autres décale la lettre suivante, et le mot
    // cesse d'être lisible — sans qu'aucune assertion de largeur totale ne
    // bouge, puisque le cadre complète les blancs de lui-même.
    //
    // On éprouve donc le DESSIN, pas la sortie. Ma première version lisait la
    // bannière rendue et faisait `trimEnd()` : elle mangeait le blanc de padding
    // du « E » et accusait un dessin juste.
    expect(BLOCS_HIVE).toHaveLength(3);
    expect(new Set(BLOCS_HIVE.map((l) => [...l].length)).size, 'lignes désalignées').toBe(1);
  });

  it('ELLE S’EFFACE quand la largeur ne suffit pas', () => {
    // Une marque coupée est pire qu'une marque absente : elle donne un mot faux.
    // Le repli est le titre d'une ligne, qui n'a jamais démérité.
    //
    // La borne réelle est BASSE — le dessin fait 22 colonnes — et c'est ce que
    // ma première version avait supposé de travers en essayant 60. La supposer
    // sans la calculer, c'est écrire un test qui ne prouve rien.
    const besoin = Math.max(...BLOCS_HIVE.map((l) => [...l].length));
    const trop = besoin + 3; // + les deux bordures et la marge du cadre
    const etroit = banniere('9.9.9', { ...base, couleur: 16777216, largeur: trop }).join('\n');
    expect(etroit, `à ${String(trop)} colonnes la marque ne tient pas`).not.toMatch(/█/);
    // ─── DÉNUDER AVANT DE CHERCHER UN MOT ──────────────────────────────────
    //
    // Le titre de repli passe par `degrade`, qui insère un échappement AVANT
    // CHAQUE lettre : la sous-chaîne littérale « H I V E » n'existe plus dans la
    // sortie colorée. Ma première assertion la cherchait telle quelle et
    // rougissait sur un rendu parfaitement juste.
    expect(etroit.replace(ECHAPPEMENT, '')).toMatch(/H I V E/);
  });

  it('LA BANNIÈRE RESTE COURTE — la charte la plafonne', () => {
    // ─── CE QUE MES PROPRES TESTS ONT TROUVÉ ─────────────────────────────────
    //
    // Une frise d'hexagones cohabitait ici. La marque l'a rendue INATTEIGNABLE
    // — elle tient dès 26 colonnes, et sous 60 les cadres sont abandonnés : il
    // ne restait aucune largeur où la frise pouvait s'afficher. Elle a donc été
    // RETIRÉE, pas gardée « au cas où » (§ 6.2).
    const vu = banniere('9.9.9', { ...base, couleur: 16777216 });
    expect(vu.join('\n'), 'la frise ne doit pas revenir').not.toMatch(/⬢/);
    expect(vu.length, 'cadre compris, la bannière reste courte').toBeLessThanOrEqual(6);
  });

  it('la bannière tient dans sa largeur, dans les quatre niveaux de couleur', () => {
    for (const couleur of [0, 16, 256, 16777216] as const) {
      for (const largeur of [60, 68, 76]) {
        for (const ligne of banniere('1.2.3', { ...base, couleur, largeur })) {
          expect(
            largeurVisible(ligne),
            `couleur ${couleur}, largeur ${largeur} : « ${ligne} »`,
          ).toBeLessThanOrEqual(largeur);
        }
      }
    }
  });
});
