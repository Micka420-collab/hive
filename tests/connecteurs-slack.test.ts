// Le connecteur Slack — messages (boutons d'approbation), interactions
// entrantes (liste d'autorisation FERMÉE PAR DÉFAUT), et le round-trip Socket
// Mode contre un faux serveur. La preuve VIVE contre un vrai atelier Slack
// demande des identifiants d'atelier : elle est hors de cette machine.

import { describe, expect, it, beforeEach } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import {
  ACTION_APPROUVER,
  ACTION_REJETER,
  messagePourEvenement,
} from '../src/connectors/slack/messages.js';
import { autoriserInteraction, extraireInteraction } from '../src/connectors/slack/interactions.js';
import {
  posterMessageSlack,
  type SlackFetch,
  type WsLike,
} from '../src/connectors/slack/client.js';
import { HubConnecteurs, type ResultatRevueConnecteur } from '../src/orchestrator/connecteurs.js';
import { ENV_SLACK_APP, ENV_SLACK_BOT } from '../src/connectors/slack/definition.js';

// ─── Les messages ────────────────────────────────────────────────────────────

describe('messagePourEvenement', () => {
  it('une demande d’approbation porte deux boutons avec la tâche en valeur', () => {
    const msg = messagePourEvenement({
      kind: 'demande_approbation',
      projectId: 'p1',
      titre: 'Relire la PR',
      taskId: 'tache-42',
    });
    const actions = msg.blocks.find((b) => b.type === 'actions') as
      { block_id: string; elements: Array<{ action_id: string; value: string }> } | undefined;
    expect(actions).toBeDefined();
    expect(actions!.block_id).toBe('hive_approbation:p1');
    const ids = actions!.elements.map((e) => e.action_id);
    expect(ids).toEqual([ACTION_APPROUVER, ACTION_REJETER]);
    expect(actions!.elements.every((e) => e.value === 'tache-42')).toBe(true);
  });

  it('une décision n’a pas de boutons', () => {
    const msg = messagePourEvenement({ kind: 'decision', projectId: 'p1', titre: 'Approuvée' });
    expect(msg.blocks.some((b) => b.type === 'actions')).toBe(false);
    expect(msg.text).toContain('Décision');
  });
});

// ─── L'extraction et l'autorisation d'une interaction ─────────────────────────

function interactionBrute(over: Record<string, unknown> = {}): unknown {
  return {
    type: 'block_actions',
    user: { id: 'U1' },
    channel: { id: 'C1' },
    actions: [{ action_id: ACTION_APPROUVER, value: 'tache-1', block_id: 'hive_approbation:p1' }],
    ...over,
  };
}

describe('extraireInteraction', () => {
  it('ne retient que block_actions avec un action_id connu', () => {
    expect(extraireInteraction({ type: 'shortcut' }).ok).toBe(false);
    const autre = extraireInteraction({ type: 'block_actions', actions: [{ action_id: 'x' }] });
    expect(autre.ok).toBe(false);
    if (!autre.ok) expect(autre.motif).toBe('action_ignore');
  });

  it('lit la tâche, l’usager et le canal', () => {
    const r = extraireInteraction(interactionBrute());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.extraction.taskId).toBe('tache-1');
      expect(r.extraction.userId).toBe('U1');
      expect(r.extraction.channelId).toBe('C1');
      expect(r.extraction.blockProjectId).toBe('p1');
    }
  });

  it('lit le canal depuis container.channel_id à défaut de channel.id', () => {
    const r = extraireInteraction(
      interactionBrute({ channel: undefined, container: { channel_id: 'C9' } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.channelId).toBe('C9');
  });
});

describe('autoriserInteraction — fermé par défaut', () => {
  const extraction = {
    actionId: ACTION_APPROUVER,
    taskId: 'tache-1',
    blockProjectId: 'p1',
    userId: 'U1',
    channelId: 'C1',
  };

  it('approuve quand portée, canal ET usager sont inscrits', () => {
    const v = autoriserInteraction(extraction, {
      portees: ['approbation'],
      canaux: ['C1'],
      usagers: ['U1'],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.verdict).toBe('approved');
  });

  it('refuse sans la portée approbation', () => {
    const v = autoriserInteraction(extraction, {
      portees: ['notification'],
      canaux: ['C1'],
      usagers: ['U1'],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('portee_absente');
  });

  it('refuse un canal non inscrit', () => {
    const v = autoriserInteraction(extraction, {
      portees: ['approbation'],
      canaux: ['Cautre'],
      usagers: ['U1'],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('canal_refuse');
  });

  it('refuse un usager non inscrit', () => {
    const v = autoriserInteraction(extraction, {
      portees: ['approbation'],
      canaux: ['C1'],
      usagers: ['Uautre'],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('usager_refuse');
  });

  it('listes VIDES = refus (pas « tout le monde »)', () => {
    const v = autoriserInteraction(extraction, {
      portees: ['approbation'],
      canaux: [],
      usagers: [],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('canal_refuse');
  });

  it('mappe le bouton rejeter vers un verdict rejected', () => {
    const v = autoriserInteraction(
      { ...extraction, actionId: ACTION_REJETER },
      { portees: ['approbation'], canaux: ['C1'], usagers: ['U1'] },
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.verdict).toBe('rejected');
  });
});

// ─── posterMessageSlack contre un faux chat.postMessage ───────────────────────

describe('posterMessageSlack', () => {
  it('lit le champ ok DU CORPS, pas seulement le statut HTTP', async () => {
    const faux: SlackFetch = async () => ({
      status: 200,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    });
    const res = await posterMessageSlack(
      { token: 'xoxb-x', channel: 'C1', message: { text: 't', blocks: [] } },
      faux,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.motif).toBe('channel_not_found');
  });

  it('réussit quand ok:true et rend le ts', async () => {
    const faux: SlackFetch = async () => ({
      status: 200,
      json: async () => ({ ok: true, ts: '1.2' }),
    });
    const res = await posterMessageSlack(
      { token: 'xoxb-x', channel: 'C1', message: { text: 't', blocks: [] } },
      faux,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.ts).toBe('1.2');
  });
});

// ─── Le hub : approbation entrante → chemin canonique de revue ────────────────

/** Un WebSocket de test : on capture le handler de messages pour le piloter. */
class FauxWs implements WsLike {
  envoyes: string[] = [];
  private handlers = new Map<string, (arg?: unknown) => void>();
  send(data: string): void {
    this.envoyes.push(data);
  }
  close(): void {
    this.handlers.get('close')?.();
  }
  on(event: 'open' | 'message' | 'close' | 'error', cb: (arg?: unknown) => void): void {
    this.handlers.set(event, cb);
  }
  emettre(event: 'open' | 'message' | 'close' | 'error', arg?: unknown): void {
    this.handlers.get(event)?.(arg);
  }
}

describe('HubConnecteurs — approbation Slack entrante', () => {
  let store: HiveStore;
  let projectId: string;
  let taskId: string;
  let revues: Array<{ taskId: string; verdict: string }>;

  const env = { [ENV_SLACK_BOT]: 'xoxb-test', [ENV_SLACK_APP]: 'xapp-test' } as NodeJS.ProcessEnv;

  const fetchSlack: SlackFetch = async (url) => {
    if (url.endsWith('apps.connections.open')) {
      return { status: 200, json: async () => ({ ok: true, url: 'wss://faux/socket' }) };
    }
    return { status: 200, json: async () => ({ ok: true, ts: '1' }) };
  };

  beforeEach(() => {
    store = new HiveStore(':memory:');
    projectId = store.createProject({ name: 'P', ownerId: null }).id;
    taskId = store.createTask({ projectId, title: 'T', prompt: 'p' }).id;
    revues = [];
  });

  function hub(over: Partial<{ ws: FauxWs }> = {}): { hub: HubConnecteurs; ws: FauxWs } {
    const ws = over.ws ?? new FauxWs();
    const h = new HubConnecteurs({
      store,
      env,
      fetchSlack,
      wsFactory: () => ws,
      appliquerRevue: (t, v): ResultatRevueConnecteur => {
        revues.push({ taskId: t, verdict: v });
        return 'applique';
      },
    });
    return { hub: h, ws };
  }

  it('applique le verdict quand tout est inscrit, et journalise ok', () => {
    store.autoriserConnecteur({
      connecteurId: 'slack',
      projectId,
      portees: ['approbation'],
      canaux: ['C1'],
      usagers: ['U1'],
    });
    const { hub: h } = hub();
    h.traiterInteraction({
      type: 'block_actions',
      user: { id: 'U1' },
      channel: { id: 'C1' },
      actions: [
        { action_id: ACTION_APPROUVER, value: taskId, block_id: `hive_approbation:${projectId}` },
      ],
    });
    expect(revues).toEqual([{ taskId, verdict: 'approved' }]);
    const j = store.listerJournalConnecteurs({ projectId });
    expect(j[0]?.resultat).toBe('ok');
    expect(j[0]?.qui).toBe('slack:U1');
  });

  it('refuse un usager non inscrit et n’applique RIEN', () => {
    store.autoriserConnecteur({
      connecteurId: 'slack',
      projectId,
      portees: ['approbation'],
      canaux: ['C1'],
      usagers: ['U1'],
    });
    const { hub: h } = hub();
    h.traiterInteraction({
      type: 'block_actions',
      user: { id: 'INTRUS' },
      channel: { id: 'C1' },
      actions: [
        { action_id: ACTION_APPROUVER, value: taskId, block_id: `hive_approbation:${projectId}` },
      ],
    });
    expect(revues).toEqual([]);
    const j = store.listerJournalConnecteurs({ projectId });
    expect(j[0]?.resultat).toBe('refuse');
    expect(j[0]?.apercu).toBe('usager_refuse');
  });

  it('résout le projet depuis la TÂCHE, pas depuis le block_id (autorité)', () => {
    // Le projet réel de la tâche n'a PAS accordé la portée : même si le
    // block_id ment (« hive_approbation:autre »), rien n'est appliqué.
    const { hub: h } = hub();
    h.traiterInteraction({
      type: 'block_actions',
      user: { id: 'U1' },
      channel: { id: 'C1' },
      actions: [
        { action_id: ACTION_APPROUVER, value: taskId, block_id: 'hive_approbation:un-projet-ment' },
      ],
    });
    expect(revues).toEqual([]);
    const j = store.listerJournalConnecteurs({ projectId });
    expect(j[0]?.resultat).toBe('refuse');
  });

  it('acquitte toute enveloppe Socket Mode à envelope_id', async () => {
    const { hub: h, ws } = hub();
    await h.demarrer();
    ws.emettre('message', JSON.stringify({ type: 'hello' }));
    ws.emettre(
      'message',
      JSON.stringify({ type: 'interactive', envelope_id: 'env-1', payload: { type: 'shortcut' } }),
    );
    // L'enveloppe à envelope_id est acquittée, même si le payload est ignoré.
    expect(ws.envoyes).toContain(JSON.stringify({ envelope_id: 'env-1' }));
    h.fermer();
  });

  it('ne se connecte pas sans jeton d’app (défaut dormant)', async () => {
    const store2 = new HiveStore(':memory:');
    let fabrique = 0;
    const h = new HubConnecteurs({
      store: store2,
      env: { [ENV_SLACK_BOT]: 'xoxb-test' } as NodeJS.ProcessEnv,
      fetchSlack,
      wsFactory: () => {
        fabrique += 1;
        return new FauxWs();
      },
      appliquerRevue: () => 'applique',
    });
    await h.demarrer();
    // Actif pour POSTER (le jeton de bot suffit), mais AUCUN socket entrant sans
    // le jeton d'app : la voie d'approbation reste fermée, par défaut.
    expect(fabrique).toBe(0);
    expect(h.estActif('slack')).toBe(true);
    store2.close();
  });
});
