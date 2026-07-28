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
 * Ce qu'il faut savoir de la PERSONNE pour trancher.
 *
 * ─── LE TROU QUE CE TYPE BOUCHE, ET COMMENT IL EST NÉ ────────────────────────
 *
 * Les trois fonctions ci-dessous ne regardaient que la personne et le projet.
 * Elles ignoraient le RÔLE — alors que la matrice des rôles déclare depuis le
 * début une action `voir_tous_les_projets`, accordée à l'administrateur.
 *
 * Le résultat s'est vu en éprouvant le connecteur GitHub de bout en bout :
 * `POST /api/github/import` s'authentifie par le JETON DE RUCHE, pas par un
 * compte. Il n'a donc personne à qui attribuer le projet, et le crée
 * `visibility: 'private'`, `ownerId: null`.
 *
 * Un projet importé était donc **illisible par tout le monde** : ni par
 * l'administrateur, ni par qui que ce soit. Il existait, des tâches pouvaient
 * tourner dessus, et aucun humain ne pouvait en ouvrir le code. La
 * fonctionnalité entière était morte, sans qu'aucun test ne le dise — parce
 * qu'aucun test ne faisait le trajet complet « importer, puis lire ».
 *
 * ─── POURQUOI L'ADMINISTRATEUR PASSE ─────────────────────────────────────────
 *
 * Ce n'est pas une exception de confort. Dans une ruche auto-hébergée,
 * l'administrateur est celui qui tient la machine et le fichier SQLite : lui
 * refuser la lecture par l'interface ne protège personne, cela l'oblige juste
 * à ouvrir la base à la main. La matrice le disait déjà ; il manquait de la
 * consulter.
 */
export interface Lecteur {
  userId: string;
  /** A l'action `voir_tous_les_projets` (rôle administrateur). */
  voitTout: boolean;
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
export function peutRejoindre(projet: ProjetAcces, lecteur: Lecteur, dejaMembre: boolean): boolean {
  if (projet.visibility === 'public') return true;
  if (lecteur.voitTout) return true;
  return estProprietaire(projet, lecteur) || dejaMembre;
}

/**
 * Cette personne peut-elle voir QUI travaille sur ce projet ?
 *
 * Même frontière : sur un projet public, la liste des membres fait partie de ce
 * qu'on vient voir — c'est une ruche communautaire. Sur un projet privé, elle
 * nomme des gens, et personne d'extérieur n'a à la lire.
 */
export function peutVoirMembres(
  projet: ProjetAcces,
  lecteur: Lecteur,
  dejaMembre: boolean,
): boolean {
  if (projet.visibility === 'public') return true;
  if (lecteur.voitTout) return true;
  return estProprietaire(projet, lecteur) || dejaMembre;
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
export function peutLireCode(projet: ProjetAcces, lecteur: Lecteur, dejaMembre: boolean): boolean {
  if (projet.visibility === 'public') return true;
  if (lecteur.voitTout) return true;
  return estProprietaire(projet, lecteur) || dejaMembre;
}

/**
 * Cette personne peut-elle ADMETTRE quelqu'un d'autre dans ce projet ?
 *
 * ─── LE CUL-DE-SAC QUE CETTE FONCTION OUVRE ──────────────────────────────────
 *
 * Un projet privé n'avait aucun moyen de gagner un membre. `peutRejoindre`
 * n'admet, sur un projet privé, que le propriétaire, l'administrateur et ceux
 * qui sont DÉJÀ membres — ce qui est correct (on ne s'invite pas chez les
 * autres) et incomplet : personne ne pouvait inviter non plus. Un projet privé
 * restait donc à jamais l'affaire d'une seule personne.
 *
 * C'est le contraire de ce qu'on construit. Le Rayon a été fait pour que « les
 * abeilles qui se connectent voient le code » ; un dépôt importé de GitHub est
 * privé, et il n'existait aucun chemin pour y faire entrer une ouvrière.
 *
 * Le droit d'admettre est donc celui du PROPRIÉTAIRE, pas d'un membre : sinon
 * le premier invité inviterait à son tour, et « privé » ne voudrait plus rien
 * dire au bout de trois personnes. L'administrateur passe, pour la même raison
 * qu'ailleurs — il tient la machine et le fichier SQLite.
 */
export function peutAdmettre(projet: ProjetAcces, lecteur: Lecteur): boolean {
  return lecteur.voitTout || estProprietaire(projet, lecteur);
}

/**
 * Cette personne peut-elle ADOPTER ce projet — s'en déclarer propriétaire ?
 *
 * UNIQUEMENT si le projet est ORPHELIN. Un projet importé par le jeton de ruche
 * n'a pas de propriétaire (l'import ne s'authentifie pas par un compte) : sans
 * adoption, il n'a personne pour admettre des membres, et le cul-de-sac
 * ci-dessus se referme définitivement sur lui.
 *
 * **Adopter n'est jamais prendre.** Un projet qui a déjà un propriétaire ne
 * change pas de mains par cette route, même pour un administrateur : ce serait
 * un vol de projet déguisé en fonctionnalité d'administration, et rien dans la
 * ruche ne le justifie. L'administrateur peut déjà tout LIRE ; s'approprier est
 * un autre acte.
 */
export function peutAdopter(projet: ProjetAcces, lecteur: Lecteur): boolean {
  if (projet.ownerId !== null) return false;
  return lecteur.voitTout;
}

/**
 * Cette personne est-elle propriétaire de ce projet ?
 *
 * `ownerId` est NULLABLE, et c'est là qu'est le piège : un projet sans
 * propriétaire n'appartient à personne, pas à tout le monde. Comparer sans
 * cette garde ferait du premier venu dont `userId` vaudrait `null` — ou de
 * n'importe quelle chaîne vide qui traînerait — le propriétaire de tous les
 * projets orphelins.
 */
function estProprietaire(projet: ProjetAcces, lecteur: Lecteur): boolean {
  return projet.ownerId !== null && projet.ownerId === lecteur.userId;
}
