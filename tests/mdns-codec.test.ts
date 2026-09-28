// LE CODEC mDNS — ce qu'on écrit se relit, et ce qu'un inconnu envoie ne casse rien.
//
// ─── CE QUE CE BANC PROTÈGE ──────────────────────────────────────────────────
//
// `decoderPaquet` lit TOUT ce qui passe sur 224.0.0.251:5353 — imprimantes,
// télévisions, voisins. Trois promesses, chacune éprouvée ici par un paquet
// forgé à la main (pas par l'encodeur, qui ne sait écrire que du propre) :
//
//   · un aller-retour exact pour les quatre types dont la découverte a besoin ;
//   · la compression des noms LUE (avahi et Bonjour compressent tout), sans
//     boucle possible : un pointeur vers l'avant, vers lui-même, ou qui remonte
//     en rond est refusé ;
//   · tout défaut rend `null` — jamais une exception, jamais une liste à moitié
//     remplie.

import { describe, expect, it } from 'vitest';
import {
  TAILLE_MAX_PAQUET,
  TYPE_MDNS,
  decoderPaquet,
  encoderPaquet,
  memeNom,
} from '../src/shared/mdns.js';
import type { PaquetMdns } from '../src/shared/mdns.js';

/** Une réponse typique d'une machine Hive : PTR en réponse, SRV/TXT/A en additionnels. */
const REPONSE: PaquetMdns = {
  id: 0,
  reponse: true,
  questions: [],
  reponses: [
    {
      type: 'PTR',
      nom: '_hive._tcp.local',
      ttl: 120,
      vidage: false,
      cible: 'hive-0a1b2c3d._hive._tcp.local',
    },
  ],
  additionnels: [
    {
      type: 'SRV',
      nom: 'hive-0a1b2c3d._hive._tcp.local',
      ttl: 120,
      vidage: true,
      priorite: 0,
      poids: 0,
      port: 41234,
      cible: 'hive-0a1b2c3d.local',
    },
    {
      type: 'TXT',
      nom: 'hive-0a1b2c3d._hive._tcp.local',
      ttl: 120,
      vidage: true,
      textes: ['v=1', 'nom=Le portable de Camille', 'agents=claude-code,codex'],
    },
    { type: 'A', nom: 'hive-0a1b2c3d.local', ttl: 120, vidage: true, adresse: '192.168.1.23' },
  ],
};

/** Un en-tête DNS brut : id, drapeaux, puis les quatre comptes. */
function entete(drapeaux: number, nq: number, nr: number, na = 0, nx = 0): number[] {
  return [0, 0, drapeaux >> 8, drapeaux & 0xff, 0, nq, 0, nr, 0, na, 0, nx];
}

/** Un nom non compressé, étiquette par étiquette. */
function nom(...etiquettes: string[]): number[] {
  return [...etiquettes.flatMap((e) => [e.length, ...Buffer.from(e)]), 0];
}

describe('aller-retour', () => {
  it('une réponse PTR + SRV + TXT + A se relit à l’identique', () => {
    expect(decoderPaquet(encoderPaquet(REPONSE))).toEqual(REPONSE);
  });

  it('une question garde son type et son bit « QU »', () => {
    const q: PaquetMdns = {
      id: 7,
      reponse: false,
      questions: [
        { nom: '_hive._tcp.local', type: TYPE_MDNS.PTR, unicast: false },
        { nom: 'hive-0a1b2c3d.local', type: TYPE_MDNS.A, unicast: true },
      ],
      reponses: [],
      additionnels: [],
    };
    expect(decoderPaquet(encoderPaquet(q))).toEqual(q);
  });

  it('le TTL 0 (l’adieu) et le bit cache-flush survivent au fil', () => {
    const adieu = { ...REPONSE, reponses: [{ ...REPONSE.reponses[0]!, ttl: 0 }] };
    const lu = decoderPaquet(encoderPaquet(adieu))!;
    expect(lu.reponses[0]!.ttl).toBe(0);
    expect(lu.reponses[0]!.vidage, 'jamais de cache-flush sur un PTR partagé').toBe(false);
    expect(lu.additionnels.every((e) => e.vidage)).toBe(true);
  });

  it('un nom d’affichage accentué traverse en UTF-8', () => {
    const txt = {
      ...REPONSE,
      additionnels: [
        {
          type: 'TXT' as const,
          nom: 'hive-0a1b2c3d._hive._tcp.local',
          ttl: 120,
          vidage: true,
          textes: ['nom=Poste d’Élodie 🐝'],
        },
      ],
    };
    expect(decoderPaquet(encoderPaquet(txt))?.additionnels[0]).toMatchObject({
      textes: ['nom=Poste d’Élodie 🐝'],
    });
  });

  it('l’en-tête d’une réponse porte QR et AA, celui d’une question aucun des deux', () => {
    expect(encoderPaquet(REPONSE).readUInt16BE(2)).toBe(0x8400);
    expect(encoderPaquet({ ...REPONSE, reponse: false }).readUInt16BE(2)).toBe(0);
  });
});

describe('ce que l’encodeur refuse d’écrire', () => {
  it('une étiquette de plus de 63 octets, une chaîne TXT de plus de 255', () => {
    const long = 'x'.repeat(64);
    expect(() =>
      encoderPaquet({
        ...REPONSE,
        reponses: [{ type: 'PTR', nom: `${long}.local`, ttl: 1, vidage: false, cible: 'a.local' }],
      }),
    ).toThrow(/63/);
    expect(() =>
      encoderPaquet({
        ...REPONSE,
        reponses: [],
        additionnels: [
          { type: 'TXT', nom: 'a.local', ttl: 1, vidage: true, textes: ['y'.repeat(256)] },
        ],
      }),
    ).toThrow(/255/);
  });
});

describe('la compression des noms, telle qu’avahi et Bonjour l’écrivent', () => {
  it('un PTR dont la cible pointe vers le nom de la question se lit en entier', () => {
    // Question `_hive._tcp.local` à l'octet 12 ; la réponse la désigne par
    // pointeur (0xC00C), puis sa cible réutilise le suffixe par un second.
    const question = nom('_hive', '_tcp', 'local');
    const octets = [
      ...entete(0x8400, 1, 1),
      ...question,
      0,
      TYPE_MDNS.PTR,
      0,
      1,
      // Le nom de l'enregistrement : pointeur vers l'octet 12.
      0xc0,
      12,
      0,
      TYPE_MDNS.PTR,
      0,
      1,
      0,
      0,
      0,
      120,
      0,
      16,
      // La cible : « hive-0a1b2c3d » puis pointeur vers l'octet 12.
      13,
      ...Buffer.from('hive-0a1b2c3d'),
      0xc0,
      12,
    ];
    const p = decoderPaquet(Buffer.from(octets));
    expect(p?.reponses[0]).toMatchObject({
      type: 'PTR',
      nom: '_hive._tcp.local',
      cible: 'hive-0a1b2c3d._hive._tcp.local',
    });
  });

  it('un pointeur vers LUI-MÊME est refusé (sinon, boucle infinie)', () => {
    const octets = [...entete(0, 1, 0), 0xc0, 12, 0, TYPE_MDNS.PTR, 0, 1];
    expect(decoderPaquet(Buffer.from(octets))).toBeNull();
  });

  it('un pointeur vers l’AVANT est refusé', () => {
    const octets = [...entete(0, 1, 0), 0xc0, 16, 0, TYPE_MDNS.PTR, 0, 1, ...nom('local')];
    expect(decoderPaquet(Buffer.from(octets))).toBeNull();
  });

  it('deux pointeurs qui se renvoient la balle sont refusés — la garde de décroissance', () => {
    // Octet 12 : « a » puis pointeur vers 12 lui-même, déguisé par une
    // étiquette intermédiaire. Une garde qui ne comparerait qu'à la position
    // courante (« le pointeur vise-t-il en arrière ? ») tournerait ici pour
    // toujours : 15 → 12 → 15 → 12…
    const octets = [...entete(0, 1, 0), 1, 0x61, 0xc0, 12, 0, TYPE_MDNS.PTR, 0, 1];
    const debut = Date.now();
    expect(decoderPaquet(Buffer.from(octets))).toBeNull();
    expect(Date.now() - debut).toBeLessThan(1_000);
  });
});

describe('ce qu’un inconnu envoie ne casse rien', () => {
  it('trop court, tronqué, surdimensionné : `null`, jamais une exception', () => {
    const bon = encoderPaquet(REPONSE);
    expect(decoderPaquet(Buffer.alloc(5))).toBeNull();
    for (let coupe = 12; coupe < bon.length; coupe += 7) {
      expect(() => decoderPaquet(bon.subarray(0, coupe))).not.toThrow();
      expect(decoderPaquet(bon.subarray(0, coupe)), `coupé à ${coupe}`).toBeNull();
    }
    expect(decoderPaquet(Buffer.alloc(TAILLE_MAX_PAQUET + 1))).toBeNull();
  });

  it('des comptes d’enregistrements démesurés sont refusés avant toute lecture', () => {
    const octets = Buffer.from(entete(0x8400, 0, 0xffff));
    expect(decoderPaquet(octets)).toBeNull();
  });

  it('un A dont la longueur n’est pas 4 est refusé', () => {
    const octets = [
      ...entete(0x8400, 0, 1),
      ...nom('x', 'local'),
      0,
      TYPE_MDNS.A,
      0,
      1,
      0,
      0,
      0,
      120,
      0,
      3,
      10,
      0,
      0,
    ];
    expect(decoderPaquet(Buffer.from(octets))).toBeNull();
  });

  it('un type inconnu est TRAVERSÉ, pas interprété — la suite du paquet reste lisible', () => {
    // Un AAAA (28) avant notre PTR : on doit avancer par-dessus, et lire le PTR.
    const octets = [
      ...entete(0x8400, 0, 2),
      ...nom('x', 'local'),
      0,
      28,
      0,
      1,
      0,
      0,
      0,
      120,
      0,
      16,
      ...new Array<number>(16).fill(0),
      ...nom('_hive', '_tcp', 'local'),
      0,
      TYPE_MDNS.PTR,
      0,
      1,
      0,
      0,
      0,
      120,
      0,
      9,
      ...nom('a', 'local'),
    ];
    const p = decoderPaquet(Buffer.from(octets));
    expect(p?.reponses.map((e) => e.type)).toEqual(['autre', 'PTR']);
  });

  it('mille paquets au hasard : aucun ne fait lever', () => {
    // Graine fixe : un échec se rejoue à l'identique.
    let graine = 0x5eed;
    const hasard = (): number => {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      return graine;
    };
    for (let i = 0; i < 1_000; i++) {
      const taille = 12 + (hasard() % 200);
      const octets = Buffer.from(Array.from({ length: taille }, () => hasard() & 0xff));
      expect(() => decoderPaquet(octets)).not.toThrow();
    }
  });
});

describe('memeNom', () => {
  it('la casse ASCII ne compte pas', () => {
    expect(memeNom('_HIVE._tcp.Local', '_hive._tcp.local')).toBe(true);
    expect(memeNom('_hive._tcp.local', '_hive._udp.local')).toBe(false);
  });
});
