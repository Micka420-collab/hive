// Lire le code du projet depuis le tableau de bord — le contrat HTTP.
//
// ─── LES DEUX GARDES, ET POURQUOI IL EN FAUT DEUX ────────────────────────────
//
//   1. `peutLireCode` répond à « cette personne a-t-elle affaire à ce dépôt ? »
//   2. `shared/rayon.ts` répond à « ce chemin-là se sert-il, quel que soit le
//      lecteur ? » — `.git` porte l'URL distante avec ses identifiants, les
//      `.env` et les clés privées ne sortent pas d'un partage en lecture.
//
// Aucune des deux ne suffit seule. La première laisserait un membre légitime
// lire `.git/config` et repartir avec le jeton GitHub de l'hôte. La seconde
// laisserait n'importe quel compte lire le code d'un projet privé.
//
// Le test qui compte le plus est celui de l'indistinction : sur un projet privé
// qu'on n'a pas le droit de lire, la réponse doit être MOT POUR MOT celle d'un
// projet qui n'existe pas.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Entree } from '../src/shared/rayon.js';

const TOKEN = 'jeton-rayon-suffisamment-long-42';

describe('GET /api/projects/:id/rayon', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let depot: string;
  let jetonMembre = '';
  let jetonIntrus = '';
  let publicId = '';
  let priveId = '';

  const inscrire = async (email: string): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: 'Abeille' }),
    });
    return ((await res.json()) as { token?: string }).token ?? '';
  };

  const lire = (jeton: string, id: string, chemin?: string) =>
    fetch(
      `${base}/api/projects/${id}/rayon${chemin === undefined ? '' : `?chemin=${encodeURIComponent(chemin)}`}`,
      { headers: { authorization: `Bearer ${jeton}` } },
    );

  const fichier = (jeton: string, id: string, chemin: string) =>
    fetch(`${base}/api/projects/${id}/rayon/fichier?chemin=${encodeURIComponent(chemin)}`, {
      headers: { authorization: `Bearer ${jeton}` },
    });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-rayonapi-'));
    depot = path.join(dir, 'amont');
    await simpleGit().raw(['init', depot]);
    const git = simpleGit({ baseDir: depot });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    // ─── LA SIGNATURE DE COMMIT, NEUTRALISÉE POUR CE DÉPÔT JETABLE ─────────
    //
    // `commit.gpgsign = true` est un réglage GLOBAL courant et recommandé. Il
    // s'applique aussi aux dépôts que ces tests fabriquent — et le programme de
    // signature n'a rien à faire là : un contributeur qui signe ses commits ne
    // pouvait tout simplement PAS lancer cette suite (« cannot exec … »,
    // onze fichiers rouges).
    //
    // On désarme UNIQUEMENT ce réglage, UNIQUEMENT dans le dépôt que le test
    // vient de créer. Rien de la configuration de la personne n'est touché —
    // c'est la leçon du § 4.1 : `GIT_CONFIG_NOSYSTEM` avait emporté
    // `core.symlinks` avec lui.
    await git.addConfig('commit.gpgsign', 'false');
    mkdirSync(path.join(depot, 'src'), { recursive: true });
    writeFileSync(path.join(depot, 'README.md'), '# La ruche\n');
    writeFileSync(path.join(depot, 'src', 'index.ts'), 'export const miel = true;\n');
    writeFileSync(path.join(depot, '.env'), 'SECRET_DU_DEPOT=nectar\n');
    await git.add('.');
    await git.commit('base');

    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'data', 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;

    jetonMembre = await inscrire('membre@exemple.test');
    jetonIntrus = await inscrire('intrus@exemple.test');

    publicId = server.store.createProject({
      name: 'Projet ouvert',
      repoUrl: depot,
      visibility: 'public',
    }).id;
    priveId = server.store.createProject({
      name: 'Projet fermé',
      repoUrl: depot,
      visibility: 'private',
      ownerId: 'le-proprietaire',
    }).id;
    // Le membre est rattaché au projet privé ; l'intrus non.
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${jetonMembre}` } })
    ).json()) as { id: string };
    server.store.addMember(priveId, moi.id);
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('la première garde : qui a affaire à ce dépôt', () => {
    it('un membre du projet privé lit son code', async () => {
      const res = await lire(jetonMembre, priveId);
      expect(res.status).toBe(200);
      const { entrees } = (await res.json()) as { entrees: Entree[] };
      expect(entrees.map((e) => e.nom)).toContain('README.md');
    });

    it('UN INTRUS NE LIT PAS LE CODE D’UN PROJET PRIVÉ', async () => {
      expect((await lire(jetonIntrus, priveId)).status).toBe(404);
      expect((await fichier(jetonIntrus, priveId, 'src/index.ts')).status).toBe(404);
    });

    it('LE REFUS EST INDISTINGUABLE DE L’INEXISTENCE, À L’OCTET PRÈS', async () => {
      const refuse = await lire(jetonIntrus, priveId);
      const inexistant = await lire(jetonIntrus, 'projet-qui-nexiste-pas');
      expect(refuse.status).toBe(inexistant.status);
      expect(await refuse.text()).toBe(await inexistant.text());
    });

    it('un projet public se lit par tout compte authentifié', async () => {
      expect((await lire(jetonIntrus, publicId)).status).toBe(200);
    });

    it('sans authentification, rien', async () => {
      const res = await fetch(`${base}/api/projects/${publicId}/rayon`);
      expect(res.status).toBe(401);
    });
  });

  describe('la seconde garde : ce qui ne se sert jamais, même à un ayant droit', () => {
    it('`.git` EST REFUSÉ AU MEMBRE LUI-MÊME — il porte l’URL distante', async () => {
      // Sans cette garde, un membre légitime repart avec le jeton GitHub de
      // l'hôte, qui n'a jamais été à lui.
      expect((await fichier(jetonMembre, priveId, '.git/config')).status).toBe(403);
      expect((await lire(jetonMembre, priveId, '.git')).status).toBe(403);
    });

    it('LE `.env` DU DÉPÔT N’EST NI LISTÉ NI LU', async () => {
      const { entrees } = (await (await lire(jetonMembre, priveId)).json()) as {
        entrees: Entree[];
      };
      expect(entrees.map((e) => e.nom)).not.toContain('.env');
      expect((await fichier(jetonMembre, priveId, '.env')).status).toBe(403);
    });

    it('LA TRAVERSÉE EST REFUSÉE, SOUS TOUTES SES FORMES', async () => {
      for (const tentative of [
        '../../../etc/passwd',
        '..',
        '/etc/passwd',
        'src/../../../etc/passwd',
        '..\\..\\.env',
      ]) {
        const res = await fichier(jetonMembre, priveId, tentative);
        expect(res.status, tentative).toBe(403);
      }
    });

    it('l’encodage d’URL ne contourne rien', async () => {
      // `%2e%2e%2f` est décodé par Fastify avant d'arriver : la garde voit bien
      // `../`, et c'est ce qu'on vérifie plutôt que de le supposer.
      const res = await fetch(
        `${base}/api/projects/${priveId}/rayon/fichier?chemin=%2e%2e%2f%2e%2e%2fetc%2fpasswd`,
        { headers: { authorization: `Bearer ${jetonMembre}` } },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('lire pour de vrai', () => {
    it('rend le contenu et le langage', async () => {
      const res = await fichier(jetonMembre, priveId, 'src/index.ts');
      expect(res.status).toBe(200);
      const f = (await res.json()) as { contenu: string; langage: string };
      expect(f.contenu).toBe('export const miel = true;\n');
      expect(f.langage).toBe('typescript');
    });

    it('descend dans un sous-dossier', async () => {
      const { entrees } = (await (await lire(jetonMembre, priveId, 'src')).json()) as {
        entrees: Entree[];
      };
      expect(entrees.map((e) => e.chemin)).toEqual(['src/index.ts']);
    });

    it('un chemin vide sur le fichier est une erreur claire, pas la racine', async () => {
      expect((await fichier(jetonMembre, priveId, '')).status).toBe(400);
    });

    it('un fichier absent dit 404, distinct du 403 d’un chemin interdit', async () => {
      // La distinction est utile ici : rien n'est caché à ce lecteur, il s'est
      // simplement trompé de nom.
      expect((await fichier(jetonMembre, priveId, 'src/jamais.ts')).status).toBe(404);
    });

    it('un projet sans dépôt le dit au lieu de faire semblant', async () => {
      const sansDepot = server.store.createProject({ name: 'Sans dépôt', visibility: 'public' }).id;
      const res = await lire(jetonMembre, sansDepot);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/dépôt/);
    });
  });
});
