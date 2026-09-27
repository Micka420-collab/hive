// Le hub des connecteurs, côté SORTANT et Socket Mode réel : ce qui part vers
// l'extérieur (portée exigée selon le mode, caviardage de ce qui part, issue
// réelle d'un test) et un aller-retour Socket Mode contre un FAUX SERVEUR
// WebSocket local — le paquet `ws` de production, pas un double en mémoire.
// La preuve VIVE contre un vrai atelier Slack demande des identifiants
// d'atelier (fournis par l'hôte) : elle est hors de cette machine.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { HiveStore } from '../src/orchestrator/store.js';
import { HubConnecteurs, type ResultatRevueConnecteur } from '../src/orchestrator/connecteurs.js';
import { ENV_WEBHOOK_SECRET, ENV_WEBHOOK_URL } from '../src/connectors/webhook/definition.js';
import { ENV_SLACK_APP, ENV_SLACK_BOT } from '../src/connectors/slack/definition.js';
import { ACTION_APPROUVER } from '../src/connectors/slack/messages.js';
import type { FetchLike } from '../src/connectors/webhook/envoi.js';
import type { SlackFetch, WsLike } from '../src/connectors/slack/client.js';

const URL_HOOK = 'https://recepteur.test/hook?cle=jeton-dans-l-url-1234';
const SECRET_HMAC = 'secret-hmac-du-webhook-de-test';
/** Une valeur d'identification de l'env Queen — elle ne doit JAMAIS partir. */
const JETON_RUCHE = 'jeton-de-ruche-tres-secret-0042';

describe('HubConnecteurs — ce qui part vers l’extérieur', () => {
  let store: HiveStore;
  let projectId: string;
  let recus: Array<{ url: string; body: string }>;
  let statut: number;

  const env = {
    [ENV_WEBHOOK_URL]: URL_HOOK,
    [ENV_WEBHOOK_SECRET]: SECRET_HMAC,
    HIVE_TOKEN: JETON_RUCHE,
  } as NodeJS.ProcessEnv;

  const fetchWebhook: FetchLike = async (url, init) => {
    recus.push({ url, body: init.body });
    return { ok: statut >= 200 && statut < 300, status: statut };
  };

  const hub = (): HubConnecteurs =>
    new HubConnecteurs({
      store,
      env,
      fetchWebhook,
      appliquerRevue: (): ResultatRevueConnecteur => 'applique',
    });

  beforeEach(() => {
    store = new HiveStore(':memory:');
    projectId = store.createProject({ name: 'P', ownerId: null }).id;
    recus = [];
    statut = 200;
    store.autoriserConnecteur({ connecteurId: 'webhook', projectId, portees: ['notification'] });
  });

  afterEach(() => store.close());

  it('le webhook (lecture seule, `notification` seule) POUSSE une demande d’approbation', async () => {
    // Avant : la demande d'approbation exigeait `approbation` chez TOUS les
    // connecteurs — une portée que le webhook ne peut pas porter. Elle ne
    // partait donc jamais, alors que sa définition l'annonce.
    await hub().notifier({
      kind: 'demande_approbation',
      projectId,
      titre: 'Relire la production',
      taskId: 't-1',
    });
    expect(recus).toHaveLength(1);
    expect(JSON.parse(recus[0]!.body)).toMatchObject({
      kind: 'demande_approbation',
      taskId: 't-1',
    });
    expect(store.listerJournalConnecteurs({ projectId })[0]).toMatchObject({
      acte: 'demande_approbation',
      portee: 'notification',
      resultat: 'ok',
    });
  });

  it('caviarde ce qui PART, pas seulement ce qui est journalisé', async () => {
    // Un titre de tâche est écrit par un humain ou un agent : une clé collée
    // par erreur y partait en clair vers le récepteur (et Slack la garde).
    await hub().notifier({
      kind: 'blocage',
      projectId,
      titre: `Échec avec ${JETON_RUCHE}`,
      corps: 'motif : ghp_0123456789abcdefghijABCDEFGHIJ012345 refusé',
      taskId: 't-2',
    });
    expect(recus).toHaveLength(1);
    const corps = recus[0]!.body;
    expect(corps).not.toContain(JETON_RUCHE);
    expect(corps).not.toContain('ghp_0123456789abcdefghij');
    expect(corps).toContain('[secret]');
    const entree = store.listerJournalConnecteurs({ projectId })[0]!;
    expect(entree.apercu).not.toContain(JETON_RUCHE);
    // L'empreinte journalisée est celle des octets RÉELLEMENT envoyés.
    const { createHash } = await import('node:crypto');
    expect(entree.chargeDigest).toBe(createHash('sha256').update(corps, 'utf8').digest('hex'));
  });

  it('le bouton « tester » rend l’issue RÉELLE : un 500 n’est pas « envoyé »', async () => {
    statut = 500;
    const r = await hub().tester(
      'webhook',
      { kind: 'resume_mission', projectId, titre: 'Test' },
      'compte:u1',
    );
    expect(r).toEqual({ envoye: false, motif: 'statut 500' });
    expect(store.listerJournalConnecteurs({ projectId })[0]).toMatchObject({
      resultat: 'echec',
      qui: 'compte:u1',
    });
  });

  it('un échec réseau qui cite l’URL ne laisse pas son jeton au journal', async () => {
    const h = new HubConnecteurs({
      store,
      env,
      fetchWebhook: async () => {
        throw new Error(`connexion refusée : ${URL_HOOK}`);
      },
      appliquerRevue: () => 'applique',
    });
    const r = await h.tester('webhook', { kind: 'decision', projectId, titre: 'x' }, 'ruche');
    expect(r.envoye).toBe(false);
    expect(JSON.stringify(r)).not.toContain('jeton-dans-l-url');
    expect(store.listerJournalConnecteurs({ projectId })[0]!.apercu).not.toContain(
      'jeton-dans-l-url',
    );
  });

  it('sans autorisation sur le projet, rien ne part — et le test dit pourquoi', async () => {
    store.revoquerConnecteur('webhook', projectId);
    await hub().notifier({ kind: 'decision', projectId, titre: 'x' });
    expect(recus).toHaveLength(0);
    const r = await hub().tester('webhook', { kind: 'decision', projectId, titre: 'x' }, 'ruche');
    expect(r).toEqual({ envoye: false, motif: 'non autorisé sur ce projet' });
  });
});

describe('HubConnecteurs — Socket Mode contre un faux serveur WebSocket', () => {
  let wss: WebSocketServer;
  let store: HiveStore;
  let hub: HubConnecteurs | null = null;

  beforeEach(async () => {
    store = new HiveStore(':memory:');
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  });

  afterEach(async () => {
    hub?.fermer();
    hub = null;
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    store.close();
  });

  it('un clic « Approuver » d’un canal ET d’un usager inscrits rejoint la revue, acquitté', async () => {
    const projectId = store.createProject({ name: 'P', ownerId: null }).id;
    const taskId = store.createTask({ projectId, title: 'T', prompt: 'p' }).id;
    store.autoriserConnecteur({
      connecteurId: 'slack',
      projectId,
      portees: ['approbation'],
      canaux: ['C01'],
      usagers: ['U01'],
    });
    const port = (wss.address() as { port: number }).port;
    const ouvertures: string[] = [];
    const fetchSlack: SlackFetch = async (url, init) => {
      ouvertures.push(`${url} ${init.headers.authorization ?? ''}`);
      return {
        status: 200,
        json: async () => ({ ok: true, url: `ws://127.0.0.1:${port}/socket` }),
      };
    };
    const revues: Array<{ taskId: string; verdict: string }> = [];
    hub = new HubConnecteurs({
      store,
      env: { [ENV_SLACK_BOT]: 'xoxb-faux', [ENV_SLACK_APP]: 'xapp-faux' } as NodeJS.ProcessEnv,
      fetchSlack,
      wsFactory: (url) => new WebSocket(url) as unknown as WsLike,
      appliquerRevue: (t, v): ResultatRevueConnecteur => {
        revues.push({ taskId: t, verdict: v });
        return 'applique';
      },
    });

    const socket = new Promise<WebSocket>((resolve) => wss.once('connection', resolve));
    await hub.demarrer();
    const cote = await socket;
    // Le Socket Mode s'ouvre avec le jeton d'APP, jamais celui du bot.
    expect(ouvertures).toEqual(['https://slack.com/api/apps.connections.open Bearer xapp-faux']);

    const accuse = new Promise<string>((resolve) =>
      cote.once('message', (d: Buffer) => resolve(d.toString('utf8'))),
    );
    cote.send(
      JSON.stringify({
        type: 'interactive',
        envelope_id: 'env-42',
        payload: {
          type: 'block_actions',
          user: { id: 'U01' },
          channel: { id: 'C01' },
          actions: [
            {
              action_id: ACTION_APPROUVER,
              value: taskId,
              block_id: `hive_approbation:${projectId}`,
            },
          ],
        },
      }),
    );
    expect(JSON.parse(await accuse)).toEqual({ envelope_id: 'env-42' });
    // Le traitement suit l'accusé dans le même tour : on attend l'état observable.
    await expect.poll(() => revues.length).toBe(1);
    expect(revues[0]).toEqual({ taskId, verdict: 'approved' });
    expect(store.listerJournalConnecteurs({ projectId })[0]).toMatchObject({
      acte: 'approbation_recue',
      resultat: 'ok',
      qui: 'slack:U01',
    });
  });
});
