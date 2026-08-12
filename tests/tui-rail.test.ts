// LE RAIL — l'identité de l'installeur, éprouvée sans terminal.
//
// ─── CE QUE CE FICHIER GARDE, ET POURQUOI CE N'EST PAS DE LA DÉCORATION ──────
//
// Un installeur est la première chose qu'un humain voit du projet, et la seule
// qu'il verra si elle échoue. Le rail lui répond à une question qu'une liste de
// coches ne traite pas : « où en suis-je, et combien reste-t-il ? »
//
// Mais un ornement mal borné coûte plus cher qu'une absence d'ornement : une
// ligne qui déborde d'une colonne décale toutes les suivantes, et une durée
// tronquée en `12,1 …` donne un chiffre FAUX. Ces deux fautes-là ne se voient
// pas en relisant le code ; elles se voient en le faisant tourner sur les
// largeurs et les alphabets où l'on ne travaille jamais.
//
// Le dépôt a déjà payé pour le savoir : la frise d'hexagones de la bannière a
// été retirée parce qu'aucune largeur ne pouvait plus l'afficher — trente
// lignes d'ornement mort, commentées, testées, INATTEIGNABLES. Chaque élément
// ajouté ici doit donc avoir une plage de largeur où il apparaît, et un test
// qui l'y prend.

import { describe, expect, it } from 'vitest';
import {
  LARGEUR_MIN_CADRES,
  capacites,
  dureeCourte,
  largeurVisible,
  ligneAFuite,
  panneau,
  rail,
  railPas,
  type Capacites,
  type Pas,
} from '../src/tui/rendu.js';

/** Les séquences de couleur, pour lire le CONTENU d'une ligne teintée. */
// eslint-disable-next-line no-control-regex
const ECHAPPEMENTS = /\x1b\[[0-9;]*m/g;

/** L'atténuation ANSI — ce que `teinter(..., 'discret')` pose. */
const ATTENUE = '\x1b[2m';

/** Les quatre terminaux que l'on sait rencontrer, et le cinquième qu'on subit. */
const TERMINAUX: ReadonlyArray<readonly [string, Capacites]> = [
  ['truecolor 100 colonnes', capacites({ COLORTERM: 'truecolor' }, { isTTY: true, columns: 100 })],
  ['256 couleurs 80 colonnes', capacites({ TERM: 'xterm-256color' }, { isTTY: true, columns: 80 })],
  ['16 couleurs 72 colonnes', capacites({ TERM: 'xterm' }, { isTTY: true, columns: 72 })],
  ['NO_COLOR', capacites({ NO_COLOR: '1' }, { isTTY: true, columns: 100 })],
  ['journal, hors terminal', capacites({}, { isTTY: false, columns: 100 })],
  ['étroit, 40 colonnes', capacites({ COLORTERM: 'truecolor' }, { isTTY: true, columns: 40 })],
];

const PAS: Pas[] = [
  { nom: 'Prérequis', etat: 'fait', duree: 412 },
  { nom: 'Dépendances', etat: 'fait', duree: 12_138, note: '438 paquets' },
  { nom: 'Réglages', etat: 'curseur' },
  { nom: 'Écriture', etat: 'avenir' },
];

describe('UNE DURÉE SE LIT D’UN COUP D’ŒIL', () => {
  it('la précision décroît quand la durée croît', () => {
    // `0,412 s` demande de compter les décimales ; `12,138 s` ne dit rien de
    // plus que `12 s` ; `128,4 s` oblige à diviser de tête.
    expect(dureeCourte(412)).toBe('0,4 s');
    expect(dureeCourte(4_240)).toBe('4,2 s');
    expect(dureeCourte(12_138)).toBe('12 s');
    expect(dureeCourte(59_400)).toBe('59 s');
    expect(dureeCourte(72_000)).toBe('1 min 12 s');
    expect(dureeCourte(120_000)).toBe('2 min');
  });

  it('LA VIRGULE EST DÉCIMALE — c’est un installeur en français', () => {
    expect(dureeCourte(1_500)).toContain(',');
    expect(dureeCourte(1_500)).not.toContain('.');
  });

  it('UNE DURÉE NULLE S’AFFICHE — « instantané » n’est pas « rien »', () => {
    // ─── L'AUTRE CÔTÉ DE LA MÊME BORNE ─────────────────────────────────────
    //
    // Le cas d'à côté éprouve les durées IMPOSSIBLES — `NaN`, `+∞`, `-1` — et
    // exige la chaîne vide. Il ne dit rien de zéro, qui est la première valeur
    // POSSIBLE. `ms < 0` muté en `<= 0` laissait les 125 cas TUI VERTS :
    // mesuré, verdict affiché.
    //
    // Et zéro arrive vraiment : un pas déjà fait, un cache chaud, une
    // vérification qui n'avait rien à vérifier. Rendre `''` afficherait ce
    // pas-là comme un pas qui N'A PAS TOURNÉ, au milieu d'une liste où tous les
    // autres portent leur durée. C'est la famille du docteur qui ne dit pas
    // pourquoi : l'écran ment dans le sens rassurant, et on cherche une panne
    // ailleurs.
    expect(dureeCourte(0), 'zéro milliseconde est une durée, pas une absence').toBe('0,0 s');
  });

  it('LES DEUX CHANGEMENTS D’UNITÉ SE FONT PILE OÙ ILS SONT ÉCRITS', () => {
    // Le cas du dessus éprouve les paliers par des valeurs qui tombent bien au
    // milieu — 4 240, 12 138, 59 400. Aucune ne touche les DEUX bascules, et
    // `s < 10` comme `s < 60` mutés en `<=` laissaient la suite verte.
    //
    // À dix secondes pile, la décimale ne dit plus rien d'utile et disparaît ; à
    // soixante, on passe aux minutes. Ces deux chiffres sont la règle même de
    // cette fonction : les décaler d'une unité, c'est afficher « 10,0 s » là où
    // la charte demande « 10 s », et « 60 s » là où elle demande « 1 min ».
    expect(dureeCourte(9_999), 'juste avant, la décimale reste').toBe('10,0 s');
    expect(dureeCourte(10_000), 'à dix secondes pile, la décimale part').toBe('10 s');
    expect(dureeCourte(59_999), 'juste avant, on reste en secondes').toBe('60 s');
    expect(dureeCourte(60_000), 'à soixante secondes pile, on passe aux minutes').toBe('1 min');
  });

  it('une durée impossible ne rend RIEN, plutôt qu’un « NaN s »', () => {
    // Une soustraction d'horodatages peut donner un négatif si l'horloge
    // recule. Afficher « -3,2 s » ferait douter de tout le reste de l'écran.
    for (const absurde of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(dureeCourte(absurde), String(absurde)).toBe('');
    }
  });
});

describe('LA FUITE DE POINTS', () => {
  const caps = capacites({ COLORTERM: 'truecolor' }, { isTTY: true, columns: 100 });

  it('relie les deux bouts', () => {
    const l = ligneAFuite('Prérequis', '0,4 s', 40, caps);
    expect(l).toContain('Prérequis');
    expect(l).toContain('0,4 s');
    expect(l).toMatch(/··+/);
  });

  it('ELLE ABANDONNE LA DROITE PLUTÔT QUE DE LA TRONQUER', () => {
    // ─── LE CHOIX QUI COMPTE ICI ──────────────────────────────────────────
    //
    // Tronquer donnerait « 12,1 … » : un chiffre FAUX, ce qui est pire que pas
    // de chiffre. Laisser déborder casserait l'alignement de toutes les lignes
    // suivantes, donc l'effet même que le rail existe pour produire.
    const serre = ligneAFuite('Un nom de pas plutôt long', '12 min 30 s', 30, caps);
    expect(serre).toBe('Un nom de pas plutôt long');
    expect(serre).not.toContain('12');
  });

  it('il faut au moins deux points pour qu’une fuite se lise comme une fuite', () => {
    // Un point isolé passerait pour une faute de frappe.
    const juste = ligneAFuite('abc', 'xy', 3 + 2 + 2 + 2, caps);
    expect(juste).toMatch(/··+/);
    const troisJuste = ligneAFuite('abc', 'xy', 3 + 2 + 2 + 1, caps);
    expect(troisJuste, 'un seul point disponible : on abandonne').toBe('abc');
  });

  it('sans droite, la ligne est rendue telle quelle', () => {
    expect(ligneAFuite('Prérequis', '', 40, caps)).toBe('Prérequis');
  });
});

describe('LE RAIL NE SE ROMPT PAS', () => {
  const caps = capacites({ COLORTERM: 'truecolor' }, { isTTY: true, columns: 100 });

  it('un trait relie chaque perle à la suivante, et JAMAIS avant la première', () => {
    // C'est un caractère par ligne, et c'est tout l'effet : l'œil suit une
    // colonne au lieu de lire une énumération.
    const lignes = rail(PAS, caps);
    expect(lignes[0], 'la colonne ne commence pas par un trait').toContain('Prérequis');
    // On compte le CONTENU VISIBLE, pas le texte brut : une première version
    // comparait les octets et comptait aussi la ligne de note, qui commence
    // elle aussi par un trait teinté. Le test rougissait sur du code juste.
    const traits = lignes.filter((l) => l.replace(ECHAPPEMENTS, '').trim() === '│');
    expect(traits.length, 'un trait entre chaque paire de pas').toBe(PAS.length - 1);
  });

  it('AVEC COULEUR, LES TROIS TRAITEMENTS SONT DISTINCTS', () => {
    // ─── DEUX MUTANTS ONT SURVÉCU ICI ──────────────────────────────────────
    //
    // Inverser `pas.etat === 'avenir'` ne faisait rougir personne : le test
    // voisin ne regarde que les PERLES, en `NO_COLOR`. La teinte — ce qui fait
    // qu'on voit où on en est d'un coup d'œil — n'était éprouvée par rien.
    //
    // Trois traitements, trois rôles : ce qui reste à faire s'efface, ce qui
    // est fait s'allume d'un ambre plat, et le pas EN COURS porte le dégradé.
    const teinte = (etat: Pas['etat']): string =>
      railPas({ nom: 'Prérequis', etat }, caps)[0] ?? '';
    const codes = (l: string): string[] => [...l.matchAll(ECHAPPEMENTS)].map((m) => m[0]);

    const avenir = teinte('avenir');
    const curseur = teinte('curseur');
    const fait = teinte('fait');

    expect(avenir, 'ce qui reste à faire s’efface').toContain(ATTENUE);
    expect(fait, 'ce qui est fait ne s’efface pas').not.toContain(ATTENUE);
    // Le dégradé pose une couleur PAR CARACTÈRE : c'est ce qui le distingue
    // d'un aplat, et on le compte plutôt que de le décrire.
    expect(
      codes(curseur).length,
      'le pas en cours doit porter un dégradé, pas un aplat',
    ).toBeGreaterThan(codes(fait).length);
  });

  it('LE PAS EN COURS EST PLUS CLAIR QUE CE QUI L’ENTOURE', () => {
    // ─── LA LEÇON QUE LE CODE PORTE DÉJÀ EN COMMENTAIRE ────────────────────
    //
    // La première version partait de zéro sur la rampe, c'est-à-dire du brun le
    // plus sombre : la ligne active était la MOINS visible de la colonne,
    // exactement l'inverse de ce qu'elle doit être. Ça ne s'est pas vu dans les
    // tests — qui vérifiaient largeurs et glyphes — mais en le regardant
    // tourner.
    //
    // Un commentaire qui raconte un défaut corrigé ne l'empêche pas de revenir.
    // Celui-ci le fait : on lit la LUMINANCE du premier caractère coloré.
    const premier = (etat: Pas['etat']): number => {
      const l = railPas({ nom: 'Prérequis', etat }, caps)[0] ?? '';
      // eslint-disable-next-line no-control-regex
      const m = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(l);
      if (m === null) return 0;
      return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
    };
    expect(
      premier('curseur'),
      'le pas en cours doit partir du MILIEU de la rampe, pas de son brun',
    ).toBeGreaterThan(100);
  });

  it('LE CHRONO N’APPARAÎT QUE QUAND IL Y A UNE DURÉE', () => {
    // Un mutant survivait sur `pas.duree === undefined` : un pas sans durée
    // affichait « 0 s » — un chrono qui ment vaut moins que pas de chrono.
    const sans = railPas({ nom: 'Prérequis', etat: 'fait' }, caps)[0] ?? '';
    const avec = railPas({ nom: 'Prérequis', etat: 'fait', duree: 2_400 }, caps)[0] ?? '';
    expect(sans.replace(ECHAPPEMENTS, ''), 'aucun chiffre sans durée').not.toMatch(/\d/);
    expect(avec.replace(ECHAPPEMENTS, '')).toContain('2,4 s');
  });

  it('LES QUATRE ÉTATS SE DISTINGUENT SANS COULEUR', () => {
    // ─── LA GARDE QUE LE REPLI ASCII RÉCLAME ──────────────────────────────
    //
    // En truecolor, « fait » et « à venir » se distinguent par la teinte. Sans
    // couleur il ne reste que la FORME : `⬢` plein contre `⬡` creux, et en
    // ASCII `#` contre `.`. Une perle unique pour deux états rendrait la
    // colonne illisible exactement là où elle est le plus utile — dans un
    // journal, sur un serveur, dans une CI.
    const nu = capacites({ NO_COLOR: '1' }, { isTTY: true, columns: 100 });
    const perles = PAS.map((p) => railPas(p, nu)[0]?.trim()[0]);
    expect(new Set(perles).size, 'deux états partagent la même perle').toBe(
      new Set(PAS.map((p) => p.etat)).size,
    );
  });

  it('la note est portée par le rail, pas posée à côté', () => {
    const lignes = railPas(PAS[1]!, caps);
    expect(lignes.length).toBe(2);
    expect(lignes[1]).toContain('438 paquets');
    expect(lignes[1]).toContain('│');
  });

  it('UNE NOTE VENUE DU DEHORS NE PEUT PAS REPEINDRE L’ÉCRAN', () => {
    // ─── CE TEST A TROUVÉ UN VRAI TROU ────────────────────────────────────
    //
    // Il visait `tronquer`, qui « retire les octets d'échappement ». Il en
    // retire une PARTIE : les séquences SGR, celles qui finissent par `m`.
    // `\x1b[2J` — efface l'écran — finit par `J` et passait intact. Une sortie
    // de `npm` pouvait donc effacer tout ce qui la précédait. D'où `nettoyer`,
    // qui retire CSI, OSC et caractères de commande, appliqué avant `tronquer`.
    const hostile: Pas = {
      nom: 'Dépendances',
      etat: 'fait',
      note: '\x1b[31mROUGE\x1b[2J effacé',
    };
    const nu = capacites({ NO_COLOR: '1' }, { isTTY: true, columns: 100 });
    const lignes = railPas(hostile, nu);
    expect(lignes.join('\n')).not.toContain('\x1b[31m');
    expect(lignes.join('\n')).not.toContain('\x1b[2J');
    expect(lignes.join('\n'), 'le texte lui-même reste lisible').toContain('ROUGE');
  });
});

describe('AUCUNE LIGNE NE DÉBORDE, SUR AUCUN TERMINAL', () => {
  // ─── L'ASSERTION LA PLUS UTILE DU FICHIER ──────────────────────────────────
  //
  // Une seule colonne de trop et l'enveloppe du terminal replie la ligne : la
  // colonne se dédouble, et l'installation a l'air d'avoir déraillé. Ça ne se
  // voit pas en relisant — ça se voit en mesurant, sur les largeurs où l'on ne
  // travaille jamais.
  for (const [nom, caps] of TERMINAUX) {
    it(`${nom} : tout tient dans ${String(caps.largeur)} colonnes`, () => {
      const tout = [
        ...rail(PAS, caps),
        ...panneau('La ruche est prête', ['npm run ruche', 'http://127.0.0.1:7777'], caps),
      ];
      for (const l of tout) {
        expect(largeurVisible(l), `« ${l} »`).toBeLessThanOrEqual(caps.largeur);
      }
    });
  }

  for (const [nom, caps] of TERMINAUX) {
    if (caps.couleur !== 0) continue;
    it(`${nom} : AUCUN octet d’échappement`, () => {
      // La garde qui compte : une seule fonction oubliée suffit à remplir un
      // fichier de log de séquences illisibles.
      const tout = [...rail(PAS, caps), ...panneau('Prête', ['npm run ruche'], caps)].join('\n');
      expect(tout).not.toContain('\x1b');
    });
  }
});

describe('LE PANNEAU DE FIN', () => {
  it('encadre, et met les commandes en évidence', () => {
    const caps = capacites({ COLORTERM: 'truecolor' }, { isTTY: true, columns: 100 });
    const vide = panneau('Rien à faire', [], caps);
    // ─── UN PANNEAU SANS COMMANDE N'A PAS DE LIGNE BLANCHE ─────────────────
    //
    // La ligne vide est un SÉPARATEUR entre le titre et les commandes : sans
    // commande, elle ne sépare rien. `lignes.length > 0` muté en `>= 0` est
    // toujours vrai et la posait quand même — un cadre au titre suivi d'un
    // trou.
    //
    // Aujourd'hui aucun appelant ne peut l'atteindre : `prochainesEtapes`, le
    // seul, rend toujours cinq lignes. Mais `panneau` est EXPORTÉ, donc c'est un
    // contrat, pas un détail interne — et un banc le ferme pour de bon là où un
    // commentaire obligerait chaque balayage futur à refaire l'enquête.
    expect(
      vide.filter((l) => l.replace(/[│|╭╮╰╯─\-+\s]/g, '') === '').length,
      'un panneau sans commande porte une ligne vide de trop',
    ).toBe(2); // les deux bordures du cadre, et rien d'autre

    const p = panneau('La ruche est prête', ['npm run ruche'], caps);
    expect(p[0]).toContain('╭');
    expect(p[p.length - 1]).toContain('╰');
    expect(p.join('\n')).toContain('npm run ruche');
  });

  it('SOUS LE SEUIL DES CADRES, il reste — sans bordure et sans déborder', () => {
    // Un cadre qui déborde est pire que pas de cadre ; une réponse à « et
    // maintenant ? » qui disparaît est pire que les deux.
    const etroit = capacites(
      { COLORTERM: 'truecolor' },
      { isTTY: true, columns: LARGEUR_MIN_CADRES - 1 },
    );
    expect(etroit.cadres, 'le seuil doit bien être franchi').toBe(false);
    const p = panneau('La ruche est prête', ['npm run ruche'], etroit);
    expect(p.join('\n'), 'la commande survit').toContain('npm run ruche');
    expect(p.join('\n'), 'sans bordure').not.toContain('╭');
    for (const l of p) expect(largeurVisible(l)).toBeLessThanOrEqual(etroit.largeur);
  });
});
