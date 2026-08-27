// Sur quelle IA la ruche est-elle branchée ? — la question qu'on se pose en
// premier, et à laquelle rien ne répondait.
//
// ─── POURQUOI ─────────────────────────────────────────────────────────────────
//
// L'utilisateur : « je veux voir en haut sur quelle IA elle est connectée ».
// Aujourd'hui l'en-tête dit « connecté / hors ligne » — mais c'est la
// CONNEXION AU HUB, pas l'agent qui code. Une ruche peut être « connectée »
// et n'avoir aucune IA derrière : le voyant est vert et rien ne travaille.
// C'est exactement le cas qui a fait dire « il travaille pas ».
//
// MODULE PUR — aucune I/O, aucune horloge. Il PLIE l'état des nœuds ; il ne
// va rien chercher. Ce qu'il rend se dérive des nœuds INSCRITS, jamais d'une
// déclaration de capacité qu'on croirait sur parole.

import { libelleAgent } from './agent-libelle.js';
import { estAgentSimule } from './agent-production.js';

/** Le strict nécessaire d'un nœud pour cette question. */
export interface NoeudVu {
  readonly agentType: string;
  readonly status: string;
}

export interface AgentConnecte {
  readonly agentType: string;
  readonly libelle: string;
  /** Combien de nœuds en ligne portent cet agent. */
  readonly enLigne: number;
  /** Combien sont inscrits mais muets. */
  readonly horsLigne: number;
  /** `shell` / `sim` : il répond, il ne code pas. */
  readonly simule: boolean;
}

/**
 * Les agents effectivement présents, en ligne d'abord.
 *
 * Ordre TOTAL — nombre en ligne décroissant, puis libellé — pour que deux
 * lectures du même état rendent le même bandeau. Un en-tête qui change d'ordre
 * à chaque rafraîchissement se lit comme un changement d'état.
 */
export function agentsConnectes(noeuds: readonly NoeudVu[]): AgentConnecte[] {
  const par = new Map<string, { enLigne: number; horsLigne: number }>();
  for (const n of noeuds) {
    const c = par.get(n.agentType) ?? { enLigne: 0, horsLigne: 0 };
    if (n.status === 'online') c.enLigne++;
    else c.horsLigne++;
    par.set(n.agentType, c);
  }
  return [...par.entries()]
    .map(([agentType, c]) => ({
      agentType,
      libelle: libelleAgent(agentType),
      enLigne: c.enLigne,
      horsLigne: c.horsLigne,
      simule: estAgentSimule(agentType),
    }))
    .sort((a, b) => b.enLigne - a.enLigne || a.libelle.localeCompare(b.libelle));
}

/**
 * Une IA capable de produire du code est-elle branchée MAINTENANT ?
 *
 * En ligne ET non simulée : un `shell` en ligne ne compte pas — c'est
 * précisément le piège que ce bandeau doit lever.
 */
export function aUneIaReelle(agents: readonly AgentConnecte[]): boolean {
  return agents.some((a) => a.enLigne > 0 && !a.simule);
}

export type EtatBandeau = 'aucun_noeud' | 'aucune_ia' | 'simulee' | 'reelle';

/** Ce que le bandeau doit DIRE — quatre états, pas un binaire. */
export function etatBandeau(agents: readonly AgentConnecte[]): EtatBandeau {
  if (agents.length === 0) return 'aucun_noeud';
  if (aUneIaReelle(agents)) return 'reelle';
  if (agents.some((a) => a.enLigne > 0)) return 'simulee';
  return 'aucune_ia';
}
