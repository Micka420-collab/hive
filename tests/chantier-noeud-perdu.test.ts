// QUAND UNE OUVRIÈRE S'EN VA, SES CHANTIERS ET SES POSES FINISSENT — ET LE DISENT.
//
// ─── LE SILENCE QUE CE BANC FERME ────────────────────────────────────────────
//
// Carte Notion « Auditer WebSocket, reconnexion et perte de messages »,
// scénario « Déconnexion pendant un job ». À la fermeture d'un socket de nœud,
// la Reine requalifiait ses tâches et déclarait échoués ses MERGES — et rien
// d'autre. Un chantier ou une pose d'outil confiés à ce nœud restaient dans
// `pendingChantiers` / `pendingPoses` pour toujours :
//
//   · `/chantiers/result` rendait le verdict PRÉCÉDENT, ou `null` — l'humain
//     qui avait cliqué « Lancer » n'apprenait jamais que la réponse ne
//     viendrait pas ;
//   · la pose promettait « la machine répondra dans le journal », et le
//     journal se taisait ;
//   · les deux entrées vivaient en mémoire jusqu'au redémarrage de la Reine.
//
// Et aucun âge ne les bornait : un nœud connecté mais muet produisait le même
// silence, sans même une fermeture de socket pour le trahir.
//
// ─── CE QUE CHAQUE BANC EXIGE ────────────────────────────────────────────────
//
// Une issue VISIBLE et CONSIGNÉE : un verdict d'échec relisible, un événement
// au journal, et la cause dans les deux. Et les deux sens de chaque garde — le
// travail d'un AUTRE nœud survit au départ d'un voisin, et le hub n'abandonne
// pas un chantier que le nœud a encore le droit de faire tourner.
//
// Rien n'est simulé côté Reine : de vrais sockets sur un vrai serveur, qui
// reçoivent vraiment leur `assign_chantier` / `poser_outil` et se taisent.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { CHANTIER_EXECUTION_MS, CHANTIER_PREPARATION_MS } from '../src/shared/chantier.js';
import { PAQUETS } from '../src/shared/connexion-agent.js';
import { POSE_DELAI_MS } from '../src/shared/pose-outil.js';
import type { ChantierResultMsg } from '../src/shared/protocol.js';
import type { HiveEvent } from '../src/shared/types.js';

const TOKEN = 'jeton-chantier-noeud-perdu-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
const INSTALLABLE = Object.keys(PAQUETS)[0]!;

let server: HiveServer | null = null;
let base = '';
const dossiers: string[] = [];
const ouverts: WebSocket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const ws of ouverts.splice(0)) ws.close();
  await server?.stop();
  server = null;
  for (const d of dossiers.splice(0)) {
    rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function ruche(tickMs: number): Promise<HiveServer> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-cnp-'));
  dossiers.push(dir);
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'cnp.db'),
    simulation: false,
    tickMs,
  });
  base = `http://127.0.0.1:${server.port}`;
  return server;
}

/**
 * Un dépôt git LOCAL, vrai, qui déclare `test`. Le miroir de la Reine le clone
 * pour lire son `package.json` avant d'accepter le chantier — sans réseau.
 */
async function depotLocal(): Promise<string> {
  const { simpleGit } = await import('simple-git');
  const depot = mkdtempSync(path.join(os.tmpdir(), 'hive-cnp-depot-'));
  dossiers.push(depot);
  writeFileSync(
    path.join(depot, 'package.json'),
    JSON.stringify({ name: 'depot', scripts: { test: 'vitest run' } }),
  );
  const g = simpleGit({ baseDir: depot });
  await g.init();
  await g.addConfig('user.email', 't@example.com');
  await g.addConfig('user.name', 'T');
  await g.add('.');
  await g.commit('initial');
  return depot;
}

/** Inscrit un nœud qui retient ce qu'on lui envoie — et ne répond jamais. */
function inscrire(
  srv: HiveServer,
  nodeId: string,
): Promise<{ ws: WebSocket; recus: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    ouverts.push(ws);
    const recus: Record<string, unknown>[] = [];
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'register',
          token: TOKEN,
          nodeId,
          name: nodeId,
          ownerName: 'testeur',
          agentType: 'shell',
          maxConcurrency: 1,
        }),
      ),
    );
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Record<string, unknown>;
      recus.push(m);
      if (m.type === 'registered') resolve({ ws, recus });
    });
    ws.on('error', reject);
  });
}

/** Lance le chantier `test` et rend le nœud auquel la Reine l'a confié. */
async function lancerChantier(projectId: string): Promise<{ chantierId: string; nodeId: string }> {
  const res = await fetch(`${base}/api/projects/${projectId}/chantiers/test/run`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const corps = (await res.json()) as { chantierId?: string; nodeId?: string; error?: string };
  expect(res.status, `chantiers/run a refusé : ${corps.error ?? ''}`).toBe(202);
  return { chantierId: corps.chantierId ?? '', nodeId: corps.nodeId ?? '' };
}

async function verdict(projectId: string): Promise<ChantierResultMsg | null> {
  const r = await fetch(`${base}/api/projects/${projectId}/chantiers/result`, { headers });
  return ((await r.json()) as { resultat: ChantierResultMsg | null }).resultat;
}

async function journal(): Promise<HiveEvent[]> {
  const r = await fetch(`${base}/api/events?limit=1000`, { headers });
  return (await r.json()) as HiveEvent[];
}

/** Les poses exigent un compte : le premier inscrit administre la ruche. */
async function entetesAdmin(): Promise<Record<string, string>> {
  const auth = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@hive.test',
      password: 'mot-de-passe-test',
      displayName: 'Admin',
    }),
  });
  return {
    ...headers,
    authorization: `Bearer ${((await auth.json()) as { token: string }).token}`,
  };
}

async function poser(nodeId: string, admin: Record<string, string>): Promise<string> {
  const r = await fetch(`${base}/api/nodes/${nodeId}/outils/${INSTALLABLE}/poser`, {
    method: 'POST',
    headers: admin,
  });
  expect(r.status, 'la pose n’a pas été transmise').toBe(202);
  return ((await r.json()) as { poseId: string }).poseId;
}

/**
 * Attend une condition. L'échéance se lit sur `performance.now()` et non sur
 * `Date.now()` : le dernier banc gèle `Date` pour faire vieillir la Reine, et
 * une attente mesurée à l'horloge gelée ne finirait jamais.
 */
async function attendre(cond: () => Promise<boolean>, ms = 5_000): Promise<boolean> {
  const fin = performance.now() + ms;
  while (performance.now() < fin) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe('les chantiers et les poses d’un nœud qui se déconnecte', () => {
  it('SON CHANTIER FINIT EN ÉCHEC DIT — un verdict relisible et un événement, avec la cause', async () => {
    const srv = await ruche(10_000);
    const { ws } = await inscrire(srv, 'a-ouvriere');
    const projet = srv.store.createProject({ name: 'alpha', repoUrl: await depotLocal() });
    const { chantierId, nodeId } = await lancerChantier(projet.id);
    expect(nodeId).toBe('a-ouvriere');
    // Tant que le nœud est là et se tait, il n'y a pas de verdict.
    expect(await verdict(projet.id)).toBeNull();

    ws.close();

    const clos = await attendre(async () => (await verdict(projet.id)) !== null);
    expect(clos, 'le chantier du nœud parti est resté sans verdict pour toujours').toBe(true);
    const v = await verdict(projet.id);
    expect(v?.chantierId).toBe(chantierId);
    expect(v?.ok).toBe(false);
    // Aucun processus n'a été vu : pas de code de sortie inventé.
    expect(v?.code).toBeNull();
    // Le nœud n'a rien REFUSÉ, il a disparu : les deux appellent des gestes opposés.
    expect(v?.refused).toBeUndefined();
    expect(v?.sortie).toContain('nœud déconnecté');

    const echec = (await journal()).find(
      (e) => e.type === 'chantier_failed' && e.payload.chantierId === chantierId,
    );
    expect(echec, 'le journal ne dit rien du chantier perdu').toBeTruthy();
    expect(echec?.payload).toMatchObject({
      projectId: projet.id,
      nodeId: 'a-ouvriere',
      nom: 'test',
      reason: 'nœud déconnecté',
    });
  });

  it('LE CHANTIER D’UN AUTRE NŒUD N’EST PAS EMPORTÉ AVEC LUI', async () => {
    // La route confie au PREMIER nœud en ligne, et `listNodes()` trie par nom :
    // Z seule inscrite reçoit le chantier de « zeta », puis A, première par le
    // nom, reçoit celui d'« alpha ».
    const srv = await ruche(10_000);
    await inscrire(srv, 'z-ouvriere');
    const depot = await depotLocal();
    const zeta = srv.store.createProject({ name: 'zeta', repoUrl: depot });
    expect((await lancerChantier(zeta.id)).nodeId).toBe('z-ouvriere');
    const { ws: wsA } = await inscrire(srv, 'a-ouvriere');
    const alpha = srv.store.createProject({ name: 'alpha', repoUrl: depot });
    expect((await lancerChantier(alpha.id)).nodeId).toBe('a-ouvriere');

    wsA.close();

    // Point de synchronisation : le départ de A est traité.
    await attendre(async () => (await verdict(alpha.id)) !== null);
    // Un chantier tué par erreur le serait dans le même tour que la fermeture.
    await new Promise((r) => setTimeout(r, 300));
    expect(await verdict(zeta.id), 'le chantier d’un nœud resté connecté a été tué').toBeNull();
  });

  it('SA POSE D’OUTIL FINIT DANS LE JOURNAL — là où l’écran a promis la réponse', async () => {
    const srv = await ruche(10_000);
    const admin = await entetesAdmin();
    const { ws, recus } = await inscrire(srv, 'noeud-poseur');
    const poseId = await poser('noeud-poseur', admin);
    const arrivee = await attendre(async () => recus.some((m) => m.type === 'poser_outil'));
    expect(arrivee, 'la pose n’a jamais atteint le nœud').toBe(true);

    ws.close();

    const fin = async () =>
      (await journal()).find(
        (e) => e.type === 'outil_pose_interrompue' && e.payload.poseId === poseId,
      );
    expect(await attendre(async () => (await fin()) !== undefined)).toBe(true);
    expect((await fin())?.payload).toMatchObject({
      nodeId: 'noeud-poseur',
      outilId: INSTALLABLE,
      reason: 'nœud déconnecté',
    });
  });

  it('UN NŒUD CONNECTÉ MAIS MUET : chantier et pose expirent — jamais avant ses propres bornes', async () => {
    // ─── LE CAS QU'AUCUNE FERMETURE NE TRAHIT ────────────────────────────────
    //
    // Le socket reste ouvert, les pings reviennent, et rien ne revient jamais.
    // Seul l'âge peut clore. On fait vieillir la Reine en gelant `Date` —
    // SEULEMENT `Date` : les minuteurs restent réels, le tick tourne vraiment.
    const srv = await ruche(50);
    const admin = await entetesAdmin();
    await inscrire(srv, 'noeud-muet');
    const projet = srv.store.createProject({ name: 'muet', repoUrl: await depotLocal() });

    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    const { chantierId } = await lancerChantier(projet.id);
    const poseId = await poser('noeud-muet', admin);
    const poseClose = async () =>
      (await journal()).some(
        (e) => e.type === 'outil_pose_interrompue' && e.payload.poseId === poseId,
      );

    // L'AUTRE SENS D'ABORD. Aux bornes du nœud lui-même — butoir
    // d'installation pour une pose, préparation plus exécution pour un
    // chantier — il a encore le droit de tourner : le hub ne doit pas
    // l'abandonner. Un délai copié sur celui des merges (dix minutes)
    // échouerait ici. Quelques tours de tick à chaque borne.
    vi.setSystemTime(t0 + POSE_DELAI_MS);
    await new Promise((r) => setTimeout(r, 400));
    expect(await poseClose(), 'une pose encore en droit de tourner a été abandonnée').toBe(false);
    vi.setSystemTime(t0 + CHANTIER_PREPARATION_MS + CHANTIER_EXECUTION_MS);
    await new Promise((r) => setTimeout(r, 400));
    expect(
      await verdict(projet.id),
      'un chantier encore en droit de tourner a été abandonné',
    ).toBeNull();

    // Deux heures plus tard, plus rien n'est en droit de tourner.
    vi.setSystemTime(t0 + 2 * 3_600_000);
    expect(
      await attendre(async () => (await verdict(projet.id)) !== null),
      'le chantier d’un nœud muet n’a jamais expiré',
    ).toBe(true);
    const v = await verdict(projet.id);
    expect(v?.chantierId).toBe(chantierId);
    expect(v?.ok).toBe(false);
    expect(v?.sortie).toContain('délai dépassé');
    expect(await attendre(poseClose), 'la pose d’un nœud muet n’a jamais expiré').toBe(true);
  });
});
