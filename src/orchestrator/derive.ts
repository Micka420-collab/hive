// La Dérive — ce qui fait pourrir un projet laissé en autonomie longue.
//
// Le Plein Essaim sait décider. Ce module répond à la question d'après, et
// c'est elle qui décide si une autonomie de plusieurs SEMAINES est une bonne
// idée ou une catastrophe lente : comment sait-on que la ruche se dégrade ?
//
// ─── POURQUOI UN PROJET POURRIT SOUS AUTONOMIE, ET PAS AUTREMENT ─────────────
//
// Une ruche autonome referme une boucle : sa production d'aujourd'hui devient
// son contexte de demain. Quatre mécanismes en découlent, tous silencieux, tous
// cumulatifs, et aucun ne se voit sur un cycle isolé — c'est pour ça qu'ils
// passent tous les contrôles qui regardent une production à la fois.
//
//   1. LA QUALITÉ GLISSE. Les Gardiennes attrapent une production creuse ; elles
//      n'attrapent pas une production légèrement moins bonne que la précédente.
//      Répété deux mille fois, « légèrement moins bon » est une refonte.
//
//   2. LE CLIQUET DE COMPLEXITÉ. Un agent ajoute ; il ne supprime presque
//      jamais. Chaque cycle est défendable et la somme ne l'est pas. Un dépôt
//      qui ne perd jamais une ligne devient illisible, donc immodifiable, donc
//      mort — sans qu'aucun commit n'ait été fautif.
//
//   3. LA RUCHE TOURNE EN ROND. Sans mémoire de ce qui a échoué, elle repropose
//      ce qu'elle a déjà tenté. C'est le mode d'échec le plus coûteux : il
//      consomme du temps-machine réel en produisant zéro.
//
//   4. L'AUTARCIE. Après trois semaines sans un mot d'humain, tout ce que la
//      ruche lit vient de la ruche. Elle n'apprend plus du monde, elle apprend
//      d'elle-même — et une boucle qui s'auto-confirme converge, mais pas vers
//      la vérité.
//
// ─── LE PARTI PRIS : DES FAITS QUE LA RUCHE NE CHOISIT PAS ───────────────────
//
// Tous les indicateurs sont calculés sur des données que la ruche ne PRODUIT
// pas volontairement : les verdicts des Gardiennes (calculés par
// l'orchestrateur à partir du diff, jamais déclarés par un nœud), la
// composition réelle des diffs, et le temps écoulé.
//
// Ce qui est exclu, et délibérément : tout ce qu'un agent déclare. Une ruche
// jugée sur « nombre de tâches réussies » optimiserait le nombre de tâches
// réussies — c'est-à-dire ferait des tâches faciles. Un indicateur qu'on peut
// viser cesse d'être une mesure.
//
// ─── LE VERDICT EST DÉCISIF PAR INDICATEUR, JAMAIS MOYEN ─────────────────────
//
// Un score composite laisserait un indicateur catastrophique se cacher derrière
// trois bons. Chaque indicateur peut donc prononcer la dégradation À LUI SEUL.
// C'est l'inverse d'un tableau de bord : ici, un seul voyant rouge arrête tout.
//
// ─── FERMÉ PAR DÉFAUT : NE PAS POUVOIR MESURER N'EST PAS ÊTRE SAIN ───────────
//
// Sous ÉCHANTILLON_MIN productions, le verdict est `indeterminee` — et l'essaim
// traite `indeterminee` comme un motif d'arrêt, pas comme un feu vert. Une
// ruche qui perdrait ses Gardiennes (donc sa seule source de qualité) verrait
// sinon sa dérive devenir invisible juste au moment où elle devient possible.
//
// MODULE PUR — aucune I/O, aucun aléa. `now` est un PARAMÈTRE : la solitude se
// mesure en temps écoulé, et une horloge implicite rendrait le module
// intestable et le verdict non rejouable.

import type { Verdict } from './gardiennes.js';

/** Version de l'algorithme. Motif VERSION_BALANCE. */
export const VERSION_DERIVE = 1;

/**
 * Productions nécessaires pour se prononcer.
 *
 * Vingt, réparties en deux moitiés de dix : en dessous, une seule mauvaise
 * production ferait basculer un taux de 0 à 10 %, et on arrêterait une ruche
 * saine sur du bruit. Le faux positif est ici le mode d'échec grave — il
 * interrompt un travail légitime, et il apprend à l'humain à ignorer l'alarme.
 */
export const ECHANTILLON_MIN = 20;

/** Fenêtre d'observation. Bornée, comme tous les corpus du dépôt. */
export const FENETRE = 400;

// ─── Les seuils, et pourquoi ceux-là ─────────────────────────────────────────

/**
 * Hausse du taux de production fautive qui prononce la dégradation.
 *
 * En POINTS de pourcentage, entre la première et la seconde moitié de la
 * fenêtre. 15 points, c'est-à-dire : passer de 10 % à 25 % de productions
 * creuses ou suspectes. C'est franc — une ruche qui se dégrade lentement
 * atteindra ce seuil en quelques centaines de productions, une ruche qui a un
 * mauvais après-midi ne l'atteindra pas.
 */
export const HAUSSE_FAUTIVE = 0.15;

/**
 * En dessous de cette part de lignes SUPPRIMÉES, le cliquet est enclenché.
 *
 * 5 %. Un travail sain supprime : il remplace du code, retire du mort-bois,
 * remanie. Un dépôt où 95 % des lignes touchées sont des ajouts n'est pas en
 * train d'être développé, il est en train d'être empilé.
 *
 * Le seuil est BAS exprès. On ne cherche pas à imposer un ratio vertueux — on
 * cherche à attraper le cas où plus rien n'est jamais retiré.
 */
export const PART_SUPPRESSIONS_MIN = 0.05;

/**
 * En dessous de cette diversité, la ruche tourne en rond.
 *
 * Part de signatures d'échec DISTINCTES parmi les échecs. 30 % : sur dix
 * échecs, moins de trois causes différentes. Ce n'est pas de l'acharnement,
 * c'est une boucle — et elle consomme du temps-machine réel en produisant zéro.
 */
export const DIVERSITE_MIN = 0.3;

/**
 * Au-delà de ce silence humain, la ruche n'apprend plus que d'elle-même.
 *
 * Quatorze jours. Ce n'est PAS une limite d'autonomie — l'utilisateur veut des
 * semaines, il les aura. C'est le moment où la surveillance se resserre : au
 * delà, un seul indicateur `a_surveiller` suffit à prononcer la dégradation, là
 * où il en faudrait normalement un franchement rouge.
 *
 * Le raisonnement : plus la boucle est longue, moins on peut se permettre
 * d'attendre la certitude. Un doute au bout de trois jours se lève au prochain
 * passage d'un humain ; un doute au bout de six semaines ne se lèvera pas tout
 * seul.
 */
export const SOLITUDE_JOURS = 14;
const JOUR_MS = 86_400_000;

// ─── Ce qu'on observe ────────────────────────────────────────────────────────

/** Une production observée, réduite aux faits que la ruche ne choisit pas. */
export interface ProductionObservee {
  /** Verdict des Gardiennes — calculé par l'orchestrateur, jamais déclaré. */
  verdict: Verdict;
  /** Lignes ajoutées par le diff. */
  ajouts: number;
  /** Lignes supprimées par le diff. */
  suppressions: number;
  /** Signature d'échec, vide si la production a réussi (cf. essaim.ts). */
  signature: string;
  createdAt: number;
}

/** Un indicateur, avec de quoi comprendre son verdict sans lire le code. */
export interface Indicateur {
  cle: 'qualite' | 'entropie' | 'repetition' | 'solitude';
  etat: 'saine' | 'a_surveiller' | 'degradee' | 'indeterminee';
  /** La valeur mesurée. Son unité dépend de la clé — `unite` la dit. */
  valeur: number;
  unite: 'points' | 'part' | 'jours';
  /** Le seuil franchi (ou non). */
  seuil: number;
  /** Une phrase de fait, jamais une injonction. */
  constat: string;
}

export type EtatDerive = 'saine' | 'a_surveiller' | 'degradee' | 'indeterminee';

export interface Derive {
  etat: EtatDerive;
  indicateurs: Indicateur[];
  /** Productions retenues. Sous ECHANTILLON_MIN, rien n'est prononcé. */
  echantillon: number;
  /** Jours écoulés depuis le dernier apport humain. */
  solitudeJours: number;
  /**
   * Ce qui a prononcé le verdict, en une phrase. Vide si `saine`.
   * Destiné au Journal et à l'humain — jamais au prompt d'un agent.
   */
  motif: string;
}

// ─── La mesure ───────────────────────────────────────────────────────────────

/** Une production est FAUTIVE si les Gardiennes l'ont jugée creuse ou suspecte. */
function fautive(p: ProductionObservee): boolean {
  return p.verdict === 'hollow' || p.verdict === 'suspect';
}

/**
 * Compare le taux de productions fautives entre les deux moitiés de la fenêtre.
 *
 * On mesure une PENTE, pas un niveau. Un projet difficile peut vivre à 20 % de
 * productions suspectes sans que rien ne se dégrade ; ce qui compte est que ce
 * taux MONTE. Juger le niveau punirait les projets durs et laisserait filer les
 * projets faciles qui s'effondrent lentement.
 */
export function mesurerQualite(productions: readonly ProductionObservee[]): Indicateur {
  const n = productions.length;
  if (n < ECHANTILLON_MIN) {
    return {
      cle: 'qualite',
      etat: 'indeterminee',
      valeur: 0,
      unite: 'points',
      seuil: HAUSSE_FAUTIVE,
      constat: `${n} production(s) observée(s), ${ECHANTILLON_MIN} nécessaires pour se prononcer.`,
    };
  }
  const milieu = Math.floor(n / 2);
  const anciennes = productions.slice(0, milieu);
  const recentes = productions.slice(milieu);
  const taux = (lot: readonly ProductionObservee[]): number =>
    lot.length === 0 ? 0 : lot.filter(fautive).length / lot.length;
  const hausse = taux(recentes) - taux(anciennes);

  const etat =
    hausse >= HAUSSE_FAUTIVE ? 'degradee' : hausse >= HAUSSE_FAUTIVE / 2 ? 'a_surveiller' : 'saine';
  return {
    cle: 'qualite',
    etat,
    valeur: Math.round(hausse * 1000) / 10,
    unite: 'points',
    seuil: Math.round(HAUSSE_FAUTIVE * 100),
    constat: `Productions fautives : ${pourcent(taux(anciennes))} → ${pourcent(taux(recentes))}.`,
  };
}

/**
 * Part des lignes touchées qui sont des SUPPRESSIONS.
 *
 * Ne compte que les productions qui ont réellement touché du code : une
 * production sans diff (échec, ou tâche d'analyse) n'a pas d'avis à donner sur
 * le cliquet de complexité, et l'inclure diluerait le signal jusqu'à
 * l'effacer.
 */
export function mesurerEntropie(productions: readonly ProductionObservee[]): Indicateur {
  const avecDiff = productions.filter((p) => p.ajouts + p.suppressions > 0);
  if (avecDiff.length < ECHANTILLON_MIN) {
    return {
      cle: 'entropie',
      etat: 'indeterminee',
      valeur: 0,
      unite: 'part',
      seuil: PART_SUPPRESSIONS_MIN,
      constat: `${avecDiff.length} production(s) porteuse(s) de diff, ${ECHANTILLON_MIN} nécessaires.`,
    };
  }
  const ajouts = avecDiff.reduce((t, p) => t + p.ajouts, 0);
  const suppressions = avecDiff.reduce((t, p) => t + p.suppressions, 0);
  const total = ajouts + suppressions;
  const part = total === 0 ? 0 : suppressions / total;

  const etat =
    part < PART_SUPPRESSIONS_MIN
      ? 'degradee'
      : part < PART_SUPPRESSIONS_MIN * 2
        ? 'a_surveiller'
        : 'saine';
  return {
    cle: 'entropie',
    etat,
    valeur: Math.round(part * 1000) / 1000,
    unite: 'part',
    seuil: PART_SUPPRESSIONS_MIN,
    constat: `+${ajouts} / −${suppressions} lignes : ${pourcent(part)} de suppressions.`,
  };
}

/**
 * Diversité des causes d'échec.
 *
 * Une ruche qui bute toujours sur la même chose ne progresse pas : elle
 * rejoue. Mesuré sur les signatures (essaim.ts), donc sur des classes
 * d'erreur normalisées et non sur des messages bruts qui seraient tous
 * distincts par leurs numéros de ligne.
 */
export function mesurerRepetition(productions: readonly ProductionObservee[]): Indicateur {
  const echecs = productions.filter((p) => p.signature !== '');
  if (echecs.length < ECHANTILLON_MIN / 2) {
    // Peu d'échecs est une BONNE nouvelle, pas une indétermination inquiétante :
    // on ne peut simplement rien dire de la diversité de ce qui n'existe pas.
    return {
      cle: 'repetition',
      etat: 'saine',
      valeur: 1,
      unite: 'part',
      seuil: DIVERSITE_MIN,
      constat: `${echecs.length} échec(s) sur la fenêtre : trop peu pour tourner en rond.`,
    };
  }
  const distinctes = new Set(echecs.map((e) => e.signature)).size;
  const diversite = distinctes / echecs.length;

  const etat =
    diversite < DIVERSITE_MIN
      ? 'degradee'
      : diversite < DIVERSITE_MIN * 1.5
        ? 'a_surveiller'
        : 'saine';
  return {
    cle: 'repetition',
    etat,
    valeur: Math.round(diversite * 1000) / 1000,
    unite: 'part',
    seuil: DIVERSITE_MIN,
    constat: `${distinctes} cause(s) distincte(s) pour ${echecs.length} échec(s).`,
  };
}

/**
 * Temps écoulé depuis le dernier apport humain.
 *
 * N'est JAMAIS `degradee` à lui seul : le silence n'est pas une faute, et
 * l'utilisateur veut explicitement des semaines d'autonomie. Il passe à
 * `a_surveiller`, ce qui a un effet précis dans `mesurerDerive` — resserrer le
 * seuil des autres indicateurs.
 */
export function mesurerSolitude(dernierApportHumain: number | null, now: number): Indicateur {
  if (dernierApportHumain === null) {
    return {
      cle: 'solitude',
      etat: 'a_surveiller',
      valeur: Infinity,
      unite: 'jours',
      seuil: SOLITUDE_JOURS,
      constat: 'Aucun apport humain enregistré sur la fenêtre.',
    };
  }
  const jours = Math.max(0, (now - dernierApportHumain) / JOUR_MS);
  return {
    cle: 'solitude',
    etat: jours >= SOLITUDE_JOURS ? 'a_surveiller' : 'saine',
    valeur: Math.round(jours * 10) / 10,
    unite: 'jours',
    seuil: SOLITUDE_JOURS,
    constat: `${Math.round(jours * 10) / 10} jour(s) sans qu’un humain n’intervienne.`,
  };
}

/**
 * Le verdict d'ensemble.
 *
 * DEUX RÈGLES, et elles sont tout le module :
 *
 *   1. Un seul indicateur `degradee` prononce la dégradation. Pas de moyenne :
 *      un score composite laisserait un voyant rouge se cacher derrière trois
 *      verts, ce qui est exactement le mode d'échec des tableaux de bord.
 *
 *   2. En SOLITUDE PROLONGÉE, un `a_surveiller` suffit. Plus la boucle tourne
 *      sans regard extérieur, moins on peut attendre la certitude : un doute au
 *      bout de trois jours se lève au prochain passage d'un humain, un doute au
 *      bout de six semaines ne se lèvera pas tout seul.
 *
 * Et `indeterminee` n'est PAS `saine` : ne pas pouvoir mesurer est un motif
 * d'arrêt. Une ruche qui perdrait ses Gardiennes verrait sinon sa dérive
 * devenir invisible juste au moment où elle devient possible.
 */
export function mesurerDerive(opts: {
  productions: readonly ProductionObservee[];
  dernierApportHumain: number | null;
  now: number;
}): Derive {
  const productions = opts.productions.slice(-FENETRE);
  const solitude = mesurerSolitude(opts.dernierApportHumain, opts.now);
  const indicateurs: Indicateur[] = [
    mesurerQualite(productions),
    mesurerEntropie(productions),
    mesurerRepetition(productions),
    solitude,
  ];

  const seul = (etat: Indicateur['etat']): Indicateur | undefined =>
    indicateurs.find((i) => i.cle !== 'solitude' && i.etat === etat);

  const degrade = seul('degradee');
  if (degrade) {
    return rendu('degradee', indicateurs, productions.length, solitude, degrade.constat);
  }

  const isole = solitude.etat === 'a_surveiller';
  const surveiller = seul('a_surveiller');
  if (isole && surveiller) {
    // Règle 2 : le doute suffit quand plus personne ne regarde.
    return rendu(
      'degradee',
      indicateurs,
      productions.length,
      solitude,
      `${surveiller.constat} (seuil resserré : ${solitude.constat})`,
    );
  }

  const indetermine = seul('indeterminee');
  if (indetermine) {
    return rendu('indeterminee', indicateurs, productions.length, solitude, indetermine.constat);
  }
  if (surveiller) {
    return rendu('a_surveiller', indicateurs, productions.length, solitude, surveiller.constat);
  }
  return rendu('saine', indicateurs, productions.length, solitude, '');
}

function rendu(
  etat: EtatDerive,
  indicateurs: Indicateur[],
  echantillon: number,
  solitude: Indicateur,
  motif: string,
): Derive {
  return {
    etat,
    indicateurs,
    echantillon,
    solitudeJours: Number.isFinite(solitude.valeur) ? solitude.valeur : -1,
    motif,
  };
}

function pourcent(part: number): string {
  return `${Math.round(part * 100)} %`;
}

/**
 * Compte les lignes ajoutées et supprimées d'un diff unifié.
 *
 * Ne compte QUE les lignes de contenu : les en-têtes `+++`/`---` commencent
 * eux aussi par le bon caractère et fausseraient la mesure de trois lignes par
 * fichier — ce qui, sur une fenêtre de petits diffs, suffirait à faire passer
 * un cliquet enclenché pour un travail sain.
 */
export function compterLignes(diff: string): { ajouts: number; suppressions: number } {
  let ajouts = 0;
  let suppressions = 0;
  for (const ligne of diff.split('\n')) {
    if (ligne.startsWith('+++') || ligne.startsWith('---')) continue;
    if (ligne.startsWith('+')) ajouts += 1;
    else if (ligne.startsWith('-')) suppressions += 1;
  }
  return { ajouts, suppressions };
}
