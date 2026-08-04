// L'AGENT GARDE-FOUS CÂBLÉ DANS L'ORDONNANCEUR (boucle principale, lot G4a).
//
// Ce que ce banc protège : sur un projet OPT-IN, la ruche élit un échelon de
// garde-fous DANS les bornes de l'humain, le POSE à l'assignation, et la sévérité
// des Gardiennes de la production suit CET échelon — pas le seul mode global.
// Sur un projet non opt-in, RIEN ne change : aucun échelon posé, mode global.
//
// L'apprentissage est GLOBAL (le vécu de toute la ruche, motif de l'Aiguillage),
// la gouvernance est PAR PROJET (l'opt-in et les bornes). Un apprentissage par
// projet n'aurait presque jamais assez de verdicts pour sortir du « fermé par
// défaut » — c'est la raison même de l'échelle à trois échelons.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { Echelon } from '../src/orchestrator/garde-fou.js';
import type { Verdict } from '../src/orchestrator/gardiennes.js';

const profile = (name: string) => ({
  name,
  ownerName: 'test',
  agentType: 'shell',
  maxConcurrency: 1,
});

describe('Garde-Fous câblé — la boucle principale de l’ordonnanceur', () => {
  let store: HiveStore;
  let scheduler: Scheduler;

  beforeEach(() => {
    store = new HiveStore(':memory:');
    scheduler = new Scheduler(store, {});
  });
  afterEach(() => store.close());

  /** Un projet, opt-in Garde-Fous si des bornes sont données. */
  function projet(bornes?: { min: Echelon; max: Echelon }, repoUrl: string | null = null): string {
    const p = store.createProject({ name: 'P', repoUrl, ownerId: null });
    if (bornes) {
      store.setGardeFou(
        p.id,
        { actif: true, borneMin: bornes.min, borneMax: bornes.max },
        'humain',
      );
    }
    return p.id;
  }

  /** Une tâche prête pour un projet donné. */
  function tache(projectId: string, titre = 'Ajoute un endpoint'): string {
    return store.createTask({ projectId, title: titre, prompt: 'implémente' }).id;
  }

  /**
   * Fabrique du VÉCU GLOBAL : `n` productions sous `echelon`, jugées `verdict`,
   * l'exigence posée (donc TRANCHÉES → repliables), puis rangées `done`. C'est ce
   * que `observationsGardeFou` relit — sans filtre de projet, tout compte.
   */
  function vecu(echelon: Echelon, verdict: Verdict, exigee: boolean, n: number): void {
    const p = store.createProject({ name: 'vecu', repoUrl: null, ownerId: null });
    for (let i = 0; i < n; i++) {
      const t = store.createTask({ projectId: p.id, title: 'x', prompt: 'y' }).id;
      store.poserEchelonGardeFou(t, echelon, 1_000 + i);
      store.enregistrerInspection({
        resultId: i + 1,
        taskId: t,
        nodeId: 'v',
        verdict,
        score: 0,
        applique: false,
        griefs: [],
      });
      store.poserExigenceGardeFou(t, exigee);
      store.patchTask(t, { status: 'done' });
    }
  }

  it('projet NON opt-in : aucun échelon posé — la ruche est indiscernable d’avant', () => {
    scheduler.registerNode(profile('aaa'));
    const t = tache(projet());
    scheduler.tick(5_000);
    expect(store.getTask(t)?.status).toBe('assigned');
    expect(store.getEchelonGardeFou(t), 'rien n’est posé sans opt-in').toBeNull();
  });

  it('projet opt-in à froid : élit et POSE le plus strict permis (fermé par défaut)', () => {
    scheduler.registerNode(profile('aaa'));
    // Aucun vécu : les trois échelons sont à +∞, le départage prend le plus strict.
    const t = tache(projet({ min: 'leger', max: 'strict' }));
    scheduler.tick(5_000);
    expect(store.getEchelonGardeFou(t)).toBe('strict');
  });

  it('avec du vécu, élit l’échelon au meilleur COMPROMIS — appris globalement', () => {
    // leger : propre + dispensé (directe) → récompense 1 ; standard : propre mais
    // retenu-relâché n'existe pas ici, on le fait médiocre ; strict : creux → 0.
    // Les trois ont des essais (plus de +∞), donc la MOYENNE tranche → leger.
    vecu('leger', 'clean', false, 12); // directe, q=1 → r=1
    vecu('standard', 'suspect', true, 12); // en_attente, q=2/3,f=0 → r=4/9
    vecu('strict', 'hollow', true, 12); // en_attente, q=0 → r=0
    scheduler.registerNode(profile('aaa'));
    const t = tache(projet({ min: 'leger', max: 'strict' }));
    scheduler.tick(5_000);
    expect(store.getEchelonGardeFou(t)).toBe('leger');
  });

  it('n’élit JAMAIS hors des bornes — même quand le hors-bornes serait le meilleur', () => {
    // strict est de loin le meilleur, mais les bornes l'excluent. On reste dans
    // ce que l'humain a consenti ; entre deux permis nuls, le plus strict permis.
    vecu('strict', 'clean', false, 12); // r=1, le meilleur
    vecu('standard', 'hollow', true, 12); // r=0
    vecu('leger', 'hollow', true, 12); // r=0
    scheduler.registerNode(profile('aaa'));
    const t = tache(projet({ min: 'leger', max: 'standard' }));
    scheduler.tick(5_000);
    const elu = store.getEchelonGardeFou(t);
    expect(elu).toBe('standard');
    expect(elu).not.toBe('strict');
  });

  it('le REFUS suit l’échelon du projet, pas le seul mode global', () => {
    // Mode global par défaut = consultatif (ne refuse rien). Deux nœuds, pour que
    // la tâche opt-in (refusée puis relancée) ne prive pas le témoin de capacité.
    scheduler.registerNode(profile('aaa'));
    scheduler.registerNode(profile('bbb'));
    // Un succès à DIFF VIDE sur un dépôt git → verdict creux (hollow) ; on l'envoie
    // au nœud RÉELLEMENT assigné (lu du store), jamais deviné.
    const creux = (taskId: string) => {
      const node = store.getTask(taskId)?.assignedNodeId;
      expect(node, `la tâche ${taskId} est assignée`).toBeTruthy();
      scheduler.handleTaskResult(node as string, {
        taskId,
        success: true,
        diff: '',
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
    };

    // Projet opt-in gouverné en « strict » (fermé par défaut) → REFUSE le creux.
    const tOpt = tache(projet({ min: 'strict', max: 'strict' }, 'https://x/r.git'), 'tache-opt');
    // Témoin : projet NON opt-in, MÊME scheduler global-consultatif → ne refuse pas.
    const tLibre = tache(projet(undefined, 'https://x/r2.git'), 'tache-libre');
    scheduler.tick(5_000);

    creux(tOpt);
    creux(tLibre);
    expect(store.getTask(tOpt)?.status, 'creux REFUSÉ sous strict → pas done').not.toBe('done');
    expect(store.getTask(tLibre)?.status, 'sans opt-in, le global consultatif ne refuse pas').toBe(
      'done',
    );
  });

  it('un projet opt-in FAIT INSPECTER même sous une ruche globalement « off »', () => {
    // La porte `renifler` suit aussi l'échelon : sous un hive global « off » (qui
    // n'inspecte rien), un projet opt-in en « strict » DOIT quand même faire
    // renifler sa production — sans quoi le Garde-Fous n'aurait aucun verdict à juger.
    const off = new Scheduler(store, { gardiennes: { mode: 'off' } });
    const n = off.registerNode(profile('aaa'));
    off.registerNode(profile('bbb')); // deux nœuds : les deux tâches s'assignent
    const tOpt = tache(projet({ min: 'strict', max: 'strict' }, 'https://x/r.git'), 'opt');
    const tLibre = tache(projet(undefined, 'https://x/r.git'), 'libre');
    off.tick(5_000);
    const envoyer = (taskId: string) =>
      off.handleTaskResult(store.getTask(taskId)?.assignedNodeId ?? n.id, {
        taskId,
        success: true,
        diff: '',
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
    envoyer(tOpt);
    envoyer(tLibre);
    const inspectees = store.listInspections().map((i) => i.taskId);
    expect(inspectees, 'l’opt-in est inspecté malgré le global off').toContain(tOpt);
    expect(inspectees, 'le non-opt-in suit le global off : pas d’inspection').not.toContain(tLibre);
  });
});
