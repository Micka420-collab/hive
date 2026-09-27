// Le verrou de la Reine : UNE seule Reine par base.
//
// ─── DEUX ÉTAGES, TOUS DEUX RÉELS ───────────────────────────────────────────
//
//   1. la PRISE, sur un vrai disque, contre de VRAIS processus : le verrou est
//      tenu par le système, et c'est un autre processus qui le constate — un
//      verrou fcntl ne se simule pas honnêtement dans le processus qui le tient ;
//   2. la REINE : une seconde `createServer` sur la même base est refusée
//      AVANT d'avoir touché aux travaux en vol de la première. C'est le
//      défaut que le verrou existe pour empêcher — rejoué, pas supposé.
//
// ─── UNE RÈGLE POUR CE FICHIER ──────────────────────────────────────────────
//
// Le verrou ne se lit jamais par `fs` tant qu'il est tenu dans CE processus :
// sous POSIX, fermer un descripteur du fichier rendrait le verrou (cf. l'en-tête
// de verrou-reine.ts). On le lit par SQLite, ou depuis un autre processus.

import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as serveurTcp } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { ServerConfig } from '../src/orchestrator/server.js';
import { cheminVerrouReine, prendreVerrouReine } from '../src/orchestrator/verrou-reine.js';
import type { TenantVerrou } from '../src/orchestrator/verrou-reine.js';
import { empreinte } from '../src/shared/empreinte.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/**
 * Ce qu'un AUTRE processus constate du verrou : `libre`, ou le code SQLite
 * de son refus. C'est le seul témoin qui compte — le système tient un verrou
 * pour un processus, et ce processus-ci ne peut pas se le refuser à lui-même.
 */
function sonder(chemin: string): string {
  return execFileSync(
    process.execPath,
    [
      '-e',
      `const Database = require('better-sqlite3');
       const db = new Database(process.argv[1], { timeout: 0 });
       try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); console.log('libre'); }
       catch (e) { console.log(e.code); }
       finally { db.close(); }`,
      chemin,
    ],
    { cwd: RACINE, encoding: 'utf8' },
  ).trim();
}

/** L'inscription du verrou, lue par SQLite (jamais par `fs`, cf. l'en-tête). */
function inscription(chemin: string): TenantVerrou | undefined {
  const db = new Database(chemin, { readonly: true });
  try {
    return db.prepare('SELECT pid, hote, depuis FROM tenant').get() as TenantVerrou | undefined;
  } finally {
    db.close();
  }
}

/** Laisse une inscription comme la laisserait une Reine tuée net : écrite, et plus tenue. */
function laisserInscription(chemin: string, tenant: TenantVerrou): void {
  mkdirSync(path.dirname(chemin), { recursive: true });
  const db = new Database(chemin);
  try {
    db.exec(
      'CREATE TABLE tenant (pid INTEGER NOT NULL, hote TEXT NOT NULL, depuis TEXT NOT NULL, jeton TEXT NOT NULL)',
    );
    db.prepare('INSERT INTO tenant VALUES (?, ?, ?, ?)').run(
      tenant.pid,
      tenant.hote,
      tenant.depuis,
      'jeton-d-une-reine-morte',
    );
  } finally {
    db.close();
  }
}

describe('le verrou, tenu par le système — sur un vrai disque', () => {
  let dir: string;
  let dbPath: string;
  let chemin: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-verrou-reine-'));
    // Un dossier qui n'existe pas encore : c'est le premier démarrage, et le
    // verrou est pris AVANT que le store ne crée le dossier.
    dbPath = path.join(dir, 'data', 'hive.db');
    chemin = cheminVerrouReine(dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('pose le verrou À CÔTÉ de la base, s’y inscrit, et le rend sans supprimer le fichier', () => {
    const verrou = prendreVerrouReine(dbPath);
    expect(verrou?.chemin).toBe(`${path.resolve(dbPath)}.reine.lock`);
    expect(verrou?.precedente).toBeNull();
    expect(inscription(chemin)).toMatchObject({ pid: process.pid, hote: os.hostname() });
    expect(sonder(chemin), 'un autre processus doit trouver la base tenue').toBe('SQLITE_BUSY');

    verrou?.liberer();
    expect(sonder(chemin), 'rendu à l’arrêt').toBe('libre');
    // Le fichier RESTE : le supprimer ouvrirait la porte à deux Reines (une
    // sur l'ancien fichier, une sur le neuf). Un arrêt propre n'y laisse aucun nom.
    expect(existsSync(chemin)).toBe(true);
    expect(inscription(chemin)).toBeUndefined();

    // Idempotent : un second `liberer` ne lève pas, et la base se reprend.
    verrou?.liberer();
    const encore = prendreVerrouReine(dbPath);
    expect(encore?.precedente, 'un arrêt propre n’est pas un arrêt brutal').toBeNull();
    encore?.liberer();
  });

  it('deux Reines dans CE processus : la seconde est refusée, et son refus ne lâche pas la première', () => {
    const premiere = prendreVerrouReine(dbPath);
    expect(() => prendreVerrouReine(dbPath)).toThrow(
      new RegExp(`Une autre Reine tient déjà cette base \\(pid ${process.pid} `),
    );
    // La seconde a ouvert puis fermé sa connexion au MÊME fichier. Sous POSIX,
    // une fermeture mal faite rendrait le verrou de la première : un autre
    // processus doit encore la trouver tenue.
    expect(sonder(chemin)).toBe('SQLITE_BUSY');
    premiere?.liberer();
    expect(sonder(chemin)).toBe('libre');
  });

  it('un processus VIVANT tient la base ; tué net, le système rend son verrou', async () => {
    // Une vraie Reine d'un autre processus : elle prend le verrou par le vrai
    // module, puis vit. Rien ici ne regarde une horloge, un nom d'hôte ou un
    // pid pour décider — un recalage d'horloge ne peut donc pas la déloger.
    //
    // Elle ne GARDE pas l'objet rendu, et force un ramasse-miettes : better-
    // sqlite3 ferme une connexion collectée, et le verrou doit tenir quand même
    // — c'est au module de la retenir, pas à chaque appelant d'y penser.
    const script = path.join(dir, 'tenir.mjs');
    writeFileSync(
      script,
      `import { prendreVerrouReine } from ${JSON.stringify(
        pathToFileURL(path.join(RACINE, 'src', 'orchestrator', 'verrou-reine.ts')).href,
      )};
       prendreVerrouReine(process.argv[2]);
       globalThis.gc();
       process.stdout.write('tenu\\n');
       setInterval(() => {}, 60_000);`,
    );
    const autre: ChildProcess = spawn(
      process.execPath,
      ['--expose-gc', '--import', 'tsx', script, dbPath],
      {
        cwd: RACINE,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    try {
      let sortie = '';
      autre.stdout?.setEncoding('utf8');
      autre.stdout?.on('data', (morceau: string) => (sortie += morceau));
      const fin = Date.now() + 15_000;
      while (!sortie.includes('tenu') && Date.now() < fin && autre.exitCode === null) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(sortie, 'l’autre Reine n’a pas pris le verrou').toContain('tenu');

      let refus = '';
      try {
        prendreVerrouReine(dbPath);
      } catch (err) {
        refus = (err as Error).message;
      }
      expect(refus).toMatch(/Une autre Reine tient déjà cette base/);
      // Le message NOMME le processus et la base : l'humain sait quoi arrêter.
      expect(refus).toContain(`pid ${autre.pid as number}`);
      expect(refus).toContain(dbPath);
    } finally {
      autre.kill('SIGKILL');
      if (autre.exitCode === null && autre.signalCode === null) await once(autre, 'exit');
    }

    // Tuée sans rien rendre — exactement l'arrêt brutal d'une Reine. Personne
    // n'a effacé son nom ; c'est le système qui a rendu son verrou.
    const verrou = prendreVerrouReine(dbPath);
    expect(verrou?.precedente?.pid).toBe(autre.pid);
    expect(inscription(chemin)?.pid).toBe(process.pid);
    verrou?.liberer();
  }, 30_000);

  // ─── CE QU'UN FICHIER DE PID « PÉRIMÉ SI… » REFUSAIT À TORT ────────────────
  //
  // Une inscription restée derrière une Reine morte se reprend TOUJOURS : ce
  // qu'elle dit de l'hôte ou du pid ne décide de rien, puisque personne ne
  // tient plus le verrou.
  it.each<{ nom: string; tenant: () => TenantVerrou }>([
    {
      // Docker : le nom d'hôte est l'id du conteneur, et la Reine y est pid 1.
      // Recréé après un `kill`, le conteneur ne porte plus le même nom — le
      // verrou jugé « d'une autre machine » refusait à chaque redémarrage.
      nom: 'un conteneur recréé : autre nom d’hôte, pid 1',
      tenant: () => ({ pid: 1, hote: 'b7c1e04f9a2d', depuis: '2026-09-27T00:00:00.000Z' }),
    },
    {
      // Windows recycle vite un pid mort : un pid VIVANT ne prouve rien.
      nom: 'un pid recyclé, vivant aujourd’hui',
      tenant: () => ({
        pid: process.ppid,
        hote: os.hostname(),
        depuis: '2026-09-27T00:00:00.000Z',
      }),
    },
  ])('une Reine morte laisse la base reprenable — $nom', ({ tenant }) => {
    const laisse = tenant();
    laisserInscription(chemin, laisse);
    const verrou = prendreVerrouReine(dbPath);
    expect(verrou?.precedente).toEqual(laisse);
    verrou?.liberer();
  });

  it('refuse un fichier qui n’est pas un verrou de Reine, sans y toucher', () => {
    mkdirSync(path.dirname(chemin), { recursive: true });
    const brut = 'ceci n’est pas un verrou';
    writeFileSync(chemin, brut);
    expect(() => prendreVerrouReine(dbPath)).toThrow(/Le verrou de Reine est illisible/);
    // Aucune connexion ne reste ouverte : le relire par `fs` ne rend rien à personne.
    expect(readFileSync(chemin, 'utf8')).toBe(brut);
  });

  it('`:memory:` n’a rien à partager : pas de verrou', () => {
    expect(prendreVerrouReine(':memory:')).toBeNull();
  });

  it('le verrou vit là où l’empreinte le déclare — donc là où `hive desinstaller` le montre', () => {
    const base = empreinte({
      racine: dir,
      dbPath: path.resolve(dbPath),
      workdir: path.join(dir, '.hive-work'),
      tmpdir: os.tmpdir(),
      home: path.join(dir, 'maison'),
      plateforme: process.platform,
    }).find((e) => e.cle === 'base');
    expect((base?.contenu ?? []).map((c) => c.chemin)).toContain(cheminVerrouReine(dbPath));
  });
});

describe('la Reine : une seconde sur la même base est refusée', () => {
  let dir: string;
  let dbPath: string;
  const config = (port = 0): ServerConfig => ({
    port,
    host: '127.0.0.1',
    token: 'jeton-verrou-suffisamment-long',
    corsOrigins: ['http://localhost:5173'],
    dbPath,
    envPath: path.join(dir, '.env'),
    simulation: true,
    // Aucun tick pendant le test : seule la seconde Reine pourrait toucher
    // aux travaux en vol, et c'est précisément ce qu'on observe.
    tickMs: 60_000,
  });

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-verrou-serveur-'));
    dbPath = path.join(dir, 'hive.db');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('refusée AVANT d’avoir requalifié les travaux en vol de la première', async () => {
    const premiere = await createServer(config());
    try {
      const store = premiere.store;
      const projet = store.createProject({ name: 'P' });
      const noeud = store.registerNode({
        name: 'n1',
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
      });
      store.setNodeStatus(noeud.id, 'online');
      store.touchNode(noeud.id);
      const tache = store.createTask({ projectId: projet.id, title: 'en vol', prompt: 'p' });
      store.patchTask(tache.id, { status: 'running', assignedNodeId: noeud.id });

      await expect(createServer(config())).rejects.toThrow(/Une autre Reine tient déjà cette base/);

      // Sans verrou, la seconde démarrait : son `recoverAtBoot` repassait la
      // tâche en `ready` (elle serait repartie sur un autre nœud) et le nœud
      // vivant en `offline`.
      expect(store.getTask(tache.id)).toMatchObject({
        status: 'running',
        assignedNodeId: noeud.id,
      });
      expect(store.getNode(noeud.id)?.status).toBe('online');
    } finally {
      await premiere.stop();
    }

    // Arrêtée, elle a rendu le verrou sans y laisser son nom : la suivante
    // démarre, et c'est ELLE, seule, qui requalifie ce qui était en vol.
    expect(sonder(cheminVerrouReine(dbPath))).toBe('libre');
    expect(inscription(cheminVerrouReine(dbPath))).toBeUndefined();
    const suivante = await createServer(config());
    try {
      expect(suivante.store.tasksByStatus('ready')).toHaveLength(1);
    } finally {
      await suivante.stop();
    }
  });

  it('après une Reine tuée net, la suivante démarre seule — et le DIT', async () => {
    laisserInscription(cheminVerrouReine(dbPath), {
      pid: 1,
      hote: 'b7c1e04f9a2d',
      depuis: '2026-09-27T00:00:00.000Z',
    });
    const avertissements = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reine = await createServer(config());
    await reine.stop();
    expect(avertissements.mock.calls.map((appel) => String(appel[0])).join('\n')).toMatch(
      /Reine précédente \(pid 1 sur « b7c1e04f9a2d »[^)]*\) s’est arrêtée sans rendre la base/,
    );
  });

  it('un démarrage RATÉ referme la base et rend le verrou', async () => {
    const occupant = serveurTcp();
    await new Promise<void>((ok) => occupant.listen(0, '127.0.0.1', ok));
    try {
      const { port } = occupant.address() as { port: number };
      await expect(createServer(config(port))).rejects.toThrow(/EADDRINUSE/);
      // Gardé, le verrou tiendrait la base au nom d'un démarrage mort.
      expect(sonder(cheminVerrouReine(dbPath)), 'verrou gardé par un démarrage raté').toBe('libre');
      // SQLite efface le `-wal` quand la DERNIÈRE connexion se ferme : sa
      // présence ici dit qu'un démarrage mort garde la base ouverte — et sous
      // Windows, le dossier ne se supprimerait plus.
      expect(existsSync(`${dbPath}-wal`), 'la base est restée ouverte').toBe(false);
    } finally {
      await new Promise<void>((ok) => occupant.close(() => ok()));
    }
    const reprise = await createServer(config());
    await reprise.stop();
  });
});
