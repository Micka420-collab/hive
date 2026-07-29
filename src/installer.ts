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
import { PORT_DASHBOARD_DEV } from './assistant.js';
import { LONGUEUR_MIN_SECRET_JWT, SECRET_JWT_INTERDIT } from './orchestrator/auth.js';
import { NODE_MINIMUM } from './shared/doctor.js';
import { MIN_TOKEN_LENGTH } from './shared/types.js';

/** Longueur du jeton engendré. Confortablement au-delà du minimum exigé. */
export const LONGUEUR_JETON = 32;

/**
 * Longueur du secret de session engendré.
 *
 * Plus long que le jeton de ruche : celui-ci se recopie à la main entre
 * machines, le secret de session ne quitte jamais le `.env` de l'hôte. Rien
 * n'oblige donc à le rendre court, et une clé HMAC-SHA256 mérite ses 64
 * caractères hexadécimaux.
 */
export const LONGUEUR_SECRET_SESSION = 64;

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
  secretSession = engendrerJeton(LONGUEUR_SECRET_SESSION),
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
      cle: 'HIVE_JWT_SECRET',
      valeur: garde('HIVE_JWT_SECRET', secretSession),
      commentaire:
        'Le secret qui signe les sessions des comptes. Propre à VOTRE ruche : quiconque le connaît ' +
        'peut se fabriquer la session de n’importe qui, administrateur compris. La ruche refuse de ' +
        'démarrer sans lui. Le changer déconnecte tout le monde — ce qui est justement ce qu’on veut ' +
        'faire le jour où on le croit sorti.',
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
    {
      cle: 'HIVE_RUNNER',
      valeur: garde('HIVE_RUNNER', 'off'),
      commentaire:
        'Autonomie réelle : off | on. C’est le commutateur de l’HÔTE — celui qui prête le ' +
        'temps-machine. Sur « on », les projets réglés en autonomie agissent seuls : ils ouvrent ' +
        'des conseils, créent des tâches, et dépensent. Le défaut est « off » : une ruche ' +
        'fraîchement installée ne se met pas à travailler toute seule pendant la nuit.',
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
  // Un `.env` qui a recopié l'ancien secret publié est aussi ouvert que s'il
  // n'en avait aucun. La ruche refusera de démarrer, mais autant l'apprendre
  // ici plutôt qu'au premier `npm run dev`.
  const secretSession = (reglages.find((r) => r.cle === 'HIVE_JWT_SECRET')?.valeur ?? '').trim();
  if (secretSession === SECRET_JWT_INTERDIT || secretSession.length < LONGUEUR_MIN_SECRET_JWT) {
    dits.push(
      'Votre HIVE_JWT_SECRET est vide, trop court, ou porte encore l’ancienne valeur publiée avec ' +
        `le code : n’importe qui pourrait se fabriquer la session de votre administrateur. Remplacez-le ` +
        `dans .env par au moins ${LONGUEUR_MIN_SECRET_JWT} caractères tirés au hasard — la ruche ` +
        'refusera de démarrer autrement.',
    );
  }
  // L'autonomie réelle dépense du temps-machine sans qu'on la regarde. Une
  // ruche qui l'aurait allumée sans que son hôte s'en souvienne travaillerait
  // toute la nuit ; le dire à l'installation est le dernier moment où
  // quelqu'un lit encore.
  if (reglages.find((r) => r.cle === 'HIVE_RUNNER')?.valeur === 'on') {
    dits.push(
      'HIVE_RUNNER est sur « on » : les projets réglés en autonomie AGIRONT seuls — conseils ' +
        'ouverts, tâches créées, temps-machine dépensé, sans que personne clique. Repassez-le à ' +
        '« off » dans .env si ce n’est pas ce que vous voulez.',
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

/**
 * Complète un `.env` existant SANS toucher à ce qu'il contient déjà.
 *
 * ─── LE DÉFAUT QUE CETTE FONCTION CORRIGE ────────────────────────────────────
 *
 * `installer-main.ts` régénérait le fichier ENTIER par `rendreEnv` dès qu'une
 * clé manquait. Les valeurs étaient bien préservées — c'était l'invariant, et
 * il tenait — mais l'ORDRE, les COMMENTAIRES et la mise en forme de l'humain
 * étaient remplacés par les nôtres. Quelqu'un qui avait rangé son `.env` à sa
 * façon, ou qui y avait noté pourquoi il avait mis telle valeur, retrouvait un
 * fichier réécrit.
 *
 * Conséquence mesurable : un `.env` écrit à la main n'était pas identique
 * octet pour octet après passage, donc l'idempotence exigée au §12 de la
 * mission était FAUSSE.
 *
 * Ici, les clés absentes sont AJOUTÉES EN FIN DE FICHIER, précédées de leur
 * explication, et rien d'autre n'est touché. Un fichier déjà complet est rendu
 * tel quel, au caractère près.
 */
export function completerEnv(contenu: string, reglages: readonly Reglage[]): string {
  const present = lireEnv(contenu);
  const manquants = reglages.filter((r) => !present.has(r.cle));
  if (manquants.length === 0) return contenu;

  const lignes: string[] = [];
  for (const r of manquants) {
    lignes.push(`# ${r.commentaire}`);
    lignes.push(`${r.cle}=${r.valeur}`);
    lignes.push('');
  }
  // Un fichier vide n'a pas besoin d'en-tête de section : c'est une création,
  // pas une complétion.
  const corps = contenu.trimEnd();
  if (corps === '') return lignes.join('\n');
  return `${corps}\n\n# ─── Complété par « npm run install:hive » ───\n${lignes.join('\n')}`;
}

/**
 * Version de Node exigée. **Le même nombre que partout ailleurs, et pas une
 * copie de plus.**
 *
 * ─── LA DIVERGENCE QUE CETTE LIGNE FERME ─────────────────────────────────────
 *
 * Ce nombre valait `20`, en dur, sous un commentaire qui affirmait « telle que
 * le `package.json` la déclare » — alors que le paquet déclare 24, comme
 * `NODE_MINIMUM`, comme `install.sh`, comme `install.ps1`. Un commentaire qui
 * ment sur la ligne qu'il décrit.
 *
 * Ce n'était pas cosmétique, et ça s'est vu en LANÇANT les deux chemins
 * d'installation sur la même machine (Node 22) :
 *
 *   · `sh install.sh`         → refus, code 2, « Hive exige 24 ou plus »
 *   · `npm run install:hive`  → « ✔ Node v22.22.2 (20 minimum) », .env écrit,
 *                                puis « Lancer la ruche : npm run dev »
 *
 * Le second chemin délivrait donc une installation « réussie » sur une machine
 * où `better-sqlite3` n'a pas de binaire prébuilt — c'est-à-dire exactement la
 * panne qui a fait naître l'image morte : une dépendance optionnelle écartée en
 * silence, et une ruche qui ne démarre pas sans que rien n'ait rougi.
 *
 * La garde `tests/installeurs.test.ts` existait déjà et s'intitulait « LE
 * PLANCHER DE NODE N'EXISTE QU'UNE FOIS — en quatre endroits ». Il y en avait
 * cinq. Une garde qui compte les copies doit les compter TOUTES.
 */
export const NODE_MIN = NODE_MINIMUM;

/** `true` si la version courante suffit. Prend « v24.11.0 » comme « 24.11.0 ». */
export function nodeSuffisant(version: string): boolean {
  const majeure = Number(version.replace(/^v/, '').split('.')[0]);
  return Number.isFinite(majeure) && majeure >= NODE_MIN;
}

/**
 * Ce qu'on dit à quelqu'un dont le Node est trop vieux.
 *
 * ─── POURQUOI CE TEXTE VIT DANS LE MODULE PUR ────────────────────────────────
 *
 * Il vivait au milieu du `main()` de l'installeur, avec sa commande de secours
 * écrite en dur : « nvm install 20 », alors que le plancher est 24. C'est LA
 * ligne que la personne bloquée copie — donc la commande exacte pour rester
 * bloquée — et c'était le seul endroit du plancher que rien ne pouvait
 * atteindre, puisque `installer-main.ts` LANCE l'installeur dès qu'on l'importe.
 *
 * Le sortir d'ici n'est pas un rangement : c'est ce qui rend la ligne
 * vérifiable. Une garde a bien fini par la voir, en RELISANT la source — et
 * elle rougissait alors sur le mot « nvm install 20 » écrit dans un
 * commentaire. Un test qui rougit sur un commentaire est un test qu'on
 * apprendra à contourner.
 */
export function messagePrerequisNode(version: string): string[] {
  return [
    `Node ${version} — la ruche exige ${NODE_MIN} ou plus.`,
    'Installez une version récente depuis https://nodejs.org, puis relancez.',
    `(Sur macOS/Linux, « nvm install ${NODE_MIN} » suffit si vous avez nvm.)`,
  ];
}

/** Les prochaines étapes, dans l'ordre où elles servent. */
export function prochainesEtapes(agent: string | null): string[] {
  return [
    'Lancer la ruche          :  npm run dev',
    // L'adresse vient de la MÊME constante que l'origine CORS proposée par
    // l'assistant. Écrite deux fois, elle a divergé une fois — et un écran
    // envoyait alors vers une adresse que l'autre venait d'interdire.
    `Ouvrir Mission Control   :  npm run dev:dashboard   (puis http://localhost:${PORT_DASHBOARD_DEV})`,
    agent
      ? `Brancher votre agent     :  npm run node        (${agent} détecté)`
      : 'Brancher un agent        :  npm run node        (aucun agent détecté — le mode simulé prendra le relais)',
    'Inviter quelqu’un        :  npm run cli -- invite',
    'Voir une démo complète   :  npm run demo',
  ];
}
