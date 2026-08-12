// LE DOCTEUR ET LA RUCHE DOIVENT PARLER DU MÊME PORT.
//
// ─── LE DÉFAUT DE PREMIER CONTACT QUE CE BANC FERME ──────────────────────────
//
// `HIVE_PORT=` — une ligne laissée vide dans un `.env`, l'accident le plus banal
// qui soit — était lue de DEUX façons :
//
//     server.ts        Number.parseInt('', 10) → NaN, puis une garde
//                      (`Number.isInteger && 0 ≤ p ≤ 65535`) → 7777. Juste.
//     doctor-releve.ts Number('')              → 0, et AUCUNE garde.
//
// Le docteur sondait donc le port 0. Or écouter le port 0 réussit toujours (le
// système en attribue un au hasard) : il le trouvait LIBRE, et annonçait que la
// ruche ne tournait pas — pendant qu'elle écoutait sur 7777.
//
// C'est le pire endroit possible pour ce défaut. `hive doctor` existe pour être
// cru quand plus rien ne marche ; un docteur qui se trompe de patient envoie
// chercher une panne inexistante et fait rater la vraie.
//
// ─── POURQUOI UN SEUL LECTEUR, ET PAS DEUX GARDES ────────────────────────────
//
// Poser la même garde des deux côtés aurait marché aujourd'hui et divergé au
// premier changement — c'est la faute même qu'on répare. La règle vit désormais
// dans `portDepuisEnv()`, et les deux la LISENT au lieu de la réécrire.
//
// Ce banc n'éprouve donc pas une valeur : il éprouve l'ACCORD. Il rougirait
// aussi le jour où quelqu'un « améliorerait » un seul des deux côtés.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromEnv } from '../src/orchestrator/server.js';
import { relever } from '../src/doctor-releve.js';
import { portDepuisEnv, PORT_PAR_DEFAUT } from '../src/shared/port.js';

/** Les façons de se tromper en écrivant `HIVE_PORT` dans un `.env`. */
const MALFORMES = [
  ['ligne laissée vide', ''],
  ['des espaces', '   '],
  ['pas un nombre', 'sept-mille'],
  ['un décimal', '7777.5'],
  ['négatif', '-1'],
  ['au-delà de 65535', '70000'],
  ['un nombre collé à du texte', '7777abc'],
] as const;

describe('un port malformé retombe sur le défaut, jamais sur zéro', () => {
  for (const [quoi, valeur] of MALFORMES) {
    it(`${quoi} (« ${valeur} ») ⇒ ${String(PORT_PAR_DEFAUT)}`, () => {
      expect(portDepuisEnv({ HIVE_PORT: valeur })).toBe(PORT_PAR_DEFAUT);
    });
  }

  it('ABSENT ⇒ le défaut — rien à deviner', () => {
    expect(portDepuisEnv({})).toBe(PORT_PAR_DEFAUT);
  });

  it('un port VALIDE est respecté, y compris aux bornes', () => {
    // Sans ceci, une fonction qui rendrait toujours 7777 passerait tout le reste.
    expect(portDepuisEnv({ HIVE_PORT: '3000' })).toBe(3000);
    expect(portDepuisEnv({ HIVE_PORT: '65535' })).toBe(65535);
    // `0` demandé EXPLICITEMENT veut dire « un port au hasard » — c'est une
    // intention, pas une faute de frappe, et le serveur l'accepte depuis
    // toujours (ses propres bancs s'en servent).
    expect(portDepuisEnv({ HIVE_PORT: '0' })).toBe(0);
  });
});

describe('LE DOCTEUR ET LA RUCHE NE PEUVENT PAS DIVERGER', () => {
  // ─── LE PREMIER JET DE CE BANC ÉTAIT DU DÉCOR ──────────────────────────────
  //
  // Il comparait `loadConfigFromEnv()` à `portDepuisEnv()` — deux fonctions dont
  // l'une appelle l'autre. Remis au docteur sa lecture d'origine
  // (`Number(env.HIVE_PORT ?? 7777)`), il restait VERT : le docteur n'était même
  // pas dans son graphe d'imports. Il éprouvait l'accord de la règle avec
  // elle-même (§ 9 duotrigies).
  //
  // On interroge donc le RELEVÉ, celui que `hive doctor` produit vraiment, et on
  // compare au port que la ruche ouvrirait. C'est l'ACCORD qu'on épingle, pas un
  // nombre : ce banc rougirait aussi le jour où quelqu'un « améliorerait » un
  // seul des deux côtés.

  // Une racine jetable par fichier : le relevé lit le disque, il lui faut un
  // endroit à lui. Aucun `.env` dedans — on ne veut mesurer QUE le port.
  const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-port-'));
  const sansAgent = (): Promise<{ agent: string }> => Promise.resolve({ agent: 'shell' });

  const VALEURS = ['', '   ', 'sept-mille', '7777.5', '-1', '70000', '3000', undefined];

  for (const v of VALEURS) {
    it(`« ${v === undefined ? '(absent)' : v} » : même verdict des deux côtés`, async () => {
      const env: NodeJS.ProcessEnv = v === undefined ? {} : { HIVE_PORT: v };
      const r = await relever(racine, env, 'linux', sansAgent);
      expect(r.port.numero, 'le docteur sonde un autre port que celui où la ruche écoute').toBe(
        loadConfigFromEnv(env).port,
      );
    });
  }

  it('nettoie sa racine', () => {
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});
