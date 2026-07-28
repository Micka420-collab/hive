// LIRE SON PROPRE PROJET SANS LE JETON DE RUCHE — l'incohérence d'autorisation
// que l'espace projet traînait.
//
// ─── CE QUI CLOCHAIT ─────────────────────────────────────────────────────────
//
// Onze routes de l'espace projet se gardent par le seul JETON DE RUCHE, sans
// aucune règle par projet, là où Le Rayon, les membres et les partages se
// gardent par COMPTE. Conséquence visible tout de suite : un compte qui appelle
// l'API sans le jeton de ruche recevait 401 sur le rapport de SON PROPRE
// projet. Le tableau de bord ne s'en apercevait pas — il envoie les deux
// en-têtes — mais toute autre intégration s'y cogne.
//
// ─── CE QUE CE LOT FAIT, ET CE QU'IL NE FAIT PAS ─────────────────────────────
//
// Il AJOUTE la porte du compte sur les LECTURES. Il n'en retire aucune : ce qui
// passait hier passe encore. C'est délibérément une ouverture, pas un
// resserrement — resserrer casserait la CLI (qui n'a que le jeton de ruche) et
// le mode « tableau de bord sans compte », tous deux documentés.
//
// ⚠ IL NE RÉSOUT PAS LE FOND, et ce fichier le dit plutôt que de le laisser
// croire. Le README annonce que `HIVE_TOKEN` se recopie sur chaque machine
// membre : tant que la porte du jeton reste ouverte sur ces routes, toute
// abeille de l'essaim lit le plan de merge, la balance et les tâches de
// n'importe quel projet. Le dernier test ci-dessous CONSTATE cet état — il
// échouera le jour où quelqu'un tranchera, et c'est exactement ce qu'on veut :
// que la décision soit prise sciemment, pas découverte par surprise.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-lecture-suffisamment-long-42';

/** Les lectures projet auxquelles ce lot ouvre la porte du compte. */
const LECTURES = ['merge', 'merge/result', 'conflicts', 'balance', 'essaim', 'abonnement'];

describe('lire un projet avec un COMPTE, sans le jeton de ruche', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let jetonProprietaire = '';
  let jetonTiers = '';
  let projet = '';

  const inscrire = async (email: string): Promise<{ token: string; id: string }> => {
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    const { token } = (await r.json()) as { token: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { id: string };
    return { token, id: moi.id };
  };

  /** Un appel signé par le COMPTE SEUL — jamais de jeton de ruche. */
  const parCompte = (jeton: string, chemin: string) =>
    fetch(`${base}/api/projects/${projet}/${chemin}`, {
      headers: { authorization: `Bearer ${jeton}` },
    });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-lect-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;

    // Le PREMIER compte est administrateur par amorçage : on l'absorbe, sinon
    // `voir_tous_les_projets` masquerait tout et le fichier serait creux.
    await inscrire('admin@lect.test');
    const proprio = await inscrire('proprio@lect.test');
    jetonProprietaire = proprio.token;
    jetonTiers = (await inscrire('tiers@lect.test')).token;

    projet = server.store.createProject({
      name: 'Projet du propriétaire',
      visibility: 'private',
      ownerId: proprio.id,
    }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('LE PROPRIÉTAIRE LIT SON PROJET AVEC SON SEUL COMPTE', async () => {
    for (const chemin of LECTURES) {
      const res = await parCompte(jetonProprietaire, chemin);
      expect(res.status, `${chemin} refuse le propriétaire`).not.toBe(401);
      expect(res.status, chemin).not.toBe(404);
    }
  });

  it('UN TIERS NE LIT PAS LE PROJET PRIVÉ D’AUTRUI', async () => {
    // L'ouverture ne doit ouvrir qu'à qui a affaire au projet : sinon on aurait
    // remplacé une incohérence par une fuite.
    for (const chemin of LECTURES) {
      const res = await parCompte(jetonTiers, chemin);
      expect(res.status, `${chemin} laisse passer un tiers`).toBe(401);
    }
  });

  it('L’ANCIENNE PORTE RESTE OUVERTE — la CLI n’est pas cassée', async () => {
    // C'est une ouverture, pas un resserrement. La CLI n'a que le jeton de
    // ruche, et le mode « tableau de bord sans compte » est documenté.
    for (const chemin of LECTURES) {
      const res = await fetch(`${base}/api/projects/${projet}/${chemin}`, {
        headers: { 'x-hive-token': TOKEN },
      });
      expect(res.status, chemin).not.toBe(401);
    }
  });

  it('sans rien du tout, refus', async () => {
    for (const chemin of LECTURES) {
      const res = await fetch(`${base}/api/projects/${projet}/${chemin}`);
      expect(res.status, chemin).toBe(401);
    }
  });

  it('CONSTAT — le jeton de ruche ouvre encore TOUT projet, et c’est le fond', async () => {
    // Ce test ne défend pas cet état : il le CONSTATE, pour qu'on ne le
    // découvre pas par surprise. Le README dit que `HIVE_TOKEN` se recopie sur
    // chaque machine membre ; toute abeille de l'essaim lit donc le plan de
    // merge et la balance de n'importe quel projet, y compris privé et dont
    // elle n'est pas membre.
    //
    // Le jour où l'hôte tranche — resserrer les écritures, donner un compte à
    // la CLI, ou séparer jeton d'opérateur et clé de nœud — CE TEST ÉCHOUERA.
    // C'est voulu : il faudra alors le réécrire sciemment, ce qui est
    // exactement le geste qu'on veut rendre explicite.
    const autre = server.store.createProject({
      name: 'Projet de quelqu’un d’autre',
      visibility: 'private',
      ownerId: 'une-personne-qui-n-est-pas-nous',
    }).id;
    const res = await fetch(`${base}/api/projects/${autre}/merge`, {
      headers: { 'x-hive-token': TOKEN },
    });
    expect(
      res.status,
      'si ce test échoue, quelqu’un a resserré la garde — mettez ce fichier à jour ' +
        'et retirez ce constat, il aura fait son travail',
    ).toBe(200);
  });
});
