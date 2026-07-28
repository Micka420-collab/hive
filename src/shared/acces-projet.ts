// Qui a le droit d'entrer dans un projet, et d'en voir les membres.
//
// ─── CE QUI N'ÉTAIT VÉRIFIÉ NULLE PART ───────────────────────────────────────
//
// `POST /api/projects/:id/join` ne vérifiait qu'une chose : que l'appelant soit
// authentifié. Pas que le projet soit public, pas qu'il ait été invité, pas
// qu'il ait le moindre rapport avec lui.
//
//     store.addMember(project.id, userId)     ← sans autre condition
//
// N'importe quel compte de la ruche pouvait donc s'ajouter à N'IMPORTE QUEL
// projet, y compris privé. `GET /api/projects/:id/members` avait exactement le
// même trou : la liste nominative des membres d'un projet privé était lisible
// par tout titulaire d'un compte. Créer un compte suffisait à énumérer qui
// travaille sur quoi.
//
// La colonne `visibility` existait pourtant depuis le début, et le champ
// `ownerId` aussi. Aucun des deux n'était consulté ici — c'est le cas d'école
// du contrôle d'accès qui vit dans le modèle de données et jamais dans le
// chemin d'exécution.
//
// ─── POURQUOI LE REFUS RESSEMBLE À UNE ABSENCE ───────────────────────────────
//
// Un « 403 interdit » sur un projet privé confirme qu'il existe. Répété sur une
// liste d'identifiants, il dessine la carte des projets de la ruche — et les
// identifiants voyagent (une URL collée dans un salon, un journal, un
// signet). C'est le même raisonnement que pour les billets (ADR 0005) : le
// refus prend la forme EXACTE de l'inexistence, à l'octet près, et l'appelant
// ne peut pas distinguer « ce projet n'est pas à vous » de « ce projet
// n'existe pas ».
//
// Ce que le propriétaire de la ruche, lui, doit pouvoir lire, part au journal.

/** Ce qu'il faut savoir d'un projet pour trancher. */
export interface ProjetAcces {
  visibility: 'public' | 'private';
  ownerId: string | null;
}

/**
 * Cette personne peut-elle rejoindre ce projet d'elle-même ?
 *
 * Un projet PUBLIC est ouvert : c'est ce que « public » veut dire, et le
 * catalogue le montre déjà à des inconnus. Un projet PRIVÉ ne s'ouvre pas tout
 * seul — son propriétaire l'ouvre, ou personne. Les membres déjà inscrits
 * passent, pour que re-cliquer « rejoindre » reste sans effet plutôt que
 * d'être une erreur.
 */
export function peutRejoindre(projet: ProjetAcces, userId: string, dejaMembre: boolean): boolean {
  if (projet.visibility === 'public') return true;
  return projet.ownerId === userId || dejaMembre;
}

/**
 * Cette personne peut-elle voir QUI travaille sur ce projet ?
 *
 * Même frontière : sur un projet public, la liste des membres fait partie de ce
 * qu'on vient voir — c'est une ruche communautaire. Sur un projet privé, elle
 * nomme des gens, et personne d'extérieur n'a à la lire.
 */
export function peutVoirMembres(projet: ProjetAcces, userId: string, dejaMembre: boolean): boolean {
  if (projet.visibility === 'public') return true;
  return projet.ownerId === userId || dejaMembre;
}

/**
 * Cette personne peut-elle LIRE LE CODE du projet ?
 *
 * Une fonction distincte, et non un alias, bien que la règle soit aujourd'hui
 * la même que pour les membres. Les deux actes n'ont pas la même gravité — le
 * code EST ce que le projet vaut, la liste des membres dit seulement qui y
 * travaille — et le jour où l'un se resserre, on ne veut pas découvrir qu'on a
 * resserré l'autre par accident. Nommer par l'ACTE plutôt que par la route est
 * déjà la règle du fichier des rôles ; elle vaut ici aussi.
 *
 * ⚠ Cette fonction dit qui a le droit de lire LE DÉPÔT. Elle ne dit rien de ce
 * qui, DANS le dépôt, ne se sert jamais — `.git`, les `.env`, les clés
 * privées : c'est `shared/rayon.ts` qui tient cette liste-là, et les DEUX
 * gardes doivent passer.
 */
export function peutLireCode(projet: ProjetAcces, userId: string, dejaMembre: boolean): boolean {
  if (projet.visibility === 'public') return true;
  return projet.ownerId === userId || dejaMembre;
}
