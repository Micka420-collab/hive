// Les missions rejouables, côté Reine : QUAND prendre les instantanés, COMMENT
// créer un rejeu, et LA PORTE que franchit toute action irréversible d'un rejeu.
//
// Le format, le plan de rejeu et la comparaison sont purs et vivent dans
// `shared/mission-rejouable.ts` ; ce module rassemble les faits dans le
// magasin et écrit. Le serveur ne fait que brancher : le suivi sur ses deux
// flux d'événements, la porte devant chaque effet irréversible.
//
// ─── QUAND UNE MISSION S'OUVRE, QUAND ELLE SE CLÔT ───────────────────────────
//
// Aucun geste humain ne dit « la mission commence » : un brief, une issue, un
// plan, une tâche posée à la main, un cycle d'essaim, un conseil, un motif, la
// Fabrique, une restauration — tous créent des tâches par des chemins
// différents, et TOUS n'émettent pas de naissance (`task_created`) : un motif
// appliqué ou une exploration de conseil n'en disent rien. Ce que toute tâche
// qui TRAVAILLE partage, c'est son affectation (`task_assigned`) : aucune ne
// part sur une ouvrière sans elle. Le suivi écoute donc les naissances quand
// elles existent, les affectations toujours, les RÉANIMATIONS (`task_retry`,
// `task_requeued` : une tâche finie que l'Evaluator relance revit) et les
// issues terminales — et décide sur l'ÉTAT, jamais sur l'événement seul :
//
//   · une tâche vit sur un projet qui n'a pas de mission ouverte → ouverture,
//     et l'instantané de DÉBUT (au plus tard à la première affectation : avant
//     qu'aucun travail ne soit rendu) ;
//   · une mission ouverte n'a plus AUCUNE tâche en vol (relectures comprises)
//     → clôture, et l'instantané de FIN ;
//   · une décision tombe APRÈS la clôture sur une tâche de la dernière mission
//     (relecture humaine, livraison, action de rejeu) → l'instantané de fin est
//     RE-PRIS : livrer exige une tâche finie et approuvée, donc ces décisions
//     arrivent presque toujours mission close — les laisser dehors ferait
//     compter zéro là où il y a eu une décision.
//
// L'APPARTENANCE est RANGÉE (`missions_taches`), jamais déduite des dates :
// les tâches en vol à l'ouverture, celles nées ou ranimées tant qu'elle vole.
// Une tâche ranimée garde sa vieille naissance ; « née depuis la plus vieille
// vivante » faisait avaler à la mission suivante tout le plan de la précédente.
//
// La décision est DIFFÉRÉE d'un tour de boucle (`setImmediate`) : un brief crée
// dix tâches et émet dix naissances dans le même geste synchrone ; décider à
// la première aurait figé un plan d'une tâche. Et une production rendue ouvre
// ses relectures dans le même geste que son `task_done` : décider aussitôt
// aurait clos la mission entre la production et sa relecture. Différer, c'est
// aussi ne JAMAIS écrire depuis l'intérieur d'une transaction de résultat
// (#468 : effets après le commit) — le suivi ne fait que lire, puis programme.

import { createHash, randomUUID } from 'node:crypto';
import {
  comparerMissions,
  construireInstantane,
  lireInstantane,
  planDeRejeu,
  resumerMission,
  TYPES_MISSION,
} from '../shared/mission-rejouable.js';
import type {
  AntecedentFige,
  ComparaisonMissions,
  GenreIrreversible,
  InstantaneMission,
  MomentMission,
  OrigineRejeu,
  PolitiqueRoutage,
  ResumeMission,
  SurchargesRejeu,
} from '../shared/mission-rejouable.js';
import { sansIdentifiants } from '../shared/projet-public.js';
import type { HiveEvent, Project, Task } from '../shared/types.js';
import { antecedentsDuVecu, CORPUS_AIGUILLAGE, VERSION_AIGUILLAGE } from './aiguillage.js';
import type { Antecedent } from './aiguillage.js';
import { versEchelon } from './garde-fou.js';
import type { HiveStore, MissionRangee } from './store.js';

type Emettre = (type: string, payload: Record<string, unknown>) => void;

/** Ce qui fait (ou peut faire) vivre une tâche, et ce qui la termine. */
const CYCLE_DE_VIE = new Set([
  'task_created',
  'swarm_task_created',
  'task_assigned',
  'task_retry',
  'task_requeued',
  'task_done',
  'task_failed',
  'task_cancelled',
]);
/**
 * Les décisions qui tombent d'ordinaire APRÈS la clôture (voir l'en-tête) :
 * elles re-prennent l'instantané de fin de la dernière mission close.
 */
const DECISIONS_TARDIVES = new Set([
  'task_reviewed',
  'validation_recorded',
  'contre_expertise_verdict',
  'evaluator_overridden',
  'delivery_opened',
  'livraison_locale',
  'rejeu_action_simulee',
  'rejeu_action_validee',
]);

/** Missions gardées par projet — au-delà, l'élagueur retire les plus vieilles. */
export const MISSIONS_PAR_PROJET = 20;

/** Le Genome tel que l'Aiguillage le lit aujourd'hui (verdicts seulement). */
function genomeCourant(store: HiveStore): { empreinte: string; antecedents: AntecedentFige[] } {
  // Les élections EN VOL ne sont pas du vécu : elles comptent dans le score du
  // jour (borne du troupeau), pas dans ce qu'on fige pour rejouer plus tard.
  const vecu = antecedentsDuVecu(store.observationsAiguillage(), []);
  const figer = (niveau: AntecedentFige['niveau'], m: ReadonlyMap<string, Antecedent>) =>
    [...m].map(([cle, a]): AntecedentFige => ({
      niveau,
      cle,
      essais: a.essais,
      recompenseTotale: a.recompenseTotale,
      ...(a.coutsDeclares ? { coutTotal: a.coutTotal ?? 0, coutsDeclares: a.coutsDeclares } : {}),
    }));
  // Ordre par unités de code, jamais `localeCompare` : l'empreinte ne doit pas
  // dépendre de la locale du processus (même règle que `departager`).
  const antecedents = [...figer('modele', vecu.modeles), ...figer('bras', vecu.bras)].sort(
    (a, b) =>
      a.niveau < b.niveau
        ? -1
        : a.niveau > b.niveau
          ? 1
          : a.cle < b.cle
            ? -1
            : a.cle > b.cle
              ? 1
              : 0,
  );
  // L'empreinte EST la version du Genome : deux instantanés qui la partagent
  // ont vu exactement le même vécu.
  const empreinte = createHash('sha256')
    .update(JSON.stringify(antecedents))
    .digest('hex')
    .slice(0, 16);
  return { empreinte, antecedents };
}

/**
 * L'instantané d'une mission, À CET INSTANT. Pur du point de vue du magasin :
 * il ne fait que lire.
 */
export function instantaneDe(
  store: HiveStore,
  projet: Project,
  mission: { id: string; ouverteA: number; closeA: number | null; depuisEvenement: number },
  moment: MomentMission,
  prisA: number,
  membres: readonly string[] = store.membresDeMission(mission.id),
): InstantaneMission {
  const taches: Task[] = store.tachesParIds(membres);
  const roles = store.rolesDesTaches(taches.map((t) => t.id));
  const essaim = store.getEssaim(projet.id);
  const gardeFou = store.getGardeFou(projet.id);
  const plafond = store.getBudget(projet.id);
  const rejeu = store.rejeuDuProjet(projet.id);
  const origine: OrigineRejeu | null = rejeu
    ? {
        missionSource: rejeu.missionSource,
        projetSource: rejeu.projetSource,
        surcharges: rejeu.surcharges as SurchargesRejeu,
      }
    : null;
  return construireInstantane({
    moment,
    prisA,
    mission: { id: mission.id, ouverteA: mission.ouverteA, closeA: mission.closeA },
    projet: { id: projet.id, nom: projet.name, depot: sansIdentifiants(projet.repoUrl) },
    taches,
    relectures: roles.relectures,
    deleguees: roles.deleguees,
    evenements: store.evenementsDeMission(
      projet.id,
      membres,
      mission.depuisEvenement,
      TYPES_MISSION,
    ),
    journal: {
      complet: store.journalCouvre(mission.depuisEvenement),
      depuisEvenement: mission.depuisEvenement,
      jusquA: store.lastEventId(),
    },
    modelesOfferts: store.listNodes().flatMap((n) => n.modeles ?? []),
    genome: genomeCourant(store),
    routage: {
      versionAiguillage: VERSION_AIGUILLAGE,
      corpus: CORPUS_AIGUILLAGE,
      politique: (rejeu?.surcharges.politiqueRoutage as PolitiqueRoutage | undefined) ?? 'apprise',
    },
    autonomie: {
      niveau: essaim?.niveau ?? 'off',
      depotInscrit: essaim?.depotInscrit ?? false,
    },
    gardeFous: gardeFou
      ? { actif: gardeFou.actif, borneMin: gardeFou.borneMin, borneMax: gardeFou.borneMax }
      : null,
    budget: plafond ? { plafondMs: plafond.plafondMs } : null,
    livraisons: store.listLivraisons(projet.id).map((l) => ({
      taskId: l.taskId,
      pr: l.pr,
      etat: l.etat,
    })),
    rejeu: origine,
  });
}

/**
 * Le suivi des missions, branché sur les flux d'événements du serveur.
 *
 * `programmer` diffère la décision (défaut : `setImmediate`) ; un banc peut
 * la rendre synchrone. Une erreur est SIGNALÉE, jamais relancée : un
 * instantané raté ne doit pas faire tomber l'ordonnanceur qui a émis.
 */
export function creerSuiviMissions(dep: {
  store: HiveStore;
  emitEvent: Emettre;
  signaler: (err: unknown) => void;
  programmer?: (f: () => void) => void;
  maintenant?: () => number;
}): { suivre: (event: HiveEvent) => void; verifier: (projectId: string) => void } {
  const { store, emitEvent } = dep;
  const programmer = dep.programmer ?? ((f: () => void) => void setImmediate(f));
  const maintenant = dep.maintenant ?? Date.now;
  /**
   * Par projet à relever : le PREMIER événement déclencheur, les tâches du
   * cycle de vie, et les décisions tardives (par tâche, ou sur le projet).
   */
  const aVerifier = new Map<
    string,
    { premier: number; taches: Set<string>; tardives: Set<string>; tardifProjet: boolean }
  >();
  let programme = false;

  const verifier = (
    projectId: string,
    declencheur: { premier: number; taches: ReadonlySet<string> } = {
      premier: Number.POSITIVE_INFINITY,
      taches: new Set(),
    },
  ): void => {
    const projet = store.getProject(projectId);
    if (!projet) return;
    const ouverte = store.missionOuverte(projectId);
    const vivantes = store.compterTachesVivantes(projectId);
    const now = maintenant();
    // Les tâches du déclencheur qui sont bien de CE projet : une tâche née et
    // finie entre deux relevés n'est plus en vol, mais elle était de la mission.
    // Le banc d'ombre n'en est jamais (`HORS_BANC`, store.ts).
    const declarees = [...declencheur.taches].filter(
      (id) => store.getTask(id)?.projectId === projectId && store.ombreLieeA(id) === null,
    );
    if (!ouverte && vivantes > 0) {
      const precedente = store.derniereMissionClose(projectId);
      const ouverteA = store.naissanceDesNouvelles(projectId, precedente?.closeA ?? -1) ?? now;
      const membres = [
        ...new Set([...store.tachesAMissionner(projectId, ouverteA), ...declarees]),
      ].sort();
      // Le journal de la mission commence AVANT sa plus vieille naissance — ou
      // avant l'événement qui l'a déclenchée (une réanimation n'a pas de
      // naissance neuve, mais son `task_retry` est de la mission).
      const depuisEvenement = Math.max(
        0,
        Math.min(store.dernierEvenementAvant(ouverteA), declencheur.premier - 1),
      );
      const mission = { id: randomUUID(), ouverteA, closeA: null, depuisEvenement };
      const debut = instantaneDe(store, projet, mission, 'debut', now, membres);
      const ouverteIci = store.ouvrirMission({
        id: mission.id,
        projectId,
        ouverteA,
        depuisEvenement,
        membres,
        debut: JSON.stringify(debut),
      });
      if (ouverteIci) {
        emitEvent('mission_ouverte', {
          projectId,
          missionId: mission.id,
          taches: debut.plan.taches.length,
          planComplet: debut.plan.complet,
          ...(debut.rejeu ? { rejeuDe: debut.rejeu.missionSource } : {}),
        });
      }
      return;
    }
    if (ouverte) {
      // Ce qui est né ou a été ranimé depuis le dernier relevé rejoint la mission.
      store.ajouterMembresMission(ouverte.id, [
        ...store.tachesAMissionner(projectId, ouverte.ouverteA),
        ...declarees,
      ]);
      if (vivantes > 0) return;
      const fin = instantaneDe(store, projet, { ...ouverte, closeA: now }, 'fin', now);
      if (store.cloreMission(ouverte.id, now, JSON.stringify(fin))) {
        const resume = resumerMission(fin, false);
        emitEvent('mission_close', {
          projectId,
          missionId: ouverte.id,
          reussie: resume.reussie,
          journalComplet: fin.journal.complet,
        });
      }
    }
  };

  /**
   * Une décision tardive revient à la dernière mission CLOSE si elle vise
   * l'une de SES tâches — ou, sans tâche (action de rejeu, livraison locale),
   * si aucune mission ne vole : elle ne peut alors être que de celle-là.
   */
  const rafraichir = (
    projectId: string,
    tardives: ReadonlySet<string>,
    tardifProjet: boolean,
  ): void => {
    const projet = store.getProject(projectId);
    const derniere = store.derniereMissionClose(projectId);
    if (!projet || !derniere) return;
    const membres = store.membresDeMission(derniere.id);
    const siens = new Set(membres);
    const vise =
      [...tardives].some((id) => siens.has(id)) ||
      (tardifProjet && store.missionOuverte(projectId) === null);
    if (!vise) return;
    const fin = instantaneDe(store, projet, derniere, 'fin', maintenant(), membres);
    store.rafraichirFinMission(derniere.id, JSON.stringify(fin));
  };

  const vider = (): void => {
    programme = false;
    const lots = [...aVerifier].sort(([a], [b]) => a.localeCompare(b));
    aVerifier.clear();
    for (const [projectId, declencheur] of lots) {
      try {
        // Le rafraîchissement d'ABORD : une décision sur le projet seul ne
        // revient à la dernière mission close que si aucune autre ne vole —
        // relevé après une ouverture, il ne le saurait plus.
        if (declencheur.tardives.size > 0 || declencheur.tardifProjet) {
          rafraichir(projectId, declencheur.tardives, declencheur.tardifProjet);
        }
        verifier(projectId, declencheur);
      } catch (err) {
        dep.signaler(err);
      }
    }
  };

  const suivre = (event: HiveEvent): void => {
    const cycle = CYCLE_DE_VIE.has(event.type);
    const tardif = DECISIONS_TARDIVES.has(event.type);
    if (!cycle && !tardif) return;
    const taskId = typeof event.payload.taskId === 'string' ? event.payload.taskId : null;
    const projectId =
      typeof event.payload.projectId === 'string'
        ? event.payload.projectId
        : taskId
          ? (store.getTask(taskId)?.projectId ?? null)
          : null;
    if (projectId === null) return;
    const lot = aVerifier.get(projectId) ?? {
      premier: Number.POSITIVE_INFINITY,
      taches: new Set<string>(),
      tardives: new Set<string>(),
      tardifProjet: false,
    };
    if (cycle) {
      lot.premier = Math.min(lot.premier, event.id);
      if (taskId) lot.taches.add(taskId);
    } else if (taskId) lot.tardives.add(taskId);
    else lot.tardifProjet = true;
    aVerifier.set(projectId, lot);
    if (!programme) {
      programme = true;
      programmer(vider);
    }
  };

  return { suivre, verifier: (projectId) => verifier(projectId) };
}

// ─── Relire une mission ──────────────────────────────────────────────────────

/**
 * Le résumé d'une mission : sur son instantané de FIN, ou — tant qu'elle vole
 * — sur un relevé pris maintenant, dit provisoire. `null` : instantané illisible.
 */
export function resumeDeMission(
  store: HiveStore,
  mission: MissionRangee,
  now = Date.now(),
): { resume: ResumeMission; instantane: InstantaneMission } | null {
  if (mission.fin !== null) {
    const fin = lireInstantaneBrut(mission.fin);
    return fin ? { resume: resumerMission(fin, false), instantane: fin } : null;
  }
  const projet = store.getProject(mission.projectId);
  if (!projet) return null;
  const courant = instantaneDe(store, projet, mission, 'fin', now);
  return { resume: resumerMission(courant, true), instantane: courant };
}

export function lireInstantaneBrut(json: string): InstantaneMission | null {
  try {
    return lireInstantane(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

/**
 * La comparaison d'un rejeu avec sa mission source : la PREMIÈRE mission du
 * projet de rejeu (celle qu'ont ouverte les tâches recréées, rangée dans la
 * marque de rejeu à son ouverture), contre la mission source. Un côté absent,
 * élagué ou illisible est dit, pas inventé — jamais remplacé par une autre
 * mission du même projet.
 */
export function comparaisonDuRejeu(
  store: HiveStore,
  rejeuProjectId: string,
  now = Date.now(),
):
  | { ok: true; comparaison: ComparaisonMissions }
  | {
      ok: false;
      code: 'pas_un_rejeu' | 'source_elaguee' | 'rejeu_pas_parti' | 'rejeu_elague' | 'illisible';
    } {
  const rejeu = store.rejeuDuProjet(rejeuProjectId);
  if (!rejeu) return { ok: false, code: 'pas_un_rejeu' };
  const source = store.getMission(rejeu.missionSource);
  if (!source) return { ok: false, code: 'source_elaguee' };
  if (rejeu.missionRejeu === null) return { ok: false, code: 'rejeu_pas_parti' };
  const premiere = store.getMission(rejeu.missionRejeu);
  if (!premiere) return { ok: false, code: 'rejeu_elague' };
  const a = resumeDeMission(store, source, now);
  const b = resumeDeMission(store, premiere, now);
  if (!a || !b) return { ok: false, code: 'illisible' };
  return { ok: true, comparaison: comparerMissions(a.resume, b.resume) };
}

// ─── Créer un rejeu ──────────────────────────────────────────────────────────

export type RefusRejeu =
  | { code: 'instantane_illisible'; motif: string }
  | { code: 'plan_non_rejouable'; motif: string }
  | { code: 'projet_source_absent'; motif: string };

/**
 * Crée le projet de rejeu d'une mission : un projet NEUF (donc des branches
 * `hive/<id>` neuves, des bacs neufs sur les ouvrières), sur le même dépôt, avec
 * le plan de DÉBUT recréé, les garde-fous de l'instantané, le niveau
 * d'autonomie imposé (ou celui de l'instantané) — et la marque de rejeu, qui
 * met toutes ses actions irréversibles derrière la porte.
 *
 * TOUT OU RIEN : projet, membres, réglages, tâches et marque en UNE
 * transaction synchrone. Un projet de rejeu sans sa marque serait un projet
 * ordinaire, qui livrerait pour de vrai. Les événements partent APRÈS.
 */
export function creerRejeu(
  store: HiveStore,
  emitEvent: Emettre,
  demande: {
    mission: MissionRangee;
    surcharges: SurchargesRejeu;
    parUserId: string | null;
    now?: number;
  },
): { ok: true; projet: Project; taches: Task[] } | { ok: false; refus: RefusRejeu } {
  const now = demande.now ?? Date.now();
  const debut = lireInstantaneBrut(demande.mission.debut);
  if (!debut) {
    return {
      ok: false,
      refus: { code: 'instantane_illisible', motif: 'instantané de début illisible' },
    };
  }
  const source = store.getProject(demande.mission.projectId);
  if (!source) {
    return {
      ok: false,
      refus: {
        code: 'projet_source_absent',
        motif: 'le projet source n’existe plus : son dépôt est inconnu',
      },
    };
  }
  const plan = planDeRejeu(debut, `rj-${now.toString(36)}`);
  if (!plan.ok) return { ok: false, refus: { code: 'plan_non_rejouable', motif: plan.motif } };

  const niveau = demande.surcharges.autonomie ?? debut.autonomie.niveau;
  const gf = debut.gardeFous;
  const bornes = gf
    ? { min: versEchelon(gf.borneMin), max: versEchelon(gf.borneMax) }
    : { min: null, max: null };
  const figee = demande.surcharges.politiqueRoutage === 'figee';

  const { projet, taches } = store.enTransaction(() => {
    const projet = store.createProject({
      name: `Rejeu — ${source.name}`.slice(0, 120),
      ...(source.repoUrl ? { repoUrl: source.repoUrl } : {}),
      description: `Rejeu de la mission ${demande.mission.id}`,
      visibility: 'private',
      ownerId: source.ownerId,
    });
    // Le propriétaire de la source possède le rejeu : c'est son dépôt, ses
    // garde-fous. Qui l'a demandé (un administrateur) y est admis pour le voir.
    if (source.ownerId) store.addMember(projet.id, source.ownerId, 'owner');
    if (demande.parUserId && demande.parUserId !== source.ownerId) {
      store.addMember(projet.id, demande.parUserId);
    }
    if (niveau !== 'off') {
      store.setEssaim(
        projet.id,
        { niveau, depotInscrit: debut.autonomie.depotInscrit },
        'rejeu',
        now,
      );
    }
    // Le plafond de La Balance suit l'autonomie qu'il borne : une ruche de
    // rejeu `gouverne` ou `plein` sans lui dépenserait sans limite ce que la
    // source n'avait pas le droit de dépenser. Le rejeu a SES dépenses
    // (projet neuf), sous le MÊME plafond.
    if (debut.budget) store.setBudget(projet.id, debut.budget.plafondMs, 'rejeu', now);
    if (gf && bornes.min && bornes.max) {
      store.setGardeFou(
        projet.id,
        { actif: gf.actif, borneMin: bornes.min, borneMax: bornes.max },
        'rejeu',
        now,
      );
    }
    store.inscrireRejeu({
      projectId: projet.id,
      missionSource: demande.mission.id,
      projetSource: source.id,
      surcharges: demande.surcharges,
      genomeFige: figee ? debut.genome.antecedents : null,
      creePar: demande.parUserId,
      creeA: now,
    });
    const taches = plan.taches.map((t) =>
      store.createTask({
        id: t.id,
        projectId: projet.id,
        title: t.title,
        prompt: t.prompt,
        dependsOn: t.dependsOn,
      }),
    );
    return { projet, taches };
  });

  emitEvent('project_created', { projectId: projet.id, name: projet.name });
  emitEvent('rejeu_cree', {
    projectId: projet.id,
    missionSource: demande.mission.id,
    projetSource: source.id,
    taches: taches.length,
    ...(demande.surcharges.modele ? { modele: demande.surcharges.modele } : {}),
    ...(demande.surcharges.politiqueRoutage
      ? { politiqueRoutage: demande.surcharges.politiqueRoutage }
      : {}),
    autonomie: niveau,
  });
  for (const t of taches) {
    emitEvent('task_created', { taskId: t.id, projectId: projet.id, title: t.title });
  }
  return { ok: true, projet, taches };
}

// ─── La porte des actions irréversibles ──────────────────────────────────────

/**
 * Chaque effet irréversible (pull request, fusion, commit sur le dépôt,
 * poussée, workflow) passe ICI, juste avant de partir, une fois toutes les
 * autres portes franchies — la simulation dit donc exactement « ceci serait
 * parti ».
 *
 *   · projet ordinaire → `executer`, rien n'est rangé : la ruche d'avant ;
 *   · projet de REJEU, sans validation humaine → `simulee` : l'action est
 *     rangée (une fois) et journalisée, et l'appelant NE L'EXÉCUTE PAS ;
 *   · projet de rejeu, validée par un COMPTE (`validation.userId`) →
 *     `executer`, et la validation est rangée à côté de la simulation.
 *
 * Le jeton de ruche ne valide jamais : chaque machine membre le porte, et la
 * ruche autonome n'a pas de compte — c'est précisément ce qu'on arrête.
 */
export function porteIrreversible(
  store: HiveStore,
  emitEvent: Emettre,
  demande: {
    projectId: string;
    genre: GenreIrreversible;
    cible: string;
    validation: { userId: string } | null;
  },
): 'executer' | 'simulee' {
  if (!store.rejeuDuProjet(demande.projectId)) return 'executer';
  const issue = demande.validation ? 'validee' : 'simulee';
  const neuve = store.enregistrerActionRejeu(
    { projectId: demande.projectId, genre: demande.genre, cible: demande.cible, issue },
    demande.validation?.userId ?? null,
  );
  if (neuve) {
    emitEvent(issue === 'simulee' ? 'rejeu_action_simulee' : 'rejeu_action_validee', {
      projectId: demande.projectId,
      genre: demande.genre,
      cible: demande.cible,
      ...(demande.validation ? { parUserId: demande.validation.userId } : {}),
    });
  }
  return issue === 'validee' ? 'executer' : 'simulee';
}
