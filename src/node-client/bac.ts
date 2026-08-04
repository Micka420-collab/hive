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
import { CODE, type CodeSortie } from '../codes-sortie.js';

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
  /**
   * Le code que le processus doit rendre — porté ICI, pas recopié par chaque
   * chemin de démarrage.
   *
   * ─── POURQUOI CE CHAMP EXISTE ─────────────────────────────────────────────
   *
   * Les deux chemins sortaient en `1`. Or `codes-sortie.ts` dit exactement ce
   * qu'est ce `1` : « Erreur non classée. Le fourre-tout, à n'utiliser qu'en
   * DERNIER RECOURS » — et il définit `REFUS_SECURITE` juste en dessous, pour
   * ce cas précis.
   *
   * Ce n'est pas une coquetterie de numérotation. Le même fichier dit ce que ça
   * coûte : « Ansible, systemd ou un Makefile ne peuvent pas distinguer
   * "déjà en place" de "port occupé" de "on a refusé pour raison de sécurité".
   * La seule réponse possible devient relancer et espérer. »
   *
   * Un `Restart=on-failure` voit `1`, relance, le nœud refuse à nouveau,
   * relance — sur une machine qui ne pourra JAMAIS travailler, faute de moteur
   * de conteneurs. Avec un code dédié, le superviseur s'arrête et le dit à un
   * humain, qui est le seul à pouvoir installer podman.
   *
   * Le champ vit dans la décision plutôt que chez l'appelant parce que le trou
   * d'origine était précisément un duplicata : deux chemins, deux copies, une
   * dérive garantie — c'est ce que dit l'en-tête de ce fichier.
   */
  codeSortie: CodeSortie;
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
 * Le code que le processus doit rendre, selon qu'il refuse ou non.
 *
 * Exporté et minuscule À DESSEIN. Tant que la règle vivait à l'intérieur de
 * `preparerBac`, un banc ne pouvait l'éprouver qu'en fabriquant un `Bac` à la
 * main — c'est-à-dire en RECOPIANT la règle, donc en jugeant sa propre copie.
 * Mesuré : deux mutations de la règle d'origine laissaient le banc vert.
 */
export function codeDuBac(refuse: boolean): CodeSortie {
  return refuse ? CODE.REFUS_SECURITE : CODE.SUCCES;
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
    codeSortie: codeDuBac(decision.refuse),
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
