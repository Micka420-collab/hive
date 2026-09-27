// Les messages Slack — du fait typé de la ruche au corps de `chat.postMessage`.
//
// MODULE PUR : construit le JSON du message, ne l'envoie pas. Le Block Kit de
// Slack n'est pas notre invention ; on s'y conforme, mais on décide ICI de ce
// qu'un humain voit : un titre lisible, un corps borné, et — pour une demande
// d'approbation — deux boutons dont l'`action_id` porte le verdict et la
// `value` la tâche, pour que la boucle entrante sache quoi appliquer et à quoi.
//
// Le texte est en français (dense, comme le reste) : Slack est vu par l'hôte et
// son équipe, la langue de la ruche.

import type { EvenementConnecteur } from '../contrat.js';

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

const PREFIXE: Record<EvenementConnecteur['kind'], string> = {
  resume_mission: '📋 Résumé de mission',
  decision: '✅ Décision',
  blocage: '⛔ Blocage',
  demande_approbation: '🔔 Approbation demandée',
};

/**
 * Le message pour un événement. Une demande d'approbation porte en plus deux
 * boutons ; les autres sont de simples sections. Le repli `text` reprend le
 * titre — un canal muet, une notification mobile, un lecteur d'écran le liront.
 */
export function messagePourEvenement(ev: EvenementConnecteur): MessageSlack {
  const entete = `${PREFIXE[ev.kind]} — ${ev.titre}`;
  const blocks: BlocSlack[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${borner(entete)}*` } },
  ];
  if (ev.corps !== undefined && ev.corps.trim() !== '') {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: borner(ev.corps) } });
  }
  if (ev.kind === 'demande_approbation' && ev.taskId !== undefined) {
    blocks.push({
      type: 'actions',
      // `block_id` porte le projet ; chaque bouton porte la tâche dans sa
      // `value`. La boucle entrante lit les deux — jamais devinés d'un texte.
      block_id: `hive_approbation:${ev.projectId}`,
      elements: [
        {
          type: 'button',
          action_id: ACTION_APPROUVER,
          style: 'primary',
          text: { type: 'plain_text', text: 'Approuver' },
          value: ev.taskId,
        },
        {
          type: 'button',
          action_id: ACTION_REJETER,
          style: 'danger',
          text: { type: 'plain_text', text: 'Rejeter' },
          value: ev.taskId,
        },
      ],
    });
  }
  return { text: borner(entete), blocks };
}
