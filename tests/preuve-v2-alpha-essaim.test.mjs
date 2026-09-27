// LE VERDICT DE L'ESSAIM — chaque critère à plusieurs, de ses trois côtés.
//
// Un essaim « prouvé » sur des ouvrières seulement EN LIGNE, sur des tâches
// qui se sont succédé, ou sur une relecture par la même famille, serait
// exactement la preuve par accident que ce verdict existe pour refuser.

import { describe, expect, it } from 'vitest';
import {
  essaimProuve,
  fenetresDe,
  jugerEssaim,
  simultaneiteMax,
} from '../scripts/preuve-v2-alpha-essaim.mjs';

const ev = (id, type, payload, ts = id * 100) => ({ id, ts, type, payload });

const NOEUDS = [
  { id: 'a', name: 'alpha', agentType: 'claude-code' },
  { id: 'b', name: 'beta', agentType: 'codex' },
  { id: 'c', name: 'gamma', agentType: 'claude-code' },
  { id: 's', name: 'banc', agentType: 'shell' },
];

/**
 * Un essaim complet : t1..t3 en parallèle sur a, b, c ; t4 délègue `enfant`
 * à b ; t1 contesté par codex puis repris ; chaque production relue par
 * l'autre famille.
 */
const complet = () => ({
  requis: 3,
  noeuds: NOEUDS,
  taches: [
    { id: 't1', title: 'Preuve V2 Alpha — ajoute1', status: 'done' },
    { id: 't2', title: 'Preuve V2 Alpha — ajoute2', status: 'done' },
    { id: 't3', title: 'Preuve V2 Alpha — ajoute3', status: 'done' },
    { id: 't4', title: 'Preuve V2 Alpha — délégation', status: 'done' },
    { id: 'enfant', title: 'Preuve V2 Alpha — double', status: 'done' },
  ],
  productions: ['t1', 't2', 't3', 't4', 'enfant'],
  evenements: [
    ev(1, 'task_started', { taskId: 't1', nodeId: 'a' }, 1_000),
    ev(2, 'task_started', { taskId: 't2', nodeId: 'b' }, 1_100),
    ev(3, 'task_started', { taskId: 't3', nodeId: 'c' }, 1_200),
    ev(4, 'task_started', { taskId: 't4', nodeId: 'a' }, 1_300),
    ev(5, 'delegation_created', { parentTaskId: 't4', childTaskId: 'enfant' }, 1_400),
    ev(6, 'task_started', { taskId: 'enfant', nodeId: 'b' }, 1_500),
    ev(7, 'task_done', { taskId: 't1', nodeId: 'a' }, 2_000),
    ev(8, 'contre_expertise', { taskId: 't1', resultId: 1, possible: true, relectures: ['r1'] }),
    ev(9, 'task_done', { taskId: 't2', nodeId: 'b' }, 2_100),
    ev(10, 'task_done', { taskId: 't3', nodeId: 'c' }, 2_200),
    ev(11, 'task_done', { taskId: 'enfant', nodeId: 'b' }, 2_300),
    ev(12, 'task_done', { taskId: 't4', nodeId: 'a' }, 2_400),
    ev(13, 'task_done', { taskId: 'r1', nodeId: 'b' }, 2_500),
    ev(14, 'contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId: 't1',
      resultId: 1,
      relecture: 'r1',
      relecteur: 'codex',
      producteur: 'claude-code',
      conteste: true,
      objections: ['ajoute un test du cas négatif'],
    }),
    ev(15, 'task_retry', {
      taskId: 't1',
      source: 'evaluator',
      resultId: 1,
      attempt: 1,
      maxAttempts: 3,
    }),
    ev(16, 'contre_expertise', { taskId: 't2', resultId: 2, possible: true, relectures: ['r2'] }),
    ev(17, 'task_done', { taskId: 'r2', nodeId: 'c' }, 2_600),
    ev(18, 'contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId: 't2',
      resultId: 2,
      relecture: 'r2',
      relecteur: 'claude-code',
      producteur: 'codex',
      conteste: false,
      objections: [],
    }),
  ],
});

const etat = (verdicts, critere) => verdicts.find((v) => v.critere === critere);

describe('preuve V2 Alpha — le verdict de l’essaim', () => {
  it('UN ESSAIM COMPLET PROUVE CHAQUE CRITÈRE — et dit d’où vient chaque fait', () => {
    const v = jugerEssaim(complet());

    expect(v.map((x) => [x.critere, x.etat])).toEqual([
      ['Ouvrières', 'prouve'],
      ['Parallèle', 'prouve'],
      ['Délégation', 'prouve'],
      ['Relecture', 'prouve'],
      ['Reprise', 'prouve'],
    ]);
    expect(etat(v, 'Ouvrières').detail).toBe(
      '3 ouvrière(s) réelle(s) de 2 famille(s) ont rendu du travail : alpha (claude-code), beta (codex), gamma (claude-code)',
    );
    expect(etat(v, 'Parallèle').detail).toContain('jusqu’à 3 ouvrières en même temps');
    expect(etat(v, 'Délégation').detail).toBe(
      '« Preuve V2 Alpha — délégation » → enfant, rendue par beta (codex)',
    );
    expect(etat(v, 'Relecture').detail).toBe(
      'codex relit claude-code ×1, claude-code relit codex ×1',
    );
    expect(etat(v, 'Reprise').detail).toContain(
      '« Preuve V2 Alpha — ajoute1 » reprise après l’objection « ajoute un test du cas négatif » (essai 1/3)',
    );
    expect(etat(v, 'Reprise').detail, 'la transmission n’est pas prétendue').toContain(
      'n’est pas consignée',
    );
    expect(essaimProuve(v)).toBe(true);
  });

  it('ÊTRE EN LIGNE NE COMPTE PAS — seules les ouvrières qui ONT RENDU, et pas la simulation', () => {
    const f = complet();
    // gamma n'a rien rendu ; le banc « shell » a rendu, mais c'est une simulation.
    f.evenements = f.evenements.map((e) =>
      e.type === 'task_done' && e.payload.nodeId === 'c'
        ? { ...e, payload: { ...e.payload, nodeId: 's' } }
        : e,
    );
    expect(etat(jugerEssaim(f), 'Ouvrières')).toMatchObject({
      etat: 'echec',
      detail: expect.stringContaining('2 ouvrière(s) réelle(s) de 2 famille(s)'),
    });

    const uneFamille = complet();
    uneFamille.noeuds = NOEUDS.map((n) => ({ ...n, agentType: 'claude-code' }));
    expect(etat(jugerEssaim(uneFamille), 'Ouvrières').etat).toBe('echec');
    expect(essaimProuve(jugerEssaim(uneFamille))).toBe(false);
  });

  it('DES TÂCHES QUI SE SUCCÈDENT NE SONT PAS DU PARALLÉLISME — même sur plusieurs ouvrières', () => {
    const fenetres = [
      { taskId: 't1', nodeId: 'a', debut: 0, fin: 10 },
      { taskId: 't2', nodeId: 'b', debut: 10, fin: 20 },
      // Deux tâches du MÊME nœud à la fois ne font pas deux ouvrières.
      { taskId: 't3', nodeId: 'c', debut: 30, fin: 40 },
      { taskId: 't4', nodeId: 'c', debut: 35, fin: 45 },
    ];
    expect(simultaneiteMax(fenetres)).toBe(1);
    expect(simultaneiteMax([...fenetres, { taskId: 't5', nodeId: 'a', debut: 39, fin: 50 }])).toBe(
      2,
    );

    const f = complet();
    f.evenements = [
      ev(1, 'task_started', { taskId: 't1', nodeId: 'a' }, 1_000),
      ev(2, 'task_done', { taskId: 't1', nodeId: 'a' }, 2_000),
      ev(3, 'task_started', { taskId: 't2', nodeId: 'b' }, 2_000),
      ev(4, 'task_done', { taskId: 't2', nodeId: 'b' }, 3_000),
    ];
    expect(etat(jugerEssaim(f), 'Parallèle').etat).toBe('echec');
    f.evenements = f.evenements.slice(0, 2);
    expect(etat(jugerEssaim(f), 'Parallèle').etat).toBe('inconnu');
  });

  it('UNE EXÉCUTION SANS FIN CONSIGNÉE N’EST PAS MESURÉE — plutôt que de chevaucher tout ce qui suit', () => {
    expect(
      fenetresDe(
        ['t1', 't2'],
        [
          ev(1, 'task_started', { taskId: 't1', nodeId: 'a' }),
          ev(2, 'task_started', { taskId: 't2', nodeId: 'b' }),
          ev(3, 'task_requeued', { taskId: 't2', nodeId: 'b' }),
          ev(4, 'task_started', { taskId: 'autre', nodeId: 'c' }),
        ],
      ),
    ).toEqual([{ taskId: 't2', nodeId: 'b', debut: 200, fin: 300 }]);
  });

  it('SANS ARÊTE, OU AVEC UNE SOUS-TÂCHE JAMAIS RENDUE, IL N’Y A PAS DE DÉLÉGATION', () => {
    const sans = complet();
    sans.evenements = sans.evenements.filter((e) => e.type !== 'delegation_created');
    expect(etat(jugerEssaim(sans), 'Délégation')).toMatchObject({
      etat: 'echec',
      detail: 'aucune sous-tâche créée : l’agent n’a pas appelé l’outil de délégation',
    });

    sans.evenements.push(
      ev(40, 'delegation_rejected', {
        parentTaskId: 't4',
        code: 'duree',
        message: 'budget temps invalide',
      }),
    );
    expect(etat(jugerEssaim(sans), 'Délégation').detail).toBe(
      'délégation refusée par la Reine : duree — budget temps invalide',
    );

    const echouee = complet();
    echouee.taches = echouee.taches.map((t) =>
      t.id === 'enfant' ? { ...t, status: 'failed' } : t,
    );
    expect(etat(jugerEssaim(echouee), 'Délégation')).toMatchObject({
      etat: 'echec',
      detail: 'sous-tâche enfant failed, jamais rendue',
    });
  });

  it('LA FAMILLE D’UNE RELECTURE EST CELLE DU NŒUD QUI L’A RENDUE — pas celle que le verdict nomme', () => {
    // Remises en file, les deux relectures ont été rendues par la famille du
    // producteur, alors que chaque verdict nomme encore le relecteur choisi au
    // lancement : ce ne sont pas des relectures croisées.
    const detournee = complet();
    detournee.evenements = detournee.evenements.map((e) => {
      if (e.type !== 'task_done') return e;
      if (e.payload.taskId === 'r1') return { ...e, payload: { ...e.payload, nodeId: 'c' } };
      if (e.payload.taskId === 'r2') return { ...e, payload: { ...e.payload, nodeId: 'b' } };
      return e;
    });
    expect(etat(jugerEssaim(detournee), 'Relecture')).toMatchObject({
      etat: 'echec',
      detail: 'aucun avis rendu par un nœud d’une autre famille que le producteur',
    });
    expect(essaimProuve(jugerEssaim(detournee))).toBe(false);

    // Une relecture dont personne n'a consigné le rendu ne compte pas non plus.
    const sansRendu = complet();
    sansRendu.evenements = sansRendu.evenements.filter(
      (e) => !(e.type === 'task_done' && e.payload.taskId.startsWith('r')),
    );
    expect(etat(jugerEssaim(sansRendu), 'Relecture').etat).toBe('echec');
  });

  it('SANS AVIS RENDU, IL N’Y A PAS DE RELECTURE CROISÉE — et la ligne dit pourquoi', () => {
    const seule = complet();
    seule.evenements = [
      ev(1, 'contre_expertise', { taskId: 't1', possible: false, motif: 'aucun second modèle' }),
    ];
    expect(etat(jugerEssaim(seule), 'Relecture').detail).toBe(
      'aucun modèle d’une autre famille en ligne pour relire',
    );
    seule.evenements = [ev(1, 'contre_expertise_review_failed', { taskId: 't1', terminal: true })];
    expect(etat(jugerEssaim(seule), 'Relecture').detail).toBe(
      'relectures lancées, aucune n’a rendu d’avis',
    );
  });

  it('SANS OBJECTION, LA REPRISE EST INCONNUE ; UNE OBJECTION RESTÉE SANS REPRISE EST UN ÉCHEC', () => {
    const sansObjection = complet();
    sansObjection.evenements = sansObjection.evenements.filter(
      (e) => !(e.type === 'contre_expertise_verdict' && e.payload.conteste),
    );
    const v = jugerEssaim(sansObjection);
    expect(etat(v, 'Reprise')).toMatchObject({
      etat: 'inconnu',
      detail: 'aucune objection levée : rien à reprendre',
    });
    // Une objection ne se provoque pas : son absence ne fait pas échouer l'essaim.
    expect(essaimProuve(v)).toBe(true);

    const refusee = complet();
    refusee.evenements = refusee.evenements.map((e) =>
      e.type === 'task_retry'
        ? ev(e.id, 'evaluator_retry_skipped', {
            taskId: 't1',
            resultId: 1,
            reason: 'attempts_exhausted',
          })
        : e,
    );
    expect(etat(jugerEssaim(refusee), 'Reprise')).toMatchObject({
      etat: 'echec',
      detail: 'objection sans reprise — Preuve V2 Alpha — ajoute1 : attempts_exhausted',
    });

    const muette = complet();
    muette.evenements = muette.evenements.filter((e) => e.type !== 'task_retry');
    expect(etat(jugerEssaim(muette), 'Reprise').detail).toBe(
      'objection sans reprise — Preuve V2 Alpha — ajoute1 : aucun retry',
    );
  });
});
