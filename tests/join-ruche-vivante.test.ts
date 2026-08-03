// `hive join` CONTRE UNE RUCHE VIVANTE — le chemin réussi, enfin mesuré.
//
// ─── CE QUE LES LOTS PRÉCÉDENTS NE POUVAIENT PAS DIRE ────────────────────────
//
// `tests/join-porte.test.ts` éprouve les trois refus précoces — tout ce qui se
// mesure SANS ruche. Le carnet portait le reste en toutes lettres : « le
// démarrage RÉUSSI (échange de billet accepté, clé mémorisée en 0600,
// WebSocket ouvert) demande une ruche vivante — territoire des tests e2e. »
// Ce fichier est ce territoire.
//
// La ruche est RÉELLE : `createServer` sur un port éphémère, une base dans un
// dossier jetable, un billet créé par la VRAIE route `POST /api/billets` — pas
// un billet bricolé qui dériverait du format serveur. Le nœud est réel aussi :
// le sous-processus `join.ts`, celui que l'ami lance.
//
// ─── LES TROIS ACTES, DANS L'ORDRE OÙ L'AMI LES VIT ──────────────────────────
//
//   1. Premier lancement : le billet s'échange contre une clé, la clé est
//      MÉMORISÉE (0600), le nœud apparaît côté ruche.
//   2. Redémarrage : la clé est relue, LE BILLET N'EST PAS REDEMANDÉ. C'est la
//      raison d'être de cette mémoire : un billet est à usage unique, et sans
//      elle le premier redémarrage mettrait l'ami dehors « en ayant tout fait
//      correctement » (docstring de `cheminCle`).
//   3. Le même billet sur une AUTRE machine : refusé — épuisé — avec la
//      marche à suivre. C'est le pendant serveur de l'acte 1.
//
// L'ordre est porteur : l'acte 2 n'a de sens qu'après l'acte 1, l'acte 3
// qu'après la consommation. Vitest exécute les `it` d'un fichier en séquence —
// ce fichier s'appuie dessus et le dit.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const JOIN = path.join(RACINE, 'src', 'node-client', 'join.ts');
const TSX = path.join(RACINE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const POSIX = process.platform !== 'win32';
const TOKEN = 'jeton-de-ruche-vivante-suffisamment-long';

interface Issue {
  code: number | null;
  sortie: string;
}

/**
 * Lance `join` et attend un MARQUEUR dans sa sortie, puis l'arrête.
 *
 * Un nœud démarré vit jusqu'au signal : sans marqueur atteint dans les 30 s,
 * on tue et on échoue avec la sortie en main. `attendreFin` couvre l'acte 3,
 * où le processus se termine tout seul — en refus.
 */
function lancerJoin(
  billet: string,
  workdir: string,
  opts: { marqueur?: string; attendreFin?: boolean } = {},
): Promise<Issue> {
  return new Promise((resoudre, rejeter) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
    env.HIVE_AGENT = 'shell';
    env.HIVE_WORKDIR = workdir;
    env.HIVE_ISOLEMENT = 'off';

    const proc = spawn(process.execPath, [TSX, JOIN, billet], {
      cwd: RACINE,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    let fini = false;
    const finir = (v: Issue | null, e?: Error): void => {
      if (fini) return;
      fini = true;
      if (e) rejeter(e);
      else resoudre(v as Issue);
    };
    const boucher = setTimeout(() => {
      proc.kill('SIGKILL');
      finir(null, new Error(`marqueur jamais atteint :\n${sortie}`));
    }, 30_000);
    boucher.unref?.();
    const lire = (m: Buffer): void => {
      sortie += m.toString('utf8');
      if (opts.marqueur && sortie.includes(opts.marqueur)) {
        clearTimeout(boucher);
        // L'arrêt du nœud est un geste NORMAL : SIGINT, comme un Ctrl+C.
        proc.kill('SIGINT');
        setTimeout(() => proc.kill('SIGKILL'), 5_000).unref?.();
      }
    };
    proc.stdout.on('data', lire);
    proc.stderr.on('data', lire);
    proc.on('error', (e) => finir(null, e));
    proc.on('close', (code) => {
      clearTimeout(boucher);
      finir({ code, sortie });
    });
  });
}

describe('la porte des amis, ruche allumée — les trois actes', () => {
  let server: HiveServer;
  let racineDonnees: string;
  let billet: string;
  const nids: string[] = [];

  const nid = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'ruche-nid-'));
    nids.push(d);
    return d;
  };

  beforeAll(async () => {
    racineDonnees = mkdtempSync(path.join(os.tmpdir(), 'ruche-vivante-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(racineDonnees, 'ruche.db'),
      simulation: false,
      tickMs: 1_000,
    });
    // Le billet vient de la VRAIE route — usage UNIQUE, transport privé en
    // clair (usuel en local, accepté sans `insecure`).
    const rep = await fetch(`http://127.0.0.1:${server.port}/api/billets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ uses: 1, url: `ws://127.0.0.1:${server.port}/ws` }),
    });
    expect(rep.status, 'la ruche a refusé de créer le billet').toBe(201);
    ({ billet } = (await rep.json()) as { billet: string });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(racineDonnees, { recursive: true, force: true });
    for (const d of nids.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const nidDeLAmi = (): string => nids[0] as string;

  it('ACTE 1 — le billet s’échange, la clé est MÉMORISÉE, le nœud butine', async () => {
    const w = nid();
    const r = await lancerJoin(billet, w, { marqueur: 'vous butinez pour la ruche' });

    // L'échange a eu lieu et l'a DIT — « et mémorisée », pas la variante ⚠
    // « NON mémorisée » (qui contient aussi le mot, d'où l'exigence du « et »).
    expect(r.sortie).toContain('Clé de nœud obtenue et mémorisée');
    expect(r.sortie, 'l’URL réelle doit précéder tout échange').toContain(
      `ws://127.0.0.1:${server.port}/ws`,
    );

    // La clé est LÀ, et elle n'est qu'à l'ami.
    const cle = path.join(w, 'node-key.txt');
    expect(existsSync(cle), 'aucune clé mémorisée').toBe(true);
    if (POSIX) {
      expect(statSync(cle).mode & 0o777, 'une clé lisible par tous n’est la clé de personne') //
        .toBe(0o600);
    }

    // Et côté ruche : le nœud s'est bien présenté avec sa clé.
    expect(
      server.store.listNodes().length,
      'la ruche n’a jamais vu le nœud — l’échange a rendu une clé qui n’ouvre rien',
    ).toBeGreaterThan(0);

    // Un Ctrl+C est une réponse, pas un échec — SUR POSIX. Sous Windows,
    // `kill('SIGINT')` TERMINE le processus sans passer par le handler : le
    // code de sortie n'y mesure pas l'arrêt propre, seulement notre coup de
    // grâce. L'assertion ne prétend donc rien là-bas.
    if (POSIX) expect(r.code, `sortie :\n${r.sortie}`).toBe(0);
  }, 45_000);

  it('ACTE 2 — au redémarrage, LE BILLET N’EST PAS REDEMANDÉ', async () => {
    // Même nid : la clé de l'acte 1 doit suffire. Le billet est épuisé — si le
    // nœud le représentait, l'ami serait dehors « en ayant tout fait
    // correctement ». C'est le défaut exact que la mémoire de clé ferme.
    const r = await lancerJoin(billet, nidDeLAmi(), { marqueur: 'vous butinez pour la ruche' });
    expect(r.sortie).toContain('déjà obtenue — le billet n’est pas redemandé');
    if (POSIX) expect(r.code, `sortie :\n${r.sortie}`).toBe(0);
  }, 45_000);

  it('ACTE 3 — le même billet, un nid NEUF : refus net, marche à suivre', async () => {
    // L'usage unique n'est pas une politesse : c'est ce qui rend un billet
    // prêtable. Consommé à l'acte 1, il ne doit plus ouvrir aucune porte.
    const r = await lancerJoin(billet, nid(), { attendreFin: true });
    expect(r.code, 'un billet épuisé doit refuser').toBe(1);
    // Le refus vient de la ruche AVEC son motif, et join dit quoi faire.
    expect(r.sortie).toMatch(/épuisé|refusé|Billet/i);
    expect(r.sortie, 'le refus doit dire comment obtenir un billet neuf').toContain('invite');
  }, 45_000);
});
