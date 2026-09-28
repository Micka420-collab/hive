// Les trois tables des missions rejouables, dans le magasin.
//
// Elles arrivent SANS migration (règle 2) : une base d'avant les gagne vides à
// l'ouverture, n'y perd rien, et deux ouvertures n'en font pas deux. Et elles
// arrivent avec leur borne (règle 3), qui ne coupe jamais une mission qu'un
// rejeu compare encore.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';

const TABLES = ['missions', 'rejeux', 'rejeux_actions', 'missions_taches'] as const;

const dossiers: string[] = [];
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tablesDe(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((t) => t.name);
  } finally {
    db.close();
  }
}

describe('les missions arrivent sans migration', () => {
  it('une base d’AVANT les gagne à l’ouverture, sans rien perdre — et deux ouvertures sont idempotentes', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-missions-'));
    dossiers.push(dir);
    const dbPath = path.join(dir, 'hive.db');

    // Une base du schéma PRÉCÉDENT : tout ce que la ruche avait, sans les
    // trois tables des missions.
    const avant = new HiveStore(dbPath);
    const projet = avant.createProject({ name: 'Ancien' });
    const t = avant.createTask({ projectId: projet.id, title: 'Vieille tâche', prompt: 'p' });
    avant.close();
    const brute = new Database(dbPath);
    for (const table of TABLES) brute.exec(`DROP TABLE ${table}`);
    brute.close();
    expect(tablesDe(dbPath)).not.toContain('missions');

    // Première ouverture : les tables apparaissent, l'ancien est intact.
    const apres = new HiveStore(dbPath);
    expect(apres.getTask(t.id)?.title).toBe('Vieille tâche');
    expect(apres.listMissions(projet.id)).toEqual([]);
    expect(
      apres.ouvrirMission({
        id: 'm1',
        projectId: projet.id,
        ouverteA: 10,
        depuisEvenement: 0,
        membres: [t.id],
        debut: '{}',
      }),
    ).toBe(true);
    expect(apres.membresDeMission('m1')).toEqual([t.id]);
    apres.close();

    // Seconde ouverture : rien de recréé, rien de perdu.
    const encore = new HiveStore(dbPath);
    expect(encore.getMission('m1')?.projectId).toBe(projet.id);
    encore.close();
    const tables = tablesDe(dbPath);
    for (const table of TABLES) expect(tables.filter((n) => n === table)).toHaveLength(1);
  });
});

describe('une seule mission ouverte par projet', () => {
  it('la seconde ouverture concurrente ne fait rien ; la clôture n’a lieu qu’une fois', () => {
    const s = new HiveStore(':memory:');
    const p = s.createProject({ name: 'P' }).id;
    const m = { projectId: p, ouverteA: 1, depuisEvenement: 0, membres: [], debut: '{}' };
    expect(s.ouvrirMission({ ...m, id: 'a' })).toBe(true);
    expect(s.ouvrirMission({ ...m, id: 'b' })).toBe(false);
    expect(s.missionOuverte(p)?.id).toBe('a');
    expect(s.cloreMission('a', 5, '{}')).toBe(true);
    expect(s.cloreMission('a', 9, '{"autre":1}')).toBe(false);
    expect(s.getMission('a')?.closeA).toBe(5);
    expect(s.missionOuverte(p)).toBeNull();
    s.close();
  });
});

describe('la borne des missions', () => {
  it('SUPPRIMER la source emporte ses instantanés, jamais la marque du rejeu qui la rejouait (#498)', () => {
    const s = new HiveStore(':memory:');
    const source = s.createProject({ name: 'Source' }).id;
    const t = s.createTask({ projectId: source, title: 'PLAN-SECRET', prompt: 'p' }).id;
    s.ouvrirMission({
      id: 'm-source',
      projectId: source,
      ouverteA: 1,
      depuisEvenement: 0,
      membres: [t],
      debut: '{"plan":"PLAN-SECRET"}',
    });
    const rejeu = s.createProject({ name: 'Rejeu' }).id;
    s.inscrireRejeu({
      projectId: rejeu,
      missionSource: 'm-source',
      projetSource: source,
      surcharges: {},
      genomeFige: null,
      creePar: null,
      creeA: 1,
    });
    const bilan = s.effacerProjet(source);
    expect(bilan?.missions).toBe(1);
    expect(bilan?.missions_taches).toBe(1);
    // Supprimer n'est pas archiver : le plan de la source ne survit nulle part…
    expect(s.listMissions(source)).toEqual([]);
    // …mais le rejeu reste un rejeu : ses effets irréversibles restent simulés.
    expect(s.rejeuDuProjet(rejeu)).not.toBeNull();
    // Et supprimer le rejeu emporte sa marque.
    expect(s.effacerProjet(rejeu)?.rejeux).toBe(1);
    expect(s.rejeuDuProjet(rejeu)).toBeNull();
  });

  it('garde les N plus récentes par projet, SAUF celle qu’un rejeu compare, et retire les orphelines', () => {
    const s = new HiveStore(':memory:');
    const p = s.createProject({ name: 'P' }).id;
    for (let i = 0; i < 25; i++) {
      s.ouvrirMission({
        id: `m${i}`,
        projectId: p,
        ouverteA: i,
        depuisEvenement: 0,
        membres: [`t${i}`],
        debut: '{}',
      });
      s.cloreMission(`m${i}`, i, '{}');
    }
    // La plus vieille est la source d'un rejeu encore rangé.
    const rejeu = s.createProject({ name: 'Rejeu' }).id;
    s.inscrireRejeu({
      projectId: rejeu,
      missionSource: 'm0',
      projetSource: p,
      surcharges: {},
      genomeFige: null,
      creePar: null,
      creeA: 1,
    });
    // Une mission d'un projet disparu.
    s.ouvrirMission({
      id: 'orpheline',
      projectId: 'disparu',
      ouverteA: 1,
      depuisEvenement: 0,
      membres: [],
      debut: '{}',
    });
    // Le rejeu lui-même a vécu plus de missions que le plafond (une ruche
    // autonome) : sa PREMIÈRE, celle que la comparaison oppose à la source,
    // doit survivre — sinon la comparaison prendrait une autre mission.
    for (let i = 0; i < 25; i++) {
      s.ouvrirMission({
        id: `r${i}`,
        projectId: rejeu,
        ouverteA: 100 + i,
        depuisEvenement: 0,
        membres: [],
        debut: '{}',
      });
      s.cloreMission(`r${i}`, 100 + i, '{}');
    }
    expect(s.rejeuDuProjet(rejeu)?.missionRejeu, 'rangée à l’ouverture, une fois').toBe('r0');
    // Des actions au-delà du plafond (20 × 10).
    for (let i = 0; i < 205; i++) {
      s.enregistrerActionRejeu(
        { projectId: rejeu, genre: 'workflow', cible: `c${i}`, issue: 'simulee' },
        null,
      );
    }
    s.enregistrerActionRejeu(
      { projectId: 'disparu', genre: 'workflow', cible: 'x', issue: 'simulee' },
      null,
    );

    s.pruneMissions(20);

    const restantes = s.listMissions(p, 200).map((m) => m.id);
    expect(restantes).toHaveLength(21);
    expect(restantes).toContain('m0');
    expect(restantes).not.toContain('m1');
    expect(restantes).toContain('m24');
    expect(s.getMission('orpheline')).toBeNull();
    const duRejeu = s.listMissions(rejeu, 200).map((m) => m.id);
    expect(duRejeu).toHaveLength(21);
    expect(duRejeu).toContain('r0');
    expect(duRejeu).not.toContain('r1');
    expect(s.membresDeMission('m1'), 'l’appartenance part avec sa mission').toEqual([]);
    expect(s.membresDeMission('m0')).toEqual(['t0']);
    expect(s.actionsDuRejeu(rejeu, 1_000)).toHaveLength(200);
    expect(s.actionsDuRejeu(rejeu, 1_000)[0]?.cible, 'les plus anciennes partent').toBe('c5');
    expect(s.actionsDuRejeu('disparu')).toEqual([]);
    s.close();
  });

  it('une action répétée n’est rangée qu’une fois', () => {
    const s = new HiveStore(':memory:');
    const a = {
      projectId: 'p',
      genre: 'livraison_pr',
      cible: 'moi/site:hive/t',
      issue: 'simulee',
    } as const;
    expect(s.enregistrerActionRejeu(a, null)).toBe(true);
    expect(s.enregistrerActionRejeu(a, null)).toBe(false);
    expect(s.actionRejeuRangee('p', 'livraison_pr', 'moi/site:hive/t')).toBe(true);
    expect(s.actionsDuRejeu('p')).toHaveLength(1);
    s.close();
  });
});
