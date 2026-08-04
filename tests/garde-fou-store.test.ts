// Le CONSENTEMENT Garde-Fous, côté store : l'opt-in et les bornes qu'un humain
// pose sur un projet. Une intention, jamais un calcul — donc ce banc protège
// exactement ce qu'`essaim` et `budgets` protègent : l'absence de ligne veut
// dire INACTIF, une pose s'écrase en place, et rien ne se range qu'un humain
// n'ait voulu.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';

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
