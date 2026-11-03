// Les agents de la colonne de droite : les machines INSCRITES, telles qu'elles sont.
//
// Un « agent » de Hive Studio est un nœud de la ruche — une machine qui fait
// tourner un CLI de codage (Claude Code, Codex…). Ce module en tire une carte :
// nom, outil, en ligne ou non, charge réelle, tâche en cours. Rien n'est prêté :
// pas de « rôle » inventé (Architecte, Designer…) que la ruche n'attribue pas —
// le rôle affiché est l'outil que la machine a déclaré.
//
// Module PUR.

import { libelleAgent } from '../../../src/shared/agent-libelle';
import { estAgentSimule } from '../../../src/shared/agent-production';
import type { HiveNode, Task } from '../../../src/shared/types';

export interface CarteAgent {
  readonly id: string;
  readonly nom: string;
  readonly proprietaire: string;
  readonly outil: string;
  readonly agentType: string;
  readonly enLigne: boolean;
  /** `shell` / simulé : répond, ne code pas. */
  readonly simule: boolean;
  readonly actives: number;
  readonly capacite: number;
  /** La tâche la plus récemment confiée à cette machine et encore en vol. */
  readonly tache: { readonly id: string; readonly titre: string } | null;
}

export function cartesAgents(
  noeuds: readonly HiveNode[],
  taches: readonly Task[],
  anglais = false,
): CarteAgent[] {
  const parNoeud = new Map<string, Task[]>();
  for (const t of taches) {
    if (!t.assignedNodeId || (t.status !== 'running' && t.status !== 'assigned')) continue;
    const l = parNoeud.get(t.assignedNodeId) ?? [];
    l.push(t);
    parNoeud.set(t.assignedNodeId, l);
  }
  return noeuds
    .map((n) => {
      const enVol = (parNoeud.get(n.id) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
      const premiere = enVol[0];
      return {
        id: n.id,
        nom: n.name,
        proprietaire: n.ownerName,
        outil: libelleAgent(n.agentType, anglais),
        agentType: n.agentType,
        enLigne: n.status === 'online',
        simule: estAgentSimule(n.agentType),
        // `running` est dérivé des tâches côté Reine ; on prend le plus grand
        // des deux pour ne jamais afficher une machine plus libre qu'elle n'est.
        actives: Math.max(n.running, enVol.length),
        capacite: n.maxConcurrency,
        tache: premiere ? { id: premiere.id, titre: premiere.title } : null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.enLigne) - Number(a.enLigne) ||
        Number(a.simule) - Number(b.simule) ||
        b.actives - a.actives ||
        a.nom.localeCompare(b.nom, 'fr'),
    );
}

/** L'état d'une carte, en un mot — c'est lui que lit la pastille ET le lecteur d'écran. */
export function etatAgent(c: CarteAgent): 'hors_ligne' | 'occupe' | 'disponible' | 'plein' {
  if (!c.enLigne) return 'hors_ligne';
  if (c.capacite > 0 && c.actives >= c.capacite) return 'plein';
  return c.actives > 0 ? 'occupe' : 'disponible';
}

/** Les initiales d'un nom, pour un avatar qui ne prétend pas être une photo. */
export function initiales(nom: string): string {
  const mots = nom
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (mots.length === 0) return '?';
  const a = mots[0]![0] ?? '';
  const b = mots.length > 1 ? (mots[mots.length - 1]![0] ?? '') : (mots[0]![1] ?? '');
  return (a + b).toUpperCase();
}
