// Câblage du polyéthisme : le cadre arrive-t-il VRAIMENT jusqu'à l'ouvrière ?
//
// Le module pur est verrouillé ailleurs (polyethisme.test.ts). Ici on vérifie
// les trois choses qu'un module pur ne peut pas garantir tout seul :
//   1. le cadre est réellement joint au message `assign_task` ;
//   2. il ne fait pas déborder le budget de contexte du protocole — un
//      `assign_task` trop gros est REJETÉ par le nœud, donc un cadre trop
//      bavard supprimerait la tâche au lieu de l'encadrer ;
//   3. l'interrupteur coupe bien, y compris par sa dépendance aux Gardiennes.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ModeGardiennes } from '../src/orchestrator/gardiennes.js';
import type { ModePolyethisme } from '../src/orchestrator/polyethisme.js';
import { CASTES, SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { LIMITS } from '../src/shared/protocol.js';

const TOKEN = 'jeton-polyethisme-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

interface Assignation {
  type: string;
  hiveContext?: string;
  task?: { id: string };
}

describe('polyéthisme — câblage', () => {
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

  async function demarrer(opts: {
    polyethisme?: ModePolyethisme;
    gardiennes?: ModeGardiennes;
  }): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-poly-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60,
      ...(opts.polyethisme ? { polyethisme: opts.polyethisme } : {}),
      ...(opts.gardiennes ? { gardiennes: opts.gardiennes } : {}),
    });
    return server;
  }

  /** Connecte un nœud et rend les `assign_task` qu'il reçoit. */
  async function brancherNoeud(srv: HiveServer, nodeId: string): Promise<Assignation[]> {
    const recues: Assignation[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Assignation;
      if (msg.type === 'assign_task') recues.push(msg);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: nodeId,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId,
      }),
    );
    return recues;
  }

  /** Sème `n` inspections impeccables pour un nœud — de quoi gagner une caste. */
  function semerImpeccable(srv: HiveServer, nodeId: string, n: number): void {
    for (let i = 0; i < n; i++) {
      srv.store.enregistrerInspection({
        resultId: i + 1,
        taskId: `T${i}`,
        nodeId,
        verdict: 'clean',
        score: 0,
        applique: false,
        griefs: [],
      });
    }
  }

  function creerTache(srv: HiveServer, prompt: string, titre = 'Une tâche'): string {
    const projet = srv.store.createProject({ name: 'Ruche' });
    const t = srv.store.createTask({ projectId: projet.id, title: titre, prompt });
    srv.store.patchTask(t.id, { status: 'ready' });
    return t.id;
  }

  async function attendre(recues: Assignation[], ms = 6_000): Promise<Assignation> {
    const fin = Date.now() + ms;
    while (recues.length === 0 && Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(recues.length, 'aucune assignation reçue').toBeGreaterThan(0);
    return recues[0] as Assignation;
  }

  it('une ouvrière inconnue reçoit le cadre de nourrice', { timeout: 20_000 }, async () => {
    // Le cas visé par la fonctionnalité : un modèle dont on ne sait rien.
    const srv = await demarrer({ polyethisme: 'consignes' });
    const recues = await brancherNoeud(srv, 'nouveau-venu');
    creerTache(srv, 'modifier le fichier src/auth.ts pour valider le jeton');

    const a = await attendre(recues);
    expect(a.hiveContext, 'aucun contexte joint').toBeTruthy();
    expect(a.hiveContext).toMatch(/CADRE DE TRAVAIL/);
    expect(a.hiveContext).toMatch(/INTERDITS/);
    expect(a.hiveContext, 'le test ne doit pas être supprimable').toMatch(
      /ne supprime et ne désactive AUCUN test/,
    );
  });

  it(
    'le périmètre annoncé est celui sur lequel les Gardiennes jugeront',
    { timeout: 20_000 },
    async () => {
      // Un cadre qui parlerait d'autres fichiers que ceux mesurés serait pire
      // qu'aucun cadre : l'ouvrière viserait à côté de la cible.
      const srv = await demarrer({ polyethisme: 'consignes' });
      const recues = await brancherNoeud(srv, 'n-perimetre');
      creerTache(srv, 'modifier le fichier src/auth.ts pour valider le jeton');

      const a = await attendre(recues);
      expect(a.hiveContext).toContain('src/auth.ts');
      // …et « auth » est une surface sensible : elle doit être signalée comme telle.
      expect(a.hiveContext).toMatch(/SURFACE SENSIBLE/);
    },
  );

  it(
    'une ouvrière expérimentée sur du code ordinaire ne reçoit aucun cadre',
    { timeout: 20_000 },
    async () => {
      // Sur-encadrer une bonne ouvrière coûte du contexte et appauvrit son
      // travail (doctrine, règle 6).
      const srv = await demarrer({ polyethisme: 'consignes' });
      semerImpeccable(srv, 'veterane', SEUIL_BUTINEUSE);
      const recues = await brancherNoeud(srv, 'veterane');
      creerTache(srv, 'ajuster la couleur du bouton dans src/ui/Bouton.tsx');

      const a = await attendre(recues);
      expect(a.hiveContext ?? '').not.toMatch(/CADRE DE TRAVAIL/);
    },
  );

  it(
    'même expérimentée, une ouvrière sur surface sensible est prévenue',
    { timeout: 20_000 },
    async () => {
      const srv = await demarrer({ polyethisme: 'consignes' });
      semerImpeccable(srv, 'veterane2', SEUIL_BUTINEUSE);
      const recues = await brancherNoeud(srv, 'veterane2');
      creerTache(srv, 'mettre à jour package.json');

      const a = await attendre(recues);
      expect(a.hiveContext ?? '').toMatch(/SURFACE SENSIBLE/);
    },
  );

  it('en mode off, rien ne change du tout', { timeout: 20_000 }, async () => {
    const srv = await demarrer({ polyethisme: 'off' });
    const recues = await brancherNoeud(srv, 'n-off');
    creerTache(srv, 'modifier le fichier src/auth.ts');

    const a = await attendre(recues);
    expect(a.hiveContext ?? '').not.toMatch(/CADRE DE TRAVAIL/);
  });

  it('Gardiennes éteintes ⇒ polyéthisme éteint, même demandé', { timeout: 20_000 }, async () => {
    // Sans signal de qualité, aucune caste ne peut se gagner : traiter tout
    // le monde en nourrice sur-encadrerait chaque bonne ouvrière.
    const srv = await demarrer({ polyethisme: 'strict', gardiennes: 'off' });
    const recues = await brancherNoeud(srv, 'n-sans-gardiennes');
    creerTache(srv, 'modifier le fichier src/auth.ts');

    const a = await attendre(recues);
    expect(a.hiveContext ?? '').not.toMatch(/CADRE DE TRAVAIL/);

    const rep = await fetch(`http://127.0.0.1:${srv.port}/api/polyethisme`, { headers });
    const vue = (await rep.json()) as { mode: string; modeDemande: string };
    expect(vue.mode).toBe('off');
    expect(vue.modeDemande).toBe('strict');
  });

  it('le contexte total reste sous la limite du protocole', { timeout: 20_000 }, async () => {
    // Un assign_task au-delà de LIMITS.hiveContext est REJETÉ par le nœud :
    // un cadre trop bavard ne dégraderait pas la tâche, il la supprimerait.
    const srv = await demarrer({ polyethisme: 'consignes' });
    // Beaucoup de souvenirs volumineux, pour que le budget soit disputé.
    for (let i = 0; i < 40; i++) {
      srv.store.recordMemory({
        taskId: `M${i}`,
        projectId: 'p',
        title: `Souvenir ${i} authentification jeton session`,
        content: `authentification jeton session ${'x'.repeat(3_000)}`,
      });
    }
    const recues = await brancherNoeud(srv, 'n-budget');
    creerTache(srv, 'authentification jeton session : modifier src/auth.ts et src/session.ts');

    const a = await attendre(recues);
    const taille = (a.hiveContext ?? '').length;
    expect(taille).toBeLessThanOrEqual(LIMITS.hiveContext);
    // Le budget doit avoir été RÉELLEMENT disputé, sinon ce test ne prouve
    // rien : un contexte à 2 ko passerait la limite sans jamais l'approcher.
    expect(taille, 'budget non contesté — le test serait vide de sens').toBeGreaterThan(
      LIMITS.hiveContext * 0.6,
    );
    // Et le cadre, lui, est intact : c'est le souvenir qui cède, pas la consigne.
    expect(a.hiveContext).toMatch(/CADRE DE TRAVAIL/);
    expect(a.hiveContext).toMatch(/ne supprime et ne désactive AUCUN test/);
  });

  it('la route rend des castes constatées, jamais déclarées', { timeout: 20_000 }, async () => {
    const srv = await demarrer({ polyethisme: 'consignes' });
    await brancherNoeud(srv, 'n-jeune');
    await brancherNoeud(srv, 'n-vieille');
    semerImpeccable(srv, 'n-vieille', SEUIL_BUTINEUSE);

    const rep = await fetch(`http://127.0.0.1:${srv.port}/api/polyethisme`, { headers });
    expect(rep.status).toBe(200);
    const vue = (await rep.json()) as {
      mode: string;
      noeuds: Array<{ nodeId: string; caste: string; productions: number; fiabilite: number }>;
    };
    expect(vue.mode).toBe('consignes');
    const jeune = vue.noeuds.find((n) => n.nodeId === 'n-jeune');
    const vieille = vue.noeuds.find((n) => n.nodeId === 'n-vieille');
    expect(jeune?.caste).toBe('nourrice');
    expect(jeune?.productions).toBe(0);
    expect(vieille?.caste).toBe('butineuse');
    expect(vieille?.fiabilite).toBe(1);
  });

  it('la route est protégée par le jeton', { timeout: 20_000 }, async () => {
    const srv = await demarrer({ polyethisme: 'consignes' });
    const rep = await fetch(`http://127.0.0.1:${srv.port}/api/polyethisme`);
    expect(rep.status).toBe(401);
  });
});

// ─── L'ÉCRAN — parce qu'une route que personne n'affiche n'existe pas ────────
//
// `/api/polyethisme` a vécu plusieurs semaines complètement branchée côté
// serveur, testée, et invisible : aucune vue ne la lisait. La ruche calculait
// des castes que personne ne voyait, ce qui revient à ne pas les calculer.

describe('la carte du polyéthisme, côté écran', () => {
  const BRUT = readFileSync(
    fileURLToPath(new URL('../dashboard/src/views/Essaim.tsx', import.meta.url)),
    'utf8',
  );
  /** Le CODE seul : l'en-tête de la carte PARLE des castes, il ne les affiche pas. */
  const VUE = BRUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');

  it('LA VUE ESSAIM LIT BIEN LA ROUTE', () => {
    expect(VUE).toContain('fetchPolyethisme');
    expect(VUE).toContain('<PolyethismeCard');
  });

  it('LES DEUX MODES SONT AFFICHÉS, PAS SEULEMENT CELUI QU’ON A RÉGLÉ', () => {
    // Sans Gardiennes, aucune inspection n'est rangée, donc aucune caste ne se
    // gagne : montrer le seul mode DEMANDÉ laisserait croire à un encadrement
    // qui ne tourne pas, et rendrait incompréhensible une ruche entièrement
    // composée de nourrices.
    expect(VUE).toContain('vue.mode');
    expect(VUE).toContain('vue.modeDemande');
  });

  it('les trois castes ont un libellé — aucune ne s’affiche par sa seule couleur', () => {
    for (const caste of CASTES) expect(VUE, caste).toContain(`${caste}:`);
  });

  it('la carte dit ce qui MANQUE pour monter, pas seulement le palier atteint', () => {
    // Un badge seul laisserait l'hôte deviner pourquoi son nœud stagne — et
    // « nourrice » se lirait comme un reproche au lieu d'un état d'observation.
    expect(VUE).toContain('vue.seuils.batisseuse');
    expect(VUE).toContain('vue.seuils.butineuse');
  });
});
