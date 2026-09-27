// LE TABLEAU DE BORD, CONNECTÉ, SUR SON PROPRE PROJET — par ses vraies fonctions.
//
// ─── LE DÉFAUT QUE CE BANC TIENT ─────────────────────────────────────────────
//
// L'ADR 0007 a resserré les ENGAGEMENTS : sur un projet qui appartient à un
// compte, créer des tâches, lancer un merge, prendre une issue ou reprendre une
// livraison exige ce compte — le jeton de ruche, que chaque machine membre
// détient, n'y suffit plus. La décision disait « ça ne casse ni la CLI ni le
// tableau de bord sans compte », et c'était vrai.
//
// Elle cassait le tableau de bord AVEC compte. `createProject` passe par
// `/api/projects/user` dès qu'une session existe, et le projet naît donc à son
// créateur. Mais `api()` n'envoyait que `x-hive-token` : le JWT restait dans
// `localStorage`. Huit appels répondaient donc « 404 projet inconnu » au
// propriétaire lui-même — à commencer par `addTasks`, que la fenêtre « Nouveau
// projet » enchaîne juste après `createProject`. Le parcours le plus courant du
// produit échouait pour TOUTE personne connectée.
//
// ─── POURQUOI PERSONNE NE LE VOYAIT ──────────────────────────────────────────
//
// Chaque moitié avait ses tests, et chacune avait raison. Les bancs du serveur
// (`engagement-projet.test.ts`) envoient les en-têtes qu'ils veulent ; les bancs
// du tableau de bord remplacent `fetch` par un bouchon qui répond ce qu'on lui
// dit. Rien ne faisait passer les en-têtes RÉELLEMENT construits par `api.ts`
// devant les gardes RÉELLEMENT posées par la Reine. Le défaut vivait dans cet
// interstice, et nulle part ailleurs.
//
// Ce banc est donc l'interstice : les fonctions exportées de `api.ts`, telles
// que l'écran les appelle, contre un vrai `createServer`. Le seul artifice est
// le préfixe d'origine — en production l'écran est servi par la Reine, donc
// `/api/...` part vers elle ; ici on le lui recolle.
//
// ─── POURQUOI L'ENVIRONNEMENT `node`, ET PAS `happy-dom` ─────────────────────
//
// happy-dom remplace le `fetch` global par le sien, qui applique les règles
// CORS d'un navigateur, pré-vol compris (`happy-dom/lib/fetch/Fetch.js`). Or la
// Reine tourne DANS ce processus et appelle elle-même GitHub avec le `fetch`
// global : sous happy-dom, ses appels au faux GitHub deviendraient des requêtes
// « cross-origin », et le banc mesurerait l'émulateur de navigateur au lieu de
// la ruche. On reste donc sous Node, et on prête à `api.ts` les deux seules
// choses du navigateur qu'il touche : `localStorage` et `sessionStorage`.
//
// L'extension `.tsx` n'est pas un hasard pour autant : ce banc importe
// `dashboard/src/api.ts`, que seul `dashboard/tsconfig.json` sait typer (voir
// l'en-tête de `api-queen-fabrique.test.tsx`).

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer as creerHttp } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { signJwt } from '../src/orchestrator/auth.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import {
  ApiError,
  addTasks,
  authMe,
  authRegister,
  clearJwt,
  createProject,
  creerPartage,
  fetchIssues,
  fetchLivraisons,
  fetchReport,
  lancerWorkflowGithub,
  prendreIssue,
  reprendreLivraison,
  runMerge,
  saveJwt,
  savePartage,
  saveToken,
} from '../dashboard/src/api';

// ─── LE STOCKAGE DU NAVIGATEUR, AVANT LE PREMIER IMPORT ──────────────────────
//
// `dashboard/src/i18n.ts` lit `localStorage` DÈS SON CHARGEMENT (la langue
// mémorisée) : sans ce prêt, l'import de `api.ts` lèverait avant le premier
// test. `vi.hoisted` passe avant les imports, c'est sa seule raison d'être ici.
// Et le stockage natif de Node est coupé exprès par `vitest.config.ts`
// (`--no-experimental-webstorage`) — on ne peut pas compter sur lui.
vi.hoisted(() => {
  const stockage = (): Storage => {
    const valeurs = new Map<string, string>();
    return {
      get length() {
        return valeurs.size;
      },
      clear: () => valeurs.clear(),
      getItem: (cle: string) => valeurs.get(cle) ?? null,
      key: (rang: number) => [...valeurs.keys()][rang] ?? null,
      removeItem: (cle: string) => void valeurs.delete(cle),
      setItem: (cle: string, valeur: string) => void valeurs.set(cle, String(valeur)),
    };
  };
  vi.stubGlobal('localStorage', stockage());
  vi.stubGlobal('sessionStorage', stockage());
});

const TOKEN = 'jeton-contrat-compte-assez-long';
const JETON_GH = 'jeton-github-du-banc-contrat';
const MOT_DE_PASSE = 'motdepasse-assez-long-42';
const DEPOT = 'micka/ruche';
const REPO_URL = `https://github.com/${DEPOT}.git`;
/** Le workflow que déclare le faux GitHub — un identifiant NUMÉRIQUE, jamais un nom. */
const WORKFLOW = 77;

/** Un diff minuscule : le merge n'intègre que des tâches terminées porteuses d'un diff. */
const DIFF = [
  'diff --git a/note.txt b/note.txt',
  '--- a/note.txt',
  '+++ b/note.txt',
  '@@ -1 +1 @@',
  '-avant',
  '+après',
  '',
].join('\n');

/** Une issue, telle que l'API GitHub la rend. */
const issue = (n: number): Record<string, unknown> => ({
  number: n,
  title: `Demande numéro ${n}`,
  body: `Il faudrait faire la chose ${n}.`,
  state: 'open',
  locked: false,
  comments: 0,
  html_url: `https://github.com/${DEPOT}/issues/${n}`,
  updated_at: '2026-07-13T10:00:00Z',
  user: { login: 'demandeur' },
  labels: [],
});

/** Ce que le TABLEAU DE BORD a envoyé — ses appels à lui, pas ceux de la Reine vers GitHub. */
interface Envoi {
  chemin: string;
  entetes: Record<string, string>;
}

interface Compte {
  email: string;
  jwt: string;
  id: string;
}

describe('le tableau de bord connecté engage SON projet, par les vraies fonctions de api.ts', () => {
  let server: HiveServer;
  let faux: Server;
  let dir: string;
  let base = '';
  let proprietaire: Compte;
  let voisin: Compte;
  const envois: Envoi[] = [];
  /** Ce que le faux GitHub n'a pas su servir — lu quand un test surprend. */
  const nonServis: string[] = [];
  /** Les workflows réellement déclenchés chez le faux GitHub. */
  const dispatches: number[] = [];
  const noeuds: WebSocket[] = [];
  const avant = new Map<string, string | undefined>();

  // ─── LE FAUX GITHUB, ET LA FAUSSE QUEEN BEE SUR LE MÊME PORT ───────────────
  //
  // Même procédé que `issue-parcours.test.ts` et `livraison-parcours.test.ts` :
  // `HIVE_GITHUB_API` et `QUEEN_BEE_BASE_URL` pointent sur la boucle locale.
  // Aucun appel ne sort de la machine, et aucun vrai jeton ne vit ici.
  const repondreGithub = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? '';
    const rendre = (code: number, corps?: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(corps === undefined ? '' : JSON.stringify(corps));
    };
    if (url.startsWith(`/repos/${DEPOT}/issues?`)) return rendre(200, [issue(3)]);
    if (url === `/repos/${DEPOT}/issues/3`) return rendre(200, issue(3));
    // La PR que la ruche a ouverte : ouverte, CI rouge — donc du travail à reprendre.
    if (url === `/repos/${DEPOT}/pulls/42`) {
      return rendre(200, {
        number: 42,
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'sha-tete', ref: 'hive/i3' },
      });
    }
    if (url.startsWith(`/repos/${DEPOT}/commits/sha-tete/check-runs`)) {
      return rendre(200, {
        check_runs: [
          {
            name: 'test',
            status: 'completed',
            conclusion: 'failure',
            html_url: `https://github.com/${DEPOT}/runs/1`,
          },
        ],
      });
    }
    if (url.startsWith(`/repos/${DEPOT}/pulls/42/reviews`)) return rendre(200, []);
    if (url.startsWith(`/repos/${DEPOT}/actions/workflows?`)) {
      return rendre(200, {
        total_count: 1,
        workflows: [
          {
            id: WORKFLOW,
            name: 'CI',
            path: '.github/workflows/ci.yml',
            state: 'active',
            html_url: `https://github.com/${DEPOT}/actions/workflows/ci.yml`,
          },
        ],
      });
    }
    if (url === `/repos/${DEPOT}/actions/workflows/${WORKFLOW}/dispatches`) {
      dispatches.push(WORKFLOW);
      return rendre(204);
    }
    // Queen Bee : deux tâches pour toute issue découpée.
    if (url === '/chat/completions') {
      req.resume();
      req.on('end', () =>
        rendre(200, {
          model: 'faux-modele',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rationale: 'découpage du banc',
                  tasks: [
                    { id: 'A', title: 'Première étape', prompt: 'faire la première chose' },
                    { id: 'B', title: 'Seconde étape', prompt: 'la suite', dependsOn: ['A'] },
                  ],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    nonServis.push(`${req.method} ${url}`);
    rendre(404, { message: 'Not Found' });
  };

  /** S'inscrit par l'écran, comme une personne : le JWT est rangé par `saveJwt`. */
  const inscrire = async (email: string): Promise<Compte> => {
    const { token } = await authRegister(email, MOT_DE_PASSE, email);
    saveJwt(token);
    return { email, jwt: token, id: (await authMe()).id };
  };

  /**
   * Le JWT de ce compte tel qu'il dort dans un navigateur rouvert un mois plus
   * tard : bien signé, mais expiré. Seule l'horloge est truquée, le temps d'une
   * signature synchrone — la Reine, elle, lit la vraie heure.
   */
  const jwtExpire = (compte: Compte): string => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 30 * 24 * 60 * 60 * 1000);
    try {
      return signJwt(compte.id, compte.email);
    } finally {
      vi.useRealTimers();
    }
  };

  /** Une ouvrière qui s'inscrit, reçoit ce qu'on lui confie, et se tait. */
  const inscrireNoeud = (nom: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      noeuds.push(ws);
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'register',
            token: TOKEN,
            nodeId: nom,
            name: nom,
            ownerName: 'banc',
            agentType: 'shell',
            maxConcurrency: 1,
          }),
        ),
      );
      ws.on('message', (d: Buffer) => {
        if ((JSON.parse(d.toString()) as { type: string }).type === 'registered') resolve(ws);
      });
      ws.on('error', reject);
    });

  /**
   * Ce qu'une ouvrière aurait rendu : la tâche terminée, avec son diff. Le
   * travail d'un nœud n'est pas ce que ce banc éprouve — c'est la porte du
   * merge, et elle ne s'ouvre que sur des tâches terminées.
   */
  const terminer = (taskId: string): void => {
    server.store.patchTask(taskId, { status: 'done' });
    server.store.insertResult({
      taskId,
      nodeId: 'graine',
      success: true,
      diff: DIFF,
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
  };

  /** Le refus de l'engagement, tel que l'écran le reçoit. */
  const refus = async (appel: Promise<unknown>): Promise<{ status: number; message: string }> => {
    const e: unknown = await appel.then(
      () => null,
      (err: unknown) => err,
    );
    expect(e, 'l’appel devait être refusé').toBeInstanceOf(ApiError);
    const { status, message } = e as ApiError;
    return { status, message };
  };

  beforeAll(async () => {
    faux = creerHttp(repondreGithub);
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
    const portFaux = (faux.address() as { port: number }).port;

    // L'environnement est lu par `createServer` (jeton GitHub) et par la route
    // (Queen Bee) : il doit être posé AVANT, et rendu tel quel après.
    const env: Record<string, string> = {
      HIVE_GITHUB_TOKEN: JETON_GH,
      HIVE_GITHUB_API: `http://127.0.0.1:${portFaux}`,
      QUEEN_BEE_API_KEY: 'cle-du-banc',
      QUEEN_BEE_BASE_URL: `http://127.0.0.1:${portFaux}`,
    };
    for (const [cle, valeur] of Object.entries(env)) {
      avant.set(cle, process.env[cle]);
      process.env[cle] = valeur;
    }

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-contrat-compte-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      // Aucun tour d'ordonnanceur ne doit venir brouiller le scénario.
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;

    // `/api/...` part vers la Reine, comme quand elle sert l'écran. Les appels
    // ABSOLUS — ceux que la Reine elle-même adresse au faux GitHub — passent
    // intacts : ce ne sont pas des envois du tableau de bord.
    const fetchNatif = globalThis.fetch;
    vi.stubGlobal('fetch', (entree: string | URL | Request, init?: RequestInit) => {
      if (typeof entree === 'string' && entree.startsWith('/')) {
        envois.push({ chemin: entree, entetes: { ...(init?.headers as Record<string, string>) } });
        return fetchNatif(`${base}${entree}`, init);
      }
      return fetchNatif(entree, init);
    });

    // LE PREMIER COMPTE EST ADMINISTRATEUR PAR AMORÇAGE, et un administrateur
    // engage TOUS les projets. Si le propriétaire l'était, le parcours passerait
    // par son rôle et non par sa propriété — pour une mauvaise raison. On
    // consomme donc l'amorçage avec un compte qui ne sert qu'à ça.
    saveToken(TOKEN);
    await inscrire('reine@ruche.test');
    proprietaire = await inscrire('proprietaire@ruche.test');
    voisin = await inscrire('voisin@ruche.test');
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    saveToken(TOKEN);
    envois.length = 0;
  });

  afterEach(() => {
    for (const ws of noeuds.splice(0)) ws.close();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await server.stop();
    await new Promise<void>((r) => faux.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    for (const [cle, valeur] of avant) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  });

  /** Un projet créé par l'écran, connecté : il appartient à son créateur. */
  const projetDuProprietaire = async (nom: string): Promise<string> => {
    saveJwt(proprietaire.jwt);
    const projet = await createProject({ name: nom, repoUrl: REPO_URL });
    // LA PRÉMISSE QUI DONNE SON SENS À TOUT LE RESTE. Un projet orphelin
    // s'engage encore au jeton de ruche : sans propriétaire, ce banc passerait
    // sans que le JWT ait servi à quoi que ce soit.
    expect(projet.ownerId, 'prémisse : le projet doit appartenir au compte').toBe(proprietaire.id);
    return projet.id;
  };

  it('LA FENÊTRE « NOUVEAU PROJET » ABOUTIT : créer, ajouter des tâches, lancer le merge', async () => {
    const projet = await projetDuProprietaire('Parcours du propriétaire');

    // Ce que `NewProjectModal` enchaîne juste après `createProject`. Avant, ce
    // second appel rendait « 404 projet inconnu » à la personne qui venait de
    // créer le projet.
    const taches = await addTasks(projet, [{ title: 'Écrire la note', prompt: 'écrire' }]);
    expect(taches.map((t) => t.title)).toEqual(['Écrire la note']);
    const [tache] = taches;
    if (!tache) throw new Error('aucune tâche créée');

    terminer(tache.id);
    await inscrireNoeud('ouvriere-du-banc');
    const lance = await runMerge(projet);
    expect(lance.nodeId).toBe('ouvriere-du-banc');
    expect(lance.order).toEqual([tache.id]);
  });

  it('LES GESTES QUI PARLENT À GITHUB ABOUTISSENT : issue, livraison, reprise, workflow', async () => {
    const projet = await projetDuProprietaire('Parcours GitHub du propriétaire');

    const { issues } = await fetchIssues(projet);
    expect(
      issues.map((i) => i.numero),
      `non servis : ${nonServis.join(', ')}`,
    ).toEqual([3]);

    const prise = await prendreIssue(projet, 3);
    expect(prise.taches.map((t) => t.title)).toEqual(['Première étape', 'Seconde étape']);
    const [livree] = prise.taches;
    if (!livree) throw new Error('aucune tâche issue de l’issue');

    // La livraison qu'une ouvrière aurait ouverte pour cette tâche : PR n° 42.
    server.store.setLivraison({
      taskId: livree.id,
      projectId: projet,
      depot: DEPOT,
      pr: 42,
      branche: 'hive/i3',
      etat: 'ouverte',
    });
    const { livraisons } = await fetchLivraisons(projet);
    expect(livraisons, `non servis : ${nonServis.join(', ')}`).toHaveLength(1);
    expect(livraisons[0]).toMatchObject({ pr: 42, etat: 'ci_rouge', reprenable: true });

    const reprise = await reprendreLivraison(projet, livree.id);
    expect(reprise.tache.title).toContain('Reprise PR #42');

    const lance = await lancerWorkflowGithub(projet, WORKFLOW, 'main');
    expect(lance.workflow.id).toBe(WORKFLOW);
    expect(dispatches).toContain(WORKFLOW);
  });

  it('LE JWT N’OUVRE QUE CE QUI REGARDE SON PORTEUR — la frontière de l’ADR 0007 tient', async () => {
    const projet = await projetDuProprietaire('Projet qui ne regarde pas le voisin');

    // Un autre compte, parfaitement authentifié : le projet d'autrui a pour lui
    // la forme exacte de l'inexistence.
    saveJwt(voisin.jwt);
    expect(await refus(addTasks(projet, [{ title: 'Intrusion', prompt: 'x' }]))).toEqual({
      status: 404,
      message: 'projet inconnu',
    });
    expect((await refus(runMerge(projet))).status).toBe(404);

    // Et le jeton de ruche seul — celui que toute machine membre détient —
    // n'engage toujours pas un projet qui appartient à quelqu'un.
    clearJwt();
    expect((await refus(addTasks(projet, [{ title: 'Intrusion', prompt: 'x' }]))).status).toBe(404);
  });

  it('SANS COMPTE, RIEN NE CHANGE — et un JWT expiré retombe sur le jeton de ruche', async () => {
    // « Le tableau de bord s'utilise sans compte » est un mode annoncé : sans
    // session, le projet naît orphelin et le jeton de ruche l'engage.
    clearJwt();
    const orphelin = await createProject({ name: 'Projet sans compte' });
    expect(orphelin.ownerId).toBeNull();
    expect(await addTasks(orphelin.id, [{ title: 'Sans compte', prompt: 'x' }])).toHaveLength(1);

    // Une session expirée dort encore dans `localStorage` jusqu'au prochain
    // `authMe`, et elle part désormais avec chaque appel. Elle ne doit rien
    // retirer : la Reine essaie le compte, puis le jeton sur un projet que
    // personne ne possède.
    const expire = jwtExpire(proprietaire);
    saveJwt(expire);
    expect(await addTasks(orphelin.id, [{ title: 'Session expirée', prompt: 'x' }])).toHaveLength(
      1,
    );
    expect(envois.at(-1)?.entetes.authorization, 'le JWT expiré est bien parti').toBe(
      `Bearer ${expire}`,
    );
  });

  it('UN LIEN DE PARTAGE NE PART JAMAIS AVEC LE COMPTE, même quand une session existe', async () => {
    const projet = await projetDuProprietaire('Projet partagé');
    const { jeton } = await creerPartage(projet, { label: 'Pour montrer' });

    // L'onglet où l'on a ouvert le lien : le JWT du compte est là, dans le
    // `localStorage` commun à tous les onglets. La lecture doit partir avec le
    // lien SEUL — sinon un lien révoqué retomberait sur les droits du compte,
    // et l'onglet de partage agirait en son nom.
    savePartage(jeton);
    expect((await fetchReport(projet)).projectId).toBe(projet);
    const lecture = envois.at(-1);
    expect(lecture?.chemin).toBe(`/api/projects/${projet}/report`);
    expect(lecture?.entetes['x-hive-partage']).toBe(jeton);
    expect(lecture?.entetes, 'le JWT a voyagé avec le lien').not.toHaveProperty('authorization');
  });
});

// ─── LE PROCHAIN `fetch` N'OUBLIERA PAS NON PLUS ─────────────────────────────
//
// Le défaut tenu plus haut est né d'une identité posée APPEL PAR APPEL : les
// fonctions d'intendance ajoutaient le JWT, les autres non, et c'est la moitié
// oubliée qui a décidé. `api()` porte désormais l'identité pour tous ; restent
// les rares appels qui gardent leur propre `fetch` parce qu'ils lisent eux-
// mêmes la réponse (un flux SSE, une recherche relayée). Chacun doit la prendre
// à `enTetesRuche()` — la seule source — et le suivant qu'on écrira aussi.
describe('aucun fetch du tableau de bord ne part sans l’identité de la ruche', () => {
  const RACINE = new URL('../dashboard/src/', import.meta.url);

  /** Le code, commentaires retirés : sinon une garde accuse sa propre doc. */
  const sansCommentaires = (texte: string): string =>
    texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');

  it('chaque appel réseau passe par `api()` ou prend ses en-têtes à `enTetesRuche()`', () => {
    const sites: { fichier: string; appel: string }[] = [];
    for (const fichier of readdirSync(RACINE, { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(fichier)) continue;
      const code = sansCommentaires(readFileSync(new URL(fichier, RACINE), 'utf8'));
      // `fetch(` nu — ni `.fetch(`, ni `fetchRayon(`.
      for (const m of code.matchAll(/(?<![\w.])fetch\(/g)) {
        sites.push({ fichier, appel: code.slice(m.index, m.index + 400) });
      }
    }
    // Trois aujourd'hui : `api()`, la Reine, OpenAlex. Zéro voudrait dire que
    // le balayage ne voit plus rien — une garde aveugle passe toujours.
    expect(sites.length, 'le balayage ne trouve aucun fetch').toBeGreaterThanOrEqual(3);
    for (const { fichier, appel } of sites) {
      // `api()` étale `identite`, dont la valeur par défaut EST `enTetesRuche()`.
      expect(appel, `${fichier} : un fetch part sans l’identité`).toMatch(
        /enTetesRuche\(\)|\.\.\.identite\b/,
      );
    }
  });
});
