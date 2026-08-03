/**
 * LA PHYSIQUE DU CERVEAU, SORTIE DU CANEVAS.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * Le graphe du Cerveau simule des forces dans un `<canvas>`. Or `getContext`
 * rend `null` sous happy-dom : la boucle entière — plus de cent lignes de
 * décisions — n'y est JAMAIS exécutée, donc jamais éprouvée. Le balayage par
 * mutation l'a dit sans détour : inverser `p.id === attrape.id` (« le doigt
 * gagne ») ne faisait rougir personne. La note qu'on tient à la souris se
 * serait remise à dériver vers le centre pendant qu'on la déplace, et TOUTES
 * les autres se seraient figées — l'inverse exact de ce qu'on demande à un
 * graphe qu'on manipule.
 *
 * On aurait pu déclarer la ligne « hors d'atteinte du banc » et l'écrire au
 * carnet. C'est le repli honnête quand rien d'autre n'est possible ; ce
 * n'était pas le cas ici. La force ne dépend d'aucun contexte de dessin :
 * elle prend des corps, des bornes, un pas de temps, et rend des corps
 * déplacés. Sortie du canevas, elle s'éprouve à la milliseconde près.
 *
 * ─── LA RÈGLE QUE CE MODULE TIENT ────────────────────────────────────────────
 *
 *   LE DOIGT GAGNE. Le corps que l'humain tient ne subit ni rappel au centre,
 *   ni amortissement, ni intégration : sa position est celle de la souris, et
 *   la simulation n'a pas voix au chapitre tant qu'on ne l'a pas lâché.
 */

/** Un corps de la simulation — la part que la physique touche. */
export interface CorpsMobile {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface CadreSimulation {
  /** Largeur de la scène, en points CSS. */
  L: number;
  /** Hauteur de la scène, en points CSS. */
  H: number;
  /** Pas de temps du tour, en millisecondes (16 ≈ une image à 60 Hz). */
  dt: number;
  /** Le corps tenu à la souris, ou `null` si personne ne tient rien. */
  attrapeId: string | null;
}

/** Rappel vers le centre — assez faible pour ne pas écraser les autres forces. */
const RAPPEL = 0.0009;
/** Amortissement par tour : sans lui, le graphe oscille sans jamais se poser. */
const AMORTI = 0.86;

/**
 * Applique le rappel au centre, l'amortissement et l'intégration — SAUF au
 * corps tenu par l'humain, qui est laissé exactement où le doigt l'a mis.
 *
 * Mute les corps sur place (la boucle de rendu travaille sur ses propres
 * objets, et recopier soixante corps par image serait payé pour rien).
 */
export function rappelerAuCentre(corps: readonly CorpsMobile[], cadre: CadreSimulation): void {
  for (const p of corps) {
    if (p.id === cadre.attrapeId) continue; // le doigt gagne
    p.vx += (cadre.L / 2 - p.x) * RAPPEL;
    p.vy += (cadre.H / 2 - p.y) * RAPPEL;
    p.vx *= AMORTI;
    p.vy *= AMORTI;
    p.x += p.vx * (cadre.dt / 16);
    p.y += p.vy * (cadre.dt / 16);
  }
}
