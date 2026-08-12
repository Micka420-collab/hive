// L'Agent Garde-Fous — la ruche apprend, PAR PROJET, le bon réglage du trou de
// vol : assez serré pour arrêter le nectar creux, assez ouvert pour ne pas
// retenir les bonnes butineuses.
//
// ─── LE PROBLÈME, DIT PAR L'UTILISATEUR ──────────────────────────────────────
//
// « Je veux aussi dans Hive un agent garde-fous qui teste les meilleurs
// garde-fous pour des projets avec la base de l'IA — mais pas forcément utilisé
// sur tous les projets. »
//
// Aujourd'hui, les garde-fous de la ruche (Les Gardiennes, Le Polyéthisme) se
// règlent GLOBALEMENT, par variable d'environnement, et à la main : la même
// sévérité pour tous les projets, pour toujours. Or un dépôt de prototype et un
// dépôt d'authentification bancaire n'appellent pas le même trou de vol, et
// personne ne sait d'avance lequel — cela se CONSTATE, projet par projet.
//
// ─── CE QUE FAIT CE MODULE, ET CE QU'IL NE FAIT PAS ──────────────────────────
//
// Même moteur que l'AIGUILLAGE, appliqué à une autre question. L'Aiguillage
// apprend « quel MODÈLE pour ce genre de tâche » ; le Garde-Fous apprend « quel
// ÉCHELON de garde-fous pour ce PROJET ». Les deux sont des bandits-manchots
// UCB1 déterministes — et pour ne pas réécrire la formule, ce module RÉUTILISE
// littéralement le moteur de l'Aiguillage (`scoreUCB`, `moyenne`, `Antecedent`) :
// c'est le « même moteur explore/exploit » demandé, partagé pour de vrai.
//
// Il tient une MÉMOIRE (par échelon : combien de fois servi, quelle note
// récoltée), il CHOISIT un échelon DANS des bornes qu'un humain a posées, et il
// n'écrit NULLE PART, ne lance rien, n'applique rien. Assembler les
// observations, appliquer le réglage élu, journaliser l'élection : lot séparé,
// exactement comme l'Aiguillage a procédé.
//
// ─── TROIS PARTIS PRIS, TRANCHÉS AVANT D'ÉCRIRE (cf. docs/ETAPES.md) ──────────
//
// 1. L'ÉCHELLE, PAS L'ÉVENTAIL. Les bras sont trois ÉCHELONS ORDONNÉS
//    (`leger < standard < strict`), chacun un paquet cohérent de deux modes ;
//    surtout pas le produit cartésien des interrupteurs. Un projet réel rend
//    quelques verdicts par jour : neuf bras passeraient des semaines à seulement
//    éteindre les infinis d'exploration. C'est l'argument déjà gravé dans
//    l'Aiguillage (« une taxonomie fine se paie deux fois »), et l'ordre total
//    est ce qui rend les bornes de gouvernance FORMULABLES.
//
// 2. LA RÉCOMPENSE EST UN COMPROMIS, PAS UNE SÉVÉRITÉ. « Les MEILLEURS
//    garde-fous » n'est pas « les plus stricts » : un cadre serré rend du plus
//    propre mais coûte des jetons, de la latence, et retient du travail. La note
//    pèse la QUALITÉ constatée (le verdict des Gardiennes — le MÊME instrument
//    sur tous les échelons) contre la FLUIDITÉ de la traversée (ce que le
//    garde-fou a coûté). Le strict ne gagne que s'il évite RÉELLEMENT des creux ;
//    le léger ne gagne que si laisser passer ne coûte rien.
//
// 3. L'AGENT SE MEUT DANS DES BORNES QU'IL NE PEUT PAS ÉCRIRE. Ce module REÇOIT
//    toujours ses bornes {min, max} et n'en REND jamais : les bornes sont une
//    intention humaine (table `garde_fous`, motif `essaim`). Dedans, il relâche
//    ET resserre librement — un cliquet « resserrer seul » serait interdit par
//    la règle 3 du Polyéthisme et convergerait mécaniquement vers le plus strict,
//    le gagnant trivial qu'on vient d'écarter. « Tout éteindre » lui reste
//    STRUCTURELLEMENT inatteignable : l'échelon le plus bas garde les Gardiennes
//    allumées (`off` n'est pas un échelon — voir plus bas).
//
// MODULE PUR — famille de balance.ts, aiguillage.ts, polyethisme.ts. Aucune I/O,
// aucune horloge, et SURTOUT aucun aléa : UCB est déterministe, ce qui est à la
// fois une nécessité (ce dépôt interdit `Math.random`) et une vertu (deux ruches
// au même vécu font le même choix, et le choix s'éprouve sans tirer au sort).

import { moyenne, scoreUCB } from './aiguillage.js';
import type { Antecedent } from './aiguillage.js';
import type { ModeGardiennes, Verdict } from './gardiennes.js';
import type { ModePolyethisme, Suite } from './polyethisme.js';

/** Version du format des antécédents rangés — relevée si le calcul change. */
export const VERSION_GARDE_FOU = 1;

// ─── L'échelle — les bras du bandit, TOTALEMENT ORDONNÉS ─────────────────────
//
// Trois échelons, du plus ouvert au plus serré. « off » n'existe VOLONTAIREMENT
// pas ici : un échelon sans Gardiennes éteindrait l'instrument même qui mesure
// la qualité, donc ne rendrait AUCUN signal de récompense. Un tel bras n'a que
// deux destins sous UCB1, tous deux faux : rester à `+∞` pour toujours (le
// bandit y revient sans fin), ou paraître éternellement catastrophique sur du
// vide. C'est le motif « l'inconnu est une nourrice » : l'absence de signal ne
// doit jamais RESSEMBLER à une note. L'humain garde le droit d'éteindre les
// Gardiennes — mais c'est un geste humain HORS échelle (l'agent inactif), pas un
// bras qu'on apprend.

export const ECHELONS = ['leger', 'standard', 'strict'] as const;
export type Echelon = (typeof ECHELONS)[number];

/** Rang d'un échelon, pour comparer et borner sans dépendre de l'ordre du tableau. */
export function rangEchelon(e: Echelon): number {
  return ECHELONS.indexOf(e);
}

/**
 * Ramène un texte à un échelon connu, ou `null` s'il n'en est pas un. Le store
 * rend les bornes en TEXTE BRUT (une base éditée à la main pourrait contenir
 * n'importe quoi) ; c'est ici, et pas dans le store, qu'on les valide.
 */
export function versEchelon(brut: string): Echelon | null {
  return (ECHELONS as readonly string[]).includes(brut) ? (brut as Echelon) : null;
}

/** Le paquet de modes qu'un échelon commande. Les deux modes bougent ENSEMBLE. */
export interface Reglage {
  /** Jamais `off` : le plancher garde le contrôle d'entrée allumé (voir ci-dessus). */
  gardiennes: Exclude<ModeGardiennes, 'off'>;
  polyethisme: Exclude<ModePolyethisme, 'off'>;
}

/**
 * Ce que chaque échelon règle. Trois paquets, pas six interrupteurs :
 *
 *   · `leger`    — on ANNOTE et on CADRE, rien n'est jamais retenu. Le trou de
 *                  vol laisse tout entrer, mais le verdict est rangé et le prompt
 *                  est encadré. Aucun mode d'échec : le pire coût est du contexte.
 *   · `standard` — le trou de vol REFUSE le nectar creux (`gardiennes strict`),
 *                  mais aucune contre-visite ne retient (`polyethisme consignes`).
 *   · `strict`   — le paquet complet, contre-visite comprise : une production qui
 *                  l'exige et ne l'obtient pas attend la revue humaine.
 *
 * `polyethisme strict` sous `gardiennes strict` n'est pas un doublon : le premier
 * FAIT RELIRE avant d'appliquer, le second REFUSE le retour à vide. `standard`
 * tient l'un sans l'autre — c'est tout l'intérêt d'une échelle plutôt que d'un
 * unique interrupteur.
 */
export const REGLAGES: Record<Echelon, Reglage> = {
  leger: { gardiennes: 'consultatif', polyethisme: 'consignes' },
  standard: { gardiennes: 'strict', polyethisme: 'consignes' },
  strict: { gardiennes: 'strict', polyethisme: 'strict' },
};

// ─── La récompense : le compromis qualité / coût, dans [0, 1] ────────────────

/**
 * La QUALITÉ constatée d'une production, d'après le verdict des Gardiennes.
 *
 *   · `clean`   — aucune réserve : 1.
 *   · `suspect` — un grief heuristique, pas une preuve : 2/3. Ce n'est pas
 *                 arbitraire — c'est `1 − POIDS_SUSPECTE`, la même indulgence que
 *                 `fiabilite()` accorde au grief `surface_missed`, qui se lève sur
 *                 des productions parfaitement honnêtes.
 *   · `hollow`  — un mensonge attrapé : 0.
 *
 * Le verdict des Gardiennes est le SEUL instrument de qualité employé, sur TOUS
 * les échelons. Le verdict de contre-visite (`appliquer/ameliorer/refaire`)
 * n'entre PAS : il n'existe que sur l'échelon `strict`, et une récompense mesurée
 * avec un instrument différent selon le bras ne compare rien. Le bénéfice de la
 * contre-visite se lit par ce qu'elle PRÉVIENT (moins de reprises, plus bas), pas
 * par sa propre note.
 */
export const NOTE_VERDICT: Record<Verdict, number> = {
  clean: 1,
  suspect: 2 / 3,
  hollow: 0,
};

/**
 * La FLUIDITÉ de la traversée : ce que le garde-fou a coûté à cette production.
 *
 *   · `directe`               — passée sans entrave : 1.
 *   · `retenue_puis_relachee` — une contre-visite l'a relue puis laissée passer :
 *                               1/2. Elle a coûté des jetons et de la latence même
 *                               en ne changeant rien — c'est le PÉAGE du strict.
 *   · `en_attente`            — retenue, elle pend à la revue humaine : 0, le coût
 *                               maximal (du travail immobilisé).
 *
 * Pourquoi PAS les jetons/la durée bruts : `durationMs` varie cent fois plus avec
 * la TAILLE de la tâche qu'avec le réglage du garde-fou — un dénominateur bruité.
 * La traversée capture le coût STRUCTUREL du garde-fou sans ce bruit.
 */
export type Traversee = 'directe' | 'retenue_puis_relachee' | 'en_attente';
export const NOTE_TRAVERSEE: Record<Traversee, number> = {
  directe: 1,
  retenue_puis_relachee: 0.5,
  en_attente: 0,
};

/**
 * La qualité pèse DOUBLE, la fluidité pèse simple. Le mal qu'on soigne (du code
 * creux qui sédimente pour six mois) coûte plus cher que le péage qu'on paie
 * (une relecture de trop). Ces poids sont le curseur du compromis : les monter
 * fait tolérer plus de contre-visites pour un peu de qualité, les baisser rend la
 * ruche plus pressée. `2` et `1` n'ont aucune raison de bouger sans mesure.
 */
export const POIDS_QUALITE = 2;
export const POIDS_FLUIDITE = 1;

/** Une production observée sous un échelon : ce qu'elle a récolté, ce qu'elle a coûté. */
export interface ObservationGardeFou {
  echelon: Echelon;
  /** Le verdict des Gardiennes — l'instrument de qualité, le même partout. */
  verdict: Verdict;
  /** Ce que la traversée du garde-fou a coûté à cette production. */
  traversee: Traversee;
  /**
   * La production a-t-elle fini REFAITE / reprise plus tard ? Si oui, la qualité
   * tombe à 0 quel que soit le verdict d'entrée — un `clean` qu'il a fallu
   * refaire n'était pas propre, il était creux sans qu'on le voie encore.
   */
  reprise: boolean;
}

/**
 * La note d'une production sous son échelon, dans [0, 1] — le compromis
 * qualité/fluidité. `reprise` écrase la qualité à 0 AVANT la pondération : une
 * reprise est le démenti le plus dur du verdict d'entrée.
 */
export function recompenseGardeFou(o: ObservationGardeFou): number {
  const qualite = o.reprise ? 0 : NOTE_VERDICT[o.verdict];
  const fluidite = NOTE_TRAVERSEE[o.traversee];
  return (POIDS_QUALITE * qualite + POIDS_FLUIDITE * fluidite) / (POIDS_QUALITE + POIDS_FLUIDITE);
}

// ─── Reconstruire une observation depuis les faits datés ─────────────────────
//
// La `traversee` n'est PAS un fait rangé : c'est une VUE dérivée de deux faits
// datés — l'EXIGENCE (une contre-visite était-elle requise ?) et la CONTRE-VISITE
// (a-t-elle eu lieu, et qu'a-t-elle dit ?). La figer serait un mensonge à
// retardement : une production RETENUE aujourd'hui peut être RELÂCHÉE demain si
// une relectrice de caste suffisante émerge, et une traversée `en_attente` gelée
// mentirait alors. On range donc le seul atome non-recalculable, l'exigence, et
// on RECONSTRUIT la traversée à la lecture (règle 1 de La Balance : aucune vue
// dérivée matérialisée).

/**
 * L'exigence de contre-visite, telle qu'un fait daté la range : une contre-visite
 * était-elle REQUISE pour cette production, ou en était-elle DISPENSÉE ? Décidée à
 * l'instant où la caste VIVE est interrogée (`exigeContreVisite`), donc non
 * recalculable plus tard — d'où sa persistance (motif du verdict des Gardiennes).
 */
export type Exigence = 'exigee' | 'dispensee';

/**
 * Les faits BRUTS d'une production, tels que la jointure du store les assemble —
 * chacun de sa source unique : `echelon` de `garde_fou_echelons`, `verdict` des
 * Gardiennes, `suite` de `contre_visites` (`null` si aucune n'a eu lieu),
 * `exigence` de `garde_fou_exigences` (`null` si le sort n'est pas encore tranché).
 */
export interface FaitsProduction {
  echelon: Echelon;
  verdict: Verdict;
  suite: Suite | null;
  exigence: Exigence | null;
}

/**
 * Assemble une observation depuis les faits datés — ou `null` si la production
 * est ENCORE EN VOL (échelon posé, mais ni contre-visite faite ni exigence
 * tranchée), auquel cas elle ne pèse pas encore dans le repli.
 *
 * La `traversee`, reconstruite :
 *   · une contre-visite a eu lieu (suite ≠ null) ⇒ `retenue_puis_relachee` — la
 *     relecture a coûté son péage, quelle qu'ait été sa réponse ;
 *   · sinon, une contre-visite était EXIGÉE mais absente ⇒ `en_attente` — la
 *     production pend à la revue humaine, le coût maximal ;
 *   · sinon, elle en était DISPENSÉE ⇒ `directe` — passée sans entrave.
 *
 * FERMÉ PAR DÉFAUT : sans exigence tranchée, on ne SUPPOSE jamais `directe` — on
 * rend `null` et la production reste en vol. Confondre « pas encore décidé » avec
 * « passé librement » offrirait au léger une récompense qu'il n'a pas gagnée.
 *
 * La `reprise` est le seul verdict de contre-visite qui compte ici : `refaire`
 * dit que la production a été renvoyée — sa qualité tombe à 0 (cf. `recompenseGardeFou`).
 */
export function observationDepuisFaits(f: FaitsProduction): ObservationGardeFou | null {
  const reprise = f.suite === 'refaire';
  let traversee: Traversee;
  if (f.suite !== null) traversee = 'retenue_puis_relachee';
  else if (f.exigence === 'exigee') traversee = 'en_attente';
  else if (f.exigence === 'dispensee') traversee = 'directe';
  else return null;
  return { echelon: f.echelon, verdict: f.verdict, traversee, reprise };
}

// ─── Les antécédents — motif replierAntecedents, par ÉCHELON ─────────────────

/**
 * Combien d'observations récentes on garde. Au-delà, les plus vieilles sont
 * OUBLIÉES — un garde-fou qui a bien servi il y a six mois sur un code qui a
 * changé ne dit plus rien d'utile. L'oubli est lent (le corpus est grand), mais
 * il existe. Motif `CORPUS_POLYETHISME`.
 */
export const CORPUS_GARDE_FOU = 200;

/**
 * Replie une liste d'observations en mémoire (échelon → antécédent).
 *
 * Seules les `CORPUS_GARDE_FOU` DERNIÈRES comptent : les observations arrivent
 * dans l'ordre du temps, on garde la queue. C'est ici, et nulle part ailleurs,
 * que se fait l'oubli. La note d'un échelon est la SOMME des `recompenseGardeFou`
 * de ses productions ; la moyenne s'en déduit (`moyenne`, réutilisé de
 * l'Aiguillage).
 */
export function replierAntecedentsGardeFou(
  observations: readonly ObservationGardeFou[],
): Map<Echelon, Antecedent> {
  const recentes = observations.slice(-CORPUS_GARDE_FOU);
  const memoire = new Map<Echelon, Antecedent>();
  for (const o of recentes) {
    const a = memoire.get(o.echelon) ?? { essais: 0, recompenseTotale: 0 };
    a.essais += 1;
    a.recompenseTotale += recompenseGardeFou(o);
    memoire.set(o.echelon, a);
  }
  return memoire;
}

// ─── Les bornes — une intention humaine, jamais un calcul ────────────────────
//
// Ce module REÇOIT les bornes et n'en REND jamais : c'est le méta garde-fou. Les
// bornes vivent dans la table `garde_fous` (motif `essaim`), posées par un humain
// (`definiPar`) ; aucune fonction de la ruche ne les écrit. En posant {min, max},
// l'humain CONSENT à tout l'intervalle : relâcher dedans n'est pas une évasion,
// c'est le travail demandé.

/** L'intervalle d'échelons ouvert à l'élection, tel qu'un humain l'a posé. */
export interface Bornes {
  min: Echelon;
  max: Echelon;
}

/**
 * Bornes grandes ouvertes : toute l'échelle. Le défaut quand un projet est
 * opt-in sans avoir resserré — l'agent explore les trois échelons.
 */
export const BORNES_DEFAUT: Bornes = { min: 'leger', max: 'strict' };

/**
 * Range les bornes, FERMÉ PAR DÉFAUT.
 *
 * Des bornes INVERSÉES (`min` plus strict que `max`) sont une méprise humaine,
 * pas une permission : on les resserre sur le PLUS STRICT des deux, jamais sur le
 * plus lâche. Une méprise doit échouer vers PLUS de garde-fous, pas vers moins —
 * c'est la même prudence que le `attendre` du Polyéthisme quand une contre-visite
 * manque.
 */
export function normaliserBornes(b: Bornes): Bornes {
  // `<=` et `<` sont ICI un mutant ÉQUIVALENT, et c'est CONSIGNÉ, pas un test qui
  // manque : `rangEchelon` est injectif (index sur trois échelons distincts), donc
  // rang(min) == rang(max) ⟹ min == max ; la reconstruction `{ min, min }` ci-dessous
  // rend alors la MÊME valeur que `b`. Un balayage élargi de la loupe le re-signalera
  // « sans test » à chaque fois — il ne se tranche pas par un `toBe` sur l'identité de
  // référence, qui n'éprouverait qu'un détail que personne n'exige (ERREURS § 2.16 ter).
  if (rangEchelon(b.min) <= rangEchelon(b.max)) return b;
  // On n'arrive ici QUE si `min` est plus strict que `max` (rang(min) > rang(max)).
  // Le PLUS STRICT des deux est donc forcément `min` : l'ancien départage
  // `rang(min) >= rang(max) ? min : max` portait une branche `: max` qu'AUCUNE
  // entrée n'atteignait. Un balayage élargi de la loupe l'a signalée nue — et
  // c'était le bon signal : du code mort, pas un test manquant (ERREURS § 2.16 ter).
  return { min: b.min, max: b.min };
}

/**
 * Les échelons ouverts à l'élection, dans l'ordre de l'échelle. JAMAIS vide :
 * après normalisation, `min` ≤ `max`, donc l'intervalle contient au moins son
 * borne. C'est ce qui garantit que `elireEchelon` ne rend jamais `null`.
 */
export function echelonsPermis(b: Bornes): Echelon[] {
  const n = normaliserBornes(b);
  const lo = rangEchelon(n.min);
  const hi = rangEchelon(n.max);
  return ECHELONS.filter((_, i) => i >= lo && i <= hi);
}

// ─── L'élection : exploiter le meilleur, explorer le reste ───────────────────

/** Ce qu'on rend pour la transparence : le score de chaque échelon, expliqué. */
export interface RangGardeFou {
  echelon: Echelon;
  essais: number;
  moyenne: number;
  score: number;
}

/**
 * L'ordre entre deux échelons classés : score décroissant, puis — à ex æquo — le
 * PLUS STRICT d'abord. Un SEUL endroit définit ce départage, partagé par le
 * classement (pour la transparence) et l'élection (pour le choix), afin qu'ils ne
 * puissent jamais diverger.
 *
 * Le second critère n'est pas cosmétique : deux échelons jamais essayés valent
 * tous deux `+∞`, et à défaut de les distinguer le choix dépendrait du hasard de
 * l'ordre. On tranche vers le strict — « l'inconnu est une nourrice », on encadre
 * par défaut — sachant que les deux `+∞` seront de toute façon essayés, et que la
 * moyenne ramènera vite vers le léger si la sévérité ne paie pas.
 */
function comparerRangs(x: RangGardeFou, y: RangGardeFou): number {
  return y.score !== x.score ? y.score - x.score : rangEchelon(y.echelon) - rangEchelon(x.echelon);
}

/**
 * Classe les échelons PERMIS, du plus au moins recommandé. Départage déterministe
 * et indépendant de l'ordre d'entrée (`comparerRangs`). Sert la transparence — un
 * tableau qui montre « strict : 0.71 sur 12 / léger : 0.66 sur 9 » rend le choix
 * relisible.
 */
export function classerEchelons(
  permis: readonly Echelon[],
  antecedents: Map<Echelon, Antecedent>,
): RangGardeFou[] {
  const total = permis.reduce((n, e) => n + (antecedents.get(e)?.essais ?? 0), 0);
  return permis
    .map((echelon) => {
      const a = antecedents.get(echelon) ?? { essais: 0, recompenseTotale: 0 };
      return { echelon, essais: a.essais, moyenne: moyenne(a), score: scoreUCB(a, total) };
    })
    .sort(comparerRangs);
}

/**
 * LE choix : quel échelon pour ce projet, DANS ses bornes ? Jamais `null` — les
 * échelons permis ne sont jamais vides (voir `echelonsPermis`), donc `reduce`
 * sans valeur initiale a toujours de quoi mordre. L'appelant traduit l'échelon en
 * `Reglage` (`REGLAGES`) et l'applique aux tâches du projet.
 */
export function elireEchelon(bornes: Bornes, antecedents: Map<Echelon, Antecedent>): Echelon {
  const rangs = classerEchelons(echelonsPermis(bornes), antecedents);
  // `< 0` et `<= 0` sont ICI un mutant ÉQUIVALENT, et c'est CONSIGNÉ :
  // `comparerRangs` ne rend `0` que si le score ET le rang d'échelon coïncident,
  // or `rangs` porte au plus UNE entrée par échelon — deux entrées distinctes ne
  // peuvent donc jamais être à égalité. Mesuré plutôt que raisonné : sur les 9
  // bornes possibles croisées avec des antécédents variés, 90 paires distinctes,
  // zéro comparaison nulle. Le départage n'a donc pas de cas d'égalité à trancher.
  return rangs.reduce((meilleur, r) => (comparerRangs(r, meilleur) < 0 ? r : meilleur)).echelon;
}
