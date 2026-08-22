// `estAgentType` — la garde qui remplace un transtypage qui aurait menti.
//
// ─── POURQUOI CETTE GARDE EXISTE ─────────────────────────────────────────────
//
// `ClientOptions.agentType` est déclaré `string`, et ce n'est PAS un oubli :
//
//   · `getAdapter(name: string)` accepte une chaîne libre, et son `switch`
//     connaît `hermes-agent` et `cursor` — deux noms absents de `AgentType` ;
//   · `main.ts` lit `HIVE_AGENT` dans l'environnement, donc un humain peut y
//     écrire n'importe quoi.
//
// `requisitionSiCredentialsManquantes` attend l'union fermée. Un `as AgentType`
// au site d'appel aurait compilé en AFFIRMANT une chose fausse ; la garde dit
// la vérité, et ne change rien au comportement — la fonction retombait déjà
// sur `null` pour un agent qu'elle ne connaît pas.

import { describe, expect, it } from 'vitest';
import {
  AGENT_TYPES,
  estAgentType,
  requisitionSiCredentialsManquantes,
} from '../src/node-client/agent-detect.js';
import { readFileSync } from 'node:fs';

describe('estAgentType — accepte les cinq connus, et eux seuls', () => {
  it('accepte chacun des agents déclarés', () => {
    for (const a of AGENT_TYPES) {
      expect(estAgentType(a), `${a} devrait être reconnu`).toBe(true);
    }
  });

  // LE CAS QUI JUSTIFIE TOUT LE RESTE : des adaptateurs qui EXISTENT et qu'on
  // ne sait pas outiller en identifiants. Sans cette ligne, le banc ne
  // mesurerait que des refus imaginaires.
  //
  // On lit les `case` du `switch`, on n'appelle PAS `getAdapter` : il refuse
  // de se construire sans un `HIVE_TOKEN` solide, et une sonde par l'appel
  // confondrait « cet adaptateur n'existe pas » avec « cet adaptateur refuse
  // de travailler dans ces conditions ». `tests/readme.test.ts` porte déjà
  // cette leçon, en toutes lettres — et je l'ai quand même apprise deux fois.
  it('refuse des agents que `getAdapter` sait pourtant construire', () => {
    const source = readFileSync(new URL('../src/adapters/index.ts', import.meta.url), 'utf8');
    const branches = [...source.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!);
    const horsUnion = branches.filter((n) => !estAgentType(n));

    expect(
      horsUnion.length,
      'le banc ne mesure rien si aucun adaptateur ne sort de l’union',
    ).toBeGreaterThan(0);
    expect(horsUnion).toContain('hermes-agent');
  });

  it('refuse ce qui n’est pas une chaîne, et la chaîne vide', () => {
    for (const v of [null, undefined, 42, {}, [], '', 'CLAUDE-CODE', ' shell']) {
      expect(estAgentType(v), `${JSON.stringify(v)} devrait être refusé`).toBe(false);
    }
  });
});

describe('la garde ne change RIEN au comportement de la réquisition', () => {
  // Le seul risque d'un resserrement : refuser une réquisition qui aurait dû
  // s'ouvrir. Elle ne le peut pas — la fonction rendait déjà `null` pour tout
  // agent hors des trois qu'elle sait décrire.
  it('un agent inconnu n’aurait de toute façon ouvert aucune réquisition', () => {
    expect(requisitionSiCredentialsManquantes('custom' as never, {})).toBeNull();
    expect(requisitionSiCredentialsManquantes('shell' as never, {})).toBeNull();
  });

  it('mais un agent connu SANS identifiants en ouvre bien une', () => {
    const req = requisitionSiCredentialsManquantes('codex', {}, { plateforme: 'linux' });
    expect(req, 'codex sans OPENAI_API_KEY devrait réclamer une clé').not.toBeNull();
    expect(req?.genre).toBe('cle_api');
  });
});
