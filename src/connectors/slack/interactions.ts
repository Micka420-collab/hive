// Les interactions Slack ENTRANTES — la seule voie par laquelle Slack change
// quelque chose dans la ruche, et tout ce qu'elle doit refuser avant d'y toucher.
//
// ─── LE DANGER, DIT SANS DÉTOUR ──────────────────────────────────────────────
//
// Un bouton « Approuver » dans Slack qui ouvrirait la livraison autonome, c'est
// une autorité qui vient d'un canal de discussion. Si n'importe quel message,
// n'importe quel usager, n'importe quel canal pouvait la déclencher, Slack
// serait une porte dérobée sur la revue humaine. La règle est donc : on ÉCOUTE
// une interaction, on ne l'APPLIQUE que si TOUTES ces conditions tiennent :
//
//   1. c'est bien une action de bouton connue (`block_actions`, notre action_id) ;
//   2. le connecteur a la portée `approbation` sur CE projet (accordée par
//      l'hôte, projet par projet) ;
//   3. le canal d'où vient le clic est explicitement inscrit (liste non vide) ;
//   4. l'usager qui clique est explicitement inscrit (liste non vide).
//
// FERMÉ PAR DÉFAUT : une liste vide refuse tout. « Aucun canal configuré » n'est
// pas « tous les canaux » — c'est « personne ». Le projet auquel s'applique
// l'approbation est déduit de la TÂCHE (le serveur le résout, autorité), jamais
// du `block_id` seul, qui n'est qu'un indice.
//
// MODULE PUR : parse et tranche, ne touche ni au réseau ni à la base. Le serveur
// résout la tâche→projet→autorisation, puis appelle `autoriserInteraction`.

import { ACTION_APPROUVER, ACTION_REJETER, lireValeurBouton } from './messages.js';
import type { LiaisonApprobation, Portee } from '../contrat.js';

/** Ce qu'on extrait d'une enveloppe d'interaction, sans encore rien autoriser. */
export interface ExtractionInteraction {
  readonly actionId: string;
  readonly taskId: string;
  /** La production et le verdict que le message montrait — comparés au clic. */
  readonly liaison: LiaisonApprobation;
  /** Où répondre au cliqueur (`response_url` Slack), s'il est fourni. */
  readonly responseUrl: string | null;
  /** Le projet lu dans le `block_id` — INDICE, jamais l'autorité. */
  readonly blockProjectId: string | null;
  readonly userId: string;
  readonly channelId: string;
}

export type MotifInteraction =
  | 'type_ignore'
  | 'action_ignore'
  | 'malforme'
  | 'portee_absente'
  | 'canal_refuse'
  | 'usager_refuse';

export type ExtractionResultat =
  | { readonly ok: true; readonly extraction: ExtractionInteraction }
  | { readonly ok: false; readonly motif: MotifInteraction };

function chaine(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null;
}

/**
 * Extrait l'action utile d'une enveloppe `block_actions`. Tout autre type
 * d'interaction (raccourci, soumission de vue…) rend `type_ignore` : ce n'est
 * pas une erreur, c'est « rien à faire ici » — le socket ACK quand même.
 */
export function extraireInteraction(payload: unknown): ExtractionResultat {
  if (typeof payload !== 'object' || payload === null) return { ok: false, motif: 'malforme' };
  const p = payload as Record<string, unknown>;
  if (p.type !== 'block_actions') return { ok: false, motif: 'type_ignore' };

  const actions = Array.isArray(p.actions) ? p.actions : [];
  const action = actions.find(
    (a): a is Record<string, unknown> =>
      typeof a === 'object' &&
      a !== null &&
      ((a as Record<string, unknown>).action_id === ACTION_APPROUVER ||
        (a as Record<string, unknown>).action_id === ACTION_REJETER),
  );
  if (!action) return { ok: false, motif: 'action_ignore' };

  const actionId = chaine(action.action_id);
  // La valeur porte la tâche ET sa liaison : une valeur d'une autre forme
  // (bouton d'avant la liaison, valeur forgée) est malformée, pas « une tâche ».
  const valeur = lireValeurBouton(action.value);
  const user = p.user as Record<string, unknown> | undefined;
  const userId = chaine(user?.id);
  // Le canal est dans `channel.id`, ou dans `container.channel_id` selon la
  // surface d'où vient le clic. On lit les deux plutôt que d'en supposer un.
  const channel = p.channel as Record<string, unknown> | undefined;
  const container = p.container as Record<string, unknown> | undefined;
  const channelId = chaine(channel?.id) ?? chaine(container?.channel_id);
  if (actionId === null || valeur === null || userId === null || channelId === null) {
    return { ok: false, motif: 'malforme' };
  }

  const blockId = chaine(action.block_id);
  const blockProjectId =
    blockId && blockId.startsWith('hive_approbation:')
      ? blockId.slice('hive_approbation:'.length)
      : null;

  return {
    ok: true,
    extraction: {
      actionId,
      taskId: valeur.taskId,
      liaison: { resultId: valeur.resultId, revueA: valeur.revueA },
      responseUrl: chaine(p.response_url),
      blockProjectId,
      userId,
      channelId,
    },
  };
}

/** Le verdict de revue que porte un `action_id` connu. */
export function verdictDeAction(actionId: string): 'approved' | 'rejected' | null {
  if (actionId === ACTION_APPROUVER) return 'approved';
  if (actionId === ACTION_REJETER) return 'rejected';
  return null;
}

/** L'autorisation Slack d'un projet, telle que le store la rend au serveur. */
export interface AutorisationSlack {
  readonly portees: readonly Portee[];
  readonly canaux: readonly string[];
  readonly usagers: readonly string[];
}

export type VerdictInteraction =
  | {
      readonly ok: true;
      readonly taskId: string;
      readonly verdict: 'approved' | 'rejected';
      readonly liaison: LiaisonApprobation;
    }
  | { readonly ok: false; readonly motif: MotifInteraction };

/**
 * Tranche : cette interaction extraite peut-elle appliquer un verdict, compte
 * tenu de l'autorisation du projet résolu ? Quatre refus distincts (portée,
 * canal, usager) plus l'action non mappable — chacun se journalise tel quel.
 * Fermé par défaut : listes vides ⇒ refus.
 */
export function autoriserInteraction(
  extraction: ExtractionInteraction,
  autorisation: AutorisationSlack,
): VerdictInteraction {
  const verdict = verdictDeAction(extraction.actionId);
  if (verdict === null) return { ok: false, motif: 'action_ignore' };
  if (!autorisation.portees.includes('approbation')) return { ok: false, motif: 'portee_absente' };
  if (!autorisation.canaux.includes(extraction.channelId))
    return { ok: false, motif: 'canal_refuse' };
  if (!autorisation.usagers.includes(extraction.userId))
    return { ok: false, motif: 'usager_refuse' };
  return { ok: true, taskId: extraction.taskId, verdict, liaison: extraction.liaison };
}
