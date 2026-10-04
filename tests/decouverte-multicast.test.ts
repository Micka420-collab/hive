// LE VRAI MULTICAST — une machine et une Reine, sur de vraies prises UDP.
//
// ─── CE QUE CE BANC AJOUTE AU BUS EN MÉMOIRE ─────────────────────────────────
//
// `decouverte-rejoindre.test.ts` éprouve tout le parcours sur un segment
// simulé. Ici, rien n'est simulé : `ouvrirTransportUdp` rejoint le groupe
// 224.0.0.251 sur l'interface de boucle, la machine s'annonce, la Reine
// l'entend, lui pose sa question, et la machine dit adieu. C'est ce qui prouve
// que le codec parle vraiment au noyau — options de prise, TTL, boucle
// multicast, adresse source.
//
// ─── ET POURQUOI IL PEUT S'ABSTENIR ──────────────────────────────────────────
//
// Le multicast sur l'interface de boucle dépend du système et de son réglage :
// présent sous Linux et macOS usuels, parfois absent d'un runner ou d'un
// conteneur. Une SONDE le vérifie d'abord ; s'il manque, les cas s'ABSTIENNENT
// EN LE DISANT (comptés « ignorés », avec la raison à la console) — jamais un
// vert qui n'aurait rien mesuré.
//
// Port éphémère, jamais 5353 : le banc ne parle ni à avahi, ni à Bonjour, ni
// à la suite qui tourne à côté.

import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import { Annonceur } from '../src/node-client/decouverte-noeud.js';
import { DecouverteReseau } from '../src/orchestrator/decouverte-reseau.js';
import { ipv4Privee } from '../src/shared/decouverte.js';
import { tirerEmpreinte } from '../src/shared/empreinte-ruche.js';
import { ouvrirTransportUdp } from '../src/shared/mdns-reseau.js';
import type { TransportMdns } from '../src/shared/mdns-reseau.js';
import { attendreQue } from './harnais-mdns.js';
import { lancerBorneTuyaute, reprendreTous } from './harnais-processus.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const TSX = path.join(RACINE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const QUI_SORT = path.join(RACINE, 'tests', 'fixtures', 'annonceur-qui-sort.ts');

const BOUCLE = ['127.0.0.1'];
const RUCHE = tirerEmpreinte();

/** Un port UDP libre à cet instant — partagé ensuite par les deux prises (`reuseAddr`). */
function portUdpLibre(): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const s = dgram.createSocket('udp4');
    s.once('error', rejeter);
    s.bind(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resoudre(port));
    });
  });
}

const ouvrir = (port: number) =>
  ouvrirTransportUdp({ port, interfaces: BOUCLE, signaler: () => {} });

/** `null` si le multicast de boucle marche ici ; sinon, pourquoi pas. */
let absence: string | null = null;

beforeAll(async () => {
  try {
    const port = await portUdpLibre();
    const [a, b] = await Promise.all([ouvrir(port), ouvrir(port)]);
    try {
      const recu = new Promise<boolean>((resoudre) => {
        const garde = setTimeout(() => resoudre(false), 1_000);
        b.surPaquet((p) => {
          if (p.toString() === 'sonde-hive') {
            clearTimeout(garde);
            resoudre(true);
          }
        });
      });
      a.emettre(Buffer.from('sonde-hive'));
      if (!(await recu)) absence = 'aucun paquet reçu en boucle en 1 s';
    } finally {
      await Promise.all([a.fermer(), b.fermer()]);
    }
  } catch (err) {
    absence = err instanceof Error ? err.message : String(err);
  }
});

/** S'abstient EN LE DISANT quand le multicast de boucle n'existe pas ici. */
function exigerMulticast(ctx: TestContext): void {
  if (absence === null) return;
  console.warn(`[banc multicast] abstention : multicast de boucle indisponible (${absence})`);
  ctx.skip();
}

const aFermer: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const f of aFermer.splice(0)) await f().catch(() => {});
  reprendreTous();
});

async function reine(port: number): Promise<DecouverteReseau> {
  // Le banc parle sur la BOUCLE : il déclare ce segment-là, que la Reine
  // écarterait d'elle-même (`sourceDuSegment`).
  const d = new DecouverteReseau(await ouvrir(port), {
    empreinte: () => RUCHE,
    segment: ipv4Privee,
  });
  aFermer.push(() => d.arreter());
  return d;
}

async function machine(port: number): Promise<Annonceur> {
  const transport: TransportMdns = await ouvrir(port);
  const a = new Annonceur({ transport });
  aFermer.push(() => a.arreter());
  return a;
}

describe('sur de vraies prises UDP, en boucle', () => {
  it('la machine s’annonce, la Reine l’entend — adresse vue par le noyau', async (ctx) => {
    exigerMulticast(ctx);
    const port = await portUdpLibre();
    const d = await reine(port);
    const a = await machine(port);
    a.annoncer(
      { nom: 'Poste réel', os: 'linux', agents: ['codex'], places: 2, etat: 'libre', ruche: null },
      4242,
    );
    await attendreQue(() => d.liste().length === 1, 'la Reine entend l’annonce');
    expect(d.liste()[0]).toMatchObject({
      nom: 'Poste réel',
      agents: ['codex'],
      etat: 'libre',
      adresse: '127.0.0.1',
      port: 4242,
    });
  });

  it('une Reine qui arrive APRÈS l’annonce apprend la machine en POSANT SA QUESTION', async (ctx) => {
    exigerMulticast(ctx);
    const port = await portUdpLibre();
    const a = await machine(port);
    a.annoncer(
      { nom: 'Déjà là', os: 'macos', agents: [], places: 1, etat: 'membre', ruche: RUCHE },
      0,
    );
    // Les deux annonces spontanées (0 s et 1 s) sont passées avant que la
    // Reine n'écoute : seule sa question peut encore la renseigner.
    await new Promise((r) => setTimeout(r, 1_300));
    const d = await reine(port);
    d.demarrer();
    await attendreQue(() => d.liste().length === 1, 'la réponse à la question');
    expect(d.liste()[0]).toMatchObject({ nom: 'Déjà là', etat: 'membre', ruche: 'cette_ruche' });
  });

  it('l’adieu retire la machine de la liste', async (ctx) => {
    exigerMulticast(ctx);
    const port = await portUdpLibre();
    const d = await reine(port);
    const a = await machine(port);
    a.annoncer(
      { nom: 'Partante', os: 'windows', agents: [], places: 1, etat: 'libre', ruche: null },
      4243,
    );
    await attendreQue(() => d.liste().length === 1, 'l’annonce');
    await a.arreter();
    await attendreQue(() => d.liste().length === 0, 'l’adieu');
  });

  it('L’ADIEU PART même quand le processus sort dans la foulée (Ctrl+C)', async (ctx) => {
    // LE DÉFAUT QUE CE CAS TIENT. `send()` faisait passer l'IP du groupe par
    // `dns.lookup`, qui rappelle au tick suivant : l'adieu lancé juste avant
    // le `process.exit` d'`arreterSurSignaux` ne partait jamais. Mesuré sur une
    // vraie ruche : la machine arrêtée restait deux minutes dans la liste.
    exigerMulticast(ctx);
    const port = await portUdpLibre();
    const d = await reine(port);
    const enfant = lancerBorneTuyaute(process.execPath, [TSX, QUI_SORT, String(port), '1500'], {
      cwd: RACINE,
    });
    const sortie = new Promise<number | null>((r) => enfant.once('exit', (code) => r(code)));
    await attendreQue(() => d.liste().some((m) => m.nom === 'Sortante'), 'l’annonce de l’enfant');
    expect(await sortie, 'l’enfant sort de lui-même, sans erreur').toBe(0);
    // Une annonce vit 120 s : si elle disparaît en moins de deux, c'est l'adieu.
    await attendreQue(
      () => !d.liste().some((m) => m.nom === 'Sortante'),
      'l’adieu envoyé avant process.exit',
      2_000,
    );
  });
});
