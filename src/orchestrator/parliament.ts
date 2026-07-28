// Parlement des Agents (palier 4) — consensus par vote sur le meilleur résultat.
//
// Quand plusieurs agents produisent un résultat pour la MÊME tâche (les drones
// de Drone Wars, ou les tentatives successives de nœuds différents), lequel
// croire ? Le Parlement fait voter : deux résultats identiques « votent » pour la
// même sortie et forment une faction. La faction la plus large gagne — à
// condition d'atteindre le quorum.
//
// Là où Drone Wars prend le PREMIER résultat valide (vitesse), le Parlement prend
// le résultat sur lequel plusieurs agents indépendants S'ACCORDENT (confiance) —
// utile pour les décisions critiques. Module PUR : aucune I/O, déterministe.
//
// ─── CE QUE L'IDENTITÉ TEXTUELLE PEUT DIRE, ET CE QU'ELLE NE PEUT PAS ────────
//
// Il faut le dire tout de suite, parce que ce fichier a longtemps laissé croire
// le contraire : **`elected` est hors d'atteinte sur du code libre.**
//
// La signature porte sur le DIFF BRUT. Deux agents différents qui font
// exactement la même correction ne rendent jamais les mêmes octets — un
// commentaire de plus, un nom de variable, un `index 1a2b3c4..5d6e7f8` qui
// dépend du contenu, et les signatures divergent. Le cas que ce module
// présentait comme son signal le plus fort — un accord entre claude-code et
// codex — est précisément celui qu'il ne peut PAS détecter.
//
// Sur du code, `no_quorum` est donc le résultat NORMAL. Ce n'est pas un
// désaccord constaté : c'est l'absence de mesure. L'écran de la Miellerie
// disait « Pas de quorum — arbitrage humain » à quelqu'un dont les deux agents
// avaient peut-être écrit la même chose.
//
// L'identité textuelle reste juste — et forte — là où la sortie est COURTE et
// CANONIQUE : une décision, une réponse, une option choisie, un JSON normalisé.
// Deux agents qui rendent le même verdict rendent les mêmes octets.
//
// ─── POURQUOI ON NE NORMALISE PAS PLUS ───────────────────────────────────────
//
// La correction qui vient à l'esprit — retirer les en-têtes de hunk, effacer
// les commentaires, renommer les variables — est un piège, et c'est le même que
// celui de la loupe (`scripts/loupe.mjs`) : elle déplace le mode d'échec du
// côté RASSURANT. Deux solutions RÉELLEMENT différentes finiraient par se
// confondre, et le Parlement annoncerait un consensus qui n'existe pas. Or tout
// son objet est la confiance : un faux consensus est strictement pire que pas
// de consensus. On ne canonise pas du code à coups d'expressions régulières.
//
// ─── D'OÙ UN SECOND SIGNAL, PLUS FAIBLE, ET QUI NE SE CONFOND PAS ────────────
//
// `surfaces` regroupe les bulletins par ENSEMBLE DE FICHIERS TOUCHÉS. Ça ne dit
// pas que deux agents ont écrit la même chose ; ça dit qu'ils sont allés au même
// endroit. C'est faible, et c'est assumé — mais c'est mesurable sur du code, là
// où l'identité textuelle ne mesure rien.
//
// Sa valeur est surtout dans le DÉSACCORD : deux surfaces distinctes veulent
// dire que les agents ne sont pas d'accord sur l'endroit où le changement va —
// une divergence réelle, que l'identité textuelle noyait dans le bruit puisque
// tout lui paraissait déjà divergent.
//
// C'est un CHAMP SÉPARÉ, jamais une valeur de plus dans `outcome`. Les fondre
// dans une même énumération laisserait lire « même surface » comme
// « consensus », ce qui est exactement la confusion contre laquelle tout ce
// bloc de commentaire existe.

/** Un bulletin : le résultat d'un agent pour la tâche. */
export interface Ballot {
  nodeId: string;
  agentType: string;
  success: boolean;
  /** Empreinte de la sortie : deux bulletins de même signature votent pareil. */
  signature: string;
  /**
   * Les fichiers que ce résultat touche — la SURFACE.
   *
   * OBLIGATOIRE, et pas optionnel : un appelant qui l'oublierait perdrait le
   * seul signal qui fonctionne sur du code, sans que rien ne le lui dise.
   * Vide quand le diff est vide ou illisible ; ces bulletins-là ne forment
   * jamais de surface commune (voir `tally`).
   */
  fichiers: string[];
}

/**
 * Un bloc d'agents allés au MÊME endroit, quoi qu'ils y aient écrit.
 *
 * À ne pas confondre avec une `Faction`, qui exige les mêmes octets. Une
 * surface commune n'est PAS un consensus : c'est un accord sur le lieu.
 */
export interface Surface {
  /** Les fichiers, triés — courts et lisibles, c'est tout l'intérêt. */
  fichiers: string[];
  /** Nœuds DISTINCTS allés là (un nœud ne compte qu'une fois). */
  votes: number;
  nodeIds: string[];
  agentTypes: string[];
  diversity: number;
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
  /**
   * Les blocs allés au même endroit, triés (le plus large en tête).
   *
   * Toujours calculé, même quand `outcome` vaut `elected` : une forme uniforme
   * évite au lecteur d'avoir à savoir quand le champ existe.
   */
  surfaces: Surface[];
  /**
   * Bulletins dont la surface est ILLISIBLE (diff vide ou non analysable).
   *
   * Ils sont écartés du regroupement, jamais fondus dans une surface « vide » :
   * deux diffs qu'on n'a pas su lire ne sont pas d'accord, on ne sait pas.
   * Le compte est rendu pour que cette abstention se VOIE — un zéro silencieux
   * se lirait comme « tout le monde a été pris en compte ».
   */
  sansSurface: number;
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
    return {
      outcome: 'no_ballots',
      winner: null,
      factions: [],
      quorum,
      surfaces: [],
      sansSurface: 0,
    };
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
  const { surfaces, sansSurface } = regrouperParSurface(valid);
  return {
    outcome: elected ? 'elected' : 'no_quorum',
    winner: elected ? top : null,
    factions,
    quorum,
    surfaces,
    sansSurface,
  };
}

/**
 * Regroupe les bulletins par ENSEMBLE DE FICHIERS TOUCHÉS.
 *
 * Deux règles, et les deux comptent :
 *
 * · **Un bulletin sans fichier n'entre dans aucun groupe.** Les fondre
 *   ensemble fabriquerait une surface « vide » sur laquelle ils sembleraient
 *   d'accord, alors qu'on n'a rien pu lire. Un accord inventé est exactement ce
 *   que ce module ne doit jamais produire. Ils sont comptés à part.
 *
 * · **Les fichiers sont triés et dédoublonnés avant comparaison.** Deux agents
 *   qui touchent les mêmes fichiers dans un ordre différent sont allés au même
 *   endroit ; l'ordre du diff n'est pas une opinion.
 */
function regrouperParSurface(valid: Ballot[]): { surfaces: Surface[]; sansSurface: number } {
  const groups = new Map<string, { fichiers: string[]; nodes: Set<string>; types: Set<string> }>();
  let sansSurface = 0;

  for (const b of valid) {
    const fichiers = [...new Set(b.fichiers ?? [])].sort();
    if (fichiers.length === 0) {
      sansSurface++;
      continue;
    }
    const cle = fichiers.join('\n');
    let group = groups.get(cle);
    if (!group) {
      group = { fichiers, nodes: new Set(), types: new Set() };
      groups.set(cle, group);
    }
    group.nodes.add(b.nodeId);
    group.types.add(b.agentType || 'inconnu');
  }

  const surfaces: Surface[] = [...groups.values()].map((g) => ({
    fichiers: g.fichiers,
    votes: g.nodes.size,
    nodeIds: [...g.nodes].sort(),
    agentTypes: [...g.types].sort(),
    diversity: g.types.size,
  }));

  // Même ordre que les factions — voix, puis diversité, puis un départage
  // stable. Sans le dernier, deux surfaces à égalité changeraient de place d'un
  // appel à l'autre et l'écran clignoterait.
  surfaces.sort(
    (x, y) =>
      y.votes - x.votes ||
      y.diversity - x.diversity ||
      x.fichiers.join('\n').localeCompare(y.fichiers.join('\n')),
  );

  return { surfaces, sansSurface };
}
