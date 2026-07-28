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
// et c'est ce qui rend les onze diagnostics testables un par un, y compris
// leurs cas « je ne sais pas » — qu'aucun test ne pourrait fabriquer si le
// module allait lire le disque lui-même.

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
  /** Version majeure de Node qui exécute la ruche. */
  nodeMajeur: number;
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
  port: {
    numero: number;
    libre: boolean;
    /** `true` = c'est NOTRE ruche ; `false` = un autre programme ; `null` = indéterminable. */
    parNous: boolean | null;
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
  /** Runtime d'isolement détecté (`docker`, `podman`), ou `null` si aucun. */
  isolement: string | null;
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
}

/** Version de Node exigée. Sous ce seuil, rien ne sert d'aller plus loin. */
export const NODE_MINIMUM = 20;

/** En dessous, l'espace de travail se remplira avant la fin d'un merge. */
export const ESPACE_MINIMUM_OCTETS = 500 * 1024 * 1024;

const go = (octets: number): string => `${(octets / (1024 * 1024 * 1024)).toFixed(1)} Go`;

/**
 * Les onze diagnostics, dans l'ordre où ils se réparent.
 *
 * L'ORDRE EST UNE INFORMATION, pas une présentation : Node d'abord, parce que
 * réparer un port quand on tourne sur Node 18 ne sert à rien. Qui lit de haut
 * en bas répare dans le bon sens.
 */
export function diagnostiquer(r: Releve): Diagnostic[] {
  return [
    nodeVersion(r),
    fichierEnv(r),
    jeton(r),
    port(r),
    base(r),
    dashboard(r),
    agent(r),
    isolement(r),
    websocket(r),
    reglages(r),
    espace(r),
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

// ─── Les onze ───────────────────────────────────────────────────────────────

function nodeVersion(r: Releve): Diagnostic {
  if (r.nodeMajeur >= NODE_MINIMUM) {
    return {
      cle: 'node_version',
      gravite: 'ok',
      constat: `Node ${r.nodeMajeur} (≥ ${NODE_MINIMUM} exigé)`,
      reparation: null,
    };
  }
  return {
    cle: 'node_version',
    gravite: 'bloquant',
    constat: `Node ${r.nodeMajeur} — la ruche exige ${NODE_MINIMUM} ou plus`,
    reparation: `nvm install ${NODE_MINIMUM} && nvm use ${NODE_MINIMUM}`,
  };
}

function fichierEnv(r: Releve): Diagnostic {
  if (!r.fichierEnv.present) {
    return {
      cle: 'env_present',
      gravite: 'bloquant',
      constat: 'aucun fichier .env',
      reparation: 'cp .env.example .env',
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
  return r.agent !== null
    ? { cle: 'agent', gravite: 'ok', constat: `agent détecté : ${r.agent}`, reparation: null }
    : {
        cle: 'agent',
        gravite: 'risque',
        constat: 'aucun agent de codage détecté — ce nœud ne pourra rien produire',
        reparation:
          'installez claude-code ou codex, ou fixez HIVE_AGENT=shell pour un nœud de test',
      };
}

function isolement(r: Releve): Diagnostic {
  return r.isolement !== null
    ? {
        cle: 'isolement',
        gravite: 'ok',
        constat: `bac à sable disponible : ${r.isolement}`,
        reparation: null,
      }
    : {
        cle: 'isolement',
        gravite: 'risque',
        constat: 'ni docker ni podman — les agents tourneront sans conteneur',
        reparation: 'installez podman (sans démon, sans root) ou docker',
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
    reparation: 'npm run dev  puis relancez `npm run cli -- doctor`',
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
