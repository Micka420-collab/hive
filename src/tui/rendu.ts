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
  [120, 63, 4],
  [166, 92, 8],
  [204, 122, 10],
  [230, 154, 20],
  [245, 184, 56],
  [252, 211, 108],
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
 * Coupe un texte à `max` colonnes, en marquant la coupe.
 *
 * Rien de ce qui vient de l'extérieur n'est affiché sans passer par ici : un
 * libellé de billet, un nom de machine ou un chemin trop long ne doit pas
 * pouvoir crever un cadre. `acces.ts` borne déjà ces libellés à 120
 * caractères sans caractère de contrôle ; cette coupe-ci est la seconde
 * ceinture, celle qui protège la MISE EN PAGE plutôt que la sécurité.
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
  return cadre(
    [
      ...rayon(interieur, caps),
      degrade(titre, caps),
      `${sous}${' '.repeat(espace)}${teinter(marque, 'discret', caps)}`,
    ],
    caps,
  );
}

/**
 * Le rayon de miel : une frise d'hexagones, en dégradé.
 *
 * ─── UN ORNEMENT QUI S'EFFACE DE LUI-MÊME ───────────────────────────────────
 *
 * Il n'apparaît QUE si trois conditions tiennent : Unicode sûr, cadres dessinés,
 * et 24 bits. Sans dégradé, une frise d'hexagones n'est plus un ornement — c'est
 * une ligne de bruit en haut de l'écran, qui vole l'attention à la seule chose
 * qui compte à cet instant : les prérequis en dessous.
 *
 * On rend un tableau vide plutôt qu'une ligne vide : `banniere` l'étale, et une
 * ligne vide de plus dans un cadre se verrait comme un défaut d'alignement.
 */
function rayon(largeur: number, caps: Capacites): string[] {
  if (!caps.unicode || !caps.cadres || caps.couleur < 16777216) return [];
  const motif = [...'⬢⬡'];
  const combien = Math.max(0, Math.min(largeur, Math.floor(largeur / 2)));
  if (combien < 4) return [];
  const frise = Array.from({ length: combien }, (_, i) => motif[i % 2]!).join(' ');
  return [degrade(tronquer(frise, largeur, true), caps)];
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
