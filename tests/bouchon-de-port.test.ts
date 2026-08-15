// LE BOUCHON SE RETIRE, MÊME QUAND UN VOISIN Y EST ACCROCHÉ.
//
// ─── POURQUOI CE BANC EXISTE, ET POURQUOI SES BORNES SONT COURTES ────────────
//
// Le défaut qu'il ferme s'est manifesté en CI par un `Test timed out in
// 120000ms` sur un cas qui dure 416 ms — c'est-à-dire par RIEN. Une expiration
// ne montre ni assertion, ni valeur, ni chemin : elle montre une ligne `it(`.
//
// Ce banc-ci est donc écrit pour rougir VITE et EN DISANT QUOI. Ses bornes
// (2 s) ne sont pas de la marge de confort : elles sont ce qui transforme un
// blocage en mesure. Sans le remède, le cas central ne « ralentit » pas — il ne
// finit jamais — et une borne courte est la seule façon d'en faire un rouge
// lisible plutôt qu'une minuterie de suite.
//
// La contre-mesure est au harnais (`retirerLeBouchon` coupe les connexions au
// lieu de les attendre) ; ici on éprouve qu'elle tient, et que le bouchon
// remplit encore son office.

import { connect, createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { occuperPort, portLibre, retirerLeBouchon } from './harnais-bouchon.js';

/** Se connecter et ATTENDRE que la poignée de main soit faite. */
async function seBrancher(port: number): Promise<Socket> {
  const s = connect(port, '127.0.0.1');
  await new Promise<void>((resoudre, rejeter) => {
    s.once('connect', () => resoudre());
    s.once('error', rejeter);
  });
  return s;
}

/** Le port est-il libre MAINTENANT ? Demandé au système, jamais supposé. */
async function estLibre(port: number): Promise<boolean> {
  return new Promise((resoudre) => {
    const sonde = createServer();
    sonde.once('error', () => resoudre(false));
    sonde.once('listening', () => sonde.close(() => resoudre(true)));
    sonde.listen(port, '127.0.0.1');
  });
}

describe('le bouchon de port', () => {
  it('OCCUPE VRAIMENT la porte, puis la rend', async () => {
    // Une garde qui ne prend pas la porte ne garde rien : tout le reste de ce
    // fichier passerait au vert sans rien mesurer.
    const port = await portLibre();
    let pendant: boolean | null = null;
    await occuperPort(port, async () => {
      pendant = await estLibre(port);
    });
    expect(pendant, 'le bouchon n’a pas pris la porte').toBe(false);
    expect(await estLibre(port), 'le bouchon n’a pas rendu la porte').toBe(true);
  }, 2_000);

  it('SE RETIRE MÊME SI UN VOISIN Y EST ACCROCHÉ — c’est le défaut mesuré', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // `Server.close()` ferme l'écoute PUIS attend la fin des connexions déjà
    // établies. Mesuré sur cet environnement :
    //
    //     connexion voisine OUVERTE  → close() rappelé après 3 000 ms ? NON
    //     connexions coupées         → close() rappelé ? oui (300 ms)
    //
    // Un banc qui occupe une porte FIXE (7777) pendant que la suite tourne en
    // parallèle attrape tôt ou tard un voisin qui la sonde. Il se suspend alors
    // dans son propre `finally`, assertions déjà passées.
    const port = await portLibre();
    let voisin: Socket | null = null;
    await occuperPort(port, async () => {
      voisin = await seBrancher(port);
    });
    // Si l'on est ici, le `finally` du harnais a rendu la main : c'est TOUT le
    // sujet. La borne de 2 s au bas de ce cas est l'assertion réelle.
    expect(voisin, 'le voisin ne s’est pas branché — le cas ne mesure rien').not.toBeNull();
    (voisin as unknown as Socket | null)?.destroy();
    expect(await estLibre(port), 'la porte est restée prise après le retrait').toBe(true);
  }, 2_000);

  it('rend la porte MÊME SI le travail échoue — un `finally`, pas un `then`', async () => {
    // Une porte qu'on ne rend qu'en cas de succès finit par ne plus être rendue
    // du tout : le premier rouge d'un cas empoisonne tous les suivants, et le
    // vrai défaut se cache derrière une cascade d'EADDRINUSE.
    const port = await portLibre();
    await expect(
      occuperPort(port, () => Promise.reject(new Error('le travail a mordu'))),
    ).rejects.toThrow('le travail a mordu');
    expect(await estLibre(port), 'un travail en échec garde la porte').toBe(true);
  }, 2_000);

  it('`retirerLeBouchon` n’attend PAS les visiteurs, il les coupe', async () => {
    // Le même mécanisme, pris à nu — sans passer par `occuperPort`, pour que le
    // remède soit éprouvé là où il vit.
    const port = await portLibre();
    const vivants = new Set<Socket>();
    const bouchon = createServer((s) => {
      vivants.add(s);
      s.once('close', () => vivants.delete(s));
    });
    await new Promise<void>((r) => bouchon.listen(port, '127.0.0.1', () => r()));
    const voisin = await seBrancher(port);
    expect(vivants.size, 'le bouchon n’a pas vu la connexion du voisin').toBe(1);

    await retirerLeBouchon(bouchon, vivants);
    expect(vivants.size, 'les connexions n’ont pas été relâchées').toBe(0);
    voisin.destroy();
  }, 2_000);

  it('`portLibre` rend une porte RÉELLEMENT libre, jamais un nombre deviné', async () => {
    const a = await portLibre();
    expect(a, 'le système n’a pas attribué de port').toBeGreaterThan(0);
    expect(await estLibre(a), 'le port annoncé libre est pris').toBe(true);
  }, 2_000);
});
