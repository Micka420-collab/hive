// LE BOUCHON DE PORT — occuper une porte, et la RENDRE quoi qu'il arrive.
//
// ─── LE DÉFAUT, MESURÉ ───────────────────────────────────────────────────────
//
// `tests/installeur-porte.test.ts` a expiré en CI, sur la graine 23757 :
//
//     FAIL  LE PORT DU .env EST LIBRE : pas d'alerte, même si 7777 est pris
//     Error: Test timed out in 120000ms.
//
// Le même cas dure **416 ms** en local, et la graine rejouée à l'identique
// passe. Un dépassement de 290× n'est pas de la lenteur : c'est un BLOCAGE.
//
// Il ne venait pas du produit. Le banc occupe `PORT_DEFAUT` — 7777, une porte
// FIXE et bien connue — pendant que les autres fichiers de la suite tournent en
// parallèle. À la fin du cas, il rendait la porte ainsi :
//
//     await new Promise((resoudre) => bouchon.close(resoudre));
//
// Or `close()` ferme l'ÉCOUTE, puis attend que toutes les connexions déjà
// établies se terminent. Mesuré :
//
//     connexion voisine OUVERTE  → close() rappelé après 3 000 ms ? NON
//     connexions coupées         → close() rappelé ? oui (300 ms)
//
// Un seul voisin qui sonde `127.0.0.1:7777` — et la suite en contient, elle
// parle à des portes fixes — suffit donc à suspendre le banc DANS SON PROPRE
// NETTOYAGE. Les assertions, elles, étaient déjà passées : le rouge n'apprend
// rien, il montre une ligne `it(` et un chronomètre (§ 9 sexdecies).
//
// ─── CE QUE CE HARNAIS TIENT ─────────────────────────────────────────────────
//
//   Un bouchon se retire TOUJOURS, et en temps borné : on COUPE les connexions
//   au lieu de les attendre. Une porte tenue par un banc n'est pas un service —
//   personne n'a rien à y finir proprement.
//
// Il vit à part, et pas dans le fichier qui a mordu : le piège n'a rien de
// propre à l'installeur, il guette tout banc qui occupe une porte fixe. C'est
// le § 9 sexnonagies — une note écrite dans le fichier qui a subi le défaut ne
// protège que ce fichier.

import { createServer, type Server, type Socket } from 'node:net';

/**
 * Occupe `port` le temps de `faire`, puis rend la porte — connexions coupées.
 *
 * Le bouchon n'a AUCUN gestionnaire de connexion utile : il accepte et se tait,
 * ce qui est exactement ce qu'on veut simuler (une porte prise par autre chose).
 * Mais accepter crée des sockets, et ce sont elles qui retenaient `close()`.
 */
export async function occuperPort<T>(port: number, faire: () => Promise<T>): Promise<T> {
  const vivants = new Set<Socket>();
  const bouchon: Server = createServer((s) => {
    vivants.add(s);
    s.once('close', () => vivants.delete(s));
  });
  await new Promise<void>((resoudre, rejeter) => {
    bouchon.once('error', rejeter);
    bouchon.listen(port, '127.0.0.1', resoudre);
  });
  try {
    return await faire();
  } finally {
    await retirerLeBouchon(bouchon, vivants);
  }
}

/**
 * Retire un bouchon SANS attendre ses visiteurs.
 *
 * L'ordre compte : `close()` d'abord (plus aucune nouvelle connexion n'est
 * acceptée), puis on coupe celles qui restent. L'inverse laisserait une fenêtre
 * où un voisin s'installe entre la coupe et la fermeture.
 */
export async function retirerLeBouchon(bouchon: Server, vivants: Set<Socket>): Promise<void> {
  await new Promise<void>((resoudre) => {
    bouchon.close(() => resoudre());
    for (const s of vivants) s.destroy();
    vivants.clear();
  });
}

/** Un port que personne ne tient. DEMANDÉ au système, jamais deviné. */
export async function portLibre(): Promise<number> {
  const sonde = createServer();
  const port = await new Promise<number>((resoudre, rejeter) => {
    sonde.once('error', rejeter);
    sonde.listen(0, '127.0.0.1', () => {
      const a = sonde.address();
      if (a === null || typeof a === 'string') rejeter(new Error('adresse inattendue'));
      else resoudre(a.port);
    });
  });
  await new Promise((resoudre) => sonde.close(resoudre));
  return port;
}
