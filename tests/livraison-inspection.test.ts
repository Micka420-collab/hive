// LE VERDICT DES GARDIENNES DANS LA PULL REQUEST — celui de CETTE production.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Dernière survivante du balayage du soir :
//
//   .find((i) => i.taskId === task.id && i.nodeId === dernier.nodeId)
//
// Mutée en `||`, la recherche retient la PREMIÈRE inspection qui partage SOIT
// la tâche SOIT l'ouvrière — et `listInspections` rend les plus récentes en
// tête. Le corps de la pull request annoncerait donc le verdict d'une AUTRE
// production : une relecture humaine lirait « verdict clean » sur un travail
// jugé creux, ou l'inverse. C'est un mensonge de la ruche à celui qui relit,
// dans le seul document qu'il ait pour décider de fusionner.
//
// ─── POURQUOI IL A FALLU UN FICHIER À PART ───────────────────────────────────
//
// Le faux GitHub d'`essaim-livraison.test.ts` note les APPELS (méthode,
// chemin) mais jamais les CORPS. Or c'est le corps qui porte le verdict :
// aucune assertion sur le chemin ne peut départager les deux mondes. On monte
// donc un GitHub simulé qui garde ce qu'on lui envoie — et rien ne part sur
// le réseau, ni sur un vrai dépôt.
//
// ─── LA MISE EN SCÈNE, ET POURQUOI ELLE EST ASYMÉTRIQUE ──────────────────────
//
// Deux inspections en base :
//
//   · (tâche livrée, ouvrière livrante)   → verdict « clean »   [posée en 1er]
//   · (AUTRE tâche, MÊME ouvrière)        → verdict « hollow »  [posée en 2e]
//
// `listInspections` trie par id DÉCROISSANT : la seconde arrive donc en tête.
// Avec `&&`, elle est écartée (la tâche ne correspond pas) et le bon verdict
// sort. Avec `||`, elle est retenue AVANT l'autre (l'ouvrière correspond) et
// c'est « hollow » qui part dans la PR. Un banc à une seule inspection aurait
// rendu le même corps dans les deux mondes — du décor.

import { createServer as createHttp } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-livraison-inspection-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,1 @@',
  '-const a = 1;',
  '+const a = 2;',
].join('\n');

/** Un GitHub simulé qui garde LES CORPS — c'est là que vit le verdict. */
interface FauxGithub {
  url: string;
  /** Corps des POST vers /pulls, dans l'ordre. */
  corpsDesPr: Array<Record<string, unknown>>;
  fermer(): Promise<void>;
}

async function fauxGithub(): Promise<FauxGithub> {
  const corpsDesPr: Array<Record<string, unknown>> = [];
  let prochainePr = 100;

  const srv: Server = createHttp((req, rep) => {
    const chemin = req.url ?? '';
    let brut = '';
    req.on('data', (c: Buffer) => (brut += c.toString()));
    req.on('end', () => {
      const envoyer = (code: number, corps: unknown): void => {
        rep.writeHead(code, { 'content-type': 'application/json' });
        rep.end(JSON.stringify(corps));
      };
      if (chemin.includes('/git/ref/heads/')) return envoyer(200, { object: { sha: 'base-sha' } });
      if (chemin.includes('/contents/')) {
        return envoyer(200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('const a = 1;\n', 'utf8').toString('base64'),
        });
      }
      if (chemin.endsWith('/git/blobs')) return envoyer(201, { sha: 'blob-sha' });
      if (chemin.endsWith('/git/trees')) return envoyer(201, { sha: 'tree-sha' });
      if (chemin.endsWith('/git/commits')) return envoyer(201, { sha: 'commit-sha' });
      if (chemin.endsWith('/git/refs')) return envoyer(201, { ref: 'refs/heads/hive/x' });
      if (chemin.endsWith('/pulls')) {
        try {
          corpsDesPr.push(JSON.parse(brut) as Record<string, unknown>);
        } catch {
          corpsDesPr.push({ illisible: brut });
        }
        return envoyer(201, { number: ++prochainePr });
      }
      envoyer(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    corpsDesPr,
    fermer: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

describe('la pull request porte le verdict de CETTE production', () => {
  let server: HiveServer | null = null;
  let gh: FauxGithub | null = null;
  let dir: string | null = null;
  const avant: Record<string, string | undefined> = {};

  afterEach(async () => {
    await server?.stop();
    server = null;
    await gh?.fermer();
    gh = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    for (const cle of ['HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API']) {
      if (avant[cle] === undefined) delete process.env[cle];
      else process.env[cle] = avant[cle];
    }
  });

  it('LE VERDICT EST CELUI DE LA TÂCHE LIVRÉE — pas celui d’une voisine de la même ouvrière', async () => {
    for (const cle of ['HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API']) avant[cle] = process.env[cle];
    gh = await fauxGithub();
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-simule';
    process.env.HIVE_GITHUB_API = `${gh.url}/api`;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-livr-insp-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const store = server.store;

    const projet = store.createProject({
      name: 'Rucher',
      description: 'un projet',
      repoUrl: 'https://github.com/moi/mon-projet',
    });
    const ouvriere = store.registerNode({
      name: 'ouvriere-unique',
      ownerName: 'moi',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
    const livree = store.createTask({ projectId: projet.id, title: 'La livrée', prompt: 'p' });
    const voisine = store.createTask({ projectId: projet.id, title: 'La voisine', prompt: 'p' });

    const resultat = store.insertResult({
      taskId: livree.id,
      nodeId: ouvriere.id,
      success: true,
      diff: DIFF,
      logs: '',
      durationMs: 10,
      subAgents: [],
    });
    store.patchTask(livree.id, { status: 'done' });

    // L'ordre de pose COMMANDE le banc : `listInspections` rend les plus
    // récentes en tête, donc la voisine (posée en second) est examinée EN
    // PREMIER par le `.find`.
    store.enregistrerInspection({
      resultId: typeof resultat === 'number' ? resultat : 1,
      taskId: livree.id,
      nodeId: ouvriere.id,
      verdict: 'clean',
      score: 0,
      applique: true,
      griefs: [],
    });
    store.enregistrerInspection({
      resultId: 2,
      taskId: voisine.id,
      nodeId: ouvriere.id,
      verdict: 'hollow',
      score: 90,
      applique: true,
      griefs: [],
    });

    const rep = await fetch(`${base}/api/livraison`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ taskId: livree.id }),
    });
    expect(rep.status, 'la livraison doit aboutir sur le GitHub simulé').toBe(201);
    expect(gh.corpsDesPr, 'une pull request est bien partie').toHaveLength(1);

    const corps = String(gh.corpsDesPr[0]?.body ?? '');
    expect(corps, 'le corps de la PR porte un verdict de Gardiennes').toContain('Gardiennes');
    expect(corps, 'et c’est celui de la production livrée').toContain('`clean`');
    expect(
      corps,
      'le verdict d’une AUTRE tâche de la même ouvrière ne s’y glisse pas',
    ).not.toContain('`hollow`');
  }, 30_000);
});
