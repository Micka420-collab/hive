// LE JETON DU DÉPÔT NE SORT NULLE PART — sur tout le trajet, pas route par route.
//
// ─── POURQUOI CE FICHIER, ALORS QUE CHAQUE ROUTE EST DÉJÀ TESTÉE ─────────────
//
// Un `repoUrl` porte potentiellement un secret. La façon dont on donne ses
// identifiants à `git clone` sans configuration, c'est de les écrire dedans :
//
//     https://user:ghp_xxxxxxxxxxxx@github.com/org/depot.git
//
// Rien ne l'interdit, et le champ « dépôt » du formulaire de création l'accepte
// tel quel. Cette chaîne traverse ensuite TOUT : la création, l'instantané, le
// rapport d'avancement, le miroir, l'arbre du Rayon, le partage en lecture.
//
// Chaque route a son test, et le jeton a quand même fui TROIS FOIS — catalogue
// public, vue Rayon, carte projet — parce que le danger n'est dans aucune route
// en particulier : il est dans le fait que la chaîne circule. Ce fichier ne
// teste donc pas une route. Il prend le trajet complet d'un projet réaliste et
// vérifie UNE propriété : le secret n'apparaît dans AUCUNE réponse.
//
// C'est le genre de test qui reste vert des mois puis rougit le jour où
// quelqu'un ajoute un champ à une réponse existante — c'est-à-dire exactement
// le jour où il sert.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-parcours-suffisamment-long-42';
/** Le secret qu'on suit à la trace. Improbable par construction. */
const SECRET = 'ghp_SECRETDEPOTQUONSUITALATRACE42';

describe('le trajet complet d’un dépôt à URL porteuse de secret', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let depot: string;
  let jetonAdmin = '';
  let jetonOuvriere = '';
  let idOuvriere = '';
  let projet = '';
  let projetSecret = '';
  let lien = '';
  let lienSecret = '';

  /** Toutes les réponses observées du trajet, pour l'assertion finale. */
  const observees: { quoi: string; corps: string }[] = [];

  const noter = async (quoi: string, res: Response): Promise<Response> => {
    const clone = res.clone();
    observees.push({ quoi, corps: await clone.text() });
    return res;
  };

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

  const auth = (jeton: string) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${jeton}`,
  });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-parcours-'));
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
    writeFileSync(path.join(depot, 'README.md'), '# Dépôt suivi\n');
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

    // Le PREMIER compte est administrateur par amorçage. L'ordre compte : un
    // test qui inscrirait l'ouvrière en premier en ferait une administratrice,
    // et passerait pour de mauvaises raisons.
    jetonAdmin = (await inscrire('reine@ruche.test')).token;
    const ouvriere = await inscrire('ouvriere@ruche.test');
    jetonOuvriere = ouvriere.token;
    idOuvriere = ouvriere.id;

    // L'ÉTAT DANGEREUX ET RÉALISTE : privé, orphelin (comme un import GitHub),
    // et dont l'URL porte le secret. On garde un chemin local clonable pour que
    // le miroir fonctionne, avec le secret greffé dans la partie identifiants —
    // c'est bien la chaîne stockée qu'on suit, pas la joignabilité du dépôt.
    projet = server.store.createProject({
      name: 'Dépôt suivi',
      repoUrl: depot,
      visibility: 'private',
      ownerId: null,
    }).id;

    // ET SON JUMEAU, dont l'URL PORTE LE SECRET. Deux projets plutôt qu'un, et
    // pour une raison bête : une URL à identifiants ne se clone pas ici, donc
    // le miroir du premier ne marcherait plus. Le second ne sert qu'à suivre la
    // chaîne stockée à travers les réponses — c'est elle, l'objet du test.
    projetSecret = server.store.createProject({
      name: 'Dépôt à secret',
      repoUrl: `https://user:${SECRET}@github.com/org/depot.git`,
      visibility: 'private',
      ownerId: null,
    }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('LE TRAJET ENTIER PASSE — adopter, admettre, lire, partager', async () => {
    const adoption = await noter(
      'adopter',
      await fetch(`${base}/api/projects/${projet}/adopter`, {
        method: 'POST',
        headers: auth(jetonAdmin),
      }),
    );
    expect(adoption.status).toBe(200);

    const admission = await noter(
      'admettre',
      await fetch(`${base}/api/projects/${projet}/membres`, {
        method: 'POST',
        headers: auth(jetonAdmin),
        body: JSON.stringify({ userId: idOuvriere }),
      }),
    );
    expect(admission.status).toBe(201);

    // L'ouvrière lit le code : c'est tout l'objet de la manœuvre.
    const arbre = await noter(
      'rayon (ouvrière)',
      await fetch(`${base}/api/projects/${projet}/rayon`, { headers: auth(jetonOuvriere) }),
    );
    expect(arbre.status).toBe(200);
    const { entrees } = (await arbre.json()) as { entrees: { nom: string }[] };
    expect(entrees.map((e) => e.nom)).toContain('README.md');

    const cree = await noter(
      'créer un lien',
      await fetch(`${base}/api/projects/${projet}/partages`, {
        method: 'POST',
        headers: auth(jetonAdmin),
        body: JSON.stringify({ label: 'client' }),
      }),
    );
    lien = ((await cree.json()) as { jeton: string }).jeton;
    expect(lien.startsWith('hive3_')).toBe(true);
  }, 30_000);

  it('LE PORTEUR DU LIEN VOIT L’AVANCEMENT ET LE CODE, ET RIEN D’AUTRE', async () => {
    const rapport = await noter(
      'rapport (lien)',
      await fetch(`${base}/api/projects/${projet}/report`, { headers: { 'x-hive-partage': lien } }),
    );
    expect(rapport.status).toBe(200);

    const arbre = await noter(
      'rayon (lien)',
      await fetch(`${base}/api/projects/${projet}/rayon`, { headers: { 'x-hive-partage': lien } }),
    );
    expect(arbre.status).toBe(200);

    const fichier = await noter(
      'fichier (lien)',
      await fetch(
        `${base}/api/projects/${projet}/rayon/fichier?chemin=${encodeURIComponent('README.md')}`,
        { headers: { 'x-hive-partage': lien } },
      ),
    );
    expect(fichier.status).toBe(200);

    // Et pas l'écriture : un porteur de lien lit, il ne fabrique pas de travail
    // pour l'essaim de quelqu'un d'autre.
    const retouche = await noter(
      'retouche (lien)',
      await fetch(`${base}/api/projects/${projet}/rayon/retouche`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hive-partage': lien },
        body: JSON.stringify({ chemin: 'README.md', avant: 'a', apres: 'b' }),
      }),
    );
    expect(retouche.status).toBe(401);
  }, 30_000);

  it('LE SECRET DU DÉPÔT N’APPARAÎT DANS AUCUNE RÉPONSE DU TRAJET', async () => {
    // Le jumeau parcourt le même trajet : adopté, ouvrière admise, partagé.
    await noter(
      'adopter (secret)',
      await fetch(`${base}/api/projects/${projetSecret}/adopter`, {
        method: 'POST',
        headers: auth(jetonAdmin),
      }),
    );
    await noter(
      'admettre (secret)',
      await fetch(`${base}/api/projects/${projetSecret}/membres`, {
        method: 'POST',
        headers: auth(jetonAdmin),
        body: JSON.stringify({ userId: idOuvriere }),
      }),
    );
    const cree = await fetch(`${base}/api/projects/${projetSecret}/partages`, {
      method: 'POST',
      headers: auth(jetonAdmin),
      body: JSON.stringify({ label: 'client' }),
    });
    lienSecret = ((await cree.json()) as { jeton: string }).jeton;

    const relectures: [string, Response][] = [
      ['catalogue public', await fetch(`${base}/api/projects/public`)],
      [
        'liste des projets',
        await fetch(`${base}/api/projects`, { headers: { 'x-hive-token': TOKEN } }),
      ],
      [
        'rapport (compte)',
        await fetch(`${base}/api/projects/${projetSecret}/report`, {
          headers: auth(jetonOuvriere),
        }),
      ],
      [
        'rapport (lien)',
        await fetch(`${base}/api/projects/${projetSecret}/report`, {
          headers: { 'x-hive-partage': lienSecret },
        }),
      ],
      [
        'membres',
        await fetch(`${base}/api/projects/${projetSecret}/members`, { headers: auth(jetonAdmin) }),
      ],
      [
        'liens de partage',
        await fetch(`${base}/api/projects/${projetSecret}/partages`, { headers: auth(jetonAdmin) }),
      ],
      // LE REFUS AUSSI. Un miroir qui n'arrive pas à cloner explique pourquoi,
      // et l'explication la plus naturelle à écrire est « git a échoué sur
      // <URL> » — c'est-à-dire le secret, dans un message d'erreur.
      [
        'rayon injoignable (compte)',
        await fetch(`${base}/api/projects/${projetSecret}/rayon`, { headers: auth(jetonAdmin) }),
      ],
      [
        'rayon injoignable (lien)',
        await fetch(`${base}/api/projects/${projetSecret}/rayon`, {
          headers: { 'x-hive-partage': lienSecret },
        }),
      ],
    ];
    for (const [quoi, res] of relectures) observees.push({ quoi, corps: await res.text() });

    // MÉTA : UNE RÉPONSE VIDE OU REFUSÉE NE PROUVE RIEN. Sans cette garde, le
    // test serait vert parce qu'il n'a rien regardé — le pire des verts.
    //
    // Toutes ne sont pas substantielles, et c'est normal : le catalogue public
    // rend `[]` (le projet est privé, il n'a rien à y faire) et `/report`
    // exige le jeton de RUCHE, pas un compte, donc l'appel signé par le seul
    // JWT est refusé. Ce qui compte, ce sont les réponses qui portent
    // vraiment de l'état — rapport par lien, membres, liens, refus du miroir —
    // parce que c'est là qu'une URL se glisse quand quelqu'un ajoute un champ.
    const substantielles = relectures.filter(([quoi]) => {
      const o = observees.findLast((x) => x.quoi === quoi);
      return (o?.corps.length ?? 0) > 20;
    });
    expect(
      substantielles.length,
      `réponses lues : ${relectures.map(([q]) => `${q}=${observees.findLast((x) => x.quoi === q)?.corps.length ?? 0}o`).join(', ')}`,
    ).toBeGreaterThanOrEqual(4);

    const fuites = observees.filter((o) => o.corps.includes(SECRET)).map((o) => o.quoi);
    expect(
      fuites,
      `le jeton du dépôt sort dans : ${fuites.join(', ')}. Un repoUrl porte un secret ` +
        'potentiel, et il traverse tout le trajet — le laver à un seul endroit ne suffit pas.',
    ).toEqual([]);
  }, 30_000);

  it('méta-test : on a bien observé un trajet, pas trois appels', () => {
    // Sans ça, une refonte qui viderait `observees` rendrait le test précédent
    // vert et creux.
    expect(observees.length).toBeGreaterThan(8);
  });
});
