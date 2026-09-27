// La contre-revue reste INDÉPENDANTE quand une relecture change de mains.
//
// ─── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
//
// Depuis qu'UN avis favorable d'une autre famille d'agent suffit à `accepted`,
// l'indépendance de cet avis n'est plus une politesse : c'est la condition.
// Or une relecture est une tâche comme une autre — elle échoue, elle est
// refusée par un nœud saturé, son nœud se déconnecte — et elle repart alors
// en file. Deux choses cassaient à ce moment-là, et aucun test pur ne pouvait
// les voir, parce qu'elles vivent entre le planificateur et le serveur :
//
//   · le planificateur donnait la relecture remise en file au premier nœud
//     libre — souvent le PRODUCTEUR, qui relisait son propre diff ;
//   · le verdict consignait le relecteur CHOISI au lancement, pas le nœud qui
//     avait réellement rendu l'avis : l'auto-relecture passait pour une
//     « contre-revue favorable de codex », et l'Evaluator acceptait.
//
// On monte donc une vraie ruche, de vrais nœuds en WebSocket, et on rejoue la
// remise en file telle qu'elle arrive en production.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-contre-revue-suffisamment-long';
const DIFF = 'diff --git a/auth.ts b/auth.ts\n+if (!jeton) return;';

interface Assignation {
  type: string;
  task?: { id: string };
}

interface Noeud {
  ws: WebSocket;
  recues: Assignation[];
  /** Envoie un `task_result` au nom de CE nœud — son texte est aussi sa réponse finale. */
  rendre: (taskId: string, success: boolean, logs: string) => void;
}

interface Evaluation {
  decision: string;
  reasons: string[];
}

describe('la contre-revue reste indépendante quand une relecture change de mains', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function ruche(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-cri-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60,
    });
    return server;
  }

  async function noeud(srv: HiveServer, nodeId: string, agentType: string): Promise<Noeud> {
    const recues: Assignation[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as Assignation;
      if (m.type === 'assign_task') recues.push(m);
    });
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: nodeId,
        ownerName: 'test',
        agentType,
        maxConcurrency: 1,
        nodeId,
      }),
    );
    // L'inscription est asynchrone : la tâche suivante ne doit pas partir
    // avant que le nœud existe, sinon l'ordre d'assignation devient aléatoire.
    await attendre(() => srv.store.getNode(nodeId)?.status === 'online', 'nœud non inscrit');
    // L'avis voyage dans `finalText`, la réponse finale de l'agent : le hub ne
    // lit plus un verdict dans les logs bruts (`noterVerdict`).
    const rendre = (taskId: string, success: boolean, logs: string): void =>
      ws.send(
        JSON.stringify({
          type: 'task_result',
          taskId,
          success,
          diff: '',
          logs,
          finalText: logs,
          durationMs: 5,
          subAgents: [],
        }),
      );
    return { ws, recues, rendre };
  }

  async function attendre(condition: () => boolean, message: string, ms = 5_000): Promise<void> {
    const fin = Date.now() + ms;
    while (!condition() && Date.now() < fin) await new Promise((r) => setTimeout(r, 30));
    expect(condition(), message).toBe(true);
  }

  /** L'id de la relecture que `n` a reçue, parmi ses assignations. */
  async function relectureRecue(srv: HiveServer, n: Noeud, sauf: string[] = []): Promise<string> {
    let id: string | undefined;
    await attendre(() => {
      id = n.recues
        .map((a) => a.task?.id)
        .find((t) => t !== undefined && !sauf.includes(t) && srv.store.relectureDe(t) !== null);
      return id !== undefined;
    }, 'aucune relecture reçue');
    return id as string;
  }

  /** Le producteur (premier nœud) produit un diff ; rend la production et son résultat. */
  async function produire(
    srv: HiveServer,
    producteur: Noeud,
  ): Promise<{ production: string; resultId: number }> {
    const projet = srv.store.createProject({ name: 'Ruche' });
    const t = srv.store.createTask({
      projectId: projet.id,
      title: 'Ajouter une garde',
      prompt: 'p',
    });
    srv.store.patchTask(t.id, { status: 'ready' });
    await attendre(
      () => producteur.recues.some((a) => a.task?.id === t.id),
      'le producteur n’a rien reçu',
    );
    producteur.ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: t.id,
        success: true,
        diff: DIFF,
        logs: 'ok',
        durationMs: 5,
        subAgents: [],
      }),
    );
    await attendre(
      () => srv.store.relecturesDeProduction(t.id).length > 0,
      'aucune relecture lancée',
    );
    const resultId = srv.store.resultsForTask(t.id).at(-1)?.resultId;
    expect(resultId).toBeTypeOf('number');
    return { production: t.id, resultId: resultId as number };
  }

  /**
   * Tout ce qu'il faut pour `accepted`, SAUF l'avis : Gardiennes propres (le
   * mode consultatif par défaut a inspecté la production) et une CI verte
   * rattachée à ce résultat exact. Seule la contre-revue décide donc du reste.
   */
  function preuvesVertes(srv: HiveServer, production: string, resultId: number): void {
    expect(
      srv.store.listInspections().find((i) => i.resultId === resultId)?.verdict,
      'la production doit avoir été inspectée propre',
    ).toBe('clean');
    srv.store.appendEvent('ci_validation_recorded', {
      source: 'github_pull_request',
      taskId: production,
      projectId: srv.store.getTask(production)?.projectId,
      resultId,
      depot: 'demo/hive',
      pr: 7,
      branch: `hive/${production}`,
      commitSha: 'commit-relu',
      validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
      recordedAt: 1,
    });
  }

  async function evaluation(srv: HiveServer, taskId: string): Promise<Evaluation> {
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${taskId}/evaluation`, {
      headers: { 'x-hive-token': TOKEN },
    });
    expect(r.status).toBe(200);
    return (await r.json()) as Evaluation;
  }

  const verdicts = (srv: HiveServer, production: string): Array<Record<string, unknown>> =>
    srv.store
      .listEvents(0, 500)
      .filter((e) => e.type === 'contre_expertise_verdict' && e.payload.taskId === production)
      .map((e) => e.payload);

  it(
    'UNE RELECTURE REMISE EN FILE NE REVIENT PAS AU PRODUCTEUR — il ne se relit pas, et rien n’est accepté',
    { timeout: 30_000 },
    async () => {
      // Les noms fixent le départage : à charge égale, `aaa` passe avant
      // `bbb`. Sans garde, c'est donc le producteur qui reprend la relecture.
      const srv = await ruche();
      const producteur = await noeud(srv, 'aaa-producteur', 'claude-code');
      const relecteur = await noeud(srv, 'bbb-relecteur', 'codex');

      const { production, resultId } = await produire(srv, producteur);
      const relecture = await relectureRecue(srv, relecteur);
      preuvesVertes(srv, production, resultId);

      // Le relecteur choisi échoue une fois : la relecture repart en file.
      relecteur.rendre(relecture, false, 'relecteur indisponible');
      // `attempts` d'abord : sans lui, l'état `assigned` d'AVANT l'échec
      // satisferait l'attente, et l'assertion regarderait l'ancien nœud.
      await attendre(() => {
        const t = srv.store.getTask(relecture);
        return t?.attempts === 1 && t.status === 'assigned';
      }, 'la relecture n’a pas été réassignée');
      expect(
        srv.store.getTask(relecture)?.assignedNodeId,
        'la relecture remise en file est repartie chez le producteur',
      ).not.toBe('aaa-producteur');
      expect(producteur.recues.some((a) => a.task?.id === relecture)).toBe(false);

      // Même si le nœud producteur répond à sa place, son « valide » n'est
      // pas un avis indépendant : il ne doit ni compter, ni faire accepter.
      producteur.rendre(relecture, true, 'valide');
      await new Promise((r) => setTimeout(r, 300));
      expect(
        verdicts(srv, production).filter((v) => v.relecteur === 'claude-code'),
        'la famille productrice a rendu un avis sur son propre diff',
      ).toEqual([]);
      const e = await evaluation(srv, production);
      expect(e.decision, e.reasons.join(' · ')).not.toBe('accepted');
    },
  );

  it(
    'L’AVIS EST ATTRIBUÉ AU NŒUD QUI L’A RENDU, pas au relecteur choisi au lancement',
    { timeout: 30_000 },
    async () => {
      // Trois familles : `choisirCritiques` lance une relecture codex (nœud
      // `bbb-relecteur`) ET une relecture hermes-agent. Le nœud codex choisi
      // refuse la sienne (saturé) ; elle repart en file. Elle ne change pas de
      // FAMILLE (le planificateur la réserve à la sienne, voir `relecteurAbsent` :
      // hermes, libre, compterait deux fois), mais elle change de NŒUD : un second nœud codex,
      // `ddd-codex-bis`, la rend. L'avis est le sien, et c'est lui que la ruche
      // doit nommer — pas `bbb-relecteur`, qui n'a rien relu.
      const srv = await ruche();
      const producteur = await noeud(srv, 'aaa-producteur', 'claude-code');
      const codex = await noeud(srv, 'bbb-relecteur', 'codex');
      const hermes = await noeud(srv, 'ccc-tiers', 'hermes-agent');
      const codexBis = await noeud(srv, 'ddd-codex-bis', 'codex');

      const { production, resultId } = await produire(srv, producteur);
      const relectureCodex = await relectureRecue(srv, codex);
      const relectureHermes = await relectureRecue(srv, hermes);
      preuvesVertes(srv, production, resultId);

      hermes.rendre(relectureHermes, true, 'valide');
      await attendre(() => verdicts(srv, production).length === 1, 'premier avis absent');

      codex.ws.send(
        JSON.stringify({ type: 'task_reject', taskId: relectureCodex, reason: 'saturé' }),
      );
      const reprise = await relectureRecue(srv, codexBis);
      expect(reprise).toBe(relectureCodex);
      expect(
        hermes.recues.some((a) => a.task?.id === relectureCodex),
        'la relecture codex est partie chez une autre famille',
      ).toBe(false);
      codexBis.rendre(relectureCodex, true, 'valide');
      await attendre(() => verdicts(srv, production).length === 2, 'second avis absent');

      const repris = verdicts(srv, production).find((v) => v.relecture === relectureCodex);
      expect(repris, 'l’avis est attribué au relecteur choisi, pas à son auteur').toMatchObject({
        relecteur: 'codex',
        reviewerNodeId: 'ddd-codex-bis',
        producteur: 'claude-code',
      });
      expect(srv.store.contreVisiteDe(production)).toMatchObject({
        visiteurNodeId: 'ddd-codex-bis',
        visiteurAgent: 'codex',
      });

      // L'Evaluator accepte — sur les avis des deux familles qui ont
      // réellement relu.
      const e = await evaluation(srv, production);
      expect(e.decision, e.reasons.join(' · ')).toBe('accepted');
      expect(e.reasons.join(' ')).toContain('hermes-agent');
      expect(e.reasons.join(' ')).toContain('codex');
    },
  );
});
