/**
 * L'IDENTITÉ D'UN NŒUD ET SA CLÉ, SUR SON DISQUE.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * `join.ts` finit par `await main()`, sans garde. Un fichier qui s'exécute à
 * l'import ne peut être importé par AUCUN test — il ouvrirait un WebSocket et
 * poserait des gestionnaires de signal au moment où le banc le charge. C'est
 * le § 2.8 du carnet des erreurs, et c'est pourquoi la mesure de couverture
 * annonçait 0 % sur ce fichier : pas « mal testé », *structurellement*
 * intestable.
 *
 * Or ce que `join.ts` porte n'est pas anodin. C'est le premier code qu'un ami
 * invité exécute sur SA machine :
 *
 *   · combien de tâches il acceptera de mener de front, à partir d'une
 *     variable d'environnement qu'il tape lui-même ;
 *   · l'identité sous laquelle la ruche le reconnaîtra d'un redémarrage à
 *     l'autre ;
 *   · sa clé propre, écrite en clair dans un fichier de son disque.
 *
 * Ces trois choses ne dépendent ni du réseau, ni des signaux, ni d'`argv` :
 * elles prennent un chemin de travail et rendent un résultat. Sorties ici,
 * elles s'éprouvent. `join.ts` les importe et ne perd rien.
 *
 * ─── LES RÈGLES QUE CE MODULE TIENT ──────────────────────────────────────────
 *
 *   1. LA CONCURRENCE EST BORNÉE DES DEUX CÔTÉS. Le nombre vient d'un humain
 *      qui tape une variable d'environnement sur sa propre machine : `0` la
 *      figerait sans qu'elle ait l'air en panne, `9999` la mettrait à genoux.
 *   2. L'IDENTITÉ SURVIT AU REDÉMARRAGE, ET ELLE EST VALIDÉE. Un nœud qui
 *      change d'identité à chaque lancement laisse derrière lui une file de
 *      fantômes dans la ruche ; un fichier corrompu qu'on croirait sur parole
 *      ferait envoyer des tâches à une identité que le protocole refuse.
 *   3. LA CLÉ EST ÉCRITE EN 0600, ET SON ABSENCE N'EST PAS UNE PANNE. Sur une
 *      machine partagée, une clé lisible par tous les comptes ne vaut rien.
 *      Et un disque en lecture seule doit dégrader — pas tuer le nœud.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ID_PATTERN } from '../shared/protocol.js';

/** Ce qu'on accepte de mener de front quand rien n'est demandé. */
export const CONCURRENCE_PAR_DEFAUT = 2;
/** Une tâche à la fois : en dessous, le nœud est branché mais ne butine pas. */
export const CONCURRENCE_MIN = 1;
/** Au-delà, on met la machine de l'invité à genoux pour rien. */
export const CONCURRENCE_MAX = 16;

/**
 * Le nombre de tâches menées de front, borné des deux côtés.
 *
 * La valeur vient de `HIVE_MAX_CONCURRENCY`, donc d'un humain qui tape dans un
 * terminal. Tout ce qui n'est pas un entier lisible retombe sur la valeur par
 * défaut plutôt que sur `NaN` : un `NaN` propagé jusqu'à la boucle de travail
 * donnerait un nœud connecté qui n'accepte jamais rien, et l'invité verrait
 * « ✔ Nœud démarré » sans qu'il ne se passe jamais rien.
 */
export function bornerConcurrence(brut: string | undefined): number {
  const n = Number.parseInt(brut ?? String(CONCURRENCE_PAR_DEFAUT), 10);
  return Number.isInteger(n)
    ? Math.min(Math.max(n, CONCURRENCE_MIN), CONCURRENCE_MAX)
    : CONCURRENCE_PAR_DEFAUT;
}

/** Où l'identité du nœud est mémorisée. */
export function cheminIdentite(racine: string): string {
  return path.join(racine, 'node-id.txt');
}

/**
 * L'identité stable du nœud : relue si elle existe et qu'elle est VALIDE,
 * fabriquée sinon.
 *
 * Le contrôle par `ID_PATTERN` n'est pas de la coquetterie : le fichier vit
 * sur le disque de l'invité, il peut être tronqué par un disque plein, édité
 * à la main, ou rempli d'espaces. Une identité que le protocole refuse ferait
 * échouer la connexion avec un message qui ne parlerait pas du fichier fautif.
 *
 * Si le disque refuse l'écriture, l'identité vaut pour la session en cours et
 * le nœud tourne quand même : c'est la machine de quelqu'un d'autre, on n'y
 * meurt pas pour un droit d'écriture manquant.
 */
export function identiteStable(racine: string): string {
  const fichier = cheminIdentite(racine);
  try {
    const existante = readFileSync(fichier, 'utf8').trim();
    if (ID_PATTERN.test(existante)) return existante;
  } catch {
    // premier lancement
  }
  const id = `node-${randomUUID()}`.slice(0, 64);
  try {
    mkdirSync(racine, { recursive: true });
    writeFileSync(fichier, id, 'utf8');
  } catch {
    // impossible d'écrire : on garde l'id en mémoire pour cette session
  }
  return id;
}

/**
 * Où la clé propre du nœud est rangée.
 *
 * INDISPENSABLE, pas une optimisation : un billet est à usage UNIQUE. Sans
 * cette mémoire, le premier redémarrage du nœud redemanderait un échange avec
 * un billet déjà consommé — et l'ami se retrouverait dehors sans comprendre
 * pourquoi, en ayant tout fait correctement.
 */
export function cheminCle(racine: string): string {
  return path.join(racine, 'node-key.txt');
}

/** La clé mémorisée, ou `null` s'il n'y en a pas — un fichier vide n'est pas une clé. */
export function lireCle(racine: string): string | null {
  try {
    const v = readFileSync(cheminCle(racine), 'utf8').trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Range la clé en 0600 : sur une machine partagée, une clé lisible par tous
 * les comptes vaudrait la même clé pour personne.
 *
 * L'échec d'écriture est avalé volontairement — le nœud tourne pour cette
 * session, et il faudra un nouveau billet au prochain démarrage. L'appelant
 * le dit à l'utilisateur ; mourir ici serait pire.
 */
export function rangerCle(racine: string, cle: string): void {
  try {
    mkdirSync(racine, { recursive: true });
    writeFileSync(cheminCle(racine), cle, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // voir ci-dessus : dégrader, pas tuer
  }
}
