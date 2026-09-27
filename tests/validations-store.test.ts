// `latestValidation` — la preuve que l'Evaluator lit, quelle qu'en soit la source.
//
// Trois invariants, chacun avec l'écran qui mentirait sans lui :
//
//   · la plus RÉCENTE gouverne, avec sa provenance ENTIÈRE : une CI ingérée
//     après le bac le remplace, et l'inverse — jamais un mélange état par état
//     qui afficherait une provenance que la moitié des états n'a pas ;
//   · une preuve GitHub rangée sous l'ancien nom (`ci_validation_recorded`)
//     reste lisible : elle a été ingérée par un humain, la perdre en silence
//     rouvrirait `additional_test_required` sur une tâche déjà prouvée ;
//   · le journal est une trace, pas une zone de confiance : une charge du bac
//     altérée (un vert sans code 0, un état que sa raison n'autorise pas) est
//     refusée par les règles mêmes qui l'ont admise du réseau.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';

let store: HiveStore;

beforeEach(() => {
  store = new HiveStore(':memory:');
});

afterEach(() => {
  store.close();
});

const bac = (extra: Record<string, unknown> = {}) => ({
  source: 'hive_sandbox',
  taskId: 't1',
  projectId: 'p1',
  resultId: 4,
  nodeId: 'n1',
  baseSha: 'c'.repeat(40),
  validation: { tests: 'passed', typecheck: 'not_applicable', build: 'passed', lint: 'failed' },
  details: {
    tests: { raison: 'termine', script: 'test', code: 0, dureeMs: 10 },
    typecheck: { raison: 'non_declare' },
    build: { raison: 'termine', script: 'build', code: 0 },
    lint: { raison: 'termine', script: 'lint', code: 1, extrait: 'erreur' },
  },
  recordedAt: 1_000,
  ...extra,
});

const github = {
  source: 'github_pull_request',
  taskId: 't1',
  projectId: 'p1',
  resultId: 4,
  depot: 'o/r',
  pr: 9,
  branch: 'hive/t1',
  commitSha: 'abc123',
  validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
  recordedAt: 2_000,
};

describe('latestValidation — une preuve, une provenance', () => {
  it('relit une preuve du bac telle qu’elle a été rangée', () => {
    store.appendEvent('validation_recorded', bac());
    expect(store.latestValidation('t1', 4)).toEqual({
      validation: { tests: 'passed', typecheck: 'not_applicable', build: 'passed', lint: 'failed' },
      provenance: {
        source: 'hive_sandbox',
        taskId: 't1',
        projectId: 'p1',
        resultId: 4,
        recordedAt: 1_000,
        nodeId: 'n1',
        baseSha: 'c'.repeat(40),
        details: bac().details,
      },
    });
    expect(store.latestValidation('t1', 5), 'un autre résultat n’a pas de preuve').toBeNull();
  });

  it('la plus récente gouverne, dans les deux sens', () => {
    store.appendEvent('validation_recorded', bac());
    store.appendEvent('validation_recorded', github);
    expect(store.latestValidation('t1', 4)?.provenance).toMatchObject({
      source: 'github_pull_request',
      pr: 9,
    });
    expect(store.latestValidation('t1', 4)?.validation.lint).toBe('passed');

    store.appendEvent('validation_recorded', bac({ recordedAt: 3_000 }));
    expect(store.latestValidation('t1', 4)?.provenance).toMatchObject({ source: 'hive_sandbox' });
    expect(store.latestValidation('t1', 4)?.validation.lint).toBe('failed');
  });

  it('relit une preuve GitHub rangée sous l’ancien nom, jamais une du bac', () => {
    store.appendEvent('ci_validation_recorded', github);
    expect(store.latestValidation('t1', 4)?.provenance).toMatchObject({
      source: 'github_pull_request',
      commitSha: 'abc123',
    });
    // Le bac n'a jamais écrit sous ce nom : une telle ligne est une trace
    // fabriquée, pas une preuve.
    store.appendEvent('ci_validation_recorded', bac({ recordedAt: 5_000 }));
    expect(store.latestValidation('t1', 4)).toBeNull();
  });

  type Alteration = Record<string, unknown>;
  it.each<[string, Alteration, Alteration, Alteration]>([
    ['un vert sans code 0', { tests: { raison: 'termine', script: 'test', code: 1 } }, {}, {}],
    ['un état que la raison n’autorise pas', {}, { typecheck: 'passed' }, {}],
    ['un nœud absent', {}, {}, { nodeId: '' }],
  ])('refuse une preuve du bac altérée : %s', (_cas, details, validation, extra) => {
    const brut = bac();
    store.appendEvent(
      'validation_recorded',
      bac({
        details: { ...brut.details, ...details },
        validation: { ...brut.validation, ...validation },
        ...extra,
      }),
    );
    expect(store.latestValidation('t1', 4)).toBeNull();
  });
});
