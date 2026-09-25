// Où est passé le temps d'une tâche — relu dans le journal, phase par phase.
//
// La durée d'exécution d'un Worker existait (`durationMs` de chaque résultat),
// mais une durée seule ne dit pas OÙ le temps est passé : attendre ses
// dépendances, attendre un Worker libre, démarrer, exécuter, être repris,
// être relu. Ce module replie les événements déjà consignés par la Reine en
// phases distinctes, SANS rien estimer :
//
//   · une phase dont un bord manque est `null`, pas zéro ;
//   · la durée côté modèle (latence du fournisseur) et le coût fournisseur ne
//     sont rapportés par aucun agent aujourd'hui : ils sont `inconnu`, dit tel
//     quel — jamais déduits de la durée du Worker, qui mesure le processus
//     local et non le modèle distant.

import type { HiveEvent } from './types.js';

export type IssueTentative = 'reussie' | 'reprise' | 'echec';

export interface TentativeVue {
  issue: IssueTentative;
  /** Durée mesurée par le Worker autour de l'agent ; `null` si non rapportée. */
  dureeWorkerMs: number | null;
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
  /** Aucun agent ne rapporte la latence du modèle distant. */
  dureeModele: 'inconnu';
  /** Aucun fournisseur ne rapporte un coût : jamais estimé depuis le temps. */
  coutFournisseur: 'inconnu';
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
  'contre_expertise',
  'contre_expertise_verdict',
] as const;

const nombre = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

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
        tentatives.push({ issue: 'reussie', dureeWorkerMs: nombre(e.payload.durationMs) });
        terminaleA = e.ts;
        break;
      case 'task_retry':
        if (e.payload.source === 'evaluator') {
          // Renvoi en correction après contre-revue : la tentative précédente
          // est déjà comptée (task_done) ; aucune durée Worker ici.
          corrections += 1;
        } else {
          tentatives.push({ issue: 'reprise', dureeWorkerMs: nombre(e.payload.durationMs) });
          reprises += 1;
        }
        break;
      case 'task_failed':
        // Un refus d'infrastructure (aucun agent qui fonctionne) n'a pas de
        // durée : la tentative compte, sa durée reste inconnue.
        tentatives.push({ issue: 'echec', dureeWorkerMs: nombre(e.payload.durationMs) });
        terminaleA = e.ts;
        break;
      case 'task_cancelled':
        terminaleA = e.ts;
        break;
      case 'task_requeued':
        reprises += 1;
        break;
      case 'contre_expertise':
        // Seule une contre-expertise réellement lancée ouvre une fenêtre de revue.
        if (e.payload.possible !== false) {
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
    dureeModele: 'inconnu',
    coutFournisseur: 'inconnu',
  };
}
