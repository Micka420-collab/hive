// Ce qu'un inconnu a le droit de voir d'un projet public.
//
// ─── LA FUITE QUE CE FICHIER FERME ───────────────────────────────────────────
//
// `GET /api/projects/public` est la seule route de la ruche qui ne demande
// AUCUNE authentification — c'est voulu, c'est un catalogue. Elle renvoyait :
//
//     store.listPublicProjects()  →  SELECT * FROM projects WHERE visibility='public'
//
// … c'est-à-dire la LIGNE ENTIÈRE, telle qu'elle est en base. Deux colonnes
// n'avaient rien à y faire :
//
//   • `repoUrl`. Un dépôt privé se clone avec ses identifiants, et la façon
//     dont on les donne à `git clone` sans configuration, c'est de les écrire
//     dans l'URL : `https://user:ghp_…@github.com/org/depot.git`. Rien ne
//     l'interdisait — `isValidRepoUrl` accepte tout ce qui commence par
//     `https://`. Un jeton GitHub partait donc à quiconque savait faire un
//     `curl` sur la ruche.
//   • `ownerId`. Il n'apprend rien d'utile à un visiteur, et il désigne
//     nommément une cible pour tout ce qui prend un identifiant d'utilisateur
//     en paramètre.
//
// ─── POURQUOI UNE PROJECTION EXPLICITE, ET PAS UN `delete row.repoUrl` ───────
//
// Parce que le danger n'est pas la colonne d'aujourd'hui, c'est celle de
// demain. `SELECT *` élargit la réponse tout seul : la prochaine colonne
// ajoutée à `projects` — un jeton d'intégration, une clé de webhook, une note
// interne — serait publiée le jour de son ajout, sans que personne l'ait
// décidé. Une liste blanche champ par champ oblige à trancher.
//
// Le test associé relit `types.ts` et échoue si un champ de `Project` n'est ni
// publié ni explicitement retenu. Ajouter une colonne devient donc une
// décision, pas un effet de bord.

import type { Project } from './types.js';

/** Ce qu'un visiteur non authentifié reçoit. Rien de plus. */
export interface ProjetPublic {
  id: string;
  name: string;
  description: string | null;
  /** URL du dépôt, DÉBARRASSÉE de tout identifiant qu'elle aurait porté. */
  repoUrl: string | null;
  createdAt: number;
}

/**
 * Les champs de `Project` qu'on retient sciemment, avec la raison.
 *
 * Cette liste n'est pas de la documentation : le test de source la relit et
 * refuse un champ qui ne serait ni ici ni dans `ProjetPublic`.
 */
export const CHAMPS_RETENUS: Readonly<Record<string, string>> = {
  ownerId: "désigne une cible nommée sans rien apprendre d'utile au visiteur",
  visibility: 'toujours « public » dans cette liste — le dire est du bruit',
};

/**
 * Retire les identifiants d'une URL de dépôt.
 *
 * On ne réécrit rien d'autre : le but est de publier une URL sur laquelle on
 * peut cliquer, pas de la normaliser. Une URL qu'on n'arrive pas à analyser est
 * rendue `null` plutôt que publiée telle quelle — devant un doute, sur une
 * route anonyme, ne rien dire est le bon défaut.
 */
export function sansIdentifiants(url: string | null): string | null {
  if (url === null || url.trim() === '') return null;
  // `git@hote:chemin` et les chemins locaux ne portent pas d'identifiants au
  // sens d'une URL, et `new URL` ne sait pas les lire. Un chemin local n'a
  // toutefois rien à faire dans un catalogue public : il nomme l'arborescence
  // de la machine de l'hôte.
  if (/^[/\\]/.test(url) || /^[A-Za-z]:[\\/]/.test(url)) return null;
  if (/^git@/.test(url)) return url;
  let analysee: URL;
  try {
    analysee = new URL(url);
  } catch {
    return null;
  }
  if (analysee.username === '' && analysee.password === '') return url;
  analysee.username = '';
  analysee.password = '';
  return analysee.toString();
}

/** La vue publique d'un projet — construite champ par champ, jamais copiée. */
export function vuePublique(projet: Project): ProjetPublic {
  return {
    id: projet.id,
    name: projet.name,
    description: projet.description,
    repoUrl: sansIdentifiants(projet.repoUrl),
    createdAt: projet.createdAt,
  };
}
