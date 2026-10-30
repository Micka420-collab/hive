// Le garde de PR, module pur : ce qu'il décide d'un sondage, et pourquoi.
//
// Chaque règle qui empêche la boucle de s'emballer a son test ici : le
// réarmement sur une tête NEUVE seulement, le vert qui ne se confond pas avec
// l'absence de CI, la relance « instable » qui exige la preuve de la base, et
// l'autonomie qui borne le geste. Le trajet complet (vrai serveur, faux
// GitHub) vit dans `garde-pr-boucle.test.ts`.

import { describe, expect, it } from 'vitest';
import {
  PASSAGES_BASE_INSTABLE,
  PLAFOND_GARDE_DEFAUT,
  RECUL_MAX_MS,
  deciderGarde,
  etatCi,
  gardeActiveDepuisEnv,
  gesteAutonome,
  jugerInstables,
  plafondGardeDepuisEnv,
  reculGarde,
  relanceAutorisee,
} from '../src/orchestrator/garde-pr.js';
import { lireFaitsPr } from '../src/orchestrator/livraison.js';
import { etatLivraison } from '../src/shared/retour.js';
import type { Controle, FaitsPr } from '../src/shared/retour.js';

const rouge = (nom: string, jobId?: number): Controle => ({
  nom,
  conclusion: 'failure',
  statut: 'completed',
  url: `https://x/${nom}`,
  ...(jobId !== undefined ? { jobId } : {}),
});
const vert = (nom: string): Controle => ({
  nom,
  conclusion: 'success',
  statut: 'completed',
  url: `https://x/${nom}`,
});
const enCours = (nom: string): Controle => ({
  nom,
  conclusion: '',
  statut: 'in_progress',
  url: `https://x/${nom}`,
});

const faits = (controles: Controle[], extra: Partial<FaitsPr> = {}): FaitsPr => ({
  numero: 7,
  ouverte: true,
  fusionnee: false,
  fusionnable: true,
  commitSha: 'tete-1',
  branche: 'hive/t1',
  base: 'main',
  controles,
  revues: [],
  ...extra,
});
const vue = (f: FaitsPr) => ({ etat: etatLivraison(f), faits: f });
const vierge = { teteTraitee: '', teteRelancee: '' };

describe('etatCi — la CI seule, sans les revues', () => {
  it('distingue rouge, en cours, verte et SANS CI', () => {
    expect(etatCi(faits([vert('a'), rouge('b')]))).toBe('rouge');
    expect(etatCi(faits([vert('a'), enCours('b')]))).toBe('en_cours');
    expect(etatCi(faits([vert('a'), vert('b')]))).toBe('verte');
    // Une PR dont la CI n'a pas démarré ne prouve rien : la confondre avec le
    // vert remettrait le plafond à zéro sur une production jamais contrôlée.
    expect(etatCi(faits([]))).toBe('sans_ci');
  });
});

describe('deciderGarde', () => {
  it('retire le garde d’une PR fusionnée ou fermée', () => {
    expect(deciderGarde(vue(faits([rouge('t')], { fusionnee: true })), vierge)).toEqual({
      geste: 'retirer',
      etat: 'fusionnee',
    });
    expect(deciderGarde(vue(faits([rouge('t')], { ouverte: false })), vierge)).toEqual({
      geste: 'retirer',
      etat: 'fermee',
    });
  });

  it('remet à zéro sur le vert, attend une CI en cours ou absente', () => {
    expect(deciderGarde(vue(faits([vert('t')])), vierge).geste).toBe('vert');
    expect(deciderGarde(vue(faits([enCours('t')])), vierge)).toEqual({
      geste: 'attendre',
      raison: 'ci_en_cours',
    });
    expect(deciderGarde(vue(faits([])), vierge)).toEqual({ geste: 'attendre', raison: 'calme' });
  });

  it('agit sur une tête rouge NEUVE, et plus jamais sur la même', () => {
    const f = faits([rouge('tests')]);
    expect(deciderGarde(vue(f), vierge)).toMatchObject({ geste: 'agir', tete: 'tete-1' });
    // Même tête, déjà traitée : aucune reprise de plus, quel que soit le
    // nombre de sondages — c'est ce qui empêche la boucle.
    expect(deciderGarde(vue(f), { teteTraitee: 'tete-1', teteRelancee: '' })).toEqual({
      geste: 'attendre',
      raison: 'deja_traitee',
    });
    // Un nouveau commit, rouge lui aussi : le garde se réarme.
    expect(
      deciderGarde(vue(faits([rouge('tests')], { commitSha: 'tete-2' })), {
        teteTraitee: 'tete-1',
        teteRelancee: '',
      }),
    ).toMatchObject({ geste: 'agir', tete: 'tete-2' });
  });

  it('n’agit pas sans tête lue — la mémoire ne serait pas comparable', () => {
    const f = faits([rouge('tests')]);
    delete f.commitSha;
    expect(deciderGarde(vue(f), vierge)).toEqual({ geste: 'attendre', raison: 'calme' });
  });

  it('ne propose une relance que si TOUS les échecs sont des jobs, et une fois par tête', () => {
    const jobs = faits([rouge('a', 11), rouge('b', 12)]);
    expect(deciderGarde(vue(jobs), vierge)).toMatchObject({
      geste: 'agir',
      instables: [{ nom: 'a' }, { nom: 'b' }],
    });
    // Un échec sans job (un service externe) doit être corrigé de toute
    // façon : rejouer les autres retarderait la correction d'un tour de CI.
    expect(deciderGarde(vue(faits([rouge('a', 11), rouge('externe')])), vierge)).toMatchObject({
      geste: 'agir',
      instables: [],
    });
    // Déjà relancée sur cette tête : le job rejoué a encore échoué, c'est un
    // vrai échec.
    expect(deciderGarde(vue(jobs), { teteTraitee: '', teteRelancee: 'tete-1' })).toMatchObject({
      geste: 'agir',
      instables: [],
    });
  });
});

describe('jugerInstables — la preuve de la base', () => {
  const succes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ commit: `b${i}`, conclusion: 'success' }));

  it('relance quand chaque échec a réussi sur la base à ses N derniers passages', () => {
    const preuves = jugerInstables(
      [rouge('tests', 42)],
      new Map([['tests', succes(PASSAGES_BASE_INSTABLE + 1)]]),
    );
    expect(preuves).toEqual([{ nom: 'tests', jobId: 42, base: succes(PASSAGES_BASE_INSTABLE) }]);
  });

  it('refuse dès qu’un passage de la base a échoué : c’est la base qui est cassée', () => {
    const base = succes(PASSAGES_BASE_INSTABLE);
    base[1] = { commit: 'b1', conclusion: 'failure' };
    expect(jugerInstables([rouge('tests', 42)], new Map([['tests', base]]))).toBeNull();
  });

  it('refuse un contrôle sans historique suffisant, ou un échec non prouvé parmi d’autres', () => {
    expect(
      jugerInstables(
        [rouge('tests', 42)],
        new Map([['tests', succes(PASSAGES_BASE_INSTABLE - 1)]]),
      ),
    ).toBeNull();
    expect(
      jugerInstables(
        [rouge('tests', 42), rouge('lint', 43)],
        new Map([['tests', succes(PASSAGES_BASE_INSTABLE)]]),
      ),
    ).toBeNull();
    expect(jugerInstables([rouge('tests')], new Map([['tests', succes(3)]]))).toBeNull();
  });
});

describe('ce que l’autonomie autorise', () => {
  it('off et propose préviennent ; gouverne et plein reprennent si l’hôte a allumé le runner', () => {
    expect(gesteAutonome('off', true)).toEqual({ geste: 'notifier', motif: 'autonomie' });
    expect(gesteAutonome('propose', true)).toEqual({ geste: 'notifier', motif: 'autonomie' });
    expect(gesteAutonome('gouverne', true)).toEqual({ geste: 'reprendre' });
    expect(gesteAutonome('plein', true)).toEqual({ geste: 'reprendre' });
    expect(gesteAutonome('gouverne', false)).toEqual({
      geste: 'notifier',
      motif: 'runner_eteint',
    });
  });

  it('la relance d’un job instable suit le seul niveau, dès gouverne', () => {
    expect(relanceAutorisee('propose')).toBe(false);
    expect(relanceAutorisee('gouverne')).toBe(true);
  });
});

describe('les réglages de l’hôte', () => {
  it('le plafond vaut 3 par défaut et reste dans [1, 10]', () => {
    expect(PLAFOND_GARDE_DEFAUT).toBe(3);
    expect(plafondGardeDepuisEnv({})).toBe(3);
    expect(plafondGardeDepuisEnv({ HIVE_GARDE_PR_PLAFOND: '5' })).toBe(5);
    expect(plafondGardeDepuisEnv({ HIVE_GARDE_PR_PLAFOND: '0' })).toBe(1);
    expect(plafondGardeDepuisEnv({ HIVE_GARDE_PR_PLAFOND: '999' })).toBe(10);
    expect(plafondGardeDepuisEnv({ HIVE_GARDE_PR_PLAFOND: 'trois' })).toBe(3);
  });

  it('le garde est allumé par défaut ; seul « off » l’éteint', () => {
    expect(gardeActiveDepuisEnv({})).toBe(true);
    expect(gardeActiveDepuisEnv({ HIVE_GARDE_PR: 'of' })).toBe(true);
    expect(gardeActiveDepuisEnv({ HIVE_GARDE_PR: 'OFF' })).toBe(false);
  });

  it('le recul double et plafonne à une heure', () => {
    expect(reculGarde(2)).toBe(2 * reculGarde(1));
    expect(reculGarde(50)).toBe(RECUL_MAX_MS);
  });
});

describe('lireFaitsPr — ce qui est relançable, et la base', () => {
  it('ne prête un job qu’aux contrôles de GitHub Actions', async () => {
    const adresse = 'https://github.com/o/r/actions/runs/5/job/321';
    const reponses: Record<string, unknown> = {
      '/repos/o/r/pulls/7': {
        state: 'open',
        head: { sha: 'abc', ref: 'hive/t' },
        base: { ref: 'dev' },
      },
      '/repos/o/r/commits/abc/check-runs': {
        check_runs: [
          {
            name: 'actions',
            status: 'completed',
            conclusion: 'failure',
            app: { slug: 'github-actions' },
            details_url: adresse,
          },
          // Même forme d'adresse, posée par une AUTRE application : ce n'est
          // pas un job de ce dépôt, le garde ne doit jamais croire le relancer.
          {
            name: 'ailleurs',
            status: 'completed',
            conclusion: 'failure',
            app: { slug: 'circleci' },
            details_url: adresse,
          },
        ],
      },
      '/repos/o/r/pulls/7/reviews': [],
    };
    const f = await lireFaitsPr(
      {
        jeton: 'j',
        api: 'https://api.test',
        fetcheur: (url) =>
          Promise.resolve(new Response(JSON.stringify(reponses[new URL(url).pathname] ?? {}))),
      },
      'o/r',
      7,
    );
    expect(f.base).toBe('dev');
    expect(f.controles.map((c) => [c.nom, c.jobId])).toEqual([
      ['actions', 321],
      ['ailleurs', undefined],
    ]);
  });
});
