// Les connecteurs, bout en bout à travers la Reine : l'administrateur pose un
// secret, un projet autorise le webhook, un « test » part réellement vers un
// FAUX RÉCEPTEUR local, et le journal en garde la trace. Preuve de comportement
// réel du chemin sortant — le récepteur vérifie la signature qu'il reçoit.

import { createServer as createHttp, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { verifierSignature } from '../src/orchestrator/abonnement.js';
import { ENTETE_SIGNATURE } from '../src/connectors/webhook/charge.js';
import { ENV_WEBHOOK_SECRET, ENV_WEBHOOK_URL } from '../src/connectors/webhook/definition.js';

const TOKEN = 'jeton-de-ruche-suffisamment-long-42';
const SECRET = 'secret-hmac-connecteur-de-test-42';

describe('connecteurs — bout en bout à travers la Reine', () => {
  let server: HiveServer;
  let recepteur: Server;
  let recus: Array<{ body: string; sig: string | undefined }> = [];
  let dir: string;
  let base: string;
  let urlRecepteur = '';
  let jetonAdmin = '';
  let jetonMembre = '';
  let projet = '';

  const jeton = { 'x-hive-token': TOKEN };
  const compte = (t: string) => ({ authorization: `Bearer ${t}` });

  const inscrire = async (email: string, entetes: Record<string, string> = {}): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    return ((await res.json()) as { token?: string }).token ?? '';
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-connecteurs-'));
    // Faux récepteur de webhook : capture corps + signature.
    urlRecepteur = await new Promise<string>((resolve) => {
      recepteur = createHttp((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          recus.push({ body, sig: req.headers[ENTETE_SIGNATURE] as string | undefined });
          res.writeHead(200);
          res.end('{}');
        });
      });
      recepteur.listen(0, '127.0.0.1', () => {
        const addr = recepteur.address();
        resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/hook`);
      });
    });

    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      envPath: path.join(dir, 'queen.env'),
      simulation: false,
      tickMs: 60_000,
      trustProxy: 'loopback',
    });
    base = `http://127.0.0.1:${server.port}`;

    // Premier compte = admin (exige le jeton) ; le second est un simple membre.
    jetonAdmin = await inscrire('reine@ruche.test', jeton);
    jetonMembre = await inscrire('membre@ruche.test');
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: compte(jetonAdmin) })
    ).json()) as {
      id: string;
    };
    projet = server.store.createProject({ name: 'Projet', ownerId: moi.id }).id;
    server.store.addMember(projet, moi.id, 'owner');
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((resolve) => recepteur.close(() => resolve()));
    // Ne pas laisser fuir les secrets posés dans process.env vers d'autres bancs.
    delete process.env[ENV_WEBHOOK_URL];
    delete process.env[ENV_WEBHOOK_SECRET];
    rmSync(dir, { recursive: true, force: true });
  });

  it('le catalogue est réservé à l’administrateur', async () => {
    const membre = await fetch(`${base}/api/connecteurs`, { headers: compte(jetonMembre) });
    expect(membre.status).toBe(403);
    const admin = await fetch(`${base}/api/connecteurs`, { headers: compte(jetonAdmin) });
    expect(admin.status).toBe(200);
    const j = (await admin.json()) as { connecteurs: Array<{ id: string; actif: boolean }> };
    expect(j.connecteurs.map((c) => c.id).sort()).toEqual(['slack', 'webhook']);
    expect(j.connecteurs.find((c) => c.id === 'webhook')?.actif).toBe(false);
  });

  it('poser les secrets rend le webhook actif — sans jamais renvoyer la valeur', async () => {
    for (const [envVar, valeur] of [
      [ENV_WEBHOOK_URL, urlRecepteur],
      [ENV_WEBHOOK_SECRET, SECRET],
    ] as const) {
      const r = await fetch(`${base}/api/connecteurs/webhook/secrets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...compte(jetonAdmin) },
        body: JSON.stringify({ envVar, valeur }),
      });
      expect(r.status).toBe(200);
    }
    const cat = (await (
      await fetch(`${base}/api/connecteurs`, { headers: compte(jetonAdmin) })
    ).json()) as {
      connecteurs: Array<{ id: string; actif: boolean; secrets: Array<{ presente: boolean }> }>;
    };
    const webhook = cat.connecteurs.find((c) => c.id === 'webhook')!;
    expect(webhook.actif).toBe(true);
    expect(webhook.secrets.every((s) => s.presente)).toBe(true);
    // Le corps ne contient nulle part la valeur du secret.
    expect(JSON.stringify(cat)).not.toContain(SECRET);
  });

  it('autoriser puis tester ENVOIE réellement un corps signé, et le journalise', async () => {
    recus = [];
    const autoriser = await fetch(`${base}/api/projects/${projet}/connecteurs/webhook/autoriser`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...compte(jetonAdmin) },
      body: JSON.stringify({ portees: ['notification'] }),
    });
    expect(autoriser.status).toBe(200);

    const test = await fetch(`${base}/api/projects/${projet}/connecteurs/webhook/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...compte(jetonAdmin) },
      body: JSON.stringify({ kind: 'decision' }),
    });
    expect(test.status).toBe(200);
    expect((await test.json()) as { envoye: boolean }).toMatchObject({ envoye: true });

    // Le récepteur a reçu un corps, et sa signature est valide.
    expect(recus.length).toBe(1);
    const recu = recus[0]!;
    expect(JSON.parse(recu.body).kind).toBe('decision');
    const verdict = verifierSignature({
      charge: recu.body,
      entete: recu.sig ?? '',
      secret: SECRET,
      now: Date.now(),
    });
    expect(verdict.valide).toBe(true);

    // Le journal du projet porte l'entrée « ok ».
    const vue = (await (
      await fetch(`${base}/api/projects/${projet}/connecteurs`, { headers: compte(jetonAdmin) })
    ).json()) as {
      autorisations: Array<{ connecteurId: string; portees: string[] }>;
      journal: Array<{ connecteurId: string; resultat: string; acte: string }>;
    };
    expect(vue.autorisations.find((a) => a.connecteurId === 'webhook')?.portees).toEqual([
      'notification',
    ]);
    expect(vue.journal.some((e) => e.connecteurId === 'webhook' && e.resultat === 'ok')).toBe(true);
  });

  it('révoquer coupe le connecteur pour le projet', async () => {
    const del = await fetch(`${base}/api/projects/${projet}/connecteurs/webhook`, {
      method: 'DELETE',
      headers: compte(jetonAdmin),
    });
    expect(del.status).toBe(200);
    expect((await del.json()) as { revoque: boolean }).toMatchObject({ revoque: true });
    const vue = (await (
      await fetch(`${base}/api/projects/${projet}/connecteurs`, { headers: compte(jetonAdmin) })
    ).json()) as { autorisations: unknown[] };
    expect(vue.autorisations.length).toBe(0);
  });
});
