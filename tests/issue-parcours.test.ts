// D'UNE ISSUE À DES TÂCHES — le trajet complet, sans réseau.
//
// Les tests du module pur disent ce que `lireIssue` et `briefDeIssue` font. Ils
// ne disent rien de ce qui les relie : la route lit-elle vraiment GitHub ? le
// filtre des pull requests survit-il au chemin réel ? le texte de l'issue
// arrive-t-il DANS le prompt d'une tâche, et dans le bloc de données ?
//
// C'est la forme de défaut trouvée toute la nuit : le trou n'est dans aucune
// pièce, il est entre elles.
//
// ─── DEUX FAUX SERVICES, ET ILS JOURNALISENT ─────────────────────────────────
//
// Le faux GitHub et la fausse Queen Bee notent ce qu'on leur a demandé et ce
// qu'ils N'ONT PAS SU servir. Sans ce journal, un chemin d'URL qui change rend
// un test rouge sur un message qui parle d'autre chose — piège déjà payé cette
// nuit sur la livraison.

import { createServer as createHttp } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { FERMETURE_DONNEES, OUVERTURE_DONNEES } from '../src/shared/donnees-non-fiables.js';
import { corpsPr } from '../src/orchestrator/livraison.js';

const TOKEN = 'jeton-issue-suffisamment-long-42';

/** Une issue, telle que l'API GitHub la rend. */
const issue = (n: number, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  number: n,
  title: `Demande numéro ${n}`,
  body: `Il faudrait faire la chose ${n}.`,
  state: 'open',
  locked: false,
  comments: 0,
  html_url: `https://github.com/micka/ruche/issues/${n}`,
  updated_at: `2026-07-${String(10 + n).padStart(2, '0')}T10:00:00Z`,
  user: { login: 'demandeur' },
  labels: [{ name: 'bug' }],
  ...patch,
});

describe('d’une issue GitHub à des tâches de la ruche', () => {
  let server: HiveServer;
  let faux: Server;
  let dir: string;
  let base: string;
  let projet = '';
  let sansDepot = '';
  /** Ce que les faux services n'ont pas su servir — lu quand un test surprend. */
  const nonServis: string[] = [];
  /** Les briefs reçus par la fausse Queen Bee, dans l'ordre. */
  const briefsRecus: string[] = [];

  beforeAll(async () => {
    // ── Le faux GitHub ET la fausse Queen Bee, sur le même port ──────────────
    faux = createHttp((req, res) => {
      const url = req.url ?? '';
      const rendre = (code: number, corps: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corps));
      };

      // GitHub : la liste des issues du dépôt. On y glisse DEUX pull requests,
      // parce que c'est ce que fait l'API réelle.
      if (url.startsWith('/repos/micka/ruche/issues?')) {
        return rendre(200, [
          issue(3),
          { ...issue(4), pull_request: { url: 'https://api.github.com/pulls/4' } },
          issue(5, { state: 'open', locked: true }),
          { ...issue(6), pull_request: {} },
        ]);
      }
      if (url === '/repos/micka/ruche/issues/3') return rendre(200, issue(3));
      if (url === '/repos/micka/ruche/issues/5') return rendre(200, issue(5, { locked: true }));
      if (url === '/repos/micka/ruche/issues/7') return rendre(200, issue(7, { state: 'closed' }));
      if (url === '/repos/micka/ruche/issues/4') {
        return rendre(200, {
          ...issue(4),
          pull_request: { url: 'https://api.github.com/pulls/4' },
        });
      }

      // Queen Bee : on renvoie deux tâches, et on GARDE le brief reçu.
      if (url === '/chat/completions') {
        let corps = '';
        req.on('data', (c: Buffer) => (corps += c.toString()));
        req.on('end', () => {
          const envoye = JSON.parse(corps) as { messages: { content: string }[] };
          briefsRecus.push(envoye.messages.map((m) => m.content).join('\n'));
          rendre(200, {
            model: 'faux-modele',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    rationale: 'découpage de test',
                    tasks: [
                      { id: 'A', title: 'Première étape', prompt: 'faire la première chose' },
                      {
                        id: 'B',
                        title: 'Seconde étape',
                        prompt: 'faire la seconde',
                        dependsOn: ['A'],
                      },
                    ],
                  }),
                },
              },
            ],
          });
        });
        return;
      }

      nonServis.push(`${req.method} ${url}`);
      rendre(404, { message: 'Not Found' });
    });
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
    const port = (faux.address() as { port: number }).port;

    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-de-test';
    process.env.QUEEN_BEE_API_KEY = 'cle-de-test';
    process.env.QUEEN_BEE_BASE_URL = `http://127.0.0.1:${port}`;
    // `HIVE_GITHUB_API` existe déjà pour GitHub Enterprise : on s'en sert pour
    // que les tests ne touchent jamais le réseau.
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${port}`;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-issue-'));
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
    // Projet ORPHELIN : le jeton de ruche l'engage encore (ADR 0007).
    projet = server.store.createProject({
      name: 'Ruche',
      repoUrl: 'https://github.com/micka/ruche.git',
      ownerId: null,
    }).id;
    sansDepot = server.store.createProject({ name: 'Sans dépôt', ownerId: null }).id;
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((r) => faux.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
    delete process.env.HIVE_GITHUB_TOKEN;
    delete process.env.QUEEN_BEE_API_KEY;
    delete process.env.QUEEN_BEE_BASE_URL;
    delete process.env.HIVE_GITHUB_API;
  });

  const jeton = { 'x-hive-token': TOKEN };

  it('LES PULL REQUESTS N’APPARAISSENT PAS DANS LA LISTE DES ISSUES', async () => {
    // Le piège, éprouvé sur le chemin RÉEL et pas seulement dans le module pur :
    // `GET /issues` rend les PR avec les issues, et rien côté API ne les écarte.
    const r = await fetch(`${base}/api/projects/${projet}/issues`, { headers: jeton });
    expect(r.status, `non servis : ${nonServis.join(', ')}`).toBe(200);
    const corps = (await r.json()) as { issues: { numero: number }[]; depot: string };
    expect(corps.depot).toBe('micka/ruche');
    expect(corps.issues.map((i) => i.numero).sort(), 'les #4 et #6 sont des PR').toEqual([3, 5]);
  });

  /** Prend une issue par son numéro, et rend les tâches créées. */
  const prendreIssue = async (numero: number): Promise<{ id: string; title: string }[]> => {
    const r = await fetch(`${base}/api/projects/${projet}/issues/${numero}`, {
      method: 'POST',
      headers: jeton,
    });
    expect(r.status, `non servis : ${nonServis.join(', ')}`).toBe(201);
    return ((await r.json()) as { taches: { id: string; title: string }[] }).taches;
  };

  it('PRENDRE UNE ISSUE CRÉE DES TÂCHES', async () => {
    const avant = server.store.listTasks(projet).length;
    const r = await fetch(`${base}/api/projects/${projet}/issues/3`, {
      method: 'POST',
      headers: jeton,
    });
    expect(r.status, `non servis : ${nonServis.join(', ')}`).toBe(201);
    const corps = (await r.json()) as { taches: { id: string; title: string }[] };
    expect(corps.taches).toHaveLength(2);
    expect(server.store.listTasks(projet).length).toBe(avant + 2);
  });

  it('LE TEXTE DE L’ISSUE ARRIVE DANS LE BLOC DE DONNÉES, PAS DANS LA CONSIGNE', async () => {
    // C'est le maillon qui compte : le corps d'une issue est écrit par
    // n'importe qui sur un dépôt public, et il vient d'entrer dans un prompt de
    // planification.
    //
    // IL PREND L'ISSUE LUI-MÊME. Il lisait le DERNIER brief reçu, donc celui
    // fabriqué par le test au-dessus : joué en premier, la liste était vide et
    // il annonçait « la Queen Bee n'a reçu aucun brief » — un diagnostic qui
    // désignait la Queen Bee alors que le défaut était dans sa propre prémisse.
    await prendreIssue(3);
    const brief = briefsRecus.at(-1) ?? '';
    expect(brief, 'la Queen Bee n’a reçu aucun brief').not.toBe('');
    const ouverture = brief.indexOf(OUVERTURE_DONNEES);
    const fermeture = brief.indexOf(FERMETURE_DONNEES);
    expect(ouverture).toBeGreaterThan(-1);
    expect(fermeture).toBeGreaterThan(ouverture);
    expect(brief.slice(ouverture, fermeture)).toContain('faire la chose 3');
    expect(brief.slice(0, ouverture), 'le corps ne doit PAS précéder le bloc').not.toContain(
      'faire la chose 3',
    );
    expect(brief).toContain('Closes #3');
  });

  it('UNE PULL REQUEST PRISE PAR SON NUMÉRO EST REFUSÉE, ET LE DIT', async () => {
    const r = await fetch(`${base}/api/projects/${projet}/issues/4`, {
      method: 'POST',
      headers: jeton,
    });
    expect(r.status).toBe(409);
    const corps = (await r.json()) as { conseil?: string; error?: string };
    expect(`${corps.error} ${corps.conseil}`).toMatch(/pull request/i);
  });

  it('une issue VERROUILLÉE ou FERMÉE est refusée avec sa raison', async () => {
    for (const [numero, motif] of [
      [5, /verrouill/i],
      [7, /ferm/i],
    ] as const) {
      const r = await fetch(`${base}/api/projects/${projet}/issues/${numero}`, {
        method: 'POST',
        headers: jeton,
      });
      expect(r.status, `#${numero}`).toBe(409);
      expect(((await r.json()) as { error: string }).error).toMatch(motif);
    }
  });

  it('un projet SANS DÉPÔT le dit, au lieu d’un 500 muet', async () => {
    const r = await fetch(`${base}/api/projects/${sansDepot}/issues`, { headers: jeton });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/dépôt GitHub/i);
  });

  it('LA GARDE D’ENGAGEMENT S’APPLIQUE — un projet d’autrui reste fermé (ADR 0007)', async () => {
    // Lire les issues consomme le quota GitHub de l'hôte ; en prendre une fait
    // travailler l'essaim. Les deux sont des engagements.
    const aQuelquun = server.store.createProject({
      name: 'Projet possédé',
      repoUrl: 'https://github.com/micka/ruche.git',
      visibility: 'private',
      ownerId: 'quelqu-un-d-autre',
    }).id;
    for (const [methode, chemin] of [
      ['GET', 'issues'],
      ['POST', 'issues/3'],
    ] as const) {
      const r = await fetch(`${base}/api/projects/${aQuelquun}/${chemin}`, {
        method: methode,
        headers: jeton,
      });
      expect(r.status, `${methode} ${chemin}`).toBe(404);
    }
  });

  it('PRENDRE UNE ISSUE RANGE LE LIEN POUR CHAQUE TÂCHE CRÉÉE', async () => {
    const taches = await prendreIssue(3);
    expect(taches.length).toBeGreaterThan(0);
    for (const t of taches) {
      expect(server.store.issueDeTache(t.id), t.id).toEqual({ depot: 'micka/ruche', numero: 3 });
    }
  });

  it('REPRENDRE LA MÊME ISSUE NE COLLISIONNE PAS, ET LE DAG SURVIT', async () => {
    // Reprendre une issue est le geste naturel quand le premier découpage ne
    // convient pas. La Queen Bee rend des identifiants de son cru (« A »,
    // « B »), uniques dans un découpage et pas dans un projet : sans préfixe,
    // la clé primaire entrait en collision et la route rendait un 502 muet.
    //
    // IL PREND DEUX FOIS, LUI-MÊME. Il se disait « la SECONDE prise du
    // fichier » et comptait donc sur ses voisins pour être la première : joué
    // en premier, il n'éprouvait aucune collision et son vert ne disait rien.
    await prendreIssue(3);
    const taches = await prendreIssue(3);
    expect(taches).toHaveLength(2);
    for (const t of taches) expect(t.id).toMatch(/^i3-/);

    // ET LE DAG A SURVÉCU. Renuméroter les tâches sans renuméroter leurs
    // dépendances les casserait en silence — bien pire qu'une collision
    // bruyante : la seconde tâche partirait sans attendre la première.
    const seconde = server.store.getTask(taches[1]!.id);
    expect(seconde?.dependsOn, 'la dépendance doit pointer sur le NOUVEL id').toEqual([
      taches[0]!.id,
    ]);
  });

  it('une tâche ordinaire n’a pas de lien — et n’en invente pas', () => {
    const seule = server.store.createTask({
      projectId: projet,
      title: 'tâche à la main',
      prompt: 'sans issue',
    });
    expect(server.store.issueDeTache(seule.id)).toBeNull();
  });

  it('L’ÉLAGAGE EST RÉFÉRENTIEL : un lien sans sa tâche disparaît', () => {
    // La borne vit avec la table, dans le même commit. Elle est référentielle
    // et non temporelle : un « garder les N derniers » serait un second réglage
    // à accorder à l'élagage des tâches, donc un désaccord en puissance.
    server.store.lierTacheIssue({
      taskId: 'tache-qui-nexiste-pas',
      projectId: projet,
      depot: 'micka/ruche',
      numero: 99,
    });
    expect(server.store.issueDeTache('tache-qui-nexiste-pas')).not.toBeNull();
    const supprimes = server.store.pruneTachesIssue();
    expect(supprimes).toBeGreaterThanOrEqual(1);
    expect(server.store.issueDeTache('tache-qui-nexiste-pas')).toBeNull();
    // …et il n'emporte pas les liens dont la tâche vit encore. La tâche
    // témoin est créée ICI : ce test comptait sur une prise d'issue voisine
    // pour lui en laisser une, et cette moitié-là de la borne ne se vérifiait
    // donc qu'un ordre sur deux.
    const temoin = server.store.createTask({
      projectId: projet,
      title: 'tâche liée, bien vivante',
      prompt: 'x',
    });
    server.store.lierTacheIssue({
      taskId: temoin.id,
      projectId: projet,
      depot: 'micka/ruche',
      numero: 3,
    });
    const vivantes = server.store.listTasks(projet);
    const avecLien = vivantes.filter((t) => server.store.issueDeTache(t.id) !== null);
    expect(avecLien.length, 'les liens des tâches vivantes doivent survivre').toBeGreaterThan(0);
  });

  it('les faux services ont tout servi — sinon les verdicts ci-dessus mentent', () => {
    expect(nonServis, 'requêtes non servies').toEqual([]);
  });
});

describe('la boucle se referme : « Closes #N » dans la pull request', () => {
  // Le lot précédent laissait la boucle ouverte : la ruche répondait à une
  // demande sans jamais dire qu'elle y répondait, et le demandeur devait
  // refermer son issue à la main.
  //
  // Le lien tâche→issue vit dans une table LATÉRALE (`taches_issue`) : la très
  // grande majorité des tâches ne vient d'aucune issue, et une colonne vide sur
  // toutes les lignes est une colonne qu'on finit par remplir d'autre chose.

  it('LE NUMÉRO VIENT DU LIEN RANGÉ, JAMAIS DU TEXTE DE L’ISSUE', () => {
    // Un corps d'issue qui contiendrait « Closes #7 » ne doit pas pouvoir faire
    // refermer l'issue de quelqu'un d'autre. `corpsPr` prend un `number`, et ce
    // nombre vient de `issueDeTache` — donc de ce que la ruche a rangé quand
    // elle a lu l'API, pas de ce que l'auteur a écrit.
    const avec = corpsPr({ tache: 't', nodeName: 'n', fichiers: ['a.ts'], issue: 42 });
    expect(avec).toContain('Closes #42');
    // …et l'annonce précède le corps, là où GitHub la lit.
    expect(avec.indexOf('Closes #42')).toBeLessThan(avec.indexOf('**Tâche**'));
  });

  it('SANS ISSUE, AUCUNE MENTION — une PR ordinaire ne referme rien', () => {
    const sans = corpsPr({ tache: 't', nodeName: 'n', fichiers: ['a.ts'] });
    expect(sans).not.toMatch(/Closes #/);
    // Un numéro absurde ne passe pas non plus : 0 n'est pas une issue.
    for (const numero of [0, -1, 1.5, Number.NaN]) {
      expect(corpsPr({ tache: 't', nodeName: 'n', fichiers: [], issue: numero })).not.toMatch(
        /Closes #/,
      );
    }
  });
});
