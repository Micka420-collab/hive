// Le terminal — la seule partie de l'accueil qui a des effets.
//
// ─── LA LIGNE DE PARTAGE ─────────────────────────────────────────────────────
//
// `rendu.ts` décide de ce qui s'affiche et n'a aucun effet. Ce fichier-ci a
// des effets et ne décide de presque rien : mode brut, lecture des touches,
// curseur, signaux, et surtout LA RESTAURATION.
//
// Le peu qu'il décide — quelle touche est quoi, où va le curseur d'un menu —
// est extrait en fonctions PURES (`toucheDe`, `deplacer`), parce que le mode
// brut ne se teste pas et que ces deux-là sont exactement l'endroit où les
// bugs se logent (la flèche haut envoie trois octets, pas un ; ^C n'est pas
// une lettre ; l'index ne doit pas sortir de la liste).
//
// ─── LA PROPRIÉTÉ QUI COMPTE ─────────────────────────────────────────────────
//
// LE TERMINAL EST TOUJOURS RENDU. Mode brut coupé, curseur réaffiché — que la
// fonction se termine, lève, ou soit interrompue par ^C. Un installeur qui
// laisse un terminal en mode brut oblige son utilisateur à taper `reset` à
// l'aveugle dans un shell qui n'affiche plus ce qu'il écrit. C'est la pire
// impression qu'un premier écran puisse laisser, et elle est parfaitement
// évitable : un `finally`.
//
// ─── ANSI ET COULEUR : DEUX CHOSES DIFFÉRENTES ───────────────────────────────
//
// `rendu.ts` n'émet aucun octet d'échappement dès que la couleur est coupée.
// Ici, c'est autre chose : DÉPLACER le curseur et EFFACER des lignes sont des
// séquences ANSI qui n'ont rien à voir avec la couleur, et sans elles un menu
// navigable est impossible. Elles sont donc conditionnées à `interactif`
// (est-on sur un vrai terminal ?) et jamais à la couleur. `NO_COLOR` veut dire
// « pas de couleur » — pas « pas de terminal ».

import { CODE } from '../codes-sortie.js';
import { aideTouches, capacites, menu, type Capacites, type Option } from './rendu.js';

// ─── Les touches ─────────────────────────────────────────────────────────────

export type Touche = 'haut' | 'bas' | 'entree' | 'annuler' | 'autre';

/**
 * Traduit une séquence d'octets en intention.
 *
 * Une flèche n'est pas un caractère : c'est `ESC [ A`, trois octets, et
 * `ESC O A` dans certains terminaux en mode application (c'est le cas de
 * `tmux` et de quelques émulateurs anciens). Ne gérer que le premier laisse
 * un menu figé chez une partie des gens, sans message d'erreur — juste des
 * flèches qui ne font rien.
 */
export function toucheDe(brut: string): Touche {
  switch (brut) {
    case '\x1b[A':
    case '\x1bOA':
    case 'k':
      return 'haut';
    case '\x1b[B':
    case '\x1bOB':
    case 'j':
      return 'bas';
    case '\r':
    case '\n':
      return 'entree';
    // ^C, ^D, Échap seul, et « q » : quatre façons de dire « laisse-moi
    // sortir ». Les honorer toutes coûte trois lignes ; n'en honorer qu'une
    // laisse quelqu'un coincé dans un menu qu'il veut quitter.
    case '\x03':
    case '\x04':
    case '\x1b':
    case 'q':
      return 'annuler';
    default:
      return 'autre';
  }
}

/**
 * Découpe un tampon d'octets en touches, et rend ce qui reste incomplet.
 *
 * ─── LE BUG QUE CETTE FONCTION CORRIGE ───────────────────────────────────────
 *
 * Une flèche fait TROIS octets, et rien ne garantit qu'ils arrivent ensemble.
 * Sur une liaison lente, en SSH, ou sous charge, `ESC` peut être livré seul,
 * puis `[B` à la lecture suivante. `toucheDe('\x1b')` rendait « annuler » :
 * l'installeur se FERMAIT au lieu de descendre d'une ligne, et la personne
 * n'avait aucune idée de ce qui venait de se passer.
 *
 * Vérifié en vrai, pas supposé : sur un terminal simulé, une flèche envoyée en
 * deux morceaux quittait l'installeur.
 *
 * La correction n'utilise PAS de minuterie — une minuterie rendrait le
 * comportement dépendant de la charge de la machine, donc intestable et
 * capricieux. Un `ESC` seul est simplement RETENU jusqu'à ce que la suite
 * arrive : si elle complète une flèche, c'est une flèche ; sinon, c'est bien
 * une annulation. Le prix est qu'Échap n'annule plus instantanément — mais
 * `^C`, `^D` et « q » le font toujours, et une flèche qui marche vaut mieux
 * qu'un raccourci qui gagne un dixième de seconde.
 */
export function decouper(tampon: string): { touches: Touche[]; reste: string } {
  const touches: Touche[] = [];
  let i = 0;
  while (i < tampon.length) {
    if (tampon[i] === '\x1b') {
      const suite = tampon.slice(i, i + 3);
      // Incomplet : on garde et on attend la suite.
      if (suite.length < 2) break;
      if ((suite[1] === '[' || suite[1] === 'O') && suite.length < 3) break;
      if (suite[1] === '[' || suite[1] === 'O') {
        const touche = toucheDe(suite);
        // Une séquence reconnue est consommée ; une séquence inconnue
        // (`ESC [ C`, `ESC [ 5 ~`…) est ignorée plutôt qu'interprétée au
        // hasard — mais consommée, sinon elle bloquerait le tampon.
        if (touche !== 'autre') touches.push(touche);
        i += 3;
        continue;
      }
      touches.push('annuler');
      i += 1;
      break;
    }
    const touche = toucheDe(tampon[i]!);
    touches.push(touche);
    i += 1;
    // ON S'ARRÊTE À CE QUI TRANCHE. Le reste du tampon appartient à la
    // question suivante, et doit lui parvenir TEL QUEL : le ré-encoder
    // détruirait le texte (« ruche.exemple.fr » n'est pas une suite de
    // touches de menu), ce qui faisait perdre les réponses saisies d'avance.
    if (touche === 'entree' || touche === 'annuler') break;
  }
  return { touches, reste: tampon.slice(i) };
}

/**
 * Où va le curseur. Borné aux extrémités, sans rebouclage.
 *
 * Le rebouclage ferait sauter du dernier choix au premier sur une frappe de
 * trop — sur un menu où le dernier choix est « installer sur un serveur » et
 * le premier « ouvrir ma propre ruche », ce n'est pas une bonne surprise.
 */
export function deplacer(index: number, touche: Touche, nombre: number): number {
  if (nombre <= 0) return 0;
  const borne = (i: number): number => Math.max(0, Math.min(nombre - 1, i));
  if (touche === 'haut') return borne(index - 1);
  if (touche === 'bas') return borne(index + 1);
  return borne(index);
}

// ─── Les erreurs qui portent un code de sortie ───────────────────────────────

/** L'humain a demandé à sortir. Ce n'est pas un échec — c'est une réponse. */
export class Interrompu extends Error {
  readonly code = CODE.INTERROMPU;
  constructor() {
    super('interrompu');
    this.name = 'Interrompu';
  }
}

/**
 * On avait besoin d'une réponse et personne ne pouvait la donner.
 *
 * Nomme la question : « il manque une réponse » sans dire laquelle oblige à
 * lire le code source pour écrire un script.
 */
export class ReponseManquante extends Error {
  readonly code = CODE.REPONSE_MANQUANTE;
  constructor(quoi: string) {
    super(`réponse requise absente en mode non interactif : ${quoi}`);
    this.name = 'ReponseManquante';
  }
}

// ─── Les flux, injectés ──────────────────────────────────────────────────────

export interface FluxEntree {
  setRawMode?: (actif: boolean) => void;
  on: (evenement: 'data', gestionnaire: (donnee: Buffer | string) => void) => void;
  off: (evenement: 'data', gestionnaire: (donnee: Buffer | string) => void) => void;
  resume: () => void;
  pause: () => void;
  isTTY?: boolean | undefined;
}

export interface FluxSortie {
  write: (texte: string) => void;
  isTTY?: boolean | undefined;
  columns?: number | undefined;
}

export interface Terminal {
  readonly caps: Capacites;
  /** Écrit des lignes déjà composées par `rendu.ts`. */
  ecrire: (lignes: readonly string[]) => void;
  /**
   * Pose un choix. `defautNonInteractif` est l'index retenu hors terminal ;
   * sans lui, l'absence de réponse est une ERREUR de code 3, jamais un choix
   * deviné en silence.
   */
  choisir: (
    options: readonly Option[],
    opts: { quoi: string; depart?: number; defautNonInteractif?: number },
  ) => Promise<number>;
  /**
   * Demande une ligne de texte (un domaine, un nom de projet).
   *
   * Même règle que `choisir` : hors terminal, soit un défaut DOCUMENTÉ, soit
   * une erreur nommée. Une ligne vide vaut le défaut quand il y en a un —
   * c'est ce qui permet de valider par ⏎ sans rien taper.
   */
  demander: (
    question: string,
    opts: { quoi: string; defaut?: string; obligatoire?: boolean },
  ) => Promise<string>;
  /** Rend le terminal à son propriétaire. Idempotent. */
  restaurer: () => void;
}

const CURSEUR_CACHE = '\x1b[?25l';
const CURSEUR_MONTRE = '\x1b[?25h';

/**
 * Remonte de `n` lignes et efface tout ce qui suit.
 *
 * ─── POURQUOI `<= 0` ET PAS `< 0` ────────────────────────────────────────────
 *
 * Exporté pour être éprouvé : un balayage élargi a montré la borne mutable sans
 * qu'une assertion bouge, et le cas ZÉRO n'est pas anodin. `\x1b[0A` ne remonte
 * de rien — mais `\x1b[0J` EFFACE du curseur jusqu'au bas de l'écran. Rendre la
 * séquence pour `n === 0`, c'est effacer ce qui suit alors qu'on n'avait rien à
 * reprendre : l'écran perd du texte que personne n'a demandé à retirer.
 *
 * Une chaîne vide est la seule réponse juste à « remonte de zéro ligne ».
 */
export function effacerLignes(n: number): string {
  return n <= 0 ? '' : `\x1b[${n}A\x1b[0J`;
}

/**
 * Fabrique un terminal au-dessus des flux donnés.
 *
 * Rien n'est lu de `process` ici : c'est l'appelant qui passe ses flux et son
 * environnement. C'est ce qui rend `choisir` testable avec un faux clavier,
 * séquence d'octets par séquence d'octets.
 */
export function creerTerminal(opts: {
  entree: FluxEntree;
  sortie: FluxSortie;
  env?: Record<string, string | undefined>;
  /**
   * Comment lire une ligne. Injecté pour que `demander` se teste sans
   * terminal ; par défaut, `node:readline/promises`, l'idiome déjà employé
   * par `join.ts` et `cli.ts`.
   */
  lireLigne?: (question: string) => Promise<string>;
}): Terminal {
  const { entree, sortie } = opts;
  const caps = capacites(opts.env ?? {}, { isTTY: sortie.isTTY, columns: sortie.columns });
  let brutActif = false;
  let curseurCache = false;

  // ─── LE TAMPON EST PORTÉ PAR LE TERMINAL, PAS PAR LA QUESTION ──────────────
  //
  // Second défaut trouvé en lançant l'installeur pour de vrai : un terminal ne
  // livre pas une touche à la fois. Une frappe rapide, un collage, ou une
  // session pilotée par script arrivent en UN SEUL morceau —
  // « \n\x1b[B\x1b[B\n » pour trois réponses. Tant que le tampon vivait dans
  // `choisir`, tout ce qui suivait la touche de validation était JETÉ : la
  // question suivante s'ouvrait sur un flux vide, puis prenait la fin de
  // l'entrée pour une annulation.
  //
  // Le garder ici fait que les réponses déjà arrivées attendent la question
  // qui les concerne.
  let tampon = '';

  const restaurer = (): void => {
    if (brutActif) {
      entree.setRawMode?.(false);
      entree.pause();
      brutActif = false;
    }
    if (curseurCache) {
      sortie.write(CURSEUR_MONTRE);
      curseurCache = false;
    }
  };

  const ecrire = (lignes: readonly string[]): void => {
    if (lignes.length > 0) sortie.write(`${lignes.join('\n')}\n`);
  };

  const choisir = async (
    options: readonly Option[],
    o: { quoi: string; depart?: number; defautNonInteractif?: number },
  ): Promise<number> => {
    if (options.length === 0) throw new ReponseManquante(o.quoi);

    // Hors terminal — CI, pipe, `ssh machine commande` — on ne peut rien
    // demander. Ou bien l'appelant a prévu un défaut DOCUMENTÉ, ou bien c'est
    // une erreur nommée. Jamais un choix silencieux.
    if (!caps.interactif || typeof entree.setRawMode !== 'function') {
      if (o.defautNonInteractif === undefined) throw new ReponseManquante(o.quoi);
      return Math.max(0, Math.min(options.length - 1, o.defautNonInteractif));
    }

    let index = Math.max(0, Math.min(options.length - 1, o.depart ?? 0));

    const peindre = (premier: boolean): void => {
      const lignes = [...menu(options, index, caps), '', ...aideTouches(caps)];
      sortie.write((premier ? '' : effacerLignes(lignes.length)) + lignes.join('\n') + '\n');
    };

    entree.setRawMode(true);
    brutActif = true;
    entree.resume();
    sortie.write(CURSEUR_CACHE);
    curseurCache = true;
    peindre(true);

    try {
      return await new Promise<number>((resoudre, rejeter) => {
        const traiter = (): boolean => {
          const { touches, reste } = decouper(tampon);
          tampon = reste;
          for (const touche of touches) {
            if (touche === 'annuler') {
              rejeter(new Interrompu());
              return true;
            }
            if (touche === 'entree') {
              // `decouper` s'est arrêté ici : ce qui suit est déjà dans le
              // tampon, intact, et attend la question suivante.
              resoudre(index);
              return true;
            }
            const suivant = deplacer(index, touche, options.length);
            if (suivant !== index) {
              index = suivant;
              peindre(false);
            }
          }
          return false;
        };

        const surDonnee = (donnee: Buffer | string): void => {
          tampon += donnee.toString('utf8');
          if (traiter()) entree.off('data', surDonnee);
        };
        entree.on('data', surDonnee);
        // Des réponses peuvent DÉJÀ être arrivées, livrées avec celles de la
        // question précédente. Les traiter avant d'attendre quoi que ce soit.
        if (traiter()) entree.off('data', surDonnee);
      });
    } finally {
      // La raison d'être de ce fichier : quoi qu'il arrive au-dessus — choix,
      // ^C, exception — le terminal est rendu dans l'état où on l'a trouvé.
      restaurer();
    }
  };

  const lireLigne =
    opts.lireLigne ??
    (async (question: string): Promise<string> => {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({
        input: entree as unknown as NodeJS.ReadableStream,
        output: sortie as unknown as NodeJS.WritableStream,
      });
      try {
        return await rl.question(question);
      } finally {
        // Même règle que le mode brut : ce qu'on ouvre, on le referme.
        rl.close();
      }
    });

  const demander = async (
    question: string,
    o: { quoi: string; defaut?: string; obligatoire?: boolean },
  ): Promise<string> => {
    if (!caps.interactif) {
      if (o.defaut !== undefined) return o.defaut;
      throw new ReponseManquante(o.quoi);
    }
    const invite = o.defaut ? `${question} [${o.defaut}] ` : `${question} `;
    for (;;) {
      // Une réponse peut déjà être dans le tampon, livrée en même temps que
      // les précédentes. La consommer ici plutôt que de la jeter est ce qui
      // rend l'assistant pilotable par un script.
      const fin = tampon.search(/[\r\n]/);
      if (fin >= 0) {
        const ligne = tampon.slice(0, fin).trim();
        tampon = tampon.slice(fin + 1);
        sortie.write(invite + ligne + '\n');
        if (ligne !== '') return ligne;
        if (o.defaut !== undefined) return o.defaut;
        if (!o.obligatoire) return '';
        sortie.write('  (une réponse est nécessaire)\n');
        continue;
      }
      const brut = (await lireLigne(invite)).trim();
      if (brut !== '') return brut;
      if (o.defaut !== undefined) return o.defaut;
      // Obligatoire et vide : on redemande plutôt que d'inventer. Rendre une
      // chaîne vide ferait porter la question au code appelant, qui la
      // traiterait mal une fois sur deux.
      if (!o.obligatoire) return '';
      sortie.write('  (une réponse est nécessaire)\n');
    }
  };

  return { caps, ecrire, choisir, demander, restaurer };
}
