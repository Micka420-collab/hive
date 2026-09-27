// LE CONTRAT DE LA DÉCOUVERTE — ce qui part sur le réseau, et ce qui y revient.
//
// ─── CE QUE CE BANC PROTÈGE ──────────────────────────────────────────────────
//
// L'annonce est diffusée à TOUT le segment local. La promesse faite à
// l'opérateur est une LISTE FERMÉE : nom d'affichage, système, familles
// d'agents connectés, places, état, empreinte de ruche. Pas une version, pas un
// chemin, pas une clé. Le premier bloc tient cette liste par le seul chemin
// d'écriture, en lui tendant exprès ce qu'il ne doit pas diffuser.
//
// Le billet, lui, ne voyage que SCELLÉ sous le code d'appariement : le second
// bloc éprouve qu'un mauvais code, une charge altérée ou une offre destinée à
// une autre machine ne s'ouvrent pas — et qu'une offre malformée ne coûte pas
// un PBKDF2 à la machine.

import { describe, expect, it, vi } from 'vitest';

// Le PBKDF2 de l'offre, COMPTÉ plutôt que chronométré : « une offre malformée
// ne coûte rien à la machine » se juge au nombre de dérivations, pas à une
// horloge qu'un runner chargé ferait mentir.
const derivations = vi.hoisted(() => ({ n: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('node:crypto')>();
  return {
    ...vrai,
    pbkdf2: (...args: Parameters<typeof vrai.pbkdf2>) => {
      derivations.n += 1;
      return vrai.pbkdf2(...args);
    },
  };
});
import {
  INSTANCE_RE,
  LONGUEUR_CODE,
  formaterCode,
  ipv4Privee,
  lireAnnonce,
  nomDiffusable,
  normaliserCode,
  ouvrirOffre,
  scellerOffre,
  textesAnnonce,
  tirerCode,
  tirerInstance,
} from '../src/shared/decouverte.js';
import type { Annonce } from '../src/shared/decouverte.js';
import { EMPREINTE_RE, estEmpreinte, formaterEmpreinte } from '../src/shared/empreinte-ruche.js';
import { deriverEmpreinte } from '../src/orchestrator/auth.js';
import { encoderBillet } from '../src/shared/acces.js';

const RUCHE = deriverEmpreinte('secret-de-session-de-la-ruche-de-test');

const LIBRE: Annonce = {
  nom: 'Le portable de Camille',
  os: 'linux',
  agents: ['claude-code', 'codex'],
  places: 2,
  etat: 'libre',
  ruche: null,
};

describe('ce que la machine diffuse — une liste FERMÉE', () => {
  it('exactement les clés du contrat, et `ruche` seulement pour un membre', () => {
    const cles = (t: string[]) => t.map((x) => x.slice(0, x.indexOf('=')));
    expect(cles(textesAnnonce(LIBRE))).toEqual(['v', 'nom', 'os', 'agents', 'places', 'etat']);
    const membre = textesAnnonce({ ...LIBRE, etat: 'membre', ruche: RUCHE });
    expect(cles(membre)).toEqual(['v', 'nom', 'os', 'agents', 'places', 'etat', 'ruche']);
    // Une machine LIBRE n'a pas de ruche : même si on lui en donne une.
    expect(cles(textesAnnonce({ ...LIBRE, ruche: RUCHE }))).not.toContain('ruche');
  });

  it('ce qu’on tend en trop n’est PAS diffusé — le chemin d’écriture ne sait pas l’écrire', () => {
    // On lui passe exprès ce qu'une annonce ne doit jamais contenir : un jeton,
    // un chemin, une version. TypeScript l'interdit ; un appelant distrait qui
    // étalerait un objet plus gros ne doit rien faire fuiter pour autant.
    const piege = {
      ...LIBRE,
      token: 'jeton-de-ruche-tres-secret',
      workRoot: '/home/camille/.hive-work',
      version: '2.1.4',
    } as Annonce;
    const diffuse = textesAnnonce(piege).join('\n');
    expect(diffuse).not.toContain('jeton-de-ruche-tres-secret');
    expect(diffuse).not.toContain('/home/camille');
    expect(diffuse).not.toContain('2.1.4');
  });

  it('le simulacre n’est pas un agent : jamais annoncé', () => {
    const textes = textesAnnonce({ ...LIBRE, agents: ['shell' as never, 'codex'] });
    expect(textes).toContain('agents=codex');
  });

  it('un nom hostile est nettoyé : ni séquence ANSI, ni saut de ligne, ni longueur folle', () => {
    expect(nomDiffusable('poste\u001b[2J\nde Camille')).toBe('poste[2Jde Camille');
    expect([...nomDiffusable('é'.repeat(300))].length).toBeLessThanOrEqual(63);
    expect(Buffer.byteLength(nomDiffusable('🐝'.repeat(63)))).toBeLessThanOrEqual(200);
    expect(nomDiffusable('   ')).toBe('machine');
  });

  it('les places sont bornées comme `HIVE_MAX_CONCURRENCY`', () => {
    expect(textesAnnonce({ ...LIBRE, places: 999 })).toContain('places=16');
    expect(textesAnnonce({ ...LIBRE, places: 0 })).toContain('places=1');
  });

  it('aller-retour : ce qu’on écrit se relit à l’identique', () => {
    expect(lireAnnonce(textesAnnonce(LIBRE))).toEqual(LIBRE);
    const membre = { ...LIBRE, etat: 'membre' as const, ruche: RUCHE };
    expect(lireAnnonce(textesAnnonce(membre))).toEqual(membre);
  });
});

describe('ce que la Reine accepte de lire', () => {
  const base = textesAnnonce(LIBRE);
  const avec = (cle: string, valeur: string) =>
    base.map((t) => (t.startsWith(`${cle}=`) ? `${cle}=${valeur}` : t));

  it('une version inconnue, un système inconnu, un état inconnu : refusés', () => {
    expect(lireAnnonce(avec('v', '2'))).toBeNull();
    expect(lireAnnonce(avec('os', 'amiga'))).toBeNull();
    expect(lireAnnonce(avec('etat', 'occupee'))).toBeNull();
  });

  it('des places hors bornes ou illisibles : refusées', () => {
    for (const p of ['0', '17', '-1', '2.5', 'deux', '']) {
      expect(lireAnnonce(avec('places', p)), `places=${p}`).toBeNull();
    }
  });

  it('un nom vide ou porteur de contrôle : refusé', () => {
    expect(lireAnnonce(avec('nom', ''))).toBeNull();
    expect(lireAnnonce(avec('nom', 'a\u001bb'))).toBeNull();
  });

  it('une famille d’agents INCONNUE est écartée, pas l’annonce entière', () => {
    // Une machine plus récente annoncera des familles que cette Reine ne
    // connaît pas : elle doit rester visible avec celles qu'on sait nommer.
    expect(lireAnnonce(avec('agents', 'codex,agent-du-futur'))?.agents).toEqual(['codex']);
  });

  it('une empreinte PRÉSENTE mais mal formée rend l’annonce fausse', () => {
    const membre = textesAnnonce({ ...LIBRE, etat: 'membre', ruche: RUCHE });
    const fausse = membre.map((t) => (t.startsWith('ruche=') ? 'ruche=pas-une-empreinte' : t));
    expect(lireAnnonce(fausse)).toBeNull();
  });

  it('un membre sans empreinte est membre d’une ruche INCONNUE — jamais d’une ruche inventée', () => {
    const lu = lireAnnonce(avec('etat', 'membre'));
    expect(lu).toMatchObject({ etat: 'membre', ruche: null });
  });

  it('la première occurrence d’une clé fait foi (RFC 6763 § 6.4)', () => {
    expect(lireAnnonce([...base.slice(0, 1), 'nom=Premier', ...base.slice(1)])?.nom).toBe(
      'Premier',
    );
  });
});

describe('le code d’appariement', () => {
  it('huit caractères, sans I, L, O ni U', () => {
    for (let i = 0; i < 200; i++) {
      const c = tirerCode();
      expect(c).toHaveLength(LONGUEUR_CODE);
      expect(c).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it('la saisie pardonne l’œil (O/0, I/L/1, casse, tirets), jamais une longueur fausse', () => {
    expect(normaliserCode('k7q2-9xmp')).toBe('K7Q29XMP');
    expect(normaliserCode('K7Q2 9XMP')).toBe('K7Q29XMP');
    expect(normaliserCode('O0Il-1111')).toBe('00111111');
    expect(normaliserCode('K7Q2-9XM')).toBeNull();
    expect(normaliserCode('K7Q2-9XMPP')).toBeNull();
    expect(normaliserCode('K7Q2-9XMU'), 'U n’est pas dans l’alphabet').toBeNull();
    expect(normaliserCode(42)).toBeNull();
    expect(formaterCode('K7Q29XMP')).toBe('K7Q2-9XMP');
  });
});

describe('l’empreinte de la ruche', () => {
  it('stable pour un secret, différente pour un autre, et sans rien du secret', () => {
    const secret = 'un-secret-de-session-assez-long-pour-la-garde';
    const e = deriverEmpreinte(secret);
    expect(e).toMatch(EMPREINTE_RE);
    expect(deriverEmpreinte(secret)).toBe(e);
    expect(deriverEmpreinte(`${secret}!`)).not.toBe(e);
    expect(secret).not.toContain(e);
    expect(formaterEmpreinte(e)).toMatch(/^.{4}-.{4}-.{4}$/);
    expect(estEmpreinte(e)).toBe(true);
    expect(estEmpreinte('ABCDEFGHJKMN'), 'majuscules : pas le format').toBe(false);
  });
});

describe('l’offre scellée', () => {
  const billet = encoderBillet({
    url: 'ws://192.168.1.10:7777/ws',
    id: 'bil-essai',
    secret: 's'.repeat(43),
    label: 'Ruche de test',
  });
  const INSTANCE = 'hive-0a1b2c3d';

  it('s’ouvre avec le bon code, sur la bonne machine', async () => {
    const offre = await scellerOffre({ billet, ruche: RUCHE }, 'K7Q29XMP', INSTANCE);
    // Rien de lisible sur le fil : ni le billet, ni son secret, ni l'URL.
    const fil = JSON.stringify(offre);
    expect(fil).not.toContain('hive2_');
    expect(fil).not.toContain('192.168.1.10');
    expect(await ouvrirOffre(offre, 'K7Q29XMP', INSTANCE)).toEqual({
      issue: 'ouverte',
      contenu: { billet, ruche: RUCHE },
    });
  });

  it('un MAUVAIS CODE ne l’ouvre pas', async () => {
    const offre = await scellerOffre({ billet, ruche: RUCHE }, 'K7Q29XMP', INSTANCE);
    expect(await ouvrirOffre(offre, 'K7Q29XMQ', INSTANCE)).toEqual({ issue: 'refusee' });
  });

  it('une offre destinée à une AUTRE machine ne s’ouvre pas, même avec le même code', async () => {
    const offre = await scellerOffre({ billet, ruche: RUCHE }, 'K7Q29XMP', INSTANCE);
    expect(await ouvrirOffre(offre, 'K7Q29XMP', 'hive-ffffffff')).toEqual({ issue: 'refusee' });
  });

  it('une charge ALTÉRÉE d’un seul bit est refusée', async () => {
    const offre = await scellerOffre({ billet, ruche: RUCHE }, 'K7Q29XMP', INSTANCE);
    const octets = Buffer.from(offre.charge, 'base64url');
    octets[3] = octets[3]! ^ 1;
    const alteree = { ...offre, charge: octets.toString('base64url') };
    expect(await ouvrirOffre(alteree, 'K7Q29XMP', INSTANCE)).toEqual({ issue: 'refusee' });
  });

  it('une offre MALFORMÉE est « illisible » — sans payer le PBKDF2', async () => {
    const offre = await scellerOffre({ billet, ruche: RUCHE }, 'K7Q29XMP', INSTANCE);
    const avant = derivations.n;
    for (const brut of [
      null,
      'une chaîne',
      { ...offre, v: 2 },
      { ...offre, iv: 'AAAA' },
      { ...offre, sel: `${offre.sel}=` },
      { ...offre, charge: 'x'.repeat(10_000) },
    ]) {
      expect(await ouvrirOffre(brut, 'K7Q29XMP', INSTANCE)).toEqual({ issue: 'illisible' });
    }
    // Six refus, AUCUNE dérivation de clé : la forme est jugée avant.
    expect(derivations.n).toBe(avant);
    // …et le banc mesure bien quelque chose : un mauvais code, lui, en coûte une.
    await ouvrirOffre(offre, 'K7Q29XMQ', INSTANCE);
    expect(derivations.n).toBe(avant + 1);
  });

  it('authentique mais inutilisable (billet illisible) : « illisible », pas « ouverte »', async () => {
    const offre = await scellerOffre(
      { billet: 'pas-un-billet', ruche: RUCHE },
      'K7Q29XMP',
      INSTANCE,
    );
    expect(await ouvrirOffre(offre, 'K7Q29XMP', INSTANCE)).toEqual({ issue: 'illisible' });
  });
});

describe('les noms d’instance et les adresses', () => {
  it('une instance est tirée au sort, au format attendu', () => {
    const a = tirerInstance();
    expect(a).toMatch(INSTANCE_RE);
    expect(tirerInstance()).not.toBe(a);
  });

  it('seule une IPv4 privée est une adresse de pair', () => {
    expect(ipv4Privee('192.168.1.23')).toBe('192.168.1.23');
    expect(ipv4Privee('::ffff:10.0.0.4')).toBe('10.0.0.4');
    expect(ipv4Privee('127.0.0.1')).toBe('127.0.0.1');
    expect(ipv4Privee('8.8.8.8')).toBeNull();
    expect(ipv4Privee('0.0.0.0')).toBeNull();
    expect(ipv4Privee('fe80::1')).toBeNull();
    expect(ipv4Privee('machine.local'), 'un nom n’est pas une adresse').toBeNull();
    expect(ipv4Privee(undefined)).toBeNull();
  });
});
