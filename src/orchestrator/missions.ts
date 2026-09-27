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
// plan, une tâche posée à la main, un cycle d'essaim — tous créent des tâches
// par des chemins différents. Ce que tous partagent, c'est le JOURNAL : une
// naissance (`task_created`, `swarm_task_created`) et des issues terminales
// (`task_done`, `task_failed`, `task_cancelled`). Le suivi les écoute et
// décide sur l'ÉTAT, jamais sur l'événement seul :
//
//   · une tâche vit sur un projet qui n'a pas de mission ouverte → ouverture,
//     et l'instantané de DÉBUT ;
//   · une mission ouverte n'a plus AUCUNE tâche en vol (relectures comprises)
//     → clôture, et l'instantané de FIN.
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
import { versEchelon } from './garde-fou.js';
import type { HiveStore, MissionRangee } from './store.js';

type Emettre = (type: string, payload: Record<string, unknown>) => void;

const OUVERTURES = new Set(['task_created', 'swarm_task_created']);
const ISSUES = new Set(['task_done', 'task_failed', 'task_cancelled']);

/** Missions gardées par projet — au-delà, l'élagueur retire les plus vieilles. */
export const MISSIONS_PAR_PROJET = 20;

/** Le Genome tel que l'Aiguillage le lit aujourd'hui (verdicts seulement). */
function genomeCourant(store: HiveStore): { empreinte: string; antecedents: AntecedentFige[] } {
  // Les élections EN VOL ne sont pas du vécu : elles comptent dans le score du
  // jour (borne du troupeau), pas dans ce qu'on fige pour rejouer plus tard.
  const antecedents = [...antecedentsDuVecu(store.observationsAiguillage(), [])]
    .map(([cle, a]) => ({ cle, essais: a.essais, recompenseTotale: a.recompenseTotale }))
    .sort((a, b) => a.cle.localeCompare(b.cle));
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
): InstantaneMission {
  const taches: Task[] = store.tachesDeMission(projet.id, mission.ouverteA);
  const roles = store.rolesDesTaches(taches.map((t) => t.id));
  const essaim = store.getEssaim(projet.id);
  const gardeFou = store.getGardeFou(projet.id);
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
    evenements: store.evenementsDeMission(projet.id, mission.depuisEvenement, TYPES_MISSION),
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
  const aVerifier = new Set<string>();
  let programme = false;

  const verifier = (projectId: string): void => {
    const projet = store.getProject(projectId);
    if (!projet) return;
    const ouverte = store.missionOuverte(projectId);
    const vivantes = store.compterTachesVivantes(projectId);
    const now = maintenant();
    if (!ouverte && vivantes > 0) {
      const ouverteA = store.naissanceDesVivantes(projectId) ?? now;
      const mission = {
        id: randomUUID(),
        ouverteA,
        closeA: null,
        depuisEvenement: store.dernierEvenementAvant(ouverteA),
      };
      const debut = instantaneDe(store, projet, mission, 'debut', now);
      const ouverteIci = store.ouvrirMission({
        id: mission.id,
        projectId,
        ouverteA,
        depuisEvenement: mission.depuisEvenement,
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
    if (ouverte && vivantes === 0) {
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

  const vider = (): void => {
    programme = false;
    const projets = [...aVerifier].sort();
    aVerifier.clear();
    for (const projectId of projets) {
      try {
        verifier(projectId);
      } catch (err) {
        dep.signaler(err);
      }
    }
  };

  const suivre = (event: HiveEvent): void => {
    let projectId: unknown = null;
    if (OUVERTURES.has(event.type)) projectId = event.payload.projectId;
    else if (ISSUES.has(event.type)) {
      const taskId = event.payload.taskId;
      if (typeof taskId === 'string') projectId = store.getTask(taskId)?.projectId ?? null;
    } else return;
    if (typeof projectId !== 'string') return;
    aVerifier.add(projectId);
    if (!programme) {
      programme = true;
      programmer(vider);
    }
  };

  return { suivre, verifier };
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
 * projet de rejeu (celle qu'ont ouverte les tâches recréées), contre la mission
 * source. Un côté absent ou illisible est dit, pas inventé.
 */
export function comparaisonDuRejeu(
  store: HiveStore,
  rejeuProjectId: string,
  now = Date.now(),
):
  | { ok: true; comparaison: ComparaisonMissions }
  | { ok: false; code: 'pas_un_rejeu' | 'source_elaguee' | 'rejeu_pas_parti' | 'illisible' } {
  const rejeu = store.rejeuDuProjet(rejeuProjectId);
  if (!rejeu) return { ok: false, code: 'pas_un_rejeu' };
  const source = store.getMission(rejeu.missionSource);
  if (!source) return { ok: false, code: 'source_elaguee' };
  const missions = store.listMissions(rejeuProjectId, 200);
  const premiere = missions[missions.length - 1];
  if (!premiere) return { ok: false, code: 'rejeu_pas_parti' };
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
