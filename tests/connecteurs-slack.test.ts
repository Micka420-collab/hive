// Le connecteur Slack — messages (boutons d'approbation), interactions
// entrantes (liste d'autorisation FERMÉE PAR DÉFAUT), et le round-trip Socket
// Mode contre un faux serveur. La preuve VIVE contre un vrai atelier Slack
// demande des identifiants d'atelier : elle est hors de cette machine.

import { describe, expect, it, beforeEach } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import {
  ACTION_APPROUVER,
  ACTION_REJETER,
  encoderValeurBouton,
  lireValeurBouton,
  messagePourEvenement,
} from '../src/connectors/slack/messages.js';
import { autoriserInteraction, extraireInteraction } from '../src/connectors/slack/interactions.js';
import {
  ouvrirConnexionSocket,
  posterMessageSlack,
  repondreInteraction,
  type SlackFetch,
  type WsLike,
} from '../src/connectors/slack/client.js';
import { HubConnecteurs, type ResultatRevueConnecteur } from '../src/orchestrator/connecteurs.js';
import { ENV_SLACK_APP, ENV_SLACK_BOT } from '../src/connectors/slack/definition.js';

// ─── Les messages ────────────────────────────────────────────────────────────

const DEMANDE = {
  kind: 'demande_approbation',
  projectId: 'p1',
  titre: 'Relire la PR',
  taskId: 'tache-42',
  liaison: { resultId: 7, revueA: null },
} as const;

describe('messagePourEvenement', () => {
  it('une demande d’approbation porte deux boutons liés à la tâche ET à sa production', () => {
    const msg = messagePourEvenement(DEMANDE, { boutons: true });
    const actions = msg.blocks.find((b) => b.type === 'actions') as
      { block_id: string; elements: Array<{ action_id: string; value: string }> } | undefined;
    expect(actions).toBeDefined();
    expect(actions!.block_id).toBe('hive_approbation:p1');
    const ids = actions!.elements.map((e) => e.action_id);
    expect(ids).toEqual([ACTION_APPROUVER, ACTION_REJETER]);
    for (const e of actions!.elements) {
      expect(lireValeurBouton(e.value)).toEqual({ taskId: 'tache-42', resultId: 7, revueA: null });
    }
  });

  it('sans boucle entrante, la demande part SANS boutons et dit où répondre', () => {
    const msg = messagePourEvenement(DEMANDE, { boutons: false });
    expect(msg.blocks.some((b) => b.type === 'actions')).toBe(false);
    expect(JSON.stringify(msg.blocks)).toContain('Miellerie');
  });

  it('une décision n’a pas de boutons', () => {
    const msg = messagePourEvenement(
      { kind: 'decision', projectId: 'p1', titre: 'Approuvée' },
      { boutons: true },
    );
    expect(msg.blocks.some((b) => b.type === 'actions')).toBe(false);
    expect(msg.text).toContain('Décision');
  });

  it('échappe &, < et > : un titre d’agent ne sonne pas le canal ni ne déguise un lien', () => {
    const msg = messagePourEvenement(
      {
        kind: 'blocage',
        projectId: 'p1',
        titre: '<!channel> <https://ailleurs.example|Approuver ici>',
        corps: 'A & B <!here>',
      },
      { boutons: true },
    );
    const brut = JSON.stringify(msg);
    expect(brut).toContain('&lt;!channel&gt;');
    expect(brut).toContain('&lt;https://ailleurs.example|Approuver ici&gt;');
    expect(brut).toContain('A &amp; B &lt;!here&gt;');
    expect(brut).not.toContain('<!channel>');
    expect(brut).not.toContain('<!here>');
    expect(msg.text).toContain('&lt;!channel&gt;');
  });
});

describe('valeur de bouton', () => {
  it('fait l’aller-retour, et refuse toute autre forme', () => {
    const v = { taskId: 't', resultId: 3, revueA: 1700 };
    expect(lireValeurBouton(encoderValeurBouton(v))).toEqual(v);
    expect(lireValeurBouton('tache-nue')).toBeNull();
    expect(lireValeurBouton(JSON.stringify({ t: 't', r: '3', v: null }))).toBeNull();
    expect(lireValeurBouton(JSON.stringify({ t: '', r: 3, v: null }))).toBeNull();
    expect(lireValeurBouton(JSON.stringify({ t: 't', r: 3 }))).toBeNull();
  });
});

// ─── L'extraction et l'autorisation d'une interaction ─────────────────────────

const VALEUR_1 = encoderValeurBouton({ taskId: 'tache-1', resultId: 1, revueA: null });

function interactionBrute(over: Record<string, unknown> = {}): unknown {
  return {
    type: 'block_actions',
    user: { id: 'U1' },
    channel: { id: 'C1' },
    response_url: 'https://hooks.slack.com/actions/T1/1/x',
    actions: [{ action_id: ACTION_APPROUVER, value: VALEUR_1, block_id: 'hive_approbation:p1' }],
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
      expect(r.extraction.liaison).toEqual({ resultId: 1, revueA: null });
      expect(r.extraction.responseUrl).toBe('https://hooks.slack.com/actions/T1/1/x');
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

  it('une valeur sans liaison (tâche nue) est malformée, pas une tâche', () => {
    const r = extraireInteraction(
      interactionBrute({ actions: [{ action_id: ACTION_APPROUVER, value: 'tache-1' }] }),
    );
    expect(r).toEqual({ ok: false, motif: 'malforme' });
  });
});

describe('autoriserInteraction — fermé par défaut', () => {
  const extraction = {
    actionId: ACTION_APPROUVER,
    taskId: 'tache-1',
    liaison: { resultId: 1, revueA: null },
    responseUrl: null,
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

  it('ouvrirConnexionSocket est borné : un Slack qui pend rend un échec, pas une attente infinie', async () => {
    const pendu: SlackFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('délai dépassé')));
      });
    const res = await ouvrirConnexionSocket('xapp-x', pendu, 20);
    expect(res).toEqual({ ok: false, motif: 'délai dépassé' });
  });
});

describe('repondreInteraction', () => {
  it('ne poste qu’à hooks.slack.com — jamais à une URL lue ailleurs', async () => {
    const appels: string[] = [];
    const faux: SlackFetch = async (url) => {
      appels.push(url);
      return { status: 200, json: async () => ({}) };
    };
    const refus = await repondreInteraction(
      { responseUrl: 'https://ailleurs.example/x', texte: 't', remplacer: false },
      faux,
    );
    expect(refus).toEqual({ ok: false, motif: 'url_refusee' });
    expect(appels).toEqual([]);
    const ok = await repondreInteraction(
      { responseUrl: 'https://hooks.slack.com/actions/T/1/x', texte: 't', remplacer: true },
      faux,
    );
    expect(ok).toEqual({ ok: true });
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
  let revues: Array<{ taskId: string; verdict: string; resultId: number }>;
  let appels: Array<{ url: string; body: string | undefined }>;

  const env = { [ENV_SLACK_BOT]: 'xoxb-test', [ENV_SLACK_APP]: 'xapp-test' } as NodeJS.ProcessEnv;
  const REPONSE = 'https://hooks.slack.com/actions/T1/1/x';

  const fetchSlack: SlackFetch = async (url, init) => {
    appels.push({ url, body: init.body });
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
    appels = [];
  });

  function hub(over: Partial<{ ws: FauxWs; appliquer: () => ResultatRevueConnecteur }> = {}): {
    hub: HubConnecteurs;
    ws: FauxWs;
  } {
    const ws = over.ws ?? new FauxWs();
    const h = new HubConnecteurs({
      store,
      env,
      fetchSlack,
      wsFactory: () => ws,
      appliquerRevue: (t, v, liaison): ResultatRevueConnecteur => {
        revues.push({ taskId: t, verdict: v, resultId: liaison.resultId });
        return over.appliquer ? over.appliquer() : 'applique';
      },
    });
    return { hub: h, ws };
  }

  const clic = (userId: string, blockId = `hive_approbation:${projectId}`): unknown => ({
    type: 'block_actions',
    user: { id: userId },
    channel: { id: 'C1' },
    response_url: REPONSE,
    actions: [
      {
        action_id: ACTION_APPROUVER,
        value: encoderValeurBouton({ taskId, resultId: 5, revueA: null }),
        block_id: blockId,
      },
    ],
  });

  const autoriser = (): void =>
    store.autoriserConnecteur({
      connecteurId: 'slack',
      projectId,
      portees: ['approbation'],
      canaux: ['C1'],
      usagers: ['U1'],
    });

  it('applique le verdict quand tout est inscrit, journalise ok, et remplace le message', async () => {
    autoriser();
    const { hub: h } = hub();
    await h.traiterInteraction(clic('U1'));
    expect(revues).toEqual([{ taskId, verdict: 'approved', resultId: 5 }]);
    const j = store.listerJournalConnecteurs({ projectId });
    const recue = j.find((e) => e.acte === 'approbation_recue');
    expect(recue?.resultat).toBe('ok');
    expect(recue?.qui).toBe('slack:U1');
    // Le cliqueur VOIT l'issue : le message est réécrit (les boutons partent).
    const reponse = appels.find((c) => c.url === REPONSE);
    expect(JSON.parse(reponse!.body!)).toMatchObject({ replace_original: true });
    expect(j.find((e) => e.acte === 'reponse_interaction')?.resultat).toBe('ok');
  });

  it('un clic périmé est refusé, journalisé, et le cliqueur lit pourquoi', async () => {
    autoriser();
    const { hub: h } = hub({ appliquer: () => 'perime' });
    await h.traiterInteraction(clic('U1'));
    const recue = store
      .listerJournalConnecteurs({ projectId })
      .find((e) => e.acte === 'approbation_recue');
    expect(recue?.resultat).toBe('refuse');
    expect(recue?.apercu).toContain('perime');
    const corps = JSON.parse(appels.find((c) => c.url === REPONSE)!.body!) as {
      response_type: string;
      text: string;
    };
    expect(corps.response_type).toBe('ephemeral');
    expect(corps.text).toContain('périmé');
  });

  it('refuse un usager non inscrit, n’applique RIEN, et le lui dit', async () => {
    autoriser();
    const { hub: h } = hub();
    await h.traiterInteraction(clic('INTRUS'));
    expect(revues).toEqual([]);
    const recue = store
      .listerJournalConnecteurs({ projectId })
      .find((e) => e.acte === 'approbation_recue');
    expect(recue?.resultat).toBe('refuse');
    expect(recue?.apercu).toBe('usager_refuse');
    expect(appels.some((c) => c.url === REPONSE)).toBe(true);
  });

  it('résout le projet depuis la TÂCHE, pas depuis le block_id (autorité)', async () => {
    // Le projet réel de la tâche n'a PAS accordé la portée : même si le
    // block_id ment (« hive_approbation:autre »), rien n'est appliqué.
    const { hub: h } = hub();
    await h.traiterInteraction(clic('U1', 'hive_approbation:un-projet-ment'));
    expect(revues).toEqual([]);
    const j = store.listerJournalConnecteurs({ projectId });
    expect(j.find((e) => e.acte === 'approbation_recue')?.resultat).toBe('refuse');
  });

  it('une exception APRÈS l’acquittement est consignée au journal, pas perdue', async () => {
    autoriser();
    const { hub: h, ws } = hub({
      appliquer: () => {
        throw new Error('SQLITE_BUSY');
      },
    });
    await h.demarrer();
    ws.emettre(
      'message',
      JSON.stringify({ type: 'interactive', envelope_id: 'env-9', payload: clic('U1') }),
    );
    await expect
      .poll(() => store.listerJournalConnecteurs({}).find((e) => e.resultat === 'echec')?.apercu)
      .toBe('SQLITE_BUSY');
    expect(ws.envoyes).toContain(JSON.stringify({ envelope_id: 'env-9' }));
    h.fermer();
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

  it('deux démarrages concurrents n’ouvrent qu’UN socket, et fermer le ferme', async () => {
    const ouverts: FauxWs[] = [];
    let fermes = 0;
    const h = new HubConnecteurs({
      store,
      env,
      fetchSlack,
      wsFactory: () => {
        const ws = new FauxWs();
        ws.close = () => {
          fermes += 1;
        };
        ouverts.push(ws);
        return ws;
      },
      appliquerRevue: () => 'applique',
    });
    await Promise.all([h.demarrer(), h.demarrer(), h.demarrer()]);
    expect(ouverts.length).toBe(1);
    h.fermer();
    expect(fermes).toBe(1);
  });

  it('ne se connecte pas sans jeton d’app (défaut dormant), et ne poste pas de boutons', async () => {
    const store2 = new HiveStore(':memory:');
    const p2 = store2.createProject({ name: 'P2', ownerId: null }).id;
    store2.autoriserConnecteur({
      connecteurId: 'slack',
      projectId: p2,
      portees: ['approbation'],
      canaux: ['C1'],
      usagers: ['U1'],
    });
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
    // Et la demande d'approbation part SANS boutons : un clic n'aboutirait nulle part.
    await h.notifier({
      kind: 'demande_approbation',
      projectId: p2,
      titre: 'T',
      taskId: 'x',
      liaison: { resultId: 1, revueA: null },
    });
    const post = appels.find((c) => c.url.endsWith('chat.postMessage'));
    expect(post).toBeDefined();
    expect(post!.body).not.toContain('"actions"');
    expect(post!.body).toContain('Miellerie');
    store2.close();
  });
});
