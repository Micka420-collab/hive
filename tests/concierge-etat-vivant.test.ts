// LE CONCIERGE, QUAND IL N'Y A RIEN À DIRE — et dans la langue qu'on lui parle.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Premier balayage ÉLARGI hors `dashboard/src/views`, base épinglée dans
// l'atelier (`LOUPE_BASE=d7f6194`) : **21 candidates, 21 examinées,
// 12 défendues, 9 SANS TEST**.
//
// Le périmètre `src` entier rend 371 candidates — onze heures de machine. Un
// échantillon sous-déclare (§ 9 quinquinquagicenties : la moitié de la Ruche
// n'avait rendu qu'un tiers de ses nues), donc le balayage a été RESSERRÉ sur
// un module entièrement balayable plutôt qu'élargi et tronqué.
//
// ─── LES TROIS FAMILLES, ET CE QU'ELLES COÛTENT ──────────────────────────────
//
// **Les listes vides.** `enCours.length > 0`, `sous.length > 0`,
// `echecs > 0` : mutées en `>=`, la ligne se pousse sur une liste VIDE. Le
// concierge annonce « En cours : 0 tâche(s) — » et n'en nomme aucune. C'est
// l'état dans lequel une ruche passe le plus clair de son temps, et aucun décor
// ne l'éprouvait.
//
// **La langue.** Trois `lang === 'fr'` nus : inversés, un francophone lit la
// phrase anglaise et réciproquement. Le banc existant appelle `answerLive` en
// français seulement — la moitié anglaise est ÉVALUÉE à chaque appel
// (§ 9 sexquinquagicenties : `t(fr, en)` évalue ses deux arguments) mais jamais
// REGARDÉE.
//
// **Le filtre d'entrée.** `sousAgentsDepuisEvenements` lit du `payload` de
// journal — de la donnée de forme non garantie. Ses deux refus sont nus, et
// `||` mué en `&&` ne refuse plus que si TOUTES les conditions tombent :
//
//     !a || typeof a !== 'object'      `null` passe (typeof null === 'object'),
//                                      puis `o.name` jette
//     name/status pas des chaînes      { name: 'x', status: 42 } passe, et un
//                                      `status` non-chaîne file en aval
//
// C'est la même faute que la Reine et la Chronique sur `instanceof` : une garde
// de TYPE qu'on élargit laisse entrer ce qu'elle existait pour retenir.

import { describe, expect, it } from 'vitest';
import { answerLive, sousAgentsDepuisEvenements } from '../src/orchestrator/concierge.js';
import type { ConciergeContext } from '../src/orchestrator/concierge.js';
import type { HiveEvent } from '../src/shared/types.js';

/**
 * Un contexte dont les LISTES VIVANTES sont vides — mais qui porte un projet.
 *
 * ─── SANS CE PROJET, TROIS CAS ÉTAIENT DU DÉCOR ──────────────────────────────
 *
 * Premier jet : `reports: []`. `progressReply` court-circuite alors sur
 * « Aucun projet dans la ruche pour le moment » et n'atteint JAMAIS
 * `lignesEssaimVivant`. `progressReply` exige DEUX choses pour aller jusqu'aux
 * lignes vivantes, et les deux ont été lues dans la source après avoir vu le
 * banc rougir : un `reports` NON VIDE (sinon court-circuit « Aucun projet »),
 * et un `pulse` NON NUL (sinon `ctx.pulse.activeNodes` jette). Les deux cas
 * « le concierge se tait » passaient donc au
 * vert sans que la garde qu'ils visent ait tourné une seule fois — ils
 * seraient restés verts sur le mutant.
 *
 * C'est § 9 unvicicenties dans sa forme la plus pure : une assertion NÉGATIVE
 * est verte quand rien ne s'exécute. Le projet est ici pour que la ligne soit
 * ATTEINTE, et que son absence veuille dire quelque chose.
 */
function ctxVide(over: Partial<ConciergeContext> = {}): ConciergeContext {
  return {
    projects: [
      {
        id: 'p1',
        name: 'Rucher',
        repoUrl: null,
        description: null,
        visibility: 'private',
        ownerId: null,
        createdAt: 1,
      },
    ],
    nodes: [],
    reports: [
      {
        projectId: 'p1',
        name: 'Rucher',
        total: 3,
        byStatus: { pending: 1, ready: 0, assigned: 0, running: 1, done: 1, failed: 0 },
        done: 1,
        failed: 0,
        progressPct: 33,
        complete: false,
        contributingNodes: ['n1'],
        totalAttempts: 2,
      },
    ],
    pulse: {
      totalDone: 5,
      totalFailed: 1,
      successRate: 5 / 6,
      activeNodes: 2,
      latency: { p50: 1200, p95: 4000, max: 9000, avg: 1800, count: 6 },
      throughput: [],
      spanMs: 3_600_000,
    },
    waggle: null,
    finishedTasks: [],
    enCours: [],
    sousAgents: [],
    ...over,
  } as unknown as ConciergeContext;
}

const progres = (ctx: ConciergeContext): string => answerLive('où en est le projet ?', ctx).reply;
const progressEn = (ctx: ConciergeContext): string =>
  answerLive('how is the project going?', ctx).reply;

describe('le concierge se TAIT sur ce qui est vide', () => {
  it('AUCUNE TÂCHE EN COURS : pas de ligne « En cours »', () => {
    // `enCours.length > 0` mutée en `>=` : la ligne se pousse quand même et
    // annonce « 0 tâche(s) — » sans en nommer une seule.
    const r = progres(ctxVide({ enCours: [] }));
    expect(r, 'le concierge annonce des tâches en cours alors qu’il n’y en a pas').not.toContain(
      'En cours :',
    );
  });

  it('AUCUN SOUS-AGENT : pas de ligne « Sous-agents vus »', () => {
    const r = progres(ctxVide({ sousAgents: [] }));
    expect(r, 'le concierge annonce des sous-agents alors qu’il n’y en a pas').not.toContain(
      'Sous-agents vus',
    );
  });

  it('UNE TÂCHE EN COURS : la ligne EXISTE et la NOMME — le cas positif', () => {
    // Sans ce cas, les deux au-dessus seraient verts sur un concierge muet.
    const r = progres(
      ctxVide({
        enCours: [
          {
            taskId: 't1',
            title: 'poser la cire',
            status: 'running',
            nodeId: 'n1',
            nodeName: 'alpha',
          },
        ],
      } as unknown as Partial<ConciergeContext>),
    );
    expect(r, 'la ligne des tâches en cours manque').toContain('En cours :');
    expect(r, 'la tâche en cours n’est pas nommée').toContain('poser la cire');
  });
});

describe('le concierge répond dans la langue qu’on lui parle', () => {
  // ─── TROIS TERNAIRES DE LANGUE, ET UN SEUL ÉTAIT DÉFENDU ──────────────────
  //
  // Premier jet : j'ai visé « En cours : » / « In flight: ». Les deux cas
  // passaient — sur le code sain COMME sur le mutant. Ce sélecteur-là est
  // DÉFENDU (le balayage ne l'a pas rendu nu) ; j'assertais sur la seule
  // décision de langue que quelqu'un tenait déjà.
  //
  // Les deux nues sont ailleurs, dans le MÊME bloc :
  //   · le détail par tâche  — « … » sur X   /  “ … ” on X
  //   · la ligne des sous-agents — Sous-agents vus : / Sub-agents seen:
  //
  // Un banc qui vise à côté est vert des deux côtés : c'est du décor, et seule
  // la mutation le dit.

  const avecTache = (titre: string) =>
    ctxVide({
      enCours: [{ taskId: 't1', title: titre, status: 'running', nodeId: 'n1', nodeName: 'alpha' }],
    } as unknown as Partial<ConciergeContext>);

  it('LE DÉTAIL D’UNE TÂCHE EST EN FRANÇAIS : « … » et « sur »', () => {
    const r = progres(avecTache('poser la cire'));
    expect(r, 'le détail français ne porte pas sa préposition').toContain('sur alpha');
    expect(r, 'la préposition anglaise fuit dans le détail français').not.toContain('on alpha');
  });

  it('ET EN ANGLAIS : “ … ” et « on » — l’autre bord de la même ligne', () => {
    const r = progressEn(avecTache('lay the wax'));
    expect(r, 'le détail anglais ne porte pas sa préposition').toContain('on alpha');
    expect(r, 'la préposition française fuit dans le détail anglais').not.toContain('sur alpha');
  });

  const avecSousAgents = () =>
    ctxVide({
      sousAgents: [{ taskId: 't1', nodeId: 'n1', agents: [{ name: 'scout', status: 'running' }] }],
    } as unknown as Partial<ConciergeContext>);

  it('LA LIGNE DES SOUS-AGENTS SUIT LA LANGUE, DANS LES DEUX SENS', () => {
    const fr = progres(avecSousAgents());
    expect(fr, 'la ligne française des sous-agents manque').toContain('Sous-agents vus');
    expect(fr, 'la ligne anglaise fuit en français').not.toContain('Sub-agents seen');

    const en = progressEn(avecSousAgents());
    expect(en, 'la ligne anglaise des sous-agents manque').toContain('Sub-agents seen');
    expect(en, 'la ligne française fuit en anglais').not.toContain('Sous-agents vus');
  });
});

describe('le conseil de restauration compte les ÉCHECS, et seulement eux', () => {
  const avecFins = (statuts: string[], sauvegarde = true) =>
    ctxVide({
      finishedTasks: statuts.map((status, i) => ({ id: `t${i}`, title: `t${i}`, status })),
      sauvegardes: sauvegarde ? [{ label: 'avant la coulée', ts: 1 }] : [],
    } as unknown as Partial<ConciergeContext>);

  it('UN SEUL ÉCHEC SUR TROIS FINS : le conseil dit UN', () => {
    // `t.status === 'failed'` mutée en `!==` : le compte devient celui des
    // tâches qui ont RÉUSSI. Le conseil de restauration annonce alors deux
    // échecs là où il y en a un — et propose de restaurer pour des tâches qui
    // se sont bien terminées. Les trois statuts sont volontairement inégaux :
    // à 1 réussite pour 1 échec, les deux versions rendraient le même chiffre.
    const r = answerLive('où en est le projet ?', avecFins(['failed', 'done', 'done'])).reply;
    expect(r, 'le conseil de restauration ne compte pas les échecs').toContain('1 échec(s)');
    expect(r, 'le compte des échecs est celui des réussites').not.toContain('2 échec(s)');
  });

  it('AUCUN ÉCHEC : PAS de conseil de restauration', () => {
    // `echecs > 0 && derniere` mutée en `>=` : avec une sauvegarde en réserve
    // et zéro échec, la ruche conseille quand même de restaurer — « 0 échec(s)
    // récent(s) ». On invite à défaire ce qui vient de réussir.
    const r = answerLive('où en est le projet ?', avecFins(['done', 'done'])).reply;
    expect(r, 'un conseil de restauration s’affiche sans le moindre échec').not.toContain(
      'échec(s) récent(s)',
    );
  });
});

describe('le filtre des sous-agents refuse ce qui n’a pas la forme', () => {
  const progression = (subAgents: unknown): HiveEvent[] =>
    [
      {
        id: 1,
        ts: 1,
        type: 'task_progress',
        payload: { taskId: 't1', nodeId: 'n1', subAgents },
      },
    ] as unknown as HiveEvent[];

  it('UN `null` DANS LA LISTE EST ÉCARTÉ — et ne fait pas tomber la lecture', () => {
    // `!a || typeof a !== 'object'` mutée en `&&` : pour `null`, `!a` est vrai
    // mais `typeof null === 'object'`, donc le refus ne se déclenche PLUS et
    // `o.name` jette sur `null`. La lecture d'un journal tombe sur une entrée
    // malformée — celle qu'on voulait ignorer.
    expect(() => sousAgentsDepuisEvenements(progression([null]))).not.toThrow();
    expect(sousAgentsDepuisEvenements(progression([null])), 'un `null` a été retenu').toHaveLength(
      0,
    );
  });

  it('UN `status` QUI N’EST PAS UNE CHAÎNE EST ÉCARTÉ', () => {
    // `typeof o.name !== 'string' || typeof o.status !== 'string'` mutée en
    // `&&` : il faut que les DEUX soient fautifs pour refuser. Un nom valide
    // suffit alors à faire passer un `status` numérique en aval.
    const lu = sousAgentsDepuisEvenements(progression([{ name: 'scout', status: 42 }]));
    expect(lu, 'un `status` non-chaîne est passé').toHaveLength(0);
  });

  it('UN SOUS-AGENT BIEN FORMÉ EST RETENU — sans quoi les deux refus ci-dessus sont du décor', () => {
    const lu = sousAgentsDepuisEvenements(progression([{ name: 'scout', status: 'running' }]));
    expect(lu, 'un sous-agent valide a été écarté').toHaveLength(1);
    expect(lu[0]?.agents[0]).toEqual({ name: 'scout', status: 'running' });
  });
});
