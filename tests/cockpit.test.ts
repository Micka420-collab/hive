// LE COCKPIT DE LA RUCHE — décisions récentes, dépense déclarée, arrêts.
//
// ─── CE QUE CE BANC DÉFEND ───────────────────────────────────────────────────
//
//   · le fil des décisions ne montre que des CHOIX : une affectation sans
//     modèle commandé, une reprise après panne ou un battement de cœur n'en
//     sont pas ;
//   · la dépense se lit sur 24 heures, avec sa couverture, et dit quand un
//     journal élagué a pu lui faire perdre des tentatives ;
//   · une alerte est un ÉTAT : chaque genre est confronté à ce qui est rangé
//     maintenant, et un fait réglé ne revient pas ;
//   · l'ordre : ce qui arrête tout avant ce qui n'arrête qu'une tâche.

import { describe, expect, it } from 'vitest';
import {
  ALERTES_MAX,
  alertesCockpit,
  decisionsRecentes,
  depenseDepuisEvenements,
} from '../src/orchestrator/cockpit.js';
import type { EntreeAlertes } from '../src/orchestrator/cockpit.js';
import type { HiveEvent, TaskStatus } from '../src/shared/types.js';

let seq = 0;
const ev = (type: string, payload: Record<string, unknown>, ts = 10_000 + seq): HiveEvent => {
  seq += 1;
  return { id: seq, ts, type, payload };
};

describe('les décisions récentes', () => {
  it('ne gardent que les choix, la plus récente d’abord', () => {
    const choisies = [
      ev('task_assigned', { taskId: 't', nodeId: 'n', modele: 'opus', categorie: 'code' }),
      ev('contre_expertise_verdict', {
        source: 'hive_counter_review',
        taskId: 't',
        conteste: true,
      }),
      ev('task_retry', { taskId: 't', source: 'evaluator', decision: 'correction_required' }),
      ev('task_reviewed', { taskId: 't', state: 'approved' }),
      ev('balance_cap_reached', { projectId: 'p', applique: true }),
    ];
    const bruit = [
      ev('task_assigned', { taskId: 't', nodeId: 'n' }),
      ev('task_retry', { taskId: 't', nodeId: 'n' }),
      ev('task_reviewed', { taskId: 't', state: null }),
      ev('task_progress', { taskId: 't' }),
      ev('contre_expertise_verdict', { source: 'autre', taskId: 't', conteste: false }),
    ];
    const lues = decisionsRecentes([...bruit, ...choisies]);
    expect(lues.map((e) => e.id)).toEqual(choisies.map((e) => e.id).reverse());
    expect(decisionsRecentes(choisies, 2).map((e) => e.type)).toEqual([
      'balance_cap_reached',
      'task_reviewed',
    ]);
  });
});

describe('la dépense des dernières 24 heures', () => {
  const issue = (ts: number, coutUsd?: number) =>
    ev(
      'task_done',
      {
        taskId: `t${ts}`,
        nodeId: 'n',
        durationMs: 60_000,
        ...(coutUsd === undefined ? {} : { fournisseur: { coutUsd } }),
      },
      ts,
    );

  it('somme la fenêtre seule, avec sa couverture', () => {
    const d = depenseDepuisEvenements([issue(50), issue(200, 1), issue(300)], 100, 5_000, false);
    expect(d.tentatives).toBe(2);
    expect(d.coutFournisseur).toEqual({ total: 1, declarees: 1, tentatives: 2 });
    expect(d.dureeWorker).toEqual({ totalMs: 120_000, mesurees: 2 });
    expect(d.tronquee).toBe(false);
  });

  it('un journal élagué dont la plus ancienne issue est DANS la fenêtre a pu en perdre', () => {
    expect(depenseDepuisEvenements([issue(200)], 100, 5_000, true).tronquee).toBe(true);
    // Une issue retenue plus ancienne que la fenêtre : rien de la fenêtre n'est sorti.
    expect(depenseDepuisEvenements([issue(50), issue(200)], 100, 5_000, true).tronquee).toBe(false);
    // La borne de lecture atteinte a le même effet que l'élagage.
    expect(depenseDepuisEvenements([issue(200)], 100, 1, false).tronquee).toBe(true);
  });
});

describe('ce qui arrête la ruche', () => {
  const entree = (patch: Partial<EntreeAlertes> = {}): EntreeAlertes => ({
    evenements: [],
    tacheDe: () => null,
    pretes: { nombre: 0, depuis: null },
    noeudsEnLigne: 1,
    soldes: [],
    nomsDeProjets: new Map(),
    relectureEnSuspens: () => true,
    ...patch,
  });
  const taches = (statuts: Record<string, TaskStatus>) => (taskId: string) =>
    statuts[taskId] ? { title: `titre ${taskId}`, status: statuts[taskId]! } : null;

  it('rien ne part sans ouvrière en ligne — et seulement s’il y a du travail prêt', () => {
    const prete = { nombre: 3, depuis: 42 };
    expect(alertesCockpit(entree({ pretes: prete, noeudsEnLigne: 0 })).alertes).toEqual([
      { genre: 'blocage', cause: 'aucune_ouvriere', taches: 3, depuis: 42 },
    ]);
    expect(alertesCockpit(entree({ pretes: prete, noeudsEnLigne: 1 })).total).toBe(0);
    expect(alertesCockpit(entree({ noeudsEnLigne: 0 })).total).toBe(0);
  });

  it('un refus d’infrastructure alerte tant que personne n’a repris la tâche', () => {
    // L'ordre du journal fait foi (ids croissants) : l'affectation, puis son refus.
    const assignee = ev('task_assigned', { taskId: 't', nodeId: 'n' });
    const refus = ev('task_rejected', {
      taskId: 't',
      nodeId: 'n',
      reason: 'claude : non authentifié',
      infra: true,
    });
    const avant = alertesCockpit(
      entree({ evenements: [assignee, refus], tacheDe: taches({ t: 'ready' }) }),
    );
    expect(avant.alertes).toMatchObject([
      { genre: 'refus', taskId: 't', titre: 'titre t', raison: 'claude : non authentifié' },
    ]);
    const reprise = ev('task_assigned', { taskId: 't', nodeId: 'n2' });
    expect(
      alertesCockpit(
        entree({ evenements: [assignee, refus, reprise], tacheDe: taches({ t: 'ready' }) }),
      ).total,
    ).toBe(0);
    // Une saturation n'est pas une panne : la tâche attend son tour.
    const sature = ev('task_rejected', { taskId: 't', nodeId: 'n', reason: 'noeud_sature' });
    expect(
      alertesCockpit(entree({ evenements: [sature], tacheDe: taches({ t: 'ready' }) })).total,
    ).toBe(0);
  });

  it('une relecture qui attend une famille absente alerte tant qu’elle est prête', () => {
    const attente = ev('contre_expertise_review_waiting', {
      taskId: 'prod',
      relecture: 'rel',
      relecteur: 'codex',
      delaiMs: 300_000,
    });
    expect(
      alertesCockpit(
        entree({ evenements: [attente], tacheDe: taches({ rel: 'ready', prod: 'done' }) }),
      ).alertes,
    ).toMatchObject([
      {
        genre: 'blocage',
        cause: 'relecteur_absent',
        taskId: 'prod',
        titre: 'titre prod',
        relecteur: 'codex',
        delaiMs: 300_000,
      },
    ]);
    expect(
      alertesCockpit(
        entree({ evenements: [attente], tacheDe: taches({ rel: 'running', prod: 'done' }) }),
      ).total,
    ).toBe(0);
  });

  it('une relecture impossible alerte tant qu’un humain ne l’a pas tranchée', () => {
    const impossible = ev('contre_expertise_impossible', {
      taskId: 't',
      resultId: 7,
      cause: 'aucune autre famille en ligne',
    });
    const vues: Array<[string, number]> = [];
    const enSuspens = alertesCockpit(
      entree({
        evenements: [impossible],
        relectureEnSuspens: (taskId, resultId) => {
          vues.push([taskId, resultId]);
          return true;
        },
      }),
    );
    expect(vues).toEqual([['t', 7]]);
    expect(enSuspens.alertes).toMatchObject([
      { genre: 'relecture_impossible', cause: 'aucune autre famille en ligne' },
    ]);
    expect(
      alertesCockpit(entree({ evenements: [impossible], relectureEnSuspens: () => false })).total,
    ).toBe(0);
  });

  it('un plafond n’alerte que s’il ARRÊTE réellement le projet', () => {
    const atteint = ev('balance_cap_reached', { projectId: 'p1', applique: true }, 77);
    const alertes = alertesCockpit(
      entree({
        evenements: [atteint],
        soldes: [
          { projectId: 'p1', depenseMs: 10, plafondMs: 5, bloque: true },
          { projectId: 'p2', depenseMs: 10, plafondMs: 5, bloque: false },
        ],
        nomsDeProjets: new Map([['p1', 'Site vitrine']]),
      }),
    );
    expect(alertes.alertes).toEqual([
      {
        genre: 'budget',
        projectId: 'p1',
        projet: 'Site vitrine',
        depenseMs: 10,
        plafondMs: 5,
        depuis: 77,
      },
    ]);
  });

  it('ce qui arrête tout passe d’abord, et la liste est bornée en disant son total', () => {
    const refus = Array.from({ length: ALERTES_MAX + 3 }, (_, i) =>
      ev('task_rejected', { taskId: `t${i}`, nodeId: 'n', reason: 'quota', infra: true }),
    );
    const { alertes, total } = alertesCockpit(
      entree({
        evenements: refus,
        tacheDe: () => ({ title: 'x', status: 'ready' }),
        pretes: { nombre: refus.length, depuis: 1 },
        noeudsEnLigne: 0,
        soldes: [{ projectId: 'p', depenseMs: 1, plafondMs: 1, bloque: true }],
      }),
    );
    expect(total).toBe(ALERTES_MAX + 3 + 2);
    expect(alertes).toHaveLength(ALERTES_MAX);
    expect(alertes.slice(0, 3).map((a) => a.genre)).toEqual(['blocage', 'budget', 'refus']);
  });
});
