// LE PARLEMENT, DE BOUT EN BOUT — la route que rien n'exerçait.
//
// ─── CE QUE LES TESTS UNITAIRES NE POUVAIENT PAS VOIR ────────────────────────
//
// `parliament.ts` est un module pur, et il était bien testé — sur des chaînes
// inventées. `signatureOf` n'a jamais reçu autre chose que `'x'`, `'a\nb'` et
// `'diff A'`. En production elle reçoit `r.diff`, et personne ne l'avait jamais
// vue là.
//
// **Aucun test n'avait jamais appelé `GET /api/tasks/:id/consensus`.** Le
// défaut n'était donc dans aucune route : il était dans ce qu'aucune ne faisait.
//
// ─── CE QUE CE FICHIER ÉTABLIT ───────────────────────────────────────────────
//
// Deux agents font EXACTEMENT la même correction, à un commentaire près — ce
// qui est le cas normal quand deux IA différentes travaillent bien.
//
//   · le Parlement rend `no_quorum`, et ce n'est PAS un désaccord constaté :
//     c'est l'absence de mesure. L'identité textuelle ne peut rien dire d'un
//     diff ;
//   · la SURFACE, elle, les réunit : ils sont allés au même endroit.
//
// Et la surface doit avoir traversé la vraie route, c'est-à-dire être passée
// par `fichiersTouches` — la lecture de diff des Gardiennes. Un test qui
// fabriquerait la liste de fichiers à la main ne prouverait rien du câblage.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { Verdict } from '../src/orchestrator/parliament.js';

const TOKEN = 'jeton-de-test-suffisamment-long-42';

/** Le même correctif, par deux agents. Rien ici n'est un désaccord. */
const DIFF_CLAUDE = `diff --git a/src/auth.ts b/src/auth.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -42,6 +42,9 @@ export function verifier(jeton: string): boolean {
   const parts = jeton.split('.');
+  if (parts.length !== 3) {
+    return false;
+  }
   return controler(parts);
 }`;

const DIFF_CODEX = `diff --git a/src/auth.ts b/src/auth.ts
index 1a2b3c4..9f8e7d6 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -42,6 +42,9 @@ export function verifier(jeton: string): boolean {
   const parts = jeton.split('.');
+  if (parts.length !== 3) {
+    return false; // un JWT a exactement trois segments
+  }
   return controler(parts);
 }`;

/** Le même correctif, mais posé AILLEURS — un désaccord réel sur le lieu. */
const DIFF_AILLEURS = `diff --git a/src/server.ts b/src/server.ts
index 2b3c4d5..6e7f8a9 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -10,5 +10,8 @@ function route(req: Request) {
   const jeton = req.headers.authorization;
+  if ((jeton ?? '').split('.').length !== 3) {
+    return refuser(req);
+  }
   return suivant(req);
 }`;

describe('LE PARLEMENT SUR DU VRAI CODE, par la vraie route', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let dir: string;
  let base: string;
  let projetId: string;

  const entete = { 'x-hive-token': TOKEN, 'content-type': 'application/json' };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-cons-'));
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
    projetId = server.store.createProject({ name: 'Ruche', repoUrl: null, ownerId: null }).id;

    for (const [nodeId, agentType] of [
      ['n-claude', 'claude-code'],
      ['n-codex', 'codex'],
      ['n-libre', 'custom'],
    ] as const) {
      server.store.registerNode({
        nodeId,
        name: nodeId,
        ownerName: 'moi',
        agentType,
        maxConcurrency: 1,
      });
    }
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const semer = (taskId: string, resultats: [string, string][]): void => {
    server.store.createTask({ id: taskId, projectId: projetId, title: taskId, prompt: 'x' });
    for (const [nodeId, diff] of resultats) {
      server.store.insertResult({
        taskId,
        nodeId,
        diff,
        logs: '',
        success: true,
        durationMs: 10,
        subAgents: [],
      });
    }
  };

  const consensus = async (taskId: string): Promise<Verdict> => {
    const r = await fetch(`${base}/api/tasks/${taskId}/consensus`, { headers: entete });
    expect(r.status, 'la route doit répondre').toBe(200);
    return (await r.json()) as Verdict;
  };

  it('DEUX AGENTS D’ACCORD SONT DÉCLARÉS SANS QUORUM — et la surface les réunit', async () => {
    semer('t-accord', [
      ['n-claude', DIFF_CLAUDE],
      ['n-codex', DIFF_CODEX],
    ]);
    const v = await consensus('t-accord');

    // L'identité textuelle ne mesure rien ici. Ce n'est pas un désaccord.
    expect(v.outcome, 'deux diffs, deux signatures').toBe('no_quorum');
    expect(v.factions).toHaveLength(2);

    // La surface, elle, mesure — ET ELLE A TRAVERSÉ LA ROUTE. C'est
    // `fichiersTouches` (Gardiennes) qui a lu ces diffs, pas le test.
    expect(v.surfaces, 'un seul lieu').toHaveLength(1);
    expect(v.surfaces[0]?.fichiers).toEqual(['src/auth.ts']);
    expect(v.surfaces[0]?.votes).toBe(2);
    expect(v.surfaces[0]?.diversity, 'deux IA différentes au même endroit').toBe(2);
    expect(v.sansSurface).toBe(0);
  });

  it('UN DÉSACCORD SUR L’ENDROIT SE VOIT — et lui seul est réel', async () => {
    // Ici les agents divergent vraiment : l'un garde dans `auth`, l'autre dans
    // `server`. L'identité textuelle rendait le MÊME `no_quorum` que ci-dessus,
    // donc noyait la seule divergence qui compte.
    semer('t-desaccord', [
      ['n-claude', DIFF_CLAUDE],
      ['n-codex', DIFF_AILLEURS],
    ]);
    const v = await consensus('t-desaccord');

    expect(v.outcome, 'même verdict textuel que le cas d’accord').toBe('no_quorum');
    expect(v.surfaces, 'MAIS deux lieux').toHaveLength(2);
    expect(v.surfaces.map((s) => s.fichiers)).toEqual([['src/auth.ts'], ['src/server.ts']]);
  });

  it('UN DIFF VIDE N’EST PAS UN ACCORD : il est écarté, et ça se voit', async () => {
    // Deux diffs qu'on n'a pas su lire ne sont pas d'accord — on ne sait pas.
    // Les fondre en une surface « vide » fabriquerait un accord de rien.
    semer('t-vide', [
      ['n-claude', ''],
      ['n-codex', ''],
      ['n-libre', DIFF_CLAUDE],
    ]);
    const v = await consensus('t-vide');

    expect(v.surfaces, 'seule la surface lisible existe').toHaveLength(1);
    expect(v.surfaces[0]?.fichiers).toEqual(['src/auth.ts']);
    expect(v.sansSurface, 'l’abstention doit être visible').toBe(2);
  });

  it('DES OCTETS IDENTIQUES ÉLISENT ENCORE — le signal fort n’a pas bougé', async () => {
    // Le mécanisme d'origine reste juste : deux agents qui rendent exactement
    // la même chose forment bien une faction élue. On ne l'a pas affaibli pour
    // faire de la place au second signal.
    semer('t-identique', [
      ['n-claude', DIFF_CLAUDE],
      ['n-codex', DIFF_CLAUDE],
    ]);
    const v = await consensus('t-identique');

    expect(v.outcome).toBe('elected');
    expect(v.winner?.votes).toBe(2);
    expect(v.winner?.diversity).toBe(2);
    // Et la surface est là aussi : forme uniforme, le lecteur n'a pas à savoir
    // quand le champ existe.
    expect(v.surfaces[0]?.votes).toBe(2);
  });

  it('sans résultat, ni faction ni surface — et surtout pas un accord vide', async () => {
    semer('t-rien', []);
    const v = await consensus('t-rien');
    expect(v.outcome).toBe('no_ballots');
    expect(v.factions).toEqual([]);
    expect(v.surfaces).toEqual([]);
    expect(v.sansSurface).toBe(0);
  });
});
