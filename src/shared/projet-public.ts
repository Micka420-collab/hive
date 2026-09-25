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

import type { Project, StateSnapshot } from './types.js';

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

// ─── L'ESSAIM N'EST PAS UN LIEU POUR UN JETON NON PLUS ───────────────────────
//
// Le catalogue anonyme était fermé ; la même fuite restait ouverte une porte à
// côté. `GET /api/state` et le message WebSocket `state` rendent l'instantané
// COMPLET du magasin — `listProjects()`, donc chaque `repoUrl` tel qu'en base,
// jeton d'un dépôt privé compris. Or les deux ne demandent que le jeton de
// ruche, et `HIVE_TOKEN` se recopie sur CHAQUE machine membre (ADR 0007).
//
// Le tableau de bord le savait : il lave l'URL à l'AFFICHAGE (« l'afficher brut
// donnerait le jeton GitHub de l'hôte à chaque nouvelle arrivante »). Mais le
// jeton voyageait toujours en clair dans le JSON — lisible dans l'onglet réseau
// du navigateur, ou d'un simple `curl` avec le jeton de ruche. Laver l'écran
// sans laver le fil, c'est cacher le secret à ceux qui ne le cherchent pas.
//
// Le nœud qui clone ne passe PAS par ici : il reçoit l'URL complète dans le
// message d'affectation de tâche, lue en base. Le magasin garde l'URL entière ;
// seule sa sortie vers l'essaim est lavée.

/**
 * Retire les identifiants d'une URL de dépôt — et RIEN d'autre.
 *
 * Ce n'est pas `sansIdentifiants`, dont le contrat est celui d'une route
 * ANONYME : devant un doute elle se tait (chemin local ou chaîne illisible →
 * `null`). L'essaim, lui, est authentifié, et le tableau de bord se sert de la
 * simple PRÉSENCE d'un dépôt (`if (!project.repoUrl)`) pour proposer tickets et
 * livraisons ; rendre `null` pour le chemin local d'un administrateur éteindrait
 * ces panneaux. Ici, seul le secret part : chemins locaux et `git@hote:chemin`
 * passent tels quels, une URL sans identifiants est rendue à l'identique.
 */
export function laverIdentifiants(url: string | null): string | null {
  if (url === null) return null;
  if (/^[/\\]/.test(url) || /^[A-Za-z]:[\\/]/.test(url) || /^git@/.test(url)) return url;
  let analysee: URL;
  try {
    analysee = new URL(url);
  } catch {
    // Illisible par `new URL` mais qui en a la forme : par prudence, tout ce
    // qui précède l'arobase d'un « schéma://…@ » part, plutôt que d'envoyer la
    // chaîne telle quelle à tout l'essaim.
    return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#\s]*@/, '$1');
  }
  if (analysee.username === '' && analysee.password === '') return url;
  analysee.username = '';
  analysee.password = '';
  return analysee.toString();
}

/**
 * L'instantané tel que l'essaim le reçoit : le même, sans les identifiants des
 * dépôts. Construit de NOUVEAUX objets — l'instantané du magasin n'est pas
 * touché.
 *
 * ─── LE PROJET, ET CE QUE LES TÂCHES EN ONT RECOPIÉ ─────────────────────────
 *
 * Laver `projects[].repoUrl` ne suffisait pas. Le Conseil recopiait l'URL
 * BRUTE dans le prompt de ses éclaireuses (`contexteProjetAvecHorizon`), et
 * l'instantané rend chaque tâche avec son prompt. Le contexte est désormais
 * lavé à la source, mais les tâches créées AVANT le gardent en base. On
 * remplace donc, mot pour mot, chaque URL brute connue par sa forme lavée dans
 * le titre et le prompt des tâches — sans toucher au reste du texte, et sans
 * recopier une tâche qui n'en contient pas.
 */
export function instantanePourEssaim(instantane: StateSnapshot): StateSnapshot {
  const paires: [brut: string, lave: string][] = [];
  for (const p of instantane.projects) {
    const lave = laverIdentifiants(p.repoUrl);
    if (p.repoUrl !== null && lave !== null && lave !== p.repoUrl) paires.push([p.repoUrl, lave]);
  }
  const laverTexte = (texte: string): string =>
    paires.reduce((acc, [brut, lave]) => acc.split(brut).join(lave), texte);

  return {
    ...instantane,
    projects: instantane.projects.map((p) => ({ ...p, repoUrl: laverIdentifiants(p.repoUrl) })),
    tasks:
      paires.length === 0
        ? instantane.tasks
        : instantane.tasks.map((t) => {
            const title = laverTexte(t.title);
            const prompt = laverTexte(t.prompt);
            return title === t.title && prompt === t.prompt ? t : { ...t, title, prompt };
          }),
  };
}
