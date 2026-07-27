// Module d'authentification : PBKDF2 (natif Node) pour les mots de passe,
// JWT HS256 signé maison pour les sessions. Utilisé par les routes REST et le
// middleware d'authentification.

import { timingSafeEqual, randomBytes, createHmac, pbkdf2Sync } from 'node:crypto';

const JWT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// ─── Le secret de signature des sessions ──────────────────────────────────────
//
// Il n'y a PAS de valeur par défaut, et c'est délibéré.
//
// Ce module signait autrefois les jetons avec `process.env.HIVE_JWT_SECRET ||
// 'change-me-jwt-dev-only'`. Le dépôt est public : la clé de repli l'était donc
// aussi, et comme l'installeur ne la posait pas, toutes les ruches installées
// signaient leurs sessions avec la MÊME clé, lisible par quiconque ouvrait ce
// fichier. N'importe qui pouvait alors se forger la session de l'administrateur
// de n'importe quelle ruche — l'invariant « le jeton de ruche ne vaut pas
// preuve d'administration » était tenu, mais le JWT n'en valait pas davantage.
//
// La garde vit dans `createServer` (server.ts), avant toute écoute réseau, sur
// le modèle de celle de `HIVE_TOKEN` : hors simulation, la ruche REFUSE DE
// DÉMARRER plutôt que de tourner avec un secret connu. Un serveur qui ne
// démarre pas se remarque ; un serveur silencieusement forgeable, non.

/**
 * L'ancien secret codé en dur, publié avec le dépôt.
 *
 * Refusé même quand il vient de l'environnement : il traîne désormais dans les
 * `.env` de quiconque l'a recopié, et l'accepter reviendrait à refermer la
 * porte en laissant la clé sous le paillasson.
 */
export const SECRET_JWT_INTERDIT = 'change-me-jwt-dev-only';

/**
 * Longueur minimale d'un secret de session, sur le modèle de
 * `MIN_TOKEN_LENGTH` pour le jeton de ruche.
 *
 * Elle existe surtout pour que `HIVE_JWT_SECRET=change-me` — le marque-place
 * de `.env.example`, qu'on recopie sans lire — ne démarre pas. Un secret court
 * est un secret devinable, et celui-ci signe les sessions d'administration.
 */
export const LONGUEUR_MIN_SECRET_JWT = 24;

/**
 * Lit le secret de session. Rend la chaîne vide quand il n'y en a pas
 * d'utilisable — absent, blanc, trop court, ou égal au secret publié.
 */
export function secretJwtDepuisEnv(env: Record<string, string | undefined> = process.env): string {
  const brut = (env.HIVE_JWT_SECRET ?? '').trim();
  if (brut === SECRET_JWT_INTERDIT || brut.length < LONGUEUR_MIN_SECRET_JWT) return '';
  return brut;
}

/**
 * Repli de simulation : tiré au sort à chaque démarrage de processus.
 *
 * `npm run demo` doit marcher sans configuration, et une démo strictement
 * locale n'a personne à protéger. Ce secret n'est écrit nulle part : les
 * sessions qu'il signe meurent avec le processus, ce qui est exactement ce
 * qu'on veut d'une démo.
 */
const SECRET_EPHEMERE = randomBytes(32).toString('base64url');

/**
 * Le secret effectivement utilisé pour signer et vérifier.
 *
 * Relu à chaque appel, jamais figé au chargement du module : figer obligerait à
 * connaître l'ordre des imports pour savoir quel secret est actif, et rendrait
 * la garde de démarrage inopérante dans les tests.
 */
function secretCourant(): string {
  return secretJwtDepuisEnv() || SECRET_EPHEMERE;
}

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
  const signature = createHmac('sha256', secretCourant())
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expectedSig = createHmac('sha256', secretCourant())
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
