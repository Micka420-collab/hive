// LE FULL AUTO — les agents valident leurs productions et se corrigent seuls.
//
// ─── CE QUE L'HUMAIN DONNE, UNE FOIS ─────────────────────────────────────────
//
// Sur un projet, son propriétaire allume le full auto : à partir de là, plus
// aucune production n'attend son verdict. Chaque production terminée est jugée
// par l'Evaluator — les Gardiennes, les validations du bac ou de la CI, la
// contre-revue d'une autre famille d'agents quand il y en a une — et la ruche
// tranche elle-même, par le chemin CANONIQUE du verdict (`appliquerRevueHumaine`
// dans server.ts, celui de l'écran et de Slack) :
//
//   · rien de rouge                         → approuvée ;
//   · un rouge que l'ouvrière peut corriger  → renvoyée en correction avec la
//     (production creuse, validation en         critique de l'Evaluator, dans la
//     échec, contre-revue qui demande mieux)    borne de tentatives du scheduler ;
//   · un rouge qui n'est pas de son fait     → laissée à l'humain, et dite.
//     (panne du bac, environnement)
//
// Une production dont une relecture est encore en vol attend sa fin : un
// premier avis ne vaut pas la contre-revue entière.
//
// ─── CE QU'IL NE DONNE PAS ───────────────────────────────────────────────────
//
// La FUSION dans le dépôt reste le geste qu'elle était : un humain, ou le Plein
// Essaim au niveau « plein » sur un dépôt inscrit (`essaim.ts`). Approuver
// ouvre la livraison comme une approbation humaine — une pull request —, jamais
// un merge. Et l'approbation porte sa provenance (`source: 'full_auto'`,
// `parUserId: null`) : la boucle Hive → Hive ne la compte pas pour humaine
// (boucle-v3/garde.ts), le journal non plus.
//
// MODULE PUR — la décision et le bilan ; `server.ts` lit l'évaluation et agit.

import type { EvaluationDecision } from './evaluator.js';
import type { HiveEvent } from '../shared/types.js';

/** Ce que le full auto fait d'une production terminée. */
export type GesteFullAuto = 'approuver' | 'corriger' | 'laisser';

/**
 * Le geste, lu dans la décision de l'Evaluator.
 *
 * `human_review_required` et `additional_test_required` APPROUVENT : c'est
 * l'objet du mode — personne ne relit à la place des agents, et un projet sans
 * tests n'en aura pas davantage parce qu'on renvoie la tâche. Le motif reste au
 * journal (`full_auto_decision.raison`) : approuvée, mais sans preuve de tests.
 */
export function gesteFullAuto(e: {
  readonly decision: EvaluationDecision;
  readonly retryRecommended: boolean;
}): GesteFullAuto {
  if (e.decision === 'rejected' || e.decision === 'correction_required') {
    return e.retryRecommended ? 'corriger' : 'laisser';
  }
  return 'approuver';
}

/** Une décision du full auto, telle que l'écran la raconte. */
export interface DecisionFullAuto {
  readonly id: number;
  readonly ts: number;
  readonly taskId: string;
  /** `bloquee` : la correction demandée n'a pas pu repartir (essais épuisés…). */
  readonly geste: GesteFullAuto | 'bloquee';
  readonly raison: string | null;
}

export interface BilanFullAuto {
  readonly validees: number;
  readonly corrigees: number;
  readonly laissees: number;
  readonly bloquees: number;
  /** Les plus récentes d'abord. */
  readonly derniers: readonly DecisionFullAuto[];
}

const texte = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 300) : null;

/**
 * Le bilan du full auto d'un projet, replié du journal : ses décisions
 * (`full_auto_decision`) et les corrections qu'il a demandées sans qu'elles
 * puissent repartir (`evaluator_retry_skipped` de source `full_auto`).
 *
 * `depuis` : seuls les faits postérieurs à l'activation comptent — un bilan
 * qui additionnerait deux périodes d'activation ne dirait rien de celle-ci.
 */
export function bilanFullAuto(
  events: readonly HiveEvent[],
  tachesDuProjet: ReadonlySet<string>,
  depuis: number,
  limite = 8,
): BilanFullAuto {
  let validees = 0;
  let corrigees = 0;
  let laissees = 0;
  let bloquees = 0;
  const decisions: DecisionFullAuto[] = [];
  for (const ev of events) {
    if (ev.ts < depuis) continue;
    const p = ev.payload;
    const taskId = typeof p.taskId === 'string' ? p.taskId : null;
    if (!taskId || !tachesDuProjet.has(taskId)) continue;
    if (ev.type === 'full_auto_decision') {
      const geste = p.geste;
      if (geste !== 'approuver' && geste !== 'corriger' && geste !== 'laisser') continue;
      if (geste === 'approuver') validees += 1;
      else if (geste === 'corriger') corrigees += 1;
      else laissees += 1;
      decisions.push({ id: ev.id, ts: ev.ts, taskId, geste, raison: texte(p.raison) });
    } else if (ev.type === 'evaluator_retry_skipped' && p.source === 'full_auto') {
      bloquees += 1;
      decisions.push({ id: ev.id, ts: ev.ts, taskId, geste: 'bloquee', raison: texte(p.reason) });
    }
  }
  decisions.sort((a, b) => b.id - a.id);
  return { validees, corrigees, laissees, bloquees, derniers: decisions.slice(0, limite) };
}
