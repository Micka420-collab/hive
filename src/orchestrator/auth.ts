// Module d'authentification : PBKDF2 (natif Node) pour les mots de passe,
// JWT HS256 signé maison pour les sessions. Utilisé par les routes REST et le
// middleware d'authentification.

import { timingSafeEqual, randomBytes, createHmac, pbkdf2Sync } from 'node:crypto';

const JWT_SECRET: string = process.env.HIVE_JWT_SECRET || 'change-me-jwt-dev-only';
const JWT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// ─── Hachage des mots de passe (PBKDF2, sans dépendance native) ───────────────
// Format stocké : `iterations$salt$hash` — la vérification relit le nombre
// d'itérations depuis la chaîne, donc on peut le relever plus tard sans casser
// les comptes existants.

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 32;
const PBKDF2_DIGEST = 'sha256';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, PBKDF2_DIGEST).toString(
    'base64url',
  );
  return `${PBKDF2_ITERATIONS}$${salt}$${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  // Bornes dures : une valeur folle (0, négative, milliards) serait soit un
  // contournement du coût, soit un déni de service par calcul interminable.
  const iterations = Number(parts[0]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  const salt = parts[1]!;
  const expectedHash = parts[2]!;
  const key = pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LEN, PBKDF2_DIGEST).toString(
    'base64url',
  );
  try {
    const a = Buffer.from(key);
    const b = Buffer.from(expectedHash);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── JWT (simple, sans dépendance) ────────────────────────────────────────────

interface JwtPayload {
  sub: string; // userId
  email: string;
  iat: number;
  exp: number;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

export function signJwt(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64urlEncode(
    JSON.stringify({ sub: userId, email, iat: now, exp: now + JWT_EXPIRY_MS / 1000 }),
  );
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expectedSig = createHmac('sha256', JWT_SECRET)
    .update(`${header!}.${payload!}`)
    .digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }
  let decoded: JwtPayload;
  try {
    decoded = JSON.parse(base64urlDecode(payload!)) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof decoded.sub !== 'string' || typeof decoded.email !== 'string') return null;
  if (typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return decoded;
}

// ─── Email validation ─────────────────────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
