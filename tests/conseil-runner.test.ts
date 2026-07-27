// Un conseil complet, de bout en bout, avec des ouvrières simulées.
//
// Les tests de `conseil.test.ts` prouvent que le PROTOCOLE est juste. Ceux-ci
// prouvent qu'il TOURNE : que les tâches partent, que ce qui revient est
// dépouillé une seule fois, que les tours s'enchaînent, et surtout qu'une
// session finit TOUJOURS par se clore — une session ouverte pour toujours
// continuerait à créer des tâches, donc à brûler du temps-ouvrière réel.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOURS_MAX } from '../src/orchestrator/conseil.js';
import {
  VERIFICATRICES_PAR_PROPOSITION,
  avancerConseil,
  ouvrirConseil,
} from '../src/orchestrator/conseil-runner.js';
import type { DependancesConseil, ResultatOuvriere } from '../src/orchestrator/conseil-runner.js';
import { HiveStore } from '../src/orchestrator/store.js';

let store: HiveStore;
let dir: string;
let projectId: string;
let evenements: { type: string; payload: Record<string, unknown> }[];
let dep: DependancesConseil;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-conseil-'));
  store = new HiveStore(path.join(dir, 'c.db'));
  projectId = store.createProject({ name: 'Projet' }).id;
  evenements = [];
  dep = {
    store,
    creerTache: (i) =>
      store.createTask({ projectId: i.projectId, title: i.title, prompt: i.prompt }),
    emettre: (type, payload) => evenements.push({ type, payload }),
  };
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** Sortie d'une éclaireuse qui propose quelque chose. */
function propose(titre: string, qualite = 8): string {
  return `Analyse…\nHIVE_PROPOSITION ${JSON.stringify({ titre, corps: `corps de ${titre}`, qualite, sources: [] })}`;
}

/** Sortie d'une vérificatrice. */
function juge(type: 'soutien' | 'arret', force = 8): string {
  return `Vérifié.\nHIVE_AVIS ${JSON.stringify({ type, force, raison: 'r' })}`;
}

const resultat = (r: Partial<ResultatOuvriere> & { logs: string }): ResultatOuvriere => ({
  nodeId: 'n1',
  agentType: 'claude-code',
  success: true,
  diff: '',
  ...r,
});

/** Rend terminales toutes les tâches en attente, avec la sortie fournie. */
function retourner(
  sessionId: string,
  fabriquer: (i: number, role: string) => ResultatOuvriere | null,
): Map<string, ResultatOuvriere | null> {
  const m = new Map<string, ResultatOuvriere | null>();
  store.tachesADepouiller(sessionId).forEach((t, i) => m.set(t.taskId, fabriquer(i, t.role)));
  return m;
}

describe('ouvrir un conseil', () => {
  it('crée une tâche par lentille, liée à la session', () => {
    const s = ouvrirConseil(dep, { projectId, question: 'Est-ce viable ?' });
    const taches = store.tachesADepouiller(s.id);
    expect(taches.length).toBeGreaterThanOrEqual(4);
    expect(taches.every((t) => t.role === 'exploration')).toBe(true);
    expect(new Set(taches.map((t) => t.lentille)).size).toBe(taches.length); // angles distincts
    expect(evenements[0]?.type).toBe('council_opened');
  });

  it('les tâches créées portent le prompt d’exploration, pas un texte vide', () => {
    const s = ouvrirConseil(dep, { projectId });
    const t = store.tachesADepouiller(s.id)[0]!;
    const tache = store.getTask(t.taskId)!;
    expect(tache.prompt).toContain('ÉCLAIREUSE');
    expect(tache.prompt).toContain('HIVE_PROPOSITION');
  });

  it('sans question, pose celle par défaut sur la viabilité', () => {
    const s = ouvrirConseil(dep, { projectId, question: '   ' });
    expect(store.getSession(s.id)?.question).toMatch(/viable/i);
  });
});

describe('dépouiller un tour', () => {
  it('range les propositions et n’en range aucune deux fois', () => {
    const s = ouvrirConseil(dep, { projectId });
    const a = avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) => resultat({ logs: propose(`idée-${i}`) })),
    );
    expect(a.propositions).toBeGreaterThanOrEqual(4);
    expect(a.tourClos).toBe(true);

    // Une seconde passe ne doit RIEN redépouiller : sans le drapeau, chaque
    // passe du tick recréerait les mêmes propositions à l'infini.
    const avant = store.listPropositions(s.id).length;
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, () => resultat({ logs: propose('x') })),
    );
    expect(store.listPropositions(s.id)).toHaveLength(avant);
  });

  it('une éclaireuse qui ÉCHOUE ne bloque pas le tour', () => {
    // Bloquer le tour sur elle laisserait la session ouverte pour toujours —
    // et une session ouverte continue de créer des tâches.
    const s = ouvrirConseil(dep, { projectId });
    const a = avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) =>
        i === 0 ? resultat({ logs: '', success: false }) : resultat({ logs: propose(`i-${i}`) }),
      ),
    );
    expect(a.tourClos).toBe(true);
    expect(store.listPropositions(s.id).length).toBeGreaterThan(0);
  });

  it('une sortie ILLISIBLE est ignorée sans casser le conseil', () => {
    const s = ouvrirConseil(dep, { projectId });
    const a = avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, () => resultat({ logs: 'bla bla' })),
    );
    expect(a.tourClos).toBe(true);
    expect(store.listPropositions(s.id)).toHaveLength(0);
    expect(store.getSession(s.id)?.etat).toBe('clos'); // rien à vérifier : on clôt
  });

  it('le tour n’est PAS clos tant qu’une tâche n’est pas revenue', () => {
    const s = ouvrirConseil(dep, { projectId });
    const taches = store.tachesADepouiller(s.id);
    const partiel = new Map<string, ResultatOuvriere | null>();
    partiel.set(taches[0]!.taskId, resultat({ logs: propose('seule') }));
    const a = avancerConseil(dep, store.getSession(s.id)!, partiel);
    expect(a.tourClos).toBe(false);
    expect(a.verdict).toBeNull();
    expect(store.getSession(s.id)?.etat).toBe('exploration');
  });
});

describe('l’enchaînement des tours', () => {
  it('lance des vérifications, en nombre égal au quorum', () => {
    const s = ouvrirConseil(dep, { projectId });
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) => resultat({ logs: propose(`idée-${i}`) })),
    );

    const session = store.getSession(s.id)!;
    expect(session.etat).toBe('verification');
    expect(session.tour).toBe(2);
    const suite = store.tachesADepouiller(s.id);
    expect(suite.every((t) => t.role === 'verification')).toBe(true);
    expect(suite).toHaveLength(
      store.listPropositions(s.id).length * VERIFICATRICES_PAR_PROPOSITION,
    );
    expect(suite.every((t) => t.propositionId !== null)).toBe(true);
  });

  it('un conseil ATTEINT LE QUORUM et retient une proposition', () => {
    // Le parcours nominal complet : exploration, puis trois vérificatrices de
    // familles distinctes soutiennent la même proposition.
    const s = ouvrirConseil(dep, { projectId });
    // Un seul angle propose, pour n'avoir qu'une candidate.
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) =>
        i === 0
          ? resultat({ logs: propose('la bonne idée'), nodeId: 'auteur' })
          : resultat({ logs: 'rien' }),
      ),
    );
    expect(store.listPropositions(s.id)).toHaveLength(1);

    const familles = ['codex', 'hermes', 'claude-code'];
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) =>
        resultat({ logs: juge('soutien'), nodeId: `verif-${i}`, agentType: familles[i % 3]! }),
      ),
    );

    const session = store.getSession(s.id)!;
    expect(session.etat).toBe('clos');
    expect(session.issue).toBe('quorum');
    expect(evenements.some((e) => e.type === 'council_closed')).toBe(true);
    const clos = evenements.find((e) => e.type === 'council_closed')!;
    expect(clos.payload.retenue).toBe(store.listPropositions(s.id)[0]!.id);
  });

  it('UN SIGNAL D’ARRÊT empêche la clôture au quorum', () => {
    const s = ouvrirConseil(dep, { projectId });
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) =>
        i === 0 ? resultat({ logs: propose('douteuse') }) : resultat({ logs: 'rien' }),
      ),
    );
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) =>
        resultat({
          logs: i === 0 ? juge('arret') : juge('soutien'),
          nodeId: `v-${i}`,
          agentType: ['codex', 'hermes', 'claude-code'][i % 3]!,
        }),
      ),
    );
    expect(store.getSession(s.id)?.issue).not.toBe('quorum');
  });
});

describe('une session finit TOUJOURS par se clore', () => {
  it('même si personne ne converge jamais', () => {
    // La propriété la plus importante du runner. Une session qui resterait
    // ouverte continuerait à créer des tâches de vérification à chaque tour,
    // donc à brûler du temps-ouvrière réel, indéfiniment.
    const s = ouvrirConseil(dep, { projectId });
    let passes = 0;
    while (store.getSession(s.id)!.etat !== 'clos' && passes < 50) {
      const session = store.getSession(s.id)!;
      avancerConseil(
        dep,
        session,
        retourner(s.id, (i, role) =>
          resultat({
            // À chaque tour de nouvelles idées, et des avis toujours partagés :
            // le pire cas pour la convergence.
            logs:
              role === 'exploration'
                ? propose(`t${session.tour}-${i}`)
                : juge(i % 2 ? 'soutien' : 'arret'),
            nodeId: `n-${i}`,
            agentType: 'claude-code',
          }),
        ),
      );
      passes += 1;
    }
    expect(store.getSession(s.id)?.etat).toBe('clos');
    expect(passes).toBeLessThanOrEqual(TOURS_MAX + 1);
  });

  it('et cesse alors de créer des tâches', () => {
    const s = ouvrirConseil(dep, { projectId });
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, () => resultat({ logs: 'rien' })),
    );
    expect(store.getSession(s.id)?.etat).toBe('clos');
    const avant = store.listTasks(projectId).length;
    avancerConseil(dep, store.getSession(s.id)!, new Map());
    expect(store.listTasks(projectId)).toHaveLength(avant);
  });

  it('n’apparaît plus dans les sessions ouvertes une fois close', () => {
    const s = ouvrirConseil(dep, { projectId });
    expect(store.sessionsOuvertes().map((x) => x.id)).toContain(s.id);
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, () => resultat({ logs: 'rien' })),
    );
    expect(store.sessionsOuvertes().map((x) => x.id)).not.toContain(s.id);
  });
});

describe('l’élagage', () => {
  it('ne supprime QUE des sessions closes, avec leurs enfants', () => {
    // Élaguer une session en cours laisserait des tâches d'éclaireuses
    // orphelines, qui tourneraient pour un conseil inexistant.
    const close = ouvrirConseil(dep, { projectId });
    avancerConseil(
      dep,
      store.getSession(close.id)!,
      retourner(close.id, () => resultat({ logs: 'rien' })),
    );
    const ouverte = ouvrirConseil(dep, { projectId });

    expect(store.pruneConseils(0)).toBe(1);
    expect(store.getSession(close.id)).toBeNull();
    expect(store.getSession(ouverte.id)).not.toBeNull();
    expect(store.tachesADepouiller(ouverte.id).length).toBeGreaterThan(0);
  });

  it('respecte le quota et garde les plus récentes', () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = ouvrirConseil(dep, { projectId });
      avancerConseil(
        dep,
        store.getSession(s.id)!,
        retourner(s.id, () => resultat({ logs: 'rien' })),
      );
      ids.push(s.id);
    }
    expect(store.pruneConseils(2)).toBe(1);
    expect(store.getSession(ids[0]!)).toBeNull(); // la plus ancienne
    expect(store.getSession(ids[2]!)).not.toBeNull();
  });

  it('supprime bien les propositions et avis de la session jetée', () => {
    const s = ouvrirConseil(dep, { projectId });
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, (i) =>
        i === 0 ? resultat({ logs: propose('x') }) : resultat({ logs: 'rien' }),
      ),
    );
    avancerConseil(
      dep,
      store.getSession(s.id)!,
      retourner(s.id, () => resultat({ logs: juge('soutien') })),
    );
    expect(store.listPropositions(s.id).length).toBeGreaterThan(0);

    store.majSession(s.id, { etat: 'clos' });
    store.pruneConseils(0);
    expect(store.listPropositions(s.id)).toHaveLength(0);
    expect(store.listAvis(s.id)).toHaveLength(0);
  });
});
