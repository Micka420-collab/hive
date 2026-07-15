// Tests de la Reine (concierge) : intentions, réponses live depuis l'état réel,
// bonnes pratiques par type de projet, et bascule/repli du mode IA (LlmFn injecté).

import { describe, expect, it } from 'vitest';
import {
  answerLive,
  askConcierge,
  buildChatPrompt,
  detectIntent,
  detectLanguage,
  detectProjectKind,
} from '../src/orchestrator/concierge.js';
import type { ConciergeContext } from '../src/orchestrator/concierge.js';
import type { HivePulse } from '../src/orchestrator/pulse.js';
import type { ProjectReport } from '../src/orchestrator/project-report.js';

function makePulse(over: Partial<HivePulse> = {}): HivePulse {
  return {
    totalDone: 5,
    totalFailed: 1,
    successRate: 5 / 6,
    activeNodes: 2,
    latency: { p50: 1200, p95: 4000, max: 9000, avg: 1800, count: 6 },
    throughput: [],
    spanMs: 3_600_000,
    ...over,
  };
}

function makeReport(over: Partial<ProjectReport> = {}): ProjectReport {
  return {
    projectId: 'p1',
    name: 'SaaS',
    total: 10,
    byStatus: { pending: 2, ready: 1, assigned: 0, running: 1, done: 5, failed: 1 },
    done: 5,
    failed: 1,
    progressPct: 50,
    complete: false,
    contributingNodes: ['n1'],
    totalAttempts: 8,
    ...over,
  };
}

function makeCtx(over: Partial<ConciergeContext> = {}): ConciergeContext {
  return {
    projects: [
      {
        id: 'p1',
        name: 'SaaS',
        repoUrl: null,
        description: null,
        visibility: 'private',
        ownerId: null,
        createdAt: 1,
      },
    ],
    nodes: [
      {
        id: 'n1',
        name: 'ruche-alpha',
        ownerName: 'Micka',
        agentType: 'claude-code',
        maxConcurrency: 2,
        running: 1,
        status: 'online',
        lastSeen: 10,
      },
    ],
    reports: [makeReport()],
    pulse: makePulse(),
    waggle: {
      nodes: [
        {
          nodeId: 'n1',
          name: 'ruche-alpha',
          agentType: 'claude-code',
          tasksDone: 5,
          tasksFailed: 1,
          totalDurationMs: 6000,
          avgDurationMs: 1200,
          successRate: 5 / 6,
          raceWins: 0,
          score: 24,
        },
      ],
      totalTasksDone: 5,
      totalTasksFailed: 1,
      topNodeId: 'n1',
    },
    ghosts: [],
    memories: [],
    recentEvents: [
      { id: 1, ts: 1000, type: 'task_done', payload: {} },
      { id: 2, ts: 2000, type: 'task_failed', payload: {} },
      { id: 3, ts: 3000, type: 'task_done', payload: {} },
    ],
    reviews: { 'task-a': 'approved' },
    finishedTasks: [
      { id: 'task-a', title: 'construire le socle', status: 'done' },
      { id: 'task-b', title: 'ajouter les tests', status: 'done' },
      { id: 'task-c', title: 'deploiement', status: 'failed' },
    ],
    ...over,
  };
}

describe('detectIntent', () => {
  it('reconnaît les intentions françaises usuelles (accents ignorés)', () => {
    expect(detectIntent('Où en est le projet ?')).toBe('progress');
    expect(detectIntent('que s est-il passé cette nuit ?')).toBe('recent');
    expect(detectIntent('quel nœud travaille le mieux ?')).toBe('nodes');
    expect(detectIntent('la ruche est-elle en bonne santé ?')).toBe('health');
    expect(detectIntent('aide-moi à écrire un bon brief')).toBe('brief');
    expect(detectIntent("qu'a retenu la ruche en mémoire ?")).toBe('memory');
    expect(detectIntent('bonjour !')).toBe('help');
  });
});

describe('detectLanguage (projet mondial)', () => {
  it('détecte le français et l anglais', () => {
    expect(detectLanguage('Où en est le projet ?')).toBe('fr');
    expect(detectLanguage('bonjour, aide-moi à cadrer mon projet')).toBe('fr');
    expect(detectLanguage('How is the project going?')).toBe('en');
    expect(detectLanguage('which node works best? thanks')).toBe('en');
  });
});

describe('detectProjectKind', () => {
  it('détecte le type de projet depuis la question', () => {
    expect(detectProjectKind('je veux une boutique en ligne avec paiement')).toBe('ecommerce');
    expect(detectProjectKind('une API REST pour mon backend')).toBe('api');
    expect(detectProjectKind('un site vitrine React')).toBe('web');
    expect(detectProjectKind('automatiser un truc')).toBe('generic');
  });
});

describe('answerLive', () => {
  it('avancement : cite les chiffres réels du rapport', () => {
    const a = answerLive('où en est le projet ?', makeCtx());
    expect(a.source).toBe('live');
    expect(a.reply).toContain('SaaS');
    expect(a.reply).toContain('50 %');
    expect(a.reply).toContain('5/10');
    expect(a.suggestions.length).toBeGreaterThan(0);
  });

  it('avancement : filtre sur le projet ciblé (focusProjectId)', () => {
    const ctx = makeCtx({
      reports: [makeReport(), makeReport({ projectId: 'p2', name: 'Autre', progressPct: 10 })],
      focusProjectId: 'p2',
    });
    const a = answerLive('avancement ?', ctx);
    expect(a.reply).toContain('Autre');
    expect(a.reply).not.toContain('SaaS :');
  });

  it('récent : résume le journal (terminées/échecs)', () => {
    const a = answerLive('que s est-il passé cette nuit ?', makeCtx());
    expect(a.reply).toContain('2 tâche(s) terminée(s)');
    expect(a.reply).toContain('1 échec');
  });

  it('nœuds : classement nectar avec médaille', () => {
    const a = answerLive('quel nœud est le meilleur ?', makeCtx());
    expect(a.reply).toContain('🥇 ruche-alpha');
    expect(a.reply).toContain('24 nectar');
  });

  it('santé : paisible sans anomalie, alarmante avec', () => {
    const calm = answerLive('la ruche est-elle en bonne santé ?', makeCtx());
    expect(calm.reply).toContain('paisiblement');
    const sick = answerLive(
      'des problèmes ?',
      makeCtx({
        ghosts: [
          {
            kind: 'flaky_node',
            target: 'n1',
            severity: 'high',
            detail: 'ruche-alpha échoue 80 % du temps',
            metrics: { failRate: 0.8 },
          },
        ],
      }),
    );
    expect(sick.reply).toContain('1 anomalie');
    expect(sick.reply).toContain('flaky_node');
  });

  it('brief : bonnes pratiques adaptées au type détecté', () => {
    const a = answerLive('aide-moi à cadrer le brief de ma boutique en ligne', makeCtx());
    expect(a.reply).toContain('e-commerce');
    expect(a.reply).toContain('tunnel d achat');
    expect(a.reply).toContain('Proposer un plan');
  });

  it('aide : présente les capacités sans état requis', () => {
    const a = answerLive('salut', makeCtx({ projects: [], reports: [] }));
    expect(a.reply).toContain('la Reine');
  });

  it('revue : compte les productions à revoir depuis les verdicts serveur', () => {
    const a = answerLive('que reste-t-il à revoir dans la miellerie ?', makeCtx());
    expect(a.reply).toContain('3 production(s) terminée(s)');
    expect(a.reply).toContain('1 approuvée(s)');
    expect(a.reply).toContain('2 en attente');
    expect(a.reply).toContain('ajouter les tests');
  });

  it('répond en anglais à une question en anglais (projet mondial)', () => {
    const a = answerLive('How is the project going?', makeCtx());
    expect(a.lang).toBe('en');
    expect(a.reply).toContain('tasks');
    expect(a.reply).toContain('50 %');
    expect(a.suggestions[0]).toContain('What');
  });

  it('classement en anglais', () => {
    const a = answerLive('which node works best?', makeCtx());
    expect(a.lang).toBe('en');
    expect(a.reply).toContain('leaderboard');
    expect(a.reply).toContain('🥇 ruche-alpha');
  });
});

describe('askConcierge (mode IA injecté)', () => {
  it('utilise le LlmFn et étiquette la réponse « llm »', async () => {
    const a = await askConcierge('où en est le projet ?', makeCtx(), {
      llm: async () => 'Réponse rédigée par le modèle.',
    });
    expect(a.source).toBe('llm');
    expect(a.reply).toBe('Réponse rédigée par le modèle.');
  });

  it('replie silencieusement sur le mode live si le modèle échoue', async () => {
    const a = await askConcierge('où en est le projet ?', makeCtx(), {
      llm: async () => {
        throw new Error('panne API');
      },
    });
    expect(a.source).toBe('live');
    expect(a.reply).toContain('SaaS');
  });

  it('replie sur le live si le modèle renvoie une réponse vide', async () => {
    const a = await askConcierge('avancement ?', makeCtx(), { llm: async () => '   ' });
    expect(a.source).toBe('live');
  });

  it('sans LlmFn : mode live direct', async () => {
    const a = await askConcierge('avancement ?', makeCtx());
    expect(a.source).toBe('live');
  });
});

describe('buildChatPrompt', () => {
  it("n'injecte que des données réelles bornées et fixe les règles", () => {
    const { system, user } = buildChatPrompt('où en est-on ?', makeCtx());
    expect(system).toContain('la Reine');
    expect(system).toContain('ruche-alpha');
    expect(system).toContain('inventes jamais');
    expect(system).toContain('TOUJOURS dans cette langue');
    expect(user).toBe('où en est-on ?');
    // Bornage : pas plus de 20 événements sérialisés.
    const events = system.match(/"type":"task_/g) ?? [];
    expect(events.length).toBeLessThanOrEqual(20);
  });
});
