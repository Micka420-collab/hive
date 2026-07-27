// La Balance — module pur. Tests dirigés par table : chaque cas fixe une
// imputation, un arrondi ou une borne, et rien d'autre. Aucune horloge, aucun
// aléa, aucune I/O — comme thermo.test.ts et pheromones.test.ts.

import { describe, expect, it } from 'vitest';
import {
  CacheProjets,
  ECHANTILLON_MIN_DEVIS,
  GrandLivre,
  VERSION_BALANCE,
  enEuros,
  estimerCout,
  jugerPlafond,
  peserLaRuche,
} from '../src/orchestrator/balance.js';
import type { CompteTache, Tentative } from '../src/orchestrator/balance.js';

/** Tentative minimale : seul ce que le cas met en jeu est nommé. */
function tentative(id: number, patch: Partial<Tentative> = {}): Tentative {
  return { id, taskId: 't1', nodeId: 'n1', success: false, durationMs: 0, ...patch };
}

function tache(patch: Partial<CompteTache> = {}): CompteTache {
  return { projectId: 'p1', status: 'done', revue: null, ...patch };
}

/** Map d'une seule tâche `t1` — le cas le plus fréquent des tables ci-dessous. */
function uneTache(patch: Partial<CompteTache> = {}): Map<string, CompteTache> {
  return new Map([['t1', tache(patch)]]);
}

describe('peserLaRuche — imputation', () => {
  it('T1 — tâche done à la 3ᵉ tentative : le dernier succès est utile, le reste en reprise', () => {
    const pesee = peserLaRuche(
      [
        tentative(1, { durationMs: 900 }),
        tentative(2, { durationMs: 1_100 }),
        tentative(3, { durationMs: 700, success: true }),
      ],
      uneTache({ status: 'done' }),
    );
    expect(pesee.global).toEqual({
      utileMs: 700,
      repriseMs: 2_000,
      echecMs: 0,
      rebuteMs: 0,
      totalMs: 2_700,
      tentatives: 3,
      rendement: 0.2593, // 700 / 2 700, arrondi à 1e-4
    });
    expect(pesee.version).toBe(VERSION_BALANCE);
    // Deux reprises sur une tâche aboutie — le substitut exact de Drone Wars.
    expect(pesee.reprises).toEqual({ taches: 1, tentatives: 2 });
  });

  it('T2 — tâche failed : tout part en échec, rendement nul', () => {
    const pesee = peserLaRuche(
      [
        tentative(1, { durationMs: 500 }),
        tentative(2, { durationMs: 500 }),
        tentative(3, { durationMs: 500 }),
      ],
      uneTache({ status: 'failed' }),
    );
    expect(pesee.global).toMatchObject({
      utileMs: 0,
      repriseMs: 0,
      echecMs: 1_500,
      rebuteMs: 0,
      totalMs: 1_500,
      rendement: 0,
    });
    // Une tâche échouée n'est pas « aboutie » : elle n'entre pas dans reprises.
    expect(pesee.reprises).toEqual({ taches: 0, tentatives: 0 });
  });

  it('T3 — tâche en vol : reprise, JAMAIS échec (l’issue est inconnue)', () => {
    for (const status of ['pending', 'ready', 'assigned', 'running'] as const) {
      const pesee = peserLaRuche([tentative(1, { durationMs: 400 })], uneTache({ status }));
      expect(pesee.global.repriseMs, status).toBe(400);
      expect(pesee.global.echecMs, status).toBe(0);
    }
  });

  it('T4 — done + revue rejetée : la tentative retenue passe en rebuté', () => {
    const pesee = peserLaRuche(
      [tentative(1, { durationMs: 300 }), tentative(2, { durationMs: 700, success: true })],
      uneTache({ status: 'done', revue: 'rejected' }),
    );
    expect(pesee.global).toMatchObject({
      utileMs: 0,
      repriseMs: 300,
      rebuteMs: 700,
      totalMs: 1_000,
      rendement: 0,
    });
  });

  it('T5 — done + revue approuvée : strictement identique à revue absente', () => {
    const lot = [
      tentative(1, { durationMs: 300 }),
      tentative(2, { durationMs: 700, success: true }),
    ];
    expect(peserLaRuche(lot, uneTache({ revue: 'approved' }))).toEqual(
      peserLaRuche(lot, uneTache({ revue: null })),
    );
  });

  it('T6 — tentative dont la tâche est absente : ignorée, jamais imputée', () => {
    const pesee = peserLaRuche(
      [
        tentative(1, { taskId: 'disparue', durationMs: 9_999, success: true }),
        tentative(2, { durationMs: 100, success: true }),
      ],
      uneTache(),
    );
    expect(pesee.corpus).toEqual({ tentatives: 2, taches: 1, ignorees: 1 });
    expect(pesee.global.totalMs).toBe(100);
    expect(pesee.global.tentatives).toBe(1);
    // Invariant de transparence : lu − ignoré == imputé.
    expect(pesee.corpus.tentatives - pesee.corpus.ignorees).toBe(pesee.global.tentatives);
    expect(pesee.parProjet.map((p) => p.projectId)).toEqual(['p1']);
  });

  it('T7 — deux succès pour une même tâche (course) : le DERNIER par id est retenu', () => {
    const lot = [
      tentative(4, { durationMs: 200, success: true }),
      tentative(9, { durationMs: 800, success: true }),
    ];
    const attendu = { utileMs: 800, repriseMs: 200, echecMs: 0, rebuteMs: 0, totalMs: 1_000 };
    expect(peserLaRuche(lot, uneTache()).global).toMatchObject(attendu);
    // …et l'ordre du lot n'y change rien.
    expect(peserLaRuche([...lot].reverse(), uneTache()).global).toMatchObject(attendu);
  });

  it('T8 — corpus vide : rendement 1, aucun NaN', () => {
    const pesee = peserLaRuche([], new Map());
    expect(pesee.global).toEqual({
      utileMs: 0,
      repriseMs: 0,
      echecMs: 0,
      rebuteMs: 0,
      totalMs: 0,
      tentatives: 0,
      rendement: 1,
    });
    expect(Number.isNaN(pesee.global.rendement)).toBe(false);
    expect(pesee.parProjet).toEqual([]);
    expect(pesee.parNoeud).toEqual([]);
    expect(pesee.corpus).toEqual({ tentatives: 0, taches: 0, ignorees: 0 });
  });

  it('T9 — durée négative (horloge en retard) : bornée à 0, aucun total négatif', () => {
    const pesee = peserLaRuche(
      [tentative(1, { durationMs: -5, success: true }), tentative(2, { durationMs: -900 })],
      uneTache(),
    );
    expect(pesee.global.totalMs).toBe(0);
    expect(pesee.global.utileMs).toBe(0);
    expect(pesee.global.repriseMs).toBe(0);
    expect(pesee.global.tentatives).toBe(2); // comptées, mais à coût nul
  });

  it('T10 — déterminisme : mêmes entrées ⇒ objets égaux, tableaux triés, ordre indifférent', () => {
    const taches = new Map<string, CompteTache>([
      ['a', tache({ projectId: 'zeta', status: 'done' })],
      ['b', tache({ projectId: 'alpha', status: 'failed' })],
    ]);
    const lot: Tentative[] = [
      { id: 1, taskId: 'a', nodeId: 'zoulou', success: true, durationMs: 100 },
      { id: 2, taskId: 'b', nodeId: 'alfa', success: false, durationMs: 200 },
      { id: 3, taskId: 'b', nodeId: 'mike', success: false, durationMs: 300 },
    ];
    const premier = peserLaRuche(lot, taches);
    expect(peserLaRuche(lot, taches)).toEqual(premier);
    expect(peserLaRuche([...lot].reverse(), taches)).toEqual(premier);
    expect(premier.parProjet.map((p) => p.projectId)).toEqual(['alpha', 'zeta']);
    expect(premier.parNoeud.map((n) => n.nodeId)).toEqual(['alfa', 'mike', 'zoulou']);
  });

  it('T11 — un nœud qui n’a que des reprises reste dans le tableau, à rendement 0', () => {
    const pesee = peserLaRuche(
      [
        tentative(1, { nodeId: 'modeste', durationMs: 600 }),
        tentative(2, { nodeId: 'veinard', durationMs: 400, success: true }),
      ],
      uneTache(),
    );
    const modeste = pesee.parNoeud.find((n) => n.nodeId === 'modeste');
    expect(modeste).toMatchObject({ utileMs: 0, repriseMs: 600, rendement: 0 });
    // Factuel, jamais un classement : l'ordre reste alphabétique.
    expect(pesee.parNoeud.map((n) => n.nodeId)).toEqual(['modeste', 'veinard']);
  });

  it('agrège plusieurs projets et plusieurs nœuds sans les mélanger', () => {
    const taches = new Map<string, CompteTache>([
      ['t1', tache({ projectId: 'p1', status: 'done' })],
      ['t2', tache({ projectId: 'p2', status: 'failed' })],
    ]);
    const pesee = peserLaRuche(
      [
        { id: 1, taskId: 't1', nodeId: 'n1', success: true, durationMs: 1_000 },
        { id: 2, taskId: 't2', nodeId: 'n2', success: false, durationMs: 500 },
      ],
      taches,
    );
    expect(pesee.parProjet).toEqual([
      expect.objectContaining({ projectId: 'p1', utileMs: 1_000, rendement: 1 }),
      expect.objectContaining({ projectId: 'p2', echecMs: 500, rendement: 0 }),
    ]);
    expect(pesee.global.totalMs).toBe(1_500);
    expect(pesee.corpus.taches).toBe(2);
  });
});

describe('estimerCout — prévoir sans mentir', () => {
  it('T12 — médiane et p90 au rang le plus proche', () => {
    expect(estimerCout('api', [100, 200, 300, 400, 1_000])).toEqual({
      domaine: 'api',
      echantillon: 5,
      medianeMs: 300,
      p90Ms: 1_000, // rang ceil(0,9 × 5) = 5 → index 4
    });
  });

  it('T13 — échantillon pair : médiane = moyenne des deux médians', () => {
    expect(estimerCout('ui', [100, 200, 300, 400])).toMatchObject({ medianeMs: 250 });
  });

  it('T14 — sous ECHANTILLON_MIN_DEVIS tâches comparables : null, jamais un chiffre', () => {
    expect(estimerCout('db', [100, 200])).toBeNull();
    expect(estimerCout('db', [])).toBeNull();
    expect(ECHANTILLON_MIN_DEVIS).toBe(3);
    expect(estimerCout('db', [100, 200, 300])).not.toBeNull();
  });

  it('ne modifie pas l’échantillon reçu et borne les durées négatives', () => {
    const echantillon = [400, 100, -50];
    expect(estimerCout('tests', echantillon)).toMatchObject({ medianeMs: 100, p90Ms: 400 });
    expect(echantillon).toEqual([400, 100, -50]); // pure : aucun tri en place
  });
});

describe('enEuros — projection d’affichage, jamais une facture', () => {
  it('T15 — une heure au tarif 2 vaut 2 ; sans tarif (ou tarif absurde), null', () => {
    expect(enEuros(3_600_000, 2)).toBe(2);
    expect(enEuros(1_800_000, 10)).toBe(5);
    expect(enEuros(3_600_000, null)).toBeNull();
    expect(enEuros(3_600_000, -1)).toBeNull();
    expect(enEuros(3_600_000, Number.NaN)).toBeNull();
    expect(enEuros(-1_000, 10)).toBe(0);
  });
});

describe('jugerPlafond — borner (fonction pure, aucun appelant qui bloque)', () => {
  it('T16 — passe / alerte / bloque, et « pas de plafond » passe toujours', () => {
    expect(jugerPlafond(799, 1_000)).toBe('passe');
    expect(jugerPlafond(800, 1_000)).toBe('alerte'); // seuil d'alerte : 80 %
    expect(jugerPlafond(999, 1_000)).toBe('alerte');
    expect(jugerPlafond(1_000, 1_000)).toBe('bloque');
    expect(jugerPlafond(1_200, 1_000)).toBe('bloque');
    expect(jugerPlafond(10 ** 12, null)).toBe('passe');
    expect(jugerPlafond(0, null)).toBe('passe');
  });
});

describe('GrandLivre — état courant, jamais de l’histoire', () => {
  it('T17 — absorber est idempotent, le filigrane est strictement monotone', () => {
    const livre = new GrandLivre();
    expect(livre.filigrane).toBe(0);
    const lot = [
      { id: 1, projectId: 'p1', durationMs: 100 },
      { id: 2, projectId: 'p2', durationMs: 200 },
      { id: 3, projectId: 'p1', durationMs: 300 },
    ];
    livre.absorber(lot);
    expect(livre.filigrane).toBe(3);
    expect(livre.depense('p1')).toBe(400);
    expect(livre.soldes()).toEqual([
      { projectId: 'p1', depenseMs: 400, tentatives: 2 },
      { projectId: 'p2', depenseMs: 200, tentatives: 1 },
    ]);

    // Ré-absorption du MÊME lot : aucun solde ne bouge, le filigrane non plus.
    livre.absorber(lot);
    expect(livre.soldes()).toEqual([
      { projectId: 'p1', depenseMs: 400, tentatives: 2 },
      { projectId: 'p2', depenseMs: 200, tentatives: 1 },
    ]);
    expect(livre.filigrane).toBe(3);

    // Un lot qui chevauche : seules les lignes neuves comptent.
    livre.absorber([
      { id: 3, projectId: 'p1', durationMs: 300 },
      { id: 4, projectId: 'p3', durationMs: 50 },
    ]);
    expect(livre.filigrane).toBe(4);
    expect(livre.depense('p1')).toBe(400);
    expect(livre.depense('p3')).toBe(50);
    expect(livre.depense('projet-inconnu')).toBe(0);
  });

  it('borne les durées négatives et avance le filigrane au-delà des lignes retirées', () => {
    const livre = new GrandLivre();
    livre.absorber([{ id: 1, projectId: 'p1', durationMs: -500 }]);
    expect(livre.depense('p1')).toBe(0);
    // Lot entièrement orphelin (retiré du compte par l'appelant) : le filigrane
    // doit quand même dépasser la borne du parcours, sinon le rattrapage
    // relirait les mêmes lignes à chaque tick, sans fin.
    livre.absorber([], 42);
    expect(livre.filigrane).toBe(42);
    expect(livre.soldes()).toEqual([{ projectId: 'p1', depenseMs: 0, tentatives: 1 }]);
    // …et jamais reculé par une borne plus ancienne.
    livre.absorber([], 7);
    expect(livre.filigrane).toBe(42);
  });

  it('T18 — aJour : faux à la construction, vrai après marquerRattrape, jamais remis à faux', () => {
    const livre = new GrandLivre();
    expect(livre.aJour).toBe(false);
    livre.absorber([{ id: 1, projectId: 'p1', durationMs: 10 }]);
    expect(livre.aJour).toBe(false); // absorber ne prétend rien sur la complétude
    livre.marquerRattrape();
    expect(livre.aJour).toBe(true);
    livre.absorber([{ id: 2, projectId: 'p1', durationMs: 10 }]);
    expect(livre.aJour).toBe(true);
    livre.marquerRattrape();
    expect(livre.aJour).toBe(true);
  });
});

describe('CacheProjets — mémoïsation bornée', () => {
  it('T19 — ne rappelle jamais le résolveur pour un id déjà vu', () => {
    const cache = new CacheProjets();
    const demandes: string[][] = [];
    const resoudre = (ids: string[]): Array<{ id: string; projectId: string }> => {
      demandes.push([...ids]);
      return ids.map((id) => ({ id, projectId: `p-${id}` }));
    };

    expect(cache.resoudre(['a', 'b', 'a'], resoudre)).toEqual(
      new Map([
        ['a', 'p-a'],
        ['b', 'p-b'],
      ]),
    );
    expect(demandes).toEqual([['a', 'b']]); // dédoublonné

    cache.resoudre(['a', 'b', 'c'], resoudre);
    expect(demandes[1]).toEqual(['c']); // seul l'inconnu est demandé
    cache.resoudre(['a', 'b', 'c'], resoudre);
    expect(demandes).toHaveLength(2); // rien de neuf : aucune lecture
    expect(cache.statistiques).toEqual({ taille: 3, lectures: 2 });
  });

  it('T19 — borné : au-delà de la capacité, la plus ancienne entrée sort', () => {
    const cache = new CacheProjets(2);
    const resoudre = (ids: string[]): Array<{ id: string; projectId: string }> =>
      ids.map((id) => ({ id, projectId: `p-${id}` }));
    cache.resoudre(['a'], resoudre);
    cache.resoudre(['b'], resoudre);
    cache.resoudre(['c'], resoudre);
    expect(cache.statistiques.taille).toBe(2);
    // 'a' est sortie : elle est redemandée au résolveur.
    const demandes: string[][] = [];
    cache.resoudre(['a', 'c'], (ids) => {
      demandes.push([...ids]);
      return resoudre(ids);
    });
    expect(demandes).toEqual([['a']]);
  });

  it('une tâche introuvable n’entre pas dans le cache et reste absente du retour', () => {
    const cache = new CacheProjets();
    const projets = cache.resoudre(['fantome'], () => []);
    expect(projets.size).toBe(0);
    expect(cache.statistiques.taille).toBe(0);
  });
});
