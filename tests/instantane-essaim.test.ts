// L'instantané de l'essaim — et le jeton qui y voyageait.
//
// `GET /api/state` et le message WebSocket `state` ne demandent que le jeton de
// ruche, recopié sur CHAQUE machine membre (ADR 0007). Ils rendaient pourtant
// `listProjects()` tel qu'en base : `repoUrl` compris, donc le jeton GitHub
// d'un dépôt privé cloné par `https://user:ghp_…@github.com/…`. Le tableau de
// bord lavait l'AFFICHAGE ; le fil, lui, portait le secret en clair.
//
// Ce fichier prouve trois choses :
//   1. `laverIdentifiants` retire le secret sous toutes ses formes, et ne
//      touche à rien d'autre (chemins locaux, `git@`, URL propres).
//   2. Les TROIS sorties de l'instantané — HTTP, accueil WebSocket, diffusion —
//      sont lavées, alors que le magasin garde l'URL entière pour le clonage.
//   3. Aucune route future ne peut renvoyer `store.getSnapshot()` brut sans que
//      le test de source rougisse.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { instantanePourEssaim, laverIdentifiants } from '../src/shared/projet-public.js';
import type { StateSnapshot, Task } from '../src/shared/types.js';

const SECRET = 'ghp_TRESSECRET';
const DEPOT_LAVE = 'https://github.com/mika/depot.git';
const DEPOT_BRUT = `https://mika:${SECRET}@github.com/mika/depot.git`;

async function attendre(condition: () => boolean, delaiMs = 5_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('condition non atteinte à temps');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('laverIdentifiants — le secret part, rien d’autre ne bouge', () => {
  it('RETIRE LES IDENTIFIANTS ET GARDE L’URL', () => {
    expect(laverIdentifiants(DEPOT_BRUT)).toBe(DEPOT_LAVE);
    // GitHub accepte le jeton seul, en guise de nom d'utilisateur.
    expect(laverIdentifiants(`https://${SECRET}@gitlab.com/org/depot.git`)).toBe(
      'https://gitlab.com/org/depot.git',
    );
  });

  it('AUCUNE FORME NE LAISSE FUIR LE SECRET', () => {
    for (const url of [
      `https://user:${SECRET}@github.com/org/d.git`,
      `https://${SECRET}@github.com/org/d.git`,
      `https://user:${SECRET}@github.com:8443/org/d.git`,
      `http://user:${SECRET}@interne.local/d.git`,
      `https://user:${SECRET}@github.com/org/d.git?x=1#f`,
      // Illisible par `new URL` (espace dans l'hôte), mais qui en a la forme :
      // le filet de secours doit retirer l'arobase et ce qui la précède.
      `https://user:${SECRET}@git hub.com/org/d.git`,
    ]) {
      expect(laverIdentifiants(url) ?? '', url).not.toContain(SECRET);
    }
  });

  it('ce qui ne porte pas d’identifiants est rendu À L’IDENTIQUE', () => {
    // Contrairement au catalogue anonyme (`sansIdentifiants`) : l'essaim est
    // authentifié, et le tableau de bord se sert de la PRÉSENCE d'un dépôt pour
    // proposer tickets et livraisons. Un chemin local ne devient pas `null`.
    for (const url of [
      'https://github.com/org/depot.git',
      'https://github.com/org/depot',
      'git@github.com:org/depot.git',
      '/home/mika/projets/depot',
      'C:\\Users\\mika\\depot',
      '\\\\srv\\partage\\depot',
    ]) {
      expect(laverIdentifiants(url), url).toBe(url);
    }
    expect(laverIdentifiants(null)).toBeNull();
  });
});

describe('instantanePourEssaim — une copie lavée, jamais une retouche', () => {
  const instantane = (): StateSnapshot => ({
    projects: [
      {
        id: 'p1',
        name: 'Privé',
        repoUrl: DEPOT_BRUT,
        description: null,
        visibility: 'private',
        ownerId: 'u1',
        createdAt: 1,
      },
      {
        id: 'p2',
        name: 'Sans dépôt',
        repoUrl: null,
        description: 'd',
        visibility: 'public',
        ownerId: null,
        createdAt: 2,
      },
    ],
    nodes: [],
    tasks: [],
    tasksTotal: 0,
  });

  it('lave le dépôt et garde tout le reste', () => {
    const lave = instantanePourEssaim(instantane());
    expect(JSON.stringify(lave)).not.toContain(SECRET);
    expect(lave.projects[0]!.repoUrl).toBe(DEPOT_LAVE);
    expect(lave.projects[1]!.repoUrl).toBeNull();
    const sansDepot = (s: StateSnapshot) => s.projects.map((p) => ({ ...p, repoUrl: null }));
    expect(sansDepot(lave), 'un autre champ que repoUrl a changé').toEqual(sansDepot(instantane()));
    expect(lave.tasksTotal).toBe(0);
  });

  it('NE MODIFIE PAS l’instantané reçu — le magasin garde l’URL entière', () => {
    const brut = instantane();
    instantanePourEssaim(brut);
    expect(brut.projects[0]!.repoUrl).toBe(DEPOT_BRUT);
  });

  it('LAVE AUSSI L’URL RECOPIÉE DANS LES TÂCHES — mot pour mot, rien d’autre', () => {
    // Une éclaireuse du Conseil créée avant le lavage à la source garde l'URL
    // brute dans son prompt, en base.
    const tache = (id: string, prompt: string): Task => ({
      id,
      projectId: 'p1',
      title: '🔭 Éclaireuse — risques',
      prompt,
      status: 'pending',
      dependsOn: [],
      assignedNodeId: null,
      result: null,
      branch: null,
      attempts: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const avecUrl = tache('t1', `CONTEXTE : Privé — ${DEPOT_BRUT} — fin`);
    const sansUrl = tache('t2', 'rien à voir avec un dépôt');
    const s: StateSnapshot = { ...instantane(), tasks: [avecUrl, sansUrl], tasksTotal: 2 };

    const lave = instantanePourEssaim(s);
    expect(JSON.stringify(lave)).not.toContain(SECRET);
    expect(lave.tasks[0]!.prompt).toBe(`CONTEXTE : Privé — ${DEPOT_LAVE} — fin`);
    expect(lave.tasks[1], 'une tâche sans URL a été recopiée pour rien').toBe(sansUrl);
    expect(s.tasks[0]!.prompt, 'l’instantané reçu a été modifié').toContain(SECRET);
  });
});

describe('LES TROIS SORTIES DE L’INSTANTANÉ SONT LAVÉES', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projetId: string;
  const TOKEN = 'jeton-instantane-essaim-assez-long';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-instantane-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    // Exactement ce qu'écrit quelqu'un qui clone un dépôt privé sans
    // configurer git : ses identifiants dans l'URL.
    projetId = server.store.createProject({
      name: 'Dépôt privé',
      repoUrl: DEPOT_BRUT,
      visibility: 'private',
      ownerId: 'user-a',
    }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/state, avec le seul jeton de ruche', async () => {
    const res = await fetch(`${base}/api/state`, { headers: { 'x-hive-token': TOKEN } });
    expect(res.status).toBe(200);
    const corps = await res.text();
    expect(corps, 'le jeton du dépôt sort par /api/state').not.toContain(SECRET);
    const s = JSON.parse(corps) as StateSnapshot;
    expect(s.projects.find((p) => p.id === projetId)?.repoUrl).toBe(DEPOT_LAVE);
  });

  it('l’accueil WebSocket d’un tableau de bord, puis la diffusion', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const etats: string[] = [];
    ws.on('message', (data) => {
      const brut = data.toString();
      if ((JSON.parse(brut) as { type?: string }).type === 'state') etats.push(brut);
    });
    await new Promise<void>((ok, ko) => {
      ws.once('open', () => ok());
      ws.once('error', ko);
    });
    try {
      ws.send(JSON.stringify({ type: 'subscribe', token: TOKEN }));
      await attendre(() => etats.length >= 1);

      // Un changement d'état déclenche la diffusion (vidage toutes les 250 ms).
      const res = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'x-hive-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Déclencheur' }),
      });
      expect(res.status).toBe(201);
      await attendre(() => etats.length >= 2);

      for (const brut of etats) {
        expect(brut, 'le jeton du dépôt sort par le WebSocket').not.toContain(SECRET);
      }
      const derniere = JSON.parse(etats.at(-1)!) as { snapshot: StateSnapshot };
      expect(derniere.snapshot.projects.find((p) => p.id === projetId)?.repoUrl).toBe(DEPOT_LAVE);
    } finally {
      ws.close();
    }
  });

  it('LE MAGASIN GARDE L’URL ENTIÈRE — le nœud clone toujours', () => {
    // Le nœud reçoit l'URL par le message d'affectation de tâche, lue en base :
    // laver la sortie vers l'essaim ne doit rien retirer de ce qui est rangé.
    expect(server.store.getProject(projetId)?.repoUrl).toBe(DEPOT_BRUT);
  });
});

describe('LE CONSEIL NE RECOPIE PLUS LE JETON — ni en base, ni dans l’instantané', () => {
  // Trouvé en revue : `contexteProjetAvecHorizon` mettait l'URL BRUTE dans le
  // contexte du Conseil, donc dans le prompt de chaque éclaireuse — rangé en
  // base, rendu par `tasks[]` de l'instantané, envoyé au nœud et au fournisseur
  // du modèle. Laver `projects[].repoUrl` seul laissait ce canal ouvert.
  let server: HiveServer;
  let dir: string;
  let base: string;
  const TOKEN = 'jeton-conseil-essaim-assez-long';
  const entetes = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-conseil-essaim-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('les prompts des éclaireuses nomment le dépôt LAVÉ, jamais le jeton', async () => {
    const projetId = server.store.createProject({
      name: 'Conseil',
      description: 'un projet',
      repoUrl: DEPOT_BRUT,
    }).id;
    const r = await fetch(`${base}/api/projects/${projetId}/conseil`, {
      method: 'POST',
      headers: entetes,
      body: '{}',
    });
    expect(r.status).toBe(201);

    const taches = server.store.listTasks(projetId);
    expect(taches.length, 'le Conseil n’a créé aucune éclaireuse').toBeGreaterThan(0);
    for (const t of taches) {
      expect(t.prompt, 'le jeton est rangé en base dans un prompt').not.toContain(SECRET);
    }
    // Le contexte reste utile : il dit toujours OÙ est le dépôt.
    expect(taches.some((t) => t.prompt.includes(DEPOT_LAVE))).toBe(true);
  });

  it('une tâche ANCIENNE qui recopiait le jeton ne le rend plus par /api/state', async () => {
    const projetId = server.store.createProject({ name: 'Ancien', repoUrl: DEPOT_BRUT }).id;
    server.store.createTask({
      projectId: projetId,
      title: 'Éclaireuse d’avant le lavage',
      prompt: `CONTEXTE : Ancien — ${DEPOT_BRUT}`,
    });
    const corps = await (await fetch(`${base}/api/state`, { headers: entetes })).text();
    expect(corps, 'le jeton sort par le prompt d’une tâche ancienne').not.toContain(SECRET);
    expect(corps).toContain(`CONTEXTE : Ancien — ${DEPOT_LAVE}`);
  });
});

describe('LA GARDE DE DEMAIN — l’instantané ne sort que lavé', () => {
  it('`store.getSnapshot()` n’apparaît qu’au point de sortie unique du serveur', () => {
    // Repère compté sur les lignes de CODE seulement : le commentaire qui
    // explique la règle cite lui-même `store.getSnapshot()`.
    const src = readFileSync(
      fileURLToPath(new URL('../src/orchestrator/server.ts', import.meta.url)),
      'utf8',
    );
    const lignes = src
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
      .filter((l) => l.includes('store.getSnapshot('));
    expect(lignes, 'un envoi brut de l’instantané est apparu dans server.ts').toHaveLength(1);
    expect(lignes[0]).toContain('instantanePourEssaim(store.getSnapshot())');
  });
});
