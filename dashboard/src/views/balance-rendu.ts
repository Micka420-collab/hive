// CE QUE LA BALANCE CALCULE — décidé ici, dessiné là-bas.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// `decouper` et `effetDuMode` étaient DÉJÀ des fonctions pures. Elles vivaient
// simplement dans `Balance.tsx`, sans `export` — donc hors d'atteinte de tout
// banc qui ne monte pas la vue entière. Un balayage échantillonné de
// `dashboard/src/views` (base épinglée `f0fc005`) les a rendues nues toutes les
// deux, plus la garde du geste qui pose un plafond.
//
// C'est le cas le plus net du § 2 quaterdecies : rien à refactorer, rien à
// démêler. Une fonction pure dans un fichier de vue est déjà au bon endroit
// logiquement, et au mauvais endroit MÉCANIQUEMENT. Le seul geste manquant
// était le mot `export` — et un fichier où le poser.

// ─── TYPES STRUCTURELS, ET LA RAISON EST MESURÉE ─────────────────────────────
//
// Première version : ce module importait `Compte`, `Poste` et `Translate` de
// `../api` et `../i18n`. Le banc a alors tiré `dashboard/src/api.ts` — et toute
// sa chaîne d'imports — dans le programme du typecheck RACINE, plus strict que
// celui du tableau de bord. Résultat : quatre erreurs `TS2835` dans des
// fichiers que je n'avais pas touchés, sur des imports sans extension qui
// existaient depuis toujours et n'avaient jamais été compilés là.
//
// `src/shared/cli-rendu.ts` avait déjà résolu ça en déclarant ses formes plutôt
// qu'en les important. Le même geste ici : un module pur ne doit rien tirer
// derrière lui, sinon il n'est pur que de nom.

/** Les quatre postes d'une Balance. */
export type Poste = 'utile' | 'reprise' | 'echec' | 'rebute';

/**
 * Les trois échelons du plafond.
 *
 * ─── UN TYPE STRUCTUREL QUI INVENTE UNE VALEUR EST PIRE QU'UN IMPORT ─────────
 *
 * Première version : j'avais écrit `'leger'` pour le repli. Ce mode n'existe
 * pas — il s'appelle `off`. Le banc a alors éprouvé `effetDuMode('leger', …)`
 * et il est passé AU VERT, sur une entrée que la ruche ne produira jamais.
 *
 * Ce n'est pas le typecheck du module qui l'a dit — il était content, `'leger'`
 * étant membre du type que je venais d'inventer. C'est le typecheck du TABLEAU
 * DE BORD, au site d'appel, où le vrai type et le mien se sont enfin rencontrés.
 *
 * Un type structurel doit être un MIROIR, pas une paraphrase : dès qu'il
 * s'écarte, il fabrique des cas de test qui ne peuvent rien prouver.
 */
export type ModeBalance = 'off' | 'observation' | 'strict';

/** Traduire, tel que `useT` le rend : `t(fr, en)`. */
export type Traduire = (fr: string, en: string) => string;

/** La part d'un compte dont dépend la barre empilée. */
export interface Compte {
  utileMs: number;
  repriseMs: number;
  echecMs: number;
  rebuteMs: number;
  totalMs: number;
}

/** Les quatre postes d'une Balance, dans l'ordre où l'écran les empile. */
export const POSTES: Poste[] = ['utile', 'reprise', 'echec', 'rebute'];

/** Le champ de `Compte` qui porte les millisecondes de chaque poste. */
export const POSTE_MS: Record<Poste, 'utileMs' | 'repriseMs' | 'echecMs' | 'rebuteMs'> = {
  utile: 'utileMs',
  reprise: 'repriseMs',
  echec: 'echecMs',
  rebute: 'rebuteMs',
};

/** Un segment de la barre empilée. */
export interface Segment {
  poste: Poste;
  ms: number;
  /** Part exacte du total, en pourcentage (la largeur de la barre). */
  pct: number;
  libelle: string;
}

/**
 * La barre empilée d'un compte : un segment par poste, avec sa part exacte.
 *
 * ─── LA GARDE `> 0` EST UNE DIVISION PAR ZÉRO QUI ATTEND ─────────────────────
 *
 * Le mutant `>` → `>=` la désarme, et le résultat n'est pas « une barre un peu
 * fausse » : c'est `0 / 0`, donc **NaN**, posé dans un `width: ${pct}%`. Le
 * navigateur jette la règle, la barre disparaît, et l'écran ne dit rien.
 *
 * Le cas arrive tout seul, et il est même le PREMIER que voit un arrivant : un
 * projet neuf n'a aucune milliseconde à son compte. La garde protège donc
 * exactement l'état initial de tout le monde.
 */
export function decouper(compte: Compte, libelle: (poste: Poste) => string): Segment[] {
  return POSTES.map((poste) => {
    const ms = compte[POSTE_MS[poste]];
    return {
      poste,
      ms,
      pct: compte.totalMs > 0 ? (ms / compte.totalMs) * 100 : 0,
      libelle: libelle(poste),
    };
  });
}

/**
 * Ce que le mode de la Balance PROMET quand le plafond est franchi.
 *
 * ─── TROIS MODES, ET LA PHRASE ENGAGE LA RUCHE ───────────────────────────────
 *
 * `strict` arrête d'assigner, `observation` ne fait que journaliser, `off`
 * (le repli) ne promet rien de plus qu'un avertissement. Confondre les deux
 * premiers est le pire des trois échanges possibles : l'écran promettrait un
 * blocage à quelqu'un qui n'en aura pas, ou l'inverse — et cette phrase est lue
 * AVANT de poser un plafond, pour décider s'il faut le poser.
 *
 * Le mutant `mode === 'observation'` muté en `!==` fait tomber le mode
 * `observation` dans la branche de repli : il perdrait la seule phrase qui dit
 * « RIEN ne sera arrêté ».
 */
export function effetDuMode(mode: ModeBalance, t: Traduire): string {
  if (mode === 'strict') {
    return t(
      'la ruche cessera d’assigner de nouvelles tâches de ce projet ; celles déjà en vol iront à leur terme.',
      'the hive will stop assigning new tasks for this project; those already in flight will run to completion.',
    );
  }
  if (mode === 'observation') {
    return t(
      'la ruche est en « observation » : le franchissement sera journalisé, mais RIEN ne sera arrêté.',
      'the hive runs in “observation”: the crossing will be journaled, but NOTHING will be stopped.',
    );
  }
  return t(
    'la ruche vous avertira, sans rien interrompre.',
    'the hive will warn you, without interrupting anything.',
  );
}

/**
 * Le geste « poser un plafond » a-t-il de quoi s'exécuter ?
 *
 * Deux refus, et le mutant `||` → `&&` les annule tous les deux à la fois : il
 * faudrait que la cible soit absente ET qu'un envoi soit en cours pour bloquer.
 * Cliquer sans cible enverrait donc un plafond `null` à la ruche ; cliquer deux
 * fois vite en enverrait deux.
 */
export function peutPoser(cible: number | null, busy: boolean): boolean {
  return cible !== null && !busy;
}
