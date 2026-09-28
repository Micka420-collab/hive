// LA FICHE D'UN WORKER — sa trajectoire, prouvée fait par fait.
//
// Ce que ce fichier défend :
//   · une participation à la War Room se PROUVE (résultat rendu par ce nœud,
//     proposition ou avis de Conseil à son nodeId, relecture qu'il a rendue) —
//     jamais la famille d'agent seule, que partagent d'autres ouvrières ;
//   · les leçons sont les échecs QU'IL a rendus, caviardés à la Reine ;
//   · aucune moyenne n'est posée : les missions sont rendues une par une ;
//   · la route garde la porte de la Chambre (jeton de ruche seulement).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEBATS_MAX,
  debatsDuWorker,
  leconsDuWorker,
  missionsDuWorker,
} from '../src/orchestrator/fiche-worker.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { EntreeWarRoom } from '../src/shared/war-room.js';

const base = (id: number) => ({ id, ts: 1_000 + id });

describe('debatsDuWorker — la participation se prouve', () => {
  const entrees: EntreeWarRoom[] = [
    { ...base(1), genre: 'conseil_ouvert', sessionId: 's1' },
    {
      ...base(2),
      genre: 'conseil_proposition',
      sessionId: 's1',
      propositionId: 'p1',
      nodeId: 'moi',
      tour: 1,
    },
    {
      ...base(3),
      genre: 'conseil_avis',
      sessionId: 's1',
      propositionId: 'p1',
      nodeId: 'autre',
      avis: 'soutien',
      tour: 1,
    },
    // Une contre-expertise sur une production d'un AUTRE nœud, relue par la
    // famille `codex` : seule la relecture rendue par `moi` l'attribue.
    {
      ...base(4),
      genre: 'contre_verdict',
      taskId: 'prod-autre',
      resultId: 9,
      relecteur: 'codex',
      conteste: true,
      objections: ['test manquant'],
    },
    // Même famille, autre production que `moi` n'a PAS relue : pas à lui.
    {
      ...base(5),
      genre: 'contre_verdict',
      taskId: 'prod-ailleurs',
      resultId: 10,
      relecteur: 'codex',
      conteste: false,
      objections: [],
    },
    // Sa propre production, renvoyée par l'Evaluator.
    {
      ...base(6),
      genre: 'renvoi_evaluator',
      taskId: 'prod-moi',
      resultId: 11,
      decision: 'correction_required',
      tentative: 1,
      maxTentatives: 3,
    },
    { ...base(7), genre: 'conseil_clos', sessionId: 's1', issue: 'quorum', retenue: 'p1' },
  ];

  // Les preuves de `moi` : il a rendu le résultat 11, et l'avis 4 (son
  // `reviewerNodeId`, relu du payload brut par le serveur).
  const preuves = (
    p: Partial<Parameters<typeof debatsDuWorker>[1]> = {},
  ): Parameters<typeof debatsDuWorker>[1] => ({
    nodeId: 'moi',
    resultats: new Set([11]),
    avisRendus: new Set([4]),
    seulProducteur: new Set(),
    ...p,
  });

  it('rend chaque rôle, du plus récent au plus ancien, et rien de deviné', () => {
    const debats = debatsDuWorker(entrees, preuves());
    expect(debats.map((d) => [d.entree.id, d.role])).toEqual([
      [6, 'auteur'],
      [4, 'relecteur'],
      [2, 'eclaireuse'],
    ]);
  });

  it('LA FAMILLE SEULE NE PROUVE RIEN — un avis qu’il n’a pas rendu ne compte pas', () => {
    const debats = debatsDuWorker(
      entrees,
      preuves({ resultats: new Set(), avisRendus: new Set() }),
    );
    expect(debats.map((d) => d.entree.id)).toEqual([2]);
  });

  it('UNE TÂCHE REPRISE AILLEURS : le verdict sur le résultat de B ne va pas à A', () => {
    // A (`moi`) a rendu le résultat 41 de T, en échec ; T reprise chez B, qui
    // rend 42. Tout ce qui juge 42 est à B — même tâche, autre production.
    const surB: EntreeWarRoom[] = [
      {
        ...base(20),
        genre: 'contre_expertise',
        taskId: 'T',
        resultId: 42,
        possible: true,
        relecteurs: ['codex'],
        motif: null,
      },
      {
        ...base(21),
        genre: 'contre_verdict',
        taskId: 'T',
        resultId: 42,
        relecteur: 'codex',
        conteste: true,
        objections: [],
      },
      {
        ...base(22),
        genre: 'renvoi_evaluator',
        taskId: 'T',
        resultId: 42,
        decision: 'correction_required',
        tentative: 2,
        maxTentatives: 3,
      },
      { ...base(23), genre: 'renvoi_refuse', taskId: 'T', resultId: 42, raison: 'max' },
      // Un renvoi sans `resultId` ne désigne personne : inconnu reste inconnu.
      { ...base(24), genre: 'renvoi_refuse', taskId: 'T', resultId: null, raison: 'max' },
      // Une revue humaine juge la TÂCHE : A n'en est pas le seul producteur.
      { ...base(25), genre: 'revue_humaine', taskId: 'T', etat: 'rejected' },
      // Ce qui jugeait SON résultat 41 reste à lui.
      {
        ...base(26),
        genre: 'renvoi_evaluator',
        taskId: 'T',
        resultId: 41,
        decision: 'correction_required',
        tentative: 1,
        maxTentatives: 3,
      },
    ];
    const a = debatsDuWorker(surB, preuves({ resultats: new Set([41]), avisRendus: new Set() }));
    expect(a.map((d) => [d.entree.id, d.role])).toEqual([[26, 'auteur']]);
    const b = debatsDuWorker(
      surB,
      preuves({
        nodeId: 'B',
        resultats: new Set([42]),
        avisRendus: new Set(),
        seulProducteur: new Set(),
      }),
    );
    expect(b.map((d) => d.entree.id)).toEqual([23, 22, 21, 20]);
  });

  it('UNE RELECTURE REPRISE PAR UNE AUTRE OUVRIÈRE DE LA MÊME FAMILLE : l’avis est à celle qui l’a rendu', () => {
    // X (`moi`, codex) a échoué la relecture de P ; Y (codex aussi) l'a
    // reprise et a rendu l'avis 30. Seul Y a ce `reviewerNodeId`.
    const avis: EntreeWarRoom[] = [
      {
        ...base(29),
        genre: 'contre_echec',
        taskId: 'P',
        resultId: 7,
        relecteur: 'codex',
        terminal: false,
      },
      {
        ...base(30),
        genre: 'contre_verdict',
        taskId: 'P',
        resultId: 7,
        relecteur: 'codex',
        conteste: false,
        objections: [],
      },
    ];
    const x = debatsDuWorker(avis, preuves({ resultats: new Set(), avisRendus: new Set([29]) }));
    expect(x.map((d) => [d.entree.id, d.role])).toEqual([[29, 'relecteur']]);
  });

  it('une revue humaine est à l’auteur quand il est le SEUL producteur de la tâche', () => {
    const revue: EntreeWarRoom[] = [
      { ...base(40), genre: 'revue_humaine', taskId: 'U', etat: 'approved' },
    ];
    expect(debatsDuWorker(revue, preuves({ seulProducteur: new Set(['U']) }))[0]?.role).toBe(
      'auteur',
    );
    expect(debatsDuWorker(revue, preuves())).toEqual([]);
  });

  it('borne le fil à DEBATS_MAX entrées, les plus récentes', () => {
    const beaucoup: EntreeWarRoom[] = Array.from({ length: DEBATS_MAX + 5 }, (_, i) => ({
      ...base(i + 1),
      genre: 'revue_humaine' as const,
      taskId: 'prod-moi',
      etat: 'approved' as const,
    }));
    const debats = debatsDuWorker(beaucoup, preuves({ seulProducteur: new Set(['prod-moi']) }));
    expect(debats).toHaveLength(DEBATS_MAX);
    expect(debats[0]!.entree.id).toBe(DEBATS_MAX + 5);
  });
});

describe('leçons et missions', () => {
  const resultats = [
    {
      resultId: 3,
      taskId: 't3',
      success: false,
      durationMs: 30,
      createdAt: 3,
      logs: 'npm test\nError: expected 2 got 3 (clé sk-secret-de-la-reine)',
    },
    { resultId: 2, taskId: 't2', success: true, durationMs: 20, createdAt: 2, logs: '' },
    { resultId: 1, taskId: 't1', success: false, durationMs: -5, createdAt: 1, logs: '   ' },
  ];
  const titre = (id: string) => (id === 't3' ? 'Réparer le test' : null);

  it('une leçon = un échec rendu avec un extrait ; un échec muet n’en est pas une', () => {
    const lecons = leconsDuWorker(resultats, titre, (s) =>
      s.replace('sk-secret-de-la-reine', '[secret]'),
    );
    expect(lecons).toEqual([
      {
        resultId: 3,
        taskId: 't3',
        titre: 'Réparer le test',
        createdAt: 3,
        extrait: 'Error: expected 2 got 3 (clé [secret])',
      },
    ]);
  });

  it('UN SECRET À CHEVAL SUR LA COUPE DE LIGNE est caviardé entier — caviarder, PUIS extraire', () => {
    // L'extrait coupe chaque ligne à 200 caractères : caviardé après la coupe,
    // un secret qui la chevauche n'était plus reconnu, et son préfixe sortait.
    const secret = 'queen-token-0123456789abcdef0123456789';
    const logs = `Error: ${'x'.repeat(156)}${secret}`;
    const [lecon] = leconsDuWorker(
      [{ resultId: 9, taskId: 't9', success: false, durationMs: 1, createdAt: 9, logs }],
      () => null,
      (s) => s.split(secret).join('[secret]'),
    );
    expect(lecon?.extrait).toContain('[secr');
    expect(lecon?.extrait).not.toContain(secret.slice(0, 12));
  });

  it('les missions sont rendues UNE PAR UNE — aucune moyenne, aucune durée négative', () => {
    const missions = missionsDuWorker(resultats, titre);
    expect(missions.map((m) => [m.taskId, m.succes, m.dureeMs, m.titre])).toEqual([
      ['t3', false, 30, 'Réparer le test'],
      ['t2', true, 20, null],
      ['t1', false, 0, null],
    ]);
  });
});

describe('GET /api/workers/:nodeId/fiche', () => {
  const TOKEN = 'fiche-worker-token-assez-long';
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(): Promise<string> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-fiche-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    return `http://127.0.0.1:${server.port}`;
  }

  it('refuse sans jeton, 404 sur un nœud inconnu', async () => {
    const url = await demarrer();
    expect((await fetch(`${url}/api/workers/n1/fiche`)).status).toBe(401);
    const inconnu = await fetch(`${url}/api/workers/personne/fiche`, {
      headers: { 'x-hive-token': TOKEN },
    });
    expect(inconnu.status).toBe(404);
  });

  it('rend la trajectoire prouvée : missions, leçons, débats, mémoire non attribuée', async () => {
    const url = await demarrer();
    const s = server!.store;
    s.registerNode({
      nodeId: 'n1',
      name: 'poste-1',
      ownerName: 'micka',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
    s.registerNode({
      nodeId: 'n2',
      name: 'poste-2',
      ownerName: 'ami',
      agentType: 'codex',
      maxConcurrency: 1,
    });
    const projet = s.createProject({ name: 'Fiche' });
    const prod = s.createTask({ projectId: projet.id, title: 'Écrire le parseur', prompt: 'p' });
    const autre = s.createTask({ projectId: projet.id, title: 'Chez le voisin', prompt: 'p' });
    const relue = s.createTask({ projectId: projet.id, title: 'Relue par n1', prompt: 'p' });
    const relecture = s.createTask({ projectId: projet.id, title: 'Relecture', prompt: 'p' });
    // Figées : le tick ne doit pas les promouvoir pendant le test.
    for (const t of [prod, autre, relue, relecture]) s.patchTask(t.id, { status: 'failed' });

    s.insertResult({
      taskId: prod.id,
      nodeId: 'n1',
      diff: '',
      logs: `Error: parse failed at line 3 ${TOKEN}`,
      success: false,
      durationMs: 1200,
      subAgents: [],
    });
    s.insertResult({
      taskId: autre.id,
      nodeId: 'n2',
      diff: '',
      logs: 'Error: pas moi',
      success: false,
      durationMs: 5,
      subAgents: [],
    });
    s.insertResult({
      taskId: relecture.id,
      nodeId: 'n1',
      diff: '',
      logs: '',
      success: true,
      durationMs: 300,
      subAgents: [],
    });
    s.inscrireRelecture({
      relectureTaskId: relecture.id,
      productionTaskId: relue.id,
      relecteurNodeId: 'n1',
      relecteurAgent: 'claude-code',
      producteurAgent: 'codex',
    });
    s.appendEvent('task_retry', {
      taskId: prod.id,
      source: 'evaluator',
      decision: 'correction_required',
      resultId: 1,
      attempt: 1,
      maxAttempts: 3,
    });
    s.appendEvent('contre_expertise_verdict', {
      taskId: relue.id,
      resultId: 7,
      relecteur: 'claude-code',
      reviewerNodeId: 'n1',
      conteste: true,
      objections: ['pas de test'],
    });
    // Même famille, même production, mais rendu par un AUTRE nœud : pas à n1.
    s.appendEvent('contre_expertise_verdict', {
      taskId: relue.id,
      resultId: 7,
      relecteur: 'claude-code',
      reviewerNodeId: 'n3',
      conteste: false,
      objections: [],
    });
    // Un débat sur la production de n2 : n1 n'y est pour rien.
    s.appendEvent('task_retry', {
      taskId: autre.id,
      source: 'evaluator',
      decision: 'correction_required',
      resultId: 2,
      attempt: 1,
      maxAttempts: 3,
    });

    const res = await fetch(`${url}/api/workers/n1/fiche`, { headers: { 'x-hive-token': TOKEN } });
    expect(res.status).toBe(200);
    const fiche = (await res.json()) as {
      worker: { id: string; agentType: string };
      missions: Array<{ taskId: string; succes: boolean; dureeMs: number }>;
      lecons: Array<{ taskId: string; extrait: string }>;
      debats: Array<{ role: string; entree: { genre: string; taskId?: string } }>;
      taches: Record<string, { titre: string }>;
      modelesCourants: unknown[];
      memoire: string;
    };
    expect(fiche.worker).toMatchObject({ id: 'n1', agentType: 'claude-code' });
    expect(fiche.missions.map((m) => [m.taskId, m.succes, m.dureeMs])).toEqual([
      [relecture.id, true, 300],
      [prod.id, false, 1200],
    ]);
    // La leçon est la sienne, et le jeton de la Reine n'en sort jamais.
    expect(fiche.lecons).toHaveLength(1);
    expect(fiche.lecons[0]!.taskId).toBe(prod.id);
    expect(fiche.lecons[0]!.extrait).toContain('parse failed');
    expect(JSON.stringify(fiche)).not.toContain(TOKEN);
    expect(fiche.debats.map((d) => [d.role, d.entree.genre, d.entree.taskId])).toEqual([
      ['relecteur', 'contre_verdict', relue.id],
      ['auteur', 'renvoi_evaluator', prod.id],
    ]);
    expect(fiche.taches[prod.id]?.titre).toBe('Écrire le parseur');
    expect(fiche.modelesCourants).toEqual([]);
    expect(fiche.memoire).toBe('non_attribuee');
  });
});
