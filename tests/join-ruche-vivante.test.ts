// `hive join` CONTRE UNE RUCHE VIVANTE — le chemin réussi, enfin mesuré.
//
// ─── CE QUE LES LOTS PRÉCÉDENTS NE POUVAIENT PAS DIRE ────────────────────────
//
// `tests/join-porte.test.ts` éprouve les trois refus précoces — tout ce qui se
// mesure SANS ruche. Ici, la ruche est RÉELLE : `createServer` sur un port
// éphémère, une base jetable, des billets créés par la VRAIE route
// `POST /api/billets`. Le nœud est réel aussi : le sous-processus `join.ts`,
// celui que l'ami lance.
//
// ─── DEUX FAUTES DE LA PREMIÈRE VERSION, TOUTES DEUX MESURÉES ────────────────
//
// 1. LES ACTES EMPRUNTAIENT LEUR PRÉMISSE AU VOISIN. « Vitest exécute les `it`
//    en séquence », disait l'en-tête — et le tamis des ordres a mélangé les
//    tests DU FICHIER (graine 15838) : l'acte 3 passé en premier trouvait un
//    billet vierge, `join` réussissait, et le test attendait 30 s une fin qui
//    ne venait pas. Le remède est celui que le tamis prescrit : chaque test
//    pose SA prémisse — son billet, son nid, sa consommation.
//
// 2. LE NŒUD ÉTAIT AFFIRMÉ AU LIEU D'ÊTRE ATTENDU. Le marqueur « vous
//    butinez » part juste après `client.start()` ; l'enregistrement WebSocket,
//    lui, est asynchrone. Sur le loopback local la course était invisible ;
//    la jambe windows-latest l'a perdue (« expected 0 to be greater than 0 »).
//    On SCRUTE désormais, avec échéance — et l'identifiant PRÉCIS du nœud (lu
//    dans son nid), pas un compte global qu'un autre test pourrait gonfler.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

function lancerJoin(
  billet: string,
  workdir: string,
  opts: { marqueur?: string; avantArret?: () => Promise<void> } = {},
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
      finir(null, new Error(`ni fin ni marqueur en 30 s :\n${sortie}`));
    }, 30_000);
    boucher.unref?.();
    let marqueurVu = false;
    const lire = (m: Buffer): void => {
      sortie += m.toString('utf8');
      if (opts.marqueur && !marqueurVu && sortie.includes(opts.marqueur)) {
        marqueurVu = true;
        clearTimeout(boucher);
        // ─── L'ATTENTE SE FAIT PENDANT QUE LE PROCESSUS VIT ────────────────
        //
        // La version précédente tuait AU marqueur puis scrutait l'enregis-
        // trement — un nœud mort ne se présente à personne. Sous Windows,
        // `kill('SIGINT')` termine net : la connexion WebSocket n'aboutissait
        // jamais, et la scrutation post-mortem expirait (jambe windows-latest,
        // « ne s'est jamais présenté à la ruche »). Ubuntu gagnait la même
        // course sans la voir. Ce qui doit être vrai DU VIVANT du nœud
        // s'attend ici, avant le signal.
        void (async () => {
          try {
            await opts.avantArret?.();
          } catch (e) {
            proc.kill('SIGKILL');
            finir(null, e as Error);
            return;
          }
          // L'arrêt du nœud est un geste NORMAL : SIGINT, comme un Ctrl+C.
          proc.kill('SIGINT');
          setTimeout(() => proc.kill('SIGKILL'), 5_000).unref?.();
        })();
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

/** Scrute une condition jusqu'à l'échéance — l'asynchrone s'ATTEND, il ne s'affirme pas. */
async function scruter(condition: () => boolean, quoi: string, echeanceMs = 10_000): Promise<void> {
  const depart = Date.now();
  while (!condition()) {
    if (Date.now() - depart > echeanceMs) throw new Error(`échéance : ${quoi}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('la porte des amis, ruche allumée', () => {
  let server: HiveServer;
  let racineDonnees: string;
  const nids: string[] = [];

  const nid = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'ruche-nid-'));
    nids.push(d);
    return d;
  };

  /** Un billet NEUF par la vraie route — chaque test pose sa prémisse. */
  async function creerBillet(): Promise<string> {
    const rep = await fetch(`http://127.0.0.1:${server.port}/api/billets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ uses: 1, url: `ws://127.0.0.1:${server.port}/ws` }),
    });
    expect(rep.status, 'la ruche a refusé de créer le billet').toBe(201);
    const { billet } = (await rep.json()) as { billet: string };
    return billet;
  }

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
  });

  afterAll(async () => {
    await server.stop();
    rmSync(racineDonnees, { recursive: true, force: true });
    for (const d of nids.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('L’ÉCHANGE PUIS LE REDÉMARRAGE — la clé mémorisée épargne le billet', async () => {
    const billet = await creerBillet();
    const w = nid();

    // ── Premier lancement : l'échange ──────────────────────────────────────
    const premier = await lancerJoin(billet, w, {
      marqueur: 'vous butinez pour la ruche',
      // L'identifiant PRÉCIS de ce nœud, lu dans son nid — pas un compte
      // global. Et l'attente a lieu du VIVANT du processus (voir lancerJoin).
      avantArret: async () => {
        const nodeId = readFileSync(path.join(w, 'node-id.txt'), 'utf8').trim();
        await scruter(
          () => server.store.listNodes().some((n) => n.id === nodeId),
          `le nœud ${nodeId} ne s'est jamais présenté à la ruche`,
        );
      },
    });
    // « et mémorisée » au mot près : la variante ⚠ « NON mémorisée » contient
    // aussi « mémorisée ».
    expect(premier.sortie).toContain('Clé de nœud obtenue et mémorisée');
    expect(premier.sortie, 'l’URL réelle doit précéder tout échange').toContain(
      `ws://127.0.0.1:${server.port}/ws`,
    );

    const cle = path.join(w, 'node-key.txt');
    expect(existsSync(cle), 'aucune clé mémorisée').toBe(true);
    if (POSIX) {
      expect(statSync(cle).mode & 0o777, 'une clé lisible par tous n’est la clé de personne') //
        .toBe(0o600);
    }

    // Un Ctrl+C est une réponse, pas un échec — SUR POSIX. Sous Windows,
    // `kill('SIGINT')` termine sans passer par le gestionnaire : le code n'y
    // mesure que notre coup de grâce.
    //
    // ─── DEUX CODES D'ARRÊT PROPRE, PAS UN — la course de l'ENVELOPPE ───────
    //
    // Le gestionnaire SIGINT de `join.ts` sort en 0, et c'est sa promesse.
    // Mais le banc lance le script À TRAVERS `tsx`, qui est un PARENT : quand
    // le SIGINT le frappe, tsx court entre deux nouvelles — la sortie 0 de
    // son enfant, et sa propre mort par signal qu'il traduit en 130 (128+2).
    // Sous charge (CI, graine 23757, deux fois), 130 gagne parfois ALORS QUE
    // « Déconnexion de la ruche… » a été imprimé — l'arrêt propre a bien eu
    // lieu, seule l'enveloppe a parlé la première. On exige donc LA PREUVE de
    // l'arrêt propre (le message du gestionnaire) et l'un des deux codes
    // qu'elle peut rendre — jamais un vrai code d'erreur, jamais le SIGKILL
    // du coup de grâce (code null), qui signerait un join suspendu.
    const ARRET_PROPRE = [0, 130];
    if (POSIX) {
      expect(premier.sortie).toContain('Déconnexion de la ruche…');
      expect(ARRET_PROPRE, `sortie :\n${premier.sortie}`).toContain(premier.code);
    }

    // ── Redémarrage, MÊME nid : le billet est épuisé, la clé suffit ────────
    // Sans la mémoire de clé, ce second lancement représenterait un billet
    // consommé et mettrait l'ami dehors « en ayant tout fait correctement ».
    const second = await lancerJoin(billet, w, { marqueur: 'vous butinez pour la ruche' });
    expect(second.sortie).toContain('déjà obtenue — le billet n’est pas redemandé');
    if (POSIX) {
      expect(second.sortie).toContain('Déconnexion de la ruche…');
      expect(ARRET_PROPRE, `sortie :\n${second.sortie}`).toContain(second.code);
    }
  }, 90_000);

  it('UN BILLET ÉPUISÉ N’OUVRE PLUS RIEN — refus net, marche à suivre', async () => {
    // La prémisse est POSÉE ICI : un billet neuf, consommé par la vraie route
    // d'échange — le geste exact que `join` fait au test d'à côté, sans
    // dépendre de lui ni de l'ordre des tests (graine 15838 du tamis).
    const billet = await creerBillet();
    const consommation = await fetch(`http://127.0.0.1:${server.port}/api/rejoindre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        billet,
        nodeId: `node-premisse-${process.pid}`,
        label: 'consommateur de prémisse',
      }),
    });
    expect(consommation.status, 'la prémisse ne s’est pas posée : l’échange a échoué').toBe(201);

    const r = await lancerJoin(billet, nid());
    expect(r.code, 'un billet épuisé doit refuser').toBe(1);
    expect(r.sortie).toMatch(/épuisé|refusé|Billet/i);
    expect(r.sortie, 'le refus doit dire comment obtenir un billet neuf').toContain('invite');
  }, 45_000);
});
