// Contrat HTTP du Plein Essaim.
//
// Le test qui compte ici n'est pas « la route répond 200 ». C'est celui-ci :
// AUCUNE combinaison de requêtes ne doit amener la ruche à décider `fusionner`
// sans que l'humain ait, une fois, inscrit le dépôt. Le module pur le garantit
// déjà ; on vérifie que le câblage ne l'a pas défait en chemin.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GOUVERNANTES_MIN, NIVEAUX } from '../src/orchestrator/essaim.js';
import type { NiveauAutonomie, Pas } from '../src/orchestrator/essaim.js';
import { SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-essaim-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

interface ReponseEssaim {
  niveau: NiveauAutonomie;
  decision: { pas: Pas; motif: string; gouvernantes: string[] };
  gouvernantes: Array<{ nodeId: string; nom: string }>;
  gouvernantesRequises: number;
  depotInscrit: boolean;
  lecons: Array<{ signature: string; noeuds: number; portee: string }>;
  niveaux: NiveauAutonomie[];
}

describe('endpoint du Plein Essaim', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(): Promise<{ base: string; srv: HiveServer }> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-essaim-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    return { base: `http://127.0.0.1:${server.port}`, srv: server };
  }

  /** Un projet, avec ou sans dépôt GitHub connu. */
  function projet(srv: HiveServer, repoUrl: string | null = null): string {
    return srv.store.createProject({ name: 'Ruche', ...(repoUrl ? { repoUrl } : {}) }).id;
  }

  /** `n` ouvrières irréprochables et en ligne : de quoi gouverner. */
  function gouvernantes(srv: HiveServer, n: number): void {
    for (let i = 0; i < n; i++) {
      const id = `gouv-${i}`;
      srv.store.registerNode({
        nodeId: id,
        name: id,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
      });
      srv.store.setNodeStatus(id, 'online');
      for (let k = 0; k < SEUIL_BUTINEUSE; k++) {
        srv.store.enregistrerInspection({
          resultId: i * 1000 + k + 1,
          taskId: `T${i}-${k}`,
          nodeId: id,
          verdict: 'clean',
          score: 0,
          applique: false,
          griefs: [],
        });
      }
    }
  }

  const lire = async (base: string, id: string): Promise<ReponseEssaim> =>
    (await (await fetch(`${base}/api/projects/${id}/essaim`, { headers })).json()) as ReponseEssaim;

  const regler = (
    base: string,
    id: string,
    niveau: NiveauAutonomie,
    depotInscrit: boolean,
  ): Promise<Response> =>
    fetch(`${base}/api/projects/${id}/essaim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ niveau, depotInscrit }),
    });

  it('le défaut est « off » : une ruche neuve ne se gouverne pas toute seule', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv);
    const e = await lire(base, p);
    expect(e.niveau).toBe('off');
    expect(e.decision.pas).toBe('inerte');
    expect(e.depotInscrit).toBe(false);
  });

  it('sans ouvrière éprouvée, allumer « plein » ne démarre rien', async () => {
    // Le garde-fou n'est pas contournable par l'API non plus.
    const { base, srv } = await demarrer();
    const p = projet(srv, 'https://github.com/moi/projet.git');
    await regler(base, p, 'plein', true);
    const e = await lire(base, p);
    expect(e.niveau).toBe('plein');
    expect(e.decision.pas).toBe('inerte');
    expect(e.gouvernantes).toHaveLength(0);
    expect(e.gouvernantesRequises).toBe(GOUVERNANTES_MIN);
  });

  it('une seule ouvrière éprouvée ne suffit pas', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv, 'https://github.com/moi/projet.git');
    gouvernantes(srv, 1);
    await regler(base, p, 'plein', true);
    expect((await lire(base, p)).decision.pas).toBe('inerte');
  });

  it('deux ouvrières éprouvées : la ruche se met à délibérer', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv, 'https://github.com/moi/projet.git');
    gouvernantes(srv, 2);
    await regler(base, p, 'gouverne', false);
    const e = await lire(base, p);
    expect(e.gouvernantes).toHaveLength(2);
    expect(e.decision.pas).toBe('deliberer');
    expect(e.decision.gouvernantes).toEqual(['gouv-0', 'gouv-1']);
  });

  it('l’inscription du dépôt est REFUSÉE sans dépôt GitHub connu', async () => {
    // Accepter un réglage qui ne pourra jamais rien produire serait mentir.
    const { base, srv } = await demarrer();
    const p = projet(srv, null);
    const rep = await regler(base, p, 'plein', true);
    expect(rep.status).toBe(409);
    const corps = (await rep.json()) as { conseil: string };
    expect(corps.conseil).toMatch(/github-import/);
  });

  it('l’inscription ne tient pas si le dépôt n’est pas sur GitHub', async () => {
    // Une repoUrl maison ne doit jamais valoir autorisation de fusion.
    const { base, srv } = await demarrer();
    const p = projet(srv, 'https://gitlab.example.com/moi/projet.git');
    await regler(base, p, 'gouverne', true);
    expect((await lire(base, p)).depotInscrit).toBe(false);
  });

  it('le niveau et l’inscription sont deux réglages distincts', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv, 'https://github.com/moi/projet.git');
    await regler(base, p, 'gouverne', true);
    let e = await lire(base, p);
    expect(e.niveau).toBe('gouverne');
    expect(e.depotInscrit).toBe(true);

    // Retirer l'autorisation sans toucher au niveau.
    await regler(base, p, 'gouverne', false);
    e = await lire(base, p);
    expect(e.niveau).toBe('gouverne');
    expect(e.depotInscrit).toBe(false);
  });

  it('le réglage survit et se relit', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv, 'https://github.com/moi/projet.git');
    for (const n of NIVEAUX) {
      await regler(base, p, n, false);
      expect((await lire(base, p)).niveau, n).toBe(n);
    }
  });

  it('un niveau inconnu est refusé', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv);
    const rep = await fetch(`${base}/api/projects/${p}/essaim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ niveau: 'dieu' }),
    });
    expect(rep.status).toBe(400);
  });

  it('les leçons croisées remontent, avec leur portée', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv);
    gouvernantes(srv, 2);
    // La MÊME erreur sur trois nœuds différents.
    for (const n of ['a', 'b', 'c']) {
      srv.store.insertResult({
        taskId: `t-${n}`,
        nodeId: n,
        success: false,
        diff: '',
        logs: 'Error: connexion refusée sur le port 5432',
        durationMs: 10,
        subAgents: [],
      });
    }
    const e = await lire(base, p);
    expect(e.lecons.length).toBeGreaterThan(0);
    expect(e.lecons[0]?.noeuds).toBe(3);
    expect(e.lecons[0]?.portee).toBe('systemique');
  });

  it('une leçon systémique détourne la ruche vers la correction', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv, 'https://github.com/moi/projet.git');
    gouvernantes(srv, 2);
    for (const n of ['a', 'b', 'c']) {
      srv.store.insertResult({
        taskId: `t-${n}`,
        nodeId: n,
        success: false,
        diff: '',
        logs: 'TypeError: config is not a function',
        durationMs: 10,
        subAgents: [],
      });
    }
    await regler(base, p, 'plein', true);
    const e = await lire(base, p);
    expect(e.decision.pas).toBe('corriger');
    expect(e.decision.motif).toMatch(/3 nœuds/);
  });

  it('les deux routes sont protégées par le jeton', async () => {
    const { base, srv } = await demarrer();
    const p = projet(srv);
    expect((await fetch(`${base}/api/projects/${p}/essaim`)).status).toBe(401);
    const rep = await fetch(`${base}/api/projects/${p}/essaim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ niveau: 'plein' }),
    });
    expect(rep.status).toBe(401);
  });

  it('un projet inconnu rend 404 dans les deux sens', async () => {
    const { base } = await demarrer();
    expect((await fetch(`${base}/api/projects/inexistant/essaim`, { headers })).status).toBe(404);
    expect((await regler(base, 'inexistant', 'plein', false)).status).toBe(404);
  });
});
