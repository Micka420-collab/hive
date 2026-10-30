// Le garde de PR — la boucle après livraison, qui n'attend plus un clic.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// La ruche savait LIRE ce que devient une pull request (`shared/retour.ts`) et
// savait la REPRENDRE sur sa propre branche (#518). Mais les deux attendaient
// qu'un humain vienne regarder l'écran et cliquer. Une CI qui casse à trois
// heures du matin restait rouge jusqu'au café : pour une ruche qui se dit
// autonome, c'est une panne silencieuse — la pire classe de défaut.
//
// Le garde sonde les pull requests que la ruche a OUVERTES ELLE-MÊME (la table
// `livraisons` ne contient rien d'autre : une PR étrangère n'y entre jamais),
// et quand leur CI casse, il fait ce que le niveau d'autonomie du projet
// autorise — ni plus, ni moins.
//
// ─── LES QUATRE RÈGLES QUI EMPÊCHENT LA BOUCLE DE S'EMBALLER ─────────────────
//
//   1. RÉARMEMENT SUR UNE TÊTE NEUVE, ET SEULEMENT LÀ. Le garde retient la tête
//      (SHA) sur laquelle il a déjà agi ; tant que la PR montre cette tête,
//      rouge ou non, il n'agit plus. Sans ça, une reprise qui échoue (aucun
//      commit poussé) laisserait la même CI rouge, et chaque sondage relancerait
//      une ouvrière sur le même échec — la boucle qu'Open SWE borne par
//      `MAX_RETRIES_PER_HEAD`.
//   2. UN PLAFOND, REMIS À ZÉRO PAR LE VERT. Les reprises se comptent depuis
//      la dernière fois que le garde a vu la CI verte (`vertA`). Trois échecs
//      d'affilée, c'est une production que la ruche ne sait pas réparer : elle
//      attend un humain. Mais une PR réparée qui recasse une semaine plus tard
//      sur un autre sujet n'a pas épuisé son crédit — c'est un problème neuf.
//      Réglable de 1 à 10 (`HIVE_GARDE_PR_PLAFOND`), 3 par défaut, comme le
//      plafond par défaut du CI Babysitter de Sculptor.
//   3. UNE RELANCE « INSTABLE » SE PROUVE. Un job n'est relancé tel quel que
//      s'il a RÉUSSI sur la branche de base à chacun de ses N derniers passages
//      — et cette preuve est journalisée (`garde_pr_relance`). Un job qui échoue
//      aussi sur la base n'est pas instable, c'est la base qui est cassée, et
//      le relancer brûlerait des minutes de CI pour rien. Une seule relance par
//      tête : si le job rejoué échoue encore, c'est un vrai échec.
//   4. RETIRÉ À LA FUSION OU À LA FERMETURE. Une PR fusionnée n'a plus rien à
//      garder ; une PR fermée sans fusion, quelqu'un l'a refusée, et la ruche
//      n'insiste pas.
//
// ─── CE QUE LE GARDE NE FAIT JAMAIS ──────────────────────────────────────────
//
// Il ne fusionne pas, ne rebase pas, ne pousse rien lui-même. Une correction
// passe par une REPRISE ordinaire (même route, même brief `briefDeRetour`,
// même branche, même Evaluator, même relecture croisée) : le garde n'a aucun
// chemin d'écriture propre, il décide seulement QUAND ouvrir ce qu'un humain
// aurait ouvert en cliquant.
//
// ─── MODULE PUR ──────────────────────────────────────────────────────────────
//
// Aucune I/O, aucune horloge implicite : le serveur lit GitHub, le store et
// l'environnement, puis demande ici quoi faire. La minuterie et les appels
// vivent dans `server.ts` (`passeGardePr`), séquentiels comme la liste des
// livraisons — une rafale déclencherait la limite SECONDAIRE de GitHub, qui
// est un bannissement temporaire et non un simple 429.
//
// Conception inspirée du CI Babysitter de Sculptor (imbue-ai/sculptor, MIT) et
// du /baby-sit d'Open SWE (langchain-ai/open-swe, MIT) ; aucun code n'en est
// repris.

import { rangNiveau } from './essaim.js';
import type { NiveauAutonomie } from './essaim.js';
import { MAX_REPRISES_PAR_LIVRAISON, controlesEnEchec } from '../shared/retour.js';
import type { Controle, EtatLivraison, FaitsPr } from '../shared/retour.js';

// ─── Les réglages de l'hôte ──────────────────────────────────────────────────

/** Bornes du plafond de reprises, et son défaut. */
export const PLAFOND_GARDE_MIN = 1;
export const PLAFOND_GARDE_MAX = 10;
export const PLAFOND_GARDE_DEFAUT = MAX_REPRISES_PAR_LIVRAISON;

/**
 * Le plafond de reprises d'une PR entre deux CI vertes (`HIVE_GARDE_PR_PLAFOND`).
 *
 * Une valeur illisible retombe sur le DÉFAUT, et une valeur hors bornes est
 * ramenée dans [1, 10] : une faute de frappe ne doit ni lever toute limite
 * (`999`) ni fermer la reprise (`0`) — c'est `HIVE_GARDE_PR=off` qui éteint.
 */
export function plafondGardeDepuisEnv(env: NodeJS.ProcessEnv): number {
  const brut = (env.HIVE_GARDE_PR_PLAFOND ?? '').trim();
  if (!/^\d{1,3}$/.test(brut)) return PLAFOND_GARDE_DEFAUT;
  return Math.max(PLAFOND_GARDE_MIN, Math.min(PLAFOND_GARDE_MAX, Number(brut)));
}

/**
 * Le garde sonde-t-il ? Allumé par défaut (décision du propriétaire : le garde
 * veille sur les PR que la ruche a ouvertes) ; seul `HIVE_GARDE_PR=off`
 * l'éteint. Toute autre valeur le laisse allumé — éteindre est un geste
 * explicite, pas l'effet d'une faute de frappe.
 */
export function gardeActiveDepuisEnv(env: NodeJS.ProcessEnv): boolean {
  return (env.HIVE_GARDE_PR ?? '').trim().toLowerCase() !== 'off';
}

// ─── La cadence ──────────────────────────────────────────────────────────────

/** Période de la minuterie. Chaque passe ne lit que les PR ÉCHUES. */
export const PERIODE_GARDE_MS = 60_000;

/** PR lues au plus par passe : 3 appels chacune, séquentiels. */
export const LOT_GARDE = 4;

/** Prochaine lecture d'une PR selon ce qu'elle montrait. */
export const DELAI_CI_EN_COURS_MS = 2 * 60_000;
export const DELAI_CALME_MS = 10 * 60_000;

/** Recul après échec de lecture : doublé à chaque échec, plafonné. */
export const RECUL_BASE_MS = 5 * 60_000;
export const RECUL_MAX_MS = 60 * 60_000;

/**
 * Recul après `echecs` échecs consécutifs (≥ 1) : 5 min, 10, 20, 40, puis 1 h.
 * Sert aussi à la PAUSE GLOBALE quand GitHub refuse (403/429) : une limite
 * secondaire vise le jeton, pas une PR, et insister sur la PR suivante
 * prolongerait le bannissement.
 */
export function reculGarde(echecs: number): number {
  const n = Math.max(1, Math.min(10, Math.trunc(echecs)));
  return Math.min(RECUL_MAX_MS, RECUL_BASE_MS * 2 ** (n - 1));
}

// ─── Ce que montre la CI ─────────────────────────────────────────────────────

/**
 * L'état de la CI SEULE, indépendamment des revues.
 *
 *   · `rouge`    — au moins un contrôle terminé en échec ;
 *   · `en_cours` — rien d'échoué, mais un contrôle n'est pas terminé ;
 *   · `verte`    — tous terminés, aucun en échec, et il y en a au moins un ;
 *   · `sans_ci`  — aucun contrôle : rien à garder, rien à remettre à zéro.
 *
 * `sans_ci` n'est PAS `verte` : une PR dont la CI n'a pas encore démarré ne
 * prouve rien, et remettre le plafond à zéro sur elle offrirait trois reprises
 * de plus à une production qui n'a jamais passé un seul contrôle.
 */
export type EtatCi = 'rouge' | 'en_cours' | 'verte' | 'sans_ci';

export function etatCi(faits: FaitsPr): EtatCi {
  if (controlesEnEchec(faits).length > 0) return 'rouge';
  if (faits.controles.length === 0) return 'sans_ci';
  return faits.controles.every((c) => c.statut === 'completed') ? 'verte' : 'en_cours';
}

// ─── La mémoire du garde, et sa décision ─────────────────────────────────────

/** Ce que le garde retient d'une PR entre deux sondages (table `gardes_pr`). */
export interface MemoireGarde {
  /** La tête sur laquelle le garde a déjà AGI (reprise, alerte, plafond). */
  teteTraitee: string;
  /** La tête sur laquelle il a déjà relancé des jobs instables. */
  teteRelancee: string;
}

/**
 * La décision d'un sondage.
 *
 *   · `retirer`  — PR fusionnée ou fermée : le garde la lâche pour de bon ;
 *   · `vert`     — CI verte : le plafond se remet à zéro ;
 *   · `attendre` — rien à faire maintenant (CI en cours, déjà traitée, calme) ;
 *   · `agir`     — CI rouge sur une tête NEUVE. `instables` liste les jobs
 *                  qu'on POURRAIT relancer si la base les prouve instables —
 *                  vide quand un échec n'est pas un job Actions (rien à
 *                  relancer, il faut corriger) ou quand la relance a déjà eu
 *                  lieu sur cette tête.
 */
export type DecisionGarde =
  | { geste: 'retirer'; etat: 'fusionnee' | 'fermee' }
  | { geste: 'vert' }
  | { geste: 'attendre'; raison: 'ci_en_cours' | 'deja_traitee' | 'calme' }
  | { geste: 'agir'; tete: string; echecs: Controle[]; instables: Controle[] };

export function deciderGarde(
  vue: { etat: EtatLivraison; faits: FaitsPr },
  memoire: MemoireGarde,
): DecisionGarde {
  if (vue.etat === 'fusionnee' || vue.etat === 'fermee')
    return { geste: 'retirer', etat: vue.etat };
  const ci = etatCi(vue.faits);
  if (ci === 'verte') return { geste: 'vert' };
  if (ci === 'en_cours') return { geste: 'attendre', raison: 'ci_en_cours' };
  if (ci === 'sans_ci') return { geste: 'attendre', raison: 'calme' };

  // Sans tête lue, aucune mémoire n'est comparable : agir sur « la tête
  // inconnue » réarmerait à chaque sondage. On attend une lecture complète.
  const tete = vue.faits.commitSha ?? '';
  if (tete === '') return { geste: 'attendre', raison: 'calme' };
  if (tete === memoire.teteTraitee) return { geste: 'attendre', raison: 'deja_traitee' };

  const echecs = controlesEnEchec(vue.faits);
  // Relancer n'a de sens que si TOUS les échecs sont des jobs relançables :
  // si l'un d'eux doit être corrigé de toute façon, rejouer les autres ne
  // ferait que retarder la correction d'un tour de CI.
  const tousRelancables = echecs.every((c) => c.jobId !== undefined);
  const instables = tete !== memoire.teteRelancee && tousRelancables ? echecs : [];
  return { geste: 'agir', tete, echecs, instables };
}

// ─── La preuve d'instabilité ─────────────────────────────────────────────────

/** Passages consécutifs réussis sur la base qu'il faut pour croire à l'instabilité. */
export const PASSAGES_BASE_INSTABLE = 3;

/** Commits de la base lus pour les trouver (un contrôle ne tourne pas sur tous). */
export const COMMITS_BASE_LUS = 5;

/** Au-delà, on ne cherche plus d'instabilité : autant d'échecs se corrigent. */
export const MAX_JOBS_INSTABLES = 3;

export interface PreuveInstable {
  nom: string;
  jobId: number;
  /** Les passages de ce contrôle sur la base, du plus récent au plus ancien. */
  base: Array<{ commit: string; conclusion: string }>;
}

/**
 * Juge si les échecs d'une tête sont TOUS des jobs instables.
 *
 * Rend la liste à relancer, avec sa preuve, ou `null` — et `null` est la
 * réponse dès qu'UN SEUL échec n'est pas prouvé : on corrige alors, on ne
 * relance rien. Un contrôle est prouvé instable quand ses
 * `PASSAGES_BASE_INSTABLE` derniers passages terminés sur la base sont tous
 * `success`. Moins de passages observés ne prouve rien : un contrôle neuf,
 * que la base n'a jamais fait tourner, n'a pas d'historique à invoquer.
 */
export function jugerInstables(
  echecs: readonly Controle[],
  historique: ReadonlyMap<string, ReadonlyArray<{ commit: string; conclusion: string }>>,
  passages: number = PASSAGES_BASE_INSTABLE,
): PreuveInstable[] | null {
  if (echecs.length === 0 || echecs.length > MAX_JOBS_INSTABLES) return null;
  const preuves: PreuveInstable[] = [];
  for (const c of echecs) {
    if (c.jobId === undefined) return null;
    const vus = (historique.get(c.nom) ?? []).slice(0, passages);
    if (vus.length < passages || !vus.every((v) => v.conclusion === 'success')) return null;
    preuves.push({ nom: c.nom, jobId: c.jobId, base: vus.map((v) => ({ ...v })) });
  }
  return preuves;
}

// ─── Ce que l'autonomie autorise ─────────────────────────────────────────────

/**
 * Le geste que le niveau d'autonomie du projet autorise sur une CI rouge.
 *
 *   · `off`, `propose` → `notifier` : la ruche le DIT (journal, connecteurs),
 *     elle ne dépense rien. `propose` ne livre rien, par définition — et une
 *     reprise avance la branche d'une PR, c'est une livraison.
 *   · `gouverne`, `plein` → `reprendre`, À UNE CONDITION : que l'hôte ait
 *     allumé `HIVE_RUNNER`. Le niveau dit ce que le propriétaire du projet
 *     veut ; le commutateur dit si la machine qui paie le temps-ouvrière est
 *     d'accord — on ne l'allume jamais à sa place. Runner éteint, on notifie,
 *     et la notification dit pourquoi on n'a pas repris.
 *
 * La RELANCE d'un job instable ne coûte aucun temps-ouvrière (elle rejoue la
 * CI du dépôt) : elle suit le seul niveau, dès `gouverne`.
 */
export type GesteAutonome =
  { geste: 'notifier'; motif: 'autonomie' | 'runner_eteint' } | { geste: 'reprendre' };

export function gesteAutonome(niveau: NiveauAutonomie, runnerAllume: boolean): GesteAutonome {
  if (rangNiveau(niveau) < rangNiveau('gouverne')) return { geste: 'notifier', motif: 'autonomie' };
  return runnerAllume ? { geste: 'reprendre' } : { geste: 'notifier', motif: 'runner_eteint' };
}

export function relanceAutorisee(niveau: NiveauAutonomie): boolean {
  return rangNiveau(niveau) >= rangNiveau('gouverne');
}

/** Une phrase pour l'humain, sur ce que le garde vient de faire ou d'attendre. */
export function direGeste(geste: string, detail = ''): string {
  const suite = detail === '' ? '' : ` ${detail}`;
  switch (geste) {
    case 'retiree':
      return `Garde retiré : la pull request est close.${suite}`;
    case 'vert':
      return `CI verte — compteur de reprises remis à zéro.${suite}`;
    case 'ci_en_cours':
      return `CI en cours — le garde repasse bientôt.${suite}`;
    case 'deja_traitee':
      return `Échec déjà traité sur cette tête — le garde attend un nouveau commit.${suite}`;
    case 'reprise':
      return `CI rouge — reprise ouverte sur la même branche.${suite}`;
    case 'relance':
      return `Jobs instables relancés (ils passent sur la base).${suite}`;
    case 'alerte':
      return `CI rouge — opérateur prévenu.${suite}`;
    case 'reprise_en_vol':
      return `Une reprise est déjà en cours — le garde attend qu’elle aboutisse.${suite}`;
    case 'illisible':
      return `GitHub illisible — le garde réessaiera.${suite}`;
    default:
      return `Le garde veille.${suite}`;
  }
}
