// L'HUMEUR DU COMPAGNON — la table qui relie l'état de la ruche à l'animal.
//
// Le compagnon résume la ruche d'un coup d'œil ; un résumé faux apprend à ne
// plus le regarder. Chaque cas ci-dessous est un mensonge possible : une
// abeille qui dort pendant qu'une production attend, qui danse sur une
// approbation d'il y a une heure rejouée à la reconnexion, ou qui affirme un
// calme alors que le flux est coupé.

import { describe, expect, it } from 'vitest';

import {
  DUREE_FETE_MS,
  estLivraisonAcceptee,
  etatDuCompagnon,
  phraseDuCompagnon,
} from '../dashboard/src/compagnon-etat.js';
import type { EntreesCompagnon } from '../dashboard/src/compagnon-etat.js';

const T0 = 1_800_000_000_000;

function entrees(e: Partial<EntreesCompagnon> = {}): EntreesCompagnon {
  return { connecte: true, tasks: [], aRevoir: 0, pastille: null, events: [], ...e };
}

const approuve = (ts: number) => ({ ts, type: 'task_reviewed', payload: { state: 'approved' } });

describe('etatDuCompagnon — l’humeur, par ordre de priorité', () => {
  it('RIEN À FAIRE → repos', () => {
    expect(etatDuCompagnon(entrees(), T0)).toEqual({
      humeur: 'repos',
      enCours: 0,
      attentes: 0,
      finFete: null,
    });
  });

  it('DES TÂCHES ASSIGNÉES OU EN COURS → occupe, avec leur nombre — les autres statuts ne comptent pas', () => {
    const tasks = (
      ['assigned', 'running', 'running', 'pending', 'ready', 'done', 'failed'] as const
    ).map((status) => ({ status }));
    const e = etatDuCompagnon(entrees({ tasks }), T0);
    expect(e.humeur).toBe('occupe');
    expect(e.enCours).toBe(3);
  });

  it('UNE PRODUCTION À REVOIR → alerte, même quand la ruche travaille', () => {
    const e = etatDuCompagnon(entrees({ tasks: [{ status: 'running' }], aRevoir: 2 }), T0);
    expect(e.humeur).toBe('alerte');
    expect(e.attentes).toBe(2);
    expect(e.enCours).toBe(1);
  });

  it('UNE ALERTE PERSONNELLE critique ou attention → alerte ; « info » ne fait pas s’agiter', () => {
    const critique = etatDuCompagnon(entrees({ pastille: { total: 1, gravite: 'critique' } }), T0);
    expect(critique.humeur).toBe('alerte');
    const attention = etatDuCompagnon(
      entrees({ pastille: { total: 3, gravite: 'attention' } }),
      T0,
    );
    expect(attention).toMatchObject({ humeur: 'alerte', attentes: 3 });
    const info = etatDuCompagnon(entrees({ pastille: { total: 4, gravite: 'info' } }), T0);
    expect(info).toMatchObject({ humeur: 'repos', attentes: 0 });
  });

  it('UNE LIVRAISON ACCEPTÉE À L’INSTANT → fête, AVANT l’alerte, et elle a une fin', () => {
    const e = etatDuCompagnon(entrees({ aRevoir: 5, events: [approuve(T0 - 1_000)] }), T0);
    expect(e.humeur).toBe('fete');
    expect(e.finFete).toBe(T0 - 1_000 + DUREE_FETE_MS);
    // …et l'alerte reprend la main dès la fin.
    expect(
      etatDuCompagnon(entrees({ aRevoir: 5, events: [approuve(T0 - 1_000)] }), e.finFete ?? 0)
        .humeur,
    ).toBe('alerte');
  });

  it('UNE APPROBATION D’IL Y A UNE HEURE, REJOUÉE À LA RECONNEXION, NE FAIT PAS DANSER', () => {
    const e = etatDuCompagnon(entrees({ events: [approuve(T0 - 3_600_000)] }), T0);
    expect(e.humeur).toBe('repos');
  });

  it('UNE HORLOGE DE REINE EN AVANCE NE FAIT PAS UNE FÊTE SANS FIN', () => {
    // L'événement est « dans le futur » de 4 s : la fête est bornée à partir
    // de MAINTENANT, jamais prolongée par l'écart d'horloge.
    const e = etatDuCompagnon(entrees({ events: [approuve(T0 + 4_000)] }), T0);
    expect(e.humeur).toBe('fete');
    expect(e.finFete).toBe(T0 + DUREE_FETE_MS);
    // Une Reine très en avance (1 min) : pas de fête plutôt qu'une fête inventée.
    expect(etatDuCompagnon(entrees({ events: [approuve(T0 + 60_000)] }), T0).humeur).toBe('repos');
  });

  it('FLUX COUPÉ → inconnu, quoi que disent des données qui ne sont plus fraîches', () => {
    const e = etatDuCompagnon(
      entrees({
        connecte: false,
        tasks: [{ status: 'running' }],
        aRevoir: 1,
        events: [approuve(T0)],
      }),
      T0,
    );
    expect(e.humeur).toBe('inconnu');
    expect(e.finFete).toBeNull();
  });
});

describe('estLivraisonAcceptee — ce qui mérite une fête', () => {
  it.each([
    ['approuvée par un humain', { type: 'task_reviewed', payload: { state: 'approved' } }, true],
    ['rejetée', { type: 'task_reviewed', payload: { state: 'rejected' } }, false],
    ['revue effacée', { type: 'task_reviewed', payload: { state: null } }, false],
    [
      'fusion propre, tests verts',
      { type: 'merge_completed', payload: { applied: 2, conflicts: 0, testsPassed: true } },
      true,
    ],
    [
      'fusion propre, sans commande de test',
      { type: 'merge_completed', payload: { applied: 1, conflicts: 0 } },
      true,
    ],
    [
      'fusion aux tests rouges',
      { type: 'merge_completed', payload: { applied: 1, conflicts: 0, testsPassed: false } },
      false,
    ],
    [
      'fusion en conflit',
      { type: 'merge_completed', payload: { applied: 1, conflicts: 1, testsPassed: true } },
      false,
    ],
    ['fusion vide', { type: 'merge_completed', payload: { applied: 0, conflicts: 0 } }, false],
    ['une tâche finie n’est pas encore acceptée', { type: 'task_done', payload: {} }, false],
  ])('%s', (_nom, ev, attendu) => {
    expect(estLivraisonAcceptee(ev)).toBe(attendu);
  });
});

describe('phraseDuCompagnon — ce que l’animal dit, dans les deux langues', () => {
  it('chaque humeur a sa phrase, et les nombres y sont', () => {
    const base = { enCours: 3, attentes: 2, finFete: null };
    expect(phraseDuCompagnon({ ...base, humeur: 'occupe' }, 'fr')).toBe(
      'Au travail sur 3 tâche(s)',
    );
    expect(phraseDuCompagnon({ ...base, humeur: 'occupe' }, 'en')).toBe('Busy with 3 task(s)');
    expect(phraseDuCompagnon({ ...base, humeur: 'alerte' }, 'fr')).toContain('2 chose(s)');
    expect(phraseDuCompagnon({ ...base, humeur: 'inconnu' }, 'fr')).toContain('inconnu');
    expect(phraseDuCompagnon({ ...base, humeur: 'repos' }, 'en')).toBe('The hive is resting');
    expect(phraseDuCompagnon({ ...base, humeur: 'fete' }, 'fr')).toBe('Livraison acceptée !');
  });
});
