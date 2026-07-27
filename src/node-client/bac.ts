// Le bac à sable au démarrage d'un nœud — décision, annonce, refus.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Il a été extrait de `main.ts` parce que `join.ts` ne faisait RIEN de tout
// cela. Les deux fichiers démarrent un nœud ; un seul décidait de l'isolement.
// Concrètement, un nœud lancé par `npm run join` tournait TOUJOURS en sandbox
// de processus, jamais en conteneur — et `HIVE_ISOLEMENT=exige`, le réglage
// qu'on pose précisément quand on prête sa machine à des inconnus, y était
// sans le moindre effet.
//
// C'est le pire endroit possible pour ce trou : `join` est le chemin des AMIS,
// c'est-à-dire des machines de gens qui n'ont pas lu `.env.example` et qui
// font confiance à celui qui leur a envoyé le billet.
//
// Le duplicata était le vrai problème : deux chemins de démarrage, deux codes,
// et donc une dérive garantie. Il n'y en a plus qu'un.
//
// ─── LA RÈGLE, ET ELLE NE SE DISCUTE PAS ─────────────────────────────────────
//
// « Passe quand même » est TOUJOURS affiché, même au meilleur niveau
// d'isolement. Une interface qui dirait « isolé ✓ » sans dire ce qui traverse
// encore ferait prendre un risque à quelqu'un qui croit ne pas en prendre —
// et le réseau traverse toujours, parce qu'un agent de codage doit joindre
// l'API de son modèle.

import {
  constat,
  decider,
  modeDepuisEnv,
  trouverFournisseur,
  type Fournisseur,
} from './isolement.js';

/** Ce que `decider` rend — nommé ici, faute de l'être à la source. */
export type Decision = ReturnType<typeof decider>;

/** Ce qu'il faut savoir du bac à sable pour démarrer — et quoi en dire. */
export interface Bac {
  decision: Decision;
  fournisseur: Fournisseur | null;
  /** Les lignes à afficher, déjà composées. */
  lignes: string[];
  /** Le nœud doit-il renoncer à démarrer ? */
  refuse: boolean;
}

/**
 * Compose l'annonce du bac à sable. **Pur** : c'est ce qui la rend testable
 * sans sonder la machine.
 */
export function annonce(decision: Decision, fournisseur: Fournisseur | null): string[] {
  const etat = constat(decision.niveau, fournisseur);
  const lignes = [`\n🛡  Isolement : ${decision.motif}`];
  if (etat.protege.length > 0) {
    lignes.push('   Protégé :');
    for (const l of etat.protege) lignes.push(`     ✔ ${l}`);
  }
  lignes.push('   Passe quand même :');
  for (const l of etat.laissePasser) lignes.push(`     • ${l}`);
  lignes.push('');
  return lignes;
}

/**
 * Décide l'isolement UNE FOIS, au démarrage.
 *
 * Sonder un moteur de conteneurs coûte un `spawn` ; le faire par tâche
 * coûterait un `spawn` de plus par butinage, pour une réponse qui ne change
 * pas d'une tâche à l'autre.
 */
export async function preparerBac(env: NodeJS.ProcessEnv = process.env): Promise<Bac> {
  const mode = modeDepuisEnv(env);
  const fournisseur = mode === 'off' ? null : await trouverFournisseur();
  const decision = decider(mode, fournisseur);
  return {
    decision,
    fournisseur,
    lignes: annonce(decision, fournisseur),
    // FERMÉ PAR DÉFAUT en « exige » : mieux vaut un nœud qui ne prend aucune
    // tâche qu'un nœud qui en prend une sans bac à sable en croyant le
    // contraire.
    refuse: decision.refuse,
  };
}

/**
 * L'option `bac` à passer au client — ou rien du tout.
 *
 * `variables` reprend EXACTEMENT ce que la sandbox laisse passer : le bac ne
 * doit ni en ajouter (fuite) ni en retirer (agent non authentifié, donc échec
 * d'infrastructure en boucle).
 */
export function optionBac(
  bac: Bac,
  variables: readonly string[],
): { bac: { fournisseur: Fournisseur; variables: string[] } } | Record<string, never> {
  if (!bac.decision.isole || !bac.fournisseur) return {};
  return { bac: { fournisseur: bac.fournisseur, variables: [...variables] } };
}
