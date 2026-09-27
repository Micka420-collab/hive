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

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

  beforeAll(async () => {
    racine = mkdtempSync(path.join(os.tmpdir(), 'hive-miroir-muet-'));
    // Accepte, lit, ne répond JAMAIS : ni refus lisible, ni fermeture.
    serveur = net.createServer((prise) => {
      connexions++;
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
    const miroir = new Miroir(path.join(racine, 'rayons-clone'));
    const debut = Date.now();
    expect(await issue(miroir.rafraichir('p', url, 1_000))).toBe('délai');
    expect(Date.now() - debut, 'tué au butoir, pas au bout du test').toBeLessThan(30_000);
    expect(connexions, 'git a bien parlé au serveur muet').toBeGreaterThan(0);
    expect(miroir.existe('p')).toBe(false);

    // Dans la fenêtre, l'échec est redit tout de suite : un visiteur de plus
    // n'attend pas un butoir de plus.
    const vues = connexions;
    const avant = Date.now();
    expect(await issue(miroir.rafraichir('p', url, 1_500))).toBe('délai');
    expect(connexions, 'aucun nouveau git dans la fenêtre').toBe(vues);
    expect(Date.now() - avant).toBeLessThan(1_000);
  }, 60_000);

  it('un miroir existant dont l’amont devient muet : le rafraîchissement tombe au butoir, la copie reste', async () => {
    // Un vrai amont, cloné ; puis son `origin` pointé sur le serveur muet.
    const amont = path.join(racine, 'amont');
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
    const miroir = new Miroir(path.join(racine, 'rayons-fetch'));
    await miroir.rafraichir('p', amont, 1_000);
    git('--git-dir', path.join(miroir.dossier('p'), '.git'), 'remote', 'set-url', 'origin', url);

    const t = 1_000 + FENETRE_RAFRAICHISSEMENT_MS + 1;
    expect(await issue(miroir.rafraichir('p', url, t))).toBe('délai');
    expect(miroir.existe('p')).toBe(true);
    expect((await miroir.lire('p', 'README.md')).contenu).toBe('hier\n');
    // La fenêtre vaut pour l'échec : la copie d'hier se sert sans attendre.
    const vues = connexions;
    await expect(miroir.rafraichir('p', url, t + 1)).resolves.toBeUndefined();
    expect(connexions).toBe(vues);
  }, 60_000);

  it('le Rayon le DIT : 409 « n’a pas répondu à temps », pas une requête pendue', async () => {
    const TOKEN = 'jeton-amont-muet-suffisamment-long';
    const server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(racine, 'data', 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    try {
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
});
