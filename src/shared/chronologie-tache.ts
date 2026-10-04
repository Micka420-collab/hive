// Où est passé le temps d'une tâche — relu dans le journal, phase par phase.
//
// La durée d'exécution d'un Worker existait (`durationMs` de chaque résultat),
// mais une durée seule ne dit pas OÙ le temps est passé : attendre ses
// dépendances, attendre un Worker libre, démarrer, exécuter, être repris,
// être relu. Ce module replie les événements déjà consignés par la Reine en
// phases distinctes, SANS rien estimer :
//
//   · une phase dont un bord manque est `null`, pas zéro ;
//   · la durée côté modèle, le coût fournisseur et les jetons viennent de ce
//     que le CLI de l'agent DÉCLARE (Claude Code : `duration_api_ms`,
//     `total_cost_usd`, `usage` ; Codex : les jetons de `turn.completed`, et
//     rien d'autre), avec leur couverture (tentatives déclarées / tentatives
//     rendues). Sans aucune déclaration ils sont `inconnu`, dit tel quel —
//     jamais déduits de la durée du Worker, qui mesure le processus local et
//     non le modèle distant, ni le coût des jetons.

import { arreteeParSonBudget } from './arret-budgetaire.js';
import { enlisementDepuis, epuisementDepuis } from './enlisement.js';
import type { Enlisement, EpuisementFournisseur } from './enlisement.js';
import { declarationDe, sommeDeclaree } from './declaration-fournisseur.js';
import type { SommeDeclaree } from './declaration-fournisseur.js';
import type { HiveEvent } from './types.js';

export type { SommeDeclaree } from './declaration-fournisseur.js';

/**
 * `arret` : arrêtée dans la boucle de l'agent, sur son plafond de coût — pas un
 * échec. `epuisement` : arrêtée sur son fournisseur épuisé (G13) et réaffectée
 * sans brûler de tentative — pas un échec non plus.
 */
export type IssueTentative = 'reussie' | 'reprise' | 'echec' | 'arret' | 'epuisement';

export interface TentativeVue {
  issue: IssueTentative;
  /** Durée mesurée par le Worker autour de l'agent ; `null` si non rapportée. */
  dureeWorkerMs: number | null;
  /** Temps passé dans les appels au modèle, déclaré par le CLI ; `null` sinon. */
  dureeModeleMs: number | null;
  /** Coût déclaré par le CLI de l'agent (USD) ; `null` sinon. */
  coutUsd: number | null;
  /** Jetons d'entrée déclarés par le CLI (cache compris) ; `null` sinon. */
  jetonsEntree: number | null;
  /** Jetons de sortie déclarés par le CLI (raisonnement compris) ; `null` sinon. */
  jetonsSortie: number | null;
  /** L'agent tournait en rond, et la vigie de son nœud l'a arrêté (G13). */
  enlisement?: Enlisement;
  /** Le fournisseur était épuisé (issue `epuisement`). */
  epuisement?: EpuisementFournisseur;
}

export interface ChronologieTache {
  /** Création → prête (dépendances satisfaites). `null` sans dépendances attendues. */
  attenteDependancesMs: number | null;
  /** Prête (ou création) → première affectation. `null` si jamais affectée. */
  attenteWorkerMs: number | null;
  /** Première affectation → premier démarrage réel sur le Worker. */
  demarrageMs: number | null;
  tentatives: TentativeVue[];
  /** Somme des durées Worker connues ; `null` si aucune n'est connue. */
  dureeWorkerTotaleMs: number | null;
  /** Reprises (nouvel essai après échec du Worker) et remises en file (nœud perdu, reprise au boot). */
  reprises: number;
  /**
   * Renvois de l'Evaluator : une production RÉUSSIE, jugée insuffisante par la
   * contre-revue, repart en correction. Ce n'est pas un échec du Worker.
   */
  corrections: number;
  /**
   * Temps passé en revue croisée : somme des fenêtres « lancement de la
   * contre-expertise → dernier verdict », une par production relue. `null`
   * sans aucune revue tranchée.
   */
  revueMs: number | null;
  /** Création → issue terminale. `null` tant que la tâche n'est pas terminée. */
  totalMs: number | null;
  terminee: boolean;
  /** Temps modèle déclaré par le CLI, sommé sur les tentatives qui le déclarent. */
  dureeModele: SommeDeclaree | 'inconnu';
  /** Coût déclaré par le CLI (USD), sommé de même — jamais estimé, ni du temps ni des jetons. */
  coutFournisseur: SommeDeclaree | 'inconnu';
  /** Jetons d'entrée déclarés par le CLI, sommés sur les tentatives qui les déclarent. */
  jetonsEntree: SommeDeclaree | 'inconnu';
  /** Jetons de sortie déclarés par le CLI, sommés de même. */
  jetonsSortie: SommeDeclaree | 'inconnu';
}

/** Les types d'événements que la chronologie lit — et rien d'autre. */
export const TYPES_CHRONOLOGIE = [
  'task_ready',
  'task_assigned',
  'task_started',
  'task_done',
  'task_retry',
  'task_failed',
  'task_cancelled',
  'task_requeued',
  // Seul celui d'un fournisseur épuisé est une tentative qui a tourné.
  'task_rejected',
  'contre_expertise',
  'contre_expertise_verdict',
] as const;

const nombre = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

const tentative = (issue: IssueTentative, payload: Record<string, unknown>): TentativeVue => {
  const declaration = declarationDe(payload);
  const enlisement = enlisementDepuis(payload.enlisement);
  const epuisement = epuisementDepuis(payload.epuisement);
  return {
    issue,
    dureeWorkerMs: nombre(payload.durationMs),
    dureeModeleMs: declaration.dureeApiMs,
    coutUsd: declaration.coutUsd,
    jetonsEntree: declaration.jetonsEntree,
    jetonsSortie: declaration.jetonsSortie,
    ...(enlisement ? { enlisement } : {}),
    ...(epuisement ? { epuisement } : {}),
  };
};

const ecart = (debut: number | null, fin: number | null): number | null =>
  debut !== null && fin !== null && fin >= debut ? fin - debut : null;

export function chronologieDepuisEvenements(
  creeeA: number,
  evenements: readonly HiveEvent[],
): ChronologieTache {
  const tries = [...evenements].sort((a, b) => a.id - b.id);
  const premier = (type: string): number | null => tries.find((e) => e.type === type)?.ts ?? null;

  const prete = premier('task_ready');
  const affectee = premier('task_assigned');
  const demarree = premier('task_started');

  const tentatives: TentativeVue[] = [];
  let reprises = 0;
  let corrections = 0;
  let terminaleA: number | null = null;
  let revueTotale = 0;
  let revueConnue = false;
  let lancement: number | null = null;
  let dernierVerdict: number | null = null;
  const fermerFenetre = (): void => {
    const d = ecart(lancement, dernierVerdict);
    if (d !== null) {
      revueTotale += d;
      revueConnue = true;
    }
    lancement = null;
    dernierVerdict = null;
  };

  for (const e of tries) {
    switch (e.type) {
      case 'task_done':
        tentatives.push(tentative('reussie', e.payload));
        terminaleA = e.ts;
        break;
      case 'task_retry':
        if (e.payload.source === 'evaluator') {
          // Renvoi en correction après contre-revue : la tentative précédente
          // est déjà comptée (task_done) ; aucune durée Worker ici.
          corrections += 1;
        } else {
          tentatives.push(tentative('reprise', e.payload));
          reprises += 1;
        }
        break;
      case 'task_failed':
        // Un refus d'infrastructure (aucun agent qui fonctionne) n'a pas de
        // durée : la tentative compte, sa durée reste inconnue. Un arrêt sur
        // plafond n'est pas un échec ; clos par la Reine avant tout envoi
        // (aucun nœud nommé : sa réservation était dépensée), aucune tentative
        // n'a tourné, rien à compter.
        if (!arreteeParSonBudget(e.payload)) tentatives.push(tentative('echec', e.payload));
        else if (typeof e.payload.nodeId === 'string') {
          tentatives.push(tentative('arret', e.payload));
        }
        terminaleA = e.ts;
        break;
      case 'task_cancelled':
        terminaleA = e.ts;
        break;
      case 'task_rejected':
        // Les autres refus n'ont rien fait tourner : pas une tentative.
        if (epuisementDepuis(e.payload.epuisement))
          tentatives.push(tentative('epuisement', e.payload));
        break;
      case 'task_requeued':
        reprises += 1;
        break;
      case 'contre_expertise':
        // Seule une contre-expertise réellement lancée ouvre une fenêtre de revue.
        // Une relecture de SECOURS prolonge la fenêtre ouverte : le temps
        // perdu par la relecture tombée est du temps de revue, pas un trou.
        if (e.payload.secours === true) {
          lancement ??= e.ts;
        } else if (e.payload.possible !== false) {
          fermerFenetre();
          lancement = e.ts;
        }
        break;
      case 'contre_expertise_verdict':
        if (lancement !== null) dernierVerdict = e.ts;
        break;
      default:
        break;
    }
  }

  fermerFenetre();

  const connues = tentatives.map((t) => t.dureeWorkerMs).filter((d): d is number => d !== null);

  return {
    attenteDependancesMs: ecart(creeeA, prete),
    attenteWorkerMs: ecart(prete ?? creeeA, affectee),
    demarrageMs: ecart(affectee, demarree),
    tentatives,
    dureeWorkerTotaleMs: connues.length > 0 ? connues.reduce((s, d) => s + d, 0) : null,
    reprises,
    corrections,
    revueMs: revueConnue ? revueTotale : null,
    totalMs: ecart(creeeA, terminaleA),
    terminee: terminaleA !== null,
    dureeModele: sommeDeclaree(tentatives.map((x) => x.dureeModeleMs)),
    coutFournisseur: sommeDeclaree(tentatives.map((x) => x.coutUsd)),
    jetonsEntree: sommeDeclaree(tentatives.map((x) => x.jetonsEntree)),
    jetonsSortie: sommeDeclaree(tentatives.map((x) => x.jetonsSortie)),
  };
}
