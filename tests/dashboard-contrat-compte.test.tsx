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
import ts from 'typescript';
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
  lancerChantier,
  lancerWorkflowGithub,
  prendreIssue,
  reprendreLivraison,
  revoquerPartage,
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
  /** Tel que la Reine le rend à `authMe` — c'est lui que la prémisse vérifie. */
  role: string | undefined;
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
    const { id, role } = await authMe();
    return { email, jwt: token, id, role };
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
    const amorce = await inscrire('reine@ruche.test');
    proprietaire = await inscrire('proprietaire@ruche.test');
    voisin = await inscrire('voisin@ruche.test');
    // La prémisse, VÉRIFIÉE et non supposée : elle ne tient qu'à l'ordre des
    // inscriptions, et un amorçage qui changerait de règle la ferait tomber en
    // silence — le banc passerait alors par le rôle, sans que rien ne rougisse.
    expect(amorce.role, 'prémisse : l’amorçage est consommé ici').toBe('admin');
    expect([proprietaire.role, voisin.role], 'prémisse : aucun des deux n’est admin').toEqual([
      'membre',
      'membre',
    ]);
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
  const projetDuProprietaire = async (
    nom: string,
    repoUrl: string | null = REPO_URL,
  ): Promise<string> => {
    saveJwt(proprietaire.jwt);
    const projet = await createProject({ name: nom, ...(repoUrl ? { repoUrl } : {}) });
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

  it('LE CHANTIER PASSE LA PORTE DU COMPTE — le seul refus qui reste est celui du dépôt', async () => {
    // Un chantier fait cloner le dépôt par le miroir : sur un vrai dépôt, ce
    // banc partirait sur le réseau. Mais la route juge l'ENGAGEMENT avant tout
    // le reste, `repoUrl` compris — un projet sans dépôt éprouve donc la porte
    // sans rien cloner. Le propriétaire apprend ce qui lui manque pour la
    // suite ; avant, il recevait « 404 projet inconnu » sur son propre projet.
    const projet = await projetDuProprietaire('Chantier sans dépôt', null);
    expect(await refus(lancerChantier(projet, 'test'))).toEqual({
      status: 400,
      message: 'le projet doit avoir un dépôt (repoUrl)',
    });

    // Et c'est bien le COMPTE qui a ouvert cette porte : le voisin, sur la même
    // route, bute sur l'inexistence avant d'apprendre quoi que ce soit du dépôt.
    saveJwt(voisin.jwt);
    expect(await refus(lancerChantier(projet, 'test'))).toEqual({
      status: 404,
      message: 'projet inconnu',
    });
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

  it('UN LIEN DE PARTAGE PART SEUL — un lien révoqué ne s’ouvre pas chez son hôte', async () => {
    const projet = await projetDuProprietaire('Projet partagé');
    const { id, jeton } = await creerPartage(projet, { label: 'Pour montrer' });

    // L'onglet où l'hôte vérifie son propre lien avant de l'envoyer : le JWT
    // ET le jeton de ruche sont là, dans le `localStorage` commun à tous les
    // onglets. La lecture doit partir avec le lien SEUL.
    savePartage(jeton);
    expect((await fetchReport(projet)).projectId).toBe(projet);
    const lecture = envois.at(-1);
    expect(lecture?.chemin).toBe(`/api/projects/${projet}/report`);
    expect(lecture?.entetes['x-hive-partage']).toBe(jeton);
    expect(lecture?.entetes, 'le JWT a voyagé avec le lien').not.toHaveProperty('authorization');
    expect(lecture?.entetes, 'le jeton de ruche a voyagé avec le lien').not.toHaveProperty(
      'x-hive-token',
    );

    // Ce que l'absence d'en-têtes PROTÈGE, joué pour de vrai. Le rapport essaie
    // le lien, puis le jeton de ruche : si ce dernier partait avec, le lien
    // révoqué s'ouvrirait encore chez l'hôte — qui le croirait vivant, alors
    // que chez l'invité il ne mène plus nulle part.
    await revoquerPartage(projet, id);
    expect((await refus(fetchReport(projet))).status).toBe(401);
  });
});

// ─── LE PROCHAIN `fetch` N'OUBLIERA PAS NON PLUS — NI N'IRA TROP LOIN ────────
//
// Le défaut tenu plus haut est né d'une identité posée APPEL PAR APPEL : les
// fonctions d'intendance ajoutaient le JWT, les autres non, et c'est la moitié
// oubliée qui a décidé. `api()` porte désormais l'identité pour tous ; restent
// les rares appels qui gardent leur propre `fetch` parce qu'ils lisent eux-
// mêmes la réponse (un flux SSE, une recherche relayée). Chacun doit la prendre
// à `enTetesRuche()` — la seule source — et le suivant qu'on écrira aussi.
//
// ─── MAIS SEULEMENT VERS LA REINE ────────────────────────────────────────────
//
// Une garde qui dirait seulement « ce fetch part sans l'identité » pousserait
// vers une fuite : le jour où l'écran appellera un tiers en direct (OpenAlex,
// un CDN, `api.github.com`), la correction évidente du rouge serait d'ajouter
// `enTetesRuche()` — et `HIVE_TOKEN` et le JWT partiraient chez lui. La règle
// est donc les DEUX sens : l'identité va à la Reine (`/api/…`, même origine),
// et nulle part ailleurs. Une cible qui ne se lit pas sans exécuter le code ne
// se juge pas : elle rougit, pour qu'on dise laquelle des deux elle est.
//
// ─── POURQUOI LE VRAI ANALYSEUR, ET PAS UNE EXPRESSION RATIONNELLE ───────────
//
// La première version cherchait `enTetesRuche()` dans les 400 caractères après
// `fetch(` : un `fetch` nu posé juste avant un appel sans rapport passait, et
// `window.fetch(` échappait au balayage. L'arbre syntaxique de TypeScript juge
// les en-têtes de CET appel-là, ignore commentaires et chaînes, et reconnaît le
// `fetch` du navigateur sous tous les noms qu'on lui donne.
describe('l’identité de la ruche part avec chaque fetch vers la Reine, et nulle part ailleurs', () => {
  const RACINE = new URL('../dashboard/src/', import.meta.url);

  const sources = readdirSync(RACINE, { recursive: true, encoding: 'utf8' })
    .filter((fichier) => /\.tsx?$/.test(fichier))
    .map((fichier) =>
      ts.createSourceFile(
        fichier,
        readFileSync(new URL(fichier, RACINE), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        fichier.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    );
  const sourceApi = sources.find((s) => s.fileName === 'api.ts');

  /** Tous les appels d'un fichier que `garder` retient, à toute profondeur. */
  const appels = (
    source: ts.SourceFile,
    garder: (appel: ts.CallExpression) => boolean,
  ): ts.CallExpression[] => {
    const trouves: ts.CallExpression[] = [];
    const visiter = (noeud: ts.Node): void => {
      if (ts.isCallExpression(noeud) && garder(noeud)) trouves.push(noeud);
      ts.forEachChild(noeud, visiter);
    };
    visiter(source);
    return trouves;
  };

  /** La fonction déclarée qui contient ce nœud — `undefined` au niveau du module. */
  const fonctionDe = (noeud: ts.Node): string | undefined => {
    for (let p = noeud.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p)) return p.name?.text;
    }
    return undefined;
  };

  /** `fetch(` nu, ou celui du navigateur sous un autre nom : `window.`, `globalThis.`, `self.`. */
  const estFetch = (appel: ts.CallExpression): boolean => {
    const e = appel.expression;
    if (ts.isIdentifier(e)) return e.text === 'fetch';
    return (
      ts.isPropertyAccessExpression(e) &&
      e.name.text === 'fetch' &&
      ts.isIdentifier(e.expression) &&
      ['window', 'globalThis', 'self'].includes(e.expression.text)
    );
  };

  /** Le texte par lequel commence une cible littérale ; `null` si elle ne se lit pas. */
  const debutLitteral = (cible: ts.Expression | undefined): string | null => {
    if (!cible) return null;
    if (ts.isStringLiteral(cible) || ts.isNoSubstitutionTemplateLiteral(cible)) return cible.text;
    if (ts.isTemplateExpression(cible)) return cible.head.text;
    return null;
  };

  /** `enTetesRuche()`, ou `identite` — le paramètre d'`api()` dont c'est la valeur par défaut. */
  const estIdentite = (x: ts.Expression): boolean =>
    (ts.isCallExpression(x) &&
      ts.isIdentifier(x.expression) &&
      x.expression.text === 'enTetesRuche') ||
    (ts.isIdentifier(x) && x.text === 'identite');

  /** Les en-têtes de CET appel portent-ils l'identité — directement, ou étalée dans un objet ? */
  const porteIdentite = (appel: ts.CallExpression): boolean => {
    const options = appel.arguments[1];
    if (!options || !ts.isObjectLiteralExpression(options)) return false;
    const headers = options.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'headers',
    );
    if (!headers) return false;
    const valeur = headers.initializer;
    if (estIdentite(valeur)) return true;
    return (
      ts.isObjectLiteralExpression(valeur) &&
      valeur.properties.some((p) => ts.isSpreadAssignment(p) && estIdentite(p.expression))
    );
  };

  const ou = (source: ts.SourceFile, noeud: ts.Node): string =>
    `${source.fileName}:${source.getLineAndCharacterOfPosition(noeud.getStart()).line + 1}`;

  it('chaque fetch vers `/api/…` prend ses en-têtes à `enTetesRuche()` ; aucun autre ne les prend', () => {
    let vus = 0;
    for (const source of sources) {
      for (const appel of appels(source, estFetch)) {
        vus += 1;
        const cible = appel.arguments[0];
        // `api()` reçoit un `path` : c'est le test suivant qui prouve que
        // chacun de ses appelants lui donne une route de la Reine.
        const cheminDApi =
          source === sourceApi &&
          fonctionDe(appel) === 'api' &&
          cible !== undefined &&
          ts.isIdentifier(cible) &&
          cible.text === 'path';
        const debut = cheminDApi ? '/api/' : debutLitteral(cible);
        expect(
          debut,
          `${ou(source, appel)} : cible illisible — dites si c’est la Reine (\`/api/…\`, ` +
            'avec `enTetesRuche()`) ou un tiers (SANS elle)',
        ).not.toBeNull();
        if (debut?.startsWith('/api/')) {
          expect(porteIdentite(appel), `${ou(source, appel)} : un fetch part sans l’identité`).toBe(
            true,
          );
        } else {
          expect(
            porteIdentite(appel),
            `${ou(source, appel)} : l’identité de la ruche (HIVE_TOKEN, JWT) partirait chez un ` +
              `tiers (${debut}) — un appel hors de la Reine ne la porte JAMAIS`,
          ).toBe(false);
        }
      }
    }
    // Trois aujourd'hui : `api()`, la Reine, OpenAlex. Zéro voudrait dire que
    // le balayage ne voit plus rien — une garde aveugle passe toujours.
    expect(vus, 'le balayage ne trouve aucun fetch').toBeGreaterThanOrEqual(3);
  });

  it('`api()` part avec `enTetesRuche()` par défaut, et chacun de ses appelants vise la Reine', () => {
    if (!sourceApi) throw new Error('dashboard/src/api.ts introuvable');
    // Le test précédent accepte `...identite` dans `api()` parce que SA VALEUR
    // PAR DÉFAUT est l'identité. C'est donc elle qu'on épingle.
    const declaration = sourceApi.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'api',
    );
    const identite = declaration?.parameters.find(
      (p) => ts.isIdentifier(p.name) && p.name.text === 'identite',
    );
    expect(identite?.initializer?.getText(sourceApi), 'la valeur par défaut d’`identite`').toBe(
      'enTetesRuche()',
    );

    const aides = new Set(['api', 'apiCompte', 'apiLecture']);
    const passages = appels(
      sourceApi,
      (a) => ts.isIdentifier(a.expression) && aides.has(a.expression.text),
    );
    for (const appel of passages) {
      const cible = appel.arguments[0];
      // `apiCompte` et `apiLecture` transmettent leur propre `path` : ce sont
      // LEURS appelants qui sont vérifiés, par cette même boucle.
      const relais =
        aides.has(fonctionDe(appel) ?? '') &&
        cible !== undefined &&
        ts.isIdentifier(cible) &&
        cible.text === 'path';
      if (relais) continue;
      expect(
        debutLitteral(cible),
        `${ou(sourceApi, appel)} : \`api()\` porte l’identité — sa cible doit être \`/api/…\``,
      ).toMatch(/^\/api\//);
    }
    // Plus d'une centaine aujourd'hui : un balayage qui n'en verrait presque
    // plus aurait cessé de lire le fichier, pas trouvé un code plus sobre.
    expect(passages.length, 'le balayage ne trouve plus les appels d’`api()`').toBeGreaterThan(50);
  });
});
