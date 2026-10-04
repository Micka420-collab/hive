// Un segment réseau EN MÉMOIRE, pour les bancs de la découverte.
//
// Chaque prise ouverte sur le bus reçoit tout ce que chacune émet — elle-même
// comprise, comme la boucle multicast réelle (`setMulticastLoopback`). La
// livraison est ASYNCHRONE (`setImmediate`), comme sur le fil : un banc qui
// suppose qu'une annonce est lue dans le même tour de boucle que son émission
// passerait ici et casserait en vrai.
//
// `source` est l'adresse que le noyau aurait vue — c'est elle que la Reine
// croit, jamais ce que le paquet prétend. Un banc peut donc faire parler une
// adresse PUBLIQUE sur le même bus, et vérifier qu'elle est ignorée.

import type { TransportMdns } from '../src/shared/mdns-reseau.js';

export interface BusMdns {
  /** Une prise sur ce bus, qui émet depuis `source`. */
  prise(source?: string): () => Promise<TransportMdns>;
  /** Tous les paquets émis sur le bus, dans l'ordre. */
  readonly emis: Buffer[];
}

export function busMdns(): BusMdns {
  const abonnes = new Set<(paquet: Buffer, source: string) => void>();
  const emis: Buffer[] = [];
  return {
    emis,
    prise:
      (source = '127.0.0.1') =>
      async () => {
        const miens: ((paquet: Buffer, source: string) => void)[] = [];
        let fermee = false;
        return {
          emettre(paquet) {
            if (fermee) return;
            emis.push(paquet);
            const copie = Buffer.from(paquet);
            setImmediate(() => {
              for (const a of [...abonnes]) a(copie, source);
            });
          },
          surPaquet(ecouteur) {
            miens.push(ecouteur);
            abonnes.add(ecouteur);
          },
          async fermer() {
            fermee = true;
            // Laisse partir ce qui vient d'être émis (l'adieu) avant de se retirer.
            await new Promise((r) => setImmediate(r));
            for (const e of miens) abonnes.delete(e);
          },
        };
      },
  };
}

/** Attend qu'une condition devienne vraie, ou échoue en disant laquelle. */
export async function attendreQue(
  condition: () => boolean | Promise<boolean>,
  quoi: string,
  delaiMs = 10_000,
): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`jamais arrivé en ${delaiMs} ms : ${quoi}`);
}
