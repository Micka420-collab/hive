// LA REINE QUI ÉCOUTE — ce qu'elle croit d'un segment où tout le monde parle.
//
// ─── POURQUOI À PART ─────────────────────────────────────────────────────────
//
// `decouverte-rejoindre.test.ts` éprouve le parcours d'une machine honnête.
// Ici, ce sont les VOISINS qui parlent : tout ce qui arrive sur 224.0.0.251
// vient de n'importe qui, et le nom d'instance d'une vraie machine est
// diffusé — donc recopiable. Chacun de ces coups a une réponse, écrite dans
// l'en-tête de `decouverte-reseau.ts` :
//
//   · un nom recopié depuis une AUTRE adresse ne détourne pas l'entrée (sinon
//     l'offre, et son « acceptée », partaient chez l'imposteur), et son adieu
//     forgé ne fait pas disparaître la vraie machine ;
//   · une durée de vie gonflée ne s'incruste pas plus qu'une vraie annonce ;
//   · une seule adresse ne remplit pas la liste.
//
// Et deux décisions de la Reine au moment d'offrir : « trop tôt » est une
// machine Hive occupée, pas une étrangère ; et l'adresse portée dans le billet
// est celle du réseau d'où la machine a parlé, pas la première carte venue.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DecouverteReseau,
  PAR_SOURCE_MAX,
  adresseReineVers,
  livrerOffre,
} from '../src/orchestrator/decouverte-reseau.js';
import { SERVICE_HIVE, TTL_ANNONCE_S, textesAnnonce } from '../src/shared/decouverte.js';
import type { Annonce, OffreScellee } from '../src/shared/decouverte.js';
import { tirerEmpreinte } from '../src/shared/empreinte-ruche.js';
import { encoderPaquet } from '../src/shared/mdns.js';
import { attendreQue, busMdns } from './harnais-mdns.js';

const LIBRE: Annonce = {
  nom: 'Vraie machine',
  os: 'linux',
  agents: ['codex'],
  places: 1,
  etat: 'libre',
  ruche: null,
};

/** Une annonce telle qu'un voisin peut la FORGER : nom, TTL et port à son gré. */
function annonceForgee(o: {
  instance: string;
  annonce?: Annonce;
  ttl?: number;
  port?: number;
}): Buffer {
  const nom = `${o.instance}.${SERVICE_HIVE}`;
  const ttl = o.ttl ?? TTL_ANNONCE_S;
  return encoderPaquet({
    id: 0,
    reponse: true,
    questions: [],
    reponses: [{ type: 'PTR', nom: SERVICE_HIVE, ttl, vidage: false, cible: nom }],
    additionnels: [
      {
        type: 'SRV',
        nom,
        ttl,
        vidage: true,
        priorite: 0,
        poids: 0,
        port: o.port ?? 4242,
        cible: `${o.instance}.local`,
      },
      { type: 'TXT', nom, ttl, vidage: true, textes: textesAnnonce(o.annonce ?? LIBRE) },
    ],
  });
}

const aFermer: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const f of aFermer.splice(0)) await f().catch(() => {});
});

async function reine(horloge?: () => number) {
  const bus = busMdns();
  const d = new DecouverteReseau(await bus.prise('192.168.1.1')(), {
    empreinte: tirerEmpreinte,
    ...(horloge ? { horloge } : {}),
  });
  aFermer.push(() => d.arreter());
  const depuis = async (source: string) => {
    const t = await bus.prise(source)();
    aFermer.push(() => t.fermer());
    return t;
  };
  return { d, depuis };
}

describe('ce que la Reine croit du segment', () => {
  it('un nom RECOPIÉ depuis une autre adresse ne détourne pas l’entrée — ni son adieu forgé', async () => {
    const { d, depuis } = await reine();
    const vraie = await depuis('192.168.1.20');
    const imposteur = await depuis('192.168.1.66');

    vraie.emettre(annonceForgee({ instance: 'hive-0a0a0a0a' }));
    await attendreQue(() => d.liste().length === 1, 'la vraie machine est entendue');

    // Le même nom, depuis ailleurs : une autre porte, un autre nom affiché.
    imposteur.emettre(
      annonceForgee({
        instance: 'hive-0a0a0a0a',
        port: 6666,
        annonce: { ...LIBRE, nom: 'Imposteur' },
      }),
    );
    // Puis son adieu forgé (TTL 0).
    imposteur.emettre(annonceForgee({ instance: 'hive-0a0a0a0a', ttl: 0 }));
    // Le bus livre dans l'ordre : quand ce témoin est entendu, les deux
    // paquets de l'imposteur ont été lus — et écartés.
    vraie.emettre(
      annonceForgee({ instance: 'hive-7e7e7e7e', annonce: { ...LIBRE, nom: 'Témoin' } }),
    );
    await attendreQue(() => d.liste().length === 2, 'le témoin est entendu');

    expect(d.trouver('hive-0a0a0a0a')).toMatchObject({
      nom: 'Vraie machine',
      adresse: '192.168.1.20',
      port: 4242,
    });

    // L'adieu de la VRAIE adresse, lui, compte.
    vraie.emettre(annonceForgee({ instance: 'hive-0a0a0a0a', ttl: 0 }));
    await attendreQue(() => d.trouver('hive-0a0a0a0a') === null, 'la vraie machine part');
  });

  it('une durée de vie GONFLÉE est ramenée à celle d’une vraie machine', async () => {
    let t = 1_000_000;
    const { d, depuis } = await reine(() => t);
    const voisin = await depuis('192.168.1.30');
    voisin.emettre(annonceForgee({ instance: 'hive-1b1b1b1b', ttl: 4_500 }));
    await attendreQue(() => d.liste().length === 1, 'l’annonce est entendue');
    t += (TTL_ANNONCE_S - 1) * 1000;
    expect(d.liste(), 'encore vivante juste avant l’échéance d’une vraie annonce').toHaveLength(1);
    t += 2_000;
    expect(d.liste(), 'et plus une seconde après : pas 75 minutes').toHaveLength(0);
  });

  it(`une seule adresse n’occupe pas plus de ${PAR_SOURCE_MAX} places — les autres restent entendues`, async () => {
    const { d, depuis } = await reine();
    const inondeur = await depuis('192.168.1.99');
    for (let i = 0; i < PAR_SOURCE_MAX + 6; i++) {
      inondeur.emettre(
        annonceForgee({
          instance: `hive-${i.toString(16).padStart(8, '0')}`,
          annonce: { ...LIBRE, nom: `Fausse ${i}` },
        }),
      );
    }
    const vraie = await depuis('192.168.1.20');
    vraie.emettre(annonceForgee({ instance: 'hive-abcdef01' }));
    await attendreQue(
      () => d.liste().some((m) => m.nom === 'Vraie machine'),
      'la vraie machine est entendue malgré l’inondation',
    );
    expect(d.liste().filter((m) => m.adresse === '192.168.1.99')).toHaveLength(PAR_SOURCE_MAX);
  });
});

describe('au moment d’offrir', () => {
  const OFFRE: OffreScellee = { v: 1, sel: 'c2Vs', iv: 'aXY', charge: 'Y2hhcmdl' };

  async function porte(reponses: { statut: number; corps: unknown }[]): Promise<{
    port: number;
    recues: () => number;
  }> {
    let n = 0;
    const srv: Server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const r = reponses[Math.min(n, reponses.length - 1)]!;
        n += 1;
        res.writeHead(r.statut, { 'content-type': 'application/json' });
        res.end(JSON.stringify(r.corps));
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    aFermer.push(() => new Promise((ok) => srv.close(ok)));
    return { port: (srv.address() as AddressInfo).port, recues: () => n };
  }

  it('« trop tôt » : une machine Hive OCCUPÉE — la Reine repasse une fois, puis le dit', async () => {
    const occupee = await porte([{ statut: 429, corps: { issue: 'trop_tot' } }]);
    const issue = await livrerOffre({ adresse: '127.0.0.1', port: occupee.port }, OFFRE);
    expect(issue, 'jamais « réponse inattendue » : c’est bien une machine Hive').toEqual({
      issue: 'occupee',
    });
    expect(occupee.recues(), 'un seul nouvel essai, après le délai de la porte').toBe(2);
  });

  it('« trop tôt » puis libre : la seconde présentation passe', async () => {
    const p = await porte([
      { statut: 429, corps: { issue: 'trop_tot' } },
      { statut: 200, corps: { issue: 'acceptee' } },
    ]);
    expect(await livrerOffre({ adresse: '127.0.0.1', port: p.port }, OFFRE)).toEqual({
      issue: 'acceptee',
    });
  });

  it('l’adresse de la Reine VERS la machine : l’interface de son sous-réseau, pas la première venue', () => {
    const cartes: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [carte('127.0.0.1', '255.0.0.0', true)],
      docker0: [carte('172.17.0.1', '255.255.0.0')],
      wlan0: [carte('192.168.1.50', '255.255.255.0')],
    };
    expect(adresseReineVers('192.168.1.20', cartes)).toBe('192.168.1.50');
    expect(adresseReineVers('172.17.0.9', cartes)).toBe('172.17.0.1');
    expect(adresseReineVers('10.0.0.5', cartes), 'aucun sous-réseau commun').toBeNull();
    expect(adresseReineVers('pas-une-ip', cartes)).toBeNull();
  });
});

function carte(address: string, netmask: string, internal = false): os.NetworkInterfaceInfo {
  return { address, netmask, family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null };
}
