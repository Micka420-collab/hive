// La consigne de l'OPÉRATEUR sur le routage d'une tâche : épingler, ou exclure,
// une famille d'agent ou un modèle.
//
// ─── LE MANQUE QU'ELLE COMBLE ────────────────────────────────────────────────
//
// L'Aiguillage apprend seul quel modèle fait le mieux quel genre de travail, et
// il a raison de ne pas se laisser dicter ses scores. Mais l'humain qui répond
// du projet n'avait AUCUN moyen de dire, pour une tâche précise, « pas ce
// modèle-là » (il le sait cassé sur ce dépôt, il ne veut pas en payer les
// jetons) ni « celui-ci » (reproduire une production, comparer deux familles).
// Il ne lui restait qu'à débrancher des ouvrières — un geste sur toute la
// ruche, pour une tâche.
//
// ─── CE QU'ELLE FAIT, ET CE QU'ELLE NE FAIT JAMAIS ───────────────────────────
//
// Elle RESTREINT l'offre de nœuds d'une tâche, avant toute élection : c'est une
// exclusion dure, que ni les préférences d'une tâche parente (un simple
// départage) ni une course de drones ne franchissent. L'affectation qui en
// résulte est consignée « forcée par l'opérateur » (`task_assigned`).
//
// Elle ne touche JAMAIS aux scores appris : aucune note n'est écrite, aucune
// ligne n'est effacée, et le classement consigné reste celui de l'Aiguillage
// sur les modèles que la consigne laisse en jeu. Un verdict rendu sous
// consigne est le vrai verdict de ce modèle sur ce genre de travail : il nourrit
// l'apprentissage comme les autres, ni plus ni moins.
//
// Si plus aucun nœud en ligne ne la satisfait, la tâche ATTEND — et le dit
// (`task_consigne_deferred`), plutôt que de partir ailleurs en douce.

import { LIMITS } from './protocol.js';

/** Au plus autant de noms exclus par liste : une consigne se lit d'un coup d'œil. */
export const MAX_NOMS_CONSIGNE = 8;

export interface ConsigneRoutage {
  /** Famille d'agent imposée (`agentType` d'un nœud) : seuls ses nœuds portent la tâche. */
  agent?: string;
  /**
   * Modèle imposé : seuls les nœuds qui DÉCLARENT le lancer portent la tâche, et
   * c'est lui qui leur est commandé. Un nœud qui ne déclare aucun modèle n'est
   * pas retenu : rien ne prouve qu'il lancerait celui-là.
   */
  modele?: string;
  /** Familles d'agent exclues. */
  sansAgents?: string[];
  /**
   * Modèles exclus. Un nœud qui ne déclare AUCUN modèle reste porteur : son
   * modèle par défaut est inconnu, pas exclu.
   */
  sansModeles?: string[];
}

export type LectureConsigne =
  { ok: true; consigne: ConsigneRoutage } | { ok: false; motif: string };

/** Un nom de famille d'agent : court, sans espace ni caractère de contrôle. */
const MOTIF_AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function nomValide(v: unknown, genre: 'agent' | 'modele'): v is string {
  if (typeof v !== 'string') return false;
  const nom = v.trim();
  if (nom.length === 0 || nom !== v || v.length > LIMITS.name) return false;
  // eslint-disable-next-line no-control-regex -- un nom affiché ne porte aucun caractère de contrôle
  return genre === 'agent' ? MOTIF_AGENT.test(v) : !/[\u0000-\u001f\u007f]/.test(v);
}

function lireListe(
  brut: unknown,
  genre: 'agent' | 'modele',
  champ: string,
): string[] | { motif: string } | undefined {
  if (brut === undefined) return undefined;
  if (!Array.isArray(brut) || brut.length === 0 || brut.length > MAX_NOMS_CONSIGNE) {
    return { motif: `${champ} : liste de 1 à ${MAX_NOMS_CONSIGNE} noms attendue` };
  }
  if (!brut.every((v) => nomValide(v, genre))) {
    return {
      motif: `${champ} : chaque nom fait 1 à ${LIMITS.name} caractères, sans espace autour`,
    };
  }
  // Canonique : triée, dédoublonnée — deux consignes équivalentes s'écrivent
  // pareil au journal, et l'affichage n'a rien à normaliser.
  return [...new Set(brut as string[])].sort((a, b) => a.localeCompare(b));
}

/**
 * Relit une consigne venue du réseau (ou de la base). Refuse en ENTIER ce qui
 * est mal formé ou contradictoire, et dit pourquoi — jamais une consigne
 * rafistolée qui routerait autrement que ce que l'opérateur a écrit.
 */
export function lireConsigneRoutage(brut: unknown): LectureConsigne {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
    return { ok: false, motif: 'consigne : objet attendu' };
  }
  const o = brut as Record<string, unknown>;
  const inconnus = Object.keys(o).filter(
    (k) => !['agent', 'modele', 'sansAgents', 'sansModeles'].includes(k),
  );
  if (inconnus.length > 0) return { ok: false, motif: `champ inconnu : ${inconnus.join(', ')}` };
  if (o.agent !== undefined && !nomValide(o.agent, 'agent')) {
    return { ok: false, motif: 'agent : nom de famille invalide' };
  }
  if (o.modele !== undefined && !nomValide(o.modele, 'modele')) {
    return { ok: false, motif: `modele : 1 à ${LIMITS.name} caractères, sans espace autour` };
  }
  const sansAgents = lireListe(o.sansAgents, 'agent', 'sansAgents');
  if (sansAgents && !Array.isArray(sansAgents)) return { ok: false, motif: sansAgents.motif };
  const sansModeles = lireListe(o.sansModeles, 'modele', 'sansModeles');
  if (sansModeles && !Array.isArray(sansModeles)) return { ok: false, motif: sansModeles.motif };
  const consigne: ConsigneRoutage = {
    ...(o.agent !== undefined ? { agent: o.agent as string } : {}),
    ...(o.modele !== undefined ? { modele: o.modele as string } : {}),
    ...(sansAgents ? { sansAgents } : {}),
    ...(sansModeles ? { sansModeles } : {}),
  };
  if (Object.keys(consigne).length === 0) {
    return { ok: false, motif: 'consigne vide : pour la lever, envoyer `null`' };
  }
  if (consigne.agent && consigne.sansAgents?.includes(consigne.agent)) {
    return { ok: false, motif: `l’agent ${consigne.agent} est à la fois imposé et exclu` };
  }
  if (consigne.modele && consigne.sansModeles?.includes(consigne.modele)) {
    return { ok: false, motif: `le modèle ${consigne.modele} est à la fois imposé et exclu` };
  }
  return { ok: true, consigne };
}

/** Ce que la consigne de l'opérateur lit d'un nœud : sa famille et ses modèles déclarés. */
type NoeudConsigne = {
  readonly agentType: string;
  readonly modeles?: readonly string[] | null;
};

/**
 * L'offre d'une tâche SOUS la consigne de l'opérateur : les nœuds qui la
 * respectent, chacun réduit aux modèles qu'elle laisse en jeu. L'ordonnanceur
 * la route ainsi, et le tiroir d'une tâche s'en sert pour dire si une ouvrière
 * en ligne la satisfait — une seule règle, lue des deux côtés.
 *
 * Appliquée AVANT tout le reste — capacité, écarts de reprise, élection,
 * préférences — parce que c'est une exclusion DURE : rien ne doit pouvoir la
 * contourner, ni le départage d'une tâche parente, ni la reprise d'une tâche
 * dont les autres porteurs ont planté. Pure : les vues sont des copies, les
 * nœuds du store ne sont pas touchés.
 *
 *   · agent imposé / familles exclues : jugé sur `agentType` ;
 *   · modèle imposé : seuls les nœuds qui le DÉCLARENT, réduits à lui — un
 *     nœud sans modèle déclaré ne prouve pas qu'il le lancerait ;
 *   · modèles exclus : retirés de chaque vue ; un nœud qui n'offrait QUE des
 *     modèles exclus n'en porte plus (gardé sans modèle, il lancerait son
 *     défaut — peut-être celui-là), un nœud sans modèle déclaré reste porteur
 *     (son défaut est inconnu, pas exclu), comme dans `porteursHorsEchecs`
 *     (orchestrator/aiguillage.ts).
 */
export function offreSousConsigne<N extends NoeudConsigne>(
  offre: readonly N[],
  consigne: ConsigneRoutage | null,
): N[] {
  if (!consigne) return [...offre];
  const vues: N[] = [];
  for (const n of offre) {
    if (consigne.agent !== undefined && n.agentType !== consigne.agent) continue;
    if (consigne.sansAgents?.includes(n.agentType)) continue;
    const declares = n.modeles ?? [];
    if (consigne.modele !== undefined) {
      if (declares.includes(consigne.modele)) vues.push({ ...n, modeles: [consigne.modele] });
      continue;
    }
    const exclus = consigne.sansModeles ?? [];
    const restants = declares.filter((m) => !exclus.includes(m));
    if (declares.length === 0) vues.push(n);
    else if (restants.length > 0) {
      vues.push(restants.length === declares.length ? n : { ...n, modeles: restants });
    }
  }
  return vues;
}
