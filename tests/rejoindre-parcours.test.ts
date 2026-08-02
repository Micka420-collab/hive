// REJOINDRE UN PROJET OUVERT — le parcours que personne n'avait jamais marché.
//
// ─── CE QUI EXISTAIT, ET CE QUI MANQUAIT ─────────────────────────────────────
//
// `GET /api/projects/public` et `POST /api/projects/:id/join` sont là depuis
// longtemps. Le refus de `join` est écrit avec soin — il prend la forme EXACTE
// de l'inexistence, pour qu'une liste d'identifiants ne dessine pas la carte des
// projets privés de la ruche — et sa garde `peutRejoindre` est un module pur
// bien testé, cas par cas.
//
// Mais **aucun test n'avait jamais appelé ces deux routes**, et aucun écran non
// plus. Sur une plateforme d'orchestration COMMUNAUTAIRE, « découvrir un projet
// ouvert et le rejoindre » est le parcours qui donne son sens à tous les
// autres. Il avait un serveur, une garde, des tests unitaires — et pas de porte.
//
// ─── CE QUE CE FICHIER ÉTABLIT, QU'UN TEST DE `peutRejoindre` NE PEUT PAS ────
//
// Que la garde est BRANCHÉE, que le refus a la bonne FORME sur le fil, et que
// l'adhésion produit vraiment un membre. Une fonction juste qu'aucune route
// n'appelle ne protège rien ; une route qui l'appelle mal non plus.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { ProjetPublic } from '../src/shared/projet-public.js';

const TOKEN = 'jeton-de-test-suffisamment-long-42';

describe('LE PARCOURS « REJOINDRE », de bout en bout', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let dir: string;
  let base: string;
  let jwtLea = '';
  let idLea = '';
  let idProprio = '';
  let idPublic = '';
  let idPrive = '';
  let idOrphelin = '';

  /** Crée un compte et rend son jeton de session, avec son identifiant. */
  const inscrire = async (email: string, nom: string): Promise<{ jwt: string; id: string }> => {
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ email, password: 'mot-de-passe-assez-long-42', displayName: nom }),
    });
    expect(r.status, `inscription ${email}`).toBeLessThan(300);
    const { token } = (await r.json()) as { token: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { id: string };
    return { jwt: token, id: moi.id };
  };

  const rejoindre = (projectId: string, jwt: string | null) =>
    fetch(`${base}/api/projects/${projectId}/join`, {
      method: 'POST',
      headers: {
        'x-hive-token': TOKEN,
        ...(jwt === null ? {} : { authorization: `Bearer ${jwt}` }),
      },
    });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-join-'));
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

    // LE PREMIER COMPTE EST ADMIN (amorce de la ruche) : c'est donc le
    // propriétaire. Léa est le second, un compte membre ordinaire — c'est elle
    // qui doit se heurter aux gardes, un admin voit tout et ne prouverait rien.
    const proprio = await inscrire('proprio@ruche.test', 'Camille');
    idProprio = proprio.id;
    const lea = await inscrire('lea@ruche.test', 'Léa');
    jwtLea = lea.jwt;
    idLea = lea.id;

    // Le dépôt porte des identifiants — c'est le cas que `vuePublique` existe
    // pour couvrir, et il doit rester couvert jusqu'au bout du fil.
    idPublic = server.store.createProject({
      name: 'Ruche ouverte',
      repoUrl: 'https://user:ghp_secret_du_proprio@github.com/micka/ouverte.git',
      ownerId: proprio.id,
      visibility: 'public',
    }).id;
    idPrive = server.store.createProject({
      name: 'Ruche fermée',
      repoUrl: null,
      ownerId: proprio.id,
      visibility: 'private',
    }).id;
    // Sans propriétaire : importé par le jeton de ruche, personne ne le porte.
    idOrphelin = server.store.createProject({
      name: 'Ruche orpheline',
      repoUrl: null,
      ownerId: null,
      visibility: 'private',
    }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('LE CATALOGUE S’OUVRE SANS COMPTE — mais ne publie que la projection', async () => {
    const r = await fetch(`${base}/api/projects/public`);
    expect(r.status, 'le catalogue est public, c’est voulu').toBe(200);
    const liste = (await r.json()) as ProjetPublic[];

    // CE QUI EST PUBLIÉ, ET SURTOUT CE QUI NE L'EST PAS. La liste disait
    // auparavant « exactement ['Ruche ouverte'] » — une égalité qui interdisait
    // à tout autre test d'ouvrir un projet, et qui a fini par le faire : deux
    // tests plus bas se disputaient CE projet-ci faute de pouvoir créer le leur.
    // La propriété visée n'a jamais été le compte, c'est l'ÉTANCHÉITÉ.
    const noms = liste.map((p) => p.name);
    expect(noms).toContain('Ruche ouverte');
    expect(noms, 'un projet privé a fui dans le catalogue').not.toContain('Ruche fermée');
    expect(noms, 'un projet orphelin a fui dans le catalogue').not.toContain('Ruche orpheline');

    const p = liste.find((x) => x.name === 'Ruche ouverte') as ProjetPublic &
      Record<string, unknown>;
    expect(p, 'le projet ouvert doit être là').toBeDefined();

    // LE JETON GITHUB NE SORT PAS. `vuePublique` nettoie l'URL ; si un jour
    // quelqu'un renvoie la ligne de base, ce test rougit.
    expect(JSON.stringify(liste), 'un jeton GitHub a fui').not.toContain('ghp_secret_du_proprio');
    expect(p.repoUrl).toBe('https://github.com/micka/ouverte.git');
    // `ownerId` désignerait nommément une cible : il n'a rien à faire là.
    expect(p.ownerId, 'ownerId ne se publie pas').toBeUndefined();
  });

  /**
   * Un projet ouvert NEUF, que Léa n'a pas encore rejoint.
   *
   * Les deux tests ci-dessous se partageaient `idPublic` : le premier exigeait
   * que Léa n'y soit membre de rien, le second qu'elle le soit déjà. L'un des
   * deux était donc condamné à rougir dès qu'ils changeaient de place — et
   * chacun, seul, ne prouvait que la moitié de ce qu'il annonçait.
   */
  const projetOuvertNeuf = (nom: string): string =>
    server.store.createProject({
      name: nom,
      repoUrl: null,
      ownerId: idProprio,
      visibility: 'public',
    }).id;

  it('UN PROJET OUVERT SE REJOINT, et l’adhésion produit un vrai membre', async () => {
    // `joined: true` sur le fil ne prouve rien : ce qui compte est l'inscription
    // en base, parce que c'est elle que toutes les autres gardes consultent.
    const ouvert = projetOuvertNeuf('Ruche ouverte (adhésion)');
    expect(server.store.estMembre(ouvert, idLea), 'Léa n’est membre de rien').toBe(false);

    const r = await rejoindre(ouvert, jwtLea);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ joined: true });

    expect(server.store.estMembre(ouvert, idLea), 'l’adhésion doit être réelle').toBe(true);
  });

  it('REJOINDRE DEUX FOIS NE CASSE RIEN et ne duplique personne', async () => {
    // La liste se relit toute seule ; un double clic, un retour arrière, et le
    // geste repart. Il doit être idempotent, pas 500.
    // Note : `createProject` pose `ownerId` mais N'INSCRIT PAS de membre — seul
    // `POST /api/projects/user` le fait. Le compte attendu ici est donc celui
    // des adhésions, pas celui des personnes concernées par le projet.
    const ouvert = projetOuvertNeuf('Ruche ouverte (deux fois)');
    // La PREMIÈRE adhésion est la prémisse, pas le sujet : c'est la seconde
    // qu'on observe.
    expect((await rejoindre(ouvert, jwtLea)).status).toBe(200);

    const avant = server.store.listMembers(ouvert).length;
    const r = await rejoindre(ouvert, jwtLea);
    expect(r.status).toBe(200);
    expect(server.store.listMembers(ouvert).length, 'pas de doublon').toBe(avant);
  });

  it('UN PROJET PRIVÉ EST INDISTINGUABLE D’UN PROJET QUI N’EXISTE PAS', async () => {
    // Le cœur de la garde. Un « 403 interdit » confirmerait l'existence, et
    // répété sur une liste d'identifiants il dessinerait la carte des projets
    // privés de la ruche. Le refus doit être identique, OCTET POUR OCTET.
    const refusPrive = await rejoindre(idPrive, jwtLea);
    const refusInconnu = await rejoindre('projet-qui-n-existe-pas', jwtLea);

    expect(refusPrive.status).toBe(404);
    expect(refusInconnu.status).toBe(404);
    expect(await refusPrive.text(), 'les deux refus doivent être le MÊME').toBe(
      await refusInconnu.text(),
    );
  });

  it('UN PROJET ORPHELIN NE SE REJOINT PAS NON PLUS', async () => {
    // Sans propriétaire, personne n'a consenti à ouvrir quoi que ce soit.
    // Un projet importé par le jeton de ruche n'est pas un projet offert.
    const r = await rejoindre(idOrphelin, jwtLea);
    expect(r.status).toBe(404);
  });

  it('SANS COMPTE, REJOINDRE EST REFUSÉ — et par 401, pas par 404', async () => {
    // Ici la distinction est juste, et même nécessaire : le 401 dit « présentez
    // une identité », ce qui est actionnable et n'apprend RIEN sur l'existence
    // du projet. C'est un refus qui parle de l'appelant, pas de la cible.
    const r = await rejoindre(idPublic, null);
    expect(r.status).toBe(401);
  });

  it('le jeton de ruche seul ne suffit pas : on ne peut pas inscrire « le jeton »', async () => {
    // Le jeton de ruche est distribué à chaque nœud membre. S'il ouvrait
    // l'adhésion, n'importe quel nœud pourrait s'inscrire partout — et la ruche
    // ne saurait même pas au nom de qui.
    const r = await fetch(`${base}/api/projects/${idPublic}/join`, {
      method: 'POST',
      headers: { 'x-hive-token': TOKEN },
    });
    expect(r.status).toBe(401);
  });
});
