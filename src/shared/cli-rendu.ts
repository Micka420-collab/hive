/**
 * CE QUE LA CLI AFFICHE — décidé ici, imprimé là-bas.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * `src/cli.ts` n'exporte RIEN. Ses commandes sont des fonctions internes qui
 * appellent l'API puis `console.log` : aucun banc ne peut les interroger, et un
 * balayage élargi (base épinglée sur le commit d'origine,
 * `LOUPE_CHEMINS=src/adapters,src/cli.ts`) l'a montré sans détour — deux gardes
 * d'affichage s'inversaient sans qu'une seule assertion bouge :
 *
 *     if (board.nodes.length === 0)   muté en `!==`
 *     if (v.sansSurface > 0)          muté en `>= 0`
 *
 * Le premier est le pire des deux : inversé, un tableau PLEIN affiche « aucune
 * contribution encore » et rend la main. Tout le travail de l'essaim disparaît
 * de l'écran, et rien ne dit qu'il a disparu.
 *
 * « Hors d'atteinte du banc » est presque toujours « au mauvais endroit »
 * (§ 2 quaterdecies). La décision descend donc ici, pure : ces fonctions rendent
 * des LIGNES, elles n'impriment pas. La CLI garde le `console.log`, qui n'a plus
 * aucune décision à porter.
 *
 * ─── LES TYPES SONT STRUCTURELS, ET C'EST VOULU ──────────────────────────────
 *
 * `WaggleBoard` vit dans `src/orchestrator/waggle.ts`, et un module de `shared/`
 * qui importerait l'orchestrateur inverserait la dépendance. On décrit donc la
 * FORME dont on a besoin — le motif d'`inspectionDeProduction` dans
 * `gardiennes.ts`, pour la même raison.
 */

/** Une ligne du classement : ce que la CLI a besoin de savoir d'une ouvrière. */
export interface LigneNectar {
  name: string;
  agentType: string;
  score: number;
  tasksDone: number;
  tasksFailed: number;
  raceWins: number;
  /** Entre 0 et 1. */
  successRate: number;
  avgDurationMs: number;
}

/** Le tableau, réduit à ce que l'affichage consulte. */
export interface TableauNectar {
  nodes: readonly LigneNectar[];
  totalTasksDone: number;
  totalTasksFailed: number;
}

const MEDAILLES = ['🥇', '🥈', '🥉'];

/**
 * Les lignes du Waggle Board.
 *
 * Un tableau VIDE ne rend pas un tableau vide : il rend une phrase qui dit
 * pourquoi il est vide. Un écran nu se lit comme une panne, et la première
 * réaction est de relancer la commande.
 */
export function lignesWaggle(board: TableauNectar): string[] {
  if (board.nodes.length === 0) {
    return ['Aucune contribution encore : la danse frétillante attend le premier nectar.'];
  }
  const lignes = [
    `🍯 Waggle Board — ${board.totalTasksDone} tâche(s) butinée(s), ${board.totalTasksFailed} échec(s)`,
    '',
  ];
  board.nodes.forEach((n, i) => {
    const rang = MEDAILLES[i] ?? `${i + 1}.`;
    const taux = `${Math.round(n.successRate * 100)}%`;
    // Une durée moyenne de 0 n'est pas « instantané », c'est « on ne sait pas
    // encore » — l'afficher comme « 0.0s/tâche » annoncerait une performance
    // que personne n'a mesurée.
    const moyenne = n.avgDurationMs > 0 ? `${(n.avgDurationMs / 1000).toFixed(1)}s/tâche` : '—';
    const courses = n.raceWins > 0 ? ` ⚔${n.raceWins}` : '';
    lignes.push(
      `  ${rang} ${n.name} [${n.agentType}] — ${n.score} nectar ` +
        `(✔${n.tasksDone} ✘${n.tasksFailed}${courses}, ${taux}, ${moyenne})`,
    );
  });
  return lignes;
}

/** Une surface votée : où les agents disent avoir touché. */
export interface SurfaceVotee {
  votes: number;
  agentTypes: readonly string[];
  fichiers: readonly string[];
}

/** Ce que le Parlement sait des surfaces. */
export interface SurfacesDuVerdict {
  surfaces: readonly SurfaceVotee[];
  /** Bulletins dont le diff n'a pas pu être lu. */
  sansSurface: number;
}

/**
 * Le bloc « Où le changement a été fait », ou rien du tout.
 *
 * La surface est le seul accord MESURABLE sur du code : elle ne dit pas que
 * deux agents ont écrit la même chose, mais qu'ils sont allés au même endroit —
 * et deux surfaces distinctes sont un désaccord réel.
 *
 * Rendre `[]` plutôt qu'un titre nu : un en-tête sans contenu laisse croire
 * qu'on a mesuré quelque chose et qu'il n'y avait rien à dire, là où la vérité
 * est qu'on n'a rien pu mesurer.
 */
export function lignesSurfaces(v: SurfacesDuVerdict): string[] {
  if (v.surfaces.length === 0 && v.sansSurface === 0) return [];
  const lignes = ['', '📍 Où le changement a été fait'];
  // DEUX surfaces, pas une : une seule surface votée est un accord, pas un
  // désaccord. C'est à partir de la deuxième que les agents se contredisent.
  if (v.surfaces.length > 1) {
    lignes.push('   ⚠ les agents ne sont pas d’accord sur l’ENDROIT.');
  }
  for (const s of v.surfaces) {
    lignes.push(`   ${s.votes} voix (${s.agentTypes.join(', ')}) — ${s.fichiers.join(', ')}`);
  }
  // « 0 bulletin(s) sans diff lisible » serait une phrase fausse à l'écran :
  // elle annoncerait un rebut là où il n'y en a pas eu.
  if (v.sansSurface > 0) {
    lignes.push(
      `   ${v.sansSurface} bulletin(s) sans diff lisible — écarté(s), pas comptés comme d’accord.`,
    );
  }
  return lignes;
}
