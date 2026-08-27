// Le nom d'un agent tel qu'un humain l'écrit.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// Le nœud annonce un IDENTIFIANT (`claude-code`, `shell`), et c'est très bien :
// c'est une clé, elle se compare et se sérialise. Mais l'interface l'affichait
// TEL QUEL, jusque dans la fiche d'une coéquipière — « Chez Micka ·
// claude-code ». Pire pour le repli : la ruche disait « shell », un mot qui ne
// prévient personne que les diffs produits sont SIMULÉS.
//
// Le nom lisible se décide donc à un seul endroit, partagé par le nœud (qui
// l'imprime au démarrage) et par le tableau de bord (qui l'affiche).

/** Les noms de marque, identiques dans les deux langues. */
const MARQUES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  grok: 'Grok Build',
};

/**
 * Le libellé lisible d'un `agentType`, ou l'identifiant nu si on ne le connaît
 * pas — inventer un nom pour un agent inconnu tromperait plus que la clé brute.
 */
export function libelleAgent(agentType: string, anglais = false): string {
  const marque = MARQUES[agentType];
  if (marque) return marque;
  if (agentType === 'shell') return anglais ? 'Shell (simulated)' : 'Shell (simulé)';
  if (agentType === 'custom') return anglais ? 'Custom command' : 'Commande personnalisée';
  return agentType;
}
