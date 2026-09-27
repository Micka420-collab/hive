// LA CONCLUSION DE LA PREUVE V2 ALPHA — ce qui fait sortir en 0.
//
// Le code de sortie est la seule chose qu'une machine lit. Il doit donc
// porter chaque exigence que l'opérateur a posée (`--exige-bac`, `--depot`,
// `--workers`) — et aucune qu'il n'a pas posée.

import { describe, expect, it } from 'vitest';
import { conclurePreuve } from '../scripts/preuve-v2-alpha-rapport.mjs';

const DIFF = '--- /dev/null\n+++ b/somme.mjs\n@@ -0,0 +1 @@\n+export const somme = 1;\n';
const PODMAN = { niveau: 'conteneur', fournisseur: 'podman' };

/** Les faits d'une tâche réussie par `noeud`, attendus sous `attendu`. */
const faits = (noeud, attendu = /somme/) => ({
  noeud,
  executants: [noeud],
  tache: { id: 't', status: 'done' },
  resultats: [{ nodeId: noeud.id, success: true, diff: DIFF }],
  attendu,
});

const mission = (noeud) => ({
  ok: true,
  mode: 'mission',
  taskId: 't1',
  faits: faits(noeud),
  livraisons: null,
});
const POSTE = { id: 'n1', name: 'poste', agentType: 'claude-code', isolement: PODMAN };

describe('preuve V2 Alpha — la conclusion', () => {
  it('UNE MISSION : AGENT ET DIFF SUFFISENT, SAUF SI L’OPÉRATEUR EXIGE LE BAC', () => {
    const horsBac = { ...POSTE, isolement: { niveau: 'processus' } };
    expect(conclurePreuve(mission(horsBac)).prouve).toBe(true);

    const exige = conclurePreuve(mission(horsBac), { exigeBac: true });
    expect(exige.prouve).toBe(false);
    expect(exige.texte).toContain(
      '✘ Mission réelle NON prouvée — exigés : A-agent, A-diff, A-bac.',
    );
    expect(conclurePreuve(mission(POSTE), { exigeBac: true }).prouve).toBe(true);
  });

  it('UNE PRODUCTION CONTESTÉE DONT LA REPRISE A ÉCHOUÉ NE SORT PAS EN 0 — la Reine ne la garde plus', () => {
    const reprise = mission(POSTE);
    reprise.faits = {
      ...reprise.faits,
      tache: { id: 't1', status: 'failed' },
      resultats: [
        { nodeId: 'n1', success: true, diff: DIFF },
        { nodeId: 'n1', success: false, diff: '' },
      ],
      evaluation: { decision: 'rejected', evidence: {} },
    };
    const r = conclurePreuve(reprise, { exigeBac: true });

    expect(r.prouve).toBe(false);
    expect(r.texte).toMatch(
      /✘ A-diff\s+Travail produit — dernière tentative échouée \(tâche failed\)/,
    );
    expect(r.texte).not.toContain('✔ Mission réelle prouvée');
  });

  it('SOUS --depot, UNE LIVRAISON RATÉE FAIT ÉCHOUER LA PREUVE — sans, la ligne reste inconnue', () => {
    const sansDepot = conclurePreuve(mission(POSTE));
    expect(sansDepot.texte).toMatch(/\? Git\s+Livraison Git — sans --depot/);

    const ratee = { ...mission(POSTE), livraisons: [{ taskId: 't1', status: 503, corps: null }] };
    const r = conclurePreuve(ratee, { depot: 'https://github.com/demo/hive.git' });
    expect(r.prouve).toBe(false);
    expect(r.texte).toContain('exigés : A-agent, A-diff, Git.');

    const livree = {
      ...mission(POSTE),
      livraisons: [
        { taskId: 't1', status: 201, corps: { pr: 3, branche: 'hive/t1', commitSha: 'c0ffee1' } },
      ],
    };
    expect(conclurePreuve(livree, { depot: 'https://github.com/demo/hive.git' }).prouve).toBe(true);
  });

  it('UN ESSAIM EXIGE CHAQUE TÂCHE ET CHAQUE CRITÈRE D’ESSAIM — une seule tâche ratée suffit à refuser', () => {
    const noeuds = [
      { id: 'a', name: 'alpha', agentType: 'claude-code', isolement: PODMAN },
      { id: 'b', name: 'beta', agentType: 'codex', isolement: PODMAN },
      { id: 'c', name: 'gamma', agentType: 'claude-code', isolement: PODMAN },
    ];
    const ev = (id, type, payload, ts = id * 100) => ({ id, ts, type, payload });
    const essaim = {
      requis: 3,
      noeuds,
      taches: [
        { id: 't1', status: 'done' },
        { id: 't2', status: 'done' },
        { id: 't3', status: 'done' },
        { id: 'enfant', status: 'done' },
      ],
      productions: ['t1', 't2', 't3', 'enfant'],
      independantes: ['t1', 't3'],
      deleguante: 't2',
      evenements: [
        ev(1, 'task_started', { taskId: 't1', nodeId: 'a' }),
        ev(2, 'task_started', { taskId: 't2', nodeId: 'b' }),
        ev(3, 'task_started', { taskId: 't3', nodeId: 'c' }),
        ev(4, 'delegation_created', { parentTaskId: 't2', childTaskId: 'enfant' }),
        ev(5, 'task_done', { taskId: 't3', nodeId: 'c' }),
        ev(6, 'task_started', { taskId: 'enfant', nodeId: 'c' }),
        ev(7, 'task_done', { taskId: 'enfant', nodeId: 'c' }),
        ev(8, 'task_done', { taskId: 't1', nodeId: 'a' }),
        ev(9, 'task_done', { taskId: 't2', nodeId: 'b' }),
        ev(10, 'task_done', { taskId: 'r1', nodeId: 'b' }),
        ev(11, 'contre_expertise_verdict', {
          source: 'hive_counter_review',
          taskId: 't1',
          relecture: 'r1',
          relecteur: 'codex',
          producteur: 'claude-code',
          conteste: false,
        }),
      ],
    };
    const issue = {
      ok: true,
      mode: 'essaim',
      projetId: 'p1',
      missions: [
        { taskId: 't1', titre: 'ajoute1', faits: faits(noeuds[0]) },
        { taskId: 't2', titre: 'délégation', faits: faits(noeuds[1]) },
        { taskId: 't3', titre: 'ajoute2', faits: faits(noeuds[2]) },
      ],
      essaim,
      livraisons: null,
    };

    const r = conclurePreuve(issue, { exigeBac: true });
    expect(r.texte, r.texte).toContain('✔ Essaim prouvé');
    expect(r.texte).toContain('Tâche t1 — ajoute1');
    expect(r.texte).toMatch(/\n\? Reprise\s+Reprise après objection/);
    expect(r.prouve).toBe(true);

    // La tâche qui délègue a rendu autre chose que ce qui était demandé.
    const [ajoute1, deleguante, ajoute2] = issue.missions;
    const horsSujet = {
      ...issue,
      missions: [
        ajoute1,
        { ...deleguante, faits: { ...deleguante.faits, attendu: /delegation-/ } },
        ajoute2,
      ],
    };
    const refus = conclurePreuve(horsSujet, { exigeBac: true });
    expect(refus.prouve).toBe(false);
    expect(refus.texte).toContain(
      '✘ Essaim NON prouvé — exigés : A-agent, A-diff, A-bac de chaque tâche, Ouvrières, Parallèle, Délégation, Relecture.',
    );
  });
});
