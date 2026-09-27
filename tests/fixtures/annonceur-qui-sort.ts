// Un nœud qui se signale puis s'arrête BRUTALEMENT — comme `arreterSurSignaux`
// (client.ts) : l'adieu est lancé, puis `process.exit` dans la foulée, sans
// rien attendre. Sert à `decouverte-multicast.test.ts` : c'est exactement le
// chemin où l'adieu se perdait.
//
//   tsx tests/fixtures/annonceur-qui-sort.ts <port> <délai ms>

import { Annonceur } from '../../src/node-client/decouverte-noeud.js';
import { ouvrirTransportUdp } from '../../src/shared/mdns-reseau.js';

const port = Number(process.argv[2]);
const delai = Number(process.argv[3] ?? '1500');
const transport = await ouvrirTransportUdp({ port, interfaces: ['127.0.0.1'], signaler: () => {} });
const annonceur = new Annonceur({ transport, adresses: () => ['127.0.0.1'] });
annonceur.annoncer(
  { nom: 'Sortante', os: 'linux', agents: [], places: 1, etat: 'libre', ruche: null },
  4244,
);
process.stdout.write('annonce\n');
setTimeout(() => {
  void annonceur.arreter();
  process.exit(0);
}, delai);
