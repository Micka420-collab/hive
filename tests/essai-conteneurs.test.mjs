// L'ESSAI DES CONTENEURS — les décisions qu'il prend, sans Docker.
//
// ─── CE QUE CE BANC GARDE, ET CE QU'IL NE GARDE PAS ──────────────────────────
//
// `scripts/essai-conteneurs.mjs` et `scripts/sonde-cloud.mjs` ne s'exercent
// pour de bon qu'en CI, contre un vrai démon Docker et un vrai Caddy : trois
// travaux, dix minutes. Leurs DÉCISIONS, elles, se jouent ici en quelques
// millisecondes — et c'est là qu'une erreur ferait un vert menteur :
//
//   · un `.env` d'essai qui ne partirait pas de `.env.example` ne verrait
//     jamais le `HIVE_HOST=127.0.0.1` qui rendait la Reine injoignable ;
//   · un pid mal choisi tuerait l'init ou la sonde de santé, pas la Reine ;
//   · une étiquette mal choisie monterait depuis l'arbre éprouvé lui-même ;
//   · un verdict trop large dirait « un compteur par client » quand la Reine
//     range tout le monde sous l'IP de Caddy.
//
// En `.mjs` : il importe des `scripts/*.mjs` (convention du dépôt, voir
// `premier-quart-heure.test.mjs`).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ecrireEnv,
  envDEssai,
  etiquettePrecedente,
  pidDeLaReine,
} from '../scripts/essai-conteneurs.mjs';
import { jugerAcharnee, lireArguments } from '../scripts/sonde-cloud.mjs';

describe('le `.env` d’essai est celui d’un opérateur', () => {
  const EXEMPLE = [
    '# un commentaire',
    'HIVE_HOST=127.0.0.1',
    'HIVE_TOKEN=change-me',
    '# HIVE_PUBLIC_URL=',
    'HIVE_TOKEN=encore-un',
    '',
  ].join('\n');

  it('remplace CHAQUE occurrence active, et garde le reste tel quel', () => {
    const env = envDEssai(EXEMPLE, { HIVE_TOKEN: 'jeton-neuf' });
    expect(env).not.toContain('change-me');
    expect(env).not.toContain('encore-un');
    expect(env.match(/^HIVE_TOKEN=jeton-neuf$/gm)).toHaveLength(2);
    // Ce que l'opérateur a copié reste : c'est ce qui rend l'essai honnête.
    expect(env).toMatch(/^HIVE_HOST=127\.0\.0\.1$/m);
    expect(env).toContain('# un commentaire');
  });

  it('une clé seulement commentée, ou absente, est AJOUTÉE à la fin', () => {
    const env = envDEssai(EXEMPLE, {
      HIVE_PUBLIC_URL: 'wss://x/ws',
      HIVE_DOMAIN: 'hive.localhost',
    });
    expect(env).toContain('# HIVE_PUBLIC_URL=');
    expect(env).toMatch(/^HIVE_PUBLIC_URL=wss:\/\/x\/ws$/m);
    expect(env).toMatch(/^HIVE_DOMAIN=hive\.localhost$/m);
    expect(env.endsWith('\n')).toBe(true);
  });

  it('sur le VRAI `.env.example`, la Reine hérite bien d’un HIVE_HOST de l’hôte', () => {
    // Le défaut que le compose ferme (`environment` prime) ne se voit que si
    // l'essai part de ce fichier-ci. Si l'exemple cesse un jour de poser
    // HIVE_HOST, ce banc le dira — et l'essai perdra ce qu'il éprouvait.
    const exemple = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const env = envDEssai(exemple, { HIVE_TOKEN: 'x'.repeat(48), HIVE_JWT_SECRET: 'y'.repeat(64) });
    expect(env).toMatch(/^HIVE_HOST=127\.0\.0\.1$/m);
    expect(env).toMatch(/^HIVE_TOKEN=x{48}$/m);
    expect(env).not.toMatch(/^HIVE_(TOKEN|JWT_SECRET)=change-me$/m);
  });
});

// Compose lit le `.env` du dossier du projet : l'essai écrit donc là où un
// mainteneur garde les secrets de SA ruche et les clés posées depuis la
// Chambre. L'écraser les perdrait sans retour — l'essai doit s'arrêter avant.
describe('l’essai n’écrase jamais le `.env` d’un opérateur', () => {
  function dossierDEssai() {
    const dossier = mkdtempSync(path.join(tmpdir(), 'hive-essai-env-'));
    writeFileSync(path.join(dossier, '.env.example'), 'HIVE_TOKEN=change-me\n');
    return dossier;
  }

  it('un `.env` déjà là, que l’essai n’a pas écrit : refus nommé, fichier intact', () => {
    const dossier = dossierDEssai();
    try {
      const cible = path.join(dossier, '.env');
      writeFileSync(cible, 'HIVE_TOKEN=le-vrai\nSEEDANCE_API_KEY=cle-de-la-chambre\n');
      expect(() => ecrireEnv(dossier, { HIVE_TOKEN: 'jetable' }, new Set())).toThrow(cible);
      expect(readFileSync(cible, 'utf8')).toContain('cle-de-la-chambre');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('aucun `.env` : il l’écrit, puis peut réécrire le SIEN dans la même exécution', () => {
    const dossier = dossierDEssai();
    try {
      const poses = new Set();
      ecrireEnv(dossier, { HIVE_TOKEN: 'premier' }, poses);
      ecrireEnv(dossier, { HIVE_TOKEN: 'second' }, poses);
      expect(readFileSync(path.join(dossier, '.env'), 'utf8')).toMatch(/^HIVE_TOKEN=second$/m);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

describe('le pid tué est celui de la Reine', () => {
  // Une sortie réelle de `docker top <id> -eo pid,args` sous `init: true`,
  // pendant qu'une sonde de santé passe.
  const TOP = [
    'PID                 COMMAND',
    '41250               /sbin/docker-init -- node dist/orchestrator/main.js',
    '41291               node dist/orchestrator/main.js',
    "41877               node -e fetch('http://127.0.0.1:'+(process.env.HIVE_PORT||7777)+'/api/health')",
    '41901               git fetch --depth 1 origin',
  ].join('\n');

  it('ni l’init qui cite la même commande, ni la sonde de santé', () => {
    expect(pidDeLaReine(TOP)).toBe(41291);
  });

  it('une Reine lancée par un chemin absolu de node est reconnue', () => {
    expect(pidDeLaReine('PID COMMAND\n7 /usr/local/bin/node dist/orchestrator/main.js\n')).toBe(7);
  });

  it('sans Reine, `null` — jamais un pid voisin', () => {
    expect(
      pidDeLaReine(
        TOP.split('\n')
          .filter((l) => !l.startsWith('41291'))
          .join('\n'),
      ),
    ).toBe(null);
    expect(pidDeLaReine('')).toBe(null);
  });
});

describe('l’étiquette d’où monter', () => {
  it('la plus récente `vX.Y.Z` — git les a déjà triées', () => {
    expect(etiquettePrecedente(['v0.10.0', 'v0.9.1', 'v0.4.0'], [])).toBe('v0.10.0');
  });

  it('jamais celle posée sur l’arbre éprouvé : monter de soi-même ne prouve rien', () => {
    expect(etiquettePrecedente(['v0.5.0', 'v0.4.0'], ['v0.5.0'])).toBe('v0.4.0');
  });

  it('ni une pré-version, ni une étiquette qui n’est pas une version', () => {
    expect(etiquettePrecedente(['v1.0.0-rc.1', 'essai', 'v0.4.0'], [])).toBe('v0.4.0');
  });

  it('aucune étiquette : `null`, et l’essai le dira', () => {
    expect(etiquettePrecedente([], [])).toBe(null);
    expect(etiquettePrecedente(['v0.4.0'], ['v0.4.0'])).toBe(null);
  });
});

describe('le verdict de l’acharnée — un compteur par client, ou pas', () => {
  const SEUIL = 20;
  const suite = (avant, dernier) => [...Array(SEUIL).fill(avant), dernier];

  it('SEUIL fois 401, puis 429 : le compteur est le sien, et l’en-tête forgé ne compte pas', () => {
    expect(jugerAcharnee(suite(401, 429), SEUIL)).toBe(null);
  });

  it('un 429 AVANT le seuil : un autre client a rempli ce compteur', () => {
    const statuts = suite(401, 429);
    statuts[3] = 429;
    expect(jugerAcharnee(statuts, SEUIL)).toMatch(/plusieurs clients sous la même adresse/);
  });

  it('pas de 429 au bout : chaque X-Forwarded-For forgé a donné une nouvelle adresse', () => {
    expect(jugerAcharnee(suite(401, 401), SEUIL)).toMatch(/X-Forwarded-For forgé/);
  });

  it('un autre refus que 401 n’est pas une connexion ratée', () => {
    expect(jugerAcharnee(suite(500, 429), SEUIL)).toMatch(/500/);
  });

  it('le mauvais nombre d’essais ne conclut rien', () => {
    expect(jugerAcharnee([401, 429], SEUIL)).toMatch(/il en faut 21/);
  });
});

describe('les arguments de la sonde', () => {
  it('le rôle est le premier mot nu, les options vont par paires', () => {
    expect(lireArguments(['voisine', '--ip', '172.18.0.3', '--domaine', 'hive.localhost'])).toEqual(
      { role: 'voisine', options: { ip: '172.18.0.3', domaine: 'hive.localhost' } },
    );
  });
});
