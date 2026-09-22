import {
  CATEGORIES,
  categoriser,
  classer,
  replierAntecedents,
  type Categorie,
  type Observation,
} from './aiguillage.js';
import type { HiveNode } from '../shared/types.js';

/**
 * Preuve disponible pour un modèle déclaré par une ouvrière.
 *
 * `score` est le score UCB de l'Aiguillage quand le modèle a déjà un vécu.
 * Un modèle inconnu reste explicitement à explorer : `null` n'est jamais
 * transformé en zéro, car « inconnu » et « mauvais » ne sont pas le même fait.
 */
export interface ModeleWorkerSnapshot {
  modele: string;
  categories: Record<
    Categorie,
    {
      essais: number;
      moyenne: number | null;
      score: number | null;
      exploration: boolean;
    }
  >;
}

/** Projection observable d'un nœud réel, sans seconde source de vérité. */
export interface WorkerSnapshot {
  id: string;
  name: string;
  ownerName: string;
  agentType: string;
  status: HiveNode['status'];
  running: number;
  maxConcurrency: number;
  slotsLibres: number;
  plateforme?: HiveNode['plateforme'];
  outils?: HiveNode['outils'];
  modeles?: ModeleWorkerSnapshot[];
}

type LigneObservation = Pick<Observation, 'modele' | 'suite'> & {
  title: string;
  prompt: string;
};

const scoreDe = (rang: ReturnType<typeof classer>[number]) => ({
  essais: rang.essais,
  moyenne: rang.essais > 0 ? rang.moyenne : null,
  score: rang.essais > 0 && Number.isFinite(rang.score) ? rang.score : null,
  exploration: rang.essais === 0,
});

/**
 * Construit la projection Workers à partir des nœuds et du vécu de l'Aiguillage.
 *
 * La fonction est pure : elle ne choisit pas un nœud, ne modifie pas le store
 * et ne prétend pas mesurer une compétence absente des résultats observés.
 */
export function projeterWorkers(
  nodes: readonly HiveNode[],
  lignes: readonly LigneObservation[],
): WorkerSnapshot[] {
  const antecedents = replierAntecedents(
    lignes.map((ligne) => ({
      categorie: categoriser(ligne.title, ligne.prompt),
      modele: ligne.modele,
      suite: ligne.suite,
    })),
  );

  return nodes.map((node) => {
    const modeles = node.modeles?.slice().sort((a, b) => a.localeCompare(b));
    const projection: WorkerSnapshot = {
      id: node.id,
      name: node.name,
      ownerName: node.ownerName,
      agentType: node.agentType,
      status: node.status,
      running: node.running,
      maxConcurrency: node.maxConcurrency,
      slotsLibres: Math.max(0, node.maxConcurrency - node.running),
      ...(node.plateforme !== undefined ? { plateforme: node.plateforme } : {}),
      ...(node.outils !== undefined ? { outils: node.outils } : {}),
    };

    if (modeles && modeles.length > 0) {
      projection.modeles = modeles.map((modele) => ({
        modele,
        categories: Object.fromEntries(
          CATEGORIES.map((categorie) => {
            const rang = classer(categorie, [modele], antecedents)[0]!;
            return [categorie, scoreDe(rang)];
          }),
        ) as ModeleWorkerSnapshot['categories'],
      }));
    }

    return projection;
  });
}
