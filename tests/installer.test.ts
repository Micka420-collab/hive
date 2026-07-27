// L'installation en une commande.
//
// Le test qui compte : un `.env` existant n'est JAMAIS écrasé. Écraser une
// configuration, c'est effacer un jeton en service et couper tous les nœuds
// déjà connectés — pour « aider ». C'est le genre de dégât qu'un installeur
// fait une seule fois, et qu'on ne lui pardonne pas.

import { describe, expect, it } from 'vitest';
import {
  LONGUEUR_JETON,
  NODE_MIN,
  avertissements,
  composerReglages,
  engendrerJeton,
  lireEnv,
  nodeSuffisant,
  prochainesEtapes,
  rendreEnv,
} from '../src/installer.js';
import { MIN_TOKEN_LENGTH } from '../src/shared/types.js';

describe('installation — le jeton', () => {
  it('dépasse confortablement le minimum exigé par la ruche', () => {
    const j = engendrerJeton();
    expect(j).toHaveLength(LONGUEUR_JETON);
    expect(j.length).toBeGreaterThan(MIN_TOKEN_LENGTH);
  });

  it('n’est jamais deux fois le même', () => {
    // Ce jeton est la SEULE chose qui sépare une ruche d'un inconnu qui a
    // trouvé son port.
    const jetons = new Set(Array.from({ length: 200 }, () => engendrerJeton()));
    expect(jetons.size).toBe(200);
  });

  it('ne contient que des caractères sûrs dans un .env', () => {
    // Un caractère exotique casserait le parsing, ou pire, y ferait entrer
    // autre chose.
    for (let i = 0; i < 50; i++) expect(engendrerJeton()).toMatch(/^[0-9a-f]+$/);
  });
});

describe('installation — lire un .env écrit à la main', () => {
  it('lit une configuration ordinaire', () => {
    const m = lireEnv('HIVE_TOKEN=abc\nHIVE_PORT=8080\n');
    expect(m.get('HIVE_TOKEN')).toBe('abc');
    expect(m.get('HIVE_PORT')).toBe('8080');
  });

  it('tolère commentaires, lignes vides, export et guillemets', () => {
    // Un .env écrit à la main contient tout ça. Le refuser pour un détail de
    // forme reviendrait à écraser une configuration valide.
    const m = lireEnv(
      ['# un commentaire', '', 'export HIVE_TOKEN="secret"', "HIVE_PORT='9000'", '  '].join('\n'),
    );
    expect(m.get('HIVE_TOKEN')).toBe('secret');
    expect(m.get('HIVE_PORT')).toBe('9000');
  });

  it('ignore ce qui n’est pas une affectation', () => {
    const m = lireEnv('bonjour\n=orphelin\n1INVALIDE=x\n');
    expect(m.size).toBe(0);
  });

  it('garde une valeur contenant un « = »', () => {
    expect(lireEnv('CLE=a=b=c').get('CLE')).toBe('a=b=c');
  });
});

describe('installation — ne JAMAIS écraser', () => {
  it('préserve chaque valeur existante', () => {
    const existant = new Map([
      ['HIVE_TOKEN', 'mon-jeton-en-service'],
      ['HIVE_PORT', '9999'],
      ['HIVE_GARDIENNES', 'strict'],
    ]);
    const r = composerReglages(existant, 'un-jeton-neuf');
    const valeur = (cle: string): string => r.find((x) => x.cle === cle)?.valeur ?? '';
    expect(valeur('HIVE_TOKEN'), 'le jeton en service a été écrasé').toBe('mon-jeton-en-service');
    expect(valeur('HIVE_PORT')).toBe('9999');
    expect(valeur('HIVE_GARDIENNES')).toBe('strict');
  });

  it('préserve même un jeton trivial — mais le SIGNALE', () => {
    // Le changer couperait les nœuds connectés. On prévient, on ne décide pas
    // à la place de l'humain.
    const r = composerReglages(new Map([['HIVE_TOKEN', 'court']]));
    expect(r.find((x) => x.cle === 'HIVE_TOKEN')?.valeur).toBe('court');
    const dits = avertissements(r);
    expect(dits).toHaveLength(1);
    expect(dits[0]).toMatch(new RegExp(`${MIN_TOKEN_LENGTH} caractères`));
  });

  it('ne dit rien quand tout va bien', () => {
    expect(avertissements(composerReglages(new Map()))).toEqual([]);
  });

  it('complète les clés absentes sans toucher aux autres', () => {
    const r = composerReglages(new Map([['HIVE_TOKEN', 'garde-moi']]));
    expect(r.find((x) => x.cle === 'HIVE_TOKEN')?.valeur).toBe('garde-moi');
    expect(r.find((x) => x.cle === 'HIVE_GARDIENNES')?.valeur).toBe('consultatif');
    expect(r.find((x) => x.cle === 'HIVE_POLYETHISME')?.valeur).toBe('consignes');
  });

  it('les défauts posés ne sont jamais contraignants', () => {
    // Une installation neuve ne doit rien refuser ni rien retenir : c'est la
    // règle que suivent déjà les Gardiennes et le polyéthisme.
    const r = composerReglages(new Map());
    expect(r.find((x) => x.cle === 'HIVE_GARDIENNES')?.valeur).not.toBe('strict');
    expect(r.find((x) => x.cle === 'HIVE_POLYETHISME')?.valeur).not.toBe('strict');
  });

  it('HIVE_HTTP suit le port choisi', () => {
    const r = composerReglages(new Map([['HIVE_PORT', '4242']]));
    expect(r.find((x) => x.cle === 'HIVE_HTTP')?.valeur).toBe('http://localhost:4242');
  });
});

describe('installation — le fichier rendu', () => {
  it('fait l’aller-retour sans perte', () => {
    // Le .env engendré doit être relisible par le script lui-même, sinon la
    // seconde exécution croirait tout absent et réécrirait tout.
    const r = composerReglages(new Map(), 'jeton-de-test-0123456789abcdef');
    const relu = lireEnv(rendreEnv(r));
    for (const reglage of r) expect(relu.get(reglage.cle), reglage.cle).toBe(reglage.valeur);
  });

  it('explique chaque réglage', () => {
    // Ce fichier sera relu dans six mois par quelqu'un qui mettra
    // HIVE_GARDIENNES à « strict » au hasard s'il n'y a rien pour l'en dissuader.
    const texte = rendreEnv(composerReglages(new Map()));
    for (const cle of ['HIVE_TOKEN', 'HIVE_GARDIENNES', 'HIVE_POLYETHISME']) {
      const i = texte.indexOf(`${cle}=`);
      const ligneAvant = texte.slice(0, i).split('\n').slice(-2)[0] ?? '';
      expect(ligneAvant.startsWith('#'), `${cle} sans explication`).toBe(true);
    }
  });

  it('dit que le jeton ne se publie pas', () => {
    expect(rendreEnv(composerReglages(new Map()))).toMatch(/Ne le publiez jamais/);
  });
});

describe('installation — la version de Node', () => {
  it('accepte ce qui suffit, refuse ce qui ne suffit pas', () => {
    expect(nodeSuffisant(`v${NODE_MIN}.0.0`)).toBe(true);
    expect(nodeSuffisant(`v${NODE_MIN + 4}.11.1`)).toBe(true);
    expect(nodeSuffisant(`v${NODE_MIN - 2}.9.0`)).toBe(false);
  });

  it('tolère l’absence de « v »', () => {
    expect(nodeSuffisant(`${NODE_MIN}.1.0`)).toBe(true);
  });

  it('refuse une version illisible plutôt que de supposer', () => {
    expect(nodeSuffisant('inconnue')).toBe(false);
    expect(nodeSuffisant('')).toBe(false);
  });
});

describe('installation — les prochaines étapes', () => {
  it('donnent des commandes réelles du dépôt', () => {
    const etapes = prochainesEtapes('Claude Code');
    expect(etapes.join('\n')).toContain('npm run dev');
    expect(etapes.join('\n')).toContain('npm run node');
    expect(etapes.join('\n')).toContain('Claude Code');
  });

  it('sans agent, disent que la ruche tourne quand même', () => {
    // Ne pas avoir d'agent ne doit jamais ressembler à un échec d'installation.
    expect(prochainesEtapes(null).join('\n')).toMatch(/simulé/);
  });
});
