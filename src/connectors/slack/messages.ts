// Les messages Slack — du fait typé de la ruche au corps de `chat.postMessage`.
//
// MODULE PUR : construit le JSON du message, ne l'envoie pas. Le Block Kit de
// Slack n'est pas notre invention ; on s'y conforme, mais on décide ICI de ce
// qu'un humain voit : un titre lisible, un corps borné, et — pour une demande
// d'approbation — deux boutons dont l'`action_id` porte le verdict et la
// `value` la tâche ET la production jugée, pour que la boucle entrante sache
// quoi appliquer, à quoi, et refuse un clic devenu périmé.
//
// Le texte est en français (dense, comme le reste) : Slack est vu par l'hôte et
// son équipe, la langue de la ruche.

import type { EvenementConnecteur, LiaisonApprobation } from '../contrat.js';

/** L'`action_id` du bouton « approuver » — lu tel quel par `interactions.ts`. */
export const ACTION_APPROUVER = 'hive_approuver';
/** L'`action_id` du bouton « rejeter ». */
export const ACTION_REJETER = 'hive_rejeter';

/** Un bloc Slack, tel que l'API l'attend (forme ouverte : Slack en ajoute). */
export type BlocSlack = Record<string, unknown>;

/** Le corps d'un `chat.postMessage` (hors `channel`, ajouté par le client). */
export interface MessageSlack {
  /** Repli texte (notifications, lecteurs d'écran) : toujours présent. */
  readonly text: string;
  readonly blocks: BlocSlack[];
}

/** Coupe un corps trop long pour un bloc Slack (limite ~3000 ; on borne à 2800). */
function borner(texte: string): string {
  const max = 2800;
  return texte.length <= max ? texte : `${texte.slice(0, max - 1)}…`;
}

/**
 * Échappe `&`, `<` et `>` comme Slack l'EXIGE pour tout texte `mrkdwn` (et le
 * repli `text`). Un titre de tâche peut venir d'un agent (délégation, éclaireur),
 * un motif d'échec ou une raison de revue d'un humain : sans cet échappement,
 * `<!channel>` sonnerait tout le canal et `<https://ailleurs|Approuver ici>`
 * glisserait un lien déguisé à côté des vrais boutons. `&` d'abord, sinon on
 * ré-échapperait nos propres entités. On échappe AVANT de borner : couper au
 * milieu d'une entité laisserait un `&am` inoffensif, jamais un `<` nu.
 */
export function echapperMrkdwn(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Ce que porte la `value` d'un bouton : la tâche, et ce que le verdict doit retrouver. */
export interface ValeurBouton extends LiaisonApprobation {
  readonly taskId: string;
}

/**
 * Sérialise la valeur d'un bouton. JSON à clés courtes : Slack borne `value` à
 * 2 000 caractères, et un séparateur maison casserait sur un identifiant qui
 * le contiendrait. Relue par `lireValeurBouton` — la seule autre moitié.
 */
export function encoderValeurBouton(v: ValeurBouton): string {
  return JSON.stringify({ t: v.taskId, r: v.resultId, v: v.revueA });
}

/** Relit la valeur d'un bouton, ou `null` si elle n'a pas EXACTEMENT notre forme. */
export function lireValeurBouton(brut: unknown): ValeurBouton | null {
  if (typeof brut !== 'string') return null;
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return null;
  }
  if (typeof lu !== 'object' || lu === null) return null;
  const o = lu as Record<string, unknown>;
  const revueValide = o.v === null || (typeof o.v === 'number' && Number.isSafeInteger(o.v));
  if (typeof o.t !== 'string' || o.t === '' || !Number.isSafeInteger(o.r) || !revueValide) {
    return null;
  }
  return { taskId: o.t, resultId: o.r as number, revueA: o.v as number | null };
}

const PREFIXE: Record<EvenementConnecteur['kind'], string> = {
  resume_mission: '📋 Résumé de mission',
  decision: '✅ Décision',
  blocage: '⛔ Blocage',
  demande_approbation: '🔔 Approbation demandée',
};

/**
 * Le message pour un événement. Une demande d'approbation porte en plus deux
 * boutons — SI la boucle entrante peut les fermer (`boutons`, décidé par le
 * hub : jeton d'app posé). Sans elle, des boutons seraient des clics qui
 * n'aboutissent nulle part, sans trace : on poste la demande seule, et on dit
 * où répondre. Le repli `text` reprend le titre — un canal muet, une
 * notification mobile, un lecteur d'écran le liront.
 */
export function messagePourEvenement(
  ev: EvenementConnecteur,
  opts: { readonly boutons: boolean },
): MessageSlack {
  const entete = borner(echapperMrkdwn(`${PREFIXE[ev.kind]} — ${ev.titre}`));
  const blocks: BlocSlack[] = [{ type: 'section', text: { type: 'mrkdwn', text: `*${entete}*` } }];
  if (ev.corps !== undefined && ev.corps.trim() !== '') {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: borner(echapperMrkdwn(ev.corps)) },
    });
  }
  if (ev.kind !== 'demande_approbation' || ev.taskId === undefined) {
    return { text: entete, blocks };
  }
  if (!opts.boutons || ev.liaison === undefined) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Répondez dans la Miellerie : les approbations Slack ne sont pas ouvertes sur cette ruche.',
        },
      ],
    });
    return { text: entete, blocks };
  }
  // `block_id` porte le projet ; chaque bouton porte la tâche ET sa liaison
  // (production + verdict attendus) dans sa `value`. La boucle entrante lit
  // les deux — jamais devinés d'un texte.
  const value = encoderValeurBouton({ taskId: ev.taskId, ...ev.liaison });
  blocks.push({
    type: 'actions',
    block_id: `hive_approbation:${ev.projectId}`,
    elements: [
      {
        type: 'button',
        action_id: ACTION_APPROUVER,
        style: 'primary',
        text: { type: 'plain_text', text: 'Approuver' },
        value,
      },
      {
        type: 'button',
        action_id: ACTION_REJETER,
        style: 'danger',
        text: { type: 'plain_text', text: 'Rejeter' },
        value,
      },
    ],
  });
  return { text: entete, blocks };
}
