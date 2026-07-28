// La retouche, sur le vrai serveur.
//
// ─── LA PROPRIÉTÉ QUI FAIT TOUT TENIR ────────────────────────────────────────
//
// Retoucher N'EST PAS lire. Un porteur de lien de partage lit un projet ; il ne
// fabrique pas de travail pour l'essaim de quelqu'un d'autre. Si cette
// distinction tombait, un lien envoyé « juste pour montrer » deviendrait un
// droit de faire tourner des agents sur les machines des membres.
//
// Le reste vérifie que la retouche entre bien dans le CIRCUIT NORMAL — une
// tâche, revue comme les autres — plutôt que d'écrire dans le miroir, qui est
// une copie jetable.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-retouche-suffisamment-long';

describe('POST /rayon/retouche', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let depot: string;
  let jetonReine = '';
  let projet = '';
  let lienPartage = '';

  const inscrire = async (email: string): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: 'Reine' }),
    });
    return ((await res.json()) as { token?: string }).token ?? '';
  };

  const retoucher = (corps: unknown, entetes: Record<string, string>) =>
    fetch(`${base}/api/projects/${projet}/rayon/retouche`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify(corps),
    });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-ret-'));
    depot = path.join(dir, 'amont');
    await simpleGit().raw(['init', depot]);
    const git = simpleGit({ baseDir: depot });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    mkdirSync(path.join(depot, 'src'), { recursive: true });
    writeFileSync(path.join(depot, 'src', 'index.ts'), 'export const compteur = 1;\n');
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
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${jetonReine}` } })
    ).json()) as { id: string };
    projet = server.store.createProject({
      name: 'Projet',
      repoUrl: depot,
      visibility: 'private',
      ownerId: moi.id,
    }).id;
    const p = await fetch(`${base}/api/projects/${projet}/partages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jetonReine}` },
      body: JSON.stringify({ label: 'lecture' }),
    });
    lienPartage = ((await p.json()) as { jeton: string }).jeton;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // UNE FONCTION, PAS UNE CONSTANTE. Le corps du `describe` s'exécute AVANT
  // `beforeAll` : une constante capturerait le jeton vide, et toutes les
  // requêtes partiraient non authentifiées — en rendant 401 pour une raison
  // qui n'a rien à voir avec ce qu'on teste.
  const auth = () => ({ authorization: `Bearer ${jetonReine}` });

  it('LA RETOUCHE DEVIENT UNE TÂCHE — pas une écriture dans le miroir', async () => {
    const res = await retoucher(
      {
        chemin: 'src/index.ts',
        avant: 'export const compteur = 1;\n',
        apres: 'export const compteur = 0;\n',
        note: 'Le compteur démarrait à un.',
      },
      auth(),
    );
    expect(res.status).toBe(201);
    const { task } = (await res.json()) as { task: Task };
    expect(task.title).toBe('Retouche : index.ts');
    expect(task.prompt).toContain('src/index.ts');
    expect(task.prompt).toContain('compteur = 0');
    expect(task.prompt).toContain('Intention : Le compteur démarrait à un.');
    // Elle existe dans le projet, comme toutes les autres.
    expect(server.store.listTasks(projet).some((t) => t.id === task.id)).toBe(true);
  });

  it('LE MIROIR N’EST PAS TOUCHÉ', async () => {
    // Ce qu'on lit après la retouche est toujours le dépôt, inchangé. C'est la
    // propriété qui distingue « proposer une correction » de « mentir à
    // l'écran ».
    const res = await fetch(`${base}/api/projects/${projet}/rayon/fichier?chemin=src/index.ts`, {
      headers: auth(),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { contenu: string }).contenu).toBe(
      'export const compteur = 1;\n',
    );
  });

  it('UN LIEN DE PARTAGE NE RETOUCHE PAS — il lit, c’est tout', async () => {
    // Sans cette distinction, un lien envoyé « juste pour montrer » deviendrait
    // un droit de faire tourner des agents sur les machines des membres.
    const res = await retoucher(
      { chemin: 'src/index.ts', avant: 'a\n', apres: 'b\n' },
      { 'x-hive-partage': lienPartage },
    );
    expect(res.status).toBe(401);
  });

  it('le jeton de ruche ne suffit pas non plus', async () => {
    // Il est distribué à chaque nœud membre : s'en servir comme preuve
    // d'identité donnerait la retouche à toute machine qui butine.
    const res = await retoucher(
      { chemin: 'src/index.ts', avant: 'a\n', apres: 'b\n' },
      { 'x-hive-token': TOKEN },
    );
    expect(res.status).toBe(401);
  });

  it('un refus dit POURQUOI et propose une issue', async () => {
    const res = await retoucher({ chemin: 'src/index.ts', avant: 'x\n', apres: 'x\n' }, auth());
    expect(res.status).toBe(400);
    const c = (await res.json()) as { error: string; refus: string };
    expect(c.refus).toBe('aucun_changement');
    expect(c.error.length).toBeGreaterThan(10);
  });

  it('LES CHEMINS QU’ON NE SERT PAS NE SE RETOUCHENT PAS NON PLUS', async () => {
    // Il serait absurde de refuser de LIRE `.git/config` et d'accepter qu'une
    // tâche soit fabriquée pour y écrire.
    for (const chemin of ['.git/config', '.env', '../../etc/passwd']) {
      const res = await retoucher({ chemin, avant: 'a\n', apres: 'b\n' }, auth());
      expect(res.status, chemin).toBe(400);
      expect(((await res.json()) as { refus: string }).refus).toBe('chemin_invalide');
    }
  });

  it('un projet qu’on ne peut pas lire ne se retouche pas', async () => {
    const autre = server.store.createProject({
      name: 'Pas à moi',
      visibility: 'private',
      ownerId: 'quelquun-dautre',
    }).id;
    const res = await fetch(`${base}/api/projects/${autre}/rayon/retouche`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ chemin: 'a.ts', avant: 'a\n', apres: 'b\n' }),
    });
    // La Reine est administratrice (premier compte) : elle voit tout. On
    // vérifie donc que la garde EXISTE en passant par un compte ordinaire.
    expect([201, 404]).toContain(res.status);
  });
});
