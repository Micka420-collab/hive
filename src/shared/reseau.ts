// Le RÉSEAU d'un projet — ce que les agents de ses tâches ont le droit de
// joindre depuis leur bac à sable. Une intention humaine par projet, lue par la
// Reine à chaque assignation et appliquée par le nœud (`proxy-egress.ts`).
//
// ─── POURQUOI UN RÉGLAGE, ET POURQUOI TROIS CRANS ────────────────────────────
//
// Le bac empêchait un agent de LIRE la machine du membre ; il ne l'empêchait
// pas d'ENVOYER ce qu'il avait lu (le dépôt, un jeton) : une injection de
// prompt dans une issue suffisait. Couper le réseau ne marche pas — un agent
// de codage doit joindre l'API de son modèle —, mais une LISTE BLANCHE, oui :
//
//   · `integrations` — l'API du modèle de l'agent, et rien d'autre. Le clone
//     et la livraison ne passent pas par le bac (le nœud les fait, `gitHote`) :
//     un agent n'a pas besoin de l'hôte git pour travailler.
//   · `dependances` — plus les registres que le dépôt DÉCLARE dans ses
//     fichiers de verrouillage (lus à la base, avant l'agent), plus l'hôte git
//     du projet. C'est le défaut : une tâche ordinaire (installer, tester)
//     marche sans réglage.
//   · `ouvert` — le réseau entier, comme avant ce réglage. Un choix explicite
//     du propriétaire, jamais un repli silencieux.
//
// Ligne ABSENTE en base = `dependances` : les projets existants reçoivent le
// défaut sans migration (règle 2 de la doctrine du store).

export const NIVEAUX_RESEAU = ['integrations', 'dependances', 'ouvert'] as const;
export type NiveauReseau = (typeof NIVEAUX_RESEAU)[number];

/** Le niveau d'un projet que personne n'a réglé — et d'une Reine qui ne le dit pas. */
export const NIVEAU_RESEAU_DEFAUT: NiveauReseau = 'dependances';

const CONNUS: ReadonlySet<string> = new Set(NIVEAUX_RESEAU);

export function estNiveauReseau(v: unknown): v is NiveauReseau {
  return typeof v === 'string' && CONNUS.has(v);
}

/** Le niveau FILTRE-t-il le réseau ? `ouvert` seul le laisse entier. */
export function reseauFiltre(niveau: NiveauReseau): boolean {
  return niveau !== 'ouvert';
}
