// Les missions rejouables, côté PUR : ce qu'un instantané contient, ce qu'un
// rejeu recrée, et ce qu'une comparaison a le droit de calculer.
//
// Trois propriétés, une par bloc :
//
//   1. L'INSTANTANÉ EST COMPLET — tout ce que la carte exige d'y trouver
//      (plan et graphe, prompts, modèles, routage et Genome, autonomie,
//      garde-fous, artefacts, décisions) y est, et RIEN de libre n'y entre
//      (ni raison humaine, ni objection, ni identifiant dans l'URL du dépôt).
//   2. LE REJEU RECRÉE LE PLAN, et seulement lui — ni les relectures, ni les
//      délégations, que le rejeu refera de lui-même — ou refuse de rejouer un
//      plan qu'on n'a pas gardé en entier.
//   3. LA COMPARAISON NE CALCULE QUE SUR DU DÉCLARÉ : un côté `inconnu` rend un
//      écart `inconnu`, et une couverture partielle est dite.

import { describe, expect, it } from 'vitest';
import {
  comparerMissions,
  construireInstantane,
  lireInstantane,
  MAX_TACHES_PLAN,
  planDeRejeu,
  resumerMission,
  validerSurcharges,
  VERSION_INSTANTANE_MISSION,
} from '../src/shared/mission-rejouable.js';
import type { EntreesInstantane, InstantaneMission } from '../src/shared/mission-rejouable.js';
import type { HiveEvent, Task } from '../src/shared/types.js';

const tache = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  projectId: 'p1',
  title: `Tâche ${id}`,
  prompt: `Consigne de ${id}`,
  status: 'done',
  dependsOn: [],
  assignedNodeId: null,
  result: null,
  branch: `hive/${id}`,
  attempts: 1,
  createdAt: 1_000,
  updatedAt: 2_000,
  ...patch,
});

let prochainId = 100;
const ev = (type: string, payload: Record<string, unknown>, ts = 5_000): HiveEvent => ({
  id: prochainId++,
  ts,
  type,
  payload,
});

function entrees(patch: Partial<EntreesInstantane> = {}): EntreesInstantane {
  return {
    moment: 'debut',
    prisA: 9_000,
    mission: { id: 'm1', ouverteA: 1_000, closeA: null },
    projet: { id: 'p1', nom: 'Site', depot: 'https://github.com/moi/site' },
    taches: [
      tache('t1'),
      tache('t2', { dependsOn: ['t1'], status: 'failed' }),
      tache('rel', { title: 'Contre-expertise — Tâche t1', prompt: 'relis' }),
      tache('del', { title: 'Sous-tâche', prompt: 'délégué' }),
    ],
    relectures: new Set(['rel']),
    deleguees: new Set(['del']),
    evenements: [
      ev('task_assigned', { taskId: 't1', nodeId: 'n1', modele: 'claude-opus-5' }),
      ev('task_done', {
        taskId: 't1',
        nodeId: 'n1',
        durationMs: 4_000,
        fournisseur: {
          source: 'claude-code',
          coutUsd: 0.5,
          dureeApiMs: 3_000,
          modeles: ['claude-opus-5-20260101'],
        },
      }),
      ev('validation_recorded', {
        taskId: 't1',
        resultId: 1,
        validation: { tests: 'passed', typecheck: 'passed', build: 'missing', lint: 'bidon' },
      }),
      ev('contre_expertise_verdict', {
        taskId: 't1',
        conteste: true,
        objections: ['un secret : ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
      }),
      ev('task_reviewed', { taskId: 't1', state: 'approved', raison: 'texte humain libre' }),
      ev('task_retry', { taskId: 't2', source: 'evaluator', decision: 'correction_required' }),
      ev('task_cancelled', { taskId: 't2', reason: 'user' }),
      ev('swarm_level_set', { projectId: 'p1', niveau: 'gouverne', depotInscrit: false }),
      ev('livraison_locale', { projectId: 'p1', etat: 'commitee', branche: 'hive/mission-p1-3' }),
    ],
    journal: { complet: true, depuisEvenement: 99, jusquA: 200 },
    modelesOfferts: ['codex-5', 'claude-opus-5', 'claude-opus-5'],
    genome: {
      empreinte: 'abc123',
      antecedents: [
        { niveau: 'modele', cle: 'test|codex-5', essais: 2, recompenseTotale: 1 },
        { niveau: 'modele', cle: 'code|claude-opus-5', essais: 4, recompenseTotale: 3 },
      ],
    },
    routage: { versionAiguillage: 2, corpus: 300, politique: 'apprise' },
    autonomie: { niveau: 'gouverne', depotInscrit: false },
    gardeFous: { actif: true, borneMin: 'leger', borneMax: 'strict' },
    budget: { plafondMs: 3_600_000 },
    livraisons: [
      { taskId: 't1', pr: 42, etat: 'ouverte' },
      { taskId: 'autre-mission', pr: 7, etat: 'fusionnee' },
    ],
    rejeu: null,
    ...patch,
  };
}

describe('l’instantané d’une mission est COMPLET', () => {
  it('porte le plan et son graphe, les prompts, les modèles, le routage, le Genome, l’autonomie, les garde-fous, les artefacts et les décisions', () => {
    const i = construireInstantane(entrees());
    expect(i.version).toBe(VERSION_INSTANTANE_MISSION);
    expect(i.moment).toBe('debut');
    expect(i.mission).toEqual({ id: 'm1', ouverteA: 1_000, closeA: null });

    // Le plan : chaque tâche, son rôle, son graphe, son prompt (plan seulement).
    expect(i.plan.complet).toBe(true);
    expect(i.plan.taches.map((t) => [t.ref, t.genre])).toEqual([
      ['t1', 'plan'],
      ['t2', 'plan'],
      ['rel', 'relecture'],
      ['del', 'deleguee'],
    ]);
    expect(i.plan.taches[1]?.dependsOn).toEqual(['t1']);
    expect(i.plan.taches[0]?.prompt).toBe('Consigne de t1');
    expect(i.plan.taches[2]?.prompt, 'le prompt d’une relecture n’est pas gardé').toBeNull();

    // Modèles : commandé, déclaré par le CLI, offert par la ruche — séparés.
    expect(i.modeles).toEqual({
      commandes: ['claude-opus-5'],
      declares: ['claude-opus-5-20260101'],
      offerts: ['claude-opus-5', 'codex-5'],
    });
    expect(i.routage).toEqual({ versionAiguillage: 2, corpus: 300, politique: 'apprise' });
    expect(i.genome.empreinte).toBe('abc123');
    expect(i.genome.antecedents.map((a) => a.cle)).toEqual(['code|claude-opus-5', 'test|codex-5']);
    expect(i.autonomie).toEqual({ niveau: 'gouverne', depotInscrit: false });
    expect(i.gardeFous).toEqual({ actif: true, borneMin: 'leger', borneMax: 'strict' });
    expect(i.budget).toEqual({ plafondMs: 3_600_000 });

    // Artefacts : les branches des tâches, les PR DE CETTE MISSION, la branche
    // de mission commitée pendant elle.
    expect(i.artefacts.branches).toEqual(['hive/del', 'hive/rel', 'hive/t1', 'hive/t2']);
    expect(i.artefacts.livraisons).toEqual([{ tache: 't1', pr: 42, etat: 'ouverte' }]);
    expect(i.artefacts.branchesMission).toEqual(['hive/mission-p1-3']);

    // Décisions typées : la revue humaine, la correction de l'Evaluator, le
    // niveau d'autonomie.
    expect(i.decisions.map((d) => [d.type, d.valeur])).toEqual([
      ['task_reviewed', 'approved'],
      ['evaluator_retry', 'correction_required'],
      ['swarm_level_set', 'gouverne'],
    ]);
    expect(i.faits.tentatives).toEqual([
      {
        tache: 't1',
        issue: 'rendue',
        dureeMs: 4_000,
        coutUsd: 0.5,
        dureeApiMs: 3_000,
        jetonsEntree: null,
        jetonsSortie: null,
        modeles: ['claude-opus-5-20260101'],
      },
    ]);
    // Un état de validation illisible (« bidon ») n'est pas deviné.
    expect(i.faits.validations).toEqual([
      { tache: 't1', etats: { tests: 'passed', typecheck: 'passed', build: 'missing' } },
    ]);
    expect(i.faits.relectures).toEqual([{ tache: 't1', conteste: true }]);
    expect(i.journal).toEqual({ complet: true, depuisEvenement: 99, jusquA: 200 });
  });

  it('une tâche rangée « failed » mais ANNULÉE a son propre statut', () => {
    const i = construireInstantane(entrees());
    expect(i.plan.taches.find((t) => t.ref === 't2')?.statut).toBe('cancelled');
    // Une vraie défaite reste une défaite.
    const echec = construireInstantane(
      entrees({
        taches: [tache('t3', { status: 'failed' })],
        evenements: [ev('task_failed', { taskId: 't3', reason: 'max_attempts' })],
      }),
    );
    expect(echec.plan.taches[0]?.statut).toBe('failed');
  });

  it('RIEN DE LIBRE n’entre : ni raison humaine, ni objection, ni secret', () => {
    const json = JSON.stringify(construireInstantane(entrees()));
    expect(json).not.toContain('texte humain libre');
    expect(json).not.toContain('ghp_');
    expect(json).not.toContain('objections');
  });

  it('l’instantané de FIN ne regarde pas les prompts : le rejeu part du début', () => {
    const fin = construireInstantane(entrees({ moment: 'fin' }));
    expect(fin.plan.taches.every((t) => t.prompt === null)).toBe(true);
    expect(fin.plan.complet).toBe(true);
  });

  it('un plan trop grand est DIT incomplet, pas tronqué en silence', () => {
    const taches = Array.from({ length: MAX_TACHES_PLAN + 5 }, (_, i) => tache(`x${i}`));
    const i = construireInstantane(entrees({ taches, evenements: [] }));
    expect(i.plan.taches).toHaveLength(MAX_TACHES_PLAN);
    expect(i.plan.complet).toBe(false);
    expect(i.plan.manques[0]).toMatch(/plus de 200 tâches/);
  });

  it('se relit, et refuse un format d’une autre version', () => {
    const i = construireInstantane(entrees());
    expect(lireInstantane(JSON.parse(JSON.stringify(i)))).toEqual(i);
    expect(lireInstantane({ ...i, version: 99 })).toBeNull();
    expect(lireInstantane(null)).toBeNull();
  });
});

describe('le plan d’un rejeu', () => {
  it('recrée le PLAN seulement, avec des identifiants neufs et des dépendances remappées', () => {
    const plan = planDeRejeu(construireInstantane(entrees()), 'rj-x');
    expect(plan).toEqual({
      ok: true,
      taches: [
        { id: 'rj-x-001', title: 'Tâche t1', prompt: 'Consigne de t1', dependsOn: [] },
        { id: 'rj-x-002', title: 'Tâche t2', prompt: 'Consigne de t2', dependsOn: ['rj-x-001'] },
      ],
    });
  });

  it('refuse un plan incomplet — un rejeu infidèle serait comparé comme s’il était fidèle', () => {
    const taches = Array.from({ length: MAX_TACHES_PLAN + 1 }, (_, i) => tache(`x${i}`));
    const plan = planDeRejeu(construireInstantane(entrees({ taches, evenements: [] })), 'r');
    expect(plan.ok).toBe(false);
  });

  it('valide les surcharges, et rien d’autre', () => {
    expect(validerSurcharges({ modele: ' codex-5 ' }, ['off'])).toEqual({
      ok: true,
      surcharges: { modele: 'codex-5' },
    });
    expect(validerSurcharges({ modele: 'rm -rf /' }, ['off']).ok).toBe(false);
    expect(validerSurcharges({ autonomie: 'plein' }, ['off', 'propose']).ok).toBe(false);
  });
});

describe('la comparaison ne calcule que sur du déclaré', () => {
  const fin = (patch: Partial<EntreesInstantane>): InstantaneMission =>
    construireInstantane(entrees({ moment: 'fin', ...patch }));

  it('écarts sur les sommes déclarées, avec leur couverture', () => {
    const original = resumerMission(
      fin({
        mission: { id: 'm1', ouverteA: 1_000, closeA: 61_000 },
        evenements: [
          ev('task_done', {
            taskId: 't1',
            nodeId: 'n',
            durationMs: 10,
            fournisseur: { coutUsd: 1 },
          }),
          ev('task_retry', { taskId: 't2', nodeId: 'n', durationMs: 20 }),
        ],
      }),
      false,
    );
    const rejeu = resumerMission(
      fin({
        mission: { id: 'm2', ouverteA: 100_000, closeA: 130_000 },
        evenements: [
          ev('task_done', {
            taskId: 't1',
            nodeId: 'n',
            durationMs: 5,
            fournisseur: { coutUsd: 0.25 },
          }),
        ],
      }),
      false,
    );
    const c = comparerMissions(original, rejeu);
    // Le coût : 1 déclaré sur 2 tentatives contre 0,25 sur 1 — l'écart existe,
    // mais la couverture de l'original est partielle, et c'est dit.
    expect(original.cout).toEqual({ total: 1, declarees: 1, tentatives: 2 });
    expect(c.ecarts.cout).toEqual({ ecart: -0.75, couvertureComplete: false });
    expect(c.ecarts.dureeOuvrieresMs).toEqual({ ecart: -25, couvertureComplete: true });
    expect(c.ecarts.dureeMurMs).toBe(30_000 - 60_000);
    expect(c.ecarts.tentatives).toBe(-1);
  });

  it('un côté qui n’a RIEN déclaré rend l’écart inconnu — jamais zéro', () => {
    const muet = resumerMission(
      fin({ evenements: [ev('task_done', { taskId: 't1', nodeId: 'n', durationMs: 5 })] }),
      false,
    );
    const bavard = resumerMission(
      fin({
        evenements: [
          ev('task_done', {
            taskId: 't1',
            nodeId: 'n',
            durationMs: 5,
            fournisseur: { coutUsd: 2 },
          }),
        ],
      }),
      false,
    );
    expect(muet.cout).toBe('inconnu');
    expect(comparerMissions(muet, bavard).ecarts.cout).toEqual({
      ecart: 'inconnu',
      couvertureComplete: false,
    });
  });

  it('une mission EN VOL n’a ni durée, ni réussite : inconnues, pas zéro', () => {
    const r = resumerMission(construireInstantane(entrees({ moment: 'fin' })), true);
    expect(r.provisoire).toBe(true);
    expect(r.dureeMurMs).toBe('inconnu');
    expect(r.reussie).toBe('inconnu');
    // Les comptes du plan : l'annulée à part.
    expect(r.taches).toMatchObject({ done: 1, cancelled: 1, failed: 0 });
    expect(r.validations.tests).toEqual({ passed: 1, failed: 0, missing: 0, not_applicable: 0 });
    expect(r.revuesHumaines).toEqual({ approuvees: 1, rejetees: 0 });
    expect(r.relectures).toEqual({ contestees: 1, validees: 0 });
  });
});
