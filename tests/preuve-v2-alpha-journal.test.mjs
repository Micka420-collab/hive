// LE JOURNAL DE LA PREUVE V2 ALPHA — « réglée », et pas seulement « terminée ».
//
// Le défaut que ce banc garde : la preuve relisait une production dès `done`,
// avant que ses relecteurs aient parlé, donc avant qu'une objection puisse la
// renvoyer en correction. Chaque cas ci-dessous est un instant de la vie d'une
// production où `done` est vrai et où lire serait pourtant trop tôt — ou non.

import { describe, expect, it } from 'vitest';
import {
  PAGE_JOURNAL,
  attenteDe,
  lecteurJournal,
  productionsDe,
  relecturesDe,
} from '../scripts/preuve-v2-alpha-journal.mjs';

const ev = (id, type, payload) => ({ id, ts: id * 100, type, payload });
const taches = (statuts) =>
  new Map(Object.entries(statuts).map(([id, status]) => [id, { id, status }]));

/** Une production rendue (id 10), relue par `r1` (id 11). */
const RENDUE = [
  ev(10, 'task_done', { taskId: 't1', nodeId: 'n1' }),
  ev(11, 'contre_expertise', { taskId: 't1', resultId: 1, possible: true, relectures: ['r1'] }),
];

describe('preuve V2 Alpha — le journal', () => {
  it('DONE AVEC UNE RELECTURE EN VOL N’EST PAS RÉGLÉE — la relecture terminée, elle l’est', () => {
    expect(attenteDe('t1', taches({ t1: 'done', r1: 'running' }), RENDUE)).toBe(
      't1 : contre-revue en cours (0/1 rendue(s))',
    );
    // Relancée en file après une panne intermédiaire : toujours en vol.
    expect(attenteDe('t1', taches({ t1: 'done', r1: 'ready' }), RENDUE)).not.toBeNull();
    // Absente de l'instantané (lancée après lui) : en vol, jamais finie.
    expect(attenteDe('t1', taches({ t1: 'done' }), RENDUE)).not.toBeNull();

    expect(attenteDe('t1', taches({ t1: 'done', r1: 'done' }), RENDUE)).toBeNull();
    expect(attenteDe('t1', taches({ t1: 'done', r1: 'failed' }), RENDUE)).toBeNull();
  });

  it('UN RETRY DE L’EVALUATOR REND LA TÂCHE NON RÉGLÉE — puis la relecture de la NOUVELLE production compte seule', () => {
    const reprise = [
      ...RENDUE,
      ev(12, 'contre_expertise_verdict', { taskId: 't1', resultId: 1, conteste: true }),
      ev(13, 'task_retry', { taskId: 't1', source: 'evaluator', resultId: 1 }),
    ];
    expect(attenteDe('t1', taches({ t1: 'ready', r1: 'done' }), reprise)).toBe('t1 ready');

    const seconde = [
      ...reprise,
      ev(14, 'task_done', { taskId: 't1', nodeId: 'n1' }),
      ev(15, 'contre_expertise', { taskId: 't1', resultId: 2, possible: true, relectures: ['r2'] }),
    ];
    // `r1` est terminale, mais elle relisait la production PRÉCÉDENTE.
    expect(attenteDe('t1', taches({ t1: 'done', r1: 'done', r2: 'running' }), seconde)).toBe(
      't1 : contre-revue en cours (0/1 rendue(s))',
    );
    expect(attenteDe('t1', taches({ t1: 'done', r1: 'done', r2: 'done' }), seconde)).toBeNull();
  });

  it('SANS CONTRE-REVUE POSSIBLE, OU SANS LANCEMENT, OU EN ÉCHEC : RÉGLÉE', () => {
    const refus = [
      ev(10, 'task_done', { taskId: 't1' }),
      ev(11, 'contre_expertise', { taskId: 't1', possible: false }),
    ];
    expect(attenteDe('t1', taches({ t1: 'done' }), refus)).toBeNull();
    expect(
      attenteDe('t1', taches({ t1: 'done' }), [ev(10, 'task_done', { taskId: 't1' })]),
    ).toBeNull();
    expect(attenteDe('t1', taches({ t1: 'failed' }), [])).toBeNull();
  });

  it('CE QUI N’EST PAS FINI, OU PAS VU, N’EST PAS RÉGLÉ — et le dit', () => {
    expect(attenteDe('t1', taches({ t1: 'running' }), [])).toBe('t1 running');
    expect(attenteDe('t1', taches({}), [])).toBe('t1 absente de l’instantané');
    // `done` sans sa fin au journal : on ne devine pas quelle production c'est.
    expect(attenteDe('t1', taches({ t1: 'done' }), [])).toBe(
      't1 done, mais sa fin n’est pas au journal',
    );
  });

  it('LES PRODUCTIONS : LES TÂCHES CONFIÉES ET LEURS DESCENDANTES — pas les relectures', () => {
    const evenements = [
      ...RENDUE,
      ev(20, 'delegation_created', { parentTaskId: 't2', childTaskId: 'c1' }),
      ev(21, 'delegation_created', { parentTaskId: 'c1', childTaskId: 'c2' }),
      ev(22, 'delegation_created', { parentTaskId: 'ailleurs', childTaskId: 'x' }),
    ];
    expect(productionsDe(['t1', 't2'], evenements)).toEqual(['t1', 't2', 'c1', 'c2']);
    expect(relecturesDe('t1', [...evenements, ...RENDUE])).toEqual(['r1']);
  });

  it('LE LECTEUR PART DU BOUT DU JOURNAL, PAGE PAR PAGE, ET NE GARDE QUE CE QUI COMPTE', async () => {
    const journal = Array.from({ length: PAGE_JOURNAL + 5 }, (_, i) =>
      ev(i + 1, 'task_progress', { taskId: 'ancienne' }),
    );
    const lectures = [];
    const ruche = {
      lire: async (chemin) => {
        lectures.push(chemin);
        const depuis = Number(new URL(chemin, 'http://x').searchParams.get('since'));
        return {
          status: 200,
          corps: journal.filter((e) => e.id > depuis).slice(0, PAGE_JOURNAL),
        };
      },
    };
    const lecteur = lecteurJournal(ruche);
    expect(await lecteur.amorcer()).toBe(true);
    expect(lectures).toEqual([
      `/api/events?since=0&limit=${PAGE_JOURNAL}`,
      `/api/events?since=${PAGE_JOURNAL}&limit=${PAGE_JOURNAL}`,
    ]);

    journal.push(
      ev(PAGE_JOURNAL + 6, 'task_progress', { taskId: 't1' }),
      ev(PAGE_JOURNAL + 7, 'task_started', { taskId: 't1', nodeId: 'n1' }),
    );
    expect(await lecteur.relever(), 'l’historique amorcé n’est jamais gardé').toEqual([
      ev(PAGE_JOURNAL + 7, 'task_started', { taskId: 't1', nodeId: 'n1' }),
    ]);
    journal.push(ev(PAGE_JOURNAL + 8, 'task_done', { taskId: 't1' }));
    expect((await lecteur.relever())?.map((e) => e.type)).toEqual(['task_started', 'task_done']);
  });

  it('UN JOURNAL ILLISIBLE, OU UNE PAGE PLEINE QUI N’AVANCE PAS, EST UN ÉCHEC DE LECTURE', async () => {
    const refuse = lecteurJournal({ lire: async () => ({ status: 403, corps: null }) });
    expect(await refuse.amorcer()).toBe(false);
    expect(await refuse.relever()).toBeNull();

    const fige = Array.from({ length: PAGE_JOURNAL }, () => ev(0, 'task_done', {}));
    const boucle = lecteurJournal({ lire: async () => ({ status: 200, corps: fige }) });
    expect(await boucle.amorcer()).toBe(false);
  });
});
