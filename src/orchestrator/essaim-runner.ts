// Le runner d'essaim — ce qui fait qu'une ruche autonome tourne VRAIMENT.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// `essaim.ts` sait décider (`deciderPas`), et `/api/projects/:id/essaim` sait
// répondre. Mais personne n'appelait jamais cette décision en boucle : le
// « Plein Essaim » affichait ce que la ruche FERAIT, sans jamais le faire. Le
// bouton d'autonomie était honnête sur son verdict et muet sur son effet.
//
// ─── POURQUOI CE FICHIER EST LE PLUS DANGEREUX DU DÉPÔT ──────────────────────
//
// C'est le seul endroit où la ruche agit sans qu'un humain ait cliqué. Une
// boucle qui se trompe ici ne rend pas un mauvais résultat : elle dépense le
// temps-machine prêté par les membres, ouvre des pull requests, et fusionne du
// code — en continu, la nuit, sans que personne regarde. Tout ce qui suit est
// écrit contre ce risque-là.
//
// QUATRE GARDE-FOUS, et chacun répond à une façon précise de tout casser :
//
//   1. DEUX INTERRUPTEURS EN SÉRIE. Le niveau d'autonomie est le choix de
//      l'utilisateur ; `HIVE_RUNNER` est celui de l'hôte — celui qui PAIE le
//      temps-machine. Un projet réglé sur « plein essaim » ne fait rien tant
//      que l'hôte n'a pas allumé sa ruche. Défaut : ÉTEINT. Une fonctionnalité
//      qui dépense de l'argent ne s'active pas par le seul fait d'exister.
//
//   2. UN SEUL CYCLE À LA FOIS PAR PROJET, et la cadence se compte depuis la
//      FIN du précédent. Compter depuis le début ferait ré-entrer
//      immédiatement dès qu'un cycle dépasse la cadence — c'est-à-dire
//      précisément quand la ruche est déjà en difficulté.
//
//   3. RECUL EXPONENTIEL PUIS PAUSE. Un pas qui échoue est retenté de plus en
//      plus tard, et après cinq échecs de suite la ruche cesse d'y toucher.
//      Sans cela, une action qui échoue à coup sûr — un dépôt injoignable, un
//      quota d'API épuisé — brûlerait le budget en la retentant chaque minute
//      jusqu'au matin.
//
//   4. RELECTURE AVANT D'AGIR. Entre la décision et l'effet, on relit les deux
//      interrupteurs. C'est ce qui rend le gros bouton rouge crédible : arrêter
//      la ruche l'arrête AVANT l'effet, pas au tour suivant.
//
// ─── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
//
// Il ne décide de rien. Le pas vient de `deciderPas`, pur et testé ailleurs ;
// ici on ne fait que cadencer et exécuter. Un runner qui aurait son mot à dire
// serait une seconde politique, invisible à côté de la première.
//
// MODULE PUR pour tout ce qui cadence. Les effets sont injectés.

import type { Decision, NiveauAutonomie, Pas } from './essaim.js';

/** Version du runner. Motif VERSION_BALANCE. */
export const VERSION_RUNNER = 1;

/**
 * Cadence minimale entre deux cycles d'un même projet.
 *
 * Une minute, et pas deux secondes comme le tick du scheduler. Un cycle
 * d'essaim peut ouvrir un conseil ou créer des tâches : le rythme n'est pas
 * celui d'une boucle d'ordonnancement mais celui d'une décision.
 */
export const CADENCE_MS = 60_000;

/**
 * Premier recul après un échec ; il double ensuite.
 *
 * DEUX fois la cadence, et ce facteur est le minimum utile : à une seule
 * cadence, le premier recul serait exactement le rythme normal — un échec ne
 * changerait donc rien au premier essai suivant, et le recul ne commencerait à
 * mordre qu'au deuxième échec. Un garde-fou qui ne fait rien la première fois
 * n'est pas un garde-fou.
 */
export const RECUL_MIN_MS = 2 * CADENCE_MS;

/** Plafond du recul. Au-delà, retenter plus tard n'informe plus. */
export const RECUL_MAX_MS = 30 * 60_000;

/**
 * Échecs consécutifs avant que la ruche cesse d'y toucher.
 *
 * Cinq. La pause n'est PAS un abandon : elle attend un geste humain (régler à
 * nouveau l'autonomie du projet), parce qu'un runner qui se ré-autoriserait
 * lui-même après un délai retomberait dans la boucle qu'on cherche à éviter —
 * même invariant que le déblocage de plafond de La Balance.
 */
export const ECHECS_AVANT_PAUSE = 5;

/** Le commutateur de l'hôte. `off` par défaut. */
export const MODES_RUNNER = ['off', 'on'] as const;
export type ModeRunner = (typeof MODES_RUNNER)[number];

export function modeRunnerDepuisEnv(env: NodeJS.ProcessEnv = process.env): ModeRunner {
  return (env.HIVE_RUNNER ?? '').trim() === 'on' ? 'on' : 'off';
}

/**
 * Les pas qui DEMANDENT un effet.
 *
 * Le complément (`inerte`, `halte`, `plafond`, `butiner`, `repos`) n'est pas
 * « rien à faire » par oubli : ce sont des décisions de NE PAS agir, et elles
 * sont journalisées comme telles. Une ruche qui se tait parce qu'elle a halté
 * doit être discernable d'une ruche qui se tait parce que le runner est cassé.
 */
export const PAS_AGISSANTS: readonly Pas[] = [
  'deliberer',
  'planifier',
  'corriger',
  'livrer',
  'fusionner',
];

export function agit(pas: Pas): boolean {
  return PAS_AGISSANTS.includes(pas);
}

/** Recul après `n` échecs consécutifs (n ≥ 1). */
export function recul(n: number): number {
  if (n <= 0) return 0;
  const brut = RECUL_MIN_MS * 2 ** (n - 1);
  return Math.min(RECUL_MAX_MS, brut);
}

// ─── Le suivi d'un projet ────────────────────────────────────────────────────

export interface Suivi {
  projectId: string;
  /** Instant de FIN du dernier cycle. `0` = jamais tourné. */
  dernierTourA: number;
  /** Échecs consécutifs ; remis à zéro par un cycle réussi. */
  echecs: number;
  /** Rien avant cet instant (recul). */
  pasAvant: number;
  /** Un cycle est-il en vol ? */
  enVol: boolean;
}

export function suiviNeuf(projectId: string): Suivi {
  return { projectId, dernierTourA: 0, echecs: 0, pasAvant: 0, enVol: false };
}

/** La ruche a-t-elle renoncé à ce projet en attendant un geste humain ? */
export function enPause(s: Suivi): boolean {
  return s.echecs >= ECHECS_AVANT_PAUSE;
}

/**
 * Ce projet peut-il tourner maintenant ?
 *
 * TROIS refus distincts, et ils ne se confondent pas : un cycle déjà en vol, un
 * recul en cours, une cadence pas écoulée. Les fondre en un seul booléen
 * rendrait impossible d'expliquer pourquoi une ruche ne bouge pas.
 */
export function doitTourner(s: Suivi, now: number): boolean {
  if (s.enVol) return false;
  if (enPause(s)) return false;
  if (now < s.pasAvant) return false;
  return now - s.dernierTourA >= CADENCE_MS;
}

export function demarrer(s: Suivi): Suivi {
  return { ...s, enVol: true };
}

/**
 * Fin d'un cycle réussi.
 *
 * `dernierTourA` prend l'instant de FIN, pas celui du début : sans quoi un
 * cycle plus long que la cadence autoriserait le suivant immédiatement — donc
 * exactement quand la ruche peine déjà.
 */
export function apresSucces(s: Suivi, now: number): Suivi {
  return { ...s, enVol: false, echecs: 0, pasAvant: 0, dernierTourA: now };
}

export function apresEchec(s: Suivi, now: number): Suivi {
  const echecs = s.echecs + 1;
  return { ...s, enVol: false, echecs, dernierTourA: now, pasAvant: now + recul(echecs) };
}

/** Geste humain : la pause est levée, les compteurs repartent à zéro. */
export function reprendre(s: Suivi): Suivi {
  return { ...s, echecs: 0, pasAvant: 0 };
}

// ─── Le cycle, avec ses effets injectés ──────────────────────────────────────

/**
 * Ce que le runner sait faire du monde. Une méthode par pas agissant.
 *
 * Chacune rend un compte rendu court, journalisé tel quel. Une méthode ABSENTE
 * n'est pas une erreur : c'est un pas pas encore branché, et le cycle le DIT
 * (`non_branche`) au lieu de ne rien faire en silence. La différence compte —
 * une ruche qui ne livre pas parce que la livraison n'est pas câblée doit être
 * discernable d'une ruche qui n'a rien à livrer.
 */
export interface ActionsEssaim {
  deliberer?(projectId: string): Promise<string>;
  planifier?(projectId: string): Promise<string>;
  corriger?(projectId: string, decision: Decision): Promise<string>;
  livrer?(projectId: string): Promise<string>;
  fusionner?(projectId: string): Promise<string>;
}

export interface DependancesRunner {
  /** L'état + la décision d'un projet, tels que le serveur les calcule déjà. */
  lireDecision(projectId: string): Decision;
  /** Le niveau réglé pour ce projet, relu JUSTE AVANT d'agir. */
  lireNiveau(projectId: string): NiveauAutonomie;
  /** Le commutateur de l'hôte, relu JUSTE AVANT d'agir. */
  lireMode(): ModeRunner;
  actions: ActionsEssaim;
  /** Journalise un fait typé. */
  emettre(type: string, payload: Record<string, unknown>): void;
  now?: () => number;
}

export type IssueCycle =
  /** Le pas ne demandait aucun effet (halte, plafond, butiner, repos, inerte). */
  | 'observe'
  /** L'effet a été exécuté. */
  | 'agi'
  /** Le pas demande un effet qu'aucune action ne sait rendre. */
  | 'non_branche'
  /** Un interrupteur s'est fermé entre la décision et l'effet. */
  | 'abandonne'
  /** L'action a levé. */
  | 'echoue';

export interface Rapport {
  projectId: string;
  pas: Pas;
  issue: IssueCycle;
  motif: string;
  /** Compte rendu de l'action, ou le message d'erreur. */
  detail: string;
}

/**
 * Un cycle pour UN projet.
 *
 * Ne lève jamais : une exception d'action devient `echoue`, et le cadencier
 * s'en occupe. Une boucle d'autonomie qui remonterait ses exceptions arrêterait
 * la ruche entière au premier dépôt injoignable.
 */
export async function faireUnTour(projectId: string, deps: DependancesRunner): Promise<Rapport> {
  const decision = deps.lireDecision(projectId);
  const base = { projectId, pas: decision.pas, motif: decision.motif };

  if (!agit(decision.pas)) {
    // Journalisé quand même : c'est ainsi qu'on distingue « la ruche a halté »
    // de « le runner ne tourne plus ».
    deps.emettre('essaim_cycle', { ...base, issue: 'observe' });
    return { ...base, issue: 'observe', detail: '' };
  }

  // RELECTURE AVANT L'EFFET. Le gros bouton rouge doit arrêter la ruche avant
  // qu'elle agisse, pas au tour d'après.
  if (deps.lireMode() !== 'on' || deps.lireNiveau(projectId) === 'off') {
    deps.emettre('essaim_cycle', { ...base, issue: 'abandonne' });
    return { ...base, issue: 'abandonne', detail: 'autonomie coupée pendant le cycle' };
  }

  const action = deps.actions[decision.pas as keyof ActionsEssaim];
  if (!action) {
    deps.emettre('essaim_cycle', { ...base, issue: 'non_branche' });
    return { ...base, issue: 'non_branche', detail: `pas « ${decision.pas} » pas encore branché` };
  }

  try {
    const detail =
      decision.pas === 'corriger'
        ? await deps.actions.corriger!(projectId, decision)
        : await (action as (id: string) => Promise<string>)(projectId);
    deps.emettre('essaim_cycle', { ...base, issue: 'agi', detail });
    return { ...base, issue: 'agi', detail };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    deps.emettre('essaim_cycle', { ...base, issue: 'echoue', detail });
    return { ...base, issue: 'echoue', detail };
  }
}

/** Un cycle a-t-il réussi, du point de vue du cadencier ? */
export function estUnSucces(r: Rapport): boolean {
  // `non_branche` compte comme un SUCCÈS : ce n'est pas une panne, c'est une
  // fonctionnalité absente. Le compter en échec ferait reculer puis mettre en
  // pause un projet parfaitement sain, et l'humain chercherait la panne là où
  // il n'y en a pas.
  return r.issue !== 'echoue';
}

// ─── Le cadencier : qui tourne, et quand ─────────────────────────────────────

/**
 * Tient le suivi de chaque projet et n'en laisse tourner qu'un à la fois.
 *
 * UN SEUL cycle simultané pour toute la ruche, pas un par projet : deux
 * délibérations qui partent ensemble doublent la facture de la minute, et la
 * seconde n'a pas vu ce que la première a décidé. La gouvernance avance d'un
 * pas à la fois, c'est déjà la règle de `deciderPas` ; le cadencier la tient
 * aussi entre projets.
 */
export class Cadencier {
  private readonly suivis = new Map<string, Suivi>();
  private enVol = false;

  constructor(private readonly deps: DependancesRunner) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  suivi(projectId: string): Suivi {
    return this.suivis.get(projectId) ?? suiviNeuf(projectId);
  }

  /** Geste humain sur un projet : la pause est levée. */
  reprendre(projectId: string): void {
    this.suivis.set(projectId, reprendre(this.suivi(projectId)));
  }

  /** Oublie un projet (supprimé). Borne la carte. */
  oublier(projectId: string): void {
    this.suivis.delete(projectId);
  }

  /** Projets suivis, pour l'observation. */
  etat(): Suivi[] {
    return [...this.suivis.values()].sort((a, b) => a.projectId.localeCompare(b.projectId));
  }

  /**
   * Fait tourner AU PLUS un projet parmi ceux qui sont éligibles.
   *
   * Le premier éligible dans l'ordre donné — et l'appelant passe les projets
   * triés, donc l'ordre est stable. Rend le rapport, ou `null` si rien n'a
   * tourné (ruche éteinte, cadence, recul, cycle en vol).
   */
  async tour(projetsActifs: readonly string[]): Promise<Rapport | null> {
    if (this.enVol) return null;
    if (this.deps.lireMode() !== 'on') return null;

    const now = this.now();
    const choisi = projetsActifs.find((id) => doitTourner(this.suivi(id), now));
    if (!choisi) return null;

    this.enVol = true;
    this.suivis.set(choisi, demarrer(this.suivi(choisi)));
    try {
      const rapport = await faireUnTour(choisi, this.deps);
      const fin = this.now();
      const suivant = estUnSucces(rapport)
        ? apresSucces(this.suivi(choisi), fin)
        : apresEchec(this.suivi(choisi), fin);
      this.suivis.set(choisi, suivant);
      if (enPause(suivant)) {
        this.deps.emettre('essaim_pause', {
          projectId: choisi,
          echecs: suivant.echecs,
          motif: rapport.detail,
        });
      }
      return rapport;
    } finally {
      // `enVol` retombe MÊME si `faireUnTour` a levé contre toute attente :
      // sans ce `finally`, la ruche entière resterait figée pour toujours sur
      // une seule exception inattendue.
      this.enVol = false;
      const s = this.suivis.get(choisi);
      if (s?.enVol) this.suivis.set(choisi, { ...s, enVol: false });
    }
  }
}
