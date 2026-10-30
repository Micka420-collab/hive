// LE RÉSEAU DE LA PORTE DE SÉCURITÉ — train 7, G10 × G03.
//
// La porte (G10) tourne dans le bac de la tâche ; G03 filtre le réseau de ce
// bac par tâche, et sa liste blanche ne connaît pas api.osv.dev. Combinés,
// l'interrogation d'osv.dev passait par le proxy de la TÂCHE : refusée, elle
// sortait en 127 sur chaque production qui touche un lockfile (« api.osv.dev
// injoignable », jamais l'avis), et ses refus partaient au bilan réseau de la
// tâche — imputés au producteur. Betterleaks, lui, lisait les lignes ajoutées
// derrière ce même proxy.
//
// La porte a désormais SON réseau, quand le bac du nœud sait filtrer :
//   · Betterleaks et l'extraction hors ligne : réseau COUPÉ, aucun relais ;
//   · l'interrogation d'osv.dev : une session du proxy d'egress à elle, qui ne
//     joint qu'api.osv.dev:443 — ses refus ne vont qu'au nœud, jamais au bilan
//     de la tâche.
//
// Une vraie Reine, un vrai HiveNodeClient au réseau filtré, un vrai dépôt git ;
// les faux outils de `fixtures/faux-outils-porte.ts` ; et un faux moteur de
// conteneurs qui lit la grammaire d'`envelopper` (volumes, variables, dossier
// de travail) et remplace le relais du bac par le socket de la session
// (`HIVE_BANC_SOCKET`) : le proxy de Hive, lui, est réel. La résolution DNS
// d'api.osv.dev est coupée ici (aucun octet ne sort du banc) : le proxy de la
// porte la laisse passer, la connexion échoue ensuite — c'est le refus de
// Hive, pas l'issue du réseau, que le faux outil lit.
//
// POSIX seulement : les faux outils et le faux moteur sont des scripts.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import type { Fournisseur } from '../src/node-client/isolement.js';
import { ouvrirReseauPorte } from '../src/node-client/reseau-tache.js';
import { RendezVousPont } from '../src/node-client/rendez-vous-pont.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { fauxOutilsPorte, reseauVu, type FauxOutils } from './fixtures/faux-outils-porte.js';

// Aucun octet ne sort du banc : api.osv.dev ne se résout pas ici. Le reste
// (la Reine, le nœud — tout en adresses littérales) suit le vrai `lookup`.
vi.mock('node:dns', async (original) => {
  const vrai = await original<typeof import('node:dns')>();
  const lookup = (hote: string, ...reste: unknown[]): void => {
    const rappel = reste.at(-1) as (err: NodeJS.ErrnoException | null) => void;
    if (hote === 'api.osv.dev') {
      const err: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hote}`);
      err.code = 'ENOTFOUND';
      process.nextTick(() => rappel(err));
      return;
    }
    (vrai.lookup as (...a: unknown[]) => void)(hote, ...reste);
  };
  return { ...vrai, lookup, default: { ...vrai, lookup } };
});

const JETON = 'jeton-porte-reseau-suffisamment-long';
const POSIX = process.platform !== 'win32';
const IMAGE = 'hive-banc';

const verrou = (deps: Record<string, string>): string =>
  JSON.stringify(
    {
      name: 'projet-local',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'projet-local', version: '1.0.0', dependencies: deps },
        ...Object.fromEntries(
          Object.entries(deps).map(([nom, version]) => [
            `node_modules/${nom}`,
            { version, resolved: `https://registry.npmjs.org/${nom}/-/${nom}-${version}.tgz` },
          ]),
        ),
      },
    },
    null,
    2,
  ) + '\n';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let outils: FauxOutils;
const dossiers: string[] = [];
const PATH_AVANT = process.env.PATH;

beforeEach(() => {
  outils = fauxOutilsPorte(dossiers);
  process.env.PATH = `${outils.dossier}${path.delimiter}${PATH_AVANT ?? ''}`;
});

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  process.env.PATH = PATH_AVANT;
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 30_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/**
 * Le faux moteur : `run <options…> hive-banc <commande…>`, lu comme un vrai —
 * chaque `--volume=<hôte>:<bac>` ramène un chemin du bac vers l'hôte, chaque
 * `--env=NOM=valeur` est posé, `--workdir` choisit le dossier. Le relais du
 * bac (`<node> /hive/reseau/r.cjs <port> <socket> -- <commande>`) est remplacé
 * par la commande seule, avec le socket de la session dans `HIVE_BANC_SOCKET` :
 * le banc n'ouvre aucun port sur la boucle de la machine. Chaque lancement
 * laisse sa ligne de commande (`appels`).
 */
function fauxMoteur(): { fournisseur: Fournisseur; appels: () => string[] } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-faux-moteur-reseau-'));
  dossiers.push(dir);
  const bin = path.join(dir, 'moteur');
  writeFileSync(
    bin,
    `#!${process.execPath}\n` +
      String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ici = path.dirname(fs.realpathSync(process.argv[1]));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(ici, 'appels'), args.join(' ') + '\n');
const i = args.indexOf('${IMAGE}');
const volumes = [];
const env = { ...process.env };
let dossier = process.cwd();
for (const o of args.slice(1, i)) {
  let m;
  if ((m = /^--volume=(.+):(\/hive\/[^:]+)(?::(?:ro|rw))?$/.exec(o))) volumes.push([m[2], m[1]]);
  else if ((m = /^--env=([^=]+)=([\s\S]*)$/.exec(o))) env[m[1]] = m[2];
  else if ((m = /^--workdir=(.+)$/.exec(o))) dossier = m[1];
}
const hote = (p) => {
  for (const [bac, h] of volumes) if (p === bac || p.startsWith(bac + '/')) return h + p.slice(bac.length);
  return p;
};
let commande = args.slice(i + 1);
if (commande[1] === '/hive/reseau/r.cjs' && commande[4] === '--') {
  env.HIVE_BANC_SOCKET = hote(commande[3]);
  commande = commande.slice(5);
}
const r = spawnSync(commande[0], commande.slice(1).map(hote), { cwd: hote(dossier), env, stdio: 'inherit' });
process.exit(r.status ?? 1);
`,
  );
  chmodSync(bin, 0o755);
  const journal = path.join(dir, 'appels');
  return {
    fournisseur: { nom: 'banc', bin, niveau: 'conteneur', installation: '', garanties: [] },
    appels: () =>
      existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : [],
  };
}

/** Ce que ce banc lit de `GET /api/tasks/:id/evaluation`. */
interface EvaluationLue {
  decision: string;
  reasons: string[];
}

describe.runIf(POSIX)('la porte a SON réseau quand le bac du nœud filtre (G10 × G03)', () => {
  it(
    'UNE DÉPENDANCE VULNÉRABLE SOUS RÉSEAU FILTRÉ : l’avis est cité, la porte ne joint qu’osv.dev, et rien n’entre au bilan de la tâche',
    { timeout: 60_000 },
    async () => {
      outils.mode('osv-scanner', 'curieux');
      const moteur = fauxMoteur();
      const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-porte-reseau-'));
      dossiers.push(racine);
      const depot = path.join(racine, 'depot');
      mkdirSync(depot, { recursive: true });
      writeFileSync(path.join(depot, 'package-lock.json'), verrou({ lodash: '4.17.20' }));
      const git = simpleGit({ baseDir: depot });
      await git.init();
      await git.addConfig('user.email', 'banc@hive.test');
      await git.addConfig('user.name', 'Banc Hive');
      await git.addConfig('commit.gpgsign', 'false');
      await git.add('.');
      await git.commit('base');

      // Le dossier de la session réseau de la TÂCHE, tel que l'agent le reçoit.
      const sessionsDeLaTache: string[] = [];
      const agent: AgentAdapter = {
        name: 'banc',
        run(_task, ctx) {
          if (ctx.bac?.reseau) sessionsDeLaTache.push(ctx.bac.reseau.dossier);
          writeFileSync(
            path.join(ctx.cwd, 'package-lock.json'),
            verrou({ lodash: '4.17.20', minimist: '1.2.0' }),
          );
          return Promise.resolve({ success: true, diff: '', logs: 'ajouté', subAgents: [] });
        },
      };
      serveur = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: JETON,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(racine, 'hive.db'),
        simulation: false,
        tickMs: 40,
      });
      client = new HiveNodeClient({
        url: `ws://127.0.0.1:${serveur.port}/ws`,
        token: JETON,
        name: 'ouvriere-porte-reseau',
        ownerName: 'banc',
        agentType: 'claude-code',
        nodeId: 'noeud-porte-reseau',
        maxConcurrency: 1,
        workRoot: path.join(racine, 'travail'),
        adapter: agent,
        // Un bac qui FILTRE (mesuré au démarrage chez un vrai nœud) : la tâche
        // a son proxy, et la porte le sien.
        bac: { fournisseur: moteur.fournisseur, image: IMAGE, variables: [] },
        reseau: { filtre: true, exige: false, motif: 'banc' },
        quiet: true,
      });
      client.start();
      const s = serveur;
      await attendre(
        () =>
          s.store.listNodes().some((n) => n.id === 'noeud-porte-reseau' && n.status === 'online'),
        'le nœud ne rejoint pas la ruche',
      );
      const projet = s.store.createProject({ name: 'Projet local', repoUrl: depot });
      const tache = s.store.createTask({
        projectId: projet.id,
        title: 'Ajouter minimist',
        prompt: 'Ajoute minimist 1.2.0.',
      });
      s.store.patchTask(tache.id, { status: 'ready' });
      await attendre(() => s.store.resultsForTask(tache.id).length > 0, 'pas de résultat');

      // 1. L'AVIS EST CITÉ — pas « api.osv.dev injoignable », pas « outil en échec ».
      const evaluation = (await (
        await fetch(`http://127.0.0.1:${s.port}/api/tasks/${tache.id}/evaluation`, {
          headers: { 'x-hive-token': JETON },
        })
      ).json()) as EvaluationLue;
      expect(evaluation.decision).toBe('correction_required');
      expect(evaluation.reasons.join('\n')).toContain(
        'minimist@1.2.0 (npm) GHSA-xvch-5gv4-984h (CVE-2021-44906, CRITICAL) dans package-lock.json',
      );
      const porte = s.store
        .listEvents(0, 5_000)
        .find((e) => e.type === 'security_gate_recorded' && e.payload.taskId === tache.id)?.payload
        .porte as { dependances: { etat: string; raison: string } } | undefined;
      expect(porte?.dependances).toMatchObject({ etat: 'constat', raison: 'trouve' });

      // 2. LA PORTE NE JOINT QU'OSV.DEV : l'autre hôte tenté est refusé par SA session.
      expect(reseauVu(outils)).toEqual(['deps.dev:443 refus', 'api.osv.dev:443 passe']);

      // 3. RIEN DE LA PORTE AU BILAN DE LA TÂCHE — ni ses logs, ni son journal.
      const logs = s.store.resultsForTask(tache.id).at(-1)?.logs ?? '';
      const journal = JSON.stringify(
        s.store.listEvents(0, 5_000).filter((e) => e.payload.taskId === tache.id),
      );
      for (const texte of [logs, journal]) {
        expect(texte).not.toContain('deps.dev');
        expect(texte).not.toContain('réseau refusé');
        expect(texte).not.toContain('destination(s) refusée(s)');
      }

      // 4. CE QUE LE MOTEUR A REÇU : Betterleaks et l'extraction réseau coupé,
      //    sans relais ; l'interrogation par la session de la PORTE — pas celle
      //    de la tâche.
      expect(sessionsDeLaTache).toHaveLength(1);
      const lancements = moteur.appels();
      const outilsLances = lancements.filter((l) => / (?:betterleaks|osv-scanner) /.test(l));
      const horsLigne = outilsLances.filter(
        (l) =>
          l.includes(' betterleaks ') || l.includes('vulnmatch/osvdev') || l.includes('--version'),
      );
      const interrogations = outilsLances.filter((l) => l.includes('/sboms/'));
      expect(horsLigne.length).toBeGreaterThanOrEqual(4);
      for (const l of horsLigne) {
        expect(l).toContain('--network=none');
        expect(l).not.toContain('/hive/reseau');
      }
      expect(interrogations).toHaveLength(1);
      const interrogation = interrogations[0] ?? '';
      expect(interrogation).toContain('--network=none');
      expect(interrogation).toContain('--env=HTTPS_PROXY=http://127.0.0.1:3128');
      const volume = /--volume=([^ ]+):\/hive\/reseau:ro/.exec(interrogation)?.[1];
      expect(volume, 'l’interrogation passe par une session').toBeTruthy();
      expect(volume).not.toBe(sessionsDeLaTache[0]);
    },
  );
});

describe.runIf(POSIX)('la session de la porte — api.osv.dev:443, et rien d’autre', () => {
  /** La réponse du proxy de la session à un CONNECT, première ligne et en-tête de refus. */
  const connecter = (socket: string, cible: string): Promise<string> =>
    new Promise((resolve) => {
      const s = connect(socket);
      let recu = '';
      s.on('data', (d: Buffer) => {
        recu += d.toString('utf8');
        if (recu.includes('\r\n\r\n')) s.destroy();
      });
      s.on('close', () => resolve(recu));
      s.on('error', () => resolve(recu));
      s.write(`CONNECT ${cible} HTTP/1.1\r\nHost: ${cible}\r\n\r\n`);
    });

  it('un autre hôte, ou api.osv.dev sur un autre port : refusés — et dits à la porte seule', async () => {
    const rendezVous = new RendezVousPont();
    const refus: string[] = [];
    const reseau = await ouvrirReseauPorte({
      reservation: rendezVous,
      surRefus: (r) => refus.push(`${r.hote}:${r.port}`),
    });
    try {
      expect(reseau.etat).toBe('filtre');
      if (reseau.etat !== 'filtre') return;
      expect(reseau.reseau.variables.HTTPS_PROXY).toBe('http://127.0.0.1:3128');
      for (const cible of ['deps.dev:443', 'api.osv.dev:80', 'exfil.example.org:443']) {
        const reponse = await connecter(reseau.reseau.socket, cible);
        expect(reponse, cible).toMatch(/^HTTP\/1\.1 403 /);
        expect(reponse.toLowerCase(), cible).toContain('x-hive-reseau: refus');
      }
      expect(refus).toEqual(['deps.dev:443', 'api.osv.dev:80', 'exfil.example.org:443']);
      // api.osv.dev:443 passe le filtre : la session tente la connexion (ici
      // sans DNS) au lieu de refuser.
      expect(await connecter(reseau.reseau.socket, 'api.osv.dev:443')).toMatch(/^HTTP\/1\.1 502 /);
    } finally {
      if (reseau.etat === 'filtre') await reseau.fermer();
      rendezVous.fermer();
    }
  });
});
