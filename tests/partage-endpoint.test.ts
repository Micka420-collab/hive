// Le partage en lecture, sur le vrai serveur.
//
// ─── CE QUE CE FICHIER DOIT PROUVER ──────────────────────────────────────────
//
// Pas « le lien marche » — ça, c'est la partie facile. Ce qu'il doit prouver,
// c'est tout ce que le lien NE PEUT PAS FAIRE, parce qu'un lien de partage se
// colle dans un fil de discussion : il survit dans l'historique du navigateur,
// le presse-papiers, la capture d'écran envoyée à un tiers.
//
// Quatre choses, donc, et chacune a été une faille réelle ailleurs :
//
//   1. Il n'ouvre QU'UN projet. Un lien donné pour montrer un projet ne doit
//      pas ouvrir les autres, privés compris.
//   2. Il ne fait QUE lire. Aucune écriture, sur aucune route.
//   3. Il ne vaut PAS un compte. Il ne remplace pas le JWT sur les routes qui
//      en demandent un — sinon le destinataire deviendrait membre.
//   4. Il se REPREND. Révoqué, il ne sert plus, tout de suite.
//
// Et une cinquième, plus discrète : le secret ne se relit pas. Une liste qui
// remontrerait le jeton ferait de la fuite d'un écran la fuite de tous les
// liens.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-partage-suffisamment-long-42';

describe('les liens de partage', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let depot: string;
  let jetonReine = '';
  let jetonIntrus = '';
  let projetA = '';
  let projetB = '';
  let lien = '';
  let lienId = '';

  const inscrire = async (email: string): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: 'Abeille' }),
    });
    return ((await res.json()) as { token?: string }).token ?? '';
  };

  /** Une lecture du rayon présentée avec un lien de partage, et rien d'autre. */
  const avecLien = (projectId: string, jeton: string, chemin = '') =>
    fetch(
      `${base}/api/projects/${projectId}/rayon${chemin === '' ? '' : `?chemin=${encodeURIComponent(chemin)}`}`,
      { headers: { 'x-hive-partage': jeton } },
    );

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-partage-'));
    depot = path.join(dir, 'amont');
    await simpleGit().raw(['init', depot]);
    const git = simpleGit({ baseDir: depot });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    mkdirSync(path.join(depot, 'src'), { recursive: true });
    writeFileSync(path.join(depot, 'README.md'), '# Vitrine\n');
    writeFileSync(path.join(depot, 'src', 'a.ts'), 'export const a = 1;\n');
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
    jetonReine = await inscrire('reine@exemple.test');
    jetonIntrus = await inscrire('intrus@exemple.test');

    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${jetonReine}` } })
    ).json()) as { id: string };
    projetA = server.store.createProject({
      name: 'Projet A',
      repoUrl: depot,
      visibility: 'private',
      ownerId: moi.id,
    }).id;
    projetB = server.store.createProject({
      name: 'Projet B (privé, pas partagé)',
      repoUrl: depot,
      visibility: 'private',
      ownerId: 'quelquun-dautre',
    }).id;

    const res = await fetch(`${base}/api/projects/${projetA}/partages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jetonReine}` },
      body: JSON.stringify({ label: 'pour le client' }),
    });
    const corps = (await res.json()) as { id: string; jeton: string };
    lien = corps.jeton;
    lienId = corps.id;
    expect(lien.startsWith('hive3_')).toBe(true);
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('ce que le lien PEUT faire', () => {
    it('lire le code du projet partagé, SANS AUCUN COMPTE', async () => {
      const res = await avecLien(projetA, lien);
      expect(res.status).toBe(200);
      const { entrees } = (await res.json()) as { entrees: { nom: string }[] };
      expect(entrees.map((e) => e.nom)).toContain('README.md');
    });

    it('le jeton passe aussi par la requête, pour qu’un lien collable existe', async () => {
      const res = await fetch(
        `${base}/api/projects/${projetA}/rayon?partage=${encodeURIComponent(lien)}`,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('CE QUE LE LIEN NE PEUT PAS FAIRE', () => {
    it('IL N’OUVRE PAS UN AUTRE PROJET', async () => {
      // La propriété qui fait tenir toute la fonctionnalité : sans elle, le
      // premier partage serait une fuite de tous les projets privés.
      expect((await avecLien(projetB, lien)).status).toBe(401);
    });

    it('IL NE FABRIQUE PAS D’AUTRES LIENS', async () => {
      // Sans cette asymétrie, révoquer ne servirait à rien : le destinataire
      // s'en serait refait un.
      const res = await fetch(`${base}/api/projects/${projetA}/partages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hive-partage': lien },
        body: JSON.stringify({ label: 'et un de plus' }),
      });
      expect(res.status).toBe(401);
    });

    it('IL NE VAUT PAS UN COMPTE sur les routes qui en demandent un', async () => {
      for (const route of [
        `/api/projects/${projetA}/members`,
        `/api/projects/${projetA}/partages`,
        '/api/auth/me',
      ]) {
        const res = await fetch(`${base}${route}`, { headers: { 'x-hive-partage': lien } });
        expect(res.status, route).toBe(401);
      }
    });

    it('IL N’ÉCRIT RIEN', async () => {
      const res = await fetch(`${base}/api/projects/${projetA}/join`, {
        method: 'POST',
        headers: { 'x-hive-partage': lien },
      });
      expect(res.status).toBe(401);
    });

    it('il ne contourne pas la seconde garde : `.git` reste fermé', async () => {
      // Les deux gardes sont indépendantes. Un porteur de lien n'a pas plus de
      // droit sur `.git` qu'un membre — c'est-à-dire aucun.
      const res = await fetch(
        `${base}/api/projects/${projetA}/rayon/fichier?chemin=.git/config&partage=${encodeURIComponent(lien)}`,
      );
      expect(res.status).toBe(403);
    });

    it('un jeton bricolé ne passe pas', async () => {
      for (const faux of [
        'hive3_pas-du-base64!!',
        'hive2_eyJ2IjoyfQ',
        `${lien}x`,
        lien.slice(0, -4),
        '',
      ]) {
        expect((await avecLien(projetA, faux)).status, faux.slice(0, 24)).toBe(401);
      }
    });
  });

  describe('reprendre le lien', () => {
    it('la liste montre le lien SANS SON SECRET', async () => {
      // Une liste qui remontrerait le jeton ferait de la fuite d'un écran la
      // fuite de tous les liens.
      const res = await fetch(`${base}/api/projects/${projetA}/partages`, {
        headers: { authorization: `Bearer ${jetonReine}` },
      });
      const texte = await res.text();
      expect(res.status).toBe(200);
      expect(texte).toContain(lienId);
      expect(texte, 'le jeton est republié').not.toContain(lien);
      expect(texte, 'l’empreinte ne sort pas non plus').not.toContain('secretHash');
    });

    it('RÉVOQUÉ, IL NE SERT PLUS — tout de suite', async () => {
      expect((await avecLien(projetA, lien)).status).toBe(200);
      const rev = await fetch(`${base}/api/projects/${projetA}/partages/${lienId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jetonReine}` },
      });
      expect(rev.status).toBe(200);
      expect((await avecLien(projetA, lien)).status).toBe(401);
    });

    it('re-révoquer n’est pas une erreur', async () => {
      const res = await fetch(`${base}/api/projects/${projetA}/partages/${lienId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jetonReine}` },
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { change: boolean }).change).toBe(false);
    });

    it('un intrus ne révoque pas les liens d’autrui', async () => {
      const res = await fetch(`${base}/api/projects/${projetA}/partages/${lienId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jetonIntrus}` },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('l’élagage', () => {
    it('NE TOUCHE PAS AUX LIENS VIVANTS', async () => {
      // Un lien vivant qui disparaîtrait deviendrait silencieusement
      // inutilisable chez celui à qui on l'a envoyé, sans que personne puisse
      // dire pourquoi.
      const res = await fetch(`${base}/api/projects/${projetA}/partages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jetonReine}` },
        body: JSON.stringify({ label: 'vivant' }),
      });
      const vivant = (await res.json()) as { id: string };
      server.store.prunePartages(0);
      expect(server.store.getPartage(vivant.id)).toBeDefined();
      // …et il emporte bien les morts.
      expect(server.store.getPartage(lienId)).toBeUndefined();
    });
  });
});
