// LES MISSIONS REJOUABLES — l'instantané d'une mission, son rejeu, et la
// comparaison des deux.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// Le Time-Lapse (`orchestrator/replay.ts`) REMONTE le temps : il replie le
// journal pour montrer ce qui s'est passé. Il ne sait pas le REJOUER : relancer
// la même mission, avec un autre modèle, une autre politique de routage ou un
// autre niveau d'autonomie, et dire ce qui a changé. Et le journal s'élague
// (5 000 événements) : au bout de quelques missions, ce qui a été planifié,
// sous quel Genome, avec quels garde-fous, n'existe plus nulle part.
//
// Une mission, ici, c'est un ÉPISODE D'ACTIVITÉ d'un projet : elle s'ouvre
// quand une tâche naît sur un projet qui n'avait plus rien en vol, et se clôt
// quand plus rien n'y est vivant (ni production, ni relecture). La Reine prend
// un instantané à chacun des deux bords ; ce module dit ce qu'il contient.
//
// ─── TROIS RÈGLES ────────────────────────────────────────────────────────────
//
//   1. L'INSTANTANÉ EST UN FAIT, PAS UNE VUE. Il est écrit une fois, par la
//      Reine, et relu tel quel : un rejeu dans trois mois doit relancer le plan
//      que la mission a VRAIMENT eu, sous le Genome qu'elle a VRAIMENT vu — pas
//      celui qu'on recalculerait aujourd'hui.
//   2. L'ABSENCE RESTE ABSENTE. Un plan qui ne tient pas dans les bornes est
//      marqué incomplet (et ne se rejoue pas) ; un journal élagué avant la fin
//      de la mission est dit incomplet ; un coût que personne n'a déclaré vaut
//      `inconnu`. Aucun chiffre n'est estimé, aucun écart n'est calculé contre
//      un côté inconnu.
//   3. RIEN DE LIBRE NE SORT D'ICI. Les décisions et les faits sont TYPÉS
//      (état, verdict, compte) : aucune raison humaine, aucune objection,
//      aucun texte d'agent. Seuls les prompts du plan sont gardés — c'est ce
//      qu'on rejoue — et le dépôt n'est gardé que lavé de ses identifiants.
//
// MODULE PUR : aucune base, aucun réseau, aucun `node:` — l'écran l'importe.

import { declarationDe, sommeDeclaree } from './declaration-fournisseur.js';
import type { SommeDeclaree } from './declaration-fournisseur.js';
import type { HiveEvent, Task, TaskStatus } from './types.js';
import { estEtatDeValidation, VALIDATION_KEYS } from './validations-bac.js';
import type { ValidationKey, ValidationState } from './validations-bac.js';

/** Version du FORMAT de l'instantané. Un lecteur refuse ce qu'il ne connaît pas. */
export const VERSION_INSTANTANE_MISSION = 1;

export const MOMENTS_MISSION = ['debut', 'fin'] as const;
export type MomentMission = (typeof MOMENTS_MISSION)[number];

/**
 * Les politiques de routage qu'un rejeu peut imposer.
 *
 *   · `apprise` — l'Aiguillage de la ruche tel qu'il est AUJOURD'HUI (défaut) ;
 *   · `figee`   — l'Aiguillage nourri du Genome FIGÉ dans l'instantané de
 *                 début : la mission rejouée sous le vécu qu'elle avait ;
 *   · `neutre`  — l'Aiguillage sans aucun vécu : chaque modèle offert part à
 *                 égalité, ce qui isole ce que l'apprentissage apporte.
 */
export const POLITIQUES_ROUTAGE = ['apprise', 'figee', 'neutre'] as const;
export type PolitiqueRoutage = (typeof POLITIQUES_ROUTAGE)[number];

/** Au-delà, le plan n'est pas rangé en entier : l'instantané le DIT. */
export const MAX_TACHES_PLAN = 200;
/** Somme des prompts gardés par instantané (caractères). */
export const MAX_CARACTERES_PROMPTS = 1_000_000;
/** Chaque liste de faits (tentatives, validations…) est bornée à ceci. */
export const MAX_FAITS = 2_000;
/** Longueur maximale d'un nom de modèle imposé à un rejeu. */
export const MAX_NOM_MODELE = 120;

/** Le statut d'une tâche tel que le journal le raconte (annulée comprise). */
export type StatutMission = TaskStatus | 'cancelled';
export const STATUTS_MISSION: readonly StatutMission[] = [
  'pending',
  'ready',
  'assigned',
  'running',
  'done',
  'failed',
  'cancelled',
];

/**
 * Le rôle d'une tâche dans la mission. SEUL le `plan` se rejoue : une
 * relecture naît d'une production, une délégation d'un agent — les recopier
 * ferait faire deux fois ce que le rejeu refera de lui-même.
 */
export type GenreTachePlan = 'plan' | 'relecture' | 'deleguee';

export interface TachePlan {
  /** L'identifiant de la tâche dans la mission d'origine. */
  ref: string;
  titre: string;
  /**
   * `null` : prompt non gardé — hors budget au début (le plan est alors dit
   * incomplet), ou instantané de fin (le rejeu part du début).
   */
  prompt: string | null;
  dependsOn: string[];
  statut: StatutMission;
  tentatives: number;
  genre: GenreTachePlan;
}

/** Un antécédent de l'Aiguillage, figé : (genre × modèle) → vécu. */
export interface AntecedentFige {
  cle: string;
  essais: number;
  recompenseTotale: number;
}

/** Une tentative RENDUE par une ouvrière — et ce que son CLI en a déclaré. */
export interface TentativeMission {
  tache: string;
  issue: 'rendue' | 'reprise' | 'echec';
  /** Temps machine déclaré par l'ouvrière (`durationMs`). */
  dureeMs: number | null;
  coutUsd: number | null;
  dureeApiMs: number | null;
  jetonsEntree: number | null;
  jetonsSortie: number | null;
  modeles: string[];
}

export interface ValidationMission {
  tache: string;
  etats: Partial<Record<ValidationKey, ValidationState>>;
}

/** Une décision, TYPÉE : jamais la raison écrite par un humain. */
export interface DecisionMission {
  type: string;
  ts: number;
  tache: string | null;
  /** L'état ou la décision rendue (`approved`, `correction_required`, `plein`…). */
  valeur: string | null;
}

/** Une action irréversible qu'un rejeu a demandée (cf. `GENRES_IRREVERSIBLES`). */
export interface ActionRejeu {
  genre: GenreIrreversible;
  cible: string;
  issue: 'simulee' | 'validee';
  ts: number;
}

export interface SurchargesRejeu {
  modele?: string;
  politiqueRoutage?: PolitiqueRoutage;
  autonomie?: string;
}

export interface OrigineRejeu {
  missionSource: string;
  projetSource: string;
  surcharges: SurchargesRejeu;
}

export interface InstantaneMission {
  version: typeof VERSION_INSTANTANE_MISSION;
  moment: MomentMission;
  prisA: number;
  mission: { id: string; ouverteA: number; closeA: number | null };
  projet: { id: string; nom: string; depot: string | null };
  plan: { taches: TachePlan[]; complet: boolean; manques: string[] };
  modeles: { commandes: string[]; declares: string[]; offerts: string[] };
  routage: { versionAiguillage: number; corpus: number; politique: PolitiqueRoutage };
  genome: { empreinte: string; antecedents: AntecedentFige[] };
  autonomie: { niveau: string; depotInscrit: boolean };
  gardeFous: { actif: boolean; borneMin: string; borneMax: string } | null;
  artefacts: {
    branches: string[];
    livraisons: Array<{ tache: string; pr: number; etat: string }>;
    branchesMission: string[];
  };
  decisions: DecisionMission[];
  faits: {
    tentatives: TentativeMission[];
    validations: ValidationMission[];
    relectures: Array<{ tache: string; conteste: boolean }>;
    actionsRejeu: ActionRejeu[];
    tronques: string[];
  };
  journal: { complet: boolean; depuisEvenement: number; jusquA: number };
  rejeu: OrigineRejeu | null;
}

/**
 * Les actions IRRÉVERSIBLES : elles écrivent hors de la ruche, chez quelqu'un.
 *
 * Un rejeu ne les exécute JAMAIS de lui-même : il les simule, les range, et ne
 * les exécute qu'à la validation explicite d'un humain (un compte, pas le jeton
 * de ruche que chaque machine porte). Rejouer une mission pour comparer deux
 * modèles ne doit pas ouvrir une seconde pull request sur le dépôt de
 * quelqu'un — ni lancer sa CI, ni pousser une branche.
 */
export const GENRES_IRREVERSIBLES = [
  'livraison_pr',
  'fusion_pr',
  'livraison_locale',
  'poussee',
  'workflow',
] as const;
export type GenreIrreversible = (typeof GENRES_IRREVERSIBLES)[number];

/** Les types d'événements qu'un instantané replie — ni plus, ni moins. */
export const TYPES_MISSION = [
  'task_assigned',
  'task_done',
  'task_retry',
  'task_failed',
  'task_cancelled',
  'validation_recorded',
  'contre_expertise_verdict',
  'task_reviewed',
  'evaluator_overridden',
  'evaluator_retry_skipped',
  'swarm_level_set',
  'council_decided',
  'balance_cap_set',
  'rejeu_action_simulee',
  'rejeu_action_validee',
  'livraison_locale',
] as const;

/** Ce que la Reine a rassemblé pour un instantané — déjà filtré sur la mission. */
export interface EntreesInstantane {
  moment: MomentMission;
  prisA: number;
  mission: { id: string; ouverteA: number; closeA: number | null };
  projet: { id: string; nom: string; depot: string | null };
  /** Les tâches de la mission, dans l'ordre de création. */
  taches: readonly Task[];
  relectures: ReadonlySet<string>;
  deleguees: ReadonlySet<string>;
  /** Le journal de la mission, en ordre croissant, restreint à `TYPES_MISSION`. */
  evenements: readonly HiveEvent[];
  journal: { complet: boolean; depuisEvenement: number; jusquA: number };
  modelesOfferts: readonly string[];
  genome: { empreinte: string; antecedents: readonly AntecedentFige[] };
  routage: { versionAiguillage: number; corpus: number; politique: PolitiqueRoutage };
  autonomie: { niveau: string; depotInscrit: boolean };
  gardeFous: { actif: boolean; borneMin: string; borneMax: string } | null;
  livraisons: ReadonlyArray<{ taskId: string; pr: number; etat: string }>;
  rejeu: OrigineRejeu | null;
}

const texte = (p: Record<string, unknown>, k: string): string | null => {
  const v = p[k];
  return typeof v === 'string' && v.length > 0 ? v : null;
};
const nombre = (p: Record<string, unknown>, k: string): number | null => {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
};
const trie = (valeurs: Iterable<string>): string[] => [...new Set(valeurs)].sort();

/** Ajoute à une liste bornée ; note la troncature UNE fois, sous son nom. */
function borne<T>(liste: T[], valeur: T, nom: string, tronques: Set<string>): void {
  if (liste.length < MAX_FAITS) liste.push(valeur);
  else tronques.add(nom);
}

/**
 * Le statut RACONTÉ d'une tâche : la table, sauf quand le journal de la mission
 * dit qu'une tâche rangée `failed` a en fait été annulée (sa dernière issue
 * terminale est `task_cancelled`).
 */
function statutsRacontes(entrees: EntreesInstantane): Map<string, StatutMission> {
  const derniereIssue = new Map<string, string>();
  for (const e of entrees.evenements) {
    if (e.type !== 'task_cancelled' && e.type !== 'task_failed' && e.type !== 'task_done') continue;
    const id = texte(e.payload, 'taskId');
    if (id) derniereIssue.set(id, e.type);
  }
  const statuts = new Map<string, StatutMission>();
  for (const t of entrees.taches) {
    statuts.set(
      t.id,
      t.status === 'failed' && derniereIssue.get(t.id) === 'task_cancelled'
        ? 'cancelled'
        : t.status,
    );
  }
  return statuts;
}

/** Le plan de la mission, borné — avec ce qui n'y a pas tenu. */
function planDe(entrees: EntreesInstantane): InstantaneMission['plan'] {
  const statuts = statutsRacontes(entrees);
  const manques: string[] = [];
  const taches: TachePlan[] = [];
  let budget = MAX_CARACTERES_PROMPTS;
  for (const t of entrees.taches) {
    if (taches.length >= MAX_TACHES_PLAN) {
      manques.push(`plus de ${MAX_TACHES_PLAN} tâches : les suivantes ne sont pas rangées`);
      break;
    }
    const genre: GenreTachePlan = entrees.relectures.has(t.id)
      ? 'relecture'
      : entrees.deleguees.has(t.id)
        ? 'deleguee'
        : 'plan';
    // Seul le plan se rejoue, et il se rejoue depuis l'instantané de DÉBUT :
    // le prompt d'une relecture, d'une délégation, ou de toute tâche vue à la
    // fin n'est pas gardé — il doublerait la taille rangée sans jamais servir.
    let prompt: string | null = null;
    if (genre === 'plan' && entrees.moment === 'debut') {
      if (t.prompt.length <= budget) {
        prompt = t.prompt;
        budget -= t.prompt.length;
      } else {
        manques.push(`prompt de « ${t.title.slice(0, 80)} » hors budget`);
      }
    }
    taches.push({
      ref: t.id,
      titre: t.title,
      prompt,
      dependsOn: [...t.dependsOn],
      statut: statuts.get(t.id) ?? t.status,
      tentatives: t.attempts,
      genre,
    });
  }
  return { taches, complet: manques.length === 0, manques };
}

/**
 * Construit l'instantané d'une mission. Pur : tout vient de `entrees`.
 *
 * Les faits sont TYPÉS (règle 3) : un `task_reviewed` garde son état, jamais
 * sa raison ; un verdict de relecture garde « contesté ou non », jamais ses
 * objections.
 */
export function construireInstantane(entrees: EntreesInstantane): InstantaneMission {
  const tronques = new Set<string>();
  const commandes = new Set<string>();
  const declares = new Set<string>();
  const tentatives: TentativeMission[] = [];
  const validations: ValidationMission[] = [];
  const relectures: Array<{ tache: string; conteste: boolean }> = [];
  const decisions: DecisionMission[] = [];
  const actionsRejeu: ActionRejeu[] = [];
  const branchesMission = new Set<string>();

  for (const e of entrees.evenements) {
    const p = e.payload;
    const tache = texte(p, 'taskId');
    switch (e.type) {
      case 'task_assigned': {
        const m = texte(p, 'modele');
        if (m) commandes.add(m);
        break;
      }
      case 'task_done':
      case 'task_retry':
      case 'task_failed': {
        // Une TENTATIVE est une production rendue par une ouvrière : un nœud
        // et un temps machine. Une relance de l'Evaluator (`source:
        // evaluator`) ou un échec sans ouvrière (`no_working_agent`) n'en est
        // pas une — c'est une décision, ou rien.
        if (e.type === 'task_retry' && texte(p, 'source') === 'evaluator') {
          borne(
            decisions,
            { type: 'evaluator_retry', ts: e.ts, tache, valeur: texte(p, 'decision') },
            'decisions',
            tronques,
          );
          break;
        }
        if (!tache || !texte(p, 'nodeId') || nombre(p, 'durationMs') === null) break;
        const d = declarationDe(p);
        for (const m of d.modeles) declares.add(m);
        borne(
          tentatives,
          {
            tache,
            issue:
              e.type === 'task_done' ? 'rendue' : e.type === 'task_retry' ? 'reprise' : 'echec',
            dureeMs: nombre(p, 'durationMs'),
            coutUsd: d.coutUsd,
            dureeApiMs: d.dureeApiMs,
            jetonsEntree: d.jetonsEntree,
            jetonsSortie: d.jetonsSortie,
            modeles: d.modeles,
          },
          'tentatives',
          tronques,
        );
        break;
      }
      case 'validation_recorded': {
        const v = p.validation;
        if (!tache || typeof v !== 'object' || v === null || Array.isArray(v)) break;
        const brut = v as Record<string, unknown>;
        const etats: Partial<Record<ValidationKey, ValidationState>> = {};
        for (const k of VALIDATION_KEYS) {
          const etat = brut[k];
          if (estEtatDeValidation(etat)) etats[k] = etat;
        }
        borne(validations, { tache, etats }, 'validations', tronques);
        break;
      }
      case 'livraison_locale': {
        // La branche de mission COMMITÉE pendant cette mission — lue du
        // journal de la mission, pas de toutes les branches du projet.
        const branche = texte(p, 'branche');
        if (texte(p, 'etat') === 'commitee' && branche) branchesMission.add(branche);
        break;
      }
      case 'contre_expertise_verdict':
        if (tache && typeof p.conteste === 'boolean') {
          borne(relectures, { tache, conteste: p.conteste }, 'relectures', tronques);
        }
        break;
      case 'rejeu_action_simulee':
      case 'rejeu_action_validee': {
        const genre = texte(p, 'genre');
        const cible = texte(p, 'cible');
        if (!genre || !cible || !(GENRES_IRREVERSIBLES as readonly string[]).includes(genre)) {
          break;
        }
        borne(
          actionsRejeu,
          {
            genre: genre as GenreIrreversible,
            cible,
            issue: e.type === 'rejeu_action_simulee' ? 'simulee' : 'validee',
            ts: e.ts,
          },
          'actionsRejeu',
          tronques,
        );
        break;
      }
      case 'task_reviewed':
      case 'evaluator_overridden':
      case 'evaluator_retry_skipped':
      case 'swarm_level_set':
      case 'council_decided':
      case 'balance_cap_set':
        borne(
          decisions,
          {
            type: e.type,
            ts: e.ts,
            tache,
            valeur:
              texte(p, 'state') ??
              texte(p, 'decision') ??
              texte(p, 'niveau') ??
              texte(p, 'issue') ??
              texte(p, 'reason'),
          },
          'decisions',
          tronques,
        );
        break;
      default:
        break;
    }
  }

  const refs = new Set(entrees.taches.map((t) => t.id));
  return {
    version: VERSION_INSTANTANE_MISSION,
    moment: entrees.moment,
    prisA: entrees.prisA,
    mission: { ...entrees.mission },
    projet: { ...entrees.projet },
    plan: planDe(entrees),
    modeles: {
      commandes: trie(commandes),
      declares: trie(declares),
      offerts: trie(entrees.modelesOfferts),
    },
    routage: { ...entrees.routage },
    genome: {
      empreinte: entrees.genome.empreinte,
      antecedents: [...entrees.genome.antecedents]
        .map((a) => ({ cle: a.cle, essais: a.essais, recompenseTotale: a.recompenseTotale }))
        .sort((a, b) => a.cle.localeCompare(b.cle)),
    },
    autonomie: { ...entrees.autonomie },
    gardeFous: entrees.gardeFous ? { ...entrees.gardeFous } : null,
    artefacts: {
      branches: trie(
        entrees.taches.map((t) => t.branch).filter((b): b is string => typeof b === 'string'),
      ),
      livraisons: entrees.livraisons
        .filter((l) => refs.has(l.taskId))
        .map((l) => ({ tache: l.taskId, pr: l.pr, etat: l.etat })),
      branchesMission: trie(branchesMission),
    },
    decisions,
    faits: { tentatives, validations, relectures, actionsRejeu, tronques: trie(tronques) },
    journal: { ...entrees.journal },
    rejeu: entrees.rejeu ? { ...entrees.rejeu, surcharges: { ...entrees.rejeu.surcharges } } : null,
  };
}

/**
 * Lecture DÉFENSIVE d'un instantané relu de la base. Un format d'une autre
 * version (ou abîmé) rend `null` : on ne rejoue ni ne compare ce qu'on ne sait
 * pas lire.
 */
export function lireInstantane(brut: unknown): InstantaneMission | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const i = brut as Partial<InstantaneMission>;
  if (i.version !== VERSION_INSTANTANE_MISSION) return null;
  if (!i.plan || !Array.isArray(i.plan.taches) || !i.faits || !i.mission || !i.projet) return null;
  return i as InstantaneMission;
}

// ─── Le plan d'un rejeu ──────────────────────────────────────────────────────

export interface TacheDeRejeu {
  id: string;
  title: string;
  prompt: string;
  dependsOn: string[];
}

export type PlanDeRejeu = { ok: true; taches: TacheDeRejeu[] } | { ok: false; motif: string };

/**
 * Les tâches à recréer pour rejouer une mission, depuis son instantané de
 * DÉBUT — le plan tel qu'il est parti, avant corrections et délégations.
 *
 * Les identifiants sont neufs (`<prefixe>-<nnn>`) et les dépendances REMAPPÉES,
 * comme pour un brief : renuméroter sans remapper casserait le graphe en
 * silence. Une dépendance hors du plan rejoué est retirée — elle pointait vers
 * une tâche que ce rejeu ne recrée pas, et l'attendre bloquerait pour toujours.
 */
export function planDeRejeu(instantane: InstantaneMission, prefixe: string): PlanDeRejeu {
  if (!instantane.plan.complet) {
    return {
      ok: false,
      motif: `plan incomplet dans l’instantané (${instantane.plan.manques.join(' ; ')}) : un rejeu serait infidèle`,
    };
  }
  const plan = instantane.plan.taches.filter((t) => t.genre === 'plan');
  if (plan.length === 0) return { ok: false, motif: 'aucune tâche planifiée à rejouer' };
  // Numéros à trois chiffres : l'ordre de création (même milliseconde) se
  // départage par identifiant, et « -10 » ne doit pas passer avant « -2 ».
  const ids = new Map(plan.map((t, i) => [t.ref, `${prefixe}-${String(i + 1).padStart(3, '0')}`]));
  const taches: TacheDeRejeu[] = [];
  for (const t of plan) {
    if (t.prompt === null) return { ok: false, motif: `prompt manquant pour « ${t.titre} »` };
    taches.push({
      id: ids.get(t.ref)!,
      title: t.titre,
      prompt: t.prompt,
      dependsOn: t.dependsOn.map((d) => ids.get(d)).filter((d): d is string => d !== undefined),
    });
  }
  return { ok: true, taches };
}

// ─── Le résumé d'une mission, et la comparaison de deux ──────────────────────

export type Compte<K extends string> = Record<K, number>;

export interface ResumeMission {
  missionId: string;
  /** L'instantané résumé n'est pas celui de fin : la mission est encore en vol. */
  provisoire: boolean;
  /** Les tâches du PLAN seulement, par statut raconté. */
  taches: Compte<StatutMission>;
  /** Toutes les tâches du plan terminées `done` — `inconnu` en vol. */
  reussie: boolean | 'inconnu';
  cout: SommeDeclaree | 'inconnu';
  dureeApiMs: SommeDeclaree | 'inconnu';
  /** Temps machine déclaré par les ouvrières, tentative par tentative. */
  dureeOuvrieresMs: SommeDeclaree | 'inconnu';
  /** Ouverture → clôture, mesurées par la Reine. `inconnu` tant qu'elle vole. */
  dureeMurMs: number | 'inconnu';
  tentatives: number;
  validations: Record<ValidationKey, Compte<ValidationState>>;
  relectures: { contestees: number; validees: number };
  revuesHumaines: { approuvees: number; rejetees: number };
  decisions: Record<string, number>;
  actionsRejeu: { simulees: number; validees: number };
  modeles: InstantaneMission['modeles'];
  journalComplet: boolean;
  faitsTronques: string[];
}

const zeroValidation = (): Compte<ValidationState> => ({
  passed: 0,
  failed: 0,
  missing: 0,
  not_applicable: 0,
});

/**
 * Résume une mission depuis son instantané le plus récent (celui de fin, ou un
 * relevé provisoire tant qu'elle vole). Chaque somme porte sa couverture.
 */
export function resumerMission(instantane: InstantaneMission, provisoire: boolean): ResumeMission {
  const taches = Object.fromEntries(STATUTS_MISSION.map((s) => [s, 0])) as Compte<StatutMission>;
  const plan = instantane.plan.taches.filter((t) => t.genre === 'plan');
  for (const t of plan) taches[t.statut] += 1;
  const f = instantane.faits;
  const validations = Object.fromEntries(
    VALIDATION_KEYS.map((k) => [k, zeroValidation()]),
  ) as Record<ValidationKey, Compte<ValidationState>>;
  for (const v of f.validations) {
    for (const k of VALIDATION_KEYS) {
      const etat = v.etats[k];
      if (etat) validations[k][etat] += 1;
    }
  }
  const decisions: Record<string, number> = {};
  let approuvees = 0;
  let rejetees = 0;
  for (const d of instantane.decisions) {
    decisions[d.type] = (decisions[d.type] ?? 0) + 1;
    if (d.type === 'task_reviewed' && d.valeur === 'approved') approuvees += 1;
    if (d.type === 'task_reviewed' && d.valeur === 'rejected') rejetees += 1;
  }
  const { ouverteA, closeA } = instantane.mission;
  return {
    missionId: instantane.mission.id,
    provisoire,
    taches,
    reussie: provisoire ? 'inconnu' : plan.length > 0 && plan.every((t) => t.statut === 'done'),
    cout: sommeDeclaree(f.tentatives.map((t) => t.coutUsd)),
    dureeApiMs: sommeDeclaree(f.tentatives.map((t) => t.dureeApiMs)),
    dureeOuvrieresMs: sommeDeclaree(f.tentatives.map((t) => t.dureeMs)),
    dureeMurMs: !provisoire && closeA !== null ? Math.max(0, closeA - ouverteA) : 'inconnu',
    tentatives: f.tentatives.length,
    validations,
    relectures: {
      contestees: f.relectures.filter((r) => r.conteste).length,
      validees: f.relectures.filter((r) => !r.conteste).length,
    },
    revuesHumaines: { approuvees, rejetees },
    decisions,
    actionsRejeu: {
      simulees: f.actionsRejeu.filter((a) => a.issue === 'simulee').length,
      validees: f.actionsRejeu.filter((a) => a.issue === 'validee').length,
    },
    modeles: instantane.modeles,
    journalComplet: instantane.journal.complet,
    faitsTronques: f.tronques,
  };
}

/** Un écart : calculé seulement quand LES DEUX côtés sont connus. */
export interface EcartDeclare {
  /** `rejeu − original`, ou `inconnu` si l'un des deux n'a rien déclaré. */
  ecart: number | 'inconnu';
  /**
   * Les deux couvertures sont-elles complètes (toutes les tentatives ont
   * déclaré) ? Un écart entre deux sommes partielles compare des « au moins ».
   */
  couvertureComplete: boolean;
}

export interface ComparaisonMissions {
  original: ResumeMission;
  rejeu: ResumeMission;
  ecarts: {
    cout: EcartDeclare;
    dureeApiMs: EcartDeclare;
    dureeOuvrieresMs: EcartDeclare;
    dureeMurMs: number | 'inconnu';
    tentatives: number;
    tachesReussies: number;
    testsPasses: number;
    testsEchoues: number;
    relecturesContestees: number;
  };
  /** Les deux instantanés ont-ils un journal complet ? Sinon, les faits sont partiels. */
  journauxComplets: boolean;
}

function ecartDeclare(a: SommeDeclaree | 'inconnu', b: SommeDeclaree | 'inconnu'): EcartDeclare {
  if (a === 'inconnu' || b === 'inconnu') return { ecart: 'inconnu', couvertureComplete: false };
  return {
    ecart: b.total - a.total,
    couvertureComplete: a.declarees === a.tentatives && b.declarees === b.tentatives,
  };
}

/**
 * Compare une mission et son rejeu, sur les seules données DÉCLARÉES ou
 * mesurées par la Reine. Aucun classement, aucune note : des écarts, chacun
 * avec ce qui permet de le croire (couverture, journal complet, provisoire).
 */
export function comparerMissions(
  original: ResumeMission,
  rejeu: ResumeMission,
): ComparaisonMissions {
  return {
    original,
    rejeu,
    ecarts: {
      cout: ecartDeclare(original.cout, rejeu.cout),
      dureeApiMs: ecartDeclare(original.dureeApiMs, rejeu.dureeApiMs),
      dureeOuvrieresMs: ecartDeclare(original.dureeOuvrieresMs, rejeu.dureeOuvrieresMs),
      dureeMurMs:
        original.dureeMurMs === 'inconnu' || rejeu.dureeMurMs === 'inconnu'
          ? 'inconnu'
          : rejeu.dureeMurMs - original.dureeMurMs,
      tentatives: rejeu.tentatives - original.tentatives,
      tachesReussies: rejeu.taches.done - original.taches.done,
      testsPasses: rejeu.validations.tests.passed - original.validations.tests.passed,
      testsEchoues: rejeu.validations.tests.failed - original.validations.tests.failed,
      relecturesContestees: rejeu.relectures.contestees - original.relectures.contestees,
    },
    journauxComplets: original.journalComplet && rejeu.journalComplet,
  };
}

/**
 * Valide les surcharges d'un rejeu. Le niveau d'autonomie est validé par
 * l'appelant (la liste vit dans `orchestrator/essaim.ts`) : ce module ne
 * connaît que sa forme.
 */
export function validerSurcharges(
  brut: SurchargesRejeu,
  niveaux: readonly string[],
): { ok: true; surcharges: SurchargesRejeu } | { ok: false; motif: string } {
  const surcharges: SurchargesRejeu = {};
  if (brut.modele !== undefined) {
    const m = brut.modele.trim();
    if (m.length === 0 || m.length > MAX_NOM_MODELE || !/^[\w.:/@-]+$/.test(m)) {
      return { ok: false, motif: 'nom de modèle invalide' };
    }
    surcharges.modele = m;
  }
  if (brut.politiqueRoutage !== undefined) {
    if (!(POLITIQUES_ROUTAGE as readonly string[]).includes(brut.politiqueRoutage)) {
      return { ok: false, motif: 'politique de routage inconnue' };
    }
    surcharges.politiqueRoutage = brut.politiqueRoutage;
  }
  if (brut.autonomie !== undefined) {
    if (!niveaux.includes(brut.autonomie))
      return { ok: false, motif: 'niveau d’autonomie inconnu' };
    surcharges.autonomie = brut.autonomie;
  }
  return { ok: true, surcharges };
}
