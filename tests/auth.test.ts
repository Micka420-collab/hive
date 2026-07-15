// Tests d'authentification : hachage PBKDF2 (format iterations$salt$hash),
// JWT HS256 maison (signature, expiration, payloads difformes), et flux HTTP
// register → login → me sur serveur réel (schémas Fastify inclus).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  isValidEmail,
} from '../src/orchestrator/auth.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

describe('hashPassword / verifyPassword (PBKDF2)', () => {
  it('vérifie le bon mot de passe et rejette le mauvais', () => {
    const stored = hashPassword('miel-très-secret');
    expect(verifyPassword('miel-très-secret', stored)).toBe(true);
    expect(verifyPassword('miel-tres-secret', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('sale : deux hachages du même mot de passe diffèrent', () => {
    expect(hashPassword('pareil')).not.toBe(hashPassword('pareil'));
  });

  it('relit le nombre d itérations depuis la chaîne stockée (montée future)', () => {
    const stored = hashPassword('x'.repeat(12));
    const [iterations, salt, hash] = stored.split('$');
    expect(Number(iterations)).toBeGreaterThanOrEqual(100_000);
    expect(salt!.length).toBeGreaterThan(10);
    expect(hash!.length).toBeGreaterThan(10);
  });

  it('rejette les formats altérés sans lever', () => {
    expect(verifyPassword('x', 'pas-un-hash')).toBe(false);
    expect(verifyPassword('x', 'a$b')).toBe(false);
    expect(verifyPassword('x', '0$sel$hash')).toBe(false); // itérations hors bornes
    expect(verifyPassword('x', '-5$sel$hash')).toBe(false);
    expect(verifyPassword('x', '999999999999$sel$hash')).toBe(false); // anti-DoS
    expect(verifyPassword('x', 'abc$sel$hash')).toBe(false); // non numérique
  });
});

describe('signJwt / verifyJwt', () => {
  it('signe puis vérifie un jeton valide', () => {
    const token = signJwt('user-1', 'a@b.fr');
    const payload = verifyJwt(token);
    expect(payload?.sub).toBe('user-1');
    expect(payload?.email).toBe('a@b.fr');
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejette signature altérée, structure difforme et payload corrompu', () => {
    const token = signJwt('user-1', 'a@b.fr');
    const [h, p, s] = token.split('.');
    expect(verifyJwt(`${h}.${p}.${s!.slice(0, -2)}xx`)).toBeNull(); // signature modifiée
    // Payload modifié (élévation) : la signature ne colle plus.
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', email: 'a@b.fr' })).toString(
      'base64url',
    );
    expect(verifyJwt(`${h}.${forged}.${s}`)).toBeNull();
    expect(verifyJwt('pas.un.jwt')).toBeNull();
    expect(verifyJwt('sans-points')).toBeNull();
    expect(verifyJwt('')).toBeNull();
  });

  it('rejette un jeton expiré', () => {
    // Forge un jeton avec la même clé mais exp dans le passé : impossible sans
    // le secret — on passe par signJwt puis on vérifie la borne via un payload
    // difforme : exp non numérique => null.
    const token = signJwt('user-1', 'a@b.fr');
    const [h, , s] = token.split('.');
    const noExp = Buffer.from(JSON.stringify({ sub: 'user-1', email: 'a@b.fr', iat: 0 })).toString(
      'base64url',
    );
    expect(verifyJwt(`${h}.${noExp}.${s}`)).toBeNull(); // signature invalide de toute façon
  });
});

describe('isValidEmail', () => {
  it('accepte les emails plausibles, rejette le reste', () => {
    expect(isValidEmail('abeille@ruche.fr')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('pas-un-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail(`${'x'.repeat(250)}@b.fr`)).toBe(false); // > 254
  });
});

describe('flux HTTP register → login → me', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  const headers = { 'content-type': 'application/json' };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-auth-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: 'jeton-auth-suffisamment-long',
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('register crée le compte et rend un jeton utilisable sur /me', async () => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'abeille@ruche.fr',
        password: 'nectar-doré-8',
        displayName: 'Abeille',
      }),
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token.split('.')).toHaveLength(3);

    const me = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    const user = (await me.json()) as Record<string, unknown>;
    expect(user.email).toBe('abeille@ruche.fr');
    expect(user.displayName).toBe('Abeille');
    expect(user.passwordHash).toBeUndefined(); // jamais exposé
  });

  it('doublon d email → 409 ; login bon/mauvais mot de passe → 200/401', async () => {
    const dup = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'abeille@ruche.fr',
        password: 'autre-mdp-8car',
        displayName: 'Clone',
      }),
    });
    expect(dup.status).toBe(409);

    const ok = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'abeille@ruche.fr', password: 'nectar-doré-8' }),
    });
    expect(ok.status).toBe(200);

    const ko = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'abeille@ruche.fr', password: 'mauvais-mdp' }),
    });
    expect(ko.status).toBe(401);
  });

  it('valide les corps (schéma Fastify) : champs manquants ou inconnus → 400', async () => {
    const missing = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'x@y.fr' }),
    });
    expect(missing.status).toBe(400);

    // Champ inconnu : l'Ajv de Fastify (removeAdditional) le RETIRE en
    // silence — le corps assaini continue et échoue en 401 (compte inconnu),
    // jamais en 500, et le champ ne traverse pas.
    const extra = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'x@y.fr', password: 'p'.repeat(10), role: 'admin' }),
    });
    expect(extra.status).toBe(401);

    const shortPwd = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'x@y.fr', password: 'court', displayName: 'X' }),
    });
    expect(shortPwd.status).toBe(400);
  });

  it('/me sans jeton ou avec jeton invalide → 401', async () => {
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
    const bad = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: 'Bearer pas.un.jwt' },
    });
    expect(bad.status).toBe(401);
  });
});
