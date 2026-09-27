// Le verrou de la Reine : UNE seule Reine par base.
//
// ─── TROIS ÉTAGES, DU PLUS PUR AU PLUS RÉEL ─────────────────────────────────
//
//   1. le JUGEMENT, pur : un contenu de verrou et les faits d'ici donnent
//      « tenu », « périmé » (et pourquoi), « ailleurs » ou « illisible » ;
//   2. la PRISE, sur un vrai disque et contre un VRAI processus vivant puis
//      mort — `process.kill(pid, 0)` ne se simule pas honnêtement ;
//   3. la REINE : une seconde `createServer` sur la même base est refusée
//      AVANT d'avoir touché aux travaux en vol de la première. C'est le
//      défaut que le verrou existe pour empêcher — rejoué, pas supposé.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as serveurTcp } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { ServerConfig } from '../src/orchestrator/server.js';
import {
  cheminVerrouReine,
  demarrageDuSysteme,
  jugerVerrou,
  prendreVerrouReine,
} from '../src/orchestrator/verrou-reine.js';
import type { FaitsIci, JugementVerrou } from '../src/orchestrator/verrou-reine.js';
import { empreinte } from '../src/shared/empreinte.js';

describe('le jugement d’un verrou — pur', () => {
  // Deux `boot_id` Linux : seule cette forme vaut preuve d'un redémarrage.
  const BOOT_ACTUEL = '8b1f1c2e-5d3a-4c6b-9e7f-0a1b2c3d4e5f';
  const BOOT_PRECEDENT = '3c9d2e1f-7a6b-4d5c-8e9f-1a2b3c4d5e6f';
  const ICI: FaitsIci = {
    pid: 4242,
    ppid: 4200,
    hote: 'ruche-ici',
    demarrage: BOOT_ACTUEL,
    vivant: () => true,
  };
  const verrou = (champs: Record<string, unknown>): string =>
    JSON.stringify({
      pid: 777,
      hote: 'ruche-ici',
      demarrage: BOOT_ACTUEL,
      depuis: '2026-09-27T00:00:00.000Z',
      ...champs,
    });
  const genre = (j: JugementVerrou): string =>
    j.genre === 'perime' ? `perime:${j.raison}` : j.genre;

  const CAS: {
    nom: string;
    brut: string;
    ici?: Partial<FaitsIci>;
    tenuIci?: boolean;
    attendu: string;
  }[] = [
    { nom: 'un pid vivant, ici, depuis ce démarrage', brut: verrou({}), attendu: 'tenu' },
    {
      nom: 'un pid qui ne répond plus',
      brut: verrou({}),
      ici: { vivant: () => false },
      attendu: 'perime:processus-mort',
    },
    {
      // Deux boot_id Linux différents : aucun processus d'alors ne vit, même
      // si un autre porte aujourd'hui ce numéro.
      nom: 'le système a redémarré — même si le pid répond',
      brut: verrou({ demarrage: BOOT_PRECEDENT }),
      attendu: 'perime:systeme-redemarre',
    },
    {
      nom: 'notre propre pid, sans que ce processus tienne le verrou',
      brut: verrou({ pid: 4242 }),
      attendu: 'perime:meme-pid',
    },
    {
      nom: 'notre propre pid, et ce processus TIENT le verrou : deux Reines ici',
      brut: verrou({ pid: 4242 }),
      tenuIci: true,
      attendu: 'tenu',
    },
    { nom: 'le pid de notre parent', brut: verrou({ pid: 4200 }), attendu: 'perime:pid-parent' },
    {
      // Rien ne s'y vérifie : un pid mort ICI ne dit rien de LÀ-BAS.
      nom: 'un autre hôte, même avec un pid mort ici',
      brut: verrou({ hote: 'une-autre-machine' }),
      ici: { vivant: () => false },
      attendu: 'ailleurs',
    },
    {
      nom: 'démarrages approchés à une minute : le même',
      brut: verrou({ demarrage: '~1000060000' }),
      ici: { demarrage: '~1000000000' },
      attendu: 'tenu',
    },
    {
      nom: 'démarrages approchés à une heure : redémarré',
      brut: verrou({ demarrage: '~1003600000' }),
      ici: { demarrage: '~1000000000' },
      attendu: 'perime:systeme-redemarre',
    },
    {
      // Le doute ne fait JAMAIS reprendre : il rend la main au test du pid.
      nom: 'démarrage approché illisible : dans le doute, le même',
      brut: verrou({ demarrage: '~abc' }),
      ici: { demarrage: '~1000000000' },
      attendu: 'tenu',
    },
    {
      // Une valeur qui n'a pas la forme d'un `boot_id` ne prouve rien.
      nom: 'démarrage exact abîmé : dans le doute, le même',
      brut: verrou({ demarrage: 'pas-un-boot-id' }),
      attendu: 'tenu',
    },
    {
      nom: 'un exact contre un approché : dans le doute, le même',
      brut: verrou({ demarrage: BOOT_ACTUEL }),
      ici: { demarrage: '~1000000000' },
      attendu: 'tenu',
    },
    { nom: 'pas du JSON', brut: '{"pid": 7', attendu: 'illisible' },
    {
      // `process.kill(0, 0)` viserait le GROUPE : un pid 0 « répondrait » à jamais.
      nom: 'pid 0',
      brut: verrou({ pid: 0 }),
      attendu: 'illisible',
    },
    { nom: 'pid négatif', brut: verrou({ pid: -1 }), attendu: 'illisible' },
    { nom: 'pid non entier', brut: verrou({ pid: 7.5 }), attendu: 'illisible' },
    { nom: 'pid en chaîne', brut: verrou({ pid: '777' }), attendu: 'illisible' },
    { nom: 'hôte absent', brut: verrou({ hote: undefined }), attendu: 'illisible' },
    { nom: 'un tableau', brut: '[777]', attendu: 'illisible' },
  ];

  it.each(CAS)('$nom → $attendu', ({ brut, ici, tenuIci, attendu }) => {
    expect(genre(jugerVerrou(brut, { ...ICI, ...ici }, tenuIci ?? false))).toBe(attendu);
  });
});

describe('la prise du verrou — sur un vrai disque', () => {
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
    rmSync(dir, { recursive: true, force: true });
  });

  /** Un verrou « de cette machine, depuis ce démarrage », au pid choisi. */
  const poser = (champs: Record<string, unknown>): string => {
    const brut = JSON.stringify({
      pid: 777,
      hote: os.hostname(),
      demarrage: demarrageDuSysteme(),
      depuis: '2026-09-27T00:00:00.000Z',
      ...champs,
    });
    mkdirSync(path.dirname(chemin), { recursive: true });
    writeFileSync(chemin, brut);
    return brut;
  };

  it('pose le verrou À CÔTÉ de la base, et le rend', () => {
    const verrou = prendreVerrouReine(dbPath);
    expect(verrou?.chemin).toBe(`${path.resolve(dbPath)}.reine.lock`);
    expect(verrou?.reprise).toBeNull();
    const lu = JSON.parse(readFileSync(chemin, 'utf8')) as { pid: number; hote: string };
    expect(lu.pid).toBe(process.pid);
    expect(lu.hote).toBe(os.hostname());

    verrou?.liberer();
    expect(existsSync(chemin), 'rendu à l’arrêt').toBe(false);
    // Idempotent : un second `liberer` ne lève pas, et la base se reprend.
    verrou?.liberer();
    const encore = prendreVerrouReine(dbPath);
    expect(encore).not.toBeNull();
    encore?.liberer();
  });

  it('deux Reines dans CE processus : la seconde est refusée', () => {
    const premiere = prendreVerrouReine(dbPath);
    const avant = readFileSync(chemin, 'utf8');
    expect(() => prendreVerrouReine(dbPath)).toThrow(/Une autre Reine tient déjà cette base/);
    expect(readFileSync(chemin, 'utf8'), 'le refus a touché au verrou').toBe(avant);
    premiere?.liberer();
  });

  it('un processus VIVANT tient la base ; mort, son verrou se reprend', async () => {
    const autre = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      await once(autre, 'spawn');
      const pid = autre.pid as number;
      const brut = poser({ pid });

      let refus = '';
      try {
        prendreVerrouReine(dbPath);
      } catch (err) {
        refus = (err as Error).message;
      }
      expect(refus).toMatch(/Une autre Reine tient déjà cette base/);
      expect(refus).toContain(`pid ${pid}`);
      // Le message dit QUOI supprimer si l'humain sait qu'aucune Reine ne tourne.
      expect(refus).toContain(chemin);
      expect(readFileSync(chemin, 'utf8'), 'un refus ne touche pas au verrou').toBe(brut);
    } finally {
      autre.kill('SIGKILL');
      if (autre.exitCode === null && autre.signalCode === null) await once(autre, 'exit');
    }

    // Tué sans rendre son verrou : exactement l'arrêt brutal d'une Reine.
    const verrou = prendreVerrouReine(dbPath);
    expect(verrou?.reprise?.raison).toBe('processus-mort');
    expect(verrou?.reprise?.tenant.pid).toBe(autre.pid);
    const lu = JSON.parse(readFileSync(chemin, 'utf8')) as { pid: number };
    expect(lu.pid).toBe(process.pid);
    verrou?.liberer();
  });

  it('notre propre pid, laissé par une incarnation précédente, se reprend', () => {
    // La Reine d'un conteneur relancé est de nouveau pid 1 : son ancien verrou
    // porte NOTRE numéro, et aucun processus vivant ne peut le partager.
    poser({ pid: process.pid });
    const verrou = prendreVerrouReine(dbPath);
    expect(verrou?.reprise?.raison).toBe('meme-pid');
    verrou?.liberer();
  });

  it('refuse un verrou illisible ou d’une autre machine, sans y toucher', () => {
    mkdirSync(path.dirname(chemin), { recursive: true });
    for (const [brut, motif] of [
      ['ceci n’est pas un verrou', /Verrou de Reine illisible/],
      [
        JSON.stringify({ pid: 777, hote: 'ailleurs', demarrage: 'x', depuis: 'y' }),
        /AUTRE machine/,
      ],
    ] as const) {
      writeFileSync(chemin, brut);
      expect(() => prendreVerrouReine(dbPath)).toThrow(motif);
      expect(readFileSync(chemin, 'utf8')).toBe(brut);
    }
  });

  it('ne supprime jamais un verrou qui n’est plus le sien', () => {
    const verrou = prendreVerrouReine(dbPath);
    // Un humain l'a effacé, une autre Reine a pris la place : ce n'est plus le nôtre.
    writeFileSync(chemin, 'le verrou d’une autre');
    verrou?.liberer();
    expect(readFileSync(chemin, 'utf8')).toBe('le verrou d’une autre');
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
    rmSync(dir, { recursive: true, force: true });
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

    // Arrêtée, elle a rendu le verrou : la suivante démarre, et c'est ELLE,
    // seule, qui requalifie ce qui était en vol.
    expect(existsSync(cheminVerrouReine(dbPath))).toBe(false);
    const suivante = await createServer(config());
    try {
      expect(suivante.store.tasksByStatus('ready')).toHaveLength(1);
    } finally {
      await suivante.stop();
    }
  });

  it('un démarrage RATÉ rend le verrou et referme la base', async () => {
    const occupant = serveurTcp();
    await new Promise<void>((ok) => occupant.listen(0, '127.0.0.1', ok));
    try {
      const { port } = occupant.address() as { port: number };
      await expect(createServer(config(port))).rejects.toThrow(/EADDRINUSE/);
      // Gardé, le verrou tiendrait la base au nom d'un démarrage mort.
      expect(existsSync(cheminVerrouReine(dbPath)), 'verrou laissé par un démarrage raté').toBe(
        false,
      );
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
