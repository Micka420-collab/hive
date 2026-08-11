// QUAND UNE OUVRIÈRE S'EN VA, SA FUSION MEURT AVEC ELLE — ET SEULEMENT LA SIENNE.
//
// ─── LE MANQUE QUE CE BANC COMBLE ─────────────────────────────────────────────
//
// Une fusion confiée à un nœud vit dans `pendingMerges` jusqu'à ce que ce nœud
// réponde. Si sa connexion tombe entre-temps, personne ne répondra JAMAIS :
// `/merge/result` resterait `null` pour toujours, et l'entrée fuirait en
// mémoire. Le serveur ferme donc les fusions du partant à la fermeture du
// socket (`server.ts`, gestionnaire `ws.on('close')`).
//
// Cette boucle tient sur une seule comparaison :
//
//     for (const [mergeId, pending] of pendingMerges) {
//       if (pending.nodeId === nodeId) failMerge(mergeId, 'nœud déconnecté');
//     }
//
// ─── CE QUI A ÉTÉ MESURÉ AVANT D'ÉCRIRE CE FICHIER ────────────────────────────
//
// Cette comparaison a été mutée en `!==`, et **la suite ENTIÈRE est restée
// verte** : 242 fichiers, 3 534 tests passés, zéro rouge. Elle n'était donc
// gardée par rien.
//
// Or, mutée, elle casse dans les DEUX sens à la fois :
//
//   · la fusion du nœud parti n'est plus close — `/merge/result` reste `null`
//     éternellement, exactement ce que le commentaire du code dit vouloir
//     empêcher, et l'attente côté humain est sans fin ;
//   · les fusions des AUTRES nœuds, elles, sont déclarées échouées — un
//     travail vivant, sur une machine qui n'a rien demandé, meurt parce qu'un
//     voisin s'est déconnecté.
//
// Un banc qui n'éprouverait que le premier sens laisserait passer le second :
// c'est pourquoi les deux nœuds sont ici, dans le même scénario.
//
// ─── POURQUOI DEUX NŒUDS, ET COMMENT ON CHOISIT LEQUEL REÇOIT ────────────────
//
// La route de fusion prend le PREMIER nœud en ligne, connecté et de service, et
// `listNodes()` trie par NOM. On dirige donc chaque fusion par l'ordre
// d'inscription, qui est déterministe :
//
//   1. `z-ouvriere` s'inscrit seule  → la fusion de « zeta » ne peut aller
//      qu'à elle ;
//   2. `a-ouvriere` s'inscrit ensuite → étant première par le nom, la fusion
//      d'« alpha » lui revient.
//
// On avait d'abord voulu piloter cela avec `heartbeat { onShift: false }` :
// c'était une course. Ce message ne porte aucun accusé de réception, donc rien
// ne dit quand le hub l'a pris en compte — la route a répondu 503 « aucun nœud
// de service » sur un nœud qu'on venait de remettre en service. Un banc qui
// dépend d'un message sans réponse mesure surtout la vitesse de la machine.
//
// Rien n'est simulé : ce sont de vrais sockets sur un vrai serveur, qui
// reçoivent vraiment leur `assign_merge` et se taisent.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { MergeResultMsg } from '../src/shared/protocol.js';

const TOKEN = 'jeton-fusion-noeud-parti-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer;
let dir: string;
let base: string;
const ouverts: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-fnp-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'fnp.db'),
    simulation: false,
    // Assez long pour qu'aucun tour d'ordonnanceur ne vienne brouiller le
    // scénario : ce banc n'éprouve QUE la fermeture de socket.
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  for (const ws of ouverts.splice(0)) ws.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function envoyer(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

/** Ouvre un socket, s'inscrit sous ce nom, et rend le socket une fois accusé. */
function inscrire(nom: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    ouverts.push(ws);
    ws.on('open', () =>
      envoyer(ws, {
        type: 'register',
        token: TOKEN,
        nodeId: nom,
        name: nom,
        ownerName: 'testeur',
        agentType: 'shell',
        maxConcurrency: 1,
      }),
    );
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'registered') resolve(ws);
    });
    ws.on('close', () => reject(new Error(`${nom} fermé avant son accusé`)));
    ws.on('error', reject);
  });
}

/** Un projet prêt à fusionner : un dépôt, une tâche terminée, un diff. */
function projetFusionnable(nom: string): string {
  const p = server.store.createProject({ name: nom, repoUrl: '/depot/inexistant' });
  const idTache = `t-${nom}`;
  server.store.createTask({ id: idTache, projectId: p.id, title: idTache, prompt: 'p' });
  server.store.patchTask(idTache, { status: 'done' });
  server.store.insertResult({
    taskId: idTache,
    nodeId: 'graine',
    success: true,
    diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-un\n+deux\n',
    logs: '',
    durationMs: 1,
    subAgents: [],
  });
  return p.id;
}

/** Lance la fusion et rend le nœud auquel le hub l'a confiée. */
async function lancerFusion(projectId: string): Promise<string> {
  const res = await fetch(`${base}/api/projects/${projectId}/merge/run`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const corps = (await res.json()) as { nodeId?: string; error?: string };
  expect(res.status, `merge/run a refusé : ${corps.error ?? ''}`).toBe(202);
  return corps.nodeId ?? '';
}

async function resultat(projectId: string): Promise<MergeResultMsg | null> {
  const r = await fetch(`${base}/api/projects/${projectId}/merge/result`, { headers });
  return ((await r.json()) as { result: MergeResultMsg | null }).result;
}

async function attendre(cond: () => Promise<boolean>, ms: number): Promise<boolean> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('la fusion d’un nœud qui se déconnecte', () => {
  it('SA fusion est close avec sa cause — elle n’attend pas indéfiniment', async () => {
    const wsA = await inscrire('a-ouvriere');
    const projet = projetFusionnable('alpha');
    expect(await lancerFusion(projet)).toBe('a-ouvriere');

    // Tant que le nœud est là et se tait, le résultat n'existe pas.
    expect(await resultat(projet)).toBeNull();

    wsA.close();

    const clos = await attendre(async () => (await resultat(projet)) !== null, 5_000);
    const r = await resultat(projet);
    expect(clos, 'la fusion du nœud parti est restée en attente pour toujours').toBe(true);
    // La cause est DITE : « merge interrompu » sans motif n'aiderait personne à
    // comprendre pourquoi une fusion lancée il y a trois secondes a échoué.
    expect(r?.logs).toContain('nœud déconnecté');
    expect(r?.applied).toEqual([]);
  });

  it('LA FUSION D’UN AUTRE NŒUD N’EST PAS EMPORTÉE AVEC ELLE', async () => {
    // ─── LE SENS QUE LA MUTATION RÉVÈLE, ET QU'UN BANC NAÏF OUBLIE ──────────
    //
    // Avec `!==`, le départ d'un nœud ferait échouer les fusions de TOUS les
    // autres. Une machine qui travaille perdrait son ouvrage parce qu'un
    // voisin a fermé son couvercle — et le message d'échec l'accuserait,
    // elle, d'être « déconnectée ».
    // Z seule inscrite : sa fusion ne peut aller qu'à elle.
    await inscrire('z-ouvriere');
    const projetZ = projetFusionnable('zeta');
    expect(await lancerFusion(projetZ)).toBe('z-ouvriere');

    // A s'inscrit ensuite et passe première par le nom : la fusion suivante
    // lui revient.
    const wsA = await inscrire('a-ouvriere');
    const projetA = projetFusionnable('alpha');
    expect(await lancerFusion(projetA)).toBe('a-ouvriere');

    wsA.close();

    // Point de SYNCHRONISATION, pas une assertion : le banc précédent éprouve
    // déjà que la fusion du partant se ferme. Ici on attend simplement que le
    // hub ait fini de traiter la fermeture, pour ne pas juger Z trop tôt. Si
    // cette attente expire, l'assertion qui suit tranchera quand même — et
    // c'est elle qui doit porter le verdict, seule.
    await attendre(async () => (await resultat(projetA)) !== null, 5_000);

    // Une fusion tuée par erreur le serait dans le même tour que la fermeture :
    // ce délai laisse largement le temps au dégât de se produire.
    await new Promise((r) => setTimeout(r, 500));
    expect(await resultat(projetZ), 'la fusion d’un nœud resté connecté a été tuée').toBeNull();
  });
});
