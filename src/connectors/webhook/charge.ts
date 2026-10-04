// La charge utile d'un webhook — comment un fait de la ruche devient un corps
// JSON signé, et l'en-tête qui le prouve.
//
// MODULE PUR : construit la requête (url, en-têtes, corps), ne l'ENVOIE pas.
// L'envoi (I/O réseau) vit dans `envoi.ts`. Séparer les deux permet de tester
// le corps exact et la signature sans toucher au réseau — et un test qui frappe
// le réseau ne prouve que le réseau.

import { signer } from '../../orchestrator/abonnement.js';
import type { EvenementConnecteur } from '../contrat.js';

/** L'en-tête où le récepteur lit la signature. Même forme que Stripe : `t=…,v1=…`. */
export const ENTETE_SIGNATURE = 'x-hive-signature';

/** La forme JSON d'un événement poussé. Stable : un récepteur s'y adosse. */
export interface ChargeWebhook {
  readonly kind: EvenementConnecteur['kind'];
  readonly projectId: string;
  readonly titre: string;
  readonly corps?: string;
  readonly taskId?: string;
  readonly etat?: 'approved' | 'rejected' | null;
  /** Millisecondes epoch de l'émission — permet au récepteur de dédupliquer. */
  readonly emisA: number;
}

/**
 * De l'événement au corps JSON canonique. L'ordre des clés est FIXE (l'objet
 * est construit champ par champ) : la signature porte sur ces octets exacts, et
 * re-sérialiser dans un autre ordre la casserait.
 */
export function chargeDepuisEvenement(ev: EvenementConnecteur, emisA: number): ChargeWebhook {
  return {
    kind: ev.kind,
    projectId: ev.projectId,
    titre: ev.titre,
    ...(ev.corps !== undefined ? { corps: ev.corps } : {}),
    ...(ev.taskId !== undefined ? { taskId: ev.taskId } : {}),
    ...(ev.etat !== undefined ? { etat: ev.etat } : {}),
    emisA,
  };
}

export interface RequeteWebhook {
  readonly url: string;
  readonly corps: string;
  readonly entetes: Record<string, string>;
}

/**
 * La requête complète, prête à partir : le corps sérialisé UNE fois, puis signé
 * sur ces mêmes octets. Le récepteur reconstruit `t.corps` et compare le HMAC —
 * exactement `verifierSignature` d'`abonnement.ts`, réutilisée telle quelle.
 */
export function construireRequeteWebhook(opts: {
  url: string;
  secret: string;
  evenement: EvenementConnecteur;
  now: number;
}): RequeteWebhook {
  const charge = chargeDepuisEvenement(opts.evenement, opts.now);
  const corps = JSON.stringify(charge);
  return {
    url: opts.url,
    corps,
    entetes: {
      'content-type': 'application/json',
      [ENTETE_SIGNATURE]: signer(corps, opts.secret, opts.now),
    },
  };
}
