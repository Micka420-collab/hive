// Réquisition depuis un échec d'infrastructure agent — boucle B/C/D mid-task.
//
// MODULE PUR. Quand l'adaptateur signale auth/quota OU binaire absent, on
// distingue les cas où l'humain peut débloquer (Chambre) des cas de failover.

import type { AgentType } from '../node-client/agent-detect.js';
import { labelPour, requisitionSiCredentialsManquantes } from '../node-client/agent-detect.js';

/** Motifs d'échec liés à l'authentification / clé API (sous-ensemble infra). */
export const ECHEC_CREDENTIAL_RE =
  /unauthor|authentication|not logged in|forbidden|\b401\b|\b403\b|api[_ -]?key|invalid.{0,12}key|login|sign in|no api key|missing.{0,12}key/i;

/**
 * Motifs d'échec liés à un binaire / CLI manquant (spawn ENOENT, PATH…).
 * Volontairement distinct des credentials : Accorder ouvre un hint install,
 * pas un modal de clé.
 */
export const ECHEC_BINAIRE_RE =
  /\bENOENT\b|not found|command not found|No such file or directory|is not recognized as an internal or external command|échec du lancement/i;

export function estEchecCredential(logs: string): boolean {
  return ECHEC_CREDENTIAL_RE.test(logs);
}

export function estEchecBinaire(logs: string): boolean {
  return ECHEC_BINAIRE_RE.test(logs);
}

/** Nom cité dans `[hive] échec du lancement de « … »` (exec.ts), sinon null. */
export function nomBinaireDepuisLogs(logs: string): string | null {
  const m = logs.match(/échec du lancement de «\s*([^»]+?)\s*»/i);
  const nom = m?.[1]?.trim();
  return nom ? nom.slice(0, 80) : null;
}

export type RequisitionDepuisInfra =
  | { genre: 'cle_api'; libelle: string; detail: string }
  | { genre: 'binaire'; libelle: string; detail: string };

/**
 * Propose une réquisition HITL quand l'échec infra est débloquable par
 * l'humain. Credentials d'abord (sinon un log « clé absente » + ENOENT
 * ouvrirait un hint binaire). `null` → failover classique.
 */
export function requisitionDepuisEchecInfra(
  agentType: AgentType | string,
  logs: string,
  taskTitle: string,
  env: NodeJS.ProcessEnv = process.env,
): RequisitionDepuisInfra | null {
  const titre = taskTitle.trim().slice(0, 80) || 'tâche en cours';

  if (estEchecCredential(logs)) {
    const proactive = requisitionSiCredentialsManquantes(agentType as AgentType, env);
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

  if (estEchecBinaire(logs)) {
    const bin = nomBinaireDepuisLogs(logs);
    const label =
      agentType === 'shell' || agentType === 'custom'
        ? (bin ?? 'CLI')
        : labelPour(agentType as AgentType);
    const cible = bin ? `« ${bin} »` : `l’agent ${label}`;
    return {
      genre: 'binaire',
      libelle: bin ? `Binaire ${bin}` : `Binaire / CLI (${label})`,
      detail:
        `${cible} introuvable pendant « ${titre} ». Installez-le sur ce poste ` +
        `(PATH / hive doctor), accordez depuis la Chambre, puis la tâche reprendra.`,
    };
  }

  return null;
}
