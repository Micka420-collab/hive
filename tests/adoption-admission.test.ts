// LE CUL-DE-SAC D'UN PROJET PRIVÉ — et les deux routes qui l'ouvrent.
//
// ─── CE QUI NE MARCHAIT PAS, ET POURQUOI PERSONNE NE LE VOYAIT ───────────────
//
// Un projet privé n'avait AUCUN moyen de gagner un membre. `POST /join`
// n'admet, sur un projet privé, que le propriétaire, l'administrateur et ceux
// qui sont déjà membres — ce qui est correct (on ne s'invite pas chez les
// autres) et incomplet : il n'existait aucune route pour INVITER. Un projet
// privé restait donc à jamais l'affaire d'une seule personne.
//
// Chaque route se comportait pourtant exactement comme son test le demandait.
// Le défaut n'est dans aucune : il est dans ce qu'AUCUNE ne fait.
//
// Un dépôt importé de GitHub cumulait les deux : privé ET sans propriétaire —
// l'import s'authentifie par le jeton de ruche, qui n'est le compte de
// personne. Illisible par toute la ruche sauf l'administrateur, et sans
// personne pour y admettre qui que ce soit. C'est l'exact contraire de ce pour
// quoi Le Rayon a été construit : « les abeilles qui se connectent doivent
// pouvoir voir le code ».
//
// ─── LES DEUX RÈGLES QUI TIENNENT LE RESTE ───────────────────────────────────
//
//   ADOPTER N'EST JAMAIS PRENDRE. Un projet qui a déjà un propriétaire ne
//   change pas de mains, même pour un administrateur.
//
//   ADMETTRE EST LE DROIT DU PROPRIÉTAIRE, PAS D'UN MEMBRE. Sinon le premier
//   invité invite à son tour, et « privé » ne veut plus rien dire au bout de
//   trois personnes.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-adoption-suffisamment-long';

describe('adopter un projet orphelin, y admettre des ouvrières', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let jetonAdmin = '';
  let jetonOuvriere = '';
  let jetonTiers = '';
  let idOuvriere = '';
  let orphelin = '';

  const inscrire = async (email: string): Promise<{ token: string; id: string }> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    const j = (await res.json()) as { token?: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${j.token}` } })
    ).json()) as { id: string };
    return { token: j.token ?? '', id: moi.id };
  };

  const auth = (jeton: string) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${jeton}`,
  });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-adopt-'));
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

    // Le PREMIER compte est administrateur par amorçage : c'est lui, pas un
    // autre. Un test qui inscrirait l'intrus en premier ferait de l'intrus un
    // administrateur et passerait pour de mauvaises raisons.
    jetonAdmin = (await inscrire('reine@ruche.test')).token;
    const ouvriere = await inscrire('ouvriere@ruche.test');
    jetonOuvriere = ouvriere.token;
    idOuvriere = ouvriere.id;
    jetonTiers = (await inscrire('curieux@ailleurs.test')).token;

    // Un projet tel que l'import GitHub le crée : privé, sans propriétaire.
    orphelin = server.store.createProject({
      name: 'Dépôt importé',
      repoUrl: 'https://github.com/micka/ma-ruche.git',
      visibility: 'private',
      ownerId: null,
    }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('AVANT ADOPTION, L’OUVRIÈRE NE VOIT RIEN — c’est bien le cul-de-sac', async () => {
    const res = await fetch(`${base}/api/projects/${orphelin}/rayon`, {
      headers: auth(jetonOuvriere),
    });
    expect(res.status).toBe(404);
  });

  it('une ouvrière ordinaire ne peut pas adopter', async () => {
    // Sinon le premier compte venu s'approprierait tout dépôt importé.
    const res = await fetch(`${base}/api/projects/${orphelin}/adopter`, {
      method: 'POST',
      headers: auth(jetonOuvriere),
    });
    expect(res.status).toBe(404);
  });

  it('L’ADMINISTRATEUR ADOPTE, ET DEVIENT MEMBRE PROPRIÉTAIRE', async () => {
    const res = await fetch(`${base}/api/projects/${orphelin}/adopter`, {
      method: 'POST',
      headers: auth(jetonAdmin),
    });
    expect(res.status).toBe(200);
    const membres = (await (
      await fetch(`${base}/api/projects/${orphelin}/members`, { headers: auth(jetonAdmin) })
    ).json()) as { role: string }[];
    expect(membres.map((m) => m.role)).toContain('owner');
  });

  it('ADOPTER N’EST JAMAIS PRENDRE : un projet déjà tenu ne change pas de mains', async () => {
    // C'est la garde qui empêche cette route d'être un vol de projet déguisé
    // en fonctionnalité d'administration. L'admin peut déjà tout LIRE ;
    // s'approprier est un autre acte.
    const res = await fetch(`${base}/api/projects/${orphelin}/adopter`, {
      method: 'POST',
      headers: auth(jetonAdmin),
    });
    expect(res.status).toBe(404);
  });

  it('LE PROPRIÉTAIRE ADMET UNE OUVRIÈRE, QUI LIT ALORS LE CODE', async () => {
    // ─── POURQUOI UN DÉLAI EXPLICITE, ET POURQUOI CELUI-CI ───────────────────
    //
    // Ce test tombait à 5 000 ms — le défaut de vitest — sur la CI Windows, et
    // NULLE PART ailleurs. Ce n'est pas une lenteur inventée : la lecture du code passe par le miroir, donc par un `git clone` réel, sensiblement plus lent sous Windows.
    //
    // 30 secondes n'est pas « une marge confortable », c'est une HYPOTHÈSE
    // VÉRIFIABLE : si le test passe désormais, le diagnostic « plus lent sous
    // Windows » était juste. S'il retombe à 30 s, ce n'est plus de la lenteur
    // mais un blocage, et il faudra le CORRIGER, pas rallonger encore.
    const res = await fetch(`${base}/api/projects/${orphelin}/membres`, {
      method: 'POST',
      headers: auth(jetonAdmin),
      body: JSON.stringify({ userId: idOuvriere }),
    });
    expect(res.status).toBe(201);
    // Et c'est tout l'objet de la manœuvre : la route du Rayon ne rend plus
    // 404. (Le miroir n'a pas de dépôt joignable ici : ce qui compte est que
    // le refus d'ACCÈS ait disparu.)
    const rayon = await fetch(`${base}/api/projects/${orphelin}/rayon`, {
      headers: auth(jetonOuvriere),
    });
    expect(rayon.status).not.toBe(404);
  }, 30_000);

  it('UN MEMBRE N’ADMET PAS À SON TOUR', async () => {
    // Sans cette asymétrie, « privé » ne veut plus rien dire au bout de trois
    // personnes : le premier invité invite, et ainsi de suite.
    const tiers = await inscrire('encore-un@ailleurs.test');
    const res = await fetch(`${base}/api/projects/${orphelin}/membres`, {
      method: 'POST',
      headers: auth(jetonOuvriere),
      body: JSON.stringify({ userId: tiers.id }),
    });
    expect(res.status).toBe(404);
  });

  it('un compte inventé n’est pas admis', async () => {
    // Une adhésion fantôme serait invisible (la jointure sur `users` la ferait
    // disparaître de `listMembers`) et éternelle.
    const res = await fetch(`${base}/api/projects/${orphelin}/membres`, {
      method: 'POST',
      headers: auth(jetonAdmin),
      body: JSON.stringify({ userId: 'compte-qui-n-existe-pas' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/compte/);
  });

  it('LE REFUS RESSEMBLE À UNE ABSENCE, À L’OCTET PRÈS', async () => {
    // Un « 403 interdit » confirmerait que le projet existe ; répété sur une
    // liste d'identifiants il dessinerait la carte des projets de la ruche.
    const surProjetReel = await fetch(`${base}/api/projects/${orphelin}/membres`, {
      method: 'POST',
      headers: auth(jetonTiers),
      body: JSON.stringify({ userId: idOuvriere }),
    });
    const surProjetInexistant = await fetch(`${base}/api/projects/inexistant-0000/membres`, {
      method: 'POST',
      headers: auth(jetonTiers),
      body: JSON.stringify({ userId: idOuvriere }),
    });
    expect(surProjetReel.status).toBe(surProjetInexistant.status);
    expect(await surProjetReel.text()).toBe(await surProjetInexistant.text());
  });

  it('le propriétaire se retire une ouvrière', async () => {
    const res = await fetch(`${base}/api/projects/${orphelin}/membres/${idOuvriere}`, {
      method: 'DELETE',
      headers: auth(jetonAdmin),
    });
    expect(res.status).toBe(200);
    const rayon = await fetch(`${base}/api/projects/${orphelin}/rayon`, {
      headers: auth(jetonOuvriere),
    });
    expect(rayon.status).toBe(404);
  });

  it('ON NE RETIRE PAS LE PROPRIÉTAIRE DE SON PROPRE PROJET', async () => {
    // Le sortir de la liste ne le déposséderait pas — `ownerId` resterait le
    // sien — ça rendrait seulement l'état incohérent.
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: auth(jetonAdmin) })
    ).json()) as { id: string };
    const res = await fetch(`${base}/api/projects/${orphelin}/membres/${moi.id}`, {
      method: 'DELETE',
      headers: auth(jetonAdmin),
    });
    expect(res.status).toBe(409);
  });

  it('retirer quelqu’un qui n’est pas membre le dit', async () => {
    const res = await fetch(`${base}/api/projects/${orphelin}/membres/${idOuvriere}`, {
      method: 'DELETE',
      headers: auth(jetonAdmin),
    });
    expect(res.status).toBe(404);
  });

  it('les trois routes exigent un COMPTE, pas le jeton de ruche', async () => {
    // Le `HIVE_TOKEN` est distribué à chaque nœud membre : s'en servir comme
    // preuve d'administration donnerait ces routes à toute machine qui butine.
    const entetes = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
    for (const [methode, url] of [
      ['POST', `/api/projects/${orphelin}/adopter`],
      ['POST', `/api/projects/${orphelin}/membres`],
      ['DELETE', `/api/projects/${orphelin}/membres/${idOuvriere}`],
    ] as const) {
      const res = await fetch(`${base}${url}`, {
        method: methode,
        headers: entetes,
        ...(methode === 'POST' ? { body: JSON.stringify({ userId: idOuvriere }) } : {}),
      });
      expect(res.status, `${methode} ${url}`).toBe(401);
    }
  });
});

// ─── CRÉER UN PROJET : À QUI APPARTIENT-IL ? ─────────────────────────────────
//
// Le parcours le PLUS courant du produit, et il produisait un orphelin.
//
// `POST /api/projects` s'authentifie par le jeton de RUCHE : il n'a personne à
// qui attribuer le projet, et le magasin range par défaut `private` +
// `ownerId: null`. Une fois le contrôle d'accès posé, la personne qui venait de
// créer son projet ne pouvait plus ni en lire le code, ni y admettre quelqu'un,
// ni le partager — sauf à être administratrice.
//
// `POST /api/projects/user` existait depuis le début pour ça, et personne ne
// l'appelait. Encore une fois : le défaut n'est dans aucune route, il est dans
// ce qu'aucune ne fait.

describe('créer un projet, et pouvoir s’en servir', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let jetonAdmin = '';
  let jetonOuvriere = '';

  const inscrire = async (email: string): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    return ((await res.json()) as { token?: string }).token ?? '';
  };

  const auth = (jeton: string) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${jeton}`,
  });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-creation-'));
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
    jetonAdmin = await inscrire('reine2@ruche.test');
    jetonOuvriere = await inscrire('ouvriere2@ruche.test');
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('CRÉÉ PAR UN COMPTE, LE PROJET LUI APPARTIENT', async () => {
    const res = await fetch(`${base}/api/projects/user`, {
      method: 'POST',
      headers: auth(jetonOuvriere),
      body: JSON.stringify({ name: 'Mon projet à moi' }),
    });
    expect(res.status).toBe(201);
    const projet = (await res.json()) as { id: string; ownerId: string | null };
    expect(projet.ownerId).not.toBeNull();

    // ET C'EST TOUT L'OBJET : la créatrice peut s'en servir tout de suite.
    // Le Rayon ne rend plus 404 (pas de dépôt joignable ici, donc pas 200 —
    // ce qui compte est que le refus d'ACCÈS ait disparu).
    const rayon = await fetch(`${base}/api/projects/${projet.id}/rayon`, {
      headers: auth(jetonOuvriere),
    });
    expect(rayon.status).not.toBe(404);

    // Et elle peut y admettre quelqu'un, sans passer par un administrateur.
    const moiAdmin = (await (
      await fetch(`${base}/api/auth/me`, { headers: auth(jetonAdmin) })
    ).json()) as { id: string };
    const admission = await fetch(`${base}/api/projects/${projet.id}/membres`, {
      method: 'POST',
      headers: auth(jetonOuvriere),
      body: JSON.stringify({ userId: moiAdmin.id }),
    });
    expect(admission.status).toBe(201);
  });

  it('LA VOIE « JETON DE RUCHE » RESTE ORPHELINE — et c’est pour ça qu’on adopte', async () => {
    // Le tableau de bord s'utilise sans compte : cette porte-là ne disparaît
    // pas. Elle produit un projet que personne ne tient, ce qui est exactement
    // le cas que l'adoption existe pour rattraper.
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ name: 'Projet sans compte' }),
    });
    expect(res.status).toBe(201);
    const projet = (await res.json()) as { ownerId: string | null };
    expect(projet.ownerId).toBeNull();
  });

  it('L’ÉCRAN APPELLE BIEN LA ROUTE QUI ATTRIBUE', () => {
    // Sans cette garde, le correctif se défait au premier « simplifions les
    // deux chemins de création » — et le défaut revient sans bruit, sur le
    // parcours le plus courant du produit.
    const brut = readFileSync(
      fileURLToPath(new URL('../dashboard/src/api.ts', import.meta.url)),
      'utf8',
    );
    const code = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');
    const i = code.indexOf('export function createProject(');
    expect(i).toBeGreaterThan(0);
    const corps = code.slice(i, i + 600);
    expect(corps).toContain('/api/projects/user');
    expect(corps).toContain('getJwt()');
  });
});
