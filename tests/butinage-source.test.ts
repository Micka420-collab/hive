// OÙ UNE ABEILLE A LE DROIT D'ALLER BUTINER.
//
// Chaque cas ci-dessous correspond à une façon précise de forcer la porte.
// Aucun n'est un cas « invalide » générique : un décor qui ne ressemble à
// aucune attaque ne mesure aucune défense.

import { describe, expect, it } from 'vitest';
import {
  SOURCES_CONNUES,
  expliquerRefusButinage,
  jugerSourceButinage,
} from '../src/shared/butinage.js';

const SHA = 'a'.repeat(40);
const BONNE = `https://codeload.github.com/imput/cobalt/tar.gz/${SHA}`;

/** Le motif d'un refus, ou `'ACCEPTÉ'` — pour que les tableaux se lisent. */
const refus = (u: unknown): string => {
  const v = jugerSourceButinage(u);
  return v.ok ? 'ACCEPTÉ' : v.motif;
};

describe('la porte s’ouvre sur ce qu’elle connaît', () => {
  it('une archive GitHub épinglée à un commit passe', () => {
    const v = jugerSourceButinage(BONNE);
    expect(v.ok, 'une source déclarée et épinglée devrait passer').toBe(true);
    if (v.ok) {
      expect(v.hote).toBe('codeload.github.com');
      expect(v.quoi).toContain('GitHub');
    }
  });

  it('un tarball npm à une version publiée passe', () => {
    expect(refus('https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz')).toBe('ACCEPTÉ');
    // Y compris un paquet à portée (`@scope/nom`).
    expect(refus('https://registry.npmjs.org/@types/node/-/node-20.1.0.tgz')).toBe('ACCEPTÉ');
  });

  it('l’adresse rendue est NORMALISÉE, pas celle qu’on a donnée', () => {
    const v = jugerSourceButinage(`  HTTPS://CODELOAD.GITHUB.COM/a/b/tar.gz/${SHA}?x=1#y  `);
    expect(v.ok).toBe(true);
    if (v.ok) {
      // Deux écritures d'une même cible doivent rendre la MÊME chaîne : sinon
      // tout ce qui compte des URL compte des fantômes.
      expect(v.url).toBe(`https://codeload.github.com/a/b/tar.gz/${SHA}`);
    }
  });
});

describe('1. la source qui ment sur elle-même', () => {
  // `github.com.evil.tld` CONTIENT « codeload.github.com » si on compare par
  // sous-chaîne. Il suffit d'acheter un nom de domaine pour entrer.
  it('un hôte qui contient un hôte connu n’est pas cet hôte', () => {
    expect(refus(`https://codeload.github.com.evil.tld/a/b/tar.gz/${SHA}`)).toBe('hote_inconnu');
    expect(refus(`https://evil.tld/codeload.github.com/a/b/tar.gz/${SHA}`)).toBe('hote_inconnu');
  });

  it('un sous-domaine d’un hôte connu n’est pas cet hôte non plus', () => {
    expect(refus(`https://x.codeload.github.com/a/b/tar.gz/${SHA}`)).toBe('hote_inconnu');
  });
});

describe('2. la ruche qui se parle à elle-même (SSRF)', () => {
  // Ces adresses font SORTIR une requête du réseau public pour la faire
  // RENTRER dans l'infrastructure.
  it.each([
    ['https://localhost/a', 'localhost'],
    ['https://127.0.0.1/a', 'boucle locale'],
    ['https://10.1.2.3/a', 'privé 10/8'],
    ['https://192.168.1.1/a', 'privé 192.168/16'],
    ['https://172.16.0.1/a', 'privé 172.16/12'],
    ['https://[::1]/a', 'boucle locale IPv6'],
  ])('%s (%s) est refusée', (u) => {
    expect(refus(u)).toBe('hote_prive');
  });

  // LE CAS QUI COÛTE LE PLUS CHER. Le service de métadonnées d'un hébergeur
  // rend des identifiants d'infrastructure à qui les demande de l'intérieur.
  it('169.254.169.254 — le service de métadonnées — est refusé', () => {
    expect(refus('https://169.254.169.254/latest/meta-data/iam/security-credentials/')).toBe(
      'hote_prive',
    );
  });

  it('mais 172.32.x n’est PAS privé — la borne du /12 se lit dans les deux sens', () => {
    // Sans cette ligne, un motif trop large (`^172\.`) passerait le banc
    // ci-dessus en bloquant des adresses publiques légitimes.
    expect(refus('https://172.32.0.1/a')).toBe('hote_inconnu');
  });
});

describe('3. la référence qui bouge sous nos pieds', () => {
  // `/archive/main.tar.gz` ne désigne pas un contenu : il désigne « ce qu'il y
  // aura là quand on ira voir ». Le code relu n'est pas le code installé.
  it.each(['main', 'master', 'HEAD', 'latest', 'develop'])(
    'une référence « %s » est refusée',
    (ref) => {
      expect(refus(`https://codeload.github.com/a/b/tar.gz/${ref}`)).toBe('reference_mouvante');
    },
  );

  it('un sha de 39 caractères n’est pas un sha', () => {
    expect(refus(`https://codeload.github.com/a/b/tar.gz/${'a'.repeat(39)}`)).toBe('forme_refusee');
  });
});

describe('4. les identifiants qui partent avec la requête', () => {
  it('un jeton dans l’adresse est refusé — il finirait dans un journal', () => {
    expect(refus(`https://jeton@codeload.github.com/a/b/tar.gz/${SHA}`)).toBe(
      'identifiants_dans_url',
    );
    expect(refus(`https://u:mdp@codeload.github.com/a/b/tar.gz/${SHA}`)).toBe(
      'identifiants_dans_url',
    );
  });
});

describe('les refus de forme, avant toute lecture', () => {
  it.each([
    ['http://codeload.github.com/a/b/tar.gz/' + SHA, 'schema_refuse'],
    ['file:///etc/passwd', 'schema_refuse'],
    ['ftp://codeload.github.com/a', 'schema_refuse'],
    [`https://codeload.github.com:8080/a/b/tar.gz/${SHA}`, 'port_refuse'],
    ['pas une url', 'url_illisible'],
    ['', 'url_illisible'],
  ])('%s → %s', (u, attendu) => {
    expect(refus(u)).toBe(attendu);
  });

  it('ce qui n’est pas une chaîne est refusé sans lever', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(() => jugerSourceButinage(v)).not.toThrow();
      expect(refus(v)).toBe('url_illisible');
    }
  });

  it('une adresse démesurée est refusée AVANT d’être analysée', () => {
    expect(refus(`https://codeload.github.com/${'a'.repeat(3000)}`)).toBe('url_trop_longue');
  });
});

describe('les sources déclarées se tiennent', () => {
  it('chaque source connue exige une référence immuable', () => {
    // Une source dont le motif accepterait n'importe quel chemin annulerait
    // toute la garantie du point 3.
    for (const s of SOURCES_CONNUES) {
      expect(s.motif.test('/n/importe/quoi'), `${s.hote} accepte un chemin quelconque`).toBe(false);
    }
  });

  it('chaque motif de refus a une phrase, dans les deux langues', () => {
    const motifs = [
      'url_illisible',
      'url_trop_longue',
      'schema_refuse',
      'identifiants_dans_url',
      'port_refuse',
      'hote_prive',
      'hote_inconnu',
      'forme_refusee',
      'reference_mouvante',
    ] as const;
    for (const m of motifs) {
      expect(expliquerRefusButinage(m, 'fr').length).toBeGreaterThan(5);
      expect(expliquerRefusButinage(m, 'en').length).toBeGreaterThan(5);
    }
  });
});
