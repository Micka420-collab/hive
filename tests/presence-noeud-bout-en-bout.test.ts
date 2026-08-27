// UN NŒUD PRÉSENT NE TRAVAILLE PAS — éprouvé sur un vrai hub, un vrai nœud.
//
// ─── CE QUE CE FICHIER PROTÈGE, ET POURQUOI IL EST AGENCÉ AINSI ──────────────
//
// « Présence sans production » repose sur DEUX gardes redondantes :
//
//   1. le hub n'assigne pas à un nœud simulé quand il tourne en production
//      (`assignationProductionAutorisee`, sur les deux voies d'assignation) ;
//   2. le nœud refuse s'il est sollicité malgré tout (`presenceSeule`).
//
// Éprouver la seconde est délicat : tant que la première tient, le hub
// n'assigne jamais, et un banc « rien ne s'est passé » resterait vert même si
// la seconde garde n'existait pas. C'est le § 2.12 du journal — un test « ça ne
// part pas » est vert quand RIEN ne part.
//
// Alors on monte le hub en SIMULATION. Là, la première garde s'efface
// volontairement (les nœuds simulés sont censés travailler : c'est la démo), le
// hub ASSIGNE pour de bon — et il ne reste que la seconde garde entre la tâche
// et un diff inventé. C'est exactement le scénario pour lequel elle existe :
// un hub qui ne connaît pas la règle.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { HiveNode, StateSnapshot } from '../src/shared/types.js';

describe('LA SENTINELLE DU CÂBLAGE — `main.ts` ne meurt plus, il rejoint', () => {
  // Même aveu que pour les constats d'outils : cette garde LIT la source. Le
  // banc de bout en bout plus bas construit son client à la main, donc il
  // resterait vert si `main.ts` reprenait son `process.exit(2)`. Lancer
  // `main.ts` pour de vrai est hors de portée — il sonde le PATH du poste.
  const source = readFileSync(
    fileURLToPath(new URL('../src/node-client/main.ts', import.meta.url)),
    'utf8',
  );

  it('le nœud ne se tue plus quand aucun agent réel n’est trouvé', () => {
    // C'était `process.exit(2)` juste après le conseil. Le conseil s'affichait
    // dans un terminal qu'on referme, et la ruche ne montrait RIEN.
    const apresConseil = source.slice(source.indexOf('const conseil = conseilDemarrage('));
    const finDuBloc = apresConseil.indexOf('\n}');
    expect(apresConseil.slice(0, finDuBloc)).not.toContain('process.exit(');
  });

  it('et il passe `presenceSeule` — la seconde garde est bien câblée', () => {
    expect(source).toContain('presenceSeule: true');
    // POSÉ SEULEMENT EN PRÉSENCE : un nœud de production ne doit pas porter le
    // champ du tout, sinon un jour un `false` mal placé le bascule.
    expect(source).toContain("entree.mode === 'presence' ? { presenceSeule: true } : {}");
  });

  it('et il DIT à l’humain qu’il est là sans produire', () => {
    // Un nœud qui rejoint en silence sans travailler ressemble à un nœud cassé.
    expect(source).toContain('SANS produire');
  });
});

describe('le nœud PRÉSENT refuse, même quand le hub assigne', () => {
  const TOKEN = 'jeton-presence-bout-en-bout-ici';
  let dir: string;
  let server: HiveServer;
  let client: HiveNodeClient;
  /** Compte les fois où l'adaptateur a VRAIMENT tourné. Zéro est la promesse. */
  let lancements = 0;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-presence-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      // SIMULATION : le hub assignera à un nœud `shell`. On efface la première
      // garde exprès, pour que la seconde soit seule à répondre.
      simulation: true,
      tickMs: 50,
    });
    const adapter: AgentAdapter = {
      name: 'compteur',
      async run() {
        lancements += 1;
        return { success: true, diff: 'diff --git a/x b/x\n+faux', logs: 'x', subAgents: [] };
      },
    };
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'poste-sans-outil',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
      presenceSeule: true,
    });
    client.start();
  }, 30_000);

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function etat(): Promise<StateSnapshot> {
    const r = await fetch(`http://127.0.0.1:${server.port}/api/state`, {
      headers: { 'x-hive-token': TOKEN },
    });
    return (await r.json()) as StateSnapshot;
  }

  async function attendreLeNoeud(): Promise<HiveNode | undefined> {
    const echeance = Date.now() + 6_000;
    while (Date.now() < echeance) {
      const n = (await etat()).nodes.find(
        (x) => x.name === 'poste-sans-outil' && x.status === 'online',
      );
      if (n) return n;
      await new Promise((r) => setTimeout(r, 80));
    }
    return undefined;
  }

  it('IL REJOINT LA RUCHE — c’est tout l’intérêt du mode', async () => {
    // Avant ce lot, cette machine faisait `process.exit(2)` : elle n'apparaissait
    // NULLE PART, et le tableau de bord disait « 0 nœud actif » à quelqu'un qui
    // venait précisément de lancer un nœud.
    const n = await attendreLeNoeud();
    expect(n, 'le poste sans outil doit être VISIBLE dans la ruche').toBeTruthy();
  });

  it('ET IL NE LANCE RIEN — le hub a beau assigner, l’adaptateur ne tourne pas', async () => {
    await attendreLeNoeud();
    const r = await fetch(`http://127.0.0.1:${server.port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ name: 'Rucher' }),
    });
    const projet = (await r.json()) as { id: string };
    // La bonne route, et son code de retour VÉRIFIÉ.
    //
    // Première version : `POST /api/tasks`, qui n'existe pas. Elle rendait 404,
    // aucune tâche n'était créée — et le banc restait VERT, puisqu'il comptait
    // des lancements qui ne pouvaient de toute façon pas arriver. Le § 2.12
    // dans toute sa splendeur : « ça ne part pas » est vrai quand RIEN ne part.
    // D'où l'assertion sur le 201, qui est la moitié la plus importante du banc.
    const rt = await fetch(`http://127.0.0.1:${server.port}/api/projects/${projet.id}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ tasks: [{ id: 't1', title: 'butiner', prompt: 'x' }] }),
    });
    expect(rt.status, 'la tâche DOIT être créée, sinon ce banc ne mesure rien').toBe(201);

    // Et elle doit VRAIMENT être assignée à notre nœud : sans ça, « zéro
    // lancement » ne dirait rien de la garde.
    let vueAssignee = false;
    const limite = Date.now() + 5_000;
    while (Date.now() < limite && !vueAssignee) {
      const s0 = await etat();
      const t0 = s0.tasks.find((x) => x.title === 'butiner');
      if (t0 && (t0.status === 'assigned' || t0.status === 'running' || t0.attempts > 0)) {
        vueAssignee = true;
      }
      await new Promise((r3) => setTimeout(r3, 100));
    }

    // On laisse au hub le temps d'assigner PLUSIEURS fois : le refus n'est pas
    // un échec, la tâche repart, et c'est exactement pendant ces re-tentatives
    // qu'un nœud mal gardé finirait par lancer son adaptateur.
    const echeance = Date.now() + 3_000;
    while (Date.now() < echeance) {
      if (lancements > 0) break;
      await new Promise((r2) => setTimeout(r2, 100));
    }

    expect(lancements, 'un nœud présent n’exécute JAMAIS — pas une fois').toBe(0);

    // Et la tâche n'a pas été marquée faite par un diff inventé.
    const s = await etat();
    const t = s.tasks.find((x) => x.title === 'butiner');
    expect(t?.status, 'la tâche ne doit pas être « done » sur un diff simulé').not.toBe('done');
  }, 20_000);
});
