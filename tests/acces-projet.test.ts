// Rejoindre un projet, et voir qui y travaille — deux portes qui n'étaient pas
// fermées.
//
// `POST /api/projects/:id/join` ne vérifiait qu'une chose : que l'appelant soit
// authentifié. N'importe quel compte pouvait donc s'ajouter à N'IMPORTE QUEL
// projet, privé compris. `GET /api/projects/:id/members` avait le même trou :
// la liste nominative des membres d'un projet privé était lisible par tout
// titulaire d'un compte — créer un compte suffisait à énumérer qui travaille
// sur quoi.
//
// La colonne `visibility` existait depuis le début, et `ownerId` aussi. Aucun
// des deux n'était consulté ici.
//
// ─── LE TEST QUI COMPTE ──────────────────────────────────────────────────────
//
// Ce n'est pas « le refus arrive » : c'est que le refus soit INDISTINGUABLE de
// l'inexistence, à l'octet près. Un « 403 interdit » confirmerait que le projet
// existe, et répété sur une liste d'identifiants il dessinerait la carte des
// projets de la ruche. Les identifiants voyagent — une URL collée dans un
// salon, un journal, un signet.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { peutRejoindre, peutVoirMembres } from '../src/shared/acces-projet.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

describe('la décision, seule', () => {
  const publique = { visibility: 'public' as const, ownerId: 'proprio' };
  const privee = { visibility: 'private' as const, ownerId: 'proprio' };

  it('un projet PUBLIC est ouvert — c’est ce que le mot veut dire', () => {
    expect(peutRejoindre(publique, 'inconnu', false)).toBe(true);
    expect(peutVoirMembres(publique, 'inconnu', false)).toBe(true);
  });

  it('UN PROJET PRIVÉ NE S’OUVRE PAS TOUT SEUL', () => {
    expect(peutRejoindre(privee, 'inconnu', false)).toBe(false);
    expect(peutVoirMembres(privee, 'inconnu', false)).toBe(false);
  });

  it('le propriétaire et les membres passent', () => {
    expect(peutRejoindre(privee, 'proprio', false)).toBe(true);
    expect(peutRejoindre(privee, 'membre', true)).toBe(true);
    expect(peutVoirMembres(privee, 'proprio', false)).toBe(true);
    expect(peutVoirMembres(privee, 'membre', true)).toBe(true);
  });

  it('un projet SANS propriétaire ne s’ouvre pas à qui n’en a pas non plus', () => {
    // `ownerId` est nullable en base. Comparer `null === undefined`-ment ferait
    // du premier venu le propriétaire de tous les projets orphelins.
    const orphelin = { visibility: 'private' as const, ownerId: null };
    expect(peutRejoindre(orphelin, 'quelquun', false)).toBe(false);
    expect(peutVoirMembres(orphelin, 'quelquun', false)).toBe(false);
  });
});

describe('sur le vrai serveur', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let prive: string;
  let publicId: string;
  let jetonIntrus: string;
  const TOKEN = 'jeton-acces-projet-suffisamment-long';

  const inscrire = async (email: string): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: 'Intrus' }),
    });
    const corps = (await res.json()) as { token?: string };
    return corps.token ?? '';
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-acc-'));
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
    prive = server.store.createProject({
      name: 'Projet privé',
      visibility: 'private',
      ownerId: 'un-autre-compte',
    }).id;
    publicId = server.store.createProject({ name: 'Projet public', visibility: 'public' }).id;
    jetonIntrus = await inscrire('intrus@exemple.test');
    expect(jetonIntrus, "l'inscription doit rendre un jeton").not.toBe('');
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const joindre = (id: string) =>
    fetch(`${base}/api/projects/${id}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jetonIntrus}` },
    });
  const membres = (id: string) =>
    fetch(`${base}/api/projects/${id}/members`, {
      headers: { authorization: `Bearer ${jetonIntrus}` },
    });

  it('UN INCONNU NE S’AJOUTE PLUS À UN PROJET PRIVÉ', async () => {
    const res = await joindre(prive);
    expect(res.status).toBe(404);
    // …et il n'est pas devenu membre malgré tout.
    expect(server.store.listMembers(prive)).toHaveLength(0);
  });

  it('LE REFUS EST INDISTINGUABLE DE L’INEXISTENCE, À L’OCTET PRÈS', async () => {
    // C'est ce test-là qui ferme l'énumération. Sans lui, un « 403 » poli
    // suffirait à cartographier les projets de la ruche.
    const refuse = await joindre(prive);
    const inexistant = await joindre('projet-qui-nexiste-pas');
    expect(refuse.status).toBe(inexistant.status);
    expect(await refuse.text()).toBe(await inexistant.text());
  });

  it('la liste nominative des membres d’un projet privé est fermée', async () => {
    const refuse = await membres(prive);
    const inexistant = await membres('projet-qui-nexiste-pas');
    expect(refuse.status).toBe(404);
    expect(await refuse.text()).toBe(await inexistant.text());
  });

  it('un projet PUBLIC reste ouvert — la garde ne casse pas la ruche communautaire', async () => {
    const res = await joindre(publicId);
    expect(res.status).toBe(200);
    expect(server.store.estMembre(publicId, server.store.listMembers(publicId)[0]!.userId)).toBe(
      true,
    );
    expect((await membres(publicId)).status).toBe(200);
  });

  it('rejoindre deux fois reste sans effet, pas une erreur', async () => {
    expect((await joindre(publicId)).status).toBe(200);
    expect(server.store.listMembers(publicId)).toHaveLength(1);
  });
});
