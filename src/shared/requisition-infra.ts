// Réquisition depuis un échec d'infrastructure agent — boucle B/C/D mid-task.
//
// MODULE PUR. Quand l'adaptateur signale auth/quota, on distingue les cas où
// l'humain peut débloquer (credentials locaux) des cas de failover pur.

import type { AgentType } from '../node-client/agent-detect.js';
import { requisitionSiCredentialsManquantes } from '../node-client/agent-detect.js';

/** Motifs d'échec liés à l'authentification / clé API (sous-ensemble infra). */
export const ECHEC_CREDENTIAL_RE =
  /unauthor|authentication|not logged in|forbidden|\b401\b|\b403\b|api[_ -]?key|invalid.{0,12}key|login|sign in|no api key|missing.{0,12}key/i;

export function estEchecCredential(logs: string): boolean {
  return ECHEC_CREDENTIAL_RE.test(logs);
}

/**
 * Propose une réquisition `cle_api` quand l'échec infra ressemble à un problème
 * d'identifiants. Retourne `null` si failover classique suffit.
 */
export function requisitionDepuisEchecInfra(
  agentType: AgentType | string,
  logs: string,
  taskTitle: string,
  env: NodeJS.ProcessEnv = process.env,
): { genre: 'cle_api'; libelle: string; detail: string } | null {
  if (!estEchecCredential(logs)) return null;
  const proactive = requisitionSiCredentialsManquantes(agentType as AgentType, env);
  const titre = taskTitle.trim().slice(0, 80) || 'tâche en cours';
  if (proactive) {
    return {
      genre: 'cle_api',
      libelle: proactive.libelle,
      detail: `${proactive.detail} (bloqué sur « ${titre} »).`,
    };
  }
  return {
    genre: 'cle_api',
    libelle: `Identifiants agent (${agentType})`,
    detail:
      `Échec auth/quota pendant « ${titre} ». Configurez les credentials sur ce poste ` +
      `(ou accordez depuis la Chambre), puis la tâche reprendra.`,
  };
}
