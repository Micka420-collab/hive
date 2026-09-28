// LA RÉTENTION DU JOURNAL — UN SEUL PROPRIÉTAIRE, ET CE QU'IL GARDE.
//
// ─── CE QUI N'ALLAIT PAS ─────────────────────────────────────────────────────
//
// Le journal gardait ses 5 000 derniers événements, TOUS TYPES CONFONDUS. Or
// un `task_progress` s'écrit à chaque jalon d'agent : une nuit de travail
// suffisait à pousser dehors les PREUVES d'une production qui attendait encore
// un humain — la CI ingérée (`validation_recorded`), l'annonce de contre-revue
// que l'Evaluator relit pour compter ses relectures en vol, la raison du
// routing, la critique d'un renvoi, la provenance d'une livraison. La Miellerie
// retombait alors en « preuves manquantes » sur une production prouvée, le
// Genome perdait les faits d'une tâche encore là, et une critique élaguée
// repartait muette (l'ancienne « Limite connue » du protocole de critique,
// aujourd'hui docs/PROTOCOLE-DEBAT.md).
//
// Cinq exceptions s'étaient greffées une à une sur l'élagage aveugle — une par
// lecteur qui s'en était plaint (verdict du corpus de l'Aiguillage, mesure
// Worker, décision de Conseil, refus de renvoi, annonces de contre-revue du
// dernier résultat). Chacune protégeait SON événement ; aucune ne protégeait
// la production entière, et la prochaine preuve oubliée aurait demandé la
// sixième.
//
// ─── LA POLITIQUE, TENUE PAR UN SEUL PROPRIÉTAIRE (`HiveStore.pruneEvents`) ──
//
// Deux familles d'événements :
//   · les TRACES (battements, nœuds, progrès, Conseils, gestes d'accès…) : la
//     fenêtre des `fenetre` derniers événements, comme avant. C'est le direct
//     que rattrapent les tableaux de bord (`/api/events?since=`).
//   · les PREUVES (`TYPES_PREUVE`), liées à une tâche par `payload.taskId` :
//     elles vivent AVEC leur tâche. Tant que la ruche peut encore décider
//     quelque chose d'elle (`clotureDe` rend `null`), rien ne les retire que
//     le plafond ; close, elle les garde `preuvesClosesMs` après sa clôture ;
//     disparue (`pruneTasks`), elle ne garde rien — il n'y a plus rien à
//     prouver à personne.
//
// Un PLAFOND DUR borne le tout, en dernier recours. Il retire les preuves des
// tâches CLOSES les plus anciennes d'abord, puis celles des tâches vivantes
// restées le plus longtemps inactives — TÂCHE PAR TÂCHE : la moitié des preuves
// d'une production (le verdict sans son lancement, la CI sans sa relecture)
// ferait conclure l'Evaluator sur un dossier incohérent ; un dossier vide, lui,
// se lit « preuves manquantes », et le journal dit pourquoi. Une tâche qui a
// encore des preuves dans la fenêtre n'est pas prise ainsi : on ne toucherait
// qu'à la moitié de son dossier.
// Mais une tâche qui BOUCLE (refusée pour saturation puis réassignée toutes les
// trois secondes, requeue sur un nœud qui clignote) a TOUJOURS une preuve dans
// la fenêtre, et ses milliers de `task_assigned` / `task_rejected` d'en dessous
// grossiraient sans fin un journal que le plafond ne bornerait plus. Quand les
// dossiers entiers ne suffisent pas, le plafond COUPE donc, en tout dernier :
// d'abord les preuves qu'une plus récente du même type, de la même tâche,
// remplace (la 3 000ᵉ assignation dit ce que disait la première), puis les
// plus anciennes — sous le motif `plafond_coupe`, que le journal nomme à part.
// Seuls la fenêtre et les faits rangés restent intouchables, et la politique
// de la Reine leur laisse de la place sous le plafond (un test tient
// l'inégalité) : le journal ne dépasse jamais `plafond` lignes.
//
// LIMITE CONNUE — les événements de délégation (`delegation_*`) nomment leur
// racine (`rootTaskId`, `parentTaskId`), pas une `taskId` : ils restent des
// traces, et l'historique de délégation d'une mission encore ouverte ne vit
// que dans la fenêtre, comme avant cette rétention. Les lier à leur racine est
// un chantier à part (`listDelegationEvents`).
//
// Chaque passe qui retire quelque chose est JOURNALISÉE (`journal_elagage` :
// combien, de quels types, pour quel motif, quelles tâches le plafond a
// touchées) et COMPTÉE par type et par motif dans `journal_elagages`, qui
// survit à l'élagage — c'est là que le Genome apprend si des faits d'une tâche
// ENCORE CONNUE ont disparu, au lieu de le supposer dès la première trace
// élaguée.
//
// Module PUR : aucune I/O, aucune horloge. Le magasin rassemble les faits
// (lignes sous la fenêtre, clôture de chaque tâche citée, faits rangés), ce
// module décide, le magasin supprime.

import { TYPES_CHRONOLOGIE } from './chronologie-tache.js';
import { TYPES_REGISTRE_GENOME } from './registre-genome.js';
import { TYPES_ROUTAGE } from './routage-vue.js';

/**
 * Les preuves que relit l'Evaluator (et la War Room qui les montre) : CI et bac,
 * relectures croisées de leur lancement à leur verdict ou leur impossibilité,
 * verdict humain, renvois refusés, arrêts levés à la main.
 * `ci_validation_recorded` est le nom historique des preuves GitHub, encore relu
 * par `latestValidation` : une preuve déjà ingérée ne doit pas partir plus tôt
 * parce qu'elle porte l'ancien nom.
 */
const PREUVES_EVALUATOR = [
  'validation_recorded',
  'ci_validation_recorded',
  'contre_expertise',
  'contre_expertise_verdict',
  'contre_expertise_impossible',
  'contre_expertise_review_failed',
  'contre_expertise_review_waiting',
  'task_reviewed',
  'evaluator_retry_skipped',
  'evaluator_overridden',
] as const;

/** D'où vient une livraison : quel résultat est parti, par quelle pull request. */
const PREUVES_LIVRAISON = [
  'delivery_started',
  'delivery_opened',
  // La provenance d'une REPRISE qui avance la même branche (#518) : relue par
  // `evaluation/ci` exactement comme `delivery_opened`.
  'delivery_advanced',
  'delivery_merged',
  'delivery_stale',
  'delivery_recovered',
  'livraison_reprise',
  // La PREUVE qui a fait relancer un job comme instable (garde de PR) : les
  // passages de la base. Élaguée comme une trace, elle laisserait une relance
  // sans justification pendant que la tâche vit encore.
  'garde_pr_relance',
] as const;

/**
 * Ce qu'une reprise a reçu : la critique figée dans `task_retry`, jointe ou
 * refusée faute de place, et les leçons de la Couveuse. Élaguée pendant que la
 * tâche attend en `ready`, la critique repartait muette sans que rien le dise.
 */
const PREUVES_REPRISE = [
  'task_retry',
  'critique_context',
  'critique_refus',
  'brood_context',
  'brood_refus',
] as const;

/** Ce qu'une exécution a rendu et que des lecteurs DIFFÉRÉS relisent (mesure, texte final). */
const PREUVES_EXECUTION = ['worker_usage', 'worker_final_text'] as const;

/**
 * Les types d'événements qui PROUVENT quelque chose d'une tâche, triés (l'ordre
 * ne décide rien, mais un ensemble stable se relit et se compare).
 *
 * Composée des listes que les lecteurs PAR TÂCHE déclarent eux-mêmes — Genome,
 * routage, chronologie — plutôt que recopiée : un type qu'un de ces lecteurs
 * apprend à lire devient une preuve sans que personne ait à y penser ici.
 * Un type de cette liste dont le payload ne nomme aucune tâche (`delivery_merged`
 * d'une fusion par numéro de PR) reste une trace : il n'a pas de tâche avec qui
 * vivre.
 */
export const TYPES_PREUVE: readonly string[] = [
  ...new Set<string>([
    ...TYPES_REGISTRE_GENOME,
    ...TYPES_ROUTAGE,
    ...TYPES_CHRONOLOGIE,
    ...PREUVES_EVALUATOR,
    ...PREUVES_LIVRAISON,
    ...PREUVES_REPRISE,
    ...PREUVES_EXECUTION,
  ]),
].sort();

const EST_PREUVE: ReadonlySet<string> = new Set(TYPES_PREUVE);

/** Ce type prouve-t-il quelque chose d'une tâche (quand son payload la nomme) ? */
export const estPreuve = (type: string): boolean => EST_PREUVE.has(type);

/**
 * Pourquoi un événement est sorti du journal.
 *   · `trace` : hors fenêtre, et ce n'est la preuve d'aucune tâche ;
 *   · `orpheline` : la preuve d'une tâche qui n'existe plus ;
 *   · `echue` : la preuve d'une tâche close depuis plus de `preuvesClosesMs` ;
 *   · `plafond_close` / `plafond_vivante` : retirée par le plafond dur, avec
 *     tout le dossier d'une tâche close ou encore vivante — la seconde prive
 *     une décision à venir de ses preuves, et le journal la nomme à part ;
 *   · `plafond_coupe` : retirée SEULE par le plafond, d'une tâche qui a encore
 *     des preuves dans la fenêtre — le tout dernier recours, quand les dossiers
 *     entiers n'ont pas suffi à tenir le plafond (une tâche qui boucle).
 */
export const MOTIFS_ELAGAGE = [
  'trace',
  'orpheline',
  'echue',
  'plafond_close',
  'plafond_vivante',
  'plafond_coupe',
] as const;
export type MotifElagage = (typeof MOTIFS_ELAGAGE)[number];

/**
 * Les motifs qui retirent un fait d'une tâche ENCORE CONNUE. Une trace ou une
 * orpheline ne manquent à aucun lecteur par tâche : le Genome ignore déjà les
 * événements d'une tâche disparue, et une trace ne nomme pas de tâche.
 */
export const MOTIFS_FAIT_CONNU: readonly MotifElagage[] = [
  'echue',
  'plafond_close',
  'plafond_vivante',
  'plafond_coupe',
];

/** Les motifs du plafond : ceux qui nomment, dans le bilan, les tâches touchées. */
const MOTIFS_PLAFOND: ReadonlySet<MotifElagage> = new Set([
  'plafond_close',
  'plafond_vivante',
  'plafond_coupe',
]);

/** La politique de rétention, posée par la Reine (`POLITIQUE_JOURNAL`). */
export interface PolitiqueJournal {
  /** Les `fenetre` événements les plus récents restent, quels qu'ils soient. */
  fenetre: number;
  /** Combien de temps une preuve survit à la clôture de sa tâche (ms). */
  preuvesClosesMs: number;
  /** Nombre de lignes au-delà duquel le plafond retire des preuves. */
  plafond: number;
}

/** Une ligne du journal sous la fenêtre, telle que le magasin la relit. */
export interface LigneJournal {
  id: number;
  type: string;
  /** `payload.taskId` quand c'est une chaîne non vide, `null` sinon. */
  taskId: string | null;
}

/** Ce qui décide de la clôture d'une tâche, relu dans les tables rangées. */
export interface FaitsCloture {
  status: string;
  updatedAt: number;
  /** La livraison rangée (`livraisons`), s'il y en a une. */
  livraison: { etat: string; majA: number } | null;
  /** Le verdict humain rangé (`reviews`), s'il y en a un. */
  revue: { state: string; updatedAt: number } | null;
  /**
   * Relecture d'une autre production (`contre_expertises`) ou enfant délégué
   * (`task_delegations`) : son résultat est rendu à qui l'attendait, et elle
   * ne sera jamais livrée elle-même.
   */
  rendueAUneAutre: boolean;
}

/**
 * L'instant où la ruche n'a PLUS RIEN à décider d'une tâche, ou `null` tant
 * qu'elle peut encore en décider quelque chose.
 *
 * Vivante : pas encore terminée ; ou rendue et en attente — d'une revue
 * humaine, d'une livraison, d'une fusion (l'Evaluator relit ses preuves pour
 * laisser fusionner une PR ouverte), d'une reprise après une livraison échouée.
 * Close : échouée ; fusionnée ; rejetée par un humain sans nouvel essai (un
 * essai la remettrait en `ready`, et un résultat rendu APRÈS le rejet attend à
 * nouveau son humain) ; ou relecture / enfant délégué rendu.
 * `livraison.etat` est l'état RANGÉ (`livraisons`) — `en_cours`, `ouverte`,
 * `echouee`, `fusionnee` — pas l'état dérivé de GitHub (`shared/retour.ts`) :
 * une PR fermée sans fusion reste `ouverte` en table, donc vivante ici. Le
 * jour où la table saura la dire fermée, c'est ici qu'elle fermera la tâche.
 * L'instant de clôture est le PLUS RÉCENT des faits qui la ferment : une
 * fusion survenue après le dernier changement d'état compte à partir d'elle.
 * Ce n'est vrai que pour une tâche que `pruneTasks` garde (une dépendante,
 * une délégation la retiennent) : il efface toute tâche terminée trente jours
 * après son `updatedAt`, livrée ou non, et ses preuves partent alors en
 * orphelines. « Vivante tant que la ruche peut en décider » est donc borné,
 * pour une tâche `done` en attente, par la rétention des TÂCHES — un choix de
 * leur propriétaire (`pruneTasks`), pas de celui-ci.
 */
export function clotureDe(f: FaitsCloture): number | null {
  if (f.status === 'failed') return f.updatedAt;
  if (f.status !== 'done') return null;
  if (f.livraison?.etat === 'fusionnee') return Math.max(f.updatedAt, f.livraison.majA);
  // Un rejet ne ferme que le résultat qu'il a JUGÉ. Seul `retryFromEvaluator`
  // efface la revue en rouvrant la tâche ; une reprise par un autre chemin
  // laisse la ligne `rejected` en place, et le nouveau résultat — plus récent
  // que le rejet — attend encore un humain : le compter clos lui donnerait
  // l'horloge des trente jours et la tête du plafond.
  if (f.revue?.state === 'rejected' && f.revue.updatedAt >= f.updatedAt) return f.revue.updatedAt;
  if (f.rendueAUneAutre) return f.updatedAt;
  return null;
}

/** Un retrait décidé : l'événement, son type, son motif et la tâche qu'il prouvait. */
export interface Retrait {
  id: number;
  type: string;
  motif: MotifElagage;
  taskId: string | null;
}

/**
 * Ce que la passe retire, dans l'ordre où il faut le dire.
 *
 * `clotureDe` rend, pour une tâche citée : `undefined` si elle n'existe plus,
 * `null` si elle est vivante, l'instant de sa clôture sinon. `rangees` sont les
 * ids que leur propre borne tient déjà (décision courante d'un Conseil rangé,
 * verdict du corpus de l'Aiguillage) : ni la fenêtre ni le plafond n'y
 * touchent. `dansLaFenetre` : les tâches qui ont AUSSI des preuves dans la
 * fenêtre, avec les types de ces preuves — le plafond ne les prend pas
 * entières, il ne peut que les couper (voir plus bas). `total` est le nombre
 * de lignes du journal avant la passe.
 */
export function planDeRetention(
  lignes: readonly LigneJournal[],
  clotureDeTache: (taskId: string) => number | null | undefined,
  rangees: ReadonlySet<number>,
  dansLaFenetre: ReadonlyMap<string, ReadonlySet<string>>,
  politique: PolitiqueJournal,
  total: number,
  now: number,
): Retrait[] {
  const retraits: Retrait[] = [];
  /** Les preuves gardées, par tâche : c'est l'unité que le plafond retire. */
  const gardees = new Map<string, { cloture: number | null; ids: LigneJournal[] }>();
  const seuilClos = now - politique.preuvesClosesMs;
  for (const ligne of lignes) {
    if (rangees.has(ligne.id)) continue;
    const taskId = estPreuve(ligne.type) ? ligne.taskId : null;
    if (taskId === null) {
      retraits.push({ ...ligne, motif: 'trace' });
      continue;
    }
    const cloture = clotureDeTache(taskId);
    if (cloture === undefined) {
      retraits.push({ ...ligne, taskId, motif: 'orpheline' });
    } else if (cloture !== null && cloture < seuilClos) {
      retraits.push({ ...ligne, taskId, motif: 'echue' });
    } else {
      const dossier = gardees.get(taskId) ?? { cloture, ids: [] };
      dossier.ids.push(ligne);
      gardees.set(taskId, dossier);
    }
  }

  let exces = total - retraits.length - politique.plafond;
  if (exces <= 0) return retraits;
  // Une tâche qui a AUSSI des preuves dans la fenêtre n'est jamais prise : la
  // fenêtre ne se touche pas, si bien que retirer ses preuves d'en dessous
  // couperait son dossier en deux (la critique partie, la tentative en cours
  // restée ; le lancement parti, le verdict resté) — exactement ce que le
  // plafond ne fait qu'en tout dernier recours (la coupe, plus bas). Elle est
  // aussi, par construction, parmi les plus actives : ses preuves les plus
  // récentes sont du direct, et elle redevient éligible, entière, dès que sa
  // dernière preuve quitte la fenêtre.
  //
  // Closes d'abord, de la plus anciennement close à la plus récente ; puis les
  // vivantes, de la plus longtemps inactive (dernière preuve la plus ancienne)
  // à la plus récente. Les lignes arrivent par id croissant, et aucune preuve
  // de ces dossiers n'est dans la fenêtre : la dernière de chaque dossier est
  // sa preuve la plus récente DE TOUT LE JOURNAL. Égalités tranchées par id de
  // tâche — une passe rejouée sur les mêmes faits retire la même chose.
  const derniere = (d: { ids: LigneJournal[] }): number => d.ids[d.ids.length - 1]?.id ?? 0;
  const eligibles = [...gardees.entries()].filter(([taskId]) => !dansLaFenetre.has(taskId));
  const ordre = eligibles.sort(([ta, a], [tb, b]) => {
    if ((a.cloture === null) !== (b.cloture === null)) return a.cloture === null ? 1 : -1;
    const parCloture = (a.cloture ?? 0) - (b.cloture ?? 0);
    const parActivite = derniere(a) - derniere(b);
    return parCloture || parActivite || (ta < tb ? -1 : ta > tb ? 1 : 0);
  });
  for (const [taskId, dossier] of ordre) {
    if (exces <= 0) break;
    const motif: MotifElagage = dossier.cloture === null ? 'plafond_vivante' : 'plafond_close';
    for (const ligne of dossier.ids) retraits.push({ ...ligne, taskId, motif });
    exces -= dossier.ids.length;
  }
  if (exces <= 0) return retraits;

  // LA COUPE — il ne reste sous la fenêtre que des preuves de tâches qui en ont
  // aussi dedans, et le plafond n'est toujours pas tenu : sans elle, une tâche
  // qui boucle ferait grossir le journal sans borne. Une preuve REMPLACÉE — une
  // plus récente du même type et de la même tâche existe, sous la fenêtre ou
  // dedans — part la première : le lecteur par tâche relit la dernière. Puis
  // les autres. Chaque groupe de la plus ancienne à la plus récente, une ligne
  // à la fois : on ne coupe que ce qu'il faut.
  const coupables = [...gardees.entries()]
    .filter(([taskId]) => dansLaFenetre.has(taskId))
    .flatMap(([taskId, d]) => d.ids.map((ligne) => ({ ...ligne, taskId })))
    .sort((a, b) => b.id - a.id);
  const vus = new Set<string>();
  const remplacees: typeof coupables = [];
  const dernieres: typeof coupables = [];
  for (const ligne of coupables) {
    const cle = `${ligne.taskId}\u0000${ligne.type}`;
    const remplacee = vus.has(cle) || dansLaFenetre.get(ligne.taskId)?.has(ligne.type) === true;
    (remplacee ? remplacees : dernieres).push(ligne);
    vus.add(cle);
  }
  for (const ligne of [...remplacees.reverse(), ...dernieres.reverse()]) {
    if (exces <= 0) break;
    retraits.push({ ...ligne, motif: 'plafond_coupe' });
    exces -= 1;
  }
  return retraits;
}

/** Le bilan d'une passe : ce que la Reine journalise et que le magasin compte. */
export interface BilanJournal {
  supprimes: number;
  parMotif: Record<MotifElagage, number>;
  parType: Record<string, number>;
  /** Les tâches dont le plafond a retiré les preuves, dans l'ordre du retrait. */
  tachesPlafond: string[];
  /** Lignes du journal après la passe. */
  restants: number;
}

export function bilanDeRetraits(retraits: readonly Retrait[], restants: number): BilanJournal {
  const parMotif = Object.fromEntries(MOTIFS_ELAGAGE.map((m) => [m, 0])) as Record<
    MotifElagage,
    number
  >;
  const parType: Record<string, number> = {};
  // Un ensemble, pas « différente de la précédente » : la coupe entrelace les
  // preuves de plusieurs tâches par ancienneté, et une tâche nommée deux fois
  // compterait double dans `tachesPlafondTotal`.
  const tachesPlafond = new Set<string>();
  for (const r of retraits) {
    parMotif[r.motif] += 1;
    parType[r.type] = (parType[r.type] ?? 0) + 1;
    if (MOTIFS_PLAFOND.has(r.motif) && r.taskId !== null) tachesPlafond.add(r.taskId);
  }
  return {
    supprimes: retraits.length,
    parMotif,
    parType,
    tachesPlafond: [...tachesPlafond],
    restants,
  };
}

/** Types nommés un par un dans l'événement ; les suivants sont sommés. */
export const TYPES_NOMMES = 12;
/** Tâches touchées par le plafond nommées dans l'événement ; les suivantes sont comptées. */
export const TACHES_NOMMEES = 20;

/**
 * Le payload de `journal_elagage`, BORNÉ : un journal qui décrirait son propre
 * élagage type par type et tâche par tâche grossirait de ce qu'il retire. Les
 * types les plus retirés d'abord, puis par nom ; au-delà, des totaux.
 */
export function payloadDeBilan(bilan: BilanJournal): Record<string, unknown> {
  const types = Object.entries(bilan.parType).sort(
    ([a, na], [b, nb]) => nb - na || (a < b ? -1 : a > b ? 1 : 0),
  );
  const nommes = types.slice(0, TYPES_NOMMES);
  const autres = types.slice(TYPES_NOMMES).reduce((somme, [, n]) => somme + n, 0);
  return {
    supprimes: bilan.supprimes,
    restants: bilan.restants,
    parMotif: bilan.parMotif,
    parType: Object.fromEntries(nommes),
    ...(autres > 0 ? { autresTypes: autres } : {}),
    ...(bilan.tachesPlafond.length > 0
      ? {
          tachesPlafond: bilan.tachesPlafond.slice(0, TACHES_NOMMEES),
          tachesPlafondTotal: bilan.tachesPlafond.length,
        }
      : {}),
  };
}
