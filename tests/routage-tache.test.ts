// « Pourquoi ce Worker ? Pourquoi ce modèle ? » — la raison relue dans le
// journal, jamais recalculée.
//
// Deux étages :
//   · la projection pure (`affectationsDepuisEvenements`) : appariement des
//     phéromones à l'affectation qui suit, « à explorer » au lieu d'une moyenne
//     de 0, absence de modèle dite telle quelle, payload illisible ignoré ;
//   · la route `/api/tasks/:id/routage` sur une vraie Reine, après une vraie
//     affectation de l'ordonnanceur avec des nœuds qui déclarent leurs modèles.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { affectationsDepuisEvenements } from '../src/shared/routage-vue.js';
import type { HiveEvent } from '../src/shared/types.js';

const ev = (id: number, type: string, payload: Record<string, unknown>): HiveEvent => ({
  id,
  ts: 1_000 + id,
  type,
  payload,
});

describe('affectationsDepuisEvenements — la raison, telle que le journal la garde', () => {
  it('RELIT LA RAISON FIGÉE — élu, catégorie, classement, et le critère du nœud', () => {
    const [a] = affectationsDepuisEvenements([
      ev(1, 'task_assigned', {
        taskId: 't',
        nodeId: 'n1',
        modele: 'opus',
        categorie: 'code',
        raisonModele: [
          { modele: 'opus', essais: 3, moyenne: 1, score: 1.9 },
          { modele: 'fable', essais: 3, moyenne: 0, score: 0.9 },
        ],
      }),
    ]);
    expect(a?.modele).toBe('opus');
    expect(a?.categorie).toBe('code');
    expect(a?.raisonModele.map((l) => l.modele)).toEqual(['opus', 'fable']);
    expect(a?.critereNoeud).toBe('porteur_du_modele');
  });

  it('UN MODÈLE JAMAIS ESSAYÉ EST « À EXPLORER » — sa moyenne n’est pas une mesure', () => {
    // Le score UCB +∞ devient `null` en JSON ; la moyenne vaut 0 par
    // convention. Ni l'un ni l'autre ne doit se lire comme « mauvais ».
    const [a] = affectationsDepuisEvenements([
      ev(1, 'task_assigned', {
        taskId: 't',
        nodeId: 'n2',
        modele: 'grok',
        raisonModele: [{ modele: 'grok', essais: 0, moyenne: 0, score: null }],
      }),
    ]);
    expect(a?.raisonModele[0]).toEqual({
      modele: 'grok',
      essais: 0,
      moyenne: null,
      score: null,
      aExplorer: true,
    });
  });

  it('LES PHÉROMONES S’ATTACHENT À L’AFFECTATION QUI SUIT — et au même nœud seulement', () => {
    const affectations = affectationsDepuisEvenements([
      ev(1, 'pheromone_route', { taskId: 't', nodeId: 'n1', domaine: 'ui', score: 0.7 }),
      ev(2, 'task_assigned', { taskId: 't', nodeId: 'n1' }),
      // Un départage consigné pour un AUTRE nœud ne parle pas de celui-ci.
      ev(3, 'pheromone_route', { taskId: 't', nodeId: 'n9', domaine: 'ui', score: 0.4 }),
      ev(4, 'task_assigned', { taskId: 't', nodeId: 'n2' }),
    ]);
    expect(affectations.map((a) => a.critereNoeud)).toEqual(['pheromones', 'moins_charge']);
    expect(affectations[0]?.pheromone).toEqual({ domaine: 'ui', score: 0.7 });
    expect(affectations[1]?.pheromone).toBeNull();
  });

  it('SANS MODÈLE DÉCLARÉ, RIEN N’EST INVENTÉ — ni modèle, ni catégorie, ni classement', () => {
    const [a] = affectationsDepuisEvenements([
      ev(1, 'task_assigned', { taskId: 't', nodeId: 'n1' }),
    ]);
    expect(a).toMatchObject({
      modele: null,
      categorie: null,
      raisonModele: [],
      critereNoeud: 'moins_charge',
    });
  });

  it('UN PAYLOAD ILLISIBLE EST IGNORÉ, JAMAIS DEVINÉ — et l’ordre est celui du journal', () => {
    const affectations = affectationsDepuisEvenements([
      ev(5, 'task_assigned', { taskId: 't', nodeId: 'n2' }),
      ev(2, 'task_assigned', { taskId: 't', nodeId: 'n1', raisonModele: [{ essais: 'x' }, 42] }),
      ev(3, 'task_assigned', { taskId: 't' }),
    ]);
    expect(affectations.map((a) => a.nodeId)).toEqual(['n1', 'n2']);
    expect(affectations[0]?.raisonModele).toEqual([]);
  });
});

describe('/api/tasks/:id/routage — sur une vraie Reine', () => {
  const JETON = 'jeton-routage-suffisamment-long';
  let serveur: HiveServer | null = null;
  let dossier = '';

  afterEach(async () => {
    await serveur?.stop();
    serveur = null;
    if (dossier) rmSync(dossier, { recursive: true, force: true });
  });

  async function reine(): Promise<{ s: HiveServer; base: string }> {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'routage-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: true,
      tickMs: 3_600_000,
    });
    return { s: serveur, base: `http://127.0.0.1:${serveur.port}` };
  }

  /** Du vécu « code » jugé pour `modele`, comme en produit la contre-visite. */
  function vecu(s: HiveServer, modele: string, suite: 'appliquer' | 'refaire', n: number): void {
    const p = s.store.createProject({ name: `vecu-${modele}` });
    for (let i = 0; i < n; i++) {
      const t = s.store.createTask({
        projectId: p.id,
        title: 'Ajoute un endpoint',
        prompt: 'implémente la fonction',
      }).id;
      s.store.poserModeleAiguillage(t, modele, 1_000 + i);
      s.store.enregistrerContreVisite({
        productionTaskId: t,
        suite,
        raison: '',
        visiteurNodeId: 'v',
        visiteurAgent: 'claude-code',
        now: 2_000 + i,
      });
      s.store.patchTask(t, { status: 'done' });
    }
  }

  const profil = (name: string, modeles?: string[]) => ({
    name,
    ownerName: 'banc',
    agentType: 'shell',
    maxConcurrency: 1,
    ...(modeles ? { modeles } : {}),
  });

  it('APRÈS UNE VRAIE AFFECTATION, LA ROUTE DIT POURQUOI — modèle, classement, Worker', async () => {
    const { s, base } = await reine();
    vecu(s, 'opus', 'appliquer', 3);
    vecu(s, 'fable', 'refaire', 3);
    s.scheduler.registerNode(profil('aaa', ['fable']));
    const porteur = s.scheduler.registerNode(profil('zzz', ['opus']));
    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({
      projectId: p.id,
      title: 'Ajoute le composant Ruche',
      prompt: 'implémente l’endpoint',
    }).id;

    s.scheduler.tick(Date.now());

    const r = await fetch(`${base}/api/tasks/${t}/routage`, { headers: { 'x-hive-token': JETON } });
    expect(r.status).toBe(200);
    const corps = (await r.json()) as {
      affectations: {
        nodeId: string;
        modele: string;
        categorie: string;
        raisonModele: { modele: string }[];
        critereNoeud: string;
      }[];
    };
    expect(corps.affectations).toHaveLength(1);
    const [a] = corps.affectations;
    expect(a?.nodeId, 'le porteur d’opus').toBe(porteur.id);
    expect(a?.modele).toBe('opus');
    expect(a?.categorie).toBe('code');
    expect(a?.raisonModele[0]?.modele, 'l’élu en tête de la raison').toBe('opus');
    expect(a?.critereNoeud).toBe('porteur_du_modele');
  });

  it('SANS JETON, RIEN — et une tâche inconnue répond 404', async () => {
    const { s, base } = await reine();
    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({ projectId: p.id, title: 'x', prompt: 'y' }).id;
    expect((await fetch(`${base}/api/tasks/${t}/routage`)).status).toBe(401);
    const inconnue = await fetch(`${base}/api/tasks/pas-une-tache/routage`, {
      headers: { 'x-hive-token': JETON },
    });
    expect(inconnue.status).toBe(404);
  });

  it('UNE TÂCHE PAS ENCORE AFFECTÉE N’A AUCUNE AFFECTATION — rien n’est inventé', async () => {
    const { s, base } = await reine();
    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({ projectId: p.id, title: 'x', prompt: 'y' }).id;
    const r = await fetch(`${base}/api/tasks/${t}/routage`, { headers: { 'x-hive-token': JETON } });
    expect(((await r.json()) as { affectations: unknown[] }).affectations).toEqual([]);
  });
});
