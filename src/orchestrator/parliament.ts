// Parlement des Agents (palier 4) — consensus par vote sur le meilleur résultat.
//
// Quand plusieurs agents produisent un résultat pour la MÊME tâche (les drones
// de Drone Wars, ou les tentatives successives de nœuds différents), lequel
// croire ? Le Parlement fait voter : deux résultats identiques « votent » pour la
// même sortie et forment une faction. La faction la plus large gagne — à
// condition d'atteindre le quorum. Un accord ENTRE IA DIFFÉRENTES (claude-code,
// codex, une commande libre…) est un signal plus fort qu'entre clones : c'est le
// critère de départage.
//
// Là où Drone Wars prend le PREMIER résultat valide (vitesse), le Parlement prend
// le résultat sur lequel plusieurs agents indépendants S'ACCORDENT (confiance) —
// utile pour les décisions critiques. Module PUR : aucune I/O, déterministe.

/** Un bulletin : le résultat d'un agent pour la tâche. */
export interface Ballot {
  nodeId: string;
  agentType: string;
  success: boolean;
  /** Empreinte de la sortie : deux bulletins de même signature votent pareil. */
  signature: string;
}

/** Un bloc d'agents qui ont produit la même sortie. */
export interface Faction {
  signature: string;
  /** Nombre de voix = nœuds DISTINCTS de la faction (un nœud ne vote qu'une fois). */
  votes: number;
  nodeIds: string[];
  /** Types d'agents distincts ayant voté pour cette sortie. */
  agentTypes: string[];
  /** Diversité = nombre de types d'agents distincts (départage les égalités). */
  diversity: number;
}

export type ParliamentOutcome =
  | 'elected' // une faction atteint le quorum : consensus
  | 'no_quorum' // des votes, mais aucune faction n'atteint le quorum : pas de consensus
  | 'no_ballots'; // aucun résultat valide à départager

export interface Verdict {
  outcome: ParliamentOutcome;
  /** Faction élue (quorum atteint), sinon null. */
  winner: Faction | null;
  /** Toutes les factions, triées (la plus forte en tête) — même sans quorum. */
  factions: Faction[];
  quorum: number;
}

export interface TallyOptions {
  /** Voix minimales pour un consensus (défaut 2 : au moins deux agents d'accord). */
  quorum?: number;
}

/**
 * Empreinte stable d'une sortie, tolérante aux différences cosmétiques : fins de
 * ligne (CRLF/LF) et espaces en fin de ligne normalisés, lignes vides de tête et
 * de queue supprimées. Hash FNV-1a 32 bits (déterministe, sans dépendance).
 * Deux résultats « au fond identiques » obtiennent donc la même signature.
 */
export function signatureOf(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  // FNV-1a 32 bits.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Dépouille les bulletins et rend un verdict. Seuls les résultats en SUCCÈS
 * votent (un échec ne propose aucune sortie crédible). Les bulletins sont
 * regroupés par signature ; les voix d'une faction sont comptées par nœud
 * DISTINCT (un même nœud qui rend deux fois la même sortie ne pèse qu'une voix).
 * Tri des factions : voix décroissantes, puis diversité d'agents décroissante,
 * puis signature (ordre stable). Élue si ses voix atteignent le quorum.
 */
export function tally(ballots: Ballot[], options: TallyOptions = {}): Verdict {
  const quorum = Math.max(1, Math.floor(options.quorum ?? 2));
  const valid = ballots.filter((b) => b.success && b.nodeId);
  if (valid.length === 0) {
    return { outcome: 'no_ballots', winner: null, factions: [], quorum };
  }

  const groups = new Map<string, { nodes: Set<string>; types: Set<string> }>();
  for (const b of valid) {
    let group = groups.get(b.signature);
    if (!group) {
      group = { nodes: new Set(), types: new Set() };
      groups.set(b.signature, group);
    }
    group.nodes.add(b.nodeId);
    group.types.add(b.agentType || 'inconnu');
  }

  const factions: Faction[] = [...groups.entries()].map(([signature, g]) => ({
    signature,
    votes: g.nodes.size,
    nodeIds: [...g.nodes].sort(),
    agentTypes: [...g.types].sort(),
    diversity: g.types.size,
  }));

  factions.sort(
    (x, y) =>
      y.votes - x.votes || y.diversity - x.diversity || x.signature.localeCompare(y.signature),
  );

  const top = factions[0] ?? null;
  const elected = top !== null && top.votes >= quorum;
  return {
    outcome: elected ? 'elected' : 'no_quorum',
    winner: elected ? top : null,
    factions,
    quorum,
  };
}
