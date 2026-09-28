// Le protocole `bureau://` : l'accueil et la marque, servis depuis la coquille
// (l'asar dans l'app installée) — jamais par `file://` (voir `navigation.ts`).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, type Session } from 'electron';
import { fichierDeCoquille, SCHEMA_COQUILLE } from './navigation.js';

/** À appeler AVANT `ready` : un schéma se déclare privilégié avant toute session. */
export function declarerSchemaCoquille(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEMA_COQUILLE, privileges: { standard: true, secure: true } },
  ]);
}

export function servirCoquille(s: Session, coquille: string): void {
  s.protocol.handle(SCHEMA_COQUILLE, (requete) => {
    const segments = fichierDeCoquille(requete.url);
    if (segments === null) return new Response('introuvable', { status: 404 });
    return net.fetch(pathToFileURL(path.join(coquille, ...segments)).href);
  });
}
