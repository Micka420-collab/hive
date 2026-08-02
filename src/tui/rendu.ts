// Le rendu de l'accueil — MODULE PUR.
//
// ─── POURQUOI CE FICHIER EXISTE, ET POURQUOI IL NE FAIT AUCUNE I/O ───────────
//
// Le premier écran de Hive est une fonctionnalité, pas une décoration : c'est
// lui qui décide si quelqu'un installe la ruche ou ferme son terminal. Et
// c'est aussi le premier code que cette personne exécute — souvent par un
// `npx` lancé avant d'avoir décidé de faire confiance au projet.
//
// D'où deux contraintes qui gouvernent tout ce fichier :
//
//   1. AUCUNE DÉPENDANCE. Voir `docs/adr/0006-tui-sans-dependance.md`. Un
//      projet qui promet « vos clés d'API ne quittent jamais votre machine »
//      et qui, pour dessiner un cadre, tire trente paquets sur le chemin
//      d'installation, se contredit dans le même geste.
//
//   2. AUCUNE I/O. Ce module ne connaît ni `process.stdout`, ni le terminal,
//      ni l'heure. Il prend un ÉTAT et rend des `string[]`. Toute la charte du
//      §6 de la mission devient donc testable par assertion, sans terminal —
//      y compris et surtout les cinq DÉGRADATIONS du §6.4, qui sont la partie
//      qu'on oublie de vérifier quand on ne peut pas la tester.
//
// La partie impure (mode brut, touches, curseur, signaux) vit dans
// `src/tui/terminal.ts` et n'est pas de ce lot.
//
// ─── LA GARDE QUI COMPTE ─────────────────────────────────────────────────────
//
// `NO_COLOR` posé ⇒ AUCUN octet `\x1b` en sortie. Ce n'est pas une politesse :
// c'est ce qui permet de rediriger l'installeur dans un fichier de log, ou de
// le lire dans une CI, sans le remplir de séquences illisibles. Le test
// l'exerce sur la sortie complète, pas fonction par fonction.

// ─── La palette et l'alphabet ────────────────────────────────────────────────

/** Largeur maximale du contenu. Au-delà, une ligne devient pénible à lire. */
export const LARGEUR_MAX = 76;

/** En dessous, les cadres coûtent plus de place qu'ils n'en donnent (§6.4). */
export const LARGEUR_MIN_CADRES = 60;

/** Cadence du spinner, en millisecondes (§6.1). */
export const CADENCE_SPINNER_MS = 80;

/** Le spinner braille, et son repli quand l'Unicode n'est pas sûr. */
export const SPINNER_UNICODE = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
export const SPINNER_ASCII = [...'|/-\\'];

/**
 * L'accent ambre, et lui seul.
 *
 * La charte (§6.1) interdit une seconde couleur d'accent à l'écran : deux
 * accents, c'est zéro accent — plus rien ne ressort. Le reste du texte est
 * sans couleur, et le secondaire est atténué.
 */
const AMBRE_256 = '\x1b[38;5;214m';
const AMBRE_16 = '\x1b[33m';
const ATTENUE = '\x1b[2m';
const REPRISE = '\x1b[0m';

/** Combien de couleurs le terminal sait afficher. 0 = aucune. */
export type NiveauCouleur = 0 | 16 | 256 | 16777216;

/**
 * Le miel, du plus sombre au plus clair — la seule rampe du produit.
 *
 * ─── POURQUOI UNE RAMPE, ALORS QUE LA CHARTE INTERDIT DEUX ACCENTS ──────────
 *
 * Elle l'interdit à l'écran D'ÉTAT, et elle a raison : deux accents en
 * concurrence sur des lignes qu'on lit pour décider, c'est zéro accent. Cette
 * règle est intacte — `teinter` n'a pas changé, et les lignes de vérification
 * restent en ambre unique ou sans couleur.
 *
 * Une rampe n'est pas un second accent : c'est le MÊME ambre, décliné. Elle ne
 * sert qu'aux surfaces décoratives — la marque, les barres de progression —
 * où il n'y a rien à lire, donc rien à hiérarchiser.
 *
 * Les valeurs vont du brun-miel au jaune pâle. Elles ne traversent aucune
 * autre teinte : un dégradé qui virerait au rouge ou au vert introduirait la
 * couleur d'une ALERTE dans un ornement, et c'est exactement le genre de
 * signal qu'on ne prête pas.
 */
const RAMPE_MIEL: readonly (readonly [number, number, number])[] = [
  // ─── LA RAMPE SUIT LA CHARTE, ET LA CHARTE VIENT DU DESIGN ─────────────────
  //
  // Les deux derniers tons sont ceux de la vitrine : `#A85E06` (l'ambre
  // profond) et `#F6C445` (le miel). Ce n'est pas un ajustement esthétique —
  // c'est ce qui rend vraie la phrase « la même marque dans le terminal et
  // dans le navigateur », et `tests/vitrine-jetons.test.ts` la vérifie en
  // lisant CE tableau à travers `degrade`.
  //
  // Les quatre premiers tons descendent vers le brun pour que le dégradé ait
  // une profondeur : une rampe qui commence déjà clair ne se lit pas comme un
  // dégradé, elle se lit comme un aplat mal imprimé.
  [92, 51, 6],
  [138, 76, 8],
  [168, 94, 6],
  [206, 128, 16],
  [232, 165, 34],
  [246, 196, 69],
];

/** Un octet de couleur d'avant-plan en 24 bits. */
function rvb(c: readonly [number, number, number]): string {
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
}

/**
 * La couleur de la rampe à la position `t` ∈ [0, 1], interpolée.
 *
 * Interpoler plutôt que choisir le palier le plus proche : sur une bannière de
 * dix caractères, six paliers se verraient comme six marches. Le dégradé doit
 * être une transition, pas un escalier.
 */
function miel(t: number): readonly [number, number, number] {
  const borne = Math.min(1, Math.max(0, t));
  const pas = borne * (RAMPE_MIEL.length - 1);
  const bas = Math.floor(pas);
  const haut = Math.min(RAMPE_MIEL.length - 1, bas + 1);
  const f = pas - bas;
  const a = RAMPE_MIEL[bas]!;
  const b = RAMPE_MIEL[haut]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Le ton d'un fragment de texte. Il n'y en a que trois, délibérément. */
export type Ton = 'accent' | 'discret' | 'neutre';

/** L'état d'une ligne de vérification (§6.1). */
export type Etat = 'fait' | 'curseur' | 'avenir' | 'alerte' | 'echec';

const SYMBOLES_UNICODE: Record<Etat, string> = {
  fait: '✔',
  curseur: '▸',
  avenir: '◦',
  alerte: '⚠',
  echec: '✘',
};

/**
 * Le repli ASCII. Chaque symbole fait EXACTEMENT une colonne, sans quoi les
 * lignes cesseraient d'être alignées entre elles au premier repli.
 */
const SYMBOLES_ASCII: Record<Etat, string> = {
  fait: '+',
  curseur: '>',
  avenir: '.',
  alerte: '!',
  echec: 'x',
};

interface Bordures {
  hg: string;
  hd: string;
  bg: string;
  bd: string;
  h: string;
  v: string;
}

const BORDURES_UNICODE: Bordures = { hg: '╭', hd: '╮', bg: '╰', bd: '╯', h: '─', v: '│' };
const BORDURES_ASCII: Bordures = { hg: '+', hd: '+', bg: '+', bd: '+', h: '-', v: '|' };

// ─── Ce que le terminal sait faire ───────────────────────────────────────────

export interface Capacites {
  /** Niveau de couleur utilisable. `0` interdit tout octet d'échappement. */
  couleur: NiveauCouleur;
  /** Les caractères de dessin de boîtes sont-ils sûrs ? */
  unicode: boolean;
  /** Dessine-t-on des cadres, ou reste-t-on en texte linéaire ? */
  cadres: boolean;
  /** Peut-on poser une question et attendre une touche ? */
  interactif: boolean;
  /** Largeur de contenu retenue, toujours ≤ `LARGEUR_MAX`. */
  largeur: number;
}

/** Ce que l'appelant sait de sa sortie standard. Injecté, jamais lu ici. */
export interface Sortie {
  isTTY?: boolean | undefined;
  columns?: number | undefined;
}

/**
 * Décide des capacités à partir de l'environnement — sans le lire soi-même.
 *
 * Les règles viennent du §6.4 de la mission, dans cet ordre de priorité :
 *
 *   • `stdout` non-TTY        → sortie linéaire, AUCUN code ANSI. C'est le cas
 *                               d'un pipe, d'un `ssh machine commande`, d'une
 *                               CI, d'une redirection vers un fichier.
 *   • `NO_COLOR` / `TERM=dumb`→ pas de couleur, cadres conservés en ASCII.
 *   • largeur < 60            → cadres abandonnés, texte brut.
 *
 * NOTE SUR `NO_COLOR` : la convention (no-color.org) ne parle que de COULEUR,
 * pas de jeu de caractères. La mission demande explicitement le repli ASCII
 * des cadres dans ce cas (§6.4), et c'est ce qui est implémenté. Un terminal
 * qui refuse la couleur est très souvent un terminal ancien ou une capture de
 * log, où le dessin de boîtes passe mal — le choix se défend. S'il fallait
 * l'inverser un jour, c'est ici, sur une ligne.
 */
export function capacites(
  env: Record<string, string | undefined> = {},
  sortie: Sortie = {},
): Capacites {
  const interactif = sortie.isTTY === true;
  const brute = typeof sortie.columns === 'number' && sortie.columns > 0 ? sortie.columns : 80;
  const largeur = Math.max(20, Math.min(brute, LARGEUR_MAX));

  // `NO_COLOR` compte dès qu'elle est présente et non vide (no-color.org).
  const sansCouleurDemandee = (env.NO_COLOR ?? '') !== '';
  const dumb = (env.TERM ?? '').trim() === 'dumb';

  const couleur: NiveauCouleur =
    !interactif || sansCouleurDemandee || dumb ? 0 : niveauCouleur(env);

  return {
    couleur,
    unicode: interactif && !sansCouleurDemandee && !dumb,
    cadres: interactif && brute >= LARGEUR_MIN_CADRES,
    interactif,
    largeur,
  };
}

/**
 * 256 couleurs, ou repli à 16 ?
 *
 * Le repli n'est pas théorique : ConHost — la console Windows historique, qui
 * s'ouvre encore par double-clic — n'affiche pas la palette 256. Y envoyer
 * `\x1b[38;5;214m` ne donne pas de l'ambre approximatif : ça donne du texte
 * illisible. En cas de doute, on rend 16 : une couleur moins jolie se
 * remarque à peine, une couleur cassée saute aux yeux.
 */
function niveauCouleur(env: Record<string, string | undefined>): NiveauCouleur {
  const force = (env.FORCE_COLOR ?? '').trim();
  if (force === '0') return 0;
  if (force === '1') return 16;
  if (force === '2') return 256;

  if (force === '3') return 16777216;

  const term = (env.TERM ?? '').toLowerCase();
  const colorterm = (env.COLORTERM ?? '').toLowerCase();
  // ─── 24 BITS : ANNONCÉ, JAMAIS DEVINÉ ─────────────────────────────────────
  //
  // `COLORTERM` est la SEULE annonce fiable de la couleur vraie. On ne la
  // déduit ni de `TERM`, ni de `WT_SESSION` : un terminal qui ne la sait pas
  // et à qui l'on envoie `\x1b[38;2;…m` n'affiche pas un ambre approximatif,
  // il affiche la séquence en clair au milieu du texte. Le repli à 256 est
  // exactement la même prudence que le repli de 256 vers 16 juste en dessous.
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 16777216;
  if (term.includes('256color')) return 256;
  // Windows Terminal et le terminal intégré de VS Code savent tous les deux.
  if ((env.WT_SESSION ?? '') !== '') return 256;
  if ((env.TERM_PROGRAM ?? '') === 'vscode') return 256;
  return 16;
}

// ─── Mesurer et couper ───────────────────────────────────────────────────────

/**
 * Toute séquence de style ANSI, pour ne jamais la compter comme du texte.
 *
 * Le caractère de contrôle est ici DÉLIBÉRÉ : c'est précisément ce qu'on
 * cherche. `no-control-regex` protège du contraire — un octet de contrôle
 * glissé par inadvertance dans un motif — et n'a rien à dire d'un détecteur
 * de séquences d'échappement.
 */
// eslint-disable-next-line no-control-regex
const ECHAPPEMENTS = /\x1b\[[0-9;]*m/g;

/**
 * Largeur visible d'un texte, en colonnes.
 *
 * Compte les POINTS DE CODE, pas les unités UTF-16 : sans cela un emoji
 * (paire de substitution) compterait double et décalerait le cadre qui le
 * contient. Comme annoncé dans l'ADR 0006, les glyphes réellement doubles
 * (idéogrammes) comptent tout de même pour un — c'est la limite assumée du
 * choix « sans dépendance », et la charte interdit déjà l'emoji dans le flux
 * d'exécution.
 */
export function largeurVisible(texte: string): number {
  return [...texte.replace(ECHAPPEMENTS, '')].length;
}

/**
 * Toutes les commandes de terminal, retirées d'un texte venu du DEHORS.
 *
 * ─── POURQUOI `tronquer` NE SUFFISAIT PAS ────────────────────────────────────
 *
 * `ECHAPPEMENTS` ne connaît que les séquences SGR — celles qui se terminent par
 * `m`, donc les couleurs. C'est le bon périmètre pour ce qu'il fait : mesurer et
 * couper du texte que nous avons nous-mêmes teinté.
 *
 * Mais une NOTE d'installation vient de `npm`, de `git`, d'un chemin de disque.
 * Un test l'a montré en rougissant : `\x1b[2J` — efface l'écran — traversait
 * `tronquer` intact, parce qu'il finit par `J` et non par `m`. Une sortie de
 * commande pouvait donc effacer tout ce qui la précédait, déplacer le curseur,
 * ou renommer la fenêtre du terminal par une séquence OSC.
 *
 * On retire donc :
 *  · les séquences CSI complètes, quelle que soit leur lettre finale ;
 *  · les séquences OSC, terminateur BEL ou ST — c'est celle qui renomme la
 *    fenêtre, la plus discrète des trois ;
 *  · tout autre échappement d'un caractère ;
 *  · les caractères de commande C0 restants, `\r` compris : un retour chariot
 *    seul réécrit la ligne par-dessus elle-même.
 */
const COMMANDES_TERMINAL =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b.|[\x00-\x1f\x7f]/g;

export function nettoyer(texte: string): string {
  return texte.replace(COMMANDES_TERMINAL, '');
}

/**
 * Coupe un texte à `max` colonnes, en marquant la coupe.
 *
 * Rien de ce qui vient de l'extérieur n'est affiché sans passer par ici : un
 * libellé de billet, un nom de machine ou un chemin trop long ne doit pas
 * pouvoir crever un cadre. `acces.ts` borne déjà ces libellés à 120
 * caractères sans caractère de contrôle ; cette coupe-ci est la seconde
 * ceinture, celle qui protège la MISE EN PAGE plutôt que la sécurité.
 *
 * Pour un texte dont on ne maîtrise PAS l'origine, `nettoyer` d'abord.
 */
export function tronquer(texte: string, max: number, unicode = true): string {
  if (max <= 0) return '';
  const points = [...texte.replace(ECHAPPEMENTS, '')];
  if (points.length <= max) return points.join('');
  const marque = unicode ? '…' : '...';
  const garde = Math.max(0, max - marque.length);
  return points.slice(0, garde).join('') + marque;
}

/** Complète à droite jusqu'à `largeur` colonnes visibles. */
function completer(texte: string, largeur: number): string {
  const manque = largeur - largeurVisible(texte);
  return manque > 0 ? texte + ' '.repeat(manque) : texte;
}

// ─── Teinter ─────────────────────────────────────────────────────────────────

/**
 * Applique un ton — ou ne fait rien du tout.
 *
 * C'est le seul endroit du module qui émet un octet `\x1b`. Toute la garde
 * « aucun code ANSI quand la couleur est coupée » tient donc à cette fonction,
 * et c'est pour ça qu'elle est unique.
 */
export function teinter(texte: string, ton: Ton, caps: Capacites): string {
  if (caps.couleur === 0 || ton === 'neutre' || texte === '') return texte;
  if (ton === 'discret') return `${ATTENUE}${texte}${REPRISE}`;
  return `${caps.couleur >= 256 ? AMBRE_256 : AMBRE_16}${texte}${REPRISE}`;
}

/**
 * Le même texte, traversé par la rampe de miel — un caractère, une nuance.
 *
 * ─── CE QU'ELLE FAIT QUAND LE TERMINAL NE SAIT PAS ──────────────────────────
 *
 * Un dégradé sans 24 bits n'est pas un dégradé approximatif : c'est un
 * clignotement de couleurs fausses. On ne l'imite donc pas. En dessous de
 * 16 777 216, on rend exactement ce que `teinter(…, 'accent')` rendrait —
 * l'ambre plat, qui a toujours bien marché. La beauté est un bonus des
 * terminaux modernes, jamais une condition de lisibilité.
 *
 * Les espaces ne sont pas teintés : peindre un blanc coûte huit octets
 * d'échappement pour rien, et sur une ligne qu'un cadre doit mesurer, chaque
 * séquence inutile est une occasion de se tromper de largeur.
 */
export function degrade(texte: string, caps: Capacites): string {
  if (caps.couleur === 0 || texte === '') return texte;
  if (caps.couleur < 16777216) return teinter(texte, 'accent', caps);

  const points = [...texte];
  const dernier = Math.max(1, points.length - 1);
  let sortie = '';
  for (const [i, c] of points.entries()) {
    sortie += c === ' ' ? c : `${rvb(miel(i / dernier))}${c}`;
  }
  return `${sortie}${REPRISE}`;
}

/**
 * Une barre de progression, au huitième de colonne près.
 *
 * ─── POURQUOI LES SOUS-CARACTÈRES ───────────────────────────────────────────
 *
 * Une barre en blocs pleins avance par sauts d'une colonne entière : sur
 * quarante colonnes, elle ne bouge qu'un pas sur 2,5 % de progrès, et paraît
 * bloquée entre deux. Les huit paliers de `▏▎▍▌▋▊▉█` la rendent continue —
 * c'est le seul « effet » ici qui apporte de l'INFORMATION et pas du décor.
 *
 * `ratio` est borné, jamais cru : une division par zéro chez l'appelant ne
 * doit pas produire une barre de largeur négative, qui casserait le cadre.
 */
const HUITIEMES = [...'▏▎▍▌▋▊▉█'];

export function barreProgression(ratio: number, largeur: number, caps: Capacites): string {
  const cases = Math.max(1, Math.floor(largeur));
  const borne = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));

  if (!caps.unicode) {
    // ASCII : pas de sous-caractère possible, donc on assume le pas entier et
    // on encadre pour que le vide se distingue du plein sans couleur.
    const pleins = Math.round(borne * cases);
    return `[${'#'.repeat(pleins)}${'-'.repeat(cases - pleins)}]`;
  }

  const total = borne * cases;
  const pleins = Math.floor(total);
  const reste = total - pleins;
  // Le palier partiel n'apparaît que s'il reste de la place : sinon la barre
  // ferait une colonne de trop et déborderait du cadre qui la contient.
  const partiel = pleins < cases && reste > 0 ? HUITIEMES[Math.floor(reste * 8)]! : '';
  const rempli = '█'.repeat(pleins) + partiel;
  const vide = '░'.repeat(Math.max(0, cases - pleins - (partiel ? 1 : 0)));
  return `${degrade(rempli, caps)}${teinter(vide, 'discret', caps)}`;
}

/** Le symbole d'un état, dans l'alphabet que le terminal sait afficher. */
export function symbole(etat: Etat, caps: Capacites): string {
  return (caps.unicode ? SYMBOLES_UNICODE : SYMBOLES_ASCII)[etat];
}

/** L'image du spinner à l'instant `tour`. Pure : c'est l'appelant qui compte. */
export function imageSpinner(tour: number, caps: Capacites): string {
  const images = caps.unicode ? SPINNER_UNICODE : SPINNER_ASCII;
  const i = ((tour % images.length) + images.length) % images.length;
  return images[i]!;
}

// ─── Les blocs ───────────────────────────────────────────────────────────────

/**
 * Assemble des blocs en les séparant d'une ligne vide, sans jamais en doubler.
 *
 * « Espace négatif : une ligne vide avant et après chaque bloc. La densité,
 * c'est du bruit. » (§6.1) Le faire ici plutôt que dans chaque composeur évite
 * l'accumulation de lignes vides à la jointure.
 */
export function espacer(...blocs: string[][]): string[] {
  const vivants = blocs.filter((b) => b.length > 0);
  const sortie: string[] = [];
  for (const bloc of vivants) {
    if (sortie.length > 0) sortie.push('');
    sortie.push(...bloc);
  }
  return sortie;
}

/**
 * Un cadre arrondi autour de lignes déjà composées.
 *
 * Sous `LARGEUR_MIN_CADRES` colonnes — ou hors terminal — les bordures sont
 * abandonnées et le contenu rendu tel quel : un cadre qui déborde est pire
 * que pas de cadre.
 */
export function cadre(lignes: readonly string[], caps: Capacites): string[] {
  if (!caps.cadres) return lignes.map((l) => tronquer(l, caps.largeur, caps.unicode));

  const b = caps.unicode ? BORDURES_UNICODE : BORDURES_ASCII;
  const interieur = caps.largeur - 4; // deux bordures + une marge de chaque côté
  const barre = b.h.repeat(caps.largeur - 2);
  const dessus = `${b.hg}${barre}${b.hd}`;
  const dessous = `${b.bg}${barre}${b.bd}`;
  const corps = lignes.map((ligne) => {
    // Une ligne qui TIENT est reprise telle quelle : `tronquer` retire les
    // séquences de style — c'est ce qu'on veut d'un texte venu du dehors,
    // c'est exactement ce qu'on ne veut pas d'une ligne déjà teintée par nos
    // soins. Les fragments non fiables, eux, sont passés à `tronquer` au
    // moment de leur composition, en amont d'ici.
    const coupee =
      largeurVisible(ligne) <= interieur ? ligne : tronquer(ligne, interieur, caps.unicode);
    return `${b.v} ${completer(coupee, interieur)} ${b.v}`;
  });
  return [dessus, ...corps, dessous];
}

/**
 * La marque : un hexagone, le nom, la version. Quatre lignes au plus (§6.1),
 * affichées UNE SEULE FOIS, en haut.
 */
export function banniere(version: string, caps: Capacites): string[] {
  const hexagone = caps.unicode ? '⬡' : '<>';
  const titre = `${hexagone}  H I V E`;
  const sous = "Orchestration communautaire d'agents IA";

  if (!caps.cadres) {
    // Hors cadre, la version doit rester lisible : elle passe sur la ligne.
    const tiret = caps.unicode ? '—' : '-';
    return [tronquer(`${titre}  ${tiret}  ${sous}  (v${version})`, caps.largeur, caps.unicode)];
  }

  const interieur = caps.largeur - 4;
  const marque = `v${version}`;
  const espace = Math.max(2, interieur - largeurVisible(sous) - largeurVisible(marque));
  // ─── LA FRISE D'HEXAGONES A ÉTÉ RETIRÉE, ET C'EST UNE LEÇON ──────────────
  //
  // Une première version dessinait une frise `⬢⬡⬢⬡…` au-dessus du titre. La
  // marque en blocs l'a rendue INATTEIGNABLE : elle tient dès 26 colonnes, et
  // sous 60 les cadres sont abandonnés — il n'existe donc aucune largeur où la
  // frise pouvait encore s'afficher.
  //
  // Mes propres tests l'ont montré en rougissant. La règle du § 6.2 vaut ici
  // mot pour mot : « on ne garde pas une variante qui ne peut pas aboutir, elle
  // donne l'illusion d'une couverture ». Trente lignes d'ornement mort, testées,
  // auraient fait croire à un repli qui n'existait plus.
  const blocs = marqueBlocs(interieur, caps);
  return cadre(
    [
      ...(blocs.length > 0 ? blocs : [degrade(titre, caps)]),
      `${sous}${' '.repeat(espace)}${teinter(marque, 'discret', caps)}`,
    ],
    caps,
  );
}

/**
 * La marque en lettres de blocs — trois lignes, dessinées au demi-pixel.
 *
 * ─── POURQUOI TROIS LIGNES ET PAS CINQ ──────────────────────────────────────
 *
 * Les demi-blocs `▀▄█` permettent deux rangées de pixels par ligne de texte :
 * une capitale lisible tient donc en trois lignes là où un dessin en `#` en
 * demanderait cinq. La charte plafonne la bannière à quatre lignes (§6.1) — et
 * cette limite est juste : l'écran suivant, celui des prérequis, est ce que la
 * personne est venue lire.
 *
 * ─── QUAND ELLE N'APPARAÎT PAS ──────────────────────────────────────────────
 *
 * Elle demande les mêmes trois conditions que la frise, PLUS de la largeur :
 * sous 68 colonnes la marque déborderait, et une marque coupée est pire qu'une
 * marque absente. Le repli est le titre d'une ligne, qui n'a jamais démérité.
 */
export const BLOCS_HIVE: readonly string[] = [
  '█  █  ███  █   █  ████',
  '████   █    █ █   ███ ',
  '█  █  ███    █    ████',
];

function marqueBlocs(largeur: number, caps: Capacites): string[] {
  if (!caps.unicode || !caps.cadres || caps.couleur < 16777216) return [];
  const besoin = Math.max(...BLOCS_HIVE.map((l) => [...l].length));
  if (largeur < besoin) return [];
  // Le dégradé descend d'une ligne à l'autre : chaque ligne part d'un point
  // différent de la rampe, sinon les trois seraient identiques et le relief
  // disparaîtrait.
  return BLOCS_HIVE.map((ligne, i) => {
    const depart = i / (BLOCS_HIVE.length * 2);
    return degradeDepuis(ligne, depart, caps);
  });
}

/**
 * Comme `degrade`, mais en partant d'un point donné de la rampe.
 *
 * Sert au relief de la marque : trois lignes qui parcourent la même rampe
 * depuis le même début se ressemblent trop pour qu'on voie qu'elles forment un
 * bloc.
 */
export function degradeDepuis(texte: string, depart: number, caps: Capacites): string {
  if (caps.couleur === 0 || texte === '') return texte;
  if (caps.couleur < 16777216) return teinter(texte, 'accent', caps);
  const points = [...texte];
  const dernier = Math.max(1, points.length - 1);
  let sortie = '';
  for (const [i, c] of points.entries()) {
    sortie += c === ' ' ? c : `${rvb(miel(depart + (1 - depart) * (i / dernier)))}${c}`;
  }
  return `${sortie}${REPRISE}`;
}

/** Le titre d'une section — discret, parce que c'est le contenu qui compte. */
export function titreSection(texte: string, caps: Capacites): string[] {
  return [`  ${teinter(tronquer(texte, caps.largeur - 2, caps.unicode), 'discret', caps)}`];
}

/** Une ligne de vérification : son état, ce qui est vérifié, et le constat. */
export interface Verification {
  etat: Etat;
  libelle: string;
  /** Le constat, aligné en colonne. Facultatif. */
  valeur?: string | undefined;
  /** La précision, poussée à droite. Facultative. */
  note?: string | undefined;
}

/** Colonne où commencent les constats, pour qu'ils s'alignent entre eux. */
const COLONNE_VALEUR = 30;

/**
 * `  ✔  Node v24.8.0                                     (≥ 24 requis)`
 *
 * L'alignement n'est pas cosmétique : c'est ce qui permet de balayer la liste
 * du regard et de repérer la seule ligne qui n'est pas un `✔`.
 */
export function ligneVerification(v: Verification, caps: Capacites): string {
  const tete = `  ${symbole(v.etat, caps)}  `;
  const disponible = caps.largeur - largeurVisible(tete);
  // La note est coupée AVANT de servir de réserve : sans cela, une note
  // démesurée laisserait un libellé d'un caractère puis déborderait quand
  // même, puisque rien ne la bornait. Elle ne prend jamais plus de la moitié.
  const note = tronquer(v.note ?? '', Math.floor(disponible / 2), caps.unicode);
  const reserve = note === '' ? 0 : largeurVisible(note) + 2;

  const libelle = tronquer(v.libelle, Math.max(1, disponible - reserve), caps.unicode);
  let corps = v.valeur ? completer(libelle, COLONNE_VALEUR) + v.valeur : libelle;
  corps = tronquer(corps, Math.max(1, disponible - reserve), caps.unicode);

  if (note === '') return tete + corps;
  const espace = Math.max(2, disponible - largeurVisible(corps) - largeurVisible(note));
  return tete + corps + ' '.repeat(espace) + teinter(note, 'discret', caps);
}

/** Une option du menu, et ce qu'elle veut dire. */
export interface Option {
  libelle: string;
  aide?: string | undefined;
}

/**
 * Le menu des trois chemins d'entrée (§5).
 *
 * Le curseur est porté par le symbole ET par l'accent : une ruche lancée sans
 * couleur — ou par quelqu'un qui n'en distingue pas — doit rester navigable.
 * Se reposer sur la seule couleur pour dire « vous êtes ici » exclut des gens.
 */
export function menu(options: readonly Option[], index: number, caps: Capacites): string[] {
  return options.map((option, i) => {
    const choisi = i === index;
    const tete = choisi ? `  ${symbole('curseur', caps)} ` : '    ';
    const reste = caps.largeur - largeurVisible(tete);
    // Coupée d'abord, comme la note d'une vérification, et pour la même
    // raison : c'est du texte qui peut venir d'ailleurs.
    const aide = tronquer(option.aide ?? '', Math.floor(reste / 2), caps.unicode);
    const reserve = aide === '' ? 0 : largeurVisible(aide) + 2;
    const libelle = tronquer(option.libelle, Math.max(1, reste - reserve), caps.unicode);
    const ligne = choisi ? teinter(tete + libelle, 'accent', caps) : tete + libelle;
    if (aide === '') return ligne;
    const espace = Math.max(2, reste - largeurVisible(libelle) - largeurVisible(aide));
    return ligne + ' '.repeat(espace) + teinter(aide, 'discret', caps);
  });
}

/** Le rappel des touches, sous le menu. */
export function aideTouches(caps: Capacites): string[] {
  const texte = caps.unicode
    ? '↑↓ choisir · ⏎ valider · ^C annuler'
    : 'haut/bas choisir - Entree valider - ^C annuler';
  return [`  ${teinter(texte, 'discret', caps)}`];
}

/**
 * Le jeton engendré, montré UNE SEULE FOIS.
 *
 * Encadré, avec la consigne (§6.3). Le secret est affiché en clair et c'est
 * voulu : il faut bien que son propriétaire le voie une fois. Ce qui ne doit
 * jamais arriver, c'est qu'il soit RÉ-affiché ensuite, ou journalisé — et ça,
 * c'est la responsabilité de l'appelant, pas du rendu.
 */
export function encadreJeton(jeton: string, caps: Capacites): string[] {
  return cadre(
    [
      teinter('Le jeton de votre ruche', 'accent', caps),
      '',
      jeton,
      '',
      'Ne le publiez jamais. Pour connecter quelqu’un, partagez un',
      'billet d’invitation : éphémère, à usage compté, révocable.',
    ],
    caps,
  );
}

/**
 * Le récapitulatif des écritures, montré AVANT qu'aucune n'ait lieu.
 *
 * « Rien n'est écrit avant un récapitulatif listant les chemins touchés.
 * C'est ce qui rend l'installeur lançable sans peur. » (§6.3) Un installeur
 * qu'on n'ose pas lancer n'installe rien.
 */
export function recapEcritures(chemins: readonly string[], caps: Capacites): string[] {
  if (chemins.length === 0) {
    return [`  ${teinter('Rien à écrire — tout est déjà en place.', 'discret', caps)}`];
  }
  return [
    ...titreSection('Ce qui va être écrit, et rien d’autre', caps),
    '',
    ...chemins.map(
      (c) => `  ${symbole('avenir', caps)}  ${tronquer(c, caps.largeur - 5, caps.unicode)}`,
    ),
  ];
}

/**
 * La forme linéaire : une ligne par étape, pour un `stdout` qui n'est pas un
 * terminal (§6.4).
 *
 * Sans cadre, sans curseur, sans couleur — c'est ce que lira une CI, un
 * `ssh machine commande`, ou le fichier de log de quelqu'un dans six mois.
 */
export function etapeLineaire(v: Verification, caps: Capacites): string {
  const marque = { fait: 'OK', curseur: '..', avenir: '..', alerte: 'ATTENTION', echec: 'ECHEC' }[
    v.etat
  ];
  const morceaux = [v.libelle, v.valeur, v.note].filter((m): m is string => !!m && m !== '');
  return tronquer(`[${marque}] ${morceaux.join(' — ')}`, caps.largeur, caps.unicode);
}

/**
 * Une ligne de constat, rendue selon qu'on a un terminal ou un tuyau.
 *
 * Le choix entre les deux formes ci-dessus est une décision de RENDU, et il
 * vivait recopié dans l'installeur. Deux copies d'une même règle finissent par
 * diverger — c'est la leçon que ce dépôt vient de payer six fois sur le
 * plancher de Node.
 */
export function constat(v: Verification, caps: Capacites): string {
  return caps.cadres ? ligneVerification(v, caps) : etapeLineaire(v, caps);
}

// ─── LE RAIL ─────────────────────────────────────────────────────────────────
//
// L'identité de l'installeur, et la seule chose qui la porte.
//
// ─── CE QU'UN RAIL RÉSOUT, ET QU'UNE LISTE DE ✔ NE RÉSOUT PAS ────────────────
//
// Une suite de lignes cochées répond à « est-ce que ça a marché ? ». Elle ne
// répond jamais à « où en suis-je, et combien reste-t-il ? » — deux questions
// que se pose quiconque regarde une installation avancer. Le rail y répond par
// sa FORME : une colonne continue, des perles hexagonales pleines derrière soi
// et creuses devant, et une ligne de conduite entre les deux qui ne se rompt
// jamais.
//
// ─── DEUX ALPHABETS, DEUX SENS, ET SURTOUT PAS TROIS ─────────────────────────
//
// · L'HEXAGONE est une ÉTAPE de l'installation. C'est la marque de la ruche.
// · `✔ ✘ ⚠` — l'alphabet qui existait déjà — reste ce qu'il était : une
//   VÉRIFICATION à l'intérieur d'une étape.
//
// On n'invente pas un troisième vocabulaire pour dire ce que le premier disait
// déjà : c'est le § 9 bis du journal, celui des deux chemins pour un même geste
// dont le moins fréquenté finit par mentir.

/** Les perles du rail. Chacune fait EXACTEMENT une colonne — sinon tout glisse. */
const PERLES_UNICODE: Record<Etat, string> = {
  fait: '⬢',
  curseur: '⬡',
  avenir: '⬡',
  alerte: '⬢',
  echec: '✘',
};

/**
 * Le repli ASCII des perles.
 *
 * Sans couleur ni Unicode, `⬢` plein et `⬡` creux deviendraient indiscernables :
 * on change donc de FORME, pas seulement de teinte. `#` se lit « rempli » et
 * `.` se lit « vide » dans tous les terminaux du monde depuis quarante ans.
 */
const PERLES_ASCII: Record<Etat, string> = {
  fait: '#',
  curseur: '>',
  avenir: '.',
  alerte: '#',
  echec: 'x',
};

/** Un pas de l'installation, tel que l'appelant le décrit. */
export interface Pas {
  readonly nom: string;
  readonly etat: Etat;
  /** Durée écoulée, en millisecondes. Affichée seulement si la place existe. */
  readonly duree?: number;
  /** Une ligne de détail, portée par le rail sous le pas. */
  readonly note?: string;
}

/**
 * Une durée, en français, à la précision que l'œil peut lire.
 *
 * ─── POURQUOI PAS TOUJOURS LA MÊME UNITÉ ────────────────────────────────────
 *
 * `0,412 s` demande de compter les décimales ; `12,138 s` ne dit rien de plus
 * que `12 s` ; et `128,4 s` oblige à diviser de tête. La précision utile décroît
 * quand la durée croît — un chiffre après la virgule sous dix secondes, aucun
 * au-delà, et des minutes dès qu'il y en a.
 *
 * La virgule est décimale : c'est un installeur en français.
 */
export function dureeCourte(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1).replace('.', ',')} s`;
  if (s < 60) return `${String(Math.round(s))} s`;
  const min = Math.floor(s / 60);
  const reste = Math.round(s - min * 60);
  return reste === 0 ? `${String(min)} min` : `${String(min)} min ${String(reste)} s`;
}

/**
 * Une ligne dont les deux bouts sont séparés par une fuite de points.
 *
 * ─── ET CE QU'ELLE FAIT QUAND ÇA NE TIENT PAS ────────────────────────────────
 *
 * Elle ABANDONNE la partie droite, entière. Deux mauvaises solutions ont été
 * écartées : tronquer la droite (`12,1 …`) donne un chiffre faux, ce qui est
 * pire que pas de chiffre ; et laisser déborder casse l'alignement de toutes
 * les lignes suivantes, donc l'effet même que le rail existe pour produire.
 *
 * Il faut au moins deux points de fuite pour que la fuite se lise comme une
 * fuite et non comme une faute de frappe.
 */
export function ligneAFuite(
  gauche: string,
  droite: string,
  largeur: number,
  caps: Capacites,
): string {
  if (droite === '') return gauche;
  const point = caps.unicode ? '·' : '.';
  const manque = largeur - largeurVisible(gauche) - largeurVisible(droite) - 2;
  if (manque < 2) return gauche;
  return `${gauche} ${teinter(point.repeat(manque), 'discret', caps)} ${droite}`;
}

/**
 * Un pas et, s'il en porte une, sa note — rail compris.
 *
 * Rendu séparément du rail entier parce que l'installeur RÉAFFICHE le pas en
 * cours à chaque tour de spinner : redessiner toute la colonne à chaque image
 * ferait clignoter ce qui n'a pas bougé.
 */
export function railPas(pas: Pas, caps: Capacites): string[] {
  const perle = (caps.unicode ? PERLES_UNICODE : PERLES_ASCII)[pas.etat];
  const barre = caps.unicode ? '│' : '|';

  // ─── LE PAS EN COURS EST LA CHOSE LA PLUS CLAIRE DE L'ÉCRAN ───────────────
  //
  // Le pas FAIT s'allume en ambre, ce qui reste à faire s'efface, et le pas EN
  // COURS porte le dégradé — mais À PARTIR DU MILIEU de la rampe.
  //
  // La première version partait de zéro, c'est-à-dire du brun le plus sombre :
  // la ligne active était alors la MOINS visible de la colonne, exactement
  // l'inverse de ce qu'elle doit être. Ça ne se voyait pas dans les tests, qui
  // vérifient des largeurs et des glyphes ; ça s'est vu en le regardant tourner.
  const teteBrute = `${perle}  ${pas.nom}`;
  const tete =
    pas.etat === 'avenir'
      ? teinter(teteBrute, 'discret', caps)
      : pas.etat === 'curseur'
        ? degradeDepuis(teteBrute, 0.5, caps)
        : teinter(teteBrute, 'accent', caps);

  const chrono = pas.duree === undefined ? '' : teinter(dureeCourte(pas.duree), 'discret', caps);
  const lignes = [`  ${ligneAFuite(tete, chrono, caps.largeur - 2, caps)}`];

  if (pas.note !== undefined && pas.note !== '') {
    // ─── LA NOTE VIENT DU DEHORS ────────────────────────────────────────────
    //
    // C'est une sortie de `npm`, un message de `git`, un chemin de disque.
    // `nettoyer` AVANT `tronquer`, et dans cet ordre : le second ne connaît que
    // les séquences de couleur, et laissait passer `\x1b[2J` — efface l'écran —
    // parce qu'elle finit par `J`. Un test l'a montré en rougissant.
    const place = caps.largeur - 7;
    const propre = tronquer(nettoyer(pas.note), place, caps.unicode);
    lignes.push(`  ${teinter(barre, 'discret', caps)}  ${teinter(propre, 'discret', caps)}`);
  }
  return lignes;
}

/**
 * La colonne entière : les pas, reliés, sans rupture.
 *
 * ─── POURQUOI LA LIAISON N'EST PAS UNE LIGNE VIDE ────────────────────────────
 *
 * Séparer les pas par du blanc rendrait une liste espacée. Ce qui fait le rail,
 * c'est que le trait CONTINUE entre deux perles : l'œil suit une colonne et pas
 * une énumération. C'est un caractère par ligne, et c'est tout l'effet.
 */
export function rail(pas: readonly Pas[], caps: Capacites): string[] {
  const barre = caps.unicode ? '│' : '|';
  const lignes: string[] = [];
  for (const [i, p] of pas.entries()) {
    if (i > 0) lignes.push(`  ${teinter(barre, 'discret', caps)}`);
    lignes.push(...railPas(p, caps));
  }
  return lignes;
}

/**
 * Le panneau de fin : ce qu'il reste à taper, encadré.
 *
 * ─── POURQUOI UN CADRE ICI, ET NULLE PART AILLEURS ───────────────────────────
 *
 * Une installation qui se termine laisse la personne devant une question :
 * « et maintenant ? ». La réponse ne doit pas se chercher dans le défilement.
 * Le cadre est le seul endroit de l'écran qui survit au coup d'œil — donc le
 * seul endroit où mettre les deux commandes qui suivent.
 *
 * Sous `LARGEUR_MIN_CADRES`, `cadre` abandonne ses bordures de lui-même : le
 * titre reste, les commandes restent, et rien ne déborde.
 */
export function panneau(titre: string, lignes: readonly string[], caps: Capacites): string[] {
  const hexagone = caps.unicode ? '⬢' : '#';
  return cadre(
    [
      degrade(`${hexagone}  ${titre}`, caps),
      ...(lignes.length > 0 ? [''] : []),
      ...lignes.map((l) => `   ${teinter(l, 'accent', caps)}`),
    ],
    caps,
  );
}
