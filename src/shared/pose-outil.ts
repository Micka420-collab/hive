// POSER UN OUTIL SUR LA MACHINE D'UN MEMBRE — la décision, pas l'exécution.
//
// ─── CE QUE CE MODULE DÉFEND ─────────────────────────────────────────────────
//
// Le tableau de bord peut désormais LANCER l'installation d'un outil, et plus
// seulement afficher la commande à copier. C'est une décision de l'utilisateur,
// prise en connaissance de la contrepartie : un accès à cet écran suffit à
// déclencher une installation sur la machine d'un membre.
//
// La contrepartie étant assumée, il reste à ne pas l'AGGRAVER. Une seule règle
// y suffit, et c'est celle que le dépôt applique déjà aux chantiers :
//
//     LE HUB PROPOSE UN IDENTIFIANT. LE CATALOGUE DÉCIDE DE CE QU'IL EXÉCUTE.
//
// Le message qui traverse le réseau porte `outilId`, jamais une commande. Un
// hub compromis — ou un navigateur qui bricole sa requête — ne peut donc pas
// faire exécuter autre chose que ce que le catalogue contient déjà. La surface
// n'est pas « une commande arbitraire » ; elle est « les outils du catalogue »,
// et c'est une borne qu'on peut lire.
//
// ─── POURQUOI LE NŒUD REVALIDE ───────────────────────────────────────────────
//
// Le nœud ne fait pas confiance au hub sur parole : il refait la recherche dans
// SON catalogue. Si les deux versions divergent — nœud plus ancien, outil
// retiré depuis — le nœud refuse plutôt que d'exécuter quelque chose qu'il ne
// reconnaît pas. Un refus est réparable ; une exécution surprise ne l'est pas.

import { OUTILS } from './catalogue-outils.js';
import { PAQUETS } from './connexion-agent.js';

/** Pourquoi une pose n'aura pas lieu. */
export type MotifRefusPose =
  /** L'identifiant ne figure pas au catalogue de CETTE machine. */
  | 'outil-inconnu'
  /** L'outil est au catalogue, mais sans commande d'installation sûre. */
  | 'sans-commande'
  /** Le binaire est déjà là : réinstaller ne réglerait rien. */
  | 'deja-pose';

export interface PoseAccordee {
  readonly accordee: true;
  /** La commande, EN ARGUMENTS SÉPARÉS — jamais une chaîne à passer au shell. */
  readonly commande: readonly string[];
}

export interface PoseRefusee {
  readonly accordee: false;
  readonly motif: MotifRefusPose;
}

export type VerdictPose = PoseAccordee | PoseRefusee;

/**
 * La commande d'installation d'un outil, telle que le catalogue la déclare.
 *
 * `null` quand l'identifiant est inconnu OU quand l'outil n'a pas de commande
 * sûre — `PAQUETS` ne contient que les outils dont `installation` n'est pas
 * `null`, ce qui écarte déjà les paquets au nom ambigu (Cline : le paquet
 * existe, mais son nom npm est sans portée, donc un typosquat possible).
 */
export function commandeDePose(outilId: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(PAQUETS, outilId) ? PAQUETS[outilId]! : null;
}

/**
 * Faut-il poser cet outil, et avec quoi ?
 *
 * `dejaPose` vient du constat du nœud — ce qu'il VOIT sur sa machine — et non
 * d'une supposition du hub. Réinstaller par-dessus un binaire présent ne règle
 * rien et peut casser une installation que le membre a faite à sa façon.
 */
export function jugerPose(opts: {
  readonly outilId: string;
  readonly dejaPose: boolean;
}): VerdictPose {
  if (opts.dejaPose) return { accordee: false, motif: 'deja-pose' };
  const commande = commandeDePose(opts.outilId);
  // `outil-inconnu` et `sans-commande` se distinguent pour le message rendu au
  // membre : « je ne connais pas cet outil » et « cet outil n'a pas
  // d'installation automatique » n'appellent pas le même geste.
  if (commande === null) {
    return {
      accordee: false,
      motif: connuDuCatalogue(opts.outilId) ? 'sans-commande' : 'outil-inconnu',
    };
  }
  return { accordee: true, commande };
}

/**
 * L'identifiant existe-t-il au catalogue, indépendamment de son installation ?
 *
 * ─── POURQUOI `OUTILS` ET NON `PAQUETS` ──────────────────────────────────────
 *
 * `PAQUETS` est DÉRIVÉ d'`OUTILS` en ne gardant que ceux dont `installation`
 * n'est pas `null` : 2 entrées sur 9. Interroger `PAQUETS` ici — ce que j'avais
 * écrit d'abord — rendait `sans-commande` strictement inatteignable, puisque la
 * même condition venait déjà d'échouer dans `commandeDePose`. La branche aurait
 * été du décor, et les sept outils qui s'installent à la main (cursor, cline,
 * windsurf, grok, hermes-agent, custom, shell) auraient été annoncés
 * « inconnus » alors que la ruche les affiche à l'écran.
 */
function connuDuCatalogue(outilId: string): boolean {
  return OUTILS.some((o) => o.id === outilId);
}

/** Ce qu'on dit au membre quand la pose n'a pas lieu. */
export function direRefusPose(motif: MotifRefusPose, lang: 'fr' | 'en' = 'fr'): string {
  if (motif === 'deja-pose') {
    return lang === 'en'
      ? 'This tool is already installed on that machine — nothing to do.'
      : 'Cet outil est déjà posé sur cette machine — rien à faire.';
  }
  if (motif === 'sans-commande') {
    return lang === 'en'
      ? 'This tool has no safe automatic install: it must be installed by hand.'
      : "Cet outil n'a pas d'installation automatique sûre : il se pose à la main.";
  }
  return lang === 'en'
    ? 'That machine does not know this tool — its catalogue may be older than the hub’s.'
    : 'Cette machine ne connaît pas cet outil — son catalogue est peut-être plus ancien que celui de la ruche.';
}
