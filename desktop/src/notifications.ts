// Ce qui mérite une notification du système — et ce qui n'en mérite pas.
//
// L'app s'abonne au journal de la Reine comme un écran (`subscribe`), et ne
// notifie que ce qui ATTEND un humain ou ce qui a CASSÉ sans lui : un agent
// qui réclame un identifiant, une relecture devenue impossible, une livraison
// à reprendre, une fusion refusée, un plafond de dépense atteint. Le reste —
// tâches finies, battements, relectures réussies — est la vie normale de la
// ruche : le notifier apprendrait à ignorer les notifications.
//
// Le verdict `human_review_required` de l'Évaluateur n'est PAS dans cette
// liste : il n'est pas journalisé comme événement. Le déduire côté app (d'un
// statut de tâche, d'un silence) serait deviner ce que la Reine n'a pas dit ;
// le journaliser à la Reine est une suite nommée de l'ADR 0013.

/** Un événement du journal de la Reine, tel que le flux `/ws` le livre. */
export interface EvenementRuche {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Une notification à montrer, et la vue de l'écran qu'elle ouvre au clic. */
export interface NotificationRuche {
  readonly titre: string;
  readonly corps: string;
  /** Route de l'écran (`#/…`), sans le `#`. */
  readonly route: string;
}

const texte = (v: unknown, repli: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 200) : repli;

/** Les types notifiés — exportés pour que la liste se lise en un endroit. */
export const TYPES_NOTIFIES = [
  'requisition_ouverte',
  'contre_expertise_impossible',
  'delivery_recovery_required',
  'merge_failed',
  'balance_cap_reached',
] as const;

export function notificationPour(e: EvenementRuche): NotificationRuche | null {
  const p = e.payload;
  switch (e.type) {
    case 'requisition_ouverte':
      return {
        titre: 'Un agent attend un identifiant',
        corps: `${texte(p.libelle, 'Une réquisition')} — à accorder ou refuser dans la Chambre.`,
        // La Chambre du nœud qui la porte (`#/chambre/<nodeId>`, ADR 0010) ;
        // un identifiant hors de la grammaire d'une route n'en fait pas une.
        route:
          typeof p.nodeId === 'string' && /^[\w-]+$/.test(p.nodeId)
            ? `chambre/${p.nodeId}`
            : 'chambre',
      };
    case 'contre_expertise_impossible':
      return {
        titre: 'Relecture humaine requise',
        corps: `Aucune famille ne peut relire ce résultat : ${texte(p.cause, 'relecture impossible')}.`,
        route: '',
      };
    case 'delivery_recovery_required':
      return {
        titre: 'Livraison à reprendre',
        corps: 'La Reine a redémarré pendant une livraison : elle attend votre geste.',
        route: '',
      };
    case 'merge_failed':
      return {
        titre: 'Fusion refusée',
        corps: texte(p.reason, 'Une fusion a échoué.'),
        route: '',
      };
    case 'balance_cap_reached':
      return {
        titre: 'Plafond de dépense atteint',
        corps:
          p.applique === true
            ? 'Le projet est à l’arrêt jusqu’à ce que vous releviez son plafond.'
            : 'Le projet a atteint son plafond (mode consultatif : il continue).',
        route: '',
      };
    default:
      return null;
  }
}

/** La mort d'une ouvrière : la ruche continue, mais on le dit, avec sa dernière phrase. */
export function notificationMortOuvriere(nom: string, message: string): NotificationRuche {
  return { titre: `${nom} s’est arrêtée`, corps: message.replace(/^✘\s*/, ''), route: '' };
}

/** Les relances épuisées : la Reine ne reviendra pas seule. Le clic ramène la fenêtre sur l'écran d'erreur. */
export const NOTIFICATION_REINE_ARRETEE: NotificationRuche = {
  titre: 'La Reine s’est arrêtée',
  corps: 'Elle ne redémarre plus d’elle-même. Ouvrez Hive pour lire pourquoi et réessayer.',
  route: '',
};

/** Ce qu'affiche la barre système en une ligne. */
export function libelleEtat(e: {
  readonly reine: 'demarrage' | 'en-ligne' | 'relance' | 'arretee' | 'externe';
  readonly ouvrieres: number;
}): string {
  switch (e.reine) {
    case 'demarrage':
      return 'La ruche démarre…';
    case 'relance':
      return 'La Reine redémarre…';
    case 'arretee':
      return 'Ruche arrêtée';
    case 'externe':
      return 'Ruche ouverte (lancée hors de l’app)';
    case 'en-ligne':
      return `Reine en ligne · ${String(e.ouvrieres)} ouvrière${e.ouvrieres > 1 ? 's' : ''}`;
  }
}
