// Motifs perso — procédures créées depuis la Chambre (ADR 0010 lot 10).

import { describe, expect, it } from 'vitest';
import { validerMotifPerso } from '../src/orchestrator/motifs.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('motifs perso — forme', () => {
  it('valide libellé et étapes', () => {
    expect(validerMotifPerso('Mon flux', ['A', 'B'])).toMatchObject({
      ok: true,
      etapes: ['A', 'B'],
    });
    expect(validerMotifPerso('', ['x'])).toEqual({ ok: false, motif: 'vide' });
    expect(validerMotifPerso('x', [])).toEqual({ ok: false, motif: 'vide' });
  });
});

describe('HiveStore — motifs perso', () => {
  it('crée, liste et lit', () => {
    const store = new HiveStore(':memory:');
    const p = store.createProject({ name: 'P' });
    const c = store.creerMotifProjet(p.id, 'Procédure test', ['Étape 1', 'Étape 2']);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const rows = store.listerMotifsProjet(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.etapes).toEqual(['Étape 1', 'Étape 2']);
    expect(store.lireMotifProjet(c.id)?.libelle).toBe('Procédure test');
  });
});

describe('API motifs perso', () => {
  it('crée et applique en tâches chaînées', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { createServer } = await import('../src/orchestrator/server.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-motif-perso-'));
    const TOKEN = 'jeton-motif-perso-assez-long';
    const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
    const server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60_000,
    });
    try {
      const projet = (await (
        await fetch(`${server.url}/api/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Perso' }),
        })
      ).json()) as { id: string };
      const cree = await fetch(`${server.url}/api/projects/${projet.id}/motifs/perso`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ libelle: 'Flux perso', etapes: ['A', 'B'] }),
      });
      expect(cree.status).toBe(200);
      const body = (await cree.json()) as { id: string };
      const appl = await fetch(
        `${server.url}/api/projects/${projet.id}/motifs/perso/${body.id}/appliquer`,
        { method: 'POST', headers, body: '{}' },
      );
      expect(appl.status).toBe(200);
      const res = (await appl.json()) as { taskIds: string[] };
      expect(res.taskIds).toHaveLength(2);
      const t0 = server.store.getTask(res.taskIds[0]!);
      const t1 = server.store.getTask(res.taskIds[1]!);
      expect(t0?.status).toBe('ready');
      expect(t1?.dependsOn).toEqual([res.taskIds[0]]);
    } finally {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
