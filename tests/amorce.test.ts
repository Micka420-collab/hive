// L'AMORCE — dire TOUT ce qui manque, d'un coup, et où l'on a frappé.
//
// ─── D'OÙ VIENNENT CES BANCS ─────────────────────────────────────────────────
//
// D'un parcours JOUÉ, pas imaginé : monter une ruche puis la rejoindre depuis
// un second poste, comme le ferait un hôte avant un vrai test avec un collègue.
// Deux murs sont tombés en chemin, et aucun des deux n'était un défaut de
// logique — les deux étaient des défauts de PAROLE :
//
//   · trois démarrages successifs pour découvrir deux secrets manquants, parce
//     que chaque garde levait au lieu de s'ajouter à un constat commun ;
//   · « Erreur : fetch failed » — quatre mots, ni l'adresse visée, ni la cause,
//     ni la variable qui la décide.

import { describe, expect, it } from 'vitest';
import {
  direManques,
  estInjoignable,
  expliquerRucheInjoignable,
  manquesDeDemarrage,
  TOKEN_LONGUEUR_MIN,
  TOKEN_PAR_DEFAUT,
} from '../src/shared/amorce.js';

const BON_TOKEN = 'x'.repeat(TOKEN_LONGUEUR_MIN);
const BON_SECRET = 'y'.repeat(64);
const BONNES_ORIGINES = ['http://127.0.0.1:7777'];

const sain = {
  simulation: false,
  token: BON_TOKEN,
  corsOrigins: BONNES_ORIGINES,
  secretJwt: BON_SECRET,
};

describe('manquesDeDemarrage — tout ce qui manque, en UNE passe', () => {
  it('une ruche complète ne manque de rien', () => {
    expect(manquesDeDemarrage(sain)).toEqual([]);
  });

  it('LES TROIS À LA FOIS sont rendus ENSEMBLE', () => {
    // ─── LE DÉFAUT MESURÉ QUE CE BANC EMPÊCHE DE REVENIR ────────────────────
    //
    // Les trois gardes levaient l'une après l'autre : l'hôte corrigeait,
    // relançait, découvrait la suivante. Trois démarrages là où un seul suffit
    // — et quelqu'un qui installe pendant que son collègue attend au téléphone
    // abandonne au deuxième aller-retour.
    //
    // Ce banc rougirait le jour où quelqu'un remettrait un `return` hâtif après
    // le premier manque.
    const m = manquesDeDemarrage({
      simulation: false,
      token: TOKEN_PAR_DEFAUT,
      corsOrigins: ['*'],
      secretJwt: '',
    });
    expect(m).toHaveLength(3);
    expect(m.map((x) => x.quoi)).toEqual(['HIVE_TOKEN', 'HIVE_JWT_SECRET', 'HIVE_CORS_ORIGIN']);
  });

  it('L’ORDRE EST CELUI DU COÛT, pas celui du code', () => {
    // Le jeton ouvre la ruche entière ; le secret permet de se forger une
    // session d'administrateur ; les origines n'ouvrent que le navigateur d'un
    // tiers. Celui qui n'en corrige qu'un doit corriger le plus grave.
    const m = manquesDeDemarrage({ ...sain, token: '', secretJwt: '', corsOrigins: [] });
    expect(m[0]?.quoi).toBe('HIVE_TOKEN');
    expect(m[m.length - 1]?.quoi).toBe('HIVE_CORS_ORIGIN');
  });

  it('LA SIMULATION N’EXIGE RIEN — et elle est jugée EN PREMIER', () => {
    // La démo strictement locale est la seule porte qui s'ouvre sans secret.
    // Testée avant tout le reste : sinon elle rendrait trois manques sur une
    // démo qui n'en a besoin d'aucun.
    expect(
      manquesDeDemarrage({
        simulation: true,
        token: TOKEN_PAR_DEFAUT,
        corsOrigins: ['*'],
        secretJwt: '',
      }),
    ).toEqual([]);
  });

  it('LE JETON PAR DÉFAUT EST REFUSÉ, même s’il est long', () => {
    // Il est publié : sa longueur ne le sauve pas.
    const m = manquesDeDemarrage({ ...sain, token: TOKEN_PAR_DEFAUT });
    expect(m.map((x) => x.quoi)).toContain('HIVE_TOKEN');
  });

  it('LA BORNE DU JETON se lit dans les deux sens', () => {
    // `<` et non `<=` : un jeton qui fait EXACTEMENT le minimum est accepté.
    // Le refuser rejetterait une valeur conforme, et l'échec serait mis sur le
    // dos de celui qui l'a générée.
    expect(manquesDeDemarrage({ ...sain, token: BON_TOKEN })).toEqual([]);
    const court = manquesDeDemarrage({ ...sain, token: 'x'.repeat(TOKEN_LONGUEUR_MIN - 1) });
    expect(court.map((x) => x.quoi)).toContain('HIVE_TOKEN');
  });

  it('LES ORIGINES : vide ET « * » sont refusées, une vraie liste passe', () => {
    expect(manquesDeDemarrage({ ...sain, corsOrigins: [] }).map((x) => x.quoi)).toContain(
      'HIVE_CORS_ORIGIN',
    );
    expect(
      manquesDeDemarrage({ ...sain, corsOrigins: ['http://a', '*'] }).map((x) => x.quoi),
    ).toContain('HIVE_CORS_ORIGIN');
    expect(manquesDeDemarrage({ ...sain, corsOrigins: ['http://a', 'http://b'] })).toEqual([]);
  });

  it('CHAQUE MANQUE PORTE SON COÛT ET SON REMÈDE', () => {
    // Un manque qui dit seulement « HIVE_TOKEN manquant » laisse chercher quoi
    // y mettre. Le `pourquoi` sert à décider, le `remede` à taper.
    for (const m of manquesDeDemarrage({
      simulation: false,
      token: '',
      corsOrigins: [],
      secretJwt: '',
    })) {
      expect(m.pourquoi.length, m.quoi).toBeGreaterThan(40);
      expect(m.remede.length, m.quoi).toBeGreaterThan(10);
    }
  });
});

describe('direManques — le constat, d’un seul tenant', () => {
  it('rien à dire quand rien ne manque', () => {
    expect(direManques([])).toBe('');
  });

  it('LE SINGULIER ET LE PLURIEL SE DISTINGUENT', () => {
    // « Il manque 1 choses » se remarque, et fait douter du reste du message.
    const un = direManques(manquesDeDemarrage({ ...sain, token: '' }));
    expect(un).toContain('une chose');
    expect(un).not.toContain('2 choses');
    const deux = direManques(manquesDeDemarrage({ ...sain, token: '', secretJwt: '' }));
    expect(deux).toContain('2 choses');
  });

  it('les remèdes sont dans le texte, numérotés', () => {
    const t = direManques(manquesDeDemarrage({ ...sain, token: '', secretJwt: '' }));
    expect(t).toContain('1. HIVE_TOKEN');
    expect(t).toContain('2. HIVE_JWT_SECRET');
    expect(t).toContain('randomBytes');
  });

  it('LA COMMANDE MAGIQUE EST À LA FIN, jamais en tête', () => {
    // Celui qui lit a d'abord besoin de savoir CE QUI manque. S'il voit d'emblée
    // « npm run install:hive », il la lance sans comprendre ce qu'elle règle —
    // et ne saura pas quoi faire le jour où elle ne s'applique pas (conteneur,
    // CI, service).
    const t = direManques(manquesDeDemarrage({ ...sain, token: '' }));
    expect(t.indexOf('install:hive')).toBeGreaterThan(t.indexOf('HIVE_TOKEN'));
    expect(t).toContain('HIVE_SIMULATION=1');
  });
});

describe('estInjoignable — ne pas noyer un refus applicatif', () => {
  it('une panne de transport en est une', () => {
    expect(estInjoignable(new TypeError('fetch failed'))).toBe(true);
  });

  it('UN REFUS DE LA RUCHE N’EN EST PAS UNE', () => {
    // ─── LA MOITIÉ QUI COMPTE ───────────────────────────────────────────────
    //
    // « 401 jeton invalide » ou « billet épuisé » sont des messages que la
    // ruche a ÉCRITS. Les remplacer par un conseil de dépannage réseau ferait
    // chercher un port fermé là où il faut demander un nouveau billet — et le
    // vrai message serait perdu.
    expect(estInjoignable(new Error('HTTP 401 — jeton invalide'))).toBe(false);
    expect(estInjoignable(new Error('transport en clair refusé'))).toBe(false);
  });

  it('ce qui n’est pas une Error n’est pas diagnostiqué', () => {
    expect(estInjoignable('fetch failed')).toBe(false);
    expect(estInjoignable(null)).toBe(false);
  });
});

describe('expliquerRucheInjoignable — l’adresse ET la variable', () => {
  it('nomme l’URL visée, la variable, et la cause profonde', () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = new Error('connect ECONNREFUSED 127.0.0.1:7777');
    const t = expliquerRucheInjoignable(err, 'http://localhost:7777', 'HIVE_HTTP');
    expect(t).toContain('http://localhost:7777');
    expect(t).toContain('HIVE_HTTP');
    // La cause vit dans `cause`, jamais dans le message de surface : c'est elle
    // qui distingue un port fermé d'un nom qui ne résout pas.
    expect(t).toContain('ECONNREFUSED');
    expect(t, 'le message de surface n’apprend rien').not.toContain('fetch failed');
  });

  it('SANS CAUSE PROFONDE, on rend le message de surface plutôt que rien', () => {
    const t = expliquerRucheInjoignable(new Error('boum'), 'http://x', 'HIVE_HTTP');
    expect(t).toContain('boum');
    expect(t).toContain('http://x');
  });

  it('UNE CAUSE PORTÉE PAR UN `code` EST LUE AUSSI', () => {
    // Certaines pannes de `undici` arrivent avec un objet nu portant `code` et
    // pas de `message`. Le sauter rendrait une parenthèse vide là où le code
    // est la seule information.
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ENOTFOUND' };
    expect(expliquerRucheInjoignable(err, 'http://x', 'HIVE_HTTP')).toContain('ENOTFOUND');
  });

  it('ce qui n’est pas une Error ne fabrique pas de fausse cause', () => {
    const t = expliquerRucheInjoignable('bizarre', 'http://x', 'HIVE_HTTP');
    expect(t).toContain('http://x');
    expect(t).not.toContain('undefined');
  });
});
