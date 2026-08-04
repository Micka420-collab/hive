// Le CONSENTEMENT Garde-Fous, côté store : l'opt-in et les bornes qu'un humain
// pose sur un projet. Une intention, jamais un calcul — donc ce banc protège
// exactement ce qu'`essaim` et `budgets` protègent : l'absence de ligne veut
// dire INACTIF, une pose s'écrase en place, et rien ne se range qu'un humain
// n'ait voulu.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import type { Verdict } from '../src/orchestrator/gardiennes.js';

describe('HiveStore — le consentement Garde-Fous (garde_fous)', () => {
  let store: HiveStore;
  let projet: string;

  beforeEach(() => {
    store = new HiveStore(':memory:');
    projet = store.createProject({ name: 'Ruche' }).id;
  });

  afterEach(() => store.close());

  it('sans ligne, un projet est INACTIF par absence — l’opt-in demandé', () => {
    expect(store.getGardeFou(projet)).toBeNull();
    expect(store.listProjetsGardeFou()).toEqual([]);
  });

  it('pose puis relit : l’opt-in, les bornes et le poseur reviennent intacts', () => {
    store.setGardeFou(projet, { actif: true, borneMin: 'leger', borneMax: 'strict' }, 'alice');
    expect(store.getGardeFou(projet)).toMatchObject({
      projectId: projet,
      actif: true,
      borneMin: 'leger',
      borneMax: 'strict',
      definiPar: 'alice',
    });
  });

  it('le booléen « actif » est reconstruit — 0/1 en base, true/false en sortie', () => {
    store.setGardeFou(projet, { actif: false, borneMin: 'standard', borneMax: 'standard' });
    expect(store.getGardeFou(projet)?.actif).toBe(false);
    store.setGardeFou(projet, { actif: true, borneMin: 'standard', borneMax: 'standard' });
    expect(store.getGardeFou(projet)?.actif).toBe(true);
  });

  it('une seconde pose ÉCRASE en place — une seule ligne, la dernière gagne', () => {
    store.setGardeFou(projet, { actif: true, borneMin: 'leger', borneMax: 'leger' }, 'alice');
    store.setGardeFou(projet, { actif: true, borneMin: 'standard', borneMax: 'strict' }, 'bob');
    const lu = store.getGardeFou(projet);
    expect(lu?.borneMin).toBe('standard');
    expect(lu?.borneMax).toBe('strict');
    expect(lu?.definiPar).toBe('bob');
    // Toujours un seul projet actif, pas deux lignes qui coexistent.
    expect(store.listProjetsGardeFou()).toEqual([projet]);
  });

  it('poser `null` RETIRE le consentement — le projet redevient inactif', () => {
    store.setGardeFou(projet, { actif: true, borneMin: 'leger', borneMax: 'strict' });
    expect(store.getGardeFou(projet)).not.toBeNull();
    store.setGardeFou(projet, null);
    expect(store.getGardeFou(projet)).toBeNull();
    expect(store.listProjetsGardeFou()).toEqual([]);
  });

  it('listProjetsGardeFou ne rend QUE les actifs, TRIÉS — jamais un inactif', () => {
    // Les identifiants réels sont des UUID (clé étrangère vers `projects`, donc
    // impossible d'en inventer). On les crée, on les TRIE nous-mêmes, puis on
    // insère dans l'ordre INVERSE du tri — le médian inactif. Ainsi, retirer le
    // ORDER BY rend l'ordre d'insertion (inversé), jamais l'ordre trié : la
    // mutation rougit à coup sûr, sans dépendre du hasard des UUID.
    const ids = [
      store.createProject({ name: 'A' }).id,
      store.createProject({ name: 'B' }).id,
      store.createProject({ name: 'C' }).id,
    ];
    const trie = [...ids].sort();
    const inactif = trie[1]; // le médian : posé, mais éteint
    for (const id of [...trie].reverse()) {
      store.setGardeFou(id, { actif: id !== inactif, borneMin: 'leger', borneMax: 'strict' });
    }
    const attendus = trie.filter((id) => id !== inactif);
    expect(store.listProjetsGardeFou()).toEqual(attendus); // triés, l'inactif absent
    expect(store.listProjetsGardeFou()).not.toContain(inactif);
  });
});

describe('HiveStore — les observations Garde-Fous reconstruites par jointure', () => {
  let store: HiveStore;

  beforeEach(() => {
    store = new HiveStore(':memory:');
  });

  afterEach(() => store.close());

  /** Range un verdict de Gardiennes pour une tâche, et rend l'id de la ligne. */
  const verdicter = (taskId: string, verdict: Verdict, resultId = 1, now?: number): number =>
    store.enregistrerInspection(
      { resultId, taskId, nodeId: 'n1', verdict, score: 0, applique: false, griefs: [] },
      now,
    );

  it('assemble échelon + verdict + suite + exigence, sans rien recopier', () => {
    store.poserEchelonGardeFou('t-relachee', 'strict', 10);
    verdicter('t-relachee', 'clean');
    store.enregistrerContreVisite({
      productionTaskId: 't-relachee',
      suite: 'appliquer',
      raison: '',
      visiteurNodeId: 'n2',
      visiteurAgent: 'a',
    });
    store.poserExigenceGardeFou('t-relachee', true);

    expect(store.observationsGardeFou()).toEqual([
      { echelon: 'strict', verdict: 'clean', suite: 'appliquer', exigence: 'exigee' },
    ]);
  });

  it('une production EN VOL (ni contre-visite ni exigence) est ÉCARTÉE du repli', () => {
    // Tranchée : échelon + verdict + exigence, aucune contre-visite → gardée.
    store.poserEchelonGardeFou('t-tranchee', 'leger', 10);
    verdicter('t-tranchee', 'suspect');
    store.poserExigenceGardeFou('t-tranchee', false);
    // En vol : échelon + verdict, mais RIEN qui tranche → écartée.
    store.poserEchelonGardeFou('t-envol', 'strict', 20);
    verdicter('t-envol', 'clean');

    const faits = store.observationsGardeFou();
    expect(faits).toHaveLength(1);
    expect(faits[0]).toMatchObject({ echelon: 'leger', exigence: 'dispensee' });
  });

  it('prend le verdict le PLUS RÉCENT — une tâche réassignée est inspectée deux fois', () => {
    store.poserEchelonGardeFou('t', 'standard', 10);
    verdicter('t', 'hollow', 1); // première inspection
    verdicter('t', 'clean', 2); // réassignée, seconde inspection (id plus grand)
    store.poserExigenceGardeFou('t', false);
    expect(store.observationsGardeFou()[0]?.verdict).toBe('clean');
  });

  it('rend en ordre CHRONOLOGIQUE, et le LIMIT garde les plus récents', () => {
    for (const [id, ech, t] of [
      ['a', 'leger', 10],
      ['b', 'standard', 20],
      ['c', 'strict', 30],
    ] as const) {
      store.poserEchelonGardeFou(id, ech, t);
      verdicter(id, 'clean');
      store.poserExigenceGardeFou(id, false);
    }
    // Tout : chronologique croissant (choisiA 10 → 30).
    expect(store.observationsGardeFou().map((f) => f.echelon)).toEqual([
      'leger',
      'standard',
      'strict',
    ]);
    // Plafonné à 2 : les DEUX plus récents (20, 30), rendus chronologiques.
    expect(store.observationsGardeFou(2).map((f) => f.echelon)).toEqual(['standard', 'strict']);
  });

  it('les DEUX bornes référentielles suppriment l’orphelin, gardent le vivant', () => {
    const projet = store.createProject({ name: 'Ruche' }).id;
    store.createTask({ id: 't-live', projectId: projet, title: 'x', prompt: 'y' });
    // Une tâche RÉELLE et une disparue, pour chacune des deux tables.
    store.poserEchelonGardeFou('t-live', 'strict', 10);
    store.poserEchelonGardeFou('t-orphan', 'leger', 20);
    store.poserExigenceGardeFou('t-live', true);
    store.poserExigenceGardeFou('t-orphan', false);

    expect(store.pruneGardeFouEchelons()).toBe(1); // seul l'orphelin
    expect(store.pruneGardeFouExigences()).toBe(1);

    // Le VIVANT a survécu, l'orphelin a disparu — pas l'inverse (NOT IN, pas IN).
    verdicter('t-live', 'clean');
    const faits = store.observationsGardeFou();
    expect(faits).toHaveLength(1);
    expect(faits[0]).toMatchObject({ echelon: 'strict', exigence: 'exigee' });
  });
});
