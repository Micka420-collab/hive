// Les protocoles de la coquille :
//   · `bureau://` — l'accueil et la marque, servis depuis la coquille (l'asar
//     dans l'app installée) — jamais par `file://` (voir `navigation.ts`) ;
//   · `apercu://` — l'Aperçu du Rayon, que l'écran confie à la coquille
//     (`hiveBureau.apercu`, preload.cjs) au lieu d'un `srcdoc` (csp.ts).

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, type Session } from 'electron';
import { fichierDeCoquille, SCHEMA_APERCU, SCHEMA_COQUILLE } from './navigation.js';

/** Les aperçus gardés : l'écran n'en montre qu'un, les précédents tombent. */
const APERCUS_GARDES = 4;
/** La borne de la Reine (`MAX_APERCU`, src/shared/apercu.ts), en caractères. */
export const TAILLE_MAX_APERCU = 2 * 1024 * 1024;

/** À appeler AVANT `ready` : un schéma se déclare privilégié avant toute session. */
export function declarerSchemaCoquille(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEMA_COQUILLE, privileges: { standard: true, secure: true } },
    { scheme: SCHEMA_APERCU, privileges: { standard: true, secure: true } },
  ]);
}

export function servirCoquille(s: Session, coquille: string): void {
  s.protocol.handle(SCHEMA_COQUILLE, (requete) => {
    const segments = fichierDeCoquille(requete.url);
    if (segments === null) return new Response('introuvable', { status: 404 });
    return net.fetch(pathToFileURL(path.join(coquille, ...segments)).href);
  });
}

const apercus = new Map<string, string>();

/**
 * Garde un document d'aperçu et rend l'URL qui le sert. L'hôte est un
 * identifiant tiré au hasard : chaque aperçu a sa propre origine, et
 * l'`<iframe sandbox>` sans `allow-same-origin` la rend opaque de toute façon.
 */
export function garderApercu(html: string): string {
  const id = randomUUID();
  apercus.set(id, html);
  for (const ancien of apercus.keys()) {
    if (apercus.size <= APERCUS_GARDES) break;
    apercus.delete(ancien);
  }
  return `${SCHEMA_APERCU}://${id}/`;
}

export function servirApercus(s: Session): void {
  s.protocol.handle(SCHEMA_APERCU, (requete) => {
    const html = apercus.get(new URL(requete.url).hostname);
    if (html === undefined) return new Response('introuvable', { status: 404 });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    });
  });
}
