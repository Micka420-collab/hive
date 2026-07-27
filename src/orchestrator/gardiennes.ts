// Les Gardiennes — le contrôle d'entrée du nectar.
//
// Chez l'abeille, les gardiennes postées au trou de vol reniflent chaque
// butineuse de retour et refusent celle qui ne rapporte pas l'odeur de la ruche.
// Ici : AUCUNE production n'entre dans le rayon sur la seule parole de
// l'ouvrière.
//
// LE PROBLÈME, tel qu'il se lit dans le code. Un nœud remonte `task_result`
// (node-client/client.ts) avec un `diff` que l'adaptateur n'a pas fourni et que
// `workspace.collectDiff()` a calculé — ou pas. Le Scheduler
// (`handleTaskResult`) ne regarde que `result.success`. Un `success: true`
// accompagné d'un diff VIDE (ou d'un diff qui ne touche aucun fichier promis)
// était donc traité comme un succès plein, et il :
//   - fabriquait un souvenir Hive Mind (`summarizeTask`) qui pollue la mémoire
//     collective POUR TOUJOURS (le corpus n'est élagué qu'à 2 000, et un
//     souvenir creux est indistinguable d'un vrai) ;
//   - déposait une phéromone POSITIVE (+10) sur le couple nœud × domaine, donc
//     orientait les tâches suivantes vers l'ouvrière qui ment le mieux ;
//   - créditait du nectar au Waggle Board (`task_done` → +10 points) ;
//   - comptait en `utile` dans La Balance (`posteDe`, tentative RETENUE).
// C'est un problème qui EMPIRE avec le temps : chaque succès creux rend la
// mémoire et le routage un peu plus faux, et rien ne les corrige jamais.
//
// CE MODULE EST PUR — famille de balance.ts, thermo.ts, pheromones.ts. Aucune
// I/O, aucun aléa, aucune horloge : pas même en paramètre, parce qu'une
// inspection ne dépend pas de l'heure qu'il est. Il INSPECTE et rend des GRIEFS
// typés ; il ne DÉCIDE de rien. Ce qu'on fait d'un verdict (annoter, refuser)
// appartient au Scheduler, et dépend d'un interrupteur à trois positions dont
// le défaut n'est PAS contraignant.
//
// ─── DOCTRINE — ce qui engage ce fichier ────────────────────────────────────
//
// 1. RÈGLE 1 DE LA BALANCE (aucune vue dérivée matérialisée) : l'inspection est
//    une fonction pure… mais son résultat, LUI, est persisté. Ce n'est pas une
//    entorse, c'est l'inverse : le verdict N'EST PAS RECALCULABLE plus tard.
//    `pruneResults` VIDE `diff` et `logs` au-delà de 5 000 résultats (la ligne
//    survit, les colonnes lourdes non). Un verdict recalculé après coup sur un
//    diff vidé par l'élagage dirait « diff vide » de TOUTES les productions
//    anciennes — un mensonge à retardement, et le pire genre : il aurait l'air
//    d'un fait. Le verdict se calcule donc À LA RÉCEPTION du résultat et se
//    range immédiatement (`gardiennes`, store.ts). C'est un FAIT DATÉ, pas un
//    cache : rien ne peut le reconstruire, et c'est précisément pour ça qu'il
//    s'écrit.
//
// 2. AUCUNE MIGRATION (règle 2). La table `gardiennes` est NEUVE
//    (`CREATE TABLE IF NOT EXISTS`) : pas une colonne de plus sur `results`, pas
//    un `ALTER TABLE`, et surtout AUCUNE modification d'un index existant.
//    Ajouter `verdict` au SELECT des phéromones aurait fait retomber
//    SILENCIEUSEMENT toutes les bases en service hors de l'index couvrant
//    `idx_results_recent` — `CREATE INDEX IF NOT EXISTS` ne redéfinit PAS un
//    index déjà présent. Une table latérale coûte moins cher qu'une colonne
//    ajoutée, pour toujours.
//
// 3. BORNE D'ÉLAGAGE DANS LE MÊME COMMIT (règle 3). `gardiennes` grandit avec
//    l'histoire de la ruche : elle n'est PAS bornée par construction, donc elle
//    arrive avec `pruneGardiennes` (store.ts), aligné sur EVENT_RETENTION et
//    RESULT_RETENTION — les trois racontent la même histoire récente, et un
//    verdict dont le diff et les logs ont été vidés a de toute façon perdu ses
//    pièces à conviction.
//
// 4. LE MODE D'ÉCHEC NUIT. Un faux positif brûle une tentative LÉGITIME : c'est
//    strictement pire que le mal qu'on soigne. Trois conséquences, toutes
//    visibles dans le code ci-dessous :
//    a) l'interrupteur par défaut est `consultatif` — on observe et on annote
//       longtemps avant de contraindre ;
//    b) un seul grief est assez lourd pour refuser à lui seul (`empty_diff`,
//       poids 3) ; les trois autres pèsent 2 ou 1, donc `surface_missed`
//       (le plus heuristique) ne refuse JAMAIS seul ;
//    c) chaque détecteur s'abstient dès qu'il ne peut pas conclure : sans dépôt
//       git, `collectDiff()` rend TOUJOURS '' (workspace.ts) et AUCUN grief de
//       diff n'est levé ; sans promesse de modification, un diff vide n'est pas
//       un grief ; un diff binaire ou de simple renommage ne « nomme » aucun
//       fichier et n'est pas pour autant malformé.
//
// 5. LE COÛT EST PAYÉ UNE FOIS PAR PRODUCTION, JAMAIS PAR TICK. Une inspection
//    lit le diff (≤ 1 Mo) et les logs (≤ 512 ko) UNE seule fois chacun :
//    14,6 ms mesurées dans le pire cas absolu du protocole (560 ko de logs
//    + 480 ko de diff, ~7 000 et ~16 000 lignes), à peu près moitié-moitié
//    entre les deux. C'est l'ordre de grandeur de l'insertion SQLite du même
//    résultat, et cela n'arrive qu'à la RÉCEPTION d'un succès déclaré — jamais
//    sur le chemin du tick, jamais par tâche prête, jamais dans une route de
//    lecture. La différence avec les 160 ms toutes les 3 s qu'avait relevées
//    l'audit de la Balance est de nature, pas de degré : là c'était une lecture
//    périodique NON BORNÉE, ici c'est un travail proportionnel à un octet qui
//    vient d'arriver et qu'on écrit de toute façon.
//
// 6. LES GARDIENNES NE MERGENT RIEN ET N'APPROUVENT RIEN. Le merge reste un
//    geste humain explicite. Elles refusent l'ENTRÉE au rayon, c'est tout — et
//    un verdict `clean` ne dit PAS que le travail est bon : il dit que la ruche
//    n'a pas attrapé la butineuse en flagrant délit de retour à vide. La revue
//    humaine (la Miellerie) reste entière.

import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import { extraitDesLogs, lignesDeLogs } from './brood.js';
import { parseDiff } from './honeycomb.js';
import type { Range } from './honeycomb.js';
import { extractPaths } from './sting-detector.js';

/**
 * Version de l'algorithme d'inspection. Toute ligne rangée la porte : une v2
 * (nouveaux griefs, nouveaux poids) se distinguera des lignes v1 sans migration
 * ni corpus corrompu — exactement le motif de VERSION_BALANCE.
 */
export const VERSION_GARDIENNES = 1;

/** Interrupteur à trois positions. Défaut `consultatif` — voir doctrine, règle 4. */
export type ModeGardiennes = 'off' | 'consultatif' | 'strict';

/**
 * Code d'un grief. EN ANGLAIS snake_case, comme les types d'événements : ce
 * sont des CLÉS DE CORPUS, pas de la prose. Elles sont persistées et vivront
 * plus longtemps que ce code ; le texte bilingue affiché est reconstruit depuis
 * elles, il n'est jamais rangé.
 *
 * - `empty_diff`      : succès déclaré, diff VIDE, alors que la tâche portait
 *                       une promesse de modification. `compte` = nombre de
 *                       chemins promis (0 si la promesse venait d'un verbe).
 * - `surface_missed`  : le diff touche des fichiers, mais AUCUN de ceux que le
 *                       prompt annonçait. `compte` = fichiers réellement
 *                       touchés ; `chemins` = les promesses non tenues.
 * - `malformed_diff`  : ce qui remonte n'est pas un diff applicable — du texte
 *                       qui ne nomme aucun fichier, ou des hunks orphelins
 *                       (`@@` sans en-tête de fichier). `compte` = hunks
 *                       orphelins.
 * - `logs_contradict` : les logs CRIENT l'échec alors que `success: true`.
 *                       `compte` = lignes qui crient ; `extrait` = la matière
 *                       (déjà neutralisée).
 */
export type CodeGrief = 'empty_diff' | 'surface_missed' | 'malformed_diff' | 'logs_contradict';

/**
 * Verdict d'entrée. Trois valeurs, et pas deux : un binaire aurait forcé chaque
 * grief à être soit décisif, soit décoratif. `suspect` est la place des signaux
 * réels mais heuristiques — visibles, comptés, et sans conséquence.
 */
export type Verdict = 'clean' | 'suspect' | 'hollow';

/**
 * Poids de chaque grief. Le barème EST la politique de faux positifs (doctrine,
 * règle 4b) :
 *  - `empty_diff` (3) refuse à lui seul. C'est le mensonge central que ce
 *    module existe pour attraper, et il ne se lève que lorsque les trois
 *    conditions sont réunies : un dépôt d'où un diff PEUT sortir, une promesse
 *    de modification, et zéro octet rapporté.
 *  - `malformed_diff` (2) et `surface_missed` (2) ne refusent JAMAIS seuls :
 *    un prompt qui cite `package.json` en passant pendant que le vrai travail
 *    est ailleurs produirait `surface_missed` sur une production parfaitement
 *    honnête. Deux poids 2 ne peuvent pas coexister (un diff est soit
 *    exploitable, soit non) : il faut donc un grief DE PLUS pour atteindre le
 *    seuil.
 *  - `logs_contradict` (1) est un appoint : il fait basculer un diff douteux,
 *    il ne condamne pas un diff propre dont les logs contiennent le mot
 *    « error ».
 */
export const POIDS: Record<CodeGrief, number> = {
  empty_diff: 3,
  surface_missed: 2,
  malformed_diff: 2,
  logs_contradict: 1,
};

/** À partir de ce score, la production est jugée CREUSE. */
export const SEUIL_CREUSE = 3;

/** Chemins cités par un grief : assez pour comprendre, jamais un dépliage. */
const MAX_CHEMINS = 5;

/**
 * Longueur maximale d'un chemin cité. Le motif de `extractPaths` accepte un
 * nombre QUELCONQUE de segments de répertoire : sur un prompt de 100 ko
 * (LIMITS.prompt), un « chemin » de plusieurs dizaines de kilo-octets est
 * syntaxiquement possible. Comme les griefs sont PERSISTÉS, cette borne est ce
 * qui garantit qu'une ligne de garde reste petite — et donc que la lecture de
 * la table (un parcours arrière de clé primaire, borné par un LIMIT) reste
 * bon marché.
 */
const MAX_LONGUEUR_CHEMIN = 160;

/** Longueur maximale de l'extrait de logs d'un grief. */
const EXTRAIT_MAX = 240;

/** Corpus BORNÉ de la vue dérivée (motif CORPUS_BALANCE). */
export const CORPUS_GARDIENNES = 500;

/** Inspections détaillées rendues par la vue dérivée. */
export const MAX_RECENTES = 20;

/** Un reproche typé, adressé à une production. Des faits, jamais une phrase. */
export interface Grief {
  code: CodeGrief;
  /** Recopié de POIDS : une ligne rangée reste lisible même si le barème change. */
  poids: number;
  /** Nombre d'éléments en cause — le sens est donné par `code`. */
  compte: number;
  /** Chemins en cause, en minuscules, bornés à MAX_CHEMINS et triés. */
  chemins: string[];
  /**
   * Extrait de logs, DÉJÀ passé par `champSurUneLigne` (délimiteur de bloc
   * neutralisé, une seule ligne, borné). Vide si le grief n'en cite pas.
   *
   * ⚠ C'est une DONNÉE D'AGENT. Ce pré-nettoyage est de la défense en
   * profondeur, PAS un laissez-passer : le jour où un grief entre dans le
   * contexte d'une ouvrière, il passe par `blocDonnees`
   * (src/shared/donnees-non-fiables.ts), comme la Couveuse et le Hive Mind.
   * Aujourd'hui, aucun grief n'entre dans un prompt.
   */
  extrait: string;
}

/** Ce qu'une gardienne renifle : la promesse, et ce qui rentre au trou de vol. */
export interface Production {
  /** Titre de la tâche — la promesse, moitié 1. */
  titre: string;
  /** Prompt de la tâche — la promesse, moitié 2. */
  prompt: string;
  /** Ce que l'ouvrière DÉCLARE. Toute la question est là. */
  success: boolean;
  diff: string;
  logs: string;
  /**
   * Le projet a-t-il un dépôt d'où un diff peut seulement sortir ? Sans dépôt,
   * `prepareWorkspace` ne crée pas de git et `collectDiff()` rend TOUJOURS ''
   * (node-client/workspace.ts) : juger un diff vide y serait un faux positif
   * SYSTÉMATIQUE, sur 100 % des tâches du projet. Les Gardiennes s'abstiennent
   * alors de tout grief de diff — et le disent (`examen.diffPossible`).
   */
  depotGit: boolean;
}

/** Ce que la garde a réellement pu examiner — transparence (motif `Pesee.corpus`). */
export interface Examen {
  /** La tâche portait-elle une promesse de modification ? */
  promesse: boolean;
  /** Un diff pouvait-il seulement exister (dépôt git présent) ? */
  diffPossible: boolean;
  /** Chemins que le prompt annonçait. */
  cheminsPromis: number;
  /** Fichiers que le diff nomme réellement. */
  fichiersTouches: number;
  diffOctets: number;
  logsOctets: number;
}

/** Le verdict d'entrée d'une production, et ce qui le motive. */
export interface Inspection {
  version: typeof VERSION_GARDIENNES;
  verdict: Verdict;
  /** Somme des poids des griefs. Comparable à SEUIL_CREUSE. */
  score: number;
  /** Triés par poids décroissant, puis par code — ordre stable. */
  griefs: Grief[];
  examen: Examen;
}

// ─── La promesse ────────────────────────────────────────────────────────────

/**
 * Racines de verbes de MODIFICATION (FR/EN), comparées sur un texte NORMALISÉ
 * (minuscules, sans accents), en MOT ENTIER avec tolérance de suffixe. Toutes
 * font au moins 4 caractères : la tolérance de 6 lettres finales ne peut pas y
 * créer de collision.
 */
const RACINES_MODIFICATION = [
  'ajout',
  'chang',
  'corrig',
  'creat',
  'cree',
  'delet',
  'ecri',
  'edit',
  'implement',
  'migrat',
  'modif',
  'patch',
  'refactor',
  'remov',
  'remplac',
  'renam',
  'renomm',
  'replac',
  'supprim',
  'updat',
  'writ',
] as const;

/**
 * Formes qui n'entrent pas dans le moule « racine + suffixe » :
 *  - les verbes trop COURTS, énumérés pour ne pas mordre trop large
 *    (« address » n'est pas « add », « fixture » n'est pas « fix ») ;
 *  - les locutions françaises, où le verbe ne porte pas le sens à lui seul
 *    (« mettre à jour » — sans elle, la moitié des prompts de maintenance
 *    rédigés en français n'annonçaient aucune modification).
 */
const VERBES_COURTS = [
  'add(?:s|ed|ing)?',
  'fix(?:e?[sd]|ing|es)?',
  'm(?:ettre|et|ise|ises)\\s+a\\s+jour',
] as const;

const MOTIF_MODIFICATION = new RegExp(
  `(?<![a-z0-9-])(?:${[
    ...RACINES_MODIFICATION.map((racine) => `${racine}[a-z]{0,6}`),
    ...VERBES_COURTS,
  ].join('|')})(?![a-z0-9-])`,
);

/** Réduit un texte à une forme comparable : minuscules, sans accents. */
function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase();
}

/**
 * Chemins que la tâche ANNONCE toucher, en MINUSCULES et triés.
 *
 * ⚠ PIÈGE VÉRIFIÉ. `extractPaths` (sting-detector.ts) rend ses chemins en
 * MINUSCULES (`m[0].toLowerCase()`, l. 62) : comparer naïvement cet ensemble
 * aux chemins d'un diff — qui, eux, gardent leur casse d'origine — déclarerait
 * « surface non tenue » sur `src/Orchestrator/Gardiennes.ts` alors que le
 * fichier promis est EXACTEMENT celui qui a été modifié. Sur un dépôt
 * TypeScript à noms de fichiers en camelCase ou PascalCase, c'était un faux
 * positif quasi systématique — donc, en `strict`, une tentative légitime
 * brûlée. Toute comparaison passe par `normaliserChemin`, des deux côtés.
 */
export function cheminsPromis(titre: string, prompt: string): string[] {
  return [...extractPaths(`${titre} ${prompt}`)].sort();
}

/**
 * La tâche promettait-elle une modification ? Deux signaux, dans l'ordre de
 * force : elle NOMME un fichier, ou elle emploie un verbe de modification.
 * Sinon, on ne sait pas — et « on ne sait pas » ne lève aucun grief : une tâche
 * « lance la suite de tests et rapporte » n'a rien à modifier, et un diff vide
 * y est le résultat NORMAL.
 */
export function promesseDeModification(titre: string, prompt: string): boolean {
  if (extractPaths(`${titre} ${prompt}`).size > 0) return true;
  return MOTIF_MODIFICATION.test(normaliser(`${titre} ${prompt}`));
}

// ─── La surface ─────────────────────────────────────────────────────────────

/** Forme comparable d'un chemin : séparateurs `/`, minuscules (voir le piège). */
function normaliserChemin(chemin: string): string {
  return chemin.replace(/\\/g, '/').toLowerCase();
}

/**
 * Fichiers que le diff nomme réellement, normalisés, dédoublonnés et triés.
 * `parseDiff` (honeycomb.ts) sait déjà lire un diff unifié : il rend le chemin
 * de BASE (côté `--- a/…`), et ne retombe sur le nouveau chemin que pour une
 * CRÉATION (`--- /dev/null`) — donc les créations comptent, ce qui est
 * exactement ce dont les Gardiennes ont besoin.
 */
export function fichiersTouches(diff: string): string[] {
  return cheminsDePlages(parseDiff(diff));
}

/**
 * Même chose, à partir d'un diff DÉJÀ analysé. `inspecter` s'en sert pour ne
 * payer `parseDiff` qu'UNE fois : un diff pèse jusqu'à 1 Mo (LIMITS.diff) et
 * l'inspection tombe sur le chemin d'un résultat, pas dans une page de lecture.
 */
function cheminsDePlages(plages: ReadonlyMap<string, Range[]>): string[] {
  return [...new Set([...plages.keys()].map(normaliserChemin))].sort();
}

/**
 * La promesse `promis` est-elle tenue par l'un des fichiers touchés ?
 *
 * Trois formes acceptées, volontairement PERMISSIVES — le doute profite à
 * l'ouvrière (doctrine, règle 4) :
 *  - égalité stricte (`src/a.ts` promis, `src/a.ts` touché) ;
 *  - la promesse est un SUFFIXE du chemin touché : un prompt qui dit
 *    « gardiennes.ts » est tenu par `src/orchestrator/gardiennes.ts` ;
 *  - le chemin touché est un suffixe de la promesse : un diff calculé depuis un
 *    sous-répertoire rend des chemins plus courts que ceux du prompt.
 */
function tenue(promis: string, touches: readonly string[]): boolean {
  return touches.some((t) => t === promis || t.endsWith(`/${promis}`) || promis.endsWith(`/${t}`));
}

// ─── Le diff lui-même ───────────────────────────────────────────────────────

/** En-tête de hunk unifié — MÊME motif que `parseDiff`, ancré en début de ligne. */
const MOTIF_HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/** Un vrai diff git s'annonce. Sert à ne PAS crier au diff malformé (voir plus bas). */
const MOTIF_ENTETE_GIT = /^diff --git /m;

/**
 * Hunks que `parseDiff` a vus passer sans savoir à quel fichier les rattacher.
 * Un `@@` orphelin, c'est un diff qui ne s'applique pas : `git apply` le
 * refuserait, et le Honeycomb Merge le compterait pour rien.
 *
 * Une ligne de CONTENU ne peut pas être confondue avec un en-tête de hunk :
 * dans un diff unifié, tout contenu est préfixé par ' ', '+' ou '-', donc ne
 * commence jamais par « @@ ».
 */
function hunksOrphelins(diff: string, plages: ReadonlyMap<string, Range[]>): number {
  let reconnus = 0;
  for (const p of plages.values()) reconnus += p.length;
  let bruts = 0;
  for (const ligne of diff.split('\n')) {
    if (MOTIF_HUNK.test(ligne)) bruts += 1;
  }
  return Math.max(0, bruts - reconnus);
}

// ─── Les logs qui crient ────────────────────────────────────────────────────

/**
 * Motifs d'échec DURS : des sorties qu'un travail réussi ne produit pas.
 *
 * Volontairement ÉTROITS, à l'inverse du `MOTIF_ERREUR` de la Couveuse
 * (`/error|erreur|échec|failed|exception|traceback|assert/i`) : celui-ci est
 * parfait pour CHOISIR les lignes à montrer à l'ouvrière suivante, et
 * catastrophique pour ACCUSER — les logs d'un build parfaitement sain
 * contiennent « 0 errors », « error handling », `assertEquals`, un nom de test
 * « ne doit pas échouer ». Un grief posé là-dessus brûlerait des tentatives
 * légitimes à la chaîne.
 *
 * Une seule alternation compilée une fois : le scan est linéaire sur des logs
 * qui peuvent peser 512 ko (LIMITS.log).
 */
const MOTIF_ECHEC_DUR = new RegExp(
  [
    'command not found',
    'no such file or directory',
    'traceback \\(most recent call last\\)',
    'npm err!',
    'error ts\\d{3,5}\\b',
    'fatal:',
    'segmentation fault',
    'panic:',
    'assertionerror',
    'modulenotfounderror',
    'unhandled (?:promise )?rejection',
    'exit(?:ed)? with (?:code|status) [1-9]',
    // « 1 test failed », jamais « 0 failed » : un compte NUL d'échecs est la
    // signature d'une suite verte, pas d'une panne.
    '\\b[1-9]\\d* (?:tests? )?(?:failed|failing)\\b',
    '\\btests?\\s*:\\s*[1-9]\\d* failed',
    'fail(?:ed)? [a-z0-9_./-]+\\.(?:ts|tsx|js|jsx|py|go|rs|rb|java)\\b',
    '(?:build|compilation|tests?) failed',
    '\\benoent\\b',
    'timeout apres \\d+ ms',
    'exception\\s*:',
  ].join('|'),
  'i',
);

/**
 * Contre-motifs : la même ligne dit explicitement qu'il n'y a AUCUNE erreur.
 * « 0 errors », « no errors », « aucune erreur », « failed: 0 » — le vocabulaire
 * de la réussite emprunte celui de l'échec, il faut le lui rendre.
 */
const MOTIF_ANODIN =
  /\b(?:0|no|aucune?|zero) (?:errors?|erreurs?|failures?|failed|failing|echecs?)\b|\b(?:errors?|erreurs?|failures?|failed)\s*:?\s*0\b/i;

/**
 * Lignes de logs qui CRIENT l'échec. Les lignes sont nettoyées par
 * `lignesDeLogs` (brood.ts) — ANSI retiré, vides écartées : la Couveuse fait
 * déjà exactement ce travail, et deux nettoyages divergents finiraient par se
 * contredire.
 */
export function lignesQuiCrient(logs: string): string[] {
  const out: string[] = [];
  for (const ligne of lignesDeLogs(logs)) {
    const normale = normaliser(ligne);
    if (MOTIF_ECHEC_DUR.test(normale) && !MOTIF_ANODIN.test(normale)) out.push(ligne);
  }
  return out;
}

// ─── L'inspection ───────────────────────────────────────────────────────────

function grief(code: CodeGrief, compte: number, chemins: string[] = [], extrait = ''): Grief {
  return {
    code,
    poids: POIDS[code],
    compte,
    chemins: chemins.slice(0, MAX_CHEMINS).map((c) => c.slice(0, MAX_LONGUEUR_CHEMIN)),
    extrait,
  };
}

/**
 * Renifle une production déclarée réussie et rend ses griefs, plus un verdict.
 *
 * PURE et DÉTERMINISTE : deux appels sur les mêmes entrées rendent des objets
 * profondément égaux, l'entrée n'est jamais modifiée, et rien ici ne dépend de
 * l'horloge ni d'un état.
 *
 * Un ÉCHEC DÉCLARÉ (`success: false`) rend `clean` sans le moindre grief : la
 * ruche sait déjà qu'il a échoué, il n'entre nulle part, et l'accabler
 * n'apprendrait rien à personne. Les Gardiennes ne reniflent que ce qui prétend
 * ENTRER.
 *
 * Les griefs de diff s'excluent par construction : un diff vide ne peut pas
 * « manquer sa surface » ni être « malformé ». Le score reste donc lisible —
 * on ne compte jamais deux fois la même faute.
 */
export function inspecter(production: Production): Inspection {
  const { titre, prompt, success, diff, logs, depotGit } = production;
  const promis = cheminsPromis(titre, prompt);
  const promesse = promesseDeModification(titre, prompt);
  // UNE seule analyse du diff, réutilisée par les trois détecteurs : il pèse
  // jusqu'à 1 Mo (LIMITS.diff) et l'inspection tombe sur le chemin d'un
  // résultat. Sans dépôt, on ne l'analyse même pas — il n'y a rien à y voir.
  const plages = depotGit ? parseDiff(diff) : null;
  const touches = plages ? cheminsDePlages(plages) : [];
  const examen: Examen = {
    promesse,
    diffPossible: depotGit,
    cheminsPromis: promis.length,
    fichiersTouches: touches.length,
    diffOctets: diff.length,
    logsOctets: logs.length,
  };

  if (!success) {
    return { version: VERSION_GARDIENNES, verdict: 'clean', score: 0, griefs: [], examen };
  }

  const griefs: Grief[] = [];

  // ─── Le diff, seulement s'il pouvait exister ──────────────────────────────
  if (plages) {
    const vide = diff.trim() === '';
    if (vide) {
      // Diff VIDE sur une promesse de modification : le mensonge central.
      if (promesse) griefs.push(grief('empty_diff', promis.length, promis));
    } else {
      const orphelins = hunksOrphelins(diff, plages);
      // Un diff BINAIRE ou de simple RENOMMAGE ne nomme aucun fichier par un
      // en-tête `---`/`+++` et n'a aucun hunk : il est parfaitement valide.
      // On ne crie au diff malformé que si le texte ne s'annonce même pas
      // comme un diff git, ou s'il traîne des hunks que personne ne réclame.
      const inexploitable = touches.length === 0 && !MOTIF_ENTETE_GIT.test(diff);
      if (inexploitable || orphelins > 0) {
        griefs.push(grief('malformed_diff', orphelins));
      } else if (promis.length > 0 && touches.length > 0) {
        const manquees = promis.filter((p) => !tenue(p, touches));
        // Surface tenue = AU MOINS une promesse honorée. Exiger qu'elles le
        // soient toutes punirait une tâche qui cite trois fichiers et n'en a
        // légitimement modifié qu'un.
        if (manquees.length === promis.length) {
          griefs.push(grief('surface_missed', touches.length, manquees));
        }
      }
    }
  }

  // ─── Les logs, toujours : ils ne dépendent d'aucun dépôt ──────────────────
  const crient = lignesQuiCrient(logs);
  if (crient.length > 0) {
    griefs.push(
      grief(
        'logs_contradict',
        crient.length,
        [],
        // Réutilise la matière de la Couveuse (nettoyage, bornage par ligne,
        // jointure), appliquée aux SEULES lignes qui crient — puis passe par
        // le contrat commun des données non fiables.
        champSurUneLigne(extraitDesLogs(crient.join('\n')), EXTRAIT_MAX),
      ),
    );
  }

  griefs.sort((a, b) => b.poids - a.poids || a.code.localeCompare(b.code));
  const score = griefs.reduce((somme, g) => somme + g.poids, 0);
  return {
    version: VERSION_GARDIENNES,
    verdict: score >= SEUIL_CREUSE ? 'hollow' : score > 0 ? 'suspect' : 'clean',
    score,
    griefs,
    examen,
  };
}

// ─── La vue dérivée (lecture seule, bornée) ─────────────────────────────────

/** Une inspection RANGÉE, telle que le store la rend. */
export interface LigneGardienne {
  id: number;
  /** `results.id` de la production inspectée — le fait pointe sur sa pièce. */
  resultId: number;
  taskId: string;
  nodeId: string;
  verdict: Verdict;
  score: number;
  /** Le verdict a-t-il RÉELLEMENT refusé l'entrée (mode `strict` seulement) ? */
  applique: boolean;
  griefs: Grief[];
  createdAt: number;
}

/** Ce que la ruche sait de ses contrôles d'entrée récents. */
export interface VueGardiennes {
  version: typeof VERSION_GARDIENNES;
  /** Inspections lues (le corpus est borné : ce n'est pas « depuis toujours »). */
  inspections: number;
  verdicts: Record<Verdict, number>;
  /** Combien ont réellement fermé la porte (donc : combien en `strict`). */
  refusees: number;
  /** Occurrences par code, décroissantes puis par code — ordre stable. */
  griefs: Array<{ code: CodeGrief; occurrences: number }>;
  /** Les plus récentes d'abord, bornées à `maxRecentes`. */
  recentes: LigneGardienne[];
}

/**
 * Replie un corpus BORNÉ d'inspections en une vue d'affichage. PURE, comme
 * `buildWaggleBoard` ou `replierTraces` : aucune I/O, aucun état, rien de
 * matérialisé — l'appelant fournit les lignes, du plus récent au plus ancien.
 */
export function replierInspections(
  lignes: readonly LigneGardienne[],
  maxRecentes = MAX_RECENTES,
): VueGardiennes {
  const verdicts: Record<Verdict, number> = { clean: 0, suspect: 0, hollow: 0 };
  const parCode = new Map<CodeGrief, number>();
  let refusees = 0;
  for (const ligne of lignes) {
    verdicts[ligne.verdict] += 1;
    if (ligne.applique) refusees += 1;
    for (const g of ligne.griefs) parCode.set(g.code, (parCode.get(g.code) ?? 0) + 1);
  }
  return {
    version: VERSION_GARDIENNES,
    inspections: lignes.length,
    verdicts,
    refusees,
    griefs: [...parCode.entries()]
      .map(([code, occurrences]) => ({ code, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences || a.code.localeCompare(b.code)),
    recentes: lignes.slice(0, Math.max(0, maxRecentes)),
  };
}
