// Contrat HTTP des comptes.
//
// Trois choses sont vérifiées contre un vrai serveur, parce qu'un module pur
// ne peut garantir aucune des trois tout seul :
//
//   1. la force brute est arrêtée AVANT le PBKDF2 — un verrou qui
//      s'appliquerait après ne protégerait ni le mot de passe ni le CPU ;
//   2. le premier compte est admin, et personne ne se promeut ensuite ;
//   3. le jeton de RUCHE ne vaut pas preuve d'administration — il est partagé
//      avec chaque nœud membre.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ECHECS_COMPTE, LONGUEUR_MIN } from '../src/orchestrator/comptes.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-comptes-assez-long-ok';
const MDP = 'la ruche bourdonne au matin';

describe('endpoint des comptes', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  let avant: string | undefined;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    if (avant === undefined) delete process.env.HIVE_INSCRIPTION;
    else process.env.HIVE_INSCRIPTION = avant;
  });

  async function demarrer(inscription?: string): Promise<string> {
    avant = process.env.HIVE_INSCRIPTION;
    if (inscription) process.env.HIVE_INSCRIPTION = inscription;
    else delete process.env.HIVE_INSCRIPTION;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-comptes-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    return `http://127.0.0.1:${server.port}`;
  }

  const json = { 'content-type': 'application/json' };

  const inscrire = (base: string, email: string, password = MDP): Promise<Response> =>
    fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email, password, displayName: 'Testeur' }),
    });

  const connecter = (base: string, email: string, password: string): Promise<Response> =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email, password }),
    });

  it('le premier compte est ADMIN, le second est membre', async () => {
    const base = await demarrer();
    const un = (await (await inscrire(base, 'un@x.fr')).json()) as { role: string };
    const deux = (await (await inscrire(base, 'deux@x.fr')).json()) as { role: string };
    expect(un.role).toBe('admin');
    expect(deux.role).toBe('membre');
  });

  it('un membre ne voit PAS l’administration', async () => {
    const base = await demarrer();
    await inscrire(base, 'chef@x.fr');
    const membre = (await (await inscrire(base, 'simple@x.fr')).json()) as { token: string };
    const rep = await fetch(`${base}/api/admin/membres`, {
      headers: { authorization: `Bearer ${membre.token}` },
    });
    expect(rep.status).toBe(403);
  });

  it('un admin voit l’administration', async () => {
    const base = await demarrer();
    const chef = (await (await inscrire(base, 'chef@x.fr')).json()) as { token: string };
    const rep = await fetch(`${base}/api/admin/membres`, {
      headers: { authorization: `Bearer ${chef.token}` },
    });
    expect(rep.status).toBe(200);
    const vue = (await rep.json()) as { membres: Array<{ role: string }>; admins: number };
    expect(vue.admins).toBe(1);
    expect(vue.membres[0]?.role).toBe('admin');
  });

  it('LE JETON DE RUCHE NE VAUT PAS PREUVE D’ADMINISTRATION', async () => {
    // Il est partagé avec chaque nœud membre : s'en servir comme preuve
    // donnerait les pleins pouvoirs à toute machine qui butine.
    const base = await demarrer();
    await inscrire(base, 'chef@x.fr');
    const rep = await fetch(`${base}/api/admin/membres`, { headers: { 'x-hive-token': TOKEN } });
    expect(rep.status).toBe(401);
  });

  it('un membre ne se promeut pas lui-même', async () => {
    const base = await demarrer();
    await inscrire(base, 'chef@x.fr');
    const membre = (await (await inscrire(base, 'simple@x.fr')).json()) as { token: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${membre.token}` } })
    ).json()) as { id: string };

    const rep = await fetch(`${base}/api/admin/membres/${moi.id}/role`, {
      method: 'PUT',
      headers: { ...json, authorization: `Bearer ${membre.token}` },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(rep.status).toBe(403);
  });

  it('le DERNIER admin ne peut pas se retirer', async () => {
    // Une ruche sans admin ne s'administre plus, et il n'y a pas de mot de
    // passe root pour s'en sortir.
    const base = await demarrer();
    const chef = (await (await inscrire(base, 'chef@x.fr')).json()) as { token: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${chef.token}` } })
    ).json()) as { id: string };

    const rep = await fetch(`${base}/api/admin/membres/${moi.id}/role`, {
      method: 'PUT',
      headers: { ...json, authorization: `Bearer ${chef.token}` },
      body: JSON.stringify({ role: 'membre' }),
    });
    expect(rep.status).toBe(409);
    expect(((await rep.json()) as { error: string }).error).toMatch(/dernier administrateur/);
  });

  it('un admin peut en nommer un autre', async () => {
    const base = await demarrer();
    const chef = (await (await inscrire(base, 'chef@x.fr')).json()) as { token: string };
    const membre = (await (await inscrire(base, 'simple@x.fr')).json()) as { token: string };
    const cible = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${membre.token}` } })
    ).json()) as { id: string };

    const rep = await fetch(`${base}/api/admin/membres/${cible.id}/role`, {
      method: 'PUT',
      headers: { ...json, authorization: `Bearer ${chef.token}` },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(rep.status).toBe(200);

    // …et le nouveau rôle est réellement effectif.
    const vue = await fetch(`${base}/api/admin/membres`, {
      headers: { authorization: `Bearer ${membre.token}` },
    });
    expect(vue.status).toBe(200);
  });

  it('LA FORCE BRUTE EST ARRÊTÉE, et avant le PBKDF2', async () => {
    const base = await demarrer();
    await inscrire(base, 'cible@x.fr');

    // Les premiers échecs répondent 401 : la vérification a bien lieu.
    for (let i = 0; i < ECHECS_COMPTE; i++) {
      const r = await connecter(base, 'cible@x.fr', 'mauvais mot de passe');
      expect(r.status, `essai ${i + 1}`).toBe(401);
    }
    // Puis le verrou tombe.
    const bloque = await connecter(base, 'cible@x.fr', 'mauvais mot de passe');
    expect(bloque.status).toBe(429);
    expect(bloque.headers.get('retry-after')).toBeTruthy();

    // Et il tient MÊME AVEC LE BON MOT DE PASSE : sinon un attaquant saurait
    // qu'il a trouvé, puisque la réponse changerait.
    const bon = await connecter(base, 'cible@x.fr', MDP);
    expect(bon.status).toBe(429);
  });

  it('une réussite efface l’ardoise', async () => {
    // Quelqu'un qui finit par se souvenir de son mot de passe ne doit pas
    // rester à un essai du verrou.
    const base = await demarrer();
    await inscrire(base, 'moi@x.fr');
    for (let i = 0; i < ECHECS_COMPTE - 1; i++) await connecter(base, 'moi@x.fr', 'raté');
    expect((await connecter(base, 'moi@x.fr', MDP)).status).toBe(200);
    for (let i = 0; i < ECHECS_COMPTE - 1; i++) {
      expect((await connecter(base, 'moi@x.fr', 'raté')).status).toBe(401);
    }
  });

  it('la réponse ne dit JAMAIS si le compte existe', async () => {
    // Distinguer « email inconnu » de « mot de passe faux » offrirait un
    // annuaire des inscrits — et savoir qui participe est déjà une information.
    const base = await demarrer();
    await inscrire(base, 'connu@x.fr');
    const connu = await connecter(base, 'connu@x.fr', 'faux');
    const inconnu = await connecter(base, 'jamais-vu@x.fr', 'faux');
    expect(connu.status).toBe(inconnu.status);
    expect(await connu.json()).toEqual(await inconnu.json());
  });

  it('un mot de passe faible est refusé, avec un conseil utile', async () => {
    const base = await demarrer();
    const rep = await inscrire(base, 'faible@x.fr', 'motdepasse1');
    expect(rep.status).toBe(400);
    const err = ((await rep.json()) as { error: string }).error;
    expect(err).toMatch(new RegExp(`${LONGUEUR_MIN} caractères|listes d’attaque`));
  });

  it('inscriptions FERMÉES : le premier compte passe, les suivants non', async () => {
    // Sans cette exception, une ruche installée en « fermée » serait
    // définitivement inutilisable : aucun moyen de créer son administrateur.
    const base = await demarrer('fermee');
    expect((await inscrire(base, 'premier@x.fr')).status).toBe(200);
    const second = await inscrire(base, 'second@x.fr');
    expect(second.status).toBe(403);
    expect(((await second.json()) as { error: string }).error).toMatch(/fermées/);
  });

  it('l’admin est averti quand les inscriptions restent ouvertes', async () => {
    const base = await demarrer();
    const chef = (await (await inscrire(base, 'chef@x.fr')).json()) as { token: string };
    const vue = (await (
      await fetch(`${base}/api/admin/membres`, {
        headers: { authorization: `Bearer ${chef.token}` },
      })
    ).json()) as { inscription: { avertissement: string } };
    expect(vue.inscription.avertissement).toMatch(/OUVERTES/);
  });

  it('/api/auth/me porte le rôle', async () => {
    const base = await demarrer();
    const chef = (await (await inscrire(base, 'chef@x.fr')).json()) as { token: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${chef.token}` } })
    ).json()) as { role: string; passwordHash?: string };
    expect(moi.role).toBe('admin');
    // …et jamais le hash.
    expect(moi.passwordHash).toBeUndefined();
  });
});
