// Câblage du Cerveau : le savoir arrive-t-il VRAIMENT jusqu'à l'ouvrière ?
//
// ─── POURQUOI CE FICHIER EXISTE, ET PAS SEULEMENT LES DEUX AUTRES ────────────
//
// `cerveau.test.ts` verrouille les décisions, `cerveau-reel.test.ts` le disque.
// Aucun des deux ne peut répondre à la seule question qui décide si le lot est
// tenu : **une vraie ouvrière, branchée sur une vraie ruche, reçoit-elle le
// bloc ?**
//
// `docs/ETAPES.md` ne coche ✅ que si quelque chose le VÉRIFIE. Un module pur
// et une moitié disque, tous deux verts, peuvent parfaitement coexister avec
// un appelant absent — c'est exactement l'état dans lequel ce lot est resté
// deux PR durant, et c'est ce fichier qui l'en sort.
//
// On monte donc un serveur réel, on branche un nœud en WebSocket, on crée une
// tâche, et on lit ce que le nœud reçoit.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { LIMITS } from '../src/shared/protocol.js';

const TOKEN = 'jeton-cerveau-suffisamment-long';

interface Assignation {
  type: string;
  hiveContext?: string;
  task?: { id: string };
}

describe('le Cerveau arrive jusqu’à l’ouvrière', () => {
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

  /**
   * Démarre une ruche dont le dossier `cerveau` contient déjà `notes`.
   *
   * Les notes sont écrites À LA MAIN, en markdown brut, plutôt qu'avec
   * `ecrire()` : ce test doit rester vrai même si la sérialisation change, et
   * surtout c'est ainsi qu'un humain les posera — en tapant dans Obsidian.
   */
  async function demarrer(notes: Record<string, string>): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-cerveau-w-'));
    const donnees = path.join(dir, 'data');
    const cerveau = path.join(donnees, 'cerveau');
    mkdirSync(cerveau, { recursive: true });
    for (const [nom, contenu] of Object.entries(notes)) {
      writeFileSync(path.join(cerveau, nom), contenu, 'utf8');
    }
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(donnees, 'hive.db'),
      simulation: false,
      tickMs: 60,
    });
    return server;
  }

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

  const noteInvariant = [
    '---',
    'genre: invariant',
    'titre: Jamais de shell',
    'regle: TOUJOURS-SPAWN-SHELL-FALSE',
    '---',
    'Toute exécution passe par spawn sans shell.',
    '',
  ].join('\n');

  it('UN INVARIANT DU DOSSIER ARRIVE DANS LE `assign_task`', { timeout: 20_000 }, async () => {
    // L'assertion qui décide du lot 12. Tout le reste du Cerveau peut être
    // vert sans que cette ligne le soit.
    const srv = await demarrer({ 'shell-false.md': noteInvariant });
    const recues = await brancherNoeud(srv, 'ouvriere-un');
    creerTache(srv, 'lancer un processus de test');

    const a = await attendre(recues);
    expect(a.hiveContext, 'aucun contexte joint').toBeTruthy();
    expect(a.hiveContext, 'la RÈGLE doit arriver telle quelle').toContain(
      'TOUJOURS-SPAWN-SHELL-FALSE',
    );
    // Et elle arrive comme une DONNÉE, pas comme une consigne.
    expect(a.hiveContext).toContain('HIVE_DATA');
  });

  it('un cerveau VIDE ne joint rien — pas un bloc décoratif', { timeout: 20_000 }, async () => {
    const srv = await demarrer({});
    const recues = await brancherNoeud(srv, 'ouvriere-deux');
    creerTache(srv, 'une tâche ordinaire');

    const a = await attendre(recues);
    // Sans savoir ni échec passé ni souvenir, il n'y a rien à joindre. Un bloc
    // vide mais présent coûterait du budget pour ne rien dire.
    expect(a.hiveContext ?? '').not.toContain('LE CERVEAU DE LA RUCHE');
  });

  it(
    'CE QUI N’EST PAS UNE NOTE N’ENTRE PAS DANS LA TÊTE DE L’OUVRIÈRE',
    {
      timeout: 20_000,
    },
    async () => {
      // Le dossier est ouvert dans un éditeur : il contiendra des brouillons.
      // Aucun ne doit devenir du savoir.
      const srv = await demarrer({
        'shell-false.md': noteInvariant,
        'README.md': '# Mes notes\n\nCECI-NE-DOIT-PAS-ARRIVER',
        'brouillon.md': '---\ngenre: nimportequoi\n---\nCECI-NON-PLUS',
      });
      const recues = await brancherNoeud(srv, 'ouvriere-trois');
      creerTache(srv, 'lancer un processus');

      const a = await attendre(recues);
      expect(a.hiveContext).toContain('TOUJOURS-SPAWN-SHELL-FALSE');
      expect(a.hiveContext).not.toContain('CECI-NE-DOIT-PAS-ARRIVER');
      expect(a.hiveContext).not.toContain('CECI-NON-PLUS');
    },
  );

  it(
    'UN REFUS EST JOURNALISÉ — l’ouvrière part sans ses invariants, ça se voit',
    {
      timeout: 20_000,
    },
    async () => {
      // Le pire scénario du module : les invariants ne tiennent pas dans le
      // budget, `contexte()` rend '' — et sans ce journal, une ouvrière
      // travaillerait sans les contraintes de sûreté du projet exactement comme
      // si le cerveau était vide. Deux situations indiscernables, dont une
      // grave : c'est la définition d'une panne silencieuse.
      const srv = await demarrer({
        'enorme.md': [
          '---',
          'genre: invariant',
          'titre: Un invariant démesuré',
          'regle: R',
          '---',
          'z'.repeat(6_000),
          '',
        ].join('\n'),
      });
      const recues = await brancherNoeud(srv, 'ouvriere-cinq');
      creerTache(srv, 'une tâche quelconque');
      await attendre(recues);

      // `listEvents(sinceId, limit)` — le premier paramètre est un curseur, pas
      // un plafond. Passer `200` en première position demandait les événements
      // APRÈS l'identifiant 200, donc aucun.
      const journal = srv.store.listEvents(0, 500).filter((e) => e.type === 'cerveau_refus');
      expect(journal.length, 'le refus doit apparaître au journal').toBeGreaterThan(0);
      expect(JSON.stringify(journal[0]?.payload)).toMatch(/budget/);
    },
  );

  it('LE CONTEXTE RESTE DANS LE BUDGET DU PROTOCOLE', { timeout: 20_000 }, async () => {
    // Un `assign_task` trop gros est REJETÉ par le nœud : un cerveau bavard
    // supprimerait la tâche au lieu de l'informer. C'est la même garde que le
    // polyéthisme s'est posée, et pour la même raison.
    const notes: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      notes[`lecon-${i}.md`] = [
        '---',
        'genre: lecon',
        `titre: Leçon numéro ${i}`,
        `regle: Règle ${i} — ${'x'.repeat(300)}`,
        '---',
        'y'.repeat(1200),
        '',
      ].join('\n');
    }
    const srv = await demarrer(notes);
    const recues = await brancherNoeud(srv, 'ouvriere-quatre');
    creerTache(srv, 'une tâche parmi beaucoup de leçons');

    const a = await attendre(recues);
    expect(a.hiveContext, 'du savoir doit tout de même arriver').toBeTruthy();
    expect(
      (a.hiveContext ?? '').length,
      'le contexte déborde le plafond du protocole',
    ).toBeLessThanOrEqual(LIMITS.hiveContext);
  });
});
