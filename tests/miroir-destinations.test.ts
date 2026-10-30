// Les destinations de clonage (#521), éprouvées avec un VRAI git et de vrais
// serveurs HTTP sur la boucle locale.
//
// ─── CE QUE CE FICHIER PROUVE, ET QUE LE MODULE PUR NE PEUT PAS ──────────────
//
// `destination-clone.test.ts` vérifie qu'on PRODUIT `http.curloptResolve` et
// `http.followRedirects=false`. Rien n'y dit que git les LIT : une clé mal
// orthographiée est ignorée sans un mot, et le filtre semblerait tenir alors
// que git résoudrait lui-même — la porte du « DNS rebinding » grande ouverte.
// Ici, un nom qui n'existe dans aucun DNS (`.test` est réservé) ne se joint
// QUE par l'épinglage, et une redirection n'atteint son second serveur QUE
// si git la suit. Chaque serveur compte ses requêtes : un refus doit en
// laisser zéro.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FENETRE_RAFRAICHISSEMENT_MS, Miroir } from '../src/orchestrator/miroir.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import {
  DestinationRefusee,
  verifierDestination,
  type PolitiqueDestinations,
  type Resolveur,
} from '../src/shared/destination-clone.js';
import { gitHote } from '../src/shared/git-protege.js';

const FILTREE: PolitiqueDestinations = { mode: 'filtrees', hotes: [] };

/** Le git du BANC — celui qui fabrique l'amont, jamais celui du miroir. */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    [
      '-c',
      'user.email=banc@hive.local',
      '-c',
      'user.name=Banc Hive',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'push.negotiate=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );

/**
 * Un VRAI serveur git « intelligent » (smart HTTP) : `git http-backend` en
 * CGI, ce que servent Gitea ou cgit — le miroir clone en `--depth 1`, que le
 * protocole « bête » ne sait pas faire. `/redirige/…` renvoie un 302 vers
 * `cible`, requête comprise (git refuse une redirection qui perd la sienne).
 * Il compte tout ce qu'il reçoit.
 */
function serveurDepot(racine: string, cible?: () => string) {
  const etat = { requetes: 0 };
  const serveur = http.createServer((req, res) => {
    etat.requetes++;
    const [cheminBrut, requete = ''] = (req.url ?? '/').split('?') as [string, string?];
    if (cheminBrut.startsWith('/redirige/') && cible) {
      const suite = cheminBrut.slice('/redirige/'.length);
      res.writeHead(302, { location: `${cible()}/${suite}${requete ? `?${requete}` : ''}` }).end();
      return;
    }
    const cgi = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env.PATH,
        GIT_PROJECT_ROOT: racine,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(cheminBrut),
        QUERY_STRING: requete,
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        ...(req.headers['content-encoding']
          ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] }
          : {}),
        ...(req.headers['git-protocol']
          ? { GIT_PROTOCOL: String(req.headers['git-protocol']) }
          : {}),
      },
    });
    req.pipe(cgi.stdin);
    const morceaux: Buffer[] = [];
    cgi.stdout.on('data', (m: Buffer) => morceaux.push(m));
    cgi.on('close', () => {
      const tout = Buffer.concat(morceaux);
      const fin = tout.indexOf('\r\n\r\n');
      const entetes = tout.subarray(0, fin).toString('latin1').split('\r\n');
      let statut = 200;
      const champs: Record<string, string> = {};
      for (const ligne of entetes) {
        const [nom, ...valeur] = ligne.split(':');
        if (nom === undefined || valeur.length === 0) continue;
        if (nom.toLowerCase() === 'status') statut = Number.parseInt(valeur.join(':').trim(), 10);
        else champs[nom] = valeur.join(':').trim();
      }
      res.writeHead(statut, champs).end(tout.subarray(fin + 4));
    });
  });
  return {
    etat,
    ecouter: () =>
      new Promise<number>((ok) =>
        serveur.listen(0, '127.0.0.1', () => ok((serveur.address() as AddressInfo).port)),
      ),
    fermer: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}

async function motif(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'PASSE';
  } catch (e) {
    return e instanceof DestinationRefusee ? e.motif : `AUTRE : ${String(e)}`;
  }
}

describe('LES DESTINATIONS DE CLONAGE, AVEC UN VRAI GIT (#521)', () => {
  let dir: string;
  let travail: string;
  let nu: string;
  let p1: number;
  let p2: number;
  const s1 = { srv: null as unknown as ReturnType<typeof serveurDepot> };
  const s2 = { srv: null as unknown as ReturnType<typeof serveurDepot> };

  const commit = (fichier: string, contenu: string): void => {
    writeFileSync(path.join(travail, fichier), contenu);
    git(travail, 'add', '.');
    git(travail, 'commit', '-q', '-m', fichier);
    git(travail, 'push', '-q', nu, 'HEAD:main');
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-destinations-'));
    nu = path.join(dir, 'amont', 'depot.git');
    travail = path.join(dir, 'travail');
    git(dir, 'init', '-q', '--bare', '-b', 'main', nu);
    git(dir, 'init', '-q', '-b', 'main', travail);
    commit('README.md', '# La ruche\n');
    s2.srv = serveurDepot(path.join(dir, 'amont'));
    p2 = await s2.srv.ecouter();
    s1.srv = serveurDepot(path.join(dir, 'amont'), () => `http://127.0.0.1:${p2}`);
    p1 = await s1.srv.ecouter();
  });

  afterAll(async () => {
    await s1.srv.fermer();
    await s2.srv.fermer();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    s1.srv.etat.requetes = 0;
    s2.srv.etat.requetes = 0;
  });

  describe('git LIT ce que le filtre lui impose', () => {
    it('L’ÉPINGLAGE : un nom absent de tout DNS se joint par l’adresse jugée, et seulement par elle', async () => {
      const url = `http://depot.test:${p1}/depot.git`;
      // Le format exact que produit le module — l'adresse publique jugée,
      // remplacée par celle du banc pour que la connexion aboutisse ici.
      const { configGit } = await verifierDestination(url, FILTREE, {
        resoudre: async () => ['140.82.112.3'],
      });
      const surBanc = configGit.map((c) => c.replace('140.82.112.3', '127.0.0.1'));

      const sortie = await gitHote(['ls-remote', '--', url], dir, {
        configReseau: surBanc,
        delaiMs: 20_000,
      });
      expect(sortie).toMatch(/refs\/heads\/main/);
      expect(s1.srv.etat.requetes).toBeGreaterThan(0);

      // Le témoin : SANS l'épinglage, git cherche le nom lui-même et échoue.
      s1.srv.etat.requetes = 0;
      await expect(gitHote(['ls-remote', '--', url], dir, { delaiMs: 20_000 })).rejects.toThrow();
      expect(s1.srv.etat.requetes).toBe(0);
    });

    it('LES REDIRECTIONS : coupées, le second serveur ne reçoit RIEN ; le témoin les suit', async () => {
      const url = `http://127.0.0.1:${p1}/redirige/depot.git`;
      await expect(
        gitHote(['ls-remote', '--', url], dir, {
          configReseau: ['-c', 'http.followRedirects=false'],
          delaiMs: 20_000,
        }),
      ).rejects.toThrow();
      expect(s1.srv.etat.requetes).toBeGreaterThan(0);
      expect(s2.srv.etat.requetes).toBe(0);

      // Sans la coupure, git suit le 302 — c'est bien elle qui ferme la porte.
      await gitHote(['ls-remote', '--', url], dir, { delaiMs: 20_000 });
      expect(s2.srv.etat.requetes).toBeGreaterThan(0);
    });
  });

  describe('le miroir', () => {
    it('FILTRÉ : refuse la boucle locale, par IP comme par nom, sans UNE requête', async () => {
      const miroir = new Miroir(path.join(dir, 'rayons-filtres'), { politique: FILTREE });
      for (const [id, url] of [
        ['ip', `http://127.0.0.1:${p1}/depot.git`],
        ['nom', `http://localhost:${p1}/depot.git`],
        ['scp', 'git@127.0.0.1:depot.git'],
      ] as const) {
        expect(await motif(miroir.rafraichir(id, url)), url).toBe('interne');
        expect(miroir.existe(id)).toBe(false);
      }
      expect(s1.srv.etat.requetes).toBe(0);
    });

    it('FILTRÉ : un nom qui RÉSOUT vers l’intérieur est refusé avant tout git', async () => {
      const piege: Resolveur = async () => ['140.82.112.3', '127.0.0.1'];
      const miroir = new Miroir(path.join(dir, 'rayons-piege'), {
        politique: FILTREE,
        resoudre: piege,
      });
      expect(await motif(miroir.rafraichir('p', `http://depot.test:${p1}/depot.git`))).toBe(
        'interne',
      );
      expect(s1.srv.etat.requetes).toBe(0);
    });

    it('LIBRE : clone puis rafraîchit par HTTP, sur l’URL jugée et non sur `origin`', async () => {
      const racine = path.join(dir, 'rayons-libres');
      const miroir = new Miroir(racine);
      const url = `http://127.0.0.1:${p1}/depot.git`;
      await miroir.rafraichir('libre', url);
      expect((await miroir.lister('libre', '')).map((e) => e.nom)).toContain('README.md');

      commit('NOUVEAU.md', 'du miel\n');
      await miroir.rafraichir('libre', url, Date.now() + FENETRE_RAFRAICHISSEMENT_MS + 1);
      expect((await miroir.lister('libre', '')).map((e) => e.nom)).toContain('NOUVEAU.md');
    });

    it('UNE COPIE D’UNE DESTINATION DEVENUE REFUSÉE EST EFFACÉE, pas servie comme « la copie d’hier »', async () => {
      const racine = path.join(dir, 'rayons-bascule');
      const url = `http://127.0.0.1:${p1}/depot.git`;
      await new Miroir(racine).rafraichir('bascule', url);
      const filtre = new Miroir(racine, { politique: FILTREE });
      expect(filtre.existe('bascule')).toBe(true);
      expect(await motif(filtre.rafraichir('bascule', url))).toBe('interne');
      expect(filtre.existe('bascule')).toBe(false);
    });

    it('un chemin local (réservé à un administrateur) ne passe pas par le filtre', async () => {
      const miroir = new Miroir(path.join(dir, 'rayons-local'), { politique: FILTREE });
      await miroir.rafraichir('local', nu);
      expect(miroir.existe('local')).toBe(true);
    });
  });

  describe('la Reine Cloud', () => {
    const TOKEN = 'jeton-destinations-assez-long-42';
    let server: HiveServer;
    let base: string;
    let jeton: string;
    const dnsBanc: Resolveur = async (hote) => {
      if (hote === 'github.com') return ['140.82.112.3'];
      if (hote === 'interne.exemple.org') return ['10.0.0.5'];
      throw new Error(`ENOTFOUND ${hote}`);
    };

    const poster = (route: string, corps: object, auth: Record<string, string>) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify(corps),
      });

    beforeAll(async () => {
      server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(dir, 'reine', 'hive.db'),
        simulation: true,
        tickMs: 60_000,
        edition: 'cloud',
        resoudreNom: dnsBanc,
      });
      base = `http://127.0.0.1:${server.port}`;
      const res = await poster(
        '/api/auth/register',
        {
          email: 'abeille@exemple.test',
          password: 'motdepasse-assez-long-42',
          displayName: 'Abeille',
        },
        { 'x-hive-token': TOKEN },
      );
      jeton = ((await res.json()) as { token?: string }).token ?? '';
      expect(jeton).not.toBe('');
    });

    afterAll(async () => {
      await server.stop();
    });

    it.each([
      ['/api/projects/user', 'compte'],
      ['/api/projects', 'jeton de ruche'],
    ])(
      '%s (%s) refuse une destination interne À LA CRÉATION, sans dire où elle mène',
      async (route) => {
        const auth: Record<string, string> =
          route === '/api/projects'
            ? { 'x-hive-token': TOKEN }
            : { authorization: `Bearer ${jeton}` };
        for (const repoUrl of [
          'http://169.254.169.254/latest/meta-data',
          `http://127.0.0.1:${p1}/depot.git`,
          'https://interne.exemple.org/x.git',
        ]) {
          const res = await poster(route, { name: 'Sonde', repoUrl }, auth);
          expect(res.status, repoUrl).toBe(400);
          const corps = (await res.json()) as { motif: string; error: string };
          expect(corps.motif).toBe('interne');
          expect(corps.error).not.toMatch(/10\.0\.0\.5/);
        }
        const ok = await poster(
          route,
          { name: 'Vrai dépôt', repoUrl: 'https://github.com/x/y.git' },
          auth,
        );
        expect(ok.status).toBe(201);
        expect(s1.srv.etat.requetes).toBe(0);
      },
    );

    it('le Rayon d’un projet ANCIEN pointé vers l’intérieur répond 403, sans une requête', async () => {
      const id = server.store.createProject({
        name: 'Projet d’avant le filtre',
        repoUrl: `http://127.0.0.1:${p1}/depot.git`,
        visibility: 'public',
      }).id;
      const res = await fetch(`${base}/api/projects/${id}/rayon`, {
        headers: { authorization: `Bearer ${jeton}` },
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { motif: string }).motif).toBe('interne');
      expect(s1.srv.etat.requetes).toBe(0);
    });
  });
});
