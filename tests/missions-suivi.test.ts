// LE SUIVI DES MISSIONS — où une mission commence, ce qu'elle contient, et ce
// qui lui revient après sa clôture. Contre le VRAI magasin, décision rendue
// synchrone : chaque événement est suivi de son relevé.
//
// Trois pièges que le premier suivi ne voyait pas :
//
//   · une tâche FINIE qu'on RANIME (l'Evaluator la relance après une revue) :
//     elle garde sa vieille date de naissance. « Les tâches nées depuis la plus
//     vieille vivante » faisait avaler à la mission suivante tout le plan de la
//     précédente — et son rejeu recréait des tâches qui n'étaient pas les siennes ;
//   · une tâche née SANS `task_created` (motif, conseil, Fabrique, restauration) :
//     aucune mission ne s'ouvrait avant la première issue, et l'instantané de
//     DÉBUT montrait un travail déjà rendu ;
//   · une décision APRÈS la clôture (revue humaine, livraison) : livrer exige
//     une tâche finie et approuvée, donc la mission est close quand elle tombe —
//     l'instantané de fin comptait zéro.

import { describe, expect, it } from 'vitest';
import {
  comparaisonDuRejeu,
  creerRejeu,
  creerSuiviMissions,
} from '../src/orchestrator/missions.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { lireInstantane, resumerMission } from '../src/shared/mission-rejouable.js';
import type { InstantaneMission } from '../src/shared/mission-rejouable.js';

function banc() {
  const store = new HiveStore(':memory:');
  let t = 1_000;
  const maintenant = () => t;
  const emit = (type: string, payload: Record<string, unknown>): void => {
    suivi.suivre(store.appendEvent(type, payload));
  };
  const suivi = creerSuiviMissions({
    store,
    emitEvent: (type, payload) => void store.appendEvent(type, payload),
    signaler: (err) => {
      throw err;
    },
    programmer: (f) => f(),
    maintenant,
  });
  const avancer = (ms = 10): void => {
    t += ms;
  };
  const lire = (json: string | null): InstantaneMission => {
    const i = json === null ? null : lireInstantane(JSON.parse(json) as unknown);
    if (!i) throw new Error('instantané illisible');
    return i;
  };
  const plan = (json: string | null) => lire(json).plan.taches.map((x) => [x.ref, x.statut]);
  return { store, emit, avancer, lire, plan, maintenant };
}

describe('le suivi des missions', () => {
  it('UNE TÂCHE RANIMÉE APRÈS LA CLÔTURE ouvre SA mission — sans y entraîner la précédente', () => {
    const { store, emit, avancer, plan } = banc();
    const p = store.createProject({ name: 'P' }).id;

    const a = store.createTask({ id: 'a', projectId: p, title: 'A', prompt: 'a' }, 1_000);
    emit('task_created', { taskId: a.id, projectId: p });
    avancer();
    store.patchTask('a', { status: 'done' });
    emit('task_done', { taskId: 'a' });
    const m1 = store.listMissions(p)[0]!;
    expect(m1.closeA).not.toBeNull();

    avancer();
    store.createTask({ id: 'old', projectId: p, title: 'Old', prompt: 'o' }, 1_020);
    emit('task_created', { taskId: 'old', projectId: p });
    avancer();
    store.patchTask('old', { status: 'done' });
    emit('task_done', { taskId: 'old' });
    expect(store.listMissions(p)).toHaveLength(2);

    // L'Evaluator relance `a` (le chemin de POST /api/tasks/:id/evaluation/retry).
    avancer();
    store.patchTask('a', { status: 'ready' });
    emit('task_retry', { taskId: 'a', source: 'evaluator', decision: 'correction_required' });
    expect(store.listMissions(p), 'la réanimation ouvre une mission').toHaveLength(3);
    const m3 = store.missionOuverte(p)!;
    expect(plan(m3.debut)).toEqual([['a', 'ready']]);

    // Une tâche neuve pendant qu'elle vole la REJOINT ; `old` (mission 2) non.
    avancer();
    store.createTask({ id: 'c', projectId: p, title: 'C', prompt: 'c' }, 1_060);
    emit('task_created', { taskId: 'c', projectId: p });
    expect(store.listMissions(p)).toHaveLength(3);
    expect(store.membresDeMission(m3.id)).toEqual(['a', 'c']);
    for (const id of ['a', 'c']) {
      avancer();
      store.patchTask(id, { status: 'done' });
      emit('task_done', { taskId: id });
    }
    const close = store.getMission(m3.id)!;
    expect(plan(close.fin)).toEqual([
      ['a', 'done'],
      ['c', 'done'],
    ]);
  });

  it('UNE TÂCHE NÉE SANS `task_created` (motif, conseil, Fabrique…) ouvre sa mission AVANT tout travail', () => {
    const { store, emit, plan } = banc();
    const p = store.createProject({ name: 'P' }).id;
    // Comme l'application d'un motif : deux tâches, AUCUN événement.
    store.createTask({ id: 'a', projectId: p, title: 'A', prompt: 'a' });
    store.createTask({ id: 'b', projectId: p, title: 'B', prompt: 'b', dependsOn: ['a'] });
    expect(store.listMissions(p)).toEqual([]);

    // Toute tâche qui travaille passe par son affectation.
    store.patchTask('a', { status: 'assigned', assignedNodeId: 'n1' });
    emit('task_assigned', { taskId: 'a', nodeId: 'n1' });
    const m = store.missionOuverte(p);
    expect(m, 'l’affectation ouvre la mission').not.toBeNull();
    expect(plan(m!.debut), 'le début précède tout travail rendu').toEqual([
      ['a', 'assigned'],
      ['b', 'pending'],
    ]);
  });

  it('UNE REVUE HUMAINE APRÈS LA CLÔTURE revient à la mission : l’instantané de fin est re-pris', () => {
    const { store, emit, avancer, lire } = banc();
    const p = store.createProject({ name: 'P' }).id;
    store.createTask({ id: 'a', projectId: p, title: 'A', prompt: 'a' });
    emit('task_created', { taskId: 'a', projectId: p });
    avancer();
    store.patchTask('a', { status: 'done' });
    emit('task_done', { taskId: 'a' });
    const m = store.listMissions(p)[0]!;
    expect(resumerMission(lire(m.fin), false).revuesHumaines.approuvees).toBe(0);

    avancer();
    emit('task_reviewed', { taskId: 'a', state: 'approved' });
    const apres = store.getMission(m.id)!;
    expect(apres.closeA, 'la clôture ne bouge pas').toBe(m.closeA);
    expect(resumerMission(lire(apres.fin), false).revuesHumaines.approuvees).toBe(1);

    // Une revue d'une tâche d'un AUTRE projet ne la touche pas.
    const autre = store.createProject({ name: 'Autre' }).id;
    store.createTask({ id: 'z', projectId: autre, title: 'Z', prompt: 'z' });
    emit('task_reviewed', { taskId: 'z', state: 'rejected' });
    expect(resumerMission(lire(store.getMission(m.id)!.fin), false).revuesHumaines).toEqual({
      approuvees: 1,
      rejetees: 0,
    });
  });

  it('LE REJEU RECOPIE LE PLAFOND DE DÉPENSE avec l’autonomie qu’il borne — et compare SA première mission', () => {
    const { store, emit, avancer } = banc();
    const p = store.createProject({ name: 'P', repoUrl: 'https://github.com/moi/site' }).id;
    store.setBudget(p, 3_600_000, 'humain');
    store.setEssaim(p, { niveau: 'gouverne', depotInscrit: false }, 'humain');
    store.createTask({ id: 'a', projectId: p, title: 'A', prompt: 'a' });
    emit('task_created', { taskId: 'a', projectId: p });
    const m = store.missionOuverte(p)!;

    const cree = creerRejeu(store, (type, payload) => emit(type, payload), {
      mission: m,
      surcharges: {},
      parUserId: null,
      now: 2_000,
    });
    if (!cree.ok) throw new Error(cree.refus.motif);
    const rp = cree.projet.id;
    expect(store.getEssaim(rp)?.niveau).toBe('gouverne');
    expect(store.getBudget(rp)?.plafondMs, 'autonomie recopiée SANS borne').toBe(3_600_000);

    // Sa première mission est rangée à l'ouverture ; d'autres suivent.
    const premiere = store.missionOuverte(rp)!;
    expect(store.rejeuDuProjet(rp)?.missionRejeu).toBe(premiere.id);
    for (const t of store.listTasks(rp)) {
      avancer();
      store.patchTask(t.id, { status: 'done' });
      emit('task_done', { taskId: t.id });
    }
    avancer();
    store.createTask({ id: 'plus-tard', projectId: rp, title: 'Plus tard', prompt: 'x' });
    emit('task_created', { taskId: 'plus-tard', projectId: rp });
    expect(store.listMissions(rp)).toHaveLength(2);
    const cmp = comparaisonDuRejeu(store, rp, 5_000);
    expect(cmp.ok).toBe(true);
    if (cmp.ok) expect(cmp.comparaison.rejeu.missionId).toBe(premiere.id);
  });
});
