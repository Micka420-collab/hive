// LA WAR ROOM, MODULE PUR — lire le journal sans rien y ajouter.
//
// Le module ne décide rien : il replie des faits déjà consignés. Ce qu'il doit
// tenir, et que ces bancs vérifient :
//
//   · chaque producteur est LU (Conseil, contre-expertise, Evaluator, revue,
//     décision humaine) — un type oublié, c'est un pan du débat qui disparaît ;
//   · une ligne illisible est IGNORÉE, jamais devinée — une décision dont
//     l'auteur est illisible ne devient pas « anonyme » ;
//   · une reprise après panne de Worker n'est PAS un désaccord ;
//   · un désaccord reste en suspens jusqu'à ce qu'un humain tranche, et pas
//     plus longtemps.

import { describe, expect, it } from 'vitest';
import {
  dernieresDecisions,
  desaccordsNonResolus,
  entreesWarRoom,
  familleDe,
  FAMILLES_WAR_ROOM,
  RAISON_REVUE_MAX,
  TYPES_WAR_ROOM,
} from '../src/shared/war-room.js';
import type { SessionPourDesaccord, TacheRangee } from '../src/shared/war-room.js';
import type { HiveEvent } from '../src/shared/types.js';

let prochain = 1;
const ev = (type: string, payload: Record<string, unknown>, ts = 1_000 + prochain): HiveEvent => ({
  id: prochain++,
  ts,
  type,
  payload,
});

const decision = (over: Record<string, unknown> = {}): HiveEvent =>
  ev('council_decided', {
    sessionId: 's-1',
    projectId: 'p-1',
    propositionId: 'prop-a',
    titre: 'Piste A',
    justification: 'la plus vérifiée',
    par: { genre: 'compte', userId: 'u-1', nom: 'Ada' },
    ...over,
  });

const sessionClose = (over: Partial<SessionPourDesaccord> = {}): SessionPourDesaccord => ({
  id: 's-1',
  etat: 'clos',
  issue: 'depart',
  closedAt: 5_000,
  ...over,
});

describe('le fil : chaque producteur est lu', () => {
  it('LIT CHAQUE TYPE DÉCLARÉ — aucun pan du débat ne disparaît', () => {
    const fil = entreesWarRoom([
      ev('council_opened', { sessionId: 's-1', lentilles: 5, tour: 1 }),
      ev('council_proposal', { sessionId: 's-1', propositionId: 'prop-a', nodeId: 'n1', tour: 1 }),
      ev('council_review', {
        sessionId: 's-1',
        propositionId: 'prop-a',
        nodeId: 'n2',
        type: 'arret',
        tour: 2,
      }),
      ev('council_round', { sessionId: 's-1', tour: 2, taches: 3 }),
      ev('council_closed', {
        sessionId: 's-1',
        issue: 'depart',
        retenue: null,
        danses: 2,
        tour: 2,
      }),
      decision(),
      ev('contre_expertise', {
        taskId: 't-1',
        resultId: 7,
        possible: true,
        relecteurs: ['codex-1'],
        relectures: ['r-1'],
      }),
      ev('contre_expertise_verdict', {
        source: 'hive_counter_review',
        taskId: 't-1',
        resultId: 7,
        relecteur: 'codex',
        conteste: true,
        objections: ['le cas vide n’est pas traité'],
      }),
      ev('contre_expertise_review_failed', {
        taskId: 't-1',
        resultId: 7,
        relecture: 'r-2',
        relecteur: 'hermes-agent',
        terminal: true,
        attempt: 3,
      }),
      ev('contre_expertise_impossible', {
        taskId: 't-1',
        resultId: 7,
        relecture: 'r-2',
        relecteur: 'hermes-agent',
        producteur: 'claude-code',
        cause: 'aucune autre famille en ligne pour un secours',
      }),
      ev('task_retry', {
        taskId: 't-1',
        source: 'evaluator',
        resultId: 7,
        decision: 'correction_required',
        attempt: 2,
        maxAttempts: 3,
      }),
      ev('evaluator_retry_skipped', { taskId: 't-1', resultId: 8, reason: 'attempts_exhausted' }),
      ev('evaluator_overridden', {
        taskId: 't-1',
        projectId: 'p-1',
        geste: 'fusion',
        resultId: 8,
        decision: 'correction_required',
        raison: 'correctif urgent',
        parUserId: 'u-1',
      }),
      ev('task_reviewed', { taskId: 't-1', state: 'approved' }),
    ]);

    expect(fil.map((e) => e.genre)).toEqual([
      'conseil_ouvert',
      'conseil_proposition',
      'conseil_avis',
      'conseil_tour',
      'conseil_clos',
      'conseil_decide',
      'contre_expertise',
      'contre_verdict',
      'contre_echec',
      'contre_impossible',
      'renvoi_evaluator',
      'renvoi_refuse',
      'evaluator_force',
      'revue_humaine',
    ]);
    // Chaque type lu est aussi un type DEMANDÉ au journal : un type lu mais
    // jamais sélectionné par le serveur n'apparaîtrait jamais à l'écran.
    const lus = new Set([
      'council_opened',
      'council_proposal',
      'council_review',
      'council_round',
      'council_closed',
      'council_decided',
      'contre_expertise',
      'contre_expertise_verdict',
      'contre_expertise_review_failed',
      'contre_expertise_impossible',
      'task_retry',
      'evaluator_retry_skipped',
      'evaluator_overridden',
      'task_reviewed',
    ]);
    expect(new Set(TYPES_WAR_ROOM)).toEqual(lus);
    // Et chaque entrée a UNE voix : le filtre de l'écran ne perd personne.
    expect(new Set(fil.map(familleDe))).toEqual(new Set(FAMILLES_WAR_ROOM));
  });

  it('QUI A DEMANDÉ LA CORRECTION, ET CE QUE L’HUMAIN A ÉCRIT, SONT LUS', () => {
    const [renvoi, refus, revue, force] = entreesWarRoom([
      ev('task_retry', {
        taskId: 't-1',
        source: 'evaluator',
        resultId: 7,
        decision: 'correction_required',
        critique: { source: 'revue_humaine', objections: [], raisons: ['r'] },
      }),
      ev('evaluator_retry_skipped', {
        taskId: 't-1',
        resultId: 8,
        reason: 'attempts_exhausted',
        source: 'revue_humaine',
      }),
      ev('task_reviewed', { taskId: 't-1', state: 'rejected', raison: 'x'.repeat(5_000) }),
      ev('evaluator_overridden', {
        taskId: 't-1',
        geste: 'livraison',
        decision: null,
        raison: 'relu à la main',
        parUserId: null,
      }),
    ]);
    expect(renvoi).toMatchObject({ genre: 'renvoi_evaluator', demandePar: 'revue_humaine' });
    expect(refus).toMatchObject({ genre: 'renvoi_refuse', source: 'revue_humaine' });
    expect(revue?.genre === 'revue_humaine' && revue.raison?.length).toBe(RAISON_REVUE_MAX);
    // `parUserId: null` est l'aveu du jeton de ruche, pas un auteur illisible.
    expect(force).toMatchObject({ genre: 'evaluator_force', par: { genre: 'jeton_de_ruche' } });
    // Une source inventée reste inconnue, jamais devinée.
    const [inconnu] = entreesWarRoom([
      ev('evaluator_retry_skipped', { taskId: 't', reason: 'stale_result', source: 'humeur' }),
    ]);
    expect(inconnu).toMatchObject({ source: null });
    // Sans cause, une impossibilité ne dit rien à l'humain qu'elle appelle.
    expect(entreesWarRoom([ev('contre_expertise_impossible', { taskId: 't' })])).toEqual([]);
  });

  it('UNE REPRISE APRÈS PANNE DE WORKER N’EST PAS UN DÉSACCORD', () => {
    // Même type d'événement, autre nature : sans le filtre `source`, chaque
    // Worker qui tousse s'afficherait comme un renvoi de l'Evaluator.
    const fil = entreesWarRoom([
      ev('task_retry', { taskId: 't-1', attempt: 2, maxAttempts: 3, durationMs: 40 }),
    ]);
    expect(fil).toEqual([]);
  });

  it('UNE LIGNE ILLISIBLE EST IGNORÉE, JAMAIS DEVINÉE', () => {
    const fil = entreesWarRoom([
      // Auteur illisible : la décision ne devient pas « anonyme ».
      decision({ par: { genre: 'inconnu' } }),
      // Clé de piste ABSENTE : pas la même chose que « aucune piste » (null).
      decision({ propositionId: undefined }),
      decision({ justification: '   ' }),
      ev('council_closed', { sessionId: 's-1', issue: 'inventee' }),
      ev('contre_expertise_verdict', { taskId: 't-1', relecteur: 'codex', conteste: 'oui' }),
      ev('task_reviewed', { taskId: 't-1', state: 'peut-etre' }),
    ]);
    expect(fil).toEqual([]);
  });

  it('« AUCUNE PISTE » EST UNE DÉCISION, et le jeton de ruche est dit tel quel', () => {
    const [d] = entreesWarRoom([
      decision({ propositionId: null, titre: 'ignoré', par: { genre: 'jeton_de_ruche' } }),
    ]);
    expect(d).toMatchObject({
      genre: 'conseil_decide',
      propositionId: null,
      titre: null,
      par: { genre: 'jeton_de_ruche' },
    });
  });

  it('LE TEXTE D’AGENT EST RE-BORNÉ À LA LECTURE', () => {
    // Le journal n'est pas une zone de confiance : une objection de dix mille
    // caractères ne traverse pas jusqu'à l'écran.
    const [v] = entreesWarRoom([
      ev('contre_expertise_verdict', {
        taskId: 't-1',
        relecteur: 'codex',
        conteste: true,
        objections: ['x'.repeat(10_000), ...Array.from({ length: 20 }, (_, i) => `o${i}`)],
      }),
    ]);
    expect(v?.genre === 'contre_verdict' && v.objections[0]?.length).toBe(300);
    expect(v?.genre === 'contre_verdict' && v.objections.length).toBe(5);
  });

  it('L’ORDRE EST CELUI DU JOURNAL, pas celui des horloges', () => {
    const tard = ev('council_opened', { sessionId: 's-2' }, 1);
    const tot = ev('council_opened', { sessionId: 's-1' }, 999_999);
    expect(entreesWarRoom([tot, tard]).map((e) => e.id)).toEqual([tard.id, tot.id]);
  });

  it('LA DÉCISION LA PLUS RÉCENTE FAIT FOI — les précédentes restent au fil', () => {
    const fil = entreesWarRoom([
      decision({ propositionId: 'prop-a' }),
      decision({ propositionId: null, remplace: 1 }),
    ]);
    expect(fil).toHaveLength(2);
    expect(dernieresDecisions(fil).get('s-1')?.propositionId).toBeNull();
  });
});

describe('les désaccords en suspens', () => {
  it('UN CONSEIL SANS CONSENSUS, CLOS ET NON TRANCHÉ, ATTEND QUELQU’UN', () => {
    for (const issue of ['depart', 'epuise', 'sans_quorum']) {
      expect(desaccordsNonResolus([], [sessionClose({ issue })]), issue).toEqual([
        { genre: 'conseil', sessionId: 's-1', issue, depuis: 5_000 },
      ]);
    }
  });

  it('…mais pas un quorum, un conseil vide, ni un conseil qui délibère encore', () => {
    expect(desaccordsNonResolus([], [sessionClose({ issue: 'quorum' })])).toEqual([]);
    expect(desaccordsNonResolus([], [sessionClose({ issue: 'vide' })])).toEqual([]);
    expect(
      desaccordsNonResolus(
        [],
        [sessionClose({ etat: 'verification', closedAt: null, issue: null })],
      ),
    ).toEqual([]);
  });

  it('UNE DÉCISION HUMAINE LE TRANCHE — « aucune piste » comprise', () => {
    const fil = entreesWarRoom([decision({ propositionId: null })]);
    expect(desaccordsNonResolus(fil, [sessionClose()])).toEqual([]);
    // La décision d'un AUTRE conseil ne tranche pas celui-ci.
    const ailleurs = entreesWarRoom([decision({ sessionId: 's-9' })]);
    expect(desaccordsNonResolus(ailleurs, [sessionClose()])).toHaveLength(1);
  });

  it('UNE CONTESTATION DONT LE RENVOI N’A PAS EU LIEU ATTEND QUELQU’UN, objections comprises', () => {
    const fil = entreesWarRoom([
      ev('contre_expertise_verdict', {
        taskId: 't-1',
        resultId: 8,
        relecteur: 'codex',
        conteste: true,
        objections: ['le cas vide n’est pas traité'],
      }),
      // Un avis d'une AUTRE production ne se mélange pas à celle-ci.
      ev('contre_expertise_verdict', {
        taskId: 't-1',
        resultId: 7,
        relecteur: 'codex',
        conteste: true,
        objections: ['objection d’une production précédente'],
      }),
      ev('evaluator_retry_skipped', { taskId: 't-1', resultId: 8, reason: 'attempts_exhausted' }),
    ]);
    const [d] = desaccordsNonResolus(fil, []);
    expect(d).toMatchObject({
      genre: 'tache',
      taskId: 't-1',
      resultId: 8,
      raison: 'attempts_exhausted',
      objections: ['le cas vide n’est pas traité'],
    });
  });

  it('LES TROIS REFUS QUI LAISSENT L’OBJECTION EN PLACE — et pas les autres', () => {
    const suspens = (reason: string) =>
      desaccordsNonResolus(
        entreesWarRoom([ev('evaluator_retry_skipped', { taskId: 't-1', resultId: 8, reason })]),
        [],
      ).length;
    expect(suspens('attempts_exhausted')).toBe(1);
    expect(suspens('delivery_exists')).toBe(1);
    expect(suspens('dependent_progressed')).toBe(1);
    // Une production plus récente existe : la contestation est caduque.
    expect(suspens('stale_result')).toBe(0);
    expect(suspens('task_not_done')).toBe(0);
  });

  it('UNE REVUE HUMAINE QUI POSE UN VERDICT LA TRANCHE — l’effacer, non', () => {
    const refus = ev('evaluator_retry_skipped', {
      taskId: 't-1',
      resultId: 8,
      reason: 'attempts_exhausted',
    });
    const efface = entreesWarRoom([refus, ev('task_reviewed', { taskId: 't-1', state: null })]);
    expect(desaccordsNonResolus(efface, [])).toHaveLength(1);
    for (const state of ['approved', 'rejected']) {
      const tranche = entreesWarRoom([refus, ev('task_reviewed', { taskId: 't-1', state })]);
      expect(desaccordsNonResolus(tranche, []), state).toEqual([]);
    }
  });

  it('UNE REVUE ANTÉRIEURE AU REFUS NE LE TRANCHE PAS', () => {
    // L'ordre compte : approuver la production PUIS voir la contre-revue la
    // contester n'est pas avoir tranché la contestation.
    const fil = entreesWarRoom([
      ev('task_reviewed', { taskId: 't-1', state: 'approved' }),
      ev('evaluator_retry_skipped', { taskId: 't-1', resultId: 8, reason: 'delivery_exists' }),
    ]);
    expect(desaccordsNonResolus(fil, [])).toHaveLength(1);
  });

  it('UN NOUVEL ESSAI REND LA CONTESTATION CADUQUE', () => {
    const refus = ev('evaluator_retry_skipped', {
      taskId: 't-1',
      resultId: 8,
      reason: 'attempts_exhausted',
    });
    const renvoi = ev('task_retry', {
      taskId: 't-1',
      source: 'evaluator',
      resultId: 8,
      decision: 'rejected',
    });
    const relance = ev('contre_expertise', { taskId: 't-1', resultId: 9, possible: true });
    expect(desaccordsNonResolus(entreesWarRoom([refus, renvoi]), [])).toEqual([]);
    expect(desaccordsNonResolus(entreesWarRoom([refus, relance]), [])).toEqual([]);
  });

  it('LES FAITS RANGÉS TRANCHENT AUSSI — le journal élagué a pu perdre la revue ou le nouvel essai', () => {
    // Le refus survit à l'élagage (pruneEvents le garde), pas forcément ce
    // qui l'a levé : sans les tables rangées, une contestation tranchée il y
    // a une semaine redeviendrait « à trancher ».
    const fil = entreesWarRoom([
      ev(
        'evaluator_retry_skipped',
        { taskId: 't-1', resultId: 8, reason: 'attempts_exhausted' },
        5_000,
      ),
    ]);
    const avec = (rangee: TacheRangee | null): number =>
      desaccordsNonResolus(fil, [], new Map(), () => rangee).length;
    expect(avec({ dernierResultId: 8, revueA: null }), 'rien ne l’a levée').toBe(1);
    expect(avec({ dernierResultId: 8, revueA: 6_000 }), 'verdict humain après le refus').toBe(0);
    expect(avec({ dernierResultId: 8, revueA: 4_000 }), 'verdict antérieur au refus').toBe(1);
    expect(avec({ dernierResultId: 9, revueA: null }), 'une production plus récente').toBe(0);
    // Une tâche que la Reine ne connaît plus ne se revoit plus : elle
    // n'attendrait personne, pour toujours.
    expect(avec(null), 'tâche disparue').toBe(0);
  });

  it('UN REJET HUMAIN SANS CORRECTION N’EST PAS À TRANCHER — un refus sans source, si', () => {
    const refus = (source?: string) =>
      desaccordsNonResolus(
        entreesWarRoom([
          ev('task_reviewed', { taskId: 't-1', state: 'rejected' }),
          ev('evaluator_retry_skipped', {
            taskId: 't-1',
            resultId: 8,
            reason: 'attempts_exhausted',
            ...(source ? { source } : {}),
          }),
        ]),
        [],
      ).length;
    expect(refus('revue_humaine'), 'l’humain a déjà tranché').toBe(0);
    expect(refus('contre_revue')).toBe(1);
    // Journal antérieur à la `source` : inconnu, donc montré plutôt que tu.
    expect(refus()).toBe(1);
  });

  it('UNE RELECTURE IMPOSSIBLE ATTEND LA REVUE HUMAINE QU’ELLE DEMANDE', () => {
    const impossible = ev(
      'contre_expertise_impossible',
      { taskId: 't-1', resultId: 8, relecteur: 'codex', cause: 'plus aucune famille' },
      5_000,
    );
    expect(desaccordsNonResolus(entreesWarRoom([impossible]), [])).toEqual([
      {
        genre: 'relecture_impossible',
        taskId: 't-1',
        resultId: 8,
        cause: 'plus aucune famille',
        depuis: 5_000,
      },
    ]);
    // Une revue humaine qui pose un verdict la lève ; un nouvel essai aussi.
    for (const apres of [
      ev('task_reviewed', { taskId: 't-1', state: 'approved' }),
      ev('task_retry', { taskId: 't-1', source: 'evaluator', resultId: 8, decision: 'rejected' }),
    ]) {
      expect(desaccordsNonResolus(entreesWarRoom([impossible, apres]), [])).toEqual([]);
    }
    // Faits rangés : un verdict COURANT tranche, même posé pendant la relecture.
    const avec = (rangee: TacheRangee | null): number =>
      desaccordsNonResolus(entreesWarRoom([impossible]), [], new Map(), () => rangee).length;
    expect(avec({ dernierResultId: 8, revueA: null })).toBe(1);
    expect(avec({ dernierResultId: 8, revueA: 4_000 }), 'verdict posé avant').toBe(0);
    expect(avec({ dernierResultId: 9, revueA: null }), 'production plus récente').toBe(0);
    expect(avec(null), 'tâche disparue').toBe(0);
  });

  it('LE PLUS ANCIEN D’ABORD : celui qui attend depuis le plus longtemps', () => {
    const fil = entreesWarRoom([
      ev(
        'evaluator_retry_skipped',
        { taskId: 't-1', resultId: 8, reason: 'attempts_exhausted' },
        9_000,
      ),
    ]);
    const d = desaccordsNonResolus(fil, [sessionClose({ closedAt: 2_000 })]);
    expect(d.map((x) => x.genre)).toEqual(['conseil', 'tache']);
  });
});
