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
  task?: { id: string; prompt?: string };
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

  it(
    'LA BOUCLE SE REFERME : un échec écrit par la ruche revient dans une tâche SUIVANTE',
    { timeout: 30_000 },
    async () => {
      // ─── L'ASSERTION QUI DÉCIDE DU LOT 12 ────────────────────────────────
      //
      // Tout le reste peut être vert pendant que la ruche LIT un cerveau que
      // seul un humain remplit. Ce test exige l'autre moitié : la ruche
      // observe une panne, l'écrit, et la retrouve la fois d'après. C'est ça,
      // « s'améliorer en se corrigeant ».
      const srv = await demarrer({});
      const recues = await brancherNoeud(srv, 'ouvriere-boucle');
      const t1 = creerTache(srv, 'compiler le module natif', 'Première tâche');
      const a1 = await attendre(recues);
      expect(a1.task?.id).toBe(t1);

      // Le nœud rapporte un échec avec un log reconnaissable.
      const ws = sockets[sockets.length - 1] as WebSocket;
      ws.send(
        JSON.stringify({
          type: 'task_result',
          taskId: t1,
          success: false,
          diff: '',
          logs: 'Error: MODULE_INTROUVABLE_SIGNATURE_UNIQUE lors de la compilation',
          durationMs: 10,
          // `isSubAgents` fait partie de la validation : sans ce champ, le
          // message entier est REJETÉ avant d'atteindre le handler, et la
          // ruche paraîtrait simplement ne rien apprendre.
          subAgents: [],
        }),
      );

      // La ruche doit avoir écrit un épisode — on l'attend au journal plutôt
      // que par un délai deviné (§ 3.2 : on attend ce qu'on attend).
      const fin = Date.now() + 10_000;
      let episodes = 0;
      while (Date.now() < fin) {
        episodes = srv.store.listEvents(0, 500).filter((e) => e.type === 'cerveau_episode').length;
        if (episodes > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(episodes, 'la ruche n’a rien écrit dans son cerveau').toBeGreaterThan(0);

      // Une tâche SUIVANTE, sur le même sujet, doit recevoir cet épisode.
      recues.length = 0;
      creerTache(srv, 'compiler le module natif encore', 'Deuxième tâche');
      const a2 = await attendre(recues, 15_000);
      expect(a2.hiveContext, 'aucun contexte joint à la seconde tâche').toBeTruthy();
      expect(
        a2.hiveContext,
        'l’épisode écrit par la ruche ne revient pas dans le contexte suivant',
      ).toContain('MODULE_INTROUVABLE_SIGNATURE_UNIQUE');
    },
  );

  it('UNE RÉUSSITE N’ÉCRIT AUCUN ÉPISODE', { timeout: 20_000 }, async () => {
    // Le cerveau garde ce qui a MAL tourné. Y verser aussi les réussites
    // noierait le signal — et gonflerait des compteurs de récurrence sur des
    // pannes qui n'ont jamais eu lieu, donc fausserait le seuil.
    const srv = await demarrer({});
    const recues = await brancherNoeud(srv, 'ouvriere-six');
    const t = creerTache(srv, 'une tâche qui réussit');
    await attendre(recues);

    const ws = sockets[sockets.length - 1] as WebSocket;
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: t,
        success: true,
        diff: 'diff --git a/x b/x',
        logs: 'Error: ce mot ne doit PAS suffire à écrire un épisode',
        durationMs: 10,
        subAgents: [],
      }),
    );
    await new Promise((r) => setTimeout(r, 800));
    expect(
      srv.store.listEvents(0, 500).filter((e) => e.type === 'cerveau_episode'),
      'une réussite ne doit rien verser au cerveau',
    ).toEqual([]);
  });

  it('À LA TROISIÈME RÉCURRENCE, LA CONSOLIDATION EST PROPOSÉE', { timeout: 40_000 }, async () => {
    // La proposition, jamais la rédaction : l'événement dit « ce motif est
    // mûr », et un humain écrit la règle s'il la comprend.
    const srv = await demarrer({});
    const recues = await brancherNoeud(srv, 'ouvriere-sept');
    const ws = sockets[sockets.length - 1] as WebSocket;
    const vues = new Set<string>();

    creerTache(srv, 'compiler quelque chose de récalcitrant');

    // La tâche est re-tentée : chaque assignation reçoit le MÊME échec, donc
    // la même signature, donc la même note incrémentée.
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
      const a = recues.shift();
      if (a?.task?.id !== undefined && !vues.has(`${a.task.id}:${vues.size}`)) {
        vues.add(`${a.task.id}:${vues.size}`);
        ws.send(
          JSON.stringify({
            type: 'task_result',
            taskId: a.task.id,
            success: false,
            diff: '',
            logs: 'Error: PANNE_RECURRENTE dans le module',
            durationMs: 5,
            subAgents: [],
          }),
        );
      }
      if (srv.store.listEvents(0, 500).some((e) => e.type === 'cerveau_consolidation')) break;
      await new Promise((r) => setTimeout(r, 60));
    }

    const props = srv.store.listEvents(0, 500).filter((e) => e.type === 'cerveau_consolidation');
    expect(props.length, 'aucune consolidation proposée après trois échecs').toBeGreaterThan(0);
    expect(JSON.stringify(props[0]?.payload)).toMatch(/recurrences/);
  });

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

// ─── LA CONTRE-EXPERTISE, VUE DEPUIS LA RUCHE ────────────────────────────────
//
// Le module pur est verrouillé dans `contre-expertise.test.ts`. Ici, la seule
// question qui reste : la ruche s'en sert-elle vraiment quand une production
// arrive, et DIT-elle ce qu'elle a décidé ?

describe('la contre-expertise est annoncée à chaque production', () => {
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

  async function ruche(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-ce-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60,
    });
    return server;
  }

  async function noeud(srv: HiveServer, nodeId: string, agentType: string): Promise<Assignation[]> {
    const recues: Assignation[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as Assignation;
      if (m.type === 'assign_task') recues.push(m);
    });
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: nodeId,
        ownerName: 'test',
        agentType,
        maxConcurrency: 1,
        nodeId,
      }),
    );
    return recues;
  }

  const attendreEvt = async (srv: HiveServer, type: string, ms = 8_000): Promise<unknown> => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      const e = srv.store.listEvents(0, 500).find((x) => x.type === type);
      if (e) return e.payload;
      await new Promise((r) => setTimeout(r, 50));
    }
    return undefined;
  };

  it('UN SECOND MODÈLE EN LIGNE ⇒ la ruche le nomme', { timeout: 40_000 }, async () => {
    const srv = await ruche();
    const recues = await noeud(srv, 'producteur', 'claude-code');
    await noeud(srv, 'relecteur', 'codex');

    const projet = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });

    const fin = Date.now() + 8_000;
    while (recues.length === 0 && Date.now() < fin) await new Promise((r) => setTimeout(r, 40));
    expect(recues.length, 'aucune assignation').toBeGreaterThan(0);
    const idTache = recues[0]?.task?.id as string;

    const ws = sockets[0] as WebSocket;
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: idTache,
        success: true,
        diff: 'diff --git a/x b/x\n+const a = 1;',
        logs: 'ok',
        durationMs: 5,
        subAgents: [],
      }),
    );

    const p = (await attendreEvt(srv, 'contre_expertise')) as
      { possible?: boolean; modeles?: string[] } | undefined;
    expect(p, 'aucun événement contre_expertise').toBeDefined();
    expect(p?.possible).toBe(true);
    expect(p?.modeles, 'le modèle relecteur doit être nommé').toEqual(['codex']);
  });

  it('SEUL SUR SON MODÈLE ⇒ un REFUS VISIBLE, pas un silence', { timeout: 40_000 }, async () => {
    // Le cas qui compte : tu, « aucun second modèle » se confondrait avec
    // « on a relu et rien trouvé ». Deux situations opposées, un même écran.
    const srv = await ruche();
    const recues = await noeud(srv, 'seul', 'claude-code');

    const projet = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });

    const fin = Date.now() + 8_000;
    while (recues.length === 0 && Date.now() < fin) await new Promise((r) => setTimeout(r, 40));
    const idTache = recues[0]?.task?.id as string;

    (sockets[0] as WebSocket).send(
      JSON.stringify({
        type: 'task_result',
        taskId: idTache,
        success: true,
        diff: 'diff --git a/y b/y\n+const b = 2;',
        logs: 'ok',
        durationMs: 5,
        subAgents: [],
      }),
    );

    const p = (await attendreEvt(srv, 'contre_expertise')) as
      { possible?: boolean; motif?: string } | undefined;
    expect(p, 'le refus doit être journalisé, pas tu').toBeDefined();
    expect(p?.possible).toBe(false);
    expect(p?.motif).toMatch(/angles morts/);
  });

  // ═══ LE LOT 13 SE JOUE ICI ════════════════════════════════════════════════
  //
  // Tout le reste de la contre-expertise peut être vert sans que la critique
  // parte : c'était l'état exact du lot pendant deux PR — un module qui DÉCIDE
  // qui doit relire, et personne pour lancer la relecture.
  //
  // Ces trois tests demandent la seule chose qui tranche : est-ce qu'un modèle
  // reçoit VRAIMENT le travail d'un autre à juger, et est-ce que son verdict
  // revient ?

  /** Fait produire un diff au nœud `claude-code`, et rend l'id de la tâche. */
  async function produire(srv: HiveServer, recues: Assignation[], diff: string): Promise<string> {
    const projet = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({
      projectId: projet.id,
      title: 'Ajouter une garde',
      prompt: 'p',
    });
    srv.store.patchTask(t.id, { status: 'ready' });

    const fin = Date.now() + 8_000;
    while (recues.length === 0 && Date.now() < fin) await new Promise((r) => setTimeout(r, 40));
    expect(recues.length, 'le producteur n’a rien reçu').toBeGreaterThan(0);
    const idTache = recues[0]?.task?.id as string;

    (sockets[0] as WebSocket).send(
      JSON.stringify({
        type: 'task_result',
        taskId: idTache,
        success: true,
        diff,
        logs: 'ok',
        durationMs: 5,
        subAgents: [],
      }),
    );
    return idTache;
  }

  /**
   * Attend une assignation, avec un PLAFOND QUI DISCRIMINE.
   *
   * ─── POURQUOI 3 SECONDES, ET PAS 8 ─────────────────────────────────────────
   *
   * La ruche a un filet : `staleAssignedTasks(5_000)` re-livre toute tâche
   * assignée restée muette plus de 5 s — « message perdu en vol ». Ce filet
   * rattrape donc AUSSI une relecture que le dispatch n'aurait jamais envoyée.
   *
   * Première version de ces tests : plafond à 8 s. Ils passaient TOUS, y
   * compris en coupant l'envoi — la loupe l'a montré. Ils ne prouvaient pas
   * que la critique partait, seulement qu'elle finissait par arriver.
   *
   * Mesuré, la même relecture, sur la même ruche :
   *
   *     dispatch direct        7 ms
   *     filet de rattrapage    5 060 ms
   *
   * 3 secondes se posent entre les deux : plus de quatre cents fois la latence
   * réelle, et bien en deçà du filet. Un plafond qui ne discrimine pas ne
   * mesure rien.
   */
  const attendreAssignation = async (
    recues: Assignation[],
    ms = 3_000,
  ): Promise<Assignation | undefined> => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      if (recues.length > 0) return recues[0];
      await new Promise((r) => setTimeout(r, 40));
    }
    return undefined;
  };

  it('LA CRITIQUE ATTEINT VRAIMENT L’AUTRE MODÈLE', { timeout: 40_000 }, async () => {
    // L'assertion qui décide du lot 13. Sans elle, « contre-expertise » ne
    // désigne qu'un événement qui NOMME un relecteur sans jamais le solliciter.
    const srv = await ruche();
    const produits = await noeud(srv, 'producteur', 'claude-code');
    const relus = await noeud(srv, 'relecteur', 'codex');

    await produire(srv, produits, 'diff --git a/auth.ts b/auth.ts\n+if (!jeton) return;');

    const a = await attendreAssignation(relus);
    expect(
      a,
      'rien en 3 s : la critique n’est pas partie du dispatch. Si elle arrive plus tard, ' +
        'c’est le filet `staleAssignedTasks` qui la rattrape — ce n’est pas la même chose.',
    ).toBeDefined();

    const prompt = a?.task?.prompt ?? '';
    expect(prompt, 'ce n’est pas une consigne de critique').toMatch(/CONTRE-EXPERTISE/);
    expect(prompt, 'le relecteur doit savoir QUEL modèle il juge').toContain('claude-code');
    expect(prompt, 'le diff jugé doit être là').toContain('auth.ts');
    // Et il y arrive comme une DONNÉE : un diff hostile ne devient pas une
    // consigne du seul fait qu'il traverse la ruche.
    expect(prompt, 'la production doit être encapsulée').toContain('HIVE_DATA');
  });

  it('LE VERDICT REVIENT, avec ses objections', { timeout: 40_000 }, async () => {
    const srv = await ruche();
    const produits = await noeud(srv, 'producteur', 'claude-code');
    const relus = await noeud(srv, 'relecteur', 'codex');

    const idProduction = await produire(srv, produits, 'diff --git a/x b/x\n+const a = 1;');
    const a = await attendreAssignation(relus);
    expect(a, 'aucune relecture lancée').toBeDefined();

    // Le relecteur rend son avis, en texte libre — comme un vrai modèle.
    (sockets[1] as WebSocket).send(
      JSON.stringify({
        type: 'task_result',
        taskId: a?.task?.id,
        success: true,
        diff: '',
        logs: 'conteste\n- le cas du jeton vide n’est pas traité',
        durationMs: 5,
        subAgents: [],
      }),
    );

    const v = (await attendreEvt(srv, 'contre_expertise_verdict')) as
      | { taskId?: string; conteste?: boolean; objections?: string[]; relecteur?: string }
      | undefined;
    expect(v, 'le verdict n’est jamais remonté').toBeDefined();
    expect(v?.taskId, 'le verdict doit désigner la PRODUCTION, pas la relecture').toBe(
      idProduction,
    );
    expect(v?.conteste).toBe(true);
    expect(v?.relecteur).toBe('codex');
    expect(v?.objections?.join(' ')).toMatch(/jeton vide/);

    // ─── ET IL EST RANGÉ, PAS SEULEMENT ÉMIS ────────────────────────────────
    //
    // Un événement vit dans le passé. La décision de livrer se prend plus tard,
    // sur un autre tick : sans cette trace en base, `HIVE_POLYETHISME=strict`
    // n'aurait rien à consulter et la porte de `aLivrer` se refermerait sur
    // toutes les productions — y compris celles qu'une relectrice a validées.
    //
    // C'est la mutation qui a exigé ce test : retirer l'enregistrement laissait
    // `tests/polyethisme-livraison.test.ts` entièrement vert, parce qu'il écrit
    // la contre-visite par le store et jamais par le vrai chemin.
    const range = srv.store.contreVisiteDe(idProduction);
    expect(range, 'le verdict n’a pas été rangé : la porte n’aura rien à lire').not.toBeNull();
    expect(range?.suite, 'un verdict contesté ne peut pas valoir « appliquer »').toBe('ameliorer');
    expect(range?.visiteurAgent).toBe('codex');
  });

  it(
    'UNE RELECTURE N’EST PAS RELUE — sinon c’est une régression infinie',
    { timeout: 40_000 },
    async () => {
      // Chaque tour coûterait un vrai appel de modèle. C'est la table latérale
      // qui coupe : une tâche y figure si et seulement si elle a été créée POUR
      // relire quelque chose.
      const srv = await ruche();
      const produits = await noeud(srv, 'producteur', 'claude-code');
      const relus = await noeud(srv, 'relecteur', 'codex');

      await produire(srv, produits, 'diff --git a/x b/x\n+const a = 1;');
      const a = await attendreAssignation(relus);
      expect(a, 'aucune relecture lancée').toBeDefined();
      expect(
        srv.store.relectureDe(a?.task?.id as string),
        'la relecture doit être inscrite',
      ).not.toBeNull();

      // Le relecteur rend un avis AVEC un diff non vide : c'est le cas piège,
      // celui qui ressemble le plus à une production ordinaire.
      (sockets[1] as WebSocket).send(
        JSON.stringify({
          type: 'task_result',
          taskId: a?.task?.id,
          success: true,
          diff: 'diff --git a/note.md b/note.md\n+une remarque',
          logs: 'valide',
          durationMs: 5,
          subAgents: [],
        }),
      );

      await attendreEvt(srv, 'contre_expertise_verdict');
      // Laisser à une éventuelle seconde vague le temps de partir.
      await new Promise((r) => setTimeout(r, 600));
      expect(
        relus.length,
        `le relecteur a reçu ${relus.length} tâches : la relecture a été relue`,
      ).toBe(1);
    },
  );
});
