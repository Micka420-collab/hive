// La politique de sécurité du contenu que la coquille pose sur l'écran.
//
// La Reine ne sert pas (encore) d'en-tête CSP : c'est une suite nommée de
// l'ADR 0013. En attendant, la coquille l'ajoute aux réponses de SA Reine
// (`onHeadersReceived`) : un script injecté dans une vue ne pourrait ni
// charger d'ailleurs, ni exfiltrer le jeton vers une autre origine.
//
// Chaque directive a sa raison, mesurée sur l'écran construit :
//   · `style-src 'unsafe-inline'` — CodeMirror et React posent des styles en
//     ligne ; les refuser casse l'éditeur, pas un attaquant ;
//   · `img-src data: blob:` — avatars et captures générés dans la page ;
//   · `worker-src blob:` — pdf.js lance son worker depuis un blob ;
//   · `connect-src` — le flux `/ws` de la MÊME Reine, et rien d'autre ;
//   · `frame-src` — l'Aperçu du Rayon (`apercu:`, servi par la coquille : un
//     `srcdoc` hériterait `script-src 'self'` et perdrait ses scripts) et
//     l'écran noVNC de l'atelier, sur un AUTRE port de la boucle locale. Sans
//     elle, `default-src` les bloquait tous deux (mesuré, #532).

import { SCHEMA_APERCU } from './navigation.js';

export function politiqueCsp(port: number): string {
  const ws = `ws://127.0.0.1:${String(port)}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src 'self' ${ws}`,
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `frame-src 'self' ${SCHEMA_APERCU}: http://127.0.0.1:*`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Les en-têtes d'une réponse, CSP posée — sans écraser une CSP que la Reine enverrait. */
export function avecCsp(
  entetes: Readonly<Record<string, string[]>>,
  csp: string,
): Record<string, string[]> {
  const deja = Object.keys(entetes).some((k) => k.toLowerCase() === 'content-security-policy');
  return deja ? { ...entetes } : { ...entetes, 'Content-Security-Policy': [csp] };
}
