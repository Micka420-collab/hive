// Le miroir face à un amont MUET — un serveur qui accepte la connexion, puis
// se tait.
//
// ─── LE TROU ─────────────────────────────────────────────────────────────────
//
// Le clone du miroir passait par `gitHote` sans délai : pour un git hors dépôt
// épinglé, c'est `timeout: 0`, jamais tué. La promesse restait « en vol », et
// chaque requête suivante du Rayon de ce projet l'attendait — jusqu'au
// redémarrage de la Reine. Le `fetch` n'était borné que par accident (le
// délai des commandes LOCALES). Le miroir passe désormais les butoirs du nœud
// (`CLONE_MS`, `DELAI_RESEAU_MS`) ; on les raccourcit ici, et SEULEMENT ici,
// pour ne pas attendre dix minutes : ce qu'on éprouve, c'est qu'ils sont
// passés, et ce que le miroir fait quand ils tombent.
//
// ─── L'HORLOGE ───────────────────────────────────────────────────────────────
//
// Raccourcir les butoirs cachait un second trou : en production, une
// tentative tenue jusqu'à son butoir (dix minutes pour un clone) dure PLUS
// que la fenêtre de rafraîchissement (une minute). Datée de son début, sa
// fenêtre était close avant qu'elle ne tombe, et chaque visiteur relançait
// un git muet. Ici, chaque connexion au serveur muet avance l'horloge
// (`Date.now`) de dix minutes : la tentative dure, pour le miroir, ce
// qu'elle durerait vraiment.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FENETRE_RAFRAICHISSEMENT_MS, Miroir } from '../src/orchestrator/miroir.js';
import { createServer } from '../src/orchestrator/server.js';
import { EchecGitHote } from '../src/shared/git-protege.js';

// Assez pour un clone LOCAL sur une CI Windows chargée, bien moins que les
// dix minutes réelles.
vi.mock('../src/shared/butoirs-noeud.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/butoirs-noeud.js')>()),
  CLONE_MS: 5_000,
  DELAI_RESEAU_MS: 3_000,
}));

/** Le motif d'échec d'un rafraîchissement : délai, autre échec, ou 'PASSÉ'. */
async function issue(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'PASSÉ';
  } catch (e) {
    if (e instanceof EchecGitHote) return e.delaiDepasse ? 'délai' : `échec git : ${e.message}`;
    return `AUTRE : ${String(e)}`;
  }
}

describe('UN AMONT MUET NE TIENT PAS LE RAYON', () => {
  let racine: string;
  let serveur: net.Server;
  let url: string;
  const prises = new Set<net.Socket>();
  let connexions = 0;
  /** Ce que chaque connexion au serveur muet fait « durer » la tentative. */
  const DUREE_REELLE_MS = 10 * 60_000;
  let decalage = 0;
  const vraiMaintenant = Date.now.bind(Date);
  /** L'horloge du miroir : la vraie, plus ce que les tentatives ont « duré ». */
  const horlogeQuiAvance = (): void => {
    decalage = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => vraiMaintenant() + decalage);
  };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Un vrai dépôt amont, un commit « hier ». */
  const depotAmont = (nom: string): string => {
    const amont = path.join(racine, nom);
    mkdirSync(amont);
    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        [
          '-c',
          'user.email=banc@hive.local',
          '-c',
          'user.name=Banc Hive',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: amont, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    git('init', '-q');
    writeFileSync(path.join(amont, 'README.md'), 'hier\n');
    git('add', '--all');
    git('commit', '-q', '-m', 'hier');
    return amont;
  };
  /** L'`origin` d'un miroir existant, pointé sur le serveur muet. */
  const rendreMuet = (dossier: string): void => {
    execFileSync(
      'git',
      ['--git-dir', path.join(dossier, '.git'), 'remote', 'set-url', 'origin', url],
      { stdio: 'ignore' },
    );
  };
  /** Une Reine sur son propre répertoire, et le jeton d'une abeille inscrite. */
  const ouvrirReine = async (
    nom: string,
  ): Promise<{ server: Awaited<ReturnType<typeof createServer>>; base: string; jeton: string }> => {
    const TOKEN = 'jeton-amont-muet-suffisamment-long';
    const server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(racine, nom, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const inscription = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({
        email: 'abeille@exemple.test',
        password: 'motdepasse-assez-long-42',
        displayName: 'Abeille',
      }),
    });
    const jeton = ((await inscription.json()) as { token?: string }).token ?? '';
    return { server, base, jeton };
  };

  beforeAll(async () => {
    racine = mkdtempSync(path.join(os.tmpdir(), 'hive-miroir-muet-'));
    // Accepte, lit, ne répond JAMAIS : ni refus lisible, ni fermeture.
    serveur = net.createServer((prise) => {
      connexions++;
      decalage += DUREE_REELLE_MS;
      prises.add(prise);
      prise.on('close', () => prises.delete(prise));
      prise.resume();
    });
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
    const adresse = serveur.address();
    if (adresse === null || typeof adresse === 'string') throw new Error('adresse inattendue');
    url = `http://127.0.0.1:${adresse.port}/depot.git`;
  });

  afterAll(async () => {
    for (const prise of prises) prise.destroy();
    await new Promise<void>((ok) => serveur.close(() => ok()));
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('le premier clone échoue au butoir, puis le redit sans relancer git', async () => {
    horlogeQuiAvance();
    const miroir = new Miroir(path.join(racine, 'rayons-clone'));
    const debut = vraiMaintenant();
    expect(await issue(miroir.rafraichir('p', url))).toBe('délai');
    expect(vraiMaintenant() - debut, 'tué au butoir, pas au bout du test').toBeLessThan(30_000);
    expect(connexions, 'git a bien parlé au serveur muet').toBeGreaterThan(0);
    expect(miroir.existe('p')).toBe(false);

    // Juste après l'échec — dix minutes après le DÉBUT de la tentative —,
    // l'échec est redit tout de suite : un visiteur de plus n'attend pas un
    // butoir de plus.
    const vues = connexions;
    const avant = vraiMaintenant();
    expect(await issue(miroir.rafraichir('p', url))).toBe('délai');
    expect(connexions, 'aucun nouveau git dans la fenêtre').toBe(vues);
    expect(vraiMaintenant() - avant).toBeLessThan(1_000);
  }, 60_000);

  it('un miroir existant dont l’amont devient muet : le rafraîchissement tombe au butoir, la copie reste', async () => {
    // Un vrai amont, cloné ; puis son `origin` pointé sur le serveur muet.
    const amont = depotAmont('amont');
    horlogeQuiAvance();
    const miroir = new Miroir(path.join(racine, 'rayons-fetch'));
    await miroir.rafraichir('p', amont);
    rendreMuet(miroir.dossier('p'));

    decalage += 2 * FENETRE_RAFRAICHISSEMENT_MS;
    expect(await issue(miroir.rafraichir('p', url))).toBe('délai');
    expect(miroir.existe('p')).toBe(true);
    expect((await miroir.lire('p', 'README.md')).contenu).toBe('hier\n');
    // La fenêtre vaut pour l'échec, comptée depuis sa FIN : la copie d'hier
    // se sert sans attendre, sans un git de plus.
    const vues = connexions;
    const avant = vraiMaintenant();
    await expect(miroir.rafraichir('p', url)).resolves.toBeUndefined();
    expect(connexions, 'aucun nouveau git dans la fenêtre').toBe(vues);
    expect(vraiMaintenant() - avant).toBeLessThan(1_000);
  }, 60_000);

  it('un reclone qui tombe au butoir garde la copie d’hier', async () => {
    // La tête de l'amont a bougé (`main` → `trunk`) : le miroir doit être
    // refait. Le `ls-remote` interroge l'`origin` du miroir, qui répond ; le
    // clone part de l'URL du projet — ici le serveur muet. Le reclone effaçait
    // la copie AVANT de cloner : le butoir tombé, il ne restait rien, et le
    // Rayon passait de « copie d'hier » à un 409.
    const amont = depotAmont('amont-tete');
    const miroir = new Miroir(path.join(racine, 'rayons-reclone'));
    await miroir.rafraichir('p', amont, 1_000);
    execFileSync('git', ['branch', '-m', 'trunk'], { cwd: amont, stdio: 'ignore' });

    expect(await issue(miroir.rafraichir('p', url, 1_000 + 2 * FENETRE_RAFRAICHISSEMENT_MS))).toBe(
      'délai',
    );
    expect(miroir.existe('p'), 'la copie d’hier est toujours là').toBe(true);
    expect((await miroir.lire('p', 'README.md')).contenu).toBe('hier\n');
  }, 60_000);

  it('le Rayon le DIT : 409 « n’a pas répondu à temps », pas une requête pendue', async () => {
    const { server, base, jeton } = await ouvrirReine('data-409');
    try {
      const id = server.store.createProject({
        name: 'Amont muet',
        repoUrl: url,
        visibility: 'public',
      }).id;
      const res = await fetch(`${base}/api/projects/${id}/rayon`, {
        headers: { authorization: `Bearer ${jeton}` },
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/pas répondu à temps/);
    } finally {
      await server.stop();
    }
  }, 60_000);

  it('un miroir existant, amont muet : le Rayon sert la copie d’hier (200), au butoir', async () => {
    // L'autre branche d'`assurerMiroir` : le rafraîchissement tombe, la copie
    // existe — on la sert (et l'hôte le lit dans ses journaux), plutôt qu'un
    // 409 qui cacherait un code qu'on a.
    const { server, base, jeton } = await ouvrirReine('data-200');
    try {
      const amont = depotAmont('amont-rayon');
      const id = server.store.createProject({
        name: 'Amont devenu muet',
        repoUrl: url,
        visibility: 'public',
      }).id;
      const preparateur = new Miroir(path.join(racine, 'data-200', 'rayons'));
      await preparateur.rafraichir(id, amont);
      rendreMuet(preparateur.dossier(id));

      const avant = Date.now();
      const res = await fetch(`${base}/api/projects/${id}/rayon`, {
        headers: { authorization: `Bearer ${jeton}` },
      });
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).toContain('README.md');
      expect(Date.now() - avant, 'tenu au butoir, pas au-delà').toBeLessThan(30_000);
    } finally {
      await server.stop();
    }
  }, 60_000);

  it.skipIf(process.platform === 'win32')(
    'le butoir ne laisse pas d’assistant HTTP orphelin accroché au serveur muet',
    async () => {
      // `execFile` ne tue que git : son `git-remote-http` survivait, rattaché
      // à init, sa prise ouverte — un processus de plus par tentative sur la
      // machine de la Reine. `http.lowSpeed*` le fait abandonner avec git.
      const miroir = new Miroir(path.join(racine, 'rayons-orphelin'));
      expect(await issue(miroir.rafraichir('p', url))).toBe('délai');
      const port = new URL(url).port;
      const restants = (): string[] =>
        execFileSync('ps', ['-A', '-o', 'args='], { encoding: 'utf8' })
          .split('\n')
          .filter((l) => l.includes('remote-http') && l.includes(`127.0.0.1:${port}`));
      // Laisser à curl le temps de constater son propre butoir.
      const limite = Date.now() + 10_000;
      while (restants().length > 0 && Date.now() < limite) {
        await new Promise((ok) => setTimeout(ok, 200));
      }
      expect(restants()).toEqual([]);
    },
    60_000,
  );
});
