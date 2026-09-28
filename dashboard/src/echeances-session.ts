// Les échéances d'une session de compte, lues dans le JWT rangé par ce
// navigateur — pour l'écran Paramètres (« ouverte le …, expire le … »).
//
// ─── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
//
// Il ne VÉRIFIE rien : la signature n'est connue que de la Reine, et c'est elle
// qui dit si la session vit (`/api/auth/me`, « LA SESSION QUI EXPIRE » dans
// `api.ts`). Ce qu'on lit ici est ce que la Reine a ÉCRIT dans la charge utile
// à la connexion (`signJwt`, src/orchestrator/auth.ts : `iat` et `exp`, en
// secondes). C'est une information d'affichage, jamais une décision.
//
// Un jeton illisible — pas trois segments, base64 cassé, champs absents ou non
// numériques, expiration avant ouverture — rend `null`, que l'écran dit
// « inconnue ». Inventer une date plausible serait pire que ne rien dire.

export interface EcheancesSession {
  /** Ouverture de la session, en millisecondes. */
  ouverteA: number;
  /** Expiration annoncée par la Reine, en millisecondes. */
  expireA: number;
}

/** Décode un segment base64url (sans remplissage) en texte UTF-8. */
function base64urlVersTexte(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const complet = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const octets = Uint8Array.from(atob(complet), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(octets);
}

export function lireEcheancesSession(jwt: string | null): EcheancesSession | null {
  if (!jwt) return null;
  const parties = jwt.split('.');
  if (parties.length !== 3 || !parties[1]) return null;
  let charge: unknown;
  try {
    charge = JSON.parse(base64urlVersTexte(parties[1]));
  } catch {
    return null;
  }
  if (typeof charge !== 'object' || charge === null) return null;
  const { iat, exp } = charge as { iat?: unknown; exp?: unknown };
  if (typeof iat !== 'number' || typeof exp !== 'number') return null;
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= iat) return null;
  return { ouverteA: iat * 1000, expireA: exp * 1000 };
}
