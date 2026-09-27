// La livraison SANS GITHUB — une mission intégrée, commitée sur UNE branche.
//
// ─── LE TROU QUE CE MODULE FERME ─────────────────────────────────────────────
//
// La seule livraison que la ruche savait faire passait par l'API de GitHub :
// une pull request PAR TÂCHE, écrite avec la clé de l'hôte (`livraison.ts`).
// Un projet sur GitLab, sur Gitea, sur un dépôt nu d'un serveur maison — ou
// sur le disque de l'hôte — n'avait AUCUNE livraison Git traçable : le merge
// Honeycomb appliquait bien les diffs sur un clone, lançait les tests, puis
// jetait le clone. Le résultat intégré de la mission ne survivait que comme un
// diff dans la mémoire du hub, perdu au premier redémarrage.
//
// ─── CE QUE LA RUCHE FAIT DÉSORMAIS, ET RIEN DE PLUS ─────────────────────────
//
//   1. l'ouvrière qui a fait le merge COMMITE l'arbre intégré — exactement ce
//      qui a été appliqué, capturé AVANT la préparation (`npm ci` n'y met pas
//      ses `node_modules`) — sur `hive/mission-<projectId>-<n>` ;
//   2. la branche est rangée dans un dépôt DURABLE du nœud
//      (`<workRoot>/livraisons/<projectId>.git`) : le clone jetable peut
//      disparaître, la livraison reste ;
//   3. POUSSER vers le dépôt du projet est un geste EXPLICITE, avec les
//      identifiants git du nœud — ceux-là mêmes qui ont servi au clone — et
//      seulement si l'opérateur du nœud y a consenti (`HIVE_LIVRAISON_POUSSER`).
//
// Jamais de merge sur la branche principale, jamais de poussée forcée, jamais
// d'autre référence que `hive/mission-*` : c'est le nœud qui compose le nom de
// branche, le hub ne peut pas en désigner une autre.
//
// ─── LA PROVENANCE VOYAGE DANS LE COMMIT ─────────────────────────────────────
//
// Un commit qui dit « Hive » sans dire QUOI serait une boîte noire de plus. Le
// message porte des trailers git (`git interpret-trailers --parse` les relit) :
// les tâches intégrées, le résultat exact de chacune, le verdict de l'Evaluator
// au moment de livrer, et la raison d'un forçage s'il y en a eu un. Un inconnu
// reste inconnu : un résultat sans identifiant s'écrit `inconnu`, jamais `0`.
//
// Ce module est PUR : ni git, ni disque, ni réseau. Le nœud l'emploie pour
// composer, le hub pour vérifier, la CLI pour découper ses arguments.

import { champSurUneLigne } from './donnees-non-fiables.js';

/** Préfixe des branches de mission — dans l'espace `hive/` des branches de la ruche. */
export const PREFIXE_BRANCHE_MISSION = 'hive/mission-';

/** Ce que l'Evaluator disait d'une tâche intégrée, au moment de livrer. */
export interface ProvenanceTache {
  taskId: string;
  /** Le résultat EXACT intégré ; `null` si la production n'en porte pas. */
  resultId: number | null;
  /** Verdict de l'Evaluator (`accepted`, `correction_required`…). */
  decision: string;
}

/**
 * La demande de livraison que le hub joint à un merge (`assign_merge.livraison`).
 *
 * Elle ne porte NI nom de branche NI commande : le nœud compose le nom depuis
 * `projectId`, et pousse vers le dépôt qu'il vient de cloner. Un hub compromis
 * peut demander une livraison ; il ne peut pas désigner une autre référence.
 */
export interface DemandeLivraisonLocale {
  projectId: string;
  /** Pousser la branche vers le dépôt du projet — geste explicite, jamais par défaut. */
  pousser: boolean;
  /** Une entrée par tâche intégrée, dans l'ordre du plan de merge. */
  provenance: ProvenanceTache[];
  /** Raison d'un forçage de l'Evaluator, journalisée côté hub et portée par le commit. */
  forcage?: string;
}

/** Ce que la poussée est devenue. */
export type EtatPoussee = 'non_demandee' | 'poussee' | 'refusee' | 'echec';

/**
 * Ce que la demande de livraison est devenue (`merge_result.livraison`).
 *
 * Un NŒUD rend l'une des deux premières issues (`RapportDuNoeud`), et la
 * seconde exige un motif : un merge demandé « avec livraison » qui reviendrait
 * sans rien dire de la livraison serait exactement l'échec silencieux que la
 * ruche s'interdit. La troisième n'appartient qu'au hub.
 */
export type RapportLivraisonLocale =
  | {
      etat: 'commitee';
      branche: string;
      /** SHA complet du commit (40 ou 64 caractères hexadécimaux). */
      commit: string;
      poussee: EtatPoussee;
      /** Pourquoi la poussée n'a pas eu lieu (`refusee`/`echec`) — identifiants lavés. */
      motif?: string;
    }
  | { etat: 'non_commitee'; motif: string }
  /**
   * Le HUB a perdu le fil — nœud déconnecté, délai dépassé — et ne sait pas
   * ce que le nœud a fait. Jamais envoyé par un nœud (le protocole le
   * refuse) : un nœud SAIT s'il a commité. Le dire « non commitée » serait
   * inventer : le nœud a pu commiter, et même pousser, avant de se taire.
   */
  | { etat: 'inconnue'; motif: string };

/** Ce qu'un NŒUD peut rendre : lui sait toujours s'il a commité. */
export type RapportDuNoeud = Exclude<RapportLivraisonLocale, { etat: 'inconnue' }>;

/** Nom de la branche de la `n`-ième livraison d'une mission. */
export function brancheDeMission(projectId: string, n: number): string {
  return `${PREFIXE_BRANCHE_MISSION}${projectId}-${n}`;
}

/**
 * Le numéro d'une branche de mission de CE projet, ou `null`.
 *
 * Compare au préfixe EXACT du projet, puis exige des chiffres jusqu'au bout :
 * `hive/mission-p-1` ne doit pas compter pour le projet `p-1`, dont les
 * branches s'écrivent `hive/mission-p-1-<n>`.
 */
export function numeroDeMission(projectId: string, branche: string): number | null {
  const prefixe = `${PREFIXE_BRANCHE_MISSION}${projectId}-`;
  const nom = branche.startsWith('refs/heads/') ? branche.slice('refs/heads/'.length) : branche;
  if (!nom.startsWith(prefixe)) return null;
  const reste = nom.slice(prefixe.length);
  if (!/^[1-9]\d{0,8}$/.test(reste)) return null;
  return Number(reste);
}

/** Le numéro suivant, vu l'ensemble des branches déjà prises (locales ET distantes). */
export function numeroSuivant(projectId: string, branches: readonly string[]): number {
  let max = 0;
  for (const b of branches) {
    const n = numeroDeMission(projectId, b);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

/** Forme d'un nom de branche de mission, quel que soit le projet (validation de transport). */
export const MOTIF_BRANCHE_MISSION = /^hive\/mission-[A-Za-z0-9_-]{1,64}-[1-9]\d{0,8}$/;

/** Ce que les tests ont dit du tree commité — il n'y a que deux cas où l'on commite. */
export type TestsLivres = { lances: false } | { lances: true; commande: readonly string[] };

/**
 * Le message du commit de mission : un sujet, un corps court, puis les
 * trailers de provenance.
 *
 * ─── POURQUOI TOUT EST APLATI ET BORNÉ ───────────────────────────────────────
 *
 * Un trailer est une LIGNE `Clé: valeur`. La raison d'un forçage vient d'un
 * humain et la commande de test du hub : un saut de ligne dedans fabriquerait
 * un trailer de plus — un `Hive-Evaluator: t1 accepted` que personne n'a
 * rendu. `champSurUneLigne` referme cette porte.
 */
export function messageDeMission(
  demande: DemandeLivraisonLocale,
  n: number,
  tests: TestsLivres,
): string {
  const k = demande.provenance.length;
  const lignes = [
    `Hive — mission ${demande.projectId}, livraison n°${n}`,
    '',
    `Intègre ${k} tâche${k > 1 ? 's' : ''} de la ruche, dans l’ordre du plan de merge Honeycomb.`,
    'Commit composé par une ouvrière ; la branche principale n’est pas touchée.',
    '',
    `Hive-Mission: ${demande.projectId}`,
    `Hive-Livraison: ${n}`,
  ];
  for (const p of demande.provenance) lignes.push(`Hive-Task: ${p.taskId}`);
  for (const p of demande.provenance) {
    lignes.push(`Hive-Result: ${p.taskId} ${p.resultId === null ? 'inconnu' : p.resultId}`);
  }
  for (const p of demande.provenance) {
    lignes.push(`Hive-Evaluator: ${p.taskId} ${champSurUneLigne(p.decision, 40)}`);
  }
  if (demande.forcage !== undefined) {
    lignes.push(`Hive-Evaluator-Forced: ${champSurUneLigne(demande.forcage, 500)}`);
  }
  lignes.push(
    tests.lances
      ? `Hive-Tests: ok — ${champSurUneLigne(tests.commande.join(' '), 200)}`
      : 'Hive-Tests: non-lances',
  );
  return `${lignes.join('\n')}\n`;
}

/**
 * Pourquoi un nœud refuse de pousser — et comment l'y autoriser.
 *
 * Partagé par le nœud (qui refuse) et le hub (qui choisit un nœud consentant) :
 * la même phrase aux deux bouts, avec la marche à suivre, jamais un refus nu.
 */
export const CONSENTEMENT_POUSSEE =
  'pousser écrit sur le dépôt avec les identifiants git de CE nœud : son opérateur doit ' +
  'l’autoriser en le relançant avec HIVE_LIVRAISON_POUSSER=1';

/**
 * Le nœud consent-il à pousser ? `1` seulement — la valeur que la ruche
 * emploie pour ses autres interrupteurs (`HIVE_SIMULATION`, `HIVE_REAL_SHELL`).
 * Tout le reste, faute de frappe comprise, vaut « non » : écrire avec les
 * identifiants de quelqu'un ne s'active pas par accident.
 */
export function pousseeConsentie(env: NodeJS.ProcessEnv): boolean {
  return env.HIVE_LIVRAISON_POUSSER === '1';
}

/**
 * Découpe `livrer-local <projectId> [--pousser] [--forcer="raison"] [cmd…]`.
 *
 * Les deux options se lisent EN TÊTE, et seulement là : ce qui suit est une
 * commande de merge (`--preparer npm ci --tester npm test`), dont un argument
 * pourrait lui-même commencer par `--`. Une option inconnue en tête n'est pas
 * une option : elle appartient à la commande, et `decouperMergeArgv` en jugera.
 *
 * `--forcer "raison"` (espace) est accepté parce qu'on le tape ; `--forcer`
 * sans raison est un refus — passer outre l'Evaluator exige de dire pourquoi.
 */
export function decouperLivraisonArgv(queue: readonly string[]): {
  pousser: boolean;
  forcer?: { raison: string };
  reste: string[];
} {
  let pousser = false;
  let raison: string | undefined;
  let i = 0;
  for (; i < queue.length; i++) {
    const a = queue[i] as string;
    if (a === '--pousser') {
      pousser = true;
      continue;
    }
    if (a !== '--forcer' && !a.startsWith('--forcer=')) break;
    raison = a === '--forcer' ? queue[++i] : a.slice('--forcer='.length);
    // La borne du hub (3 caractères dont un visible), dite ICI : un refus du
    // serveur sur la forme ferait croire à une panne de la ruche.
    if (raison === undefined || raison.trim().length < 3) {
      throw new Error('--forcer attend une raison : --forcer="pourquoi on passe outre"');
    }
  }
  return {
    pousser,
    ...(raison !== undefined ? { forcer: { raison } } : {}),
    reste: queue.slice(i),
  };
}
