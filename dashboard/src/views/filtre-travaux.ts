// LE FILTRE DES TRAVAUX — une seule règle pour trier projets, tâches et chantiers.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// Les Projets, la file de revue de la Miellerie et les Chantiers montraient
// TOUT, dans l'ordre du serveur. À trois projets, ça se lit ; à trente tâches
// par projet, on cherchait « la tâche qui touchait l'authentification » en
// survolant des alvéoles une à une. Rien ne permettait de dire « les échecs de
// Codex sur l'ouvrière de Maya ».
//
// ─── POURQUOI UNE RÈGLE PURE, ET UNE SEULE ───────────────────────────────────
//
// Trois écrans, trois filtres écrits à la main, et trois façons de répondre à
// « “integration” trouve-t-il “Intégration” ? ». Ici, la réponse est écrite une
// fois (casse ET accents ignorés), éprouvée par la suite racine
// (`tests/filtre-travaux.test.ts`), et les écrans ne font que l'appeler. Le
// module est en `.ts` sans DOM pour la même raison que `sondage.ts` : hors
// d'atteinte du banc, une règle n'est éprouvée nulle part.
//
// ─── L'INCONNU RESTE INCONNU ─────────────────────────────────────────────────
//
// La famille d'agent d'une tâche, c'est celle de l'ouvrière qui la porte (ou
// qui l'a rendue). Une tâche qui n'a JAMAIS été assignée n'a pas de famille :
// sous un filtre « Codex », elle n'apparaît pas — la montrer affirmerait que
// Codex l'a faite ; la classer ailleurs affirmerait qu'il ne l'a pas faite.

import type { HiveNode, Project, Task, TaskStatus } from '../../../src/shared/types.js';

/** Ce que l'opérateur a demandé. `null` : la dimension n'est pas filtrée. */
export interface FiltreTravaux {
  statut: string | null;
  /** Un `agentType` (`codex`, `claude-code`…). */
  famille: string | null;
  /** L'identifiant d'une ouvrière (nœud). */
  ouvriere: string | null;
  /** Recherche libre ; vide = pas de recherche. */
  texte: string;
}

export const FILTRE_VIDE: FiltreTravaux = {
  statut: null,
  famille: null,
  ouvriere: null,
  texte: '',
};

/** Au moins une dimension est posée — l'écran le dit et offre « Effacer ». */
export function filtreActif(f: FiltreTravaux): boolean {
  return f.statut !== null || f.famille !== null || f.ouvriere !== null || f.texte.trim() !== '';
}

/**
 * Minuscules, sans accents : « Intégration » et « integration » se trouvent.
 * `NFD` sépare la lettre de son accent, que la classe `\p{M}` retire ensuite.
 */
export function pourRecherche(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/**
 * Chaque mot de la recherche doit se trouver dans l'un des textes — l'ordre
 * des mots ne compte pas : « auth échec » trouve « Échec de l'auth ».
 */
export function texteCorrespond(textes: readonly (string | null | undefined)[], texte: string) {
  const mots = pourRecherche(texte).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return true;
  const botte = textes
    .filter((x): x is string => typeof x === 'string')
    .map(pourRecherche)
    .join('\n');
  return mots.every((m) => botte.includes(m));
}

/** L'ouvrière qui porte la tâche, ou qui l'a rendue ; `null` si aucune. */
export function ouvriereDeTache(task: Task): string | null {
  return task.assignedNodeId ?? task.result?.nodeId ?? null;
}

/** La famille d'agent de la tâche, ou `null` — voir « L'INCONNU RESTE INCONNU ». */
export function familleDeTache(task: Task, noeuds: ReadonlyMap<string, HiveNode>): string | null {
  const id = ouvriereDeTache(task);
  return id === null ? null : (noeuds.get(id)?.agentType ?? null);
}

/**
 * La tâche passe-t-elle le filtre ? `avecTexte: false` ignore la recherche
 * libre — quand elle a déjà trouvé le PROJET, toutes ses tâches restent.
 */
export function tacheCorrespond(
  task: Task,
  f: FiltreTravaux,
  noeuds: ReadonlyMap<string, HiveNode>,
  avecTexte = true,
): boolean {
  if (f.statut !== null && task.status !== (f.statut as TaskStatus)) return false;
  if (f.ouvriere !== null && ouvriereDeTache(task) !== f.ouvriere) return false;
  if (f.famille !== null && familleDeTache(task, noeuds) !== f.famille) return false;
  return !avecTexte || texteCorrespond([task.title, task.prompt, task.branch], f.texte);
}

/** Un projet à l'écran, avec les seules tâches que le filtre laisse. */
export interface ProjetFiltre {
  projet: Project;
  taches: Task[];
}

/**
 * Les projets que le filtre laisse, et leurs tâches.
 *
 * La recherche libre vise le projet ET ses tâches : si elle trouve le nom ou
 * la description du projet, il reste avec toutes les tâches que les AUTRES
 * dimensions laissent ; sinon il ne reste que s'il lui reste une tâche. Sans
 * filtre, rien ne bouge — un projet sans tâche garde sa carte.
 */
export function filtrerProjets(
  projets: readonly Project[],
  tachesParProjet: ReadonlyMap<string, Task[]>,
  f: FiltreTravaux,
  noeuds: ReadonlyMap<string, HiveNode>,
): ProjetFiltre[] {
  const actif = filtreActif(f);
  const dimensions = f.statut !== null || f.famille !== null || f.ouvriere !== null;
  const avecTexte = f.texte.trim() !== '';
  const sortie: ProjetFiltre[] = [];
  for (const projet of projets) {
    const toutes = tachesParProjet.get(projet.id) ?? [];
    if (!actif) {
      sortie.push({ projet, taches: toutes });
      continue;
    }
    const projetTrouve = avecTexte && texteCorrespond([projet.name, projet.description], f.texte);
    const taches = toutes.filter((t) => tacheCorrespond(t, f, noeuds, !projetTrouve));
    if (taches.length > 0 || (projetTrouve && !dimensions)) sortie.push({ projet, taches });
  }
  return sortie;
}
