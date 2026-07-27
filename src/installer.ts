// L'installation — de « je viens de cloner » à « ma ruche tourne », en une
// commande.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Une ruche n'a de valeur qu'avec des membres, et un membre s'en va au premier
// écran d'erreur. Le README demandait six gestes : vérifier Node, installer,
// inventer un jeton, écrire un `.env`, savoir quel agent on a, lancer. Chacun
// est trivial et l'ensemble suffit à perdre la moitié des gens.
//
// ─── CE QUE CE SCRIPT NE FAIT PAS, ET C'EST DÉLIBÉRÉ ─────────────────────────
//
// Il n'installe RIEN sur la machine en dehors du dossier du projet. Pas de
// `sudo`, pas de paquet système, pas de service au démarrage, pas de PATH
// modifié. Un installeur qui touche à la machine est un installeur qu'on
// n'ose pas lancer — et Hive demande déjà qu'on lui confie ses clés d'API.
//
// Il n'écrase JAMAIS un `.env` existant. Écraser une configuration, c'est
// effacer un jeton en service et couper tous les nœuds déjà connectés — pour
// « aider ». Le fichier existant est lu, complété si des clés manquent, et
// jamais réécrit sur ce qu'il contient déjà.
//
// MODULE PUR pour tout ce qui se décide, impur seulement pour ce qui s'écrit :
// la génération de configuration est testable sans toucher au disque.

import { randomBytes } from 'node:crypto';
import { MIN_TOKEN_LENGTH } from './shared/types.js';

/** Longueur du jeton engendré. Confortablement au-delà du minimum exigé. */
export const LONGUEUR_JETON = 32;

/** Port par défaut de l'orchestrateur. */
export const PORT_DEFAUT = 7777;

/**
 * Engendre un jeton non trivial.
 *
 * `randomBytes`, jamais `Math.random` : ce jeton est la SEULE chose qui sépare
 * une ruche d'un inconnu qui a trouvé son port. Un générateur non
 * cryptographique y serait une porte ouverte avec un cadenas dessiné dessus.
 */
export function engendrerJeton(longueur = LONGUEUR_JETON): string {
  return randomBytes(Math.ceil(longueur / 2))
    .toString('hex')
    .slice(0, longueur);
}

/** Une ligne de configuration : sa clé, sa valeur, et pourquoi elle existe. */
export interface Reglage {
  cle: string;
  valeur: string;
  commentaire: string;
}

/**
 * Analyse un `.env` existant. Rend les clés déjà définies — valeurs comprises,
 * parce qu'on ne les remplacera pas.
 *
 * Tolérant par construction : un `.env` écrit à la main contient des
 * commentaires, des lignes vides, des `export`, et parfois des guillemets. Le
 * refuser pour un détail de forme reviendrait à écraser une configuration
 * valide, c'est-à-dire exactement ce qu'on veut éviter.
 */
export function lireEnv(contenu: string): Map<string, string> {
  const trouvees = new Map<string, string>();
  for (const brut of contenu.split('\n')) {
    const ligne = brut.trim().replace(/^export\s+/, '');
    if (ligne === '' || ligne.startsWith('#')) continue;
    const separateur = ligne.indexOf('=');
    if (separateur <= 0) continue;
    const cle = ligne.slice(0, separateur).trim();
    let valeur = ligne.slice(separateur + 1).trim();
    if (
      (valeur.startsWith('"') && valeur.endsWith('"')) ||
      (valeur.startsWith("'") && valeur.endsWith("'"))
    ) {
      valeur = valeur.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cle)) trouvees.set(cle, valeur);
  }
  return trouvees;
}

/**
 * Les réglages qu'une ruche neuve doit avoir, avec ceux qui existent déjà
 * PRÉSERVÉS tels quels.
 *
 * Un jeton existant est conservé même s'il est trivial : le changer couperait
 * tous les nœuds connectés. On le SIGNALE (voir `avertissements`) plutôt que
 * de décider à la place de l'humain.
 */
export function composerReglages(
  existant: Map<string, string>,
  jeton = engendrerJeton(),
): Reglage[] {
  const garde = (cle: string, defaut: string): string => existant.get(cle) ?? defaut;
  return [
    {
      cle: 'HIVE_TOKEN',
      valeur: garde('HIVE_TOKEN', jeton),
      commentaire:
        'Le secret qui protège votre ruche. Ne le publiez jamais ; partagez plutôt un billet d’invitation.',
    },
    {
      cle: 'HIVE_PORT',
      valeur: garde('HIVE_PORT', String(PORT_DEFAUT)),
      commentaire: 'Port de l’orchestrateur.',
    },
    {
      cle: 'HIVE_HTTP',
      valeur: garde('HIVE_HTTP', `http://localhost:${garde('HIVE_PORT', String(PORT_DEFAUT))}`),
      commentaire: 'Adresse utilisée par la CLI pour parler à la ruche.',
    },
    {
      cle: 'HIVE_GARDIENNES',
      valeur: garde('HIVE_GARDIENNES', 'consultatif'),
      commentaire:
        'Contrôle d’entrée des productions : off | consultatif | strict. Le défaut observe sans rien refuser.',
    },
    {
      cle: 'HIVE_ISOLEMENT',
      valeur: garde('HIVE_ISOLEMENT', 'auto'),
      commentaire:
        'Bac à sable des agents : off | auto | exige. « auto » utilise podman/docker/bubblewrap ' +
        's’il y en a un, sinon travaille quand même en le disant. « exige » refuse de travailler ' +
        'sans bac à sable — c’est le réglage à choisir si vous prêtez votre machine à des inconnus.',
    },
    {
      cle: 'HIVE_POLYETHISME',
      valeur: garde('HIVE_POLYETHISME', 'consignes'),
      commentaire:
        'Encadrement des ouvrières selon leur expérience : off | consignes | strict. Le défaut encadre sans rien retenir.',
    },
  ];
}

/**
 * Ce qui mérite d'être dit à l'humain APRÈS l'installation.
 *
 * Un installeur qui se tait sur une configuration dangereuse a échoué même s'il
 * s'est terminé sans erreur.
 */
export function avertissements(reglages: readonly Reglage[]): string[] {
  const dits: string[] = [];
  const jeton = reglages.find((r) => r.cle === 'HIVE_TOKEN')?.valeur ?? '';
  if (jeton.length < MIN_TOKEN_LENGTH) {
    dits.push(
      `Votre HIVE_TOKEN fait ${jeton.length} caractères : c’est trop court pour protéger quoi que ce soit. ` +
        `Remplacez-le dans .env par au moins ${MIN_TOKEN_LENGTH} caractères — la ruche refusera de démarrer autrement.`,
    );
  }
  return dits;
}

/**
 * Rend le contenu d'un `.env` lisible par un humain.
 *
 * Les commentaires ne sont pas décoratifs : ce fichier sera relu dans six mois
 * par quelqu'un qui ne se souviendra pas de ce que `HIVE_GARDIENNES` fait, et
 * qui le mettra à `strict` au hasard s'il n'y a rien pour l'en dissuader.
 */
export function rendreEnv(reglages: readonly Reglage[]): string {
  const lignes = [
    '# Configuration de votre ruche Hive.',
    '# Engendré par « npm run install:hive ». Modifiable à la main sans crainte :',
    '# le script ne réécrit jamais une valeur déjà présente.',
    '',
  ];
  for (const r of reglages) {
    lignes.push(`# ${r.commentaire}`);
    lignes.push(`${r.cle}=${r.valeur}`);
    lignes.push('');
  }
  return lignes.join('\n');
}

/** Version de Node exigée, telle que le `package.json` la déclare. */
export const NODE_MIN = 20;

/** `true` si la version courante suffit. Prend « v20.11.0 » comme « 20.11.0 ». */
export function nodeSuffisant(version: string): boolean {
  const majeure = Number(version.replace(/^v/, '').split('.')[0]);
  return Number.isFinite(majeure) && majeure >= NODE_MIN;
}

/** Les prochaines étapes, dans l'ordre où elles servent. */
export function prochainesEtapes(agent: string | null): string[] {
  return [
    'Lancer la ruche          :  npm run dev',
    'Ouvrir Mission Control   :  npm run dev:dashboard   (puis http://localhost:5173)',
    agent
      ? `Brancher votre agent     :  npm run node        (${agent} détecté)`
      : 'Brancher un agent        :  npm run node        (aucun agent détecté — le mode simulé prendra le relais)',
    'Inviter quelqu’un        :  npm run cli -- invite',
    'Voir une démo complète   :  npm run demo',
  ];
}
