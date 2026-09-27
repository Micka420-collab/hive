// L'HUMEUR DU COMPAGNON — ce que le petit animal de la barre dit de la ruche.
//
// ─── POURQUOI UN MODULE PUR ──────────────────────────────────────────────────
//
// Le compagnon n'est pas une décoration : il RÉSUME l'état de la ruche en un
// coup d'œil (au repos, au travail sur n tâches, en alerte parce qu'un humain
// est attendu, en fête parce qu'une livraison vient d'être acceptée). Un
// résumé qui ment est pire que pas de résumé — une abeille qui dort pendant
// qu'une production attend un verdict apprend à ne plus la regarder. La
// décision tient donc ici, hors du JSX, là où le banc peut la tenir.
//
// ─── IL NE CALCULE RIEN QUE L'ÉCRAN NE CALCULE DÉJÀ ─────────────────────────
//
// « À revoir » est le compte de la pastille de la Miellerie
// (`countPendingReviews`), « alertes » celui de la pastille de Mon espace
// (`pastilleDesAlertes`, gravité décidée par le SERVEUR). Le compagnon les
// reçoit tels quels : un second calcul recopié ici divergerait du premier, et
// l'animal contredirait la barre qu'il habite.
//
// ─── L'INCONNU RESTE INCONNU ─────────────────────────────────────────────────
//
// Flux coupé = on ne sait PAS ce que fait la ruche. Afficher « au repos » à ce
// moment-là serait inventer un calme qu'on n'a pas observé : le compagnon
// passe en `inconnu`, et le dit.

// Extensions `.js` : les bancs de la racine importent ce module sous la
// résolution NodeNext, qui les exige ; Vite les résout vers les `.ts`.
import type { HiveEvent, Task } from '../../src/shared/types.js';
import type { Pastille } from './views/pastille-alertes.js';

export type HumeurCompagnon = 'inconnu' | 'repos' | 'occupe' | 'alerte' | 'fete';

/**
 * Combien de temps une livraison acceptée fait la fête. Court EXPRÈS : la fête
 * répond à un geste qui vient d'avoir lieu ; au-delà, elle masquerait l'état
 * réel (une alerte en attente, du travail en cours) derrière un souvenir.
 */
export const DUREE_FETE_MS = 6_000;

/** Les statuts d'une tâche qui occupe une ouvrière — ceux que compte `HiveNode.running`. */
const STATUTS_ACTIFS: ReadonlySet<Task['status']> = new Set(['assigned', 'running']);

export interface EntreesCompagnon {
  /** Le flux temps réel répond-il ? Sans lui, rien de ce qui suit n'est frais. */
  connecte: boolean;
  tasks: readonly Pick<Task, 'status'>[];
  /** Le compte de la pastille de la Miellerie : productions sans verdict humain. */
  aRevoir: number;
  /** La pastille d'alertes de la personne, telle que la barre la peint. */
  pastille: Pastille | null;
  events: readonly Pick<HiveEvent, 'ts' | 'type' | 'payload'>[];
}

export interface EtatCompagnon {
  humeur: HumeurCompagnon;
  /** Tâches en cours (assignées ou en exécution) — affiché en `occupe`. */
  enCours: number;
  /** Ce qui attend un humain : verdicts + alertes non informatives. */
  attentes: number;
  /**
   * Quand la fête s'arrête (horloge locale, ms) — `null` hors fête. Le
   * composant y pose UN minuteur pour redescendre : sans lui, l'abeille
   * danserait jusqu'au prochain événement, qui peut ne jamais venir.
   */
  finFete: number | null;
}

/**
 * Un événement dit-il qu'une livraison vient d'être ACCEPTÉE ?
 *
 *  · `task_reviewed` à `approved` — un humain a dit oui à une production ;
 *  · `merge_completed` sans conflit, avec au moins une branche appliquée, et
 *    des tests qui n'ont pas échoué — la livraison est entrée dans le projet.
 *    `testsPassed` absent (`undefined`) n'est pas un échec : une ruche sans
 *    commande de test n'en rend pas, et la fusion est quand même faite.
 */
export function estLivraisonAcceptee(ev: Pick<HiveEvent, 'type' | 'payload'>): boolean {
  if (ev.type === 'task_reviewed') return ev.payload.state === 'approved';
  if (ev.type !== 'merge_completed') return false;
  const { applied, conflicts, testsPassed } = ev.payload;
  return typeof applied === 'number' && applied > 0 && conflicts === 0 && testsPassed !== false;
}

/**
 * La fin de la fête en cours, ou `null`.
 *
 * L'horodatage est celui de la REINE : à la reconnexion, le flux rejoue les
 * événements manqués, et une approbation d'il y a une heure ne doit pas faire
 * danser l'abeille maintenant. On ne regarde que les événements dont l'âge
 * tient dans la fenêtre. Une horloge locale très décalée de celle de la Reine
 * peut faire rater une fête — jamais en inventer une qui dure : la fenêtre
 * borne des DEUX côtés.
 */
function finDeFete(events: EntreesCompagnon['events'], maintenant: number): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev === undefined) continue;
    const age = maintenant - ev.ts;
    if (age >= DUREE_FETE_MS) break; // le journal est chronologique : plus rien de récent avant
    if (age > -DUREE_FETE_MS && estLivraisonAcceptee(ev)) {
      return Math.min(ev.ts, maintenant) + DUREE_FETE_MS;
    }
  }
  return null;
}

/**
 * L'humeur, par ordre de priorité :
 *
 *   inconnu  flux coupé — rien d'autre n'est affirmable ;
 *   fete     une livraison acceptée à l'instant (≤ 6 s) — elle répond au geste
 *            qu'un humain vient de faire, et redescend d'elle-même ;
 *   alerte   quelque chose attend un humain — un verdict, une alerte ;
 *   occupe   au moins une tâche en cours ;
 *   repos    rien de tout cela.
 *
 * La fête passe AVANT l'alerte parce qu'elle est brève et bornée : une
 * alerte, elle, reste allumée tant qu'elle existe, et reprend la main à la
 * fin de la fête. L'inverse ferait qu'une ruche avec une seule production en
 * attente ne fêterait jamais rien.
 */
export function etatDuCompagnon(e: EntreesCompagnon, maintenant: number): EtatCompagnon {
  const enCours = e.tasks.filter((t) => STATUTS_ACTIFS.has(t.status)).length;
  // Une alerte « info » n'appelle pas de geste : l'animal ne s'agite pas pour
  // elle, de même que la barre la peint en gris et non en rouge.
  const alertes = e.pastille && e.pastille.gravite !== 'info' ? e.pastille.total : 0;
  const attentes = Math.max(0, e.aRevoir) + alertes;
  if (!e.connecte) return { humeur: 'inconnu', enCours, attentes, finFete: null };
  const finFete = finDeFete(e.events, maintenant);
  if (finFete !== null) return { humeur: 'fete', enCours, attentes, finFete };
  if (attentes > 0) return { humeur: 'alerte', enCours, attentes, finFete: null };
  if (enCours > 0) return { humeur: 'occupe', enCours, attentes, finFete: null };
  return { humeur: 'repos', enCours, attentes, finFete: null };
}

/** La phrase du compagnon — son nom accessible et son info-bulle. */
export function phraseDuCompagnon(etat: EtatCompagnon, langue: 'fr' | 'en'): string {
  const fr = langue === 'fr';
  switch (etat.humeur) {
    case 'inconnu':
      return fr
        ? 'Je n’entends plus la ruche — état inconnu'
        : 'I can’t hear the hive — state unknown';
    case 'fete':
      return fr ? 'Livraison acceptée !' : 'Delivery accepted!';
    case 'alerte':
      return fr
        ? `${etat.attentes} chose(s) attendent un humain`
        : `${etat.attentes} thing(s) waiting for a human`;
    case 'occupe':
      return fr ? `Au travail sur ${etat.enCours} tâche(s)` : `Busy with ${etat.enCours} task(s)`;
    case 'repos':
      return fr ? 'La ruche se repose' : 'The hive is resting';
  }
}
