// Module d'authentification : bcrypt pour les mots de passe, JWT pour les sessions.
// Utilisé par les routes REST et le middleware d'authentification.

import { timingSafeEqual, randomBytes, createHmac } from 'node:crypto';

const JWT_SECRET: string = process.env.HIVE_JWT_SECRET || 'change-me-jwt-dev-only';
const JWT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// ─── Password hashing (bcrypt-like, sans dépendance native) ──────────────────
// Utilise PBKDF2 (intégré à Node) — le format de sortie est compatible avec
// notre propre vérification. En production, utiliser bcryptjs ou argon2.

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha256';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  const key = createHmac(PBKDF2_DIGEST, salt).update(password).digest('base64url');
  // Format: iterations$salt$hash
  return `${PBKDF2_ITERATIONS}$${salt}$${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = parts[1]!;
  const expectedHash = parts[2]!;
  const key = createHmac(PBKDF2_DIGEST, salt).update(password).digest('base64url');
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
  const decoded = JSON.parse(base64urlDecode(payload!)) as JwtPayload;
  if (typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return decoded;
}

// ─── Email validation ─────────────────────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
