// Le connecteur webhook générique — pousser des faits de la ruche vers une URL.
//
// Le plus petit connecteur utile, et le socle des autres : un POST JSON signé
// HMAC vers une URL que l'hôte configure. Il ne reçoit RIEN (aucune boucle
// entrante), donc il est `lecture_seule` du point de vue de la ruche — il ne
// peut structurellement rien y changer, même si l'humain lui accordait la
// notification d'une approbation : il la POSTE, il ne l'applique jamais.
//
// Deux secrets Queen, dans le `.env` (jamais en base, jamais au nœud) :
//   · l'URL de destination ;
//   · le secret HMAC qui signe le corps — sans lui, n'importe qui ayant l'URL
//     forgerait un faux « décision approuvée ». La signature porte sur les
//     octets exacts (`abonnement.ts`, même schéma `t=…,v1=…`).

import type { DefinitionConnecteur } from '../contrat.js';

/** Le nom d'env qui porte l'URL de destination du webhook. */
export const ENV_WEBHOOK_URL = 'HIVE_CONNECTEUR_WEBHOOK_URL';
/** Le nom d'env qui porte le secret HMAC de signature du webhook sortant. */
export const ENV_WEBHOOK_SECRET = 'HIVE_CONNECTEUR_WEBHOOK_SECRET';

export const DEF_WEBHOOK: DefinitionConnecteur = Object.freeze({
  id: 'webhook',
  libelleFr: 'Webhook générique',
  libelleEn: 'Generic webhook',
  hintFr: 'Pousse décisions, blocages, résumés et demandes d’approbation en JSON signé HMAC',
  hintEn: 'Pushes decisions, blockers, summaries and approval requests as HMAC-signed JSON',
  // Sortant seulement : il ne reçoit aucune interaction, donc il ne peut rien
  // changer dans la ruche. `notification` uniquement — pas d'`approbation`
  // accordable, car il n'a aucune boucle pour la refermer.
  mode: 'lecture_seule',
  porteesPossibles: ['notification'] as const,
  secrets: [
    {
      envVar: ENV_WEBHOOK_URL,
      libelleFr: 'URL de destination',
      libelleEn: 'Destination URL',
      hintFr: 'https://… — l’endpoint qui reçoit les POST JSON',
      hintEn: 'https://… — the endpoint that receives the JSON POSTs',
      requis: true,
    },
    {
      envVar: ENV_WEBHOOK_SECRET,
      libelleFr: 'Secret HMAC',
      libelleEn: 'HMAC secret',
      hintFr: 'Signe chaque corps ; le récepteur le vérifie (en-tête X-Hive-Signature)',
      hintEn: 'Signs every body; the receiver verifies it (X-Hive-Signature header)',
      requis: true,
    },
  ],
});
