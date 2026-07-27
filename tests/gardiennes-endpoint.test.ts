// Contrat HTTP des Gardiennes : GET /api/gardiennes — garde, forme, bornage,
// mémoïsation, et surtout HONNÊTETÉ de la réponse (le mode y figure, parce que
// « 0 refus » ne veut pas dire la même chose en `consultatif` et en `strict`).
//
// La route est ADDITIVE de bout en bout : elle ne touche aucune route existante,
// aucun fichier de dashboard/src, et une UI pourra s'y greffer plus tard sans
// rien modifier ici.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CORPUS_GARDIENNES,
  MAX_RECENTES,
  VERSION_GARDIENNES,
} from '../src/orchestrator/gardiennes.js';
import type { ModeGardiennes, VueGardiennes } from '../src/orchestrator/gardiennes.js';
import { createServer, loadConfigFromEnv } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-gardiennes-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

interface ReponseGardiennes extends VueGardiennes {
  mode: ModeGardiennes;
  fenetre: number;
}

describe('endpoint des Gardiennes', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(gardiennes?: ModeGardiennes): Promise<string> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-gardiennes-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000, // les ticks sont déclenchés à la main : rien d'implicite
      ...(gardiennes ? { gardiennes } : {}),
    });
    return `http://127.0.0.1:${server.port}`;
  }

  /** Range `n` verdicts, du plus ancien au plus récent. */
  function semer(n: number, applique = false): void {
    for (let i = 0; i < n; i++) {
      server?.store.enregistrerInspection(
        {
          resultId: i + 1,
          taskId: `T${i}`,
          nodeId: 'n1',
          verdict: i % 3 === 0 ? 'hollow' : 'clean',
          score: i % 3 === 0 ? 3 : 0,
          applique: applique && i % 3 === 0,
          griefs:
            i % 3 === 0
              ? [{ code: 'empty_diff', poids: 3, compte: 1, chemins: ['src/a.ts'], extrait: '' }]
              : [],
        },
        1_000 + i,
      );
    }
  }

  it('sans token : 401 — même garde que ses voisines', async () => {
    const base = await demarrer();
    expect((await fetch(`${base}/api/gardiennes`)).status).toBe(401);
    const mauvais = await fetch(`${base}/api/gardiennes`, {
      headers: { 'x-hive-token': 'pas-le-bon-jeton-du-tout' },
    });
    expect(mauvais.status).toBe(401);
  });

  it('rend une vue vide et honnête sur une ruche neuve', async () => {
    const base = await demarrer();
    const res = await fetch(`${base}/api/gardiennes`, { headers });
    expect(res.status).toBe(200);
    const vue = (await res.json()) as ReponseGardiennes;
    expect(vue).toEqual({
      version: VERSION_GARDIENNES,
      mode: 'consultatif', // le défaut du dépôt
      fenetre: CORPUS_GARDIENNES,
      inspections: 0,
      verdicts: { clean: 0, suspect: 0, hollow: 0 },
      refusees: 0,
      griefs: [],
      recentes: [],
    });
  });

  it('compte les verdicts, les griefs, et borne les détails rendus', async () => {
    const base = await demarrer();
    semer(30);
    const vue = (await (
      await fetch(`${base}/api/gardiennes`, { headers })
    ).json()) as ReponseGardiennes;
    expect(vue.inspections).toBe(30);
    expect(vue.verdicts.hollow).toBe(10);
    expect(vue.verdicts.clean).toBe(20);
    expect(vue.griefs).toEqual([{ code: 'empty_diff', occurrences: 10 }]);
    // Détails BORNÉS, plus récents d'abord : une route de lecture ne déplie
    // jamais un corpus, même borné.
    expect(vue.recentes).toHaveLength(MAX_RECENTES);
    expect(vue.recentes[0]?.taskId).toBe('T29');
  });

  // `refusees` compte ce qui a RÉELLEMENT fermé la porte, pas ce qui était
  // creux. Sans le `mode` dans la même réponse, un `refusees: 0` se lirait comme
  // une bonne nouvelle alors qu'il ne dit rien du tout : les deux tests suivants
  // montrent le même corpus lu de deux façons.

  it('en `consultatif` : des verdicts creux, ZÉRO refus', async () => {
    const base = await demarrer('consultatif');
    semer(9);
    const vue = (await (
      await fetch(`${base}/api/gardiennes`, { headers })
    ).json()) as ReponseGardiennes;
    expect(vue.mode).toBe('consultatif');
    expect(vue.verdicts.hollow).toBe(3);
    expect(vue.refusees).toBe(0);
  });

  it('en `strict` : le mode est rendu, et les refus sont comptés', async () => {
    const base = await demarrer('strict');
    semer(9, true);
    const vue = (await (
      await fetch(`${base}/api/gardiennes`, { headers })
    ).json()) as ReponseGardiennes;
    expect(vue.mode).toBe('strict');
    expect(vue.refusees).toBe(3);
  });

  it('en `off` : le mode est rendu, et la ruche n’a rien à montrer', async () => {
    const base = await demarrer('off');
    const vue = (await (
      await fetch(`${base}/api/gardiennes`, { headers })
    ).json()) as ReponseGardiennes;
    expect(vue.mode).toBe('off');
    expect(vue.inspections).toBe(0);
  });

  it('mémoïsation à TTL court : N dashboards en polling = 1 lecture', async () => {
    const base = await demarrer();
    semer(3);
    let lectures = 0;
    const vraie = server?.store.listInspections.bind(server.store);
    if (server && vraie) {
      server.store.listInspections = (limit?: number) => {
        lectures += 1;
        return limit === undefined ? vraie() : vraie(limit);
      };
    }
    for (let i = 0; i < 5; i++) await fetch(`${base}/api/gardiennes`, { headers });
    expect(lectures).toBe(1);
  });

  it('la lecture est BORNÉE : jamais plus de CORPUS_GARDIENNES lignes', async () => {
    const base = await demarrer();
    semer(40);
    const limites: Array<number | undefined> = [];
    const vraie = server?.store.listInspections.bind(server.store);
    if (server && vraie) {
      server.store.listInspections = (limit?: number) => {
        limites.push(limit);
        return limit === undefined ? vraie() : vraie(limit);
      };
    }
    await fetch(`${base}/api/gardiennes`, { headers });
    // Sans argument, `listInspections` applique CORPUS_GARDIENNES par défaut ;
    // le store plafonne de toute façon à 2 000.
    expect(limites).toHaveLength(1);
    expect(limites[0] === undefined || limites[0] <= CORPUS_GARDIENNES).toBe(true);
    const vue = (await (
      await fetch(`${base}/api/gardiennes`, { headers })
    ).json()) as ReponseGardiennes;
    expect(vue.inspections).toBeLessThanOrEqual(CORPUS_GARDIENNES);
  });
});

describe('configuration des Gardiennes', () => {
  it('HIVE_GARDIENNES : off | strict reconnus, TOUT le reste retombe sur `consultatif`', () => {
    expect(loadConfigFromEnv({ HIVE_GARDIENNES: 'off' }).gardiennes).toBe('off');
    expect(loadConfigFromEnv({ HIVE_GARDIENNES: 'strict' }).gardiennes).toBe('strict');
    expect(loadConfigFromEnv({ HIVE_GARDIENNES: 'consultatif' }).gardiennes).toBe('consultatif');
    // Une faute de frappe ne doit JAMAIS pouvoir fermer le trou de vol par
    // accident — ni l'ouvrir en grand sans qu'on l'ait demandé.
    for (const valeur of ['Strict', 'STRICT', 'oui', '1', '', 'consultative']) {
      expect(loadConfigFromEnv({ HIVE_GARDIENNES: valeur }).gardiennes, valeur).toBe('consultatif');
    }
    expect(loadConfigFromEnv({}).gardiennes).toBe('consultatif');
  });
});
