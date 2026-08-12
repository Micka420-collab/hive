// LE DOCTEUR ET LA RUCHE DOIVENT DIRE LES MÊMES RÉGLAGES.
//
// Suite directe du port (`port-un-seul-avis.test.ts`) : la même faute, sur trois
// autres valeurs. Chaque fois, une règle écrite deux fois, et deux fois
// différemment.
//
// ─── CE QUI DIVERGEAIT, ET CE QUE ÇA COÛTE ───────────────────────────────────
//
// **`HIVE_RUNNER`** — le commutateur qui fait travailler l'essaim TOUT SEUL,
// donc celui qui dépense sans qu'on regarde.
//
//     essaim-runner.ts  (env.HIVE_RUNNER ?? '').trim() === 'on' ? 'on' : 'off'
//     doctor-releve.ts  env.HIVE_RUNNER ?? 'off'
//
// Avec `HIVE_RUNNER=on ` — une espace en fin de ligne, ce qu'un `.env` récolte
// tout seul — la ruche travaille en autonomie et le docteur range `'on '`. Or
// son avertissement ne se déclenche que sur `=== 'on'` (`shared/doctor.ts`) :
// **il se tait**. Le seul réglage dont le rôle est de prévenir qu'on dépense
// sans surveillance était le plus facile à faire taire.
//
// **`HIVE_GARDIENNES`** — le contrôle d'entrée du nectar. Le serveur n'accepte
// que `off` ou `strict` et retombe sinon sur `consultatif`, avec un commentaire
// qui dit pourquoi : « se tromper de valeur ne doit pas pouvoir fermer le trou
// de vol ». Le docteur, lui, rapportait la valeur BRUTE : une faute de frappe
// s'affichait comme si elle était appliquée.
//
// **`HIVE_MAX_CONCURRENCY`** — et celui-là n'est pas un défaut d'affichage.
//
//     join.ts   bornerConcurrence(…)        borné 1..16, NaN → défaut
//     main.ts   Number.parseInt(… ?? '2')   brut
//
// `bornerConcurrence` existe DÉJÀ, elle est éprouvée, et son commentaire décrit
// exactement la panne qu'elle empêche : « un NaN propagé jusqu'à la boucle de
// travail donnerait un nœud connecté qui n'accepte jamais rien, et l'invité
// verrait ✔ Nœud démarré sans qu'il ne se passe jamais rien ». La porte d'à côté
// n'avait jamais reçu le correctif.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromEnv } from '../src/orchestrator/server.js';
import { relever } from '../src/doctor-releve.js';
import { modeRunnerDepuisEnv } from '../src/orchestrator/essaim-runner.js';
import { bornerConcurrence, CONCURRENCE_MAX } from '../src/node-client/identite-noeud.js';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const sansAgent = (): Promise<{ agent: string }> => Promise.resolve({ agent: 'shell' });

/** Ce qu'un `.env` récolte tout seul, et ce qu'un humain tape de travers. */
const TORDUES = ['on ', ' on', 'ON', 'oui', '', 'off '];

describe('HIVE_RUNNER : le docteur voit ce que l’essaim FAIT', () => {
  const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-reg-run-'));

  for (const v of [...TORDUES, 'on', 'off', undefined]) {
    it(`« ${v === undefined ? '(absent)' : v} » : même verdict des deux côtés`, async () => {
      const env: NodeJS.ProcessEnv = v === undefined ? {} : { HIVE_RUNNER: v, HIVE_PORT: '0' };
      const r = await relever(racine, env, 'linux', sansAgent);
      expect(
        r.reglages.runner,
        'le docteur annonce un autre mode que celui où l’essaim tourne',
      ).toBe(modeRunnerDepuisEnv(env));
    });
  }

  it('nettoie sa racine', () => {
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});

describe('HIVE_GARDIENNES : le docteur voit le contrôle RÉELLEMENT appliqué', () => {
  const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-reg-gar-'));

  for (const v of ['off', 'strict', 'consultatif', 'off ', 'stricte', 'OFF', '', undefined]) {
    it(`« ${v === undefined ? '(absent)' : v} » : même verdict des deux côtés`, async () => {
      const env: NodeJS.ProcessEnv =
        v === undefined ? { HIVE_PORT: '0' } : { HIVE_GARDIENNES: v, HIVE_PORT: '0' };
      const r = await relever(racine, env, 'linux', sansAgent);
      expect(
        r.reglages.gardiennes,
        'le docteur annonce un contrôle que la ruche n’applique pas',
      ).toBe(loadConfigFromEnv(env).gardiennes);
    });
  }

  it('nettoie sa racine', () => {
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});

describe('HIVE_MAX_CONCURRENCY : les DEUX portes du nœud bornent pareil', () => {
  // Ce banc-ci ne peut pas interroger deux fonctions — `main.ts` est un point
  // d'entrée qui DÉMARRE un nœud à l'import. On lit donc son texte, et on exige
  // qu'il passe par la règle plutôt que d'en réécrire une.
  //
  // C'est le repli assumé quand le code à éprouver ne s'appelle pas : la garde
  // suit alors le NOM de la règle. Elle rougirait si quelqu'un remettait un
  // `parseInt` à la main — ce qui est exactement le retour en arrière qu'on
  // cherche à empêcher.
  const main = readFileSync(path.join(RACINE, 'src/node-client/main.ts'), 'utf8');

  it('main.ts passe par `bornerConcurrence`, il ne refait pas le calcul', () => {
    expect(main, 'la seconde porte réécrit sa propre borne').toContain('bornerConcurrence(');
    expect(main, 'un parseInt brut sur la concurrence est revenu').not.toMatch(
      /parseInt\(\s*process\.env\.HIVE_MAX_CONCURRENCY/,
    );
  });

  it('et la règle, elle, borne vraiment — des deux côtés', () => {
    // La contre-épreuve du banc de texte : ce que la règle promet.
    expect(bornerConcurrence(undefined)).toBeGreaterThan(0);
    expect(bornerConcurrence('')).toBeGreaterThan(0);
    expect(bornerConcurrence('pas-un-nombre')).toBeGreaterThan(0);
    expect(bornerConcurrence('999')).toBe(CONCURRENCE_MAX);
    expect(bornerConcurrence('0')).toBeGreaterThan(0);
    expect(bornerConcurrence('-5')).toBeGreaterThan(0);
  });
});
