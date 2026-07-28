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

  it('les faux services ont tout servi — sinon les verdicts ci-dessus mentent', () => {
    expect(nonServis, 'requêtes non servies').toEqual([]);
  });
});
