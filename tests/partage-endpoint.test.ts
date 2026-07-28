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

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

    // Une tâche terminée par un nœud NOMMÉ : c'est lui qu'un lien ne doit pas
    // voir, et un compte doit continuer de voir.
    const tache = server.store.createTask({
      projectId: projetA,
      title: 'une tâche faite',
      prompt: 'faire',
    });
    server.store.patchTask(tache.id, { status: 'done', assignedNodeId: 'noeud-temoin' });
    server.store.insertResult({
      taskId: tache.id,
      nodeId: 'noeud-temoin',
      success: true,
      diff: 'diff --git a/f b/f\n',
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });

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

    it('VOIR L’AVANCEMENT — l’acte déclaré qu’aucune route n’utilisait', async () => {
      // `ACTES_PARTAGES` annonce `voir_avancement` depuis le premier jour, et
      // les trois seules routes qui acceptaient un lien demandaient toutes
      // `lire_code`. Un lien « voir l'avancement » ne montrait donc jamais
      // d'avancement : on promettait au porteur une chose qu'on ne lui donnait
      // pas. C'est le genre de trou qu'aucun test de route ne voit, puisque
      // chaque route se comportait exactement comme demandé.
      const res = await fetch(`${base}/api/projects/${projetA}/report`, {
        headers: { 'x-hive-partage': lien },
      });
      expect(res.status).toBe(200);
      const r = (await res.json()) as { name: string; total: number };
      expect(r.name).toBeTruthy();
      expect(typeof r.total).toBe('number');
    });

    it('UN PARTAGE MONTRE L’AVANCEMENT, PAS QUI TRAVAILLE', async () => {
      // Les identifiants de nœuds nomment les machines de gens qui n'ont pas
      // consenti à figurer dans un lien qu'on fait circuler. Un compte, lui,
      // les voit : c'est bien le lien qu'on restreint, pas le rapport.
      const parLien = (await (
        await fetch(`${base}/api/projects/${projetA}/report`, {
          headers: { 'x-hive-partage': lien },
        })
      ).json()) as { contributingNodes: string[] };
      const parCompte = (await (
        await fetch(`${base}/api/projects/${projetA}/report`, {
          headers: { authorization: `Bearer ${jetonReine}`, 'x-hive-token': TOKEN },
        })
      ).json()) as { contributingNodes: string[] };
      expect(parLien.contributingNodes).toEqual([]);
      expect(parCompte.contributingNodes).toEqual(['noeud-temoin']);
    });

    it('l’avancement d’un AUTRE projet reste fermé', async () => {
      // Le lien vaut pour UN projet. Sans cette vérification, `voir_avancement`
      // deviendrait un droit de lecture sur toute la ruche.
      const res = await fetch(`${base}/api/projects/${projetB}/report`, {
        headers: { 'x-hive-partage': lien },
      });
      expect(res.status).not.toBe(200);
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
      // Une tâche terminée par un nœud NOMMÉ : c'est lui qu'un lien ne doit pas
      // voir, et un compte doit continuer de voir.
      const tache = server.store.createTask({
        projectId: projetA,
        title: 'une tâche faite',
        prompt: 'faire',
      });
      server.store.patchTask(tache.id, { status: 'done', assignedNodeId: 'noeud-temoin' });
      server.store.insertResult({
        taskId: tache.id,
        nodeId: 'noeud-temoin',
        success: true,
        diff: 'diff --git a/f b/f\n',
        logs: 'ok',
        durationMs: 10,
        subAgents: [],
      });

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
      // Une tâche terminée par un nœud NOMMÉ : c'est lui qu'un lien ne doit pas
      // voir, et un compte doit continuer de voir.
      const tache = server.store.createTask({
        projectId: projetA,
        title: 'une tâche faite',
        prompt: 'faire',
      });
      server.store.patchTask(tache.id, { status: 'done', assignedNodeId: 'noeud-temoin' });
      server.store.insertResult({
        taskId: tache.id,
        nodeId: 'noeud-temoin',
        success: true,
        diff: 'diff --git a/f b/f\n',
        logs: 'ok',
        durationMs: 10,
        subAgents: [],
      });

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
      // Une tâche terminée par un nœud NOMMÉ : c'est lui qu'un lien ne doit pas
      // voir, et un compte doit continuer de voir.
      const tache = server.store.createTask({
        projectId: projetA,
        title: 'une tâche faite',
        prompt: 'faire',
      });
      server.store.patchTask(tache.id, { status: 'done', assignedNodeId: 'noeud-temoin' });
      server.store.insertResult({
        taskId: tache.id,
        nodeId: 'noeud-temoin',
        success: true,
        diff: 'diff --git a/f b/f\n',
        logs: 'ok',
        durationMs: 10,
        subAgents: [],
      });

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

// ─── L'ÉCRAN — les deux bouts, parce qu'un seul ne sert à rien ───────────────
//
// Le partage a vécu entier côté serveur, testé, documenté… et sans AUCUNE
// interface : ni pour créer un lien, ni pour en lire un. Une personne à qui on
// envoyait l'URL arrivait sur la mire de connexion d'une ruche où elle n'a pas
// de compte. Ces gardes-là existent pour que ça ne se reproduise pas en
// silence.

describe('le partage, côté écran', () => {
  const lire = (rel: string): string => {
    const brut = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    // On dépouille les commentaires : ils EXPLIQUENT les règles, et une garde
    // qui lit le fichier brut finit par accuser la phrase qui protège.
    return brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');
  };

  it('LE PORTEUR D’UN LIEN A UN ÉCRAN — l’aiguillage est AVANT `App`', () => {
    // `App` ouvre le flux WebSocket avec le jeton de RUCHE dès son montage et
    // sonde le pouls : un porteur de lien n'a rien de tout ça, et une branche
    // à l'intérieur ne l'éviterait pas — les hooks partent avant qu'on ait
    // fini de choisir quoi afficher.
    const main = lire('../dashboard/src/main.tsx');
    expect(main).toContain('savePartage');
    expect(main).toContain('Partage');
  });

  it('LE JETON NE RESTE PAS DANS LA BARRE D’ADRESSE', () => {
    // Il vit après le `#`, donc il ne part dans aucun journal d'accès. Mais une
    // capture d'écran de la page ne doit pas suffire à refaire le lien.
    expect(lire('../dashboard/src/main.tsx')).toContain('history.replaceState');
  });

  /** Le corps d'une fonction exportée de `api.ts`, à la louche mais suffisant. */
  const corpsDe = (source: string, nom: string): string => {
    const i = source.indexOf(`export function ${nom}(`);
    expect(i, nom).toBeGreaterThan(0);
    const suite = source.slice(i);
    const fin = suite.indexOf('\n}');
    return suite.slice(0, fin === -1 ? 400 : fin);
  };

  it('LES LECTURES PARTAGEABLES PASSENT PAR `apiLecture`, ET RIEN D’AUTRE', () => {
    // Le serveur a exactement cette forme : `projetLisible()` accepte deux
    // portes — un compte, ou un lien. Deux familles de fonctions côté client
    // donneraient deux listes à tenir d'accord, et c'est toujours celle qu'on
    // oublie qui décide.
    const api = lire('../dashboard/src/api.ts');
    for (const nom of ['fetchRayon', 'fetchFichierRayon', 'fetchApercu', 'fetchReport']) {
      expect(corpsDe(api, nom), nom).toContain('apiLecture');
    }
  });

  it('LA RETOUCHE, ELLE, EXIGE UN COMPTE — et doit le rester', () => {
    // C'est la moitié qui compte. Basculer `proposerRetouche` sur `apiLecture`
    // par symétrie ferait d'un lien « juste pour montrer » un droit de faire
    // tourner des agents sur les machines des membres. Le serveur refuserait,
    // mais on ne veut pas non plus le lui demander.
    const api = lire('../dashboard/src/api.ts');
    expect(corpsDe(api, 'proposerRetouche')).not.toContain('apiLecture');
    expect(corpsDe(api, 'proposerRetouche')).toContain('apiCompte');
    // Et la création de liens n'est pas non plus une lecture : un porteur de
    // lien ne fabrique pas d'autres liens.
    expect(corpsDe(api, 'creerPartage')).toContain('apiCompte');
    expect(corpsDe(api, 'revoquerPartage')).toContain('apiCompte');
  });

  it('ON PEUT CRÉER ET RÉVOQUER UN LIEN DEPUIS LA VUE PROJETS', () => {
    const vue = lire('../dashboard/src/views/Projets.tsx');
    expect(vue).toContain('creerPartage');
    expect(vue).toContain('revoquerPartage');
    // Le jeton n'est rendu QU'UNE FOIS : un écran qui ne l'affiche pas à ce
    // moment-là le perd pour de bon.
    expect(vue).toContain('nouveau.lien');
  });

  it('LE PORTEUR NE SE VOIT PAS PROPOSER DE RETOUCHER', () => {
    // Le serveur refuse déjà — la retouche exige un compte — mais proposer un
    // bouton voué au 401 est une promesse qu'on ne tient pas.
    const rayon = lire('../dashboard/src/views/Rayon.tsx');
    expect(rayon).toContain('getPartage()');
    expect(rayon).toContain('parPartage ?');
  });
});
