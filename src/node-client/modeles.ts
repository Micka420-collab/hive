// QUELS MODÈLES CE NŒUD DÉCLARE POUVOIR FAIRE TOURNER — lus de la configuration.
//
// ─── POURQUOI DÉCLARÉ, ET PAS DÉTECTÉ ────────────────────────────────────────
//
// L'Aiguillage appris choisit, parmi les modèles qu'un nœud DÉCLARE, celui qui a
// fait le mieux sur le genre de la tâche. Reste : comment le nœud sait-il quels
// modèles il peut lancer ? On ne les DÉTECTE pas — un `claude --model X` échoue
// selon l'abonnement, pas selon le binaire, et un modèle qu'un compte n'a pas le
// droit d'appeler échouerait en boucle SANS jamais rendre de verdict (l'échec
// d'infrastructure réassigne, il ne juge pas). L'Aiguillage ne pourrait donc
// même pas apprendre à l'éviter. On le fait donc DÉCLARER par l'opérateur, via
// `HIVE_MODELES` : lui seul sait ce que son compte peut réellement appeler.
//
// ─── POURQUOI SANITISER PLUTÔT QUE REFUSER ───────────────────────────────────
//
// Le hub valide la liste (bornée, noms courts et non vides) et REFUSE le register
// ENTIER si elle est malformée. Une virgule en trop ou un nom vide dans la config
// empêcherait alors le nœud de rejoindre — une panne opaque pour un détail. On
// ramène donc la liste dans les clous ICI : entrée vide, doublon ou nom démesuré
// écartés en silence. Rien de valide ⇒ `undefined` ⇒ le nœud ne déclare rien, et
// la ruche retombe sur son ordonnancement d'avant l'Aiguillage.

import { LIMITS } from '../shared/protocol.js';

function contientControle(nom: string): boolean {
  for (const caractere of nom) {
    const code = caractere.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function modeleDeclareValide(nom: string): boolean {
  return (
    nom.length > 0 && nom.length <= LIMITS.name && !nom.startsWith('-') && !contientControle(nom)
  );
}

/**
 * Lit une liste `HIVE_MODELES` séparée par des virgules en une liste PROPRE, ou
 * `undefined` si rien de valide n'en sort. Bornée exactement comme le protocole
 * (≤ `LIMITS.modeles`, chaque nom non vide et ≤ `LIMITS.name`), pour qu'une liste
 * acceptée ici ne soit jamais refusée par le hub.
 */
export function parseModeles(brut: string | undefined): string[] | undefined {
  if (brut === undefined) return undefined;
  const vus = new Set<string>();
  const propres: string[] = [];
  for (const brutNom of brut.split(',')) {
    const nom = brutNom.trim();
    if (!modeleDeclareValide(nom) || vus.has(nom)) continue;
    vus.add(nom);
    propres.push(nom);
    if (propres.length >= LIMITS.modeles) break;
  }
  return propres.length > 0 ? propres : undefined;
}

/** Un hub ne peut sélectionner que ce que ce nœud a lui-même confirmé. */
export function modeleAssigneAutorise(
  modele: string | undefined,
  declares: readonly string[] | undefined,
): boolean {
  return modele === undefined || declares?.includes(modele) === true;
}
