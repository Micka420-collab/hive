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

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { connect, createServer, type Server } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { nomReserveWindows, segmentSur } from '../shared/noms-windows.js';
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

/**
 * La racine de travail d'un nœud qui n'a pas reçu `HIVE_WORKDIR` :
 * `.hive-work/<nom>`, le nom tiré de `HIVE_NODE_NAME` ou de la machine.
 *
 * UNE copie, pour `main.ts` et `client.ts`, qui la recalculaient chacun : c'est
 * dans ce dossier que vit l'identité (`identiteStable`), et deux calculs qui
 * divergent un jour donneraient au nœud deux identités — un fantôme « hors
 * ligne » dans la ruche.
 *
 * Le nom est NETTOYÉ (`[A-Za-z0-9_-]`) puis, SOUS WINDOWS SEULEMENT, rendu sûr
 * (`segmentSur`) : un poste nommé `aux`, `nul` ou `com1` y désignait un
 * périphérique, et le nœud ne pouvait créer ni son dossier ni son identité.
 *
 * Windows seul, à la différence des identifiants du protocole : ce dossier ne
 * sert qu'à LA machine qui le calcule, et c'est lui qui porte l'identité
 * (`node-id.txt`). Remappé partout, un poste Linux nommé `aux` changeait de
 * dossier à la mise à jour — donc d'identité, et l'ancienne restait dans la
 * ruche comme un fantôme « hors ligne ». Sous Windows, l'ancien dossier n'a
 * jamais pu exister : rien à perdre.
 */
export function racineDeTravailParDefaut(
  nom: string,
  plateforme: NodeJS.Platform = process.platform,
): string {
  const nettoye = nom.replace(/[^A-Za-z0-9_-]+/g, '_');
  return path.join('.hive-work', plateforme === 'win32' ? segmentSur(nettoye) : nettoye);
}

/**
 * Le refus d'une racine de travail DONNÉE (`HIVE_WORKDIR`) que Windows ne peut
 * pas créer, ou `null`.
 *
 * Celle-là, l'opérateur l'a choisie : on ne la remappe pas en silence (son
 * `aux~` ne serait pas le dossier qu'il surveille, sauvegarde ou nettoie), on
 * la refuse en nommant le segment fautif. Sans ce refus, `C:\hive\aux` faisait
 * échouer le premier `mkdir` ou l'écriture de l'identité sur un périphérique,
 * avec une erreur qui ne parle pas du nom.
 *
 * `.` et `..` ne sont pas des noms : ils finissent par un point sans que
 * Windows ne les réécrive, d'où leur exclusion.
 */
export function refusRacineDeTravail(
  racine: string,
  plateforme: NodeJS.Platform = process.platform,
): string | null {
  if (plateforme !== 'win32') return null;
  const fautif = racine
    .split(/[\\/]/)
    .find((segment) => segment !== '.' && segment !== '..' && nomReserveWindows(segment));
  return fautif === undefined
    ? null
    : `HIVE_WORKDIR (${racine}) contient « ${fautif} », un nom que Windows réserve à un ` +
        'périphérique ou réécrit (CON, PRN, AUX, NUL, COM1-9, LPT1-9, point ou espace final). ' +
        'Choisissez un autre dossier.';
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

/**
 * Où l'adresse de la ruche est rangée, À CÔTÉ de la clé qu'elle accepte.
 *
 * La clé seule ne suffit pas à redémarrer : il faut savoir OÙ la présenter.
 * Une machine venue par un billet collé le retrouve dans sa commande ; une
 * machine accueillie sur le réseau local (`hive join --decouvrable`) n'a
 * jamais rien eu à coller — sans cette adresse, chaque redémarrage la
 * remettait en attente d'appariement, et l'administrateur émettait un billet
 * neuf qu'elle n'échangeait même pas. Pas un secret : l'URL est aussi dans
 * chaque billet, et dans la bannière de connexion.
 */
export function cheminAdresseRuche(racine: string): string {
  return path.join(racine, 'ruche-url.txt');
}

/** L'adresse mémorisée, ou `null`. Mêmes règles que `lireCle`. */
export function lireAdresseRuche(racine: string): string | null {
  try {
    const v = readFileSync(cheminAdresseRuche(racine), 'utf8').trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Range l'adresse ; un échec est avalé, comme pour `rangerCle`. */
export function rangerAdresseRuche(racine: string, url: string): void {
  try {
    mkdirSync(racine, { recursive: true });
    writeFileSync(cheminAdresseRuche(racine), url, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // dégrader, pas tuer : le prochain démarrage redemandera un billet
  }
}

/**
 * La clé mémorisée, SI elle vaut pour la ruche `url` — sinon `null`.
 *
 * Une clé ne se présente qu'à la ruche qui l'a délivrée. Relancé avec le
 * billet d'une AUTRE ruche, un nœud qui réutilisait sa clé l'envoyait à cette
 * autre ruche — qui la refusait, et la tenait désormais —, et ne consommait
 * même pas le billet reçu, resté valide dix minutes. Une clé rangée AVANT
 * cette mémoire d'adresse (aucune adresse) garde l'ancien comportement : on
 * ne sait pas d'où elle vient, et la jeter ferait perdre sa place au nœud.
 */
export function cleNoeudPour(racine: string, url: string): string | null {
  const cle = lireCle(racine);
  const memo = lireAdresseRuche(racine);
  return cle !== null && (memo === null || memo === url) ? cle : null;
}

/**
 * La REPRISE : clé ET adresse mémorisées, ou `null`. De quoi redémarrer sans
 * billet ni appariement — `hive join` relancé à nu, ou une machine accueillie
 * sur le réseau local (`hive join --decouvrable`) qui n'a jamais rien eu à
 * coller.
 */
export function repriseMemorisee(racine: string): { url: string; cle: string } | null {
  const cle = lireCle(racine);
  const url = lireAdresseRuche(racine);
  return cle !== null && url !== null ? { url, cle } : null;
}

/**
 * Le verrou de l'identité : une socket locale que CE processus écoute, nommée
 * par une empreinte du chemin ABSOLU de l'atelier — un tube nommé sous
 * Windows.
 *
 * HORS de l'atelier, jamais dedans : l'atelier vit dans le dossier de la ruche,
 * qu'on copie et sauvegarde, et une socket y fait échouer ce qui la croise
 * (`fs.cpSync` s'arrête net sur elle). Elle va dans `XDG_RUNTIME_DIR`, propre à
 * l'utilisateur et en 0700, sinon dans le dossier temporaire — propre à
 * l'utilisateur sous macOS et Windows. Compromis nommé : sur un Linux sans
 * session (`/tmp` partagé), un autre compte local peut poser le fichier avant
 * le nœud et l'empêcher de démarrer ; il ne peut ni le faire ramasser ni
 * prendre son identité.
 */
export function cheminVerrou(
  racine: string,
  env: NodeJS.ProcessEnv = process.env,
  plateforme: NodeJS.Platform = process.platform,
): string {
  const empreinte = createHash('sha256').update(path.resolve(racine)).digest('hex').slice(0, 16);
  if (plateforme === 'win32') return `\\\\.\\pipe\\hive-noeud-${empreinte}`;
  const dossier = env.XDG_RUNTIME_DIR?.trim() || os.tmpdir();
  return path.join(dossier, `hive-noeud-${empreinte}.sock`);
}

/** Écoute `chemin` : `pris`, `occupe` (déjà écouté ou laissé là), ou `erreur`. */
function ecouter(
  chemin: string,
): Promise<{ issue: 'pris'; serveur: Server } | { issue: 'occupe' | 'erreur' }> {
  return new Promise((resolve) => {
    const serveur = createServer((s) => s.destroy());
    serveur.once('error', (e: NodeJS.ErrnoException) =>
      resolve({ issue: e.code === 'EADDRINUSE' ? 'occupe' : 'erreur' }),
    );
    serveur.listen(chemin, () => {
      // Le verrou ne doit pas, à lui seul, garder le nœud en vie.
      serveur.unref();
      resolve({ issue: 'pris', serveur });
    });
  });
}

/** Quelqu'un écoute-t-il `chemin` ? Une socket laissée par un mort refuse la connexion. */
function ecoute(chemin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = connect(chemin);
    c.once('connect', () => {
      c.destroy();
      resolve(true);
    });
    c.once('error', () => resolve(false));
  });
}

/** Ce que rend `occuperIdentite`. */
export type Occupation =
  | { occupee: true }
  | {
      occupee: false;
      /** Rend le verrou (un banc) ; la mort du processus le rend d'elle-même. */
      liberer: () => void;
    };

/**
 * Prend l'identité du nœud pour CE processus — ou rend `occupee` si un AUTRE
 * processus vivant la tient déjà : ce second lancement ne doit alors pas
 * démarrer.
 *
 * ─── DEUX PROCESSUS, UNE IDENTITÉ, ET UN RAMASSAGE QUI TUE LE VOISIN ─────────
 *
 * Le ramassage du démarrage (`ramasserRestes`) supprime tout conteneur à
 * l'étiquette de ce nœud, en tenant qu'aucun n'est à un processus vivant. Un
 * `npm run node` lancé deux fois par erreur (même nom, donc même atelier,
 * donc même identité) cassait cette hypothèse : le second tuait les agents en
 * cours du premier. Et le laisser tourner sans ramasser ne fermait rien : le
 * premier, tué puis relancé, aurait ramassé les conteneurs du second, qui
 * portent la même étiquette. Deux processus sous une identité se disputent
 * de toute façon la ruche : le second refuse de démarrer.
 *
 * ─── UN VERROU QUE L'OS REND, PAS UN PID ─────────────────────────────────────
 *
 * Un pid inscrit dans un fichier survit à son processus : après un kill -9,
 * un programme sans rapport qui hérite du même pid faisait croire, à chaque
 * démarrage, à un nœud déjà là — ramassage sauté, pour de bon. Une socket
 * écoutée meurt avec son processus : le noyau ferme l'écoute, une connexion
 * est refusée, et le fichier resté là est repris. Sous Windows, le tube nommé
 * disparaît avec son processus.
 *
 * Un verrou impossible à poser (système de fichiers sans sockets, disque
 * refusé) ne tue pas le nœud : c'est la machine de quelqu'un d'autre. Compromis
 * nommé : deux lancements à la même milliseconde sur une socket morte peuvent
 * tous deux la reprendre — le cas fermé est le second lancement d'un nœud
 * déjà au travail.
 */
export async function occuperIdentite(
  racine: string,
  chemin: string = cheminVerrou(racine),
): Promise<Occupation> {
  let r = await ecouter(chemin);
  if (r.issue === 'occupe') {
    if (await ecoute(chemin)) return { occupee: true };
    // Une socket laissée par un processus mort : la reprendre.
    try {
      unlinkSync(chemin);
    } catch {
      // déjà partie
    }
    r = await ecouter(chemin);
  }
  if (r.issue === 'pris') {
    const { serveur } = r;
    return { occupee: false, liberer: () => serveur.close() };
  }
  // `occupe` au second essai : un lancement simultané l'a prise — elle est à lui.
  return r.issue === 'occupe' ? { occupee: true } : { occupee: false, liberer: () => {} };
}
