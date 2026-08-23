// « Présence sans production » — une machine peut REJOINDRE la ruche sans
// pouvoir y travailler.
//
// ─── LE DÉFAUT QUE CE MODULE FERME ───────────────────────────────────────────
//
// Jusqu'ici, un poste sans agent de codage réel mourait avant de se connecter :
// `main.ts` imprimait un conseil et faisait `process.exit(2)`. Trois
// conséquences, toutes mauvaises :
//
//   · le conseil s'affichait dans un terminal qu'on referme ;
//   · le tableau de bord ne montrait RIEN — pas « machine sans outil », rien du
//     tout, ce qui se lit « personne n'a essayé » ;
//   · et la fiche des outils IA, qui sait dire exactement ce qui manque, ne
//     pouvait rien dire d'une machine qui ne s'inscrivait jamais.
//
// C'est le premier lancement de quelqu'un qui débute, et c'est le moment où la
// ruche est la plus muette.
//
// ─── CE QUE « PRÉSENCE » N'EST PAS ───────────────────────────────────────────
//
// Ce n'est PAS un nœud dégradé qui travaillerait moins bien. C'est un nœud qui
// ne travaille PAS DU TOUT : il se montre, il dit ce qui lui manque, et il
// refuse toute tâche. Un nœud présent qui produirait des diffs simulés en les
// présentant comme réels serait très au-dessous du silence d'avant.
//
// D'où DEUX gardes, une de chaque côté, et c'est délibéré :
//   · le hub n'assigne pas (`assignationProductionAutorisee`, déjà en place sur
//     la voie d'assignation — ce lot l'ajoute sur la voie des COURSES, qui ne
//     l'avait pas et que la présence rend atteignable) ;
//   · le nœud refuse s'il est tout de même sollicité (`refuseParPresence`).
//
// Une seule garde suffirait tant que l'autre côté est correct. C'est
// précisément pourquoi il en faut deux.

/** Ce que le nœud fait de lui-même une fois le diagnostic rendu. */
export type ModeNoeud = 'production' | 'presence';

export interface EntreeEnRuche {
  readonly mode: ModeNoeud;
  /**
   * Pourquoi ce mode, en une phrase destinée à l'humain. Jamais `null` : un
   * nœud qui rejoint en présence doit DIRE pourquoi, sinon il ressemble à un
   * nœud cassé.
   */
  readonly motif: string | null;
}

export interface ConditionsEntree {
  /** Un agent de codage RÉEL est-il utilisable sur ce poste ? */
  readonly agentReel: boolean;
  /**
   * L'opérateur a-t-il explicitement demandé la simulation
   * (`HIVE_SIMULATION=1` ou `HIVE_AGENT=shell`) ? Alors les diffs simulés sont
   * VOULUS, et le nœud produit — c'est une démonstration, pas un aveuglement.
   */
  readonly simulationVoulue: boolean;
}

/**
 * Le mode d'entrée. Pur : ni environnement, ni disque, ni réseau.
 *
 * L'ordre des deux questions compte. La simulation VOULUE l'emporte sur
 * l'absence d'agent réel : quelqu'un qui pose `HIVE_SIMULATION=1` sait ce
 * qu'il fait et attend une ruche qui bouge. L'inverse — refuser de produire à
 * qui a demandé une démo — casserait la démo.
 */
export function entreeEnRuche(c: ConditionsEntree, lang: 'fr' | 'en' = 'fr'): EntreeEnRuche {
  if (c.simulationVoulue || c.agentReel) return { mode: 'production', motif: null };
  return {
    mode: 'presence',
    motif:
      lang === 'en'
        ? 'This machine has joined the hive but will not take any task: no real coding agent was found on it.'
        : 'Cette machine a rejoint la ruche mais ne prendra aucune tâche : aucun agent de codage réel n’a été trouvé dessus.',
  };
}

/**
 * Le nœud doit-il refuser une tâche qu'on lui pousse malgré tout ?
 *
 * La seconde garde. Elle ne fait pas confiance au hub — non par méfiance, mais
 * parce qu'un hub d'une version plus ancienne, ou une voie d'assignation qu'on
 * aura oublié de filtrer, ne connaîtra pas cette règle. Le nœud, lui, la
 * connaît toujours : c'est lui qui a constaté sa propre machine.
 */
export function refuseParPresence(mode: ModeNoeud): boolean {
  return mode === 'presence';
}

/** Le motif de refus renvoyé au hub, pour qu'il apparaisse dans la chronique. */
export function motifRefusPresence(lang: 'fr' | 'en' = 'fr'): string {
  return lang === 'en'
    ? 'presence only: no real coding agent on this machine'
    : 'présence seule : aucun agent de codage réel sur cette machine';
}
