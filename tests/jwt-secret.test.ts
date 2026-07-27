// Le secret de signature des sessions.
//
// ─── LA FAILLE QUE CE FICHIER FERME ──────────────────────────────────────────
//
// `auth.ts` signait les jetons de session avec, à défaut de variable
// d'environnement, une chaîne écrite en dur dans le code :
//
//     const JWT_SECRET = process.env.HIVE_JWT_SECRET || 'change-me-jwt-dev-only';
//
// Ce dépôt est PUBLIC. Le secret l'était donc aussi. Et comme ni
// « npm run setup » ni les README ne mentionnaient `HIVE_JWT_SECRET` — seul
// `.env.example` en parlait, en commentaire, comme d'une option — aucune
// installation ne le définissait : toutes les ruches du monde signaient leurs
// sessions avec la même clé, lisible par quiconque ouvre le fichier.
//
// Deux conséquences, et la seconde annule tout le travail sur les rôles :
//
//   1. FABRIQUER UNE SESSION SANS COMPTE. `verifyJwt` ne vérifie que la
//      signature et l'expiration ; `roleDe` rend « membre » pour un identifiant
//      inconnu. Un jeton forgé sur un `sub` inventé donnait donc les droits
//      d'un membre — sans inscription, et donc en contournant complètement
//      `HIVE_INSCRIPTION=fermee`.
//
//   2. DEVENIR ADMINISTRATEUR. Le même jeton forgé sur l'identifiant de
//      l'administrateur donnait l'administration entière : les serveurs, les
//      rôles, tout. L'invariant « le jeton de ruche ne vaut pas preuve
//      d'administration » était scrupuleusement tenu — mais le JWT n'en valait
//      pas davantage, puisque sa clé était publique.
//
// La garde suit celle de `HIVE_TOKEN` : la ruche REFUSE DE DÉMARRER plutôt que
// de tourner avec un secret connu. Un serveur qui ne démarre pas se remarque ;
// un serveur silencieusement forgeable, non.

import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LONGUEUR_MIN_SECRET_JWT,
  SECRET_JWT_INTERDIT,
  secretJwtDepuisEnv,
} from '../src/orchestrator/auth.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-jwt-assez-long-pour-passer';
const SECRET = 'un-secret-de-session-bien-a-moi-0123456789';
const MDP = 'la ruche bourdonne au matin';

/** Forge un jeton de session avec le secret donné. Ce que ferait l'attaquant. */
function forger(sub: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const entete = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const charge = Buffer.from(
    JSON.stringify({ sub, email: 'intrus@x.fr', iat: now, exp: now + 3600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${entete}.${charge}`).digest('base64url');
  return `${entete}.${charge}.${signature}`;
}

describe('le secret de session — la lecture', () => {
  const avant = process.env.HIVE_JWT_SECRET;
  afterEach(() => {
    if (avant === undefined) delete process.env.HIVE_JWT_SECRET;
    else process.env.HIVE_JWT_SECRET = avant;
  });

  it('AUCUN SECRET PAR DÉFAUT : absent rend la chaîne vide', () => {
    // Un défaut, quel qu'il soit, finirait dans une installation réelle — et
    // celui-ci était dans un dépôt public.
    expect(secretJwtDepuisEnv({})).toBe('');
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: '   ' })).toBe('');
  });

  it('l’ancien secret codé en dur est explicitement INTERDIT', () => {
    // Il circule : il a été publié, et il traîne dans les .env de quiconque
    // l'a recopié. L'accepter parce qu'il « vient de l'environnement » serait
    // refermer la porte en laissant la clé sous le paillasson.
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: SECRET_JWT_INTERDIT })).toBe('');
  });

  it('un secret trop court est refusé comme un secret absent', () => {
    // `.env.example` porte `HIVE_JWT_SECRET=change-me`, et ce fichier se recopie
    // sans se lire. Un marque-place qui démarrerait serait pire qu'un marque-place
    // qui refuse : il aurait l'air configuré.
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: 'change-me' })).toBe('');
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: 'x'.repeat(LONGUEUR_MIN_SECRET_JWT - 1) })).toBe(
      '',
    );
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: 'x'.repeat(LONGUEUR_MIN_SECRET_JWT) })).not.toBe(
      '',
    );
  });

  it('un vrai secret est rendu tel quel, sans les espaces de bordure', () => {
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: `  ${SECRET}  ` })).toBe(SECRET);
  });
});

describe('le secret de session — le démarrage', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  const avant: Record<string, string | undefined> = {};

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    for (const cle of ['HIVE_JWT_SECRET', 'HIVE_SIMULATION']) {
      if (avant[cle] === undefined) delete process.env[cle];
      else process.env[cle] = avant[cle];
    }
  });

  async function demarrer(opts: { secret?: string; simulation?: boolean } = {}): Promise<{
    base: string;
    srv: HiveServer;
  }> {
    for (const cle of ['HIVE_JWT_SECRET', 'HIVE_SIMULATION']) avant[cle] = process.env[cle];
    if (opts.secret === undefined) delete process.env.HIVE_JWT_SECRET;
    else process.env.HIVE_JWT_SECRET = opts.secret;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-jwt-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: opts.simulation ?? false,
      tickMs: 10_000,
    });
    return { base: `http://127.0.0.1:${server.port}`, srv: server };
  }

  it('LA RUCHE REFUSE DE DÉMARRER SANS SECRET', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-jwt-'));
    avant.HIVE_JWT_SECRET = process.env.HIVE_JWT_SECRET;
    delete process.env.HIVE_JWT_SECRET;
    await expect(
      createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(dir, 'hive.db'),
        simulation: false,
        tickMs: 10_000,
      }),
    ).rejects.toThrow(/HIVE_JWT_SECRET/);
  });

  it('elle refuse AUSSI l’ancien secret publié', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-jwt-'));
    avant.HIVE_JWT_SECRET = process.env.HIVE_JWT_SECRET;
    process.env.HIVE_JWT_SECRET = SECRET_JWT_INTERDIT;
    await expect(
      createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(dir, 'hive.db'),
        simulation: false,
        tickMs: 10_000,
      }),
    ).rejects.toThrow(/HIVE_JWT_SECRET/);
  });

  it('la démo locale (simulation) démarre quand même', async () => {
    // Refuser ici casserait « npm run demo » pour tout le monde, alors que la
    // simulation ne sert rien à personne d'autre que la machine qui la lance.
    const { base } = await demarrer({ simulation: true });
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('avec un vrai secret, tout fonctionne normalement', async () => {
    const { base } = await demarrer({ secret: SECRET });
    const rep = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'chef@x.fr', password: MDP, displayName: 'Chef' }),
    });
    expect(rep.status).toBe(200);
  });
});

describe('le secret de session — la contrefaçon', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  let avant: string | undefined;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    if (avant === undefined) delete process.env.HIVE_JWT_SECRET;
    else process.env.HIVE_JWT_SECRET = avant;
  });

  async function ruche(): Promise<{ base: string; srv: HiveServer; adminId: string }> {
    avant = process.env.HIVE_JWT_SECRET;
    process.env.HIVE_JWT_SECRET = SECRET;
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-forge-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const chef = (await (
      await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'chef@x.fr', password: MDP, displayName: 'Chef' }),
      })
    ).json()) as { token: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${chef.token}` } })
    ).json()) as { id: string };
    return { base, srv: server, adminId: moi.id };
  }

  it('UN JETON FORGÉ AVEC L’ANCIEN SECRET PUBLIC NE PASSE PAS', async () => {
    // C'était l'attaque : le secret étant dans un dépôt public, n'importe qui
    // pouvait se fabriquer la session de l'administrateur.
    const { base, adminId } = await ruche();
    const faux = forger(adminId, SECRET_JWT_INTERDIT);
    const rep = await fetch(`${base}/api/admin/membres`, {
      headers: { authorization: `Bearer ${faux}` },
    });
    expect(rep.status).toBe(401);
  });

  it('un jeton forgé sur un compte INEXISTANT ne donne rien non plus', async () => {
    // `roleDe` rend « membre » pour un identifiant inconnu : sans signature
    // valide, c'était une session complète sans inscription — et donc le
    // contournement intégral de `HIVE_INSCRIPTION=fermee`.
    const { base } = await ruche();
    const faux = forger('utilisateur-qui-n-existe-pas', SECRET_JWT_INTERDIT);
    const rep = await fetch(`${base}/api/moi/tableau`, {
      headers: { authorization: `Bearer ${faux}` },
    });
    expect(rep.status).toBe(401);
  });

  it('DEUX RUCHES AUX SECRETS DIFFÉRENTS N’ACCEPTENT PAS LES JETONS DE L’AUTRE', async () => {
    // La propriété qui rend le secret utile : il isole les ruches entre elles.
    const { base, adminId } = await ruche();
    const dUneAutreRuche = forger(adminId, 'le-secret-de-la-ruche-du-voisin-9876');
    const rep = await fetch(`${base}/api/admin/membres`, {
      headers: { authorization: `Bearer ${dUneAutreRuche}` },
    });
    expect(rep.status).toBe(401);
  });

  it('le jeton légitime, lui, passe', async () => {
    // Le contrôle négatif : sans lui, un `verifyJwt` cassé rendant toujours
    // `null` ferait passer tous les tests ci-dessus.
    const { base, adminId } = await ruche();
    const vrai = forger(adminId, SECRET);
    const rep = await fetch(`${base}/api/admin/membres`, {
      headers: { authorization: `Bearer ${vrai}` },
    });
    expect(rep.status).toBe(200);
  });
});
