// Les Chantiers, BRANCHÉS : un travail déclaré par le dépôt atteint un nœud.
//
// ─── POURQUOI CE FICHIER MONTE UN VRAI NŒUD ──────────────────────────────────
//
// `chantier.ts` décide depuis une PR, et rien ne l'appelait. Le carnet dit ce
// que ça coûte : le Cerveau et la contre-expertise sont restés dans cet état
// deux PR chacun — un module complet, testé, et débranché. On ne coche donc pas
// cette pièce sur un test qui appellerait `jugerChantier` une fois de plus.
//
// Ici, un nœud se connecte pour de vrai en WebSocket, et l'on regarde ce qu'il
// REÇOIT.
//
// ─── LA PROPRIÉTÉ QUI PORTE LE FICHIER ───────────────────────────────────────
//
//   LE HUB N'ENVOIE PAS DE COMMANDE. IL ENVOIE UN NOM.
//
// C'est toute la différence avec `assign_merge`, qui porte un `testCommand`. Le
// nœud relit le `package.json` du clone qu'il vient de faire, vérifie que le nom
// y figure, et compose l'argv lui-même. Un hub compromis — jeton de ruche
// partagé, vieille invitation, `ws://` de réseau local — ne peut donc désigner
// que ce que le dépôt déclare DÉJÀ.
//
// Si un jour ce message porte un `argv`, cette garde tombe. Les assertions
// ci-dessous sont écrites pour rougir ce jour-là.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { nomDeChantierValide } from '../src/shared/chantier.js';
import { isOnShift, nightShiftFromEnv } from '../src/shared/night-shift.js';

import { parseClientMessage, parseServerMessage } from '../src/shared/protocol.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-chantier-suffisamment-long-pour-passer';

/**
 * Une fenêtre de service d'UNE minute, posée trente minutes plus tard que
 * maintenant — donc une fenêtre qui ne peut pas contenir l'instant présent.
 *
 * L'heure est LOCALE, comme `minutesOfDay` dans `night-shift.ts` : comparer un
 * réglage local à une horloge UTC rendrait le décalage horaire de la machine
 * responsable du verdict, ce qui est exactement le défaut qu'on répare.
 *
 * Trente minutes de marge pour un banc qui a trois minutes de délai : le
 * chevauchement n'est pas seulement improbable, il est impossible.
 */
function fenetreSansService(maintenant: Date): string {
  const MINUTES_PAR_JOUR = 24 * 60;
  const actuelle = maintenant.getHours() * 60 + maintenant.getMinutes();
  const debut = (actuelle + 30) % MINUTES_PAR_JOUR;
  const fin = (debut + 1) % MINUTES_PAR_JOUR;
  const hhmm = (m: number): string =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${hhmm(debut)}-${hhmm(fin)}`;
}

/** Le `package.json` que le miroir servira. */
const PAQUET = JSON.stringify({
  name: 'depot-connecte',
  scripts: {
    test: 'vitest run',
    lint: 'eslint .',
    publish: 'npm publish --access public',
    demo: 'node demo.js',
  },
});

describe('un chantier déclaré atteint un nœud', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  let depot: string | null = null;
  const sockets: WebSocket[] = [];
  const battements: NodeJS.Timeout[] = [];

  afterEach(async () => {
    for (const c of battements.splice(0)) clearInterval(c);
    for (const ws of sockets.splice(0)) ws.close();
    await server?.stop();
    server = null;
    for (const d of [dir, depot]) {
      if (d) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    }
    dir = null;
    depot = null;
  });

  /**
   * Un dépôt git LOCAL, vrai, avec un `package.json`.
   *
   * Le miroir clone ce que `repoUrl` désigne. Un chemin de fichier est un
   * `repoUrl` valide pour git, ce qui évite d'aller sur le réseau depuis un
   * test — et rend la lecture du `package.json` réelle plutôt que simulée.
   */
  async function depotLocal(): Promise<string> {
    const { simpleGit } = await import('simple-git');
    depot = mkdtempSync(path.join(os.tmpdir(), 'hive-depot-'));
    writeFileSync(path.join(depot, 'package.json'), PAQUET);
    const g = simpleGit({ baseDir: depot });
    await g.init();
    await g.addConfig('user.email', 't@example.com');
    await g.addConfig('user.name', 'T');
    await g.add('.');
    await g.commit('initial');
    return depot;
  }

  async function ruche(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-chantier-'));
    mkdirSync(path.join(dir, 'data', 'cerveau'), { recursive: true });
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'data', 'hive.db'),
      simulation: false,
      tickMs: 60,
    });
    return server;
  }

  /** Un nœud qui se connecte, bat, et retient ce qu'on lui envoie. */
  async function noeud(srv: HiveServer): Promise<Record<string, unknown>[]> {
    const recus: Record<string, unknown>[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    ws.on('message', (d) => recus.push(JSON.parse(d.toString()) as Record<string, unknown>));
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: 'ouvriere',
        ownerName: 't',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: 'ouvriere',
      }),
    );
    // Le nœud doit BATTRE : sans battements il meurt de timeout, et le hub
    // n'aurait plus de nœud « en ligne » à qui confier le chantier.
    const coeur = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'heartbeat', running: 0 }));
    }, 500);
    battements.push(coeur);
    // Laisser l'enregistrement aboutir avant de compter sur ce nœud.
    await attendre(() => recus.some((m) => m.type === 'registered'));
    return recus;
  }

  async function attendre(condition: () => boolean, msMax = 8_000): Promise<void> {
    const fin = Date.now() + msMax;
    while (Date.now() < fin) {
      if (condition()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('condition jamais atteinte');
  }

  /** La même chose, pour une condition qui doit interroger le serveur. */
  async function attendreAsync(condition: () => Promise<boolean>, msMax = 8_000): Promise<void> {
    const fin = Date.now() + msMax;
    while (Date.now() < fin) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('condition jamais atteinte');
  }

  const poster = async (srv: HiveServer, chemin: string, corps: unknown = {}): Promise<Response> =>
    fetch(`http://127.0.0.1:${srv.port}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify(corps),
    });

  const lire = async (srv: HiveServer, chemin: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${srv.port}${chemin}`, {
      headers: { 'x-hive-token': TOKEN },
    });

  it(
    'LE CHANTIER ATTEINT LE NŒUD — et le message porte un NOM, pas une commande',
    { timeout: 60_000 },
    async () => {
      const srv = await ruche();
      const recus = await noeud(srv);
      const projet = srv.store.createProject({ name: 'P', repoUrl: await depotLocal() });

      const rep = await poster(srv, `/api/projects/${projet.id}/chantiers/test/run`);
      expect(rep.status, await rep.text().catch(() => '')).toBe(202);

      await attendre(() => recus.some((m) => m.type === 'assign_chantier'));
      const assign = recus.find((m) => m.type === 'assign_chantier')!;

      // ─── LES DEUX ASSERTIONS QUI TIENNENT LA FRONTIÈRE ──────────────────
      expect(assign.nom, 'le hub désigne un script par son NOM').toBe('test');
      expect(
        Object.keys(assign),
        'aucune commande ne doit voyager : le nœud la compose depuis SON clone',
      ).not.toContain('argv');
      expect(Object.keys(assign)).not.toContain('testCommand');
    },
  );

  it('UN SCRIPT NON DÉCLARÉ N’ATTEINT JAMAIS LE NŒUD', { timeout: 60_000 }, async () => {
    const srv = await ruche();
    const recus = await noeud(srv);
    const projet = srv.store.createProject({ name: 'P', repoUrl: await depotLocal() });

    const rep = await poster(srv, `/api/projects/${projet.id}/chantiers/inexistant/run`);
    expect(rep.status).toBe(400);
    expect(((await rep.json()) as { error: string }).error).toMatch(/n’invente pas de commande/);
    // Rien n'est parti — le refus est en amont, pas un message que le nœud
    // aurait à décliner.
    expect(recus.some((m) => m.type === 'assign_chantier')).toBe(false);
  });

  it('PUBLIER N’ATTEINT JAMAIS LE NŒUD — même déclaré', { timeout: 60_000 }, async () => {
    // ─── CE QUE CE TEST EMPÊCHE ──────────────────────────────────────────
    //
    // `publish` EST dans le `package.json` du dépôt. La règle qui le refuse
    // n'est donc pas « le dépôt ne le déclare pas » mais « ça sort de la
    // machine, et ça demande un humain ». La route n'expose délibérément pas
    // `intentionHumaine` : une requête HTTP ne peut pas prouver qu'un humain
    // est derrière, et l'exposer laisserait n'importe quel appelant cocher la
    // case.
    const srv = await ruche();
    const recus = await noeud(srv);
    const projet = srv.store.createProject({ name: 'P', repoUrl: await depotLocal() });

    const rep = await poster(srv, `/api/projects/${projet.id}/chantiers/publish/run`);
    expect(rep.status).toBe(400);
    expect(((await rep.json()) as { error: string }).error).toMatch(/irréversibles|humain/);
    expect(recus.some((m) => m.type === 'assign_chantier')).toBe(false);
  });

  it('LA LISTE PROPOSÉE VIENT DU DÉPÔT, ET DIT CE QUI EST AUTOMATISABLE', async () => {
    const srv = await ruche();
    const projet = srv.store.createProject({ name: 'P', repoUrl: await depotLocal() });

    const rep = await lire(srv, `/api/projects/${projet.id}/chantiers`);
    expect(rep.status).toBe(200);
    const { chantiers } = (await rep.json()) as {
      chantiers: { nom: string; automatisable: boolean }[];
    };
    const par = new Map(chantiers.map((c) => [c.nom, c.automatisable]));
    expect(par.get('test')).toBe(true);
    expect(par.get('lint')).toBe(true);
    expect(par.get('publish'), 'publier n’est jamais automatisable').toBe(false);
    expect(par.get('demo'), 'un nom inconnu n’est pas « sûr »').toBe(false);
  });

  it('SANS NŒUD EN LIGNE, on le dit — on ne perd pas la demande en silence', async () => {
    const srv = await ruche();
    const projet = srv.store.createProject({ name: 'P', repoUrl: await depotLocal() });

    const rep = await poster(srv, `/api/projects/${projet.id}/chantiers/test/run`);
    expect(rep.status).toBe(503);
  });

  it('un projet sans dépôt ne peut pas avoir de chantier', async () => {
    const srv = await ruche();
    const projet = srv.store.createProject({ name: 'P' });
    const rep = await poster(srv, `/api/projects/${projet.id}/chantiers/test/run`);
    expect(rep.status).toBe(400);
  });

  it('LE RÉSULTAT DU NŒUD REVIENT AU PROJET', { timeout: 60_000 }, async () => {
    // Le chemin de retour compte autant que l'aller : un chantier dont le
    // verdict n'arrive nulle part ne sert à personne.
    const srv = await ruche();
    const recus = await noeud(srv);
    const projet = srv.store.createProject({ name: 'P', repoUrl: await depotLocal() });

    const rep = await poster(srv, `/api/projects/${projet.id}/chantiers/lint/run`);
    const { chantierId } = (await rep.json()) as { chantierId: string };
    await attendre(() => recus.some((m) => m.type === 'assign_chantier'));

    sockets[0]!.send(
      JSON.stringify({
        type: 'chantier_result',
        chantierId,
        nom: 'lint',
        code: 0,
        sortie: 'tout est propre',
        ok: true,
      }),
    );

    // ─── UNE ATTENTE QUI ATTEND VRAIMENT ────────────────────────────────────
    //
    // Écrit `attendre(async () => true)` d'abord — et le typage l'a arrêté :
    // une fonction `async` rend une Promise, qui est TOUJOURS vraie. La
    // condition n'aurait rien attendu du tout, et le test aurait relu le
    // résultat avant que le message ait traversé le socket. Il passait quand
    // même, grâce à un `setTimeout` de rattrapage plus bas : un vert obtenu
    // par une seconde chance qui masquait la première.
    let resultat: { nom: string; ok: boolean } | null = null;
    await attendreAsync(async () => {
      const lu = await lire(srv, `/api/projects/${projet.id}/chantiers/result`);
      resultat = ((await lu.json()) as { resultat: typeof resultat }).resultat;
      return resultat !== null;
    });
    expect(resultat!.nom).toBe('lint');
    expect(resultat!.ok).toBe(true);
  });

  it('UN RÉSULTAT ORPHELIN EST DIT, PAS AVALÉ', { timeout: 60_000 }, async () => {
    // ─── LA LEÇON QUE LE MERGE A PAYÉE ─────────────────────────────────────
    //
    // Un résultat dont le hub ne connaît plus l'identifiant était, côté merge,
    // ignoré EN SILENCE. Or ce nœud vient de cloner un dépôt et d'y lancer une
    // commande : de son côté « chantier terminé », du côté humain rien, jamais.
    //
    // Le cas arrive tout seul — hub redémarré, chantier expiré, nœud qui finit
    // quand même. Deux destinataires : le nœud, pour cesser de croire son
    // travail pris en compte, et le journal, pour qu'un humain puisse relier ce
    // qu'il a vu tourner à ce que la ruche en a fait.
    const srv = await ruche();
    const recus = await noeud(srv);

    sockets[0]!.send(
      JSON.stringify({
        type: 'chantier_result',
        chantierId: 'jamais-vu',
        nom: 'test',
        code: 0,
        sortie: '',
        ok: true,
      }),
    );

    await attendre(() =>
      recus.some((m) => m.type === 'error' && String(m.message).includes('inconnu du hub')),
    );
  });
});

describe('DE BOUT EN BOUT — un VRAI nœud clone, relit le dépôt, et lance', () => {
  // ─── POURQUOI CE BLOC EXISTE EN PLUS DES AUTRES ────────────────────────────
  //
  // Les tests ci-dessus montent un WebSocket nu : ils prouvent que le hub
  // ENVOIE le bon message. Ils ne prouvent rien de ce que le nœud en fait — et
  // c'est précisément là que vit la garde qui compte, celle qui relit le
  // `package.json` du clone.
  //
  // Ici, c'est un `HiveNodeClient` réel. Il se connecte, reçoit, clone un vrai
  // dépôt git, relit son `package.json`, compose l'argv et lance `npm run`.
  //
  // ─── CE QUE LE DÉPÔT DE CE TEST DÉCLARE, ET POURQUOI ───────────────────────
  //
  // Un `test` qui rend 0 et un `lint` qui rend 1. Les deux comptent : sans le
  // second, un nœud qui rapporterait TOUJOURS `ok: true` passerait — et « les
  // vérifications du projet réussissent toujours » est le pire mensonge qu'on
  // puisse livrer.

  let dir: string | null = null;
  let origine: string | null = null;
  let server: HiveServer | null = null;
  let client: HiveNodeClient | null = null;

  afterEach(async () => {
    await client?.stop();
    client = null;
    await server?.stop();
    server = null;
    for (const d of [dir, origine]) {
      if (d) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    }
    dir = null;
    origine = null;
  });

  async function depotQuiTourne(): Promise<string> {
    const { simpleGit } = await import('simple-git');
    origine = mkdtempSync(path.join(os.tmpdir(), 'hive-depot-reel-'));
    writeFileSync(
      path.join(origine, 'package.json'),
      JSON.stringify({
        name: 'depot-reel',
        scripts: {
          // `process.exit` explicite : on veut un code de sortie, pas la
          // chance d'un interpréteur.
          test: 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(1)"',
        },
      }),
    );
    const g = simpleGit({ baseDir: origine });
    await g.init();
    await g.addConfig('user.email', 't@example.com');
    await g.addConfig('user.name', 'T');
    // Même leçon que `merge-wiring` : `commit.gpgsign` global rendait onze
    // fichiers rouges chez qui signe ses commits.
    await g.addConfig('commit.gpgsign', 'false');
    await g.add('.');
    await g.commit('initial');
    return origine;
  }

  async function tout(): Promise<{ srv: HiveServer; depot: string }> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-bout-'));
    mkdirSync(path.join(dir, 'data', 'cerveau'), { recursive: true });
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'data', 'hive.db'),
      simulation: false,
      tickMs: 60,
    });
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'ouvriere-chantier',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter: {
        name: 'noop',
        async run() {
          return { success: true, diff: '', logs: '', subAgents: [] };
        },
      },
      quiet: true,
    });
    await client.start();
    const depot = await depotQuiTourne();
    // Attendre que le hub voie le nœud en ligne.
    const fin = Date.now() + 10_000;
    while (Date.now() < fin && server.store.listNodes().every((n) => n.status !== 'online')) {
      await new Promise((r) => setTimeout(r, 25));
    }
    return { srv: server, depot };
  }

  /** Interroge `/chantiers/result` jusqu'à ce qu'un verdict arrive. */
  async function verdict(
    srv: HiveServer,
    projectId: string,
    msMax = 120_000,
  ): Promise<{ nom: string; ok: boolean; code: number | null; sortie: string }> {
    const fin = Date.now() + msMax;
    while (Date.now() < fin) {
      const rep = await fetch(
        `http://127.0.0.1:${srv.port}/api/projects/${projectId}/chantiers/result`,
        { headers: { 'x-hive-token': TOKEN } },
      );
      const { resultat } = (await rep.json()) as {
        resultat: { nom: string; ok: boolean; code: number | null; sortie: string } | null;
      };
      if (resultat) return resultat;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('aucun verdict de chantier');
  }

  it('UN CHANTIER QUI RÉUSSIT REMONTE ok:true', { timeout: 180_000 }, async () => {
    const { srv, depot } = await tout();
    const projet = srv.store.createProject({ name: 'P', repoUrl: depot });

    const rep = await fetch(
      `http://127.0.0.1:${srv.port}/api/projects/${projet.id}/chantiers/test/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
        body: '{}',
      },
    );
    expect(rep.status, await rep.clone().text()).toBe(202);

    const v = await verdict(srv, projet.id);
    expect(v.nom).toBe('test');
    expect(v.code, v.sortie).toBe(0);
    expect(v.ok).toBe(true);
  });

  it('UN CHANTIER QUI ÉCHOUE REMONTE ok:false', { timeout: 180_000 }, async () => {
    // Sans ce test, un nœud qui rapporterait toujours « ça marche » passerait —
    // et une ruche qui dit toujours vert ne sert à rien.
    const { srv, depot } = await tout();
    const projet = srv.store.createProject({ name: 'P', repoUrl: depot });

    await fetch(`http://127.0.0.1:${srv.port}/api/projects/${projet.id}/chantiers/lint/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: '{}',
    });

    const v = await verdict(srv, projet.id);
    expect(v.nom).toBe('lint');
    expect(v.ok).toBe(false);
    // ─── POURQUOI `toBe(1)` ET PAS `not.toBe(0)` ────────────────────────────
    //
    // Première version : `expect(v.code).not.toBe(0)`. Elle est satisfaite par
    // `code: null` — c'est-à-dire par un nœud qui n'a RIEN lancé (clone
    // impossible, `npm` introuvable). Le test aurait été vert en prouvant le
    // contraire de ce qu'il annonce.
    //
    // 1 est le code que le dépôt déclare : `node -e "process.exit(1)"`. Exiger
    // ce chiffre-là exige que le processus ait vraiment tourné.
    expect(v.code, v.sortie).toBe(1);
  });
});

describe('UN HUB COMPROMIS NE PEUT DÉSIGNER QUE CE QUE LE DÉPÔT DÉCLARE', () => {
  // ─── POURQUOI CE BLOC EXISTE, ET CE QUE LA LOUPE A RÉVÉLÉ ──────────────────
  //
  // Le nœud REJUGE le chantier sur le `package.json` du clone qu'il vient de
  // faire. C'est la garde la plus importante de toute la pièce — et la loupe a
  // montré qu'aucun test ne la touchait : la retirer laissait 15 tests verts.
  //
  // La raison est structurelle : le hub refuse déjà tout ce qui est mauvais, si
  // bien qu'un nœud branché sur un VRAI hub ne voit jamais passer une demande
  // hostile. Pour exercer sa garde, il faut donc un hub qui ne l'est pas.
  //
  // D'où ce faux hub. Ce n'est pas une simulation de confort : c'est la seule
  // façon de reproduire la situation contre laquelle la garde existe — jeton de
  // ruche partagé, vieille invitation qui le porte en clair, `ws://` de réseau
  // local. « Le hub propose un nom, le DÉPÔT décide de ce qu'il exécute. »

  let dir: string | null = null;
  let origine: string | null = null;
  let hub: WebSocketServer | null = null;
  let client: HiveNodeClient | null = null;

  afterEach(async () => {
    await client?.stop();
    client = null;
    await new Promise<void>((r) => (hub ? hub.close(() => r()) : r()));
    hub = null;
    for (const d of [dir, origine]) {
      if (d) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    }
    dir = null;
    origine = null;
  });

  /** Un dépôt qui déclare `typecheck` (vérification) et `publish` (sortant). */
  async function depot(): Promise<string> {
    const { simpleGit } = await import('simple-git');
    origine = mkdtempSync(path.join(os.tmpdir(), 'hive-hostile-'));
    writeFileSync(
      path.join(origine, 'package.json'),
      JSON.stringify({
        name: 'cible',
        scripts: {
          typecheck: 'node -e "process.exit(0)"',
          publish: 'node -e "process.exit(0)"',
        },
      }),
    );
    const g = simpleGit({ baseDir: origine });
    await g.init();
    await g.addConfig('user.email', 't@example.com');
    await g.addConfig('user.name', 'T');
    await g.addConfig('commit.gpgsign', 'false');
    await g.add('.');
    await g.commit('initial');
    return origine;
  }

  /**
   * Un hub qui envoie ce qu'un vrai hub refuserait d'envoyer.
   *
   * Rend les messages que le NŒUD lui renvoie — c'est là qu'on lit son verdict.
   */
  async function hubHostile(nom: string): Promise<Record<string, unknown>[]> {
    const recus: Record<string, unknown>[] = [];
    const repoUrl = await depot();
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-hostile-work-'));

    hub = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => hub!.once('listening', () => r()));
    const port = (hub.address() as { port: number }).port;

    hub.on('connection', (ws) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as { type: string };
        recus.push(m as Record<string, unknown>);
        if (m.type === 'register') {
          ws.send(JSON.stringify({ type: 'registered', nodeId: 'faux' }));
          // LA DEMANDE QU'UN VRAI HUB NE FERAIT JAMAIS.
          ws.send(
            JSON.stringify({ type: 'assign_chantier', chantierId: 'hostile1', repoUrl, nom }),
          );
        }
      });
    });

    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${port}`,
      token: TOKEN,
      name: 'cible',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter: {
        name: 'noop',
        async run() {
          return { success: true, diff: '', logs: '', subAgents: [] };
        },
      },
      quiet: true,
    });
    await client.start();
    return recus;
  }

  async function verdictDuNoeud(
    recus: Record<string, unknown>[],
    msMax = 120_000,
  ): Promise<Record<string, unknown>> {
    const fin = Date.now() + msMax;
    while (Date.now() < fin) {
      const r = recus.find((m) => m.type === 'chantier_result');
      if (r) return r;
      await new Promise((r2) => setTimeout(r2, 50));
    }
    throw new Error('le nœud n’a rendu aucun verdict');
  }

  it(
    'UN NOM QUE LE DÉPÔT NE DÉCLARE PAS EST REFUSÉ PAR LE NŒUD',
    { timeout: 180_000 },
    async () => {
      const recus = await hubHostile('deploy-prod');
      const v = await verdictDuNoeud(recus);
      expect(v.ok).toBe(false);
      expect(v.refused, 'le refus doit être NOMMÉ, pas un code de sortie').toBe(
        'chantier non déclaré',
      );
      expect(String(v.sortie)).toMatch(/n’invente pas de commande/);
    },
  );

  it('UN SORTANT DÉCLARÉ EST REFUSÉ PAR LE NŒUD AUSSI', { timeout: 180_000 }, async () => {
    // `publish` EST dans le `package.json`. Le hub le refuse déjà ; le nœud le
    // refuse À NOUVEAU, parce qu'il ne tient pas le hub pour acquis.
    const recus = await hubHostile('publish');
    const v = await verdictDuNoeud(recus);
    expect(v.ok).toBe(false);
    expect(v.refused).toBe('chantier non déclaré');
    expect(String(v.sortie)).toMatch(/irréversibles|humain/);
  });

  it('HORS HEURES DE SERVICE, LE NŒUD REFUSE — sans cloner', { timeout: 180_000 }, async () => {
    // ─── UN CHANTIER EST DU TRAVAIL ────────────────────────────────────────
    //
    // Night Shift borne les heures pendant lesquelles un membre prête sa
    // machine. Un chantier clone un dépôt et y lance une commande : c'est du
    // travail au même titre qu'une tâche ou qu'un merge, et il doit se refuser
    // pareil. La loupe l'a demandé — sans ce test, retirer le refus laissait
    // tout vert.
    //
    // ─── LA FENÊTRE ÉTAIT UN PARI, ET IL A ÉTÉ PERDU ───────────────────────
    //
    // Elle était posée à `00:00-00:01` : hors service quelle que soit l'heure,
    // « sauf une minute par jour ». Le commentaire l'assumait — mieux vaut le
    // dire que faire semblant d'être déterministe. Dans la nuit du 12 au
    // 13 août, la CI a démarré à 23:59:59 : macOS ET Windows ont rougi
    // ensemble sur cette minute-là, dans une PR qui ne touchait à rien de tout
    // cela.
    //
    // Il y avait pourtant une troisième voie, ni pari ni faux-semblant :
    // CALCULER une fenêtre qui ne peut pas contenir l'instant présent. Trente
    // minutes plus tard, une minute de large — le nœud est hors service par
    // CONSTRUCTION, sur les vingt-quatre heures, et le banc ne mesure plus
    // l'heure qu'il est.
    //
    // La prémisse est ÉNONCÉE plutôt que supposée : `isOnShift` est la
    // fonction que le nœud consulte lui-même, et on lui demande de confirmer
    // qu'avec cette fenêtre, maintenant, il n'est pas de service. Si un jour
    // ce n'est plus vrai, le banc dit « prémisse » au lieu d'échouer ailleurs.
    const maintenant = new Date();
    const fenetre = fenetreSansService(maintenant);
    expect(
      isOnShift(nightShiftFromEnv({ HIVE_SHIFT: fenetre }), maintenant),
      `prémisse : avec « ${fenetre} », le nœud ne doit pas être de service`,
    ).toBe(false);

    const avant = process.env.HIVE_SHIFT;
    process.env.HIVE_SHIFT = fenetre;
    try {
      const recus = await hubHostile('typecheck');
      const v = await verdictDuNoeud(recus);
      expect(v.ok).toBe(false);
      expect(String(v.refused)).toMatch(/service|shift|heures/i);
    } finally {
      if (avant === undefined) delete process.env.HIVE_SHIFT;
      else process.env.HIVE_SHIFT = avant;
    }
  });

  it('…ET CE QUE LE DÉPÔT DÉCLARE VRAIMENT PASSE', { timeout: 180_000 }, async () => {
    // ─── L'AUTRE MOITIÉ, SANS LAQUELLE LA GARDE SERAIT UN MUR ──────────────
    //
    // Un nœud qui refuserait TOUT satisferait les deux tests ci-dessus. Celui-ci
    // exige qu'il lise vraiment le `package.json` du clone : `typecheck` n'est
    // pas un nom que le nœud pourrait deviner.
    const recus = await hubHostile('typecheck');
    const v = await verdictDuNoeud(recus);
    expect(v.refused, v.sortie as string).toBeUndefined();
    expect(v.code, v.sortie as string).toBe(0);
    expect(v.ok).toBe(true);
  });
});

describe('LE PROTOCOLE — un chantier déclenche un clone et un `npm run` chez un membre', () => {
  // Ces messages sont aussi sensibles qu'`assign_merge` : ils font tourner du
  // code sur la machine de quelqu'un. La validation est la PREMIÈRE garde du
  // nœud, avant même qu'il regarde ce que le hub lui veut.

  const base = {
    type: 'assign_chantier',
    chantierId: 'abc123',
    repoUrl: 'https://github.com/o/r.git',
    nom: 'test',
  };

  it('UN NOM QUI N’EN EST PAS UN EST REFUSÉ', () => {
    for (const nom of [
      '',
      '--force',
      'a b',
      'a\nb',
      'a'.repeat(200),
      '../../etc/passwd',
      42,
      null,
    ]) {
      expect(parseServerMessage(JSON.stringify({ ...base, nom })), JSON.stringify(nom)).toBeNull();
    }
  });

  it('…et un nom démesuré aussi — la borne EST la garde', () => {
    // Mutant survivant de la loupe : sans la borne de longueur, un nom de
    // 200 caractères passait. Il ne peut rien exécuter (le dépôt ne le déclare
    // pas), mais il traverse un événement, un écran et un journal.
    expect(nomDeChantierValide('a'.repeat(100))).toBe(true);
    expect(nomDeChantierValide('a'.repeat(101))).toBe(false);
  });

  it('UN repoUrl QUI N’EST PAS UN TRANSPORT SÛR EST REFUSÉ', () => {
    // Le nœud va CLONER ceci. `file:///` et `ext::` sont des vecteurs connus.
    for (const repoUrl of ['', 'ext::sh -c whoami', 'file:///etc', 'not a url', 42]) {
      expect(
        parseServerMessage(JSON.stringify({ ...base, repoUrl })),
        JSON.stringify(repoUrl),
      ).toBeNull();
    }
  });

  it('un chantier bien formé passe, et rien ne s’y ajoute', () => {
    const m = parseServerMessage(JSON.stringify({ ...base, inattendu: 'x' }));
    expect(m).toEqual({
      type: 'assign_chantier',
      chantierId: 'abc123',
      repoUrl: 'https://github.com/o/r.git',
      nom: 'test',
    });
  });

  it('LE RÉSULTAT QUI REMONTE EST VALIDÉ AUSSI', () => {
    const bon = {
      type: 'chantier_result',
      chantierId: 'abc123',
      nom: 'test',
      code: 0,
      sortie: 'ok',
      ok: true,
    };
    expect(parseClientMessage(JSON.stringify(bon))).toMatchObject({ nom: 'test', ok: true });
    // Un nom hostile remonte tout autant : il repart vers un écran.
    expect(parseClientMessage(JSON.stringify({ ...bon, nom: 'a\nb' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...bon, code: 1.5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...bon, ok: 'oui' }))).toBeNull();
    // `code: null` est légitime : le processus n'a jamais démarré.
    expect(parseClientMessage(JSON.stringify({ ...bon, code: null }))).toMatchObject({
      code: null,
    });
  });
});
