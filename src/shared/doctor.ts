// `hive doctor` — le module PUR.
//
// ─── CE QU'UN DOCTEUR DOIT FAIRE, ET QUE PERSONNE NE FAIT ────────────────────
//
// Quand une ruche ne démarre pas, la question n'est jamais « quelle est la
// valeur de tel réglage ». C'est : **qu'est-ce que je tape, maintenant, pour
// que ça marche ?**
//
// Un relevé qui dit « port 7777 occupé » est un thermomètre. Un docteur dit
// « le port 7777 est pris par un AUTRE programme — `lsof -i :7777` pour voir
// qui, ou changez `HIVE_PORT` ». La différence n'est pas cosmétique : sans la
// commande, la personne retourne chercher dans le README, et le diagnostic
// n'aura fait que nommer sa peine.
//
// D'où la forme de ce module : chaque verdict porte SA réparation, ou `null`
// quand il n'y a rien à réparer. Le champ n'est pas optionnel — on ne peut pas
// oublier de le remplir.
//
// ─── LA RÈGLE QUI TIENT TOUT LE RESTE ────────────────────────────────────────
//
//     CE QU'ON N'A PAS PU MESURER NE DOIT JAMAIS SE LIRE « TOUT VA BIEN ».
//
// Un docteur qui ne sait pas doit le DIRE. Les permissions d'un fichier ne se
// lisent pas de la même façon sur Windows ; savoir si le port est tenu par
// NOTRE processus demande des droits qu'on n'a pas toujours ; l'espace disque
// n'est pas toujours interrogeable. Dans tous ces cas, le relevé porte `null`,
// et `null` produit un verdict `inconnu` — jamais `ok`.
//
// C'est la même règle que partout ailleurs dans ce dépôt : une pull request
// qu'on n'a pas su lire le DIT au lieu de passer pour calme, et une surface de
// diff illisible ne compte pas comme un accord. Le silence rassurant est le
// pire des deux mensonges possibles, parce qu'il ne se corrige jamais.
//
// ─── POURQUOI CE MODULE EST PUR ──────────────────────────────────────────────
//
// Famille de `balance.ts`, `thermo.ts`, `gardiennes.ts` : aucune I/O, aucune
// horloge, aucun aléa. Le relevé des faits est ailleurs (`doctor-releve.ts`),
// et c'est ce qui rend les douze diagnostics testables un par un, y compris
// leurs cas « je ne sais pas » — qu'aucun test ne pourrait fabriquer si le
// module allait lire le disque lui-même.

import { LONGUEUR_MIN_SECRET_JWT } from '../orchestrator/auth.js';
import {
  commandeImage,
  raisonPeremption,
  type FraicheurImage,
} from '../node-client/empreinte-image.js';
import { MIN_TOKEN_LENGTH } from './types.js';

/**
 * Ce que vaut un verdict.
 *
 * · `bloquant` — la ruche ne peut pas fonctionner. On répare avant tout.
 * · `risque`   — elle fonctionne, mais quelque chose peut coûter cher.
 * · `inconnu`  — on n'a PAS PU regarder. Ce n'est pas `ok`, et c'est le point
 *                le plus important de ce fichier.
 * · `ok`       — vérifié, et bon.
 */
export type Gravite = 'bloquant' | 'risque' | 'inconnu' | 'ok';

export interface Diagnostic {
  /** Identifiant stable — c'est ce qu'une supervision surveille, pas le texte. */
  cle: string;
  gravite: Gravite;
  /** Ce qu'on a constaté, en clair. */
  constat: string;
  /**
   * LA COMMANDE EXACTE qui répare, ou `null` s'il n'y a rien à faire.
   *
   * Obligatoire dans le type, pas optionnel : un diagnostic sans réparation
   * doit être un choix écrit, jamais un oubli.
   */
  reparation: string | null;
}

// ─── Le relevé : les faits, tous déjà mesurés ───────────────────────────────
//
// Chaque `| null` est un « on n'a pas pu savoir » assumé, et il traverse
// jusqu'au verdict. Aucun de ces champs n'a de valeur par défaut : un défaut
// serait une mesure inventée.

export interface Releve {
  /** Version de Node qui exécute la ruche (`process.versions.node`, « 24.18.0 »). */
  versionNode: string;
  /**
   * Version de la glibc sous Linux (« 2.36 ») ; `null` ailleurs, sous musl, ou
   * si on n'a pas su la lire. Le binaire Linux de `better-sqlite3` 13 exige
   * `GLIBC_MINIMUM` : en dessous, il ne se charge pas.
   */
  glibc: string | null;
  fichierEnv: {
    present: boolean;
    lisible: boolean;
    /** Bits de permission POSIX ; `null` sur Windows, où l'ACL ne se lit pas ainsi. */
    permissions: number | null;
  };
  jeton: {
    present: boolean;
    longueur: number;
    /** Vaut la valeur d'exemple livrée avec le dépôt. */
    trivial: boolean;
  };
  /**
   * Le secret de session — celui qui signe les jetons d'administration.
   *
   * ─── POURQUOI IL MANQUAIT AU RELEVÉ, ET CE QUE ÇA COÛTAIT ──────────────────
   *
   * Un nouveau venu suivait le docteur À LA LETTRE : `cp .env.example .env`,
   * puis la commande qui engendre HIVE_TOKEN. Le docteur ne laissait plus AUCUN
   * ✘ réparable. Il tapait alors `npm run ruche` — « tout en une commande » —
   * et la Reine mourait à la seconde, sur une garde qu'aucun des douze
   * contrôles n'exerçait.
   *
   * Un docteur qui déclare la ruche saine à l'instant où elle ne peut pas
   * démarrer est pire qu'un docteur absent : il fait chercher ailleurs.
   */
  secretSession: {
    /** Utilisable au sens de `secretJwtDepuisEnv` : présent, long, et pas celui publié. */
    utilisable: boolean;
    longueur: number;
    /** Vaut le secret publié dans `.env.example`. */
    publie: boolean;
    /** En simulation, la Reine s'en tire un au démarrage : la garde ne mord pas. */
    simulation: boolean;
  };
  port: {
    numero: number;
    libre: boolean;
    /** `true` = c'est NOTRE ruche ; `false` = un autre programme ; `null` = indéterminable. */
    parNous: boolean | null;
  };
  /**
   * Les paquets dont SEULE la ruche complète a besoin — et qui peuvent manquer
   * sans que quoi que ce soit l'ait signalé.
   *
   * ─── POURQUOI CE RELEVÉ EXISTE ─────────────────────────────────────────────
   *
   * `fastify`, `@fastify/cors`, `@fastify/static` et `better-sqlite3` sont
   * déclarés OPTIONNELS, délibérément : un membre qui fait tourner un NŒUD n'a
   * besoin d'aucun des quatre. Mais « optionnel » a une conséquence que
   * personne ne voit passer — **si leur installation échoue, npm continue en
   * silence et sort en 0.**
   *
   * `better-sqlite3` ne publiait alors AUCUN binaire prébuilt : chaque
   * installation le COMPILAIT. Sur une machine Windows sans outillage C++ —
   * c'est-à-dire une machine Windows neuve — la compilation échouait, npm
   * disait « added 247 packages », et `hive start` mourait sur
   * `ERR_MODULE_NOT_FOUND`. Depuis la 13 (ADR 0013), le binaire N-API voyage
   * dans le paquet npm et ne se compile plus. Restent `--omit=optional`, un
   * npm sous 11.16 (Node sous `NODE_MINIMUM`), une glibc sous
   * `GLIBC_MINIMUM`, ou une plateforme sans binaire dans `prebuilds/`.
   *
   * Le docteur savait déjà que ça arrivait : `baseIntegre()` importe le module
   * PARESSEUSEMENT, en toutes lettres « pour que le docteur puisse tourner là
   * où le module natif n'a pas été compilé — c'est même un cas de panne
   * fréquent ». Il était donc conçu pour SURVIVRE à cette panne, et il n'en
   * disait rien. Le champ qui suit est ce qui manquait.
   */
  moteur: {
    /** Paquets de la ruche complète qui ne se chargent pas. Vide = tout est là. */
    manquants: string[];
    /** Pourquoi le premier d'entre eux ne se charge pas ; `null` s'ils sont tous là. */
    raison: string | null;
  };
  base: {
    presente: boolean;
    /** `PRAGMA integrity_check` ; `null` si on n'a pas pu l'ouvrir. */
    integre: boolean | null;
    inscriptible: boolean;
  };
  dashboardConstruit: boolean;
  /** Agent de codage détecté, ou `null` si aucun. */
  agent: string | null;
  /**
   * Les agents installés que leur CLI dit non connectés, sans clé posée
   * (`inventaireAgents`) : aucune ouvrière ne les fera travailler.
   */
  agentsNonConnectes: readonly { readonly agent: string; readonly detail: string }[];
  /** Le moteur d'isolement préféré qui répond (`podman`, `docker`, `bubblewrap`), ou `null`. */
  isolement: string | null;
  /**
   * L'image du bac dans les moteurs qui répondent — `null` quand aucun ne
   * répond. Un moteur sans l'image est un moteur que le nœud écartera : le
   * docteur ne peut pas le dire « disponible » sans l'avoir regardée.
   */
  imageBac: {
    image: string;
    /** Le premier moteur qui l'a ; `null` si aucun. */
    dans: string | null;
    /** Le premier moteur qui a répondu « absente » ; `null` si aucun ne l'a dit. */
    absenteDe: string | null;
    /** L'image par défaut, absente partout : la commande qui la construit. */
    construire: string | null;
    /**
     * Ce que l'étiquette de l'image dit d'elle dans `dans` (`fraicheurImage`)
     * — `null` sans image à juger : aucun moteur ne l'a, ou c'est bubblewrap.
     */
    fraicheur: FraicheurImage | null;
  } | null;
  /** Le WebSocket répond-il ? `null` si la ruche n'écoute pas — on ne peut pas conclure. */
  wsJoignable: boolean | null;
  reglages: {
    /** `HIVE_RUNNER` : l'autonomie fait travailler l'essaim toute seule. */
    runner: string;
    /** L'écoute est-elle ouverte au réseau (0.0.0.0) ? */
    bindPublic: boolean;
    /** `HIVE_GARDIENNES` : `off` supprime le contrôle d'entrée du nectar. */
    gardiennes: string;
    /** CORS à `*` : n'importe quelle page du web peut parler à la ruche. */
    corsOuvert: boolean;
  };
  espace: {
    /** Octets libres sur l'espace de travail ; `null` si non interrogeable. */
    octetsLibres: number | null;
    inscriptible: boolean;
  };
  /**
   * La découverte du réseau local — les DEUX consentements, lus comme la ruche
   * (`loadConfigFromEnv`) et le nœud (`main.ts`, `join.ts`) les lisent : seul
   * « 1 » allume.
   */
  decouverte: {
    /** `HIVE_DECOUVERTE=1` : la Reine liste les machines qui se signalent. */
    ruche: boolean;
    /** `HIVE_DECOUVRABLE=1` : cette machine se signale. */
    machine: boolean;
    /** L'écoute de la ruche ne reçoit que la machine elle-même (`boucleLocale`). */
    ecouteLocale: boolean;
  };
}

/**
 * Version de Node exigée. Sous ce seuil, rien ne sert d'aller plus loin.
 *
 * ─── POURQUOI 24, ET PAS 20 ──────────────────────────────────────────────────
 *
 * Ce n'est pas une préférence pour le neuf : c'est une panne d'installation en
 * moins, et la CI l'a mesurée sur le même commit. Sous Node 20,
 * `better-sqlite3` 12 ne trouvait aucun binaire pour cette ABI et retombait
 * sur `node-gyp` — sous Windows un ÉCHEC, le `node-gyp` d'npm 10 ne sachant
 * pas lire Visual Studio 2026.
 *
 * ─── POURQUOI 24.18, ET PAS 24 TOUT COURT ────────────────────────────────────
 *
 * `better-sqlite3` 13 (N-API, ADR 0013) livre ses binaires DANS le paquet npm,
 * mais garde un `binding.gyp` : npm en déduit un `node-gyp rebuild` implicite.
 * `package.json` le refuse (`allowScripts: { "better-sqlite3": false }`) —
 * et seul npm ≥ 11.16 lit ce refus. Node 24.0 à 24.17 embarquent npm 11.3 à
 * 11.13 (nodejs.org, `dist/index.json`) : sans python3 — un Windows neuf,
 * l'image `slim` —, la compilation y échoue, npm écarte la dépendance
 * optionnelle EN SILENCE et sort en 0. Mesuré : 72 paquets au lieu de 74, et
 * une Reine morte sur « Cannot find module ». 24.18.0 est le premier Node 24
 * livré avec npm 11.16.0.
 *
 * Le job CI `plancher` installe et démarre la ruche sous CETTE version exacte,
 * lue dans `engines.node` : le plancher ne peut plus reculer sans rougir.
 */
export const NODE_MINIMUM = '24.18.0';

/**
 * La glibc sous laquelle le binaire Linux de `better-sqlite3` 13 ne se charge
 * pas (`objdump -T` : `GLIBC_2.34`, `GLIBCXX_3.4.29`, x64 comme arm64).
 * Ubuntu 22.04 et Debian 12 l'ont ; Ubuntu 20.04 et Debian 11 (2.31), non.
 * Aucune compilation de secours : le script est refusé, et le binaire du
 * paquet est choisi dès qu'il existe.
 */
export const GLIBC_MINIMUM = '2.34';

/**
 * `true` si `version` vaut au moins `plancher`, champ par champ.
 *
 * Prend « v24.18.0 », « 24.18.0-nightly… » ou « 2.35 ». Une chaîne illisible
 * rend `false` : on ne déclare pas suffisante une version qu'on n'a pas lue.
 */
export function versionAuMoins(version: string, plancher: string): boolean {
  const champs = (v: string): number[] => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number);
  const vus = champs(version);
  const exiges = champs(plancher);
  for (const [i, exige] of exiges.entries()) {
    const vu = vus[i] ?? 0;
    if (!Number.isFinite(vu)) return false;
    if (vu !== exige) return vu > exige;
  }
  return true;
}

/** `true` si ce Node suffit à la ruche. Prend « v24.18.0 » comme « 24.18.0 ». */
export function nodeSuffisant(version: string): boolean {
  return versionAuMoins(version, NODE_MINIMUM);
}

/** Le majeur du plancher, pour `nvm install` : il tire le dernier 24, pas le 24.18.0 figé. */
export const NODE_MAJEUR = NODE_MINIMUM.split('.')[0] ?? NODE_MINIMUM;

/** En dessous, l'espace de travail se remplira avant la fin d'un merge. */
export const ESPACE_MINIMUM_OCTETS = 500 * 1024 * 1024;

const go = (octets: number): string => `${(octets / (1024 * 1024 * 1024)).toFixed(1)} Go`;

/**
 * Les quatorze diagnostics, dans l'ordre où ils se réparent.
 *
 * L'ORDRE EST UNE INFORMATION, pas une présentation : Node d'abord, parce que
 * réparer un port quand on tourne sur Node 18 ne sert à rien. Qui lit de haut
 * en bas répare dans le bon sens.
 *
 * `moteur` vient en DEUXIÈME pour la même raison : sans lui, la ruche ne
 * démarre pas du tout, et régler un CORS trop ouvert sur un programme qui ne
 * s'exécutera jamais est du temps perdu.
 */
export function diagnostiquer(r: Releve): Diagnostic[] {
  return [
    nodeVersion(r),
    moteur(r),
    fichierEnv(r),
    jeton(r),
    // Juste après le jeton : les deux secrets se posent dans le même fichier,
    // dans le même geste, et rien ne sert de réparer l'un sans l'autre.
    secretSession(r),
    port(r),
    base(r),
    dashboard(r),
    agent(r),
    isolement(r),
    websocket(r),
    reglages(r),
    espace(r),
    // En DERNIER : la découverte n'est jamais ce qui empêche une ruche de
    // tourner. Elle ne se signale que quand elle est demandée ET vouée à
    // l'échec ; sinon elle dit seulement comment l'allumer.
    decouverte(r),
  ];
}

/** Le pire verdict de la liste — ce qu'un code de sortie doit refléter. */
export function pire(diags: Diagnostic[]): Gravite {
  if (diags.some((d) => d.gravite === 'bloquant')) return 'bloquant';
  if (diags.some((d) => d.gravite === 'risque')) return 'risque';
  if (diags.some((d) => d.gravite === 'inconnu')) return 'inconnu';
  return 'ok';
}

/**
 * Code de sortie, pour la supervision qui branche `hive doctor` sur une alerte.
 *
 * `inconnu` sort en 0 : on n'a pas constaté de panne, et faire échouer un
 * script parce qu'on n'a pas su lire des permissions Windows rendrait la
 * commande inutilisable là où elle sert le plus.
 */
export function codeDeSortie(diags: Diagnostic[]): number {
  const p = pire(diags);
  if (p === 'bloquant') return 2;
  if (p === 'risque') return 1;
  return 0;
}

// ─── Les quatorze ───────────────────────────────────────────────────────────

function nodeVersion(r: Releve): Diagnostic {
  if (nodeSuffisant(r.versionNode)) {
    return {
      cle: 'node_version',
      gravite: 'ok',
      constat: `Node ${r.versionNode} (≥ ${NODE_MINIMUM} exigé)`,
      reparation: null,
    };
  }
  return {
    cle: 'node_version',
    gravite: 'bloquant',
    constat: `Node ${r.versionNode} — la ruche exige ${NODE_MINIMUM} ou plus (npm ≥ 11.16)`,
    reparation: `nvm install ${NODE_MAJEUR} && nvm use ${NODE_MAJEUR}`,
  };
}

/**
 * Les paquets sans lesquels `hive start` ne démarre pas.
 *
 * Exporté parce que le relevé les sonde et que le verdict les compte : deux
 * listes séparées finiraient par diverger, et le jour où elles divergent, le
 * docteur cherche un paquet que personne n'installe.
 */
export const RUCHE_COMPLETE = [
  'fastify',
  '@fastify/cors',
  '@fastify/static',
  'better-sqlite3',
] as const;

function moteur(r: Releve): Diagnostic {
  const manquants = r.moteur.manquants;
  if (manquants.length === 0) {
    return {
      cle: 'moteur',
      gravite: 'ok',
      constat: 'paquets de la ruche complète tous chargeables',
      reparation: null,
    };
  }
  // LES QUATRE D'UN COUP est la signature d'un `--omit=optional` assumé — le
  // README le documente comme une installation de NŒUD. Un binaire natif qui
  // ne se charge pas, lui, n'en emporte qu'un. Ce ne sont pas les mêmes gestes, donc ce ne sont
  // pas les mêmes phrases.
  if (manquants.length === RUCHE_COMPLETE.length) {
    return {
      cle: 'moteur',
      gravite: 'bloquant',
      constat: 'aucun paquet de la ruche complète — installation de nœud (`--omit=optional`)',
      reparation:
        'npm install --include=optional   (rien à faire si cette machine ne doit faire tourner qu’un nœud : `hive node`)',
    };
  }
  // « ne se charge pas », pas « introuvable » : sous une glibc trop vieille,
  // le paquet est LÀ et c'est son binaire qui refuse de se charger.
  const verbe = manquants.length > 1 ? 'ne se chargent pas' : 'ne se charge pas';
  return {
    cle: 'moteur',
    gravite: 'bloquant',
    constat:
      `${manquants.join(', ')} ${verbe} — la ruche ne démarrera pas` +
      (r.moteur.raison === null ? '' : ` (${r.moteur.raison})`),
    reparation: remedeMoteur(r),
  };
}

/**
 * Le geste qui répare un module de la ruche complète introuvable.
 *
 * ─── POURQUOI PLUS UN MOT D'OUTILLAGE C++ ────────────────────────────────────
 *
 * Ce remède envoyait installer Visual Studio Build Tools, `build-essential` et
 * `python3` : `better-sqlite3` 12 se compilait quand son binaire manquait.
 * La 13 ne se compile plus du tout — le script est refusé (`allowScripts`) et
 * le binaire vient du paquet. Installer un compilateur ne répare donc plus
 * rien, et `npm rebuild better-sqlite3` non plus : il ne lance aucun script.
 * Les vraies causes sont ailleurs, et chacune a son geste.
 */
function remedeMoteur(r: Releve): string {
  if (!r.moteur.manquants.includes('better-sqlite3')) return 'npm install --include=optional';
  if (r.glibc !== null && !versionAuMoins(r.glibc, GLIBC_MINIMUM)) {
    return (
      `glibc ${r.glibc} : le binaire de better-sqlite3 exige ${GLIBC_MINIMUM} ` +
      '(Ubuntu 22.04+, Debian 12+) — mettez le système à jour, ou lancez la ruche ' +
      'dans son image Docker (docs/INSTALLATION.md)'
    );
  }
  return (
    'npm install --include=optional   (s’il reste introuvable : npm ≥ 11.16 exigé, ' +
    `donc Node ≥ ${NODE_MINIMUM} — « nvm install ${NODE_MAJEUR} » ; ` +
    'sinon cette plateforme n’a pas de binaire better-sqlite3 — Linux, macOS, ' +
    'Windows en x64 ou arm64 seulement : lancez la ruche dans son image Docker)'
  );
}

/**
 * Le remède quand il n'y a pas de `.env` — et pourquoi ce n'est plus le `cp`.
 *
 * ─── CE QUE LE `cp` FAISAIT VRAIMENT ─────────────────────────────────────────
 *
 * Le docteur conseillait `cp .env.example .env`. Mesuré sur un clone vierge :
 * ce geste plante `HIVE_TOKEN=change-me` et `HIVE_JWT_SECRET=change-me` — les
 * valeurs publiées avec le code. Et l'installeur, lui, ne COMPLÈTE que les clés
 * ABSENTES : il répond alors « .env complété — vos valeurs sont intactes » et
 * laisse les deux marque-places en place. Sa prudence est juste, il ne peut pas
 * distinguer une valeur choisie d'une valeur recopiée.
 *
 * Autrement dit : **le premier remède du docteur était le geste qui désarmait
 * l'outil fait pour réparer.** Restaient deux modifications à la main dans un
 * fichier de quatre cents lignes, pour arriver là où une commande arrive.
 *
 * `npm run install:hive` crée le fichier, tire les deux secrets au hasard, et
 * pose les permissions à 0600. Sur un `.env` existant il ne touche à rien
 * qu'aux clés manquantes — le conseiller ici ne fait donc courir aucun risque
 * à qui l'aurait déjà rempli.
 */
const REMEDE_ENV_ABSENT = 'npm run install:hive';

function fichierEnv(r: Releve): Diagnostic {
  if (!r.fichierEnv.present) {
    return {
      cle: 'env_present',
      gravite: 'bloquant',
      constat: 'aucun fichier .env',
      reparation: REMEDE_ENV_ABSENT,
    };
  }
  if (!r.fichierEnv.lisible) {
    return {
      cle: 'env_present',
      gravite: 'bloquant',
      constat: '.env présent mais illisible',
      reparation: 'chmod 600 .env',
    };
  }
  if (r.fichierEnv.permissions === null) {
    // Windows : l'ACL ne se lit pas en bits POSIX. On ne prétend pas avoir
    // vérifié — c'est exactement le cas que la règle du fichier vise.
    return {
      cle: 'env_present',
      gravite: 'inconnu',
      constat: '.env lisible ; permissions non vérifiables sur cette plateforme',
      reparation: 'icacls .env  (vérifiez que seul votre compte y a accès)',
    };
  }
  // Un .env lisible par le groupe ou par tous laisse fuir le jeton de ruche
  // vers n'importe quel compte de la machine.
  const trop = (r.fichierEnv.permissions & 0o077) !== 0;
  return trop
    ? {
        cle: 'env_present',
        gravite: 'risque',
        constat: `.env lisible au-delà de votre compte (mode ${r.fichierEnv.permissions.toString(8).padStart(3, '0')})`,
        reparation: 'chmod 600 .env',
      }
    : { cle: 'env_present', gravite: 'ok', constat: '.env présent et privé', reparation: null };
}

/**
 * Le secret de session, treizième contrôle — et le plus tardif de tous.
 *
 * Il applique EXACTEMENT la règle de `createServer` : absent, plus court que
 * `LONGUEUR_MIN_SECRET_JWT`, ou égal à la valeur publiée. Pas une règle
 * approchante — la même, sinon le docteur redevient un avis sur un autre
 * programme que celui qui va tourner.
 */
function secretSession(r: Releve): Diagnostic {
  const REPARATION =
    "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" puis reportez-le dans .env (HIVE_JWT_SECRET)";

  if (r.secretSession.simulation) {
    // `HIVE_SIMULATION=1` : la Reine tire un secret au démarrage. Réclamer un
    // secret ici ferait rougir une démo qui marche — et un docteur qui se
    // plaint de ce qui va bien finit par n'être plus lu.
    return {
      cle: 'secret_session',
      gravite: 'ok',
      constat: 'HIVE_JWT_SECRET inutile en simulation — tiré au démarrage',
      reparation: null,
    };
  }
  if (r.secretSession.publie) {
    return {
      cle: 'secret_session',
      gravite: 'bloquant',
      constat: 'HIVE_JWT_SECRET est encore le secret d’exemple — il est public',
      reparation: REPARATION,
    };
  }
  if (!r.secretSession.utilisable) {
    return {
      cle: 'secret_session',
      gravite: 'bloquant',
      constat:
        r.secretSession.longueur === 0
          ? 'HIVE_JWT_SECRET absent — la Reine refusera de démarrer'
          : `HIVE_JWT_SECRET fait ${String(r.secretSession.longueur)} caractères — ${String(LONGUEUR_MIN_SECRET_JWT)} au minimum`,
      reparation: REPARATION,
    };
  }
  return {
    cle: 'secret_session',
    gravite: 'ok',
    constat: 'HIVE_JWT_SECRET solide',
    reparation: null,
  };
}

function jeton(r: Releve): Diagnostic {
  if (!r.jeton.present) {
    return {
      cle: 'jeton',
      gravite: 'bloquant',
      constat: 'HIVE_TOKEN absent',
      reparation:
        "node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\" puis reportez-le dans .env",
    };
  }
  if (r.jeton.trivial) {
    return {
      cle: 'jeton',
      gravite: 'bloquant',
      constat: 'HIVE_TOKEN est encore la valeur d’exemple — elle est publique',
      reparation:
        "node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\" puis reportez-le dans .env",
    };
  }
  if (r.jeton.longueur < MIN_TOKEN_LENGTH) {
    return {
      cle: 'jeton',
      gravite: 'bloquant',
      constat: `HIVE_TOKEN fait ${r.jeton.longueur} caractères — ${MIN_TOKEN_LENGTH} au minimum`,
      reparation:
        "node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\" puis reportez-le dans .env",
    };
  }
  return { cle: 'jeton', gravite: 'ok', constat: 'HIVE_TOKEN solide', reparation: null };
}

function port(r: Releve): Diagnostic {
  if (r.port.libre) {
    return {
      cle: 'port',
      gravite: 'ok',
      constat: `port ${r.port.numero} libre`,
      reparation: null,
    };
  }
  // LA DISTINCTION QUI COMPTE. « Occupé » tout court enverrait quelqu'un tuer
  // sa propre ruche, qui tournait très bien.
  if (r.port.parNous === true) {
    return {
      cle: 'port',
      gravite: 'ok',
      constat: `port ${r.port.numero} tenu par VOTRE ruche — elle tourne déjà`,
      reparation: null,
    };
  }
  if (r.port.parNous === false) {
    return {
      cle: 'port',
      gravite: 'bloquant',
      constat: `port ${r.port.numero} pris par un AUTRE programme`,
      reparation: `lsof -i :${r.port.numero}   (ou changez HIVE_PORT dans .env)`,
    };
  }
  return {
    cle: 'port',
    gravite: 'inconnu',
    constat: `port ${r.port.numero} occupé ; impossible de dire par qui`,
    reparation: `lsof -i :${r.port.numero}   (ou, sous Windows : netstat -ano | findstr :${r.port.numero})`,
  };
}

function base(r: Releve): Diagnostic {
  // SANS LE MOTEUR, CE DIAGNOSTIC N'A RIEN À DIRE — et surtout pas « ok ».
  //
  // C'était le mensonge le plus coûteux du docteur. Sur une machine Windows
  // neuve, où `better-sqlite3` n'a pas pu se compiler, il n'y a pas de base ;
  // la branche du dessous concluait donc « aucune base — elle sera créée au
  // premier démarrage », en vert. Or elle ne sera JAMAIS créée : il n'y aura
  // pas de premier démarrage. Le docteur rassurait précisément la personne
  // qu'il devait alerter.
  //
  // L'autre branche mentait aussi, plus discrètement : sans le moteur,
  // `integre` vaut `null`, et le verdict lisait « fichier verrouillé ? » en
  // proposant d'arrêter une ruche qui ne tourne pas.
  if (r.moteur.manquants.includes('better-sqlite3')) {
    return {
      cle: 'base',
      gravite: 'inconnu',
      constat: 'rien à dire de la base : le moteur SQLite ne se charge pas',
      reparation: 'réparez `moteur` d’abord — ce diagnostic redeviendra lisible ensuite',
    };
  }
  if (!r.base.presente) {
    // Pas une panne : une ruche neuve n'a pas encore de base.
    return {
      cle: 'base',
      gravite: 'ok',
      constat: 'aucune base — elle sera créée au premier démarrage',
      reparation: null,
    };
  }
  if (!r.base.inscriptible) {
    return {
      cle: 'base',
      gravite: 'bloquant',
      constat: 'base présente mais non inscriptible',
      reparation: 'chmod u+w data/hive.db  (et vérifiez le propriétaire du dossier data/)',
    };
  }
  if (r.base.integre === null) {
    return {
      cle: 'base',
      gravite: 'inconnu',
      constat: 'base présente ; intégrité non vérifiable (fichier verrouillé ?)',
      reparation: 'arrêtez la ruche puis relancez `npm run cli -- doctor`',
    };
  }
  if (!r.base.integre) {
    return {
      cle: 'base',
      gravite: 'bloquant',
      constat: 'base CORROMPUE (PRAGMA integrity_check)',
      reparation:
        'sqlite3 data/hive.db ".recover" > secours.sql  puis reconstruisez à partir de secours.sql',
    };
  }
  return { cle: 'base', gravite: 'ok', constat: 'base intègre et inscriptible', reparation: null };
}

function dashboard(r: Releve): Diagnostic {
  return r.dashboardConstruit
    ? { cle: 'dashboard', gravite: 'ok', constat: 'tableau de bord construit', reparation: null }
    : {
        cle: 'dashboard',
        gravite: 'risque',
        constat: 'tableau de bord non construit — la ruche tourne, mais sans écran',
        reparation: 'npm run build:dashboard',
      };
}

function agent(r: Releve): Diagnostic {
  // Un agent installé mais non connecté se DIT : taire Cursor parce qu'il n'a
  // pas d'ouvrière laisserait l'opérateur le chercher dans Mission Control.
  const ecartes = r.agentsNonConnectes;
  const nonConnectes = ecartes.map((n) => `${n.agent} non connecté`).join(', ');
  const remede = ecartes.length > 0 ? ecartes.map((n) => n.detail).join(' ') : null;
  if (r.agent !== null) {
    return {
      cle: 'agent',
      gravite: 'ok',
      constat: `agent détecté : ${r.agent}${nonConnectes ? ` · ${nonConnectes}` : ''}`,
      reparation: remede,
    };
  }
  return {
    cle: 'agent',
    gravite: 'risque',
    constat: nonConnectes
      ? `aucun agent de codage connecté (${nonConnectes}) — ce nœud ne pourra rien produire`
      : 'aucun agent de codage détecté — ce nœud ne pourra rien produire',
    reparation:
      remede ?? 'installez claude-code ou codex, ou fixez HIVE_AGENT=shell pour un nœud de test',
  };
}

function isolement(r: Releve): Diagnostic {
  if (r.isolement === null) {
    return {
      cle: 'isolement',
      gravite: 'risque',
      // « ni docker ni podman » était FAUX dans le cas le plus courant : le
      // client peut être installé et son SERVICE injoignable — un Docker
      // Desktop pas démarré, un démon arrêté. Le relevé, qui sonde
      // maintenant `info` et non `--version`, ne distingue pas les deux ; le
      // constat ne doit donc affirmer que ce qu'il sait — aucun bac à sable
      // ne RÉPOND — et la réparation couvre les deux causes. Bubblewrap y
      // figure : il est sondé comme le nœud l'éprouve (un bac vide), et sous
      // Linux c'est le bac le plus léger à obtenir.
      constat: 'aucun bac à sable ne répond — les agents tourneront sans conteneur',
      reparation:
        'démarrez le service (Docker Desktop, `systemctl start docker`), installez podman (sans démon, sans root) ou, sous Linux, bubblewrap',
    };
  }
  // ─── UN MOTEUR QUI RÉPOND N'EST PAS UN BAC PRÊT ──────────────────────────
  //
  // Sur une machine neuve, `docker info` répond et l'image par défaut n'est
  // construite nulle part : le docteur disait « ✔ bac à sable disponible »,
  // puis le nœud écartait ce moteur et se repliait en processus — ou, en
  // `exige`, refusait. Le verdict suit maintenant la règle du nœud
  // (`moteurPret`) : l'image doit être dans un moteur.
  const img = r.imageBac;
  if (img?.dans === 'bubblewrap') {
    // Bubblewrap n'a pas d'image : il monte le système de l'hôte en lecture
    // seule. Lui prêter celle du bac enverrait chercher une image qui n'existe pas.
    return {
      cle: 'isolement',
      gravite: 'ok',
      constat: 'bac à sable disponible : bubblewrap (sans image)',
      reparation: null,
    };
  }
  if (img?.dans) return imageDuBacPrete(img.dans, img.image, img.fraicheur);
  if (img?.construire) {
    return {
      cle: 'isolement',
      gravite: 'risque',
      constat:
        `${r.isolement} répond, mais l'image du bac (${img.image}) n'est construite dans aucun ` +
        'moteur — les agents tourneront sans conteneur',
      reparation: `${img.construire}  (depuis un clone du dépôt)`,
    };
  }
  if (img?.absenteDe) {
    // Une image NOMMÉE par l'opérateur : le nœud la télécharge au démarrage.
    return {
      cle: 'isolement',
      gravite: 'ok',
      constat: `bac à sable disponible : ${img.absenteDe} — image ${img.image} téléchargée au démarrage du nœud`,
      reparation: null,
    };
  }
  // Aucun moteur n'a su dire si l'image est là : on ne l'invente pas. (Un
  // relevé sans `imageBac` alors qu'un moteur répond n'est pas produit par
  // `relever` ; il reçoit le même verdict.)
  const image = img?.image ?? '<image du bac>';
  return {
    cle: 'isolement',
    gravite: 'inconnu',
    constat: `${r.isolement} répond, mais n'a rien dit de l'image du bac (${image})`,
    reparation: `${r.isolement} image inspect ${image}  — la réponse dit ce qui bloque`,
  };
}

/**
 * Le moteur `moteur` a l'image : est-ce celle que cette version de Hive
 * construirait ?
 *
 * ─── UNE IMAGE PRÉSENTE N'EST PAS UNE IMAGE À JOUR ───────────────────────────
 *
 * L'image par défaut se construit sur le nœud, et une mise à jour de Hive qui
 * change ses entrées ne la reconstruit pas : le docteur la disait
 * « disponible » pendant que le nœud servait celle d'avant. L'empreinte qu'elle
 * porte se compare maintenant à celle que l'installation attend — la même
 * phrase et la même commande qu'au démarrage du nœud.
 */
function imageDuBacPrete(
  moteur: string,
  image: string,
  fraicheur: FraicheurImage | null,
): Diagnostic {
  if (fraicheur?.etat === 'perimee') {
    return {
      cle: 'isolement',
      gravite: 'risque',
      constat:
        `bac à sable disponible : ${moteur}, mais son image ${image} est périmée ` +
        `(${raisonPeremption(fraicheur)}) — le nœud la garde, et le dit à chaque démarrage`,
      reparation: `${commandeImage(moteur)}  (depuis ce clone), puis relancez le nœud`,
    };
  }
  if (fraicheur?.etat === 'a_jour' || fraicheur?.etat === 'non_geree') {
    const note =
      fraicheur.etat === 'a_jour' ? 'à jour' : 'non gérée par Hive : sa fraîcheur vous revient';
    return {
      cle: 'isolement',
      gravite: 'ok',
      constat: `bac à sable disponible : ${moteur} (image ${image}, ${note})`,
      reparation: null,
    };
  }
  // Rien à quoi comparer : on ne déclare pas à jour ce qu'on n'a pas comparé.
  return {
    cle: 'isolement',
    gravite: 'inconnu',
    constat:
      `bac à sable disponible : ${moteur} (image ${image}), mais sa fraîcheur n'a pas pu être ` +
      'vérifiée : les entrées de l’image (docker/agents) manquent à cette installation',
    reparation:
      'hive doctor <chemin du clone qui construit l’image>  — il sait ce qu’elle doit porter',
  };
}

function websocket(r: Releve): Diagnostic {
  if (r.wsJoignable === true) {
    return { cle: 'websocket', gravite: 'ok', constat: 'WebSocket joignable', reparation: null };
  }
  if (r.wsJoignable === false) {
    // LE POINT DE PANNE QUI NE SE VOIT PAS : l'API répond, l'écran s'affiche,
    // et rien ne bouge jamais. Sans ce diagnostic, on cherche du côté du code.
    return {
      cle: 'websocket',
      gravite: 'bloquant',
      constat: 'HTTP répond mais le WebSocket est refusé — l’écran restera figé',
      reparation:
        'vérifiez qu’aucun proxy ne coupe l’Upgrade (nginx : proxy_set_header Upgrade $http_upgrade)',
    };
  }
  return {
    cle: 'websocket',
    gravite: 'inconnu',
    constat: 'ruche éteinte — le WebSocket n’a pas pu être essayé',
    // `ruche`, pas `dev` : la commande unique que l'installeur et le README
    // conseillent — `dev` n'allumerait que la Reine.
    reparation: 'npm run ruche  puis relancez `npm run cli -- doctor`',
  };
}

function reglages(r: Releve): Diagnostic {
  // Chacun de ces trois est légitime QUELQUE PART. Ce qu'on signale, c'est
  // qu'ils sont allumés — pas qu'ils sont fautifs. Un docteur qui crie sur un
  // choix délibéré apprend à être ignoré.
  const allumes: string[] = [];
  if (r.reglages.runner === 'on') allumes.push('HIVE_RUNNER=on (l’essaim travaille seul)');
  if (r.reglages.bindPublic) allumes.push('écoute ouverte au réseau');
  if (r.reglages.gardiennes === 'off')
    allumes.push('HIVE_GARDIENNES=off (aucun contrôle d’entrée)');
  if (r.reglages.corsOuvert) allumes.push('CORS à * (n’importe quelle page peut appeler la ruche)');

  if (allumes.length === 0) {
    return { cle: 'reglages', gravite: 'ok', constat: 'aucun réglage risqué', reparation: null };
  }
  return {
    cle: 'reglages',
    gravite: 'risque',
    constat: `réglages à surveiller : ${allumes.join(' · ')}`,
    reparation: 'relisez ces lignes de .env — chacune est un choix, assurez-vous de l’avoir fait',
  };
}

function espace(r: Releve): Diagnostic {
  if (!r.espace.inscriptible) {
    return {
      cle: 'espace',
      gravite: 'bloquant',
      constat: 'espace de travail non inscriptible',
      reparation: 'chmod u+w .hive-work  (ou changez HIVE_WORKDIR)',
    };
  }
  if (r.espace.octetsLibres === null) {
    return {
      cle: 'espace',
      gravite: 'inconnu',
      constat: 'espace de travail inscriptible ; place libre non mesurable',
      reparation: 'df -h .   (ou, sous Windows : fsutil volume diskfree C:)',
    };
  }
  if (r.espace.octetsLibres < ESPACE_MINIMUM_OCTETS) {
    return {
      cle: 'espace',
      gravite: 'bloquant',
      constat: `${go(r.espace.octetsLibres)} libres — un clone de dépôt ne tiendra pas`,
      reparation: 'libérez de la place, ou pointez HIVE_WORKDIR vers un disque plus grand',
    };
  }
  return {
    cle: 'espace',
    gravite: 'ok',
    constat: `${go(r.espace.octetsLibres)} libres`,
    reparation: null,
  };
}

function decouverte(r: Releve): Diagnostic {
  const d = r.decouverte;
  // LE SEUL CAS QUI MÉRITE ⚠ : on a demandé à la ruche de lister les machines
  // du réseau, mais elle n'écoute que sur elle-même. Chaque « Rejoindre »
  // enverrait un billet vers une adresse où personne ne répond — la ruche le
  // refuse d'ailleurs (`inviteInjoignable`), et c'est ICI qu'on apprend
  // pourquoi, avant d'avoir cliqué.
  if (d.ruche && d.ecouteLocale) {
    return {
      cle: 'decouverte',
      gravite: 'risque',
      constat:
        'HIVE_DECOUVERTE=1, mais la ruche n’écoute que sur cette machine : une machine découverte ne pourra pas la joindre',
      reparation:
        'HIVE_HOST=0.0.0.0 dans .env (l’écoute s’ouvre au réseau local), puis relancez la ruche',
    };
  }
  if (d.ruche || d.machine) {
    const allumes: string[] = [];
    if (d.ruche) allumes.push('la ruche liste les machines du réseau local (HIVE_DECOUVERTE=1)');
    if (d.machine) {
      allumes.push(
        'cette machine se signale (HIVE_DECOUVRABLE=1 : nom, système, agents connectés, places, état — rien d’autre)',
      );
    }
    return { cle: 'decouverte', gravite: 'ok', constat: allumes.join(' · '), reparation: null };
  }
  // Désactivée — le défaut. Rien à RÉPARER (une ruche saine ne porte aucune
  // réparation : un docteur qui trouve toujours quelque chose apprend à être
  // ignoré), mais un chemin à connaître : le constat le nomme, parce que le
  // docteur est l'endroit où on le cherche.
  return {
    cle: 'decouverte',
    gravite: 'ok',
    constat:
      'découverte du réseau local désactivée (défaut) — HIVE_DECOUVERTE=1 sur la ruche pour lister les machines, `hive join --decouvrable` sur celle à ajouter',
    reparation: null,
  };
}
