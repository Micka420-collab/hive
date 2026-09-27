// Les identifiants d'un agent qui tourne DANS un bac à sable.
//
// ─── LE NŒUD DISAIT « CONTENEUR », ET CHAQUE TÂCHE ÉCHOUAIT ──────────────────
//
// Le bac (conteneur ou bubblewrap) donne à l'agent un HOME éphémère et ne monte
// jamais celui du membre. La session ouverte par `claude login` (`~/.claude`)
// n'y entre donc pas — et pourtant elle comptait comme identifiant. Le nœud
// annonçait un vrai bac à sable, puis chaque tâche échouait « non
// authentifié » : un échec d'infrastructure, réaffecté, en boucle.
//
// Deux décisions tranchent le cas, et ce fichier les tient :
//
//   · sous bac, seules comptent les clés passées par leur NOM — et deux jetons
//     sans navigateur rejoignent la liste : `CLAUDE_CODE_OAUTH_TOKEN`
//     (l'abonnement, `claude setup-token`) et `CODEX_API_KEY` (la clé que
//     `codex exec` lit). Mesuré sur les CLI réels : Claude Code 2.1.283 dans un
//     HOME vide répond « Not logged in » sans le jeton, et une erreur d'OAuth
//     avec ; codex-cli 0.156.0 n'envoie AUCUNE authentification avec la seule
//     `OPENAI_API_KEY`, et envoie `CODEX_API_KEY` ;
//   · ces jetons valent l'abonnement entier : jamais sondés, jamais dans argv,
//     jamais dans le pont MCP.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AgentAdapter } from '../src/adapters/index.js';
import { DELEGATION_BRIDGE_SOURCE } from '../src/adapters/delegation-bridge.js';
import {
  AGENT_TYPES,
  SECRETS_JAMAIS_SONDES,
  agentCredentialEnv,
  envSonde,
  requisitionSiCredentialsManquantes,
} from '../src/node-client/agent-detect.js';
import {
  deciderAvecPreflight,
  isolementDeclareDe,
  optionBac,
  preparerBac,
  type OutilsBac,
} from '../src/node-client/bac.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { diagnostiquerAgents } from '../src/node-client/connexion.js';
import { fournisseurParNom, type Fournisseur } from '../src/node-client/isolement.js';
import { requisitionDepuisEchecInfra } from '../src/shared/requisition-infra.js';
import { CODE } from '../src/codes-sortie.js';

const BWRAP = fournisseurParNom('bubblewrap') as Fournisseur;
const PODMAN = fournisseurParNom('podman') as Fournisseur;
const MAISON = '/home/membre';
/** Le poste a ouvert une session `claude login` — et rien d'autre. */
const sessionClaude = (chemin: string): boolean => chemin === path.posix.join(MAISON, '.claude');

describe('LES JETONS SANS NAVIGATEUR TRAVERSENT LE BAC PAR LEUR NOM', () => {
  it('Claude Code reçoit CLAUDE_CODE_OAUTH_TOKEN, Codex reçoit CODEX_API_KEY', () => {
    expect(agentCredentialEnv('claude-code')).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(agentCredentialEnv('codex')).toContain('CODEX_API_KEY');
    // Et pas l'inverse : un agent ne reçoit que SES identifiants.
    expect(agentCredentialEnv('codex')).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(agentCredentialEnv('claude-code')).not.toContain('CODEX_API_KEY');
  });

  it('ils valent un abonnement : AUCUNE sonde ne les reçoit', () => {
    expect(SECRETS_JAMAIS_SONDES).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(SECRETS_JAMAIS_SONDES).toContain('CODEX_API_KEY');
    const sonde = envSonde({
      PATH: '/usr/bin',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abonnement',
      CODEX_API_KEY: 'sk-codex',
    });
    expect(sonde).toEqual({ PATH: '/usr/bin' });
  });

  it('TOUTE clé qu’un agent reçoit est retirée des sondes — la liste ne peut plus distancer', () => {
    // La garde de `agent-du-noeud.test.ts` relit `main.ts` et `join.ts` ; les
    // jetons ajoutés ici n'y sont pas lus, ils sont TRANSMIS. On juge donc ce
    // que chaque agent reçoit réellement.
    for (const agent of AGENT_TYPES) {
      const secrets = agentCredentialEnv(agent).filter((n) => /(_TOKEN|_SECRET|_API_KEY)$/.test(n));
      const oublies = secrets.filter((n) => !SECRETS_JAMAIS_SONDES.includes(n));
      expect(oublies, `${agent} : clé transmise mais sondable`).toEqual([]);
    }
  });

  it('le pont MCP les efface — il n’appelle aucun modèle', () => {
    // On exécute la VRAIE source du pont, sans arguments : elle efface ses
    // secrets, sort en erreur d'usage, puis la ligne ajoutée dit ce qui reste.
    // Les deux jetons sont NOMMÉS, pas seulement lus dans la liste : le pont en
    // portait une copie à la main, où ils manquaient.
    const noms = [
      ...new Set([...SECRETS_JAMAIS_SONDES, 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY']),
    ];
    const secrets = Object.fromEntries(noms.map((n) => [n, `valeur-${n}`]));
    const r = spawnSync(
      process.execPath,
      [
        '--eval',
        `${DELEGATION_BRIDGE_SOURCE}\nprocess.stdout.write(JSON.stringify(Object.keys(process.env)));`,
      ],
      {
        env: { ...secrets, PATH: process.env.PATH, HIVE_TEMOIN_NON_SECRET: 'reste' },
        encoding: 'utf8',
      },
    );
    const restants = JSON.parse(r.stdout) as string[];
    expect(restants, 'le témoin prouve que la liste est lue').toContain('HIVE_TEMOIN_NON_SECRET');
    for (const nom of noms) expect(restants, nom).not.toContain(nom);
  });
});

describe('UNE SESSION DE L’HÔTE NE COMPTE PAS DANS LE BAC', () => {
  const env = { HOME: MAISON };
  const opts = { existe: sessionClaude, plateforme: 'linux' } as const;

  it('hors bac, `~/.claude` suffit ; dans le bac, il faut nommer le jeton', () => {
    expect(requisitionSiCredentialsManquantes('claude-code', env, opts)).toBeNull();
    const dansLeBac = requisitionSiCredentialsManquantes('claude-code', env, {
      ...opts,
      sessionsHote: false,
    });
    expect(dansLeBac?.genre).toBe('cle_api');
    // Le libellé ne bouge pas : c'est lui que la Chambre traduit en variable.
    expect(dansLeBac?.libelle).toBe('Clé ou session Anthropic (Claude Code)');
    expect(dansLeBac?.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(dansLeBac?.detail).toContain('claude setup-token');
    expect(dansLeBac?.detail).toContain('ANTHROPIC_API_KEY');
    expect(dansLeBac?.detail).not.toContain('claude login');
  });

  it('le jeton d’abonnement, seul, authentifie Claude Code — dans le bac comme dehors', () => {
    const avecJeton = { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' };
    for (const sessionsHote of [true, false]) {
      expect(
        requisitionSiCredentialsManquantes('claude-code', avecJeton, {
          existe: () => false,
          sessionsHote,
        }),
      ).toBeNull();
    }
  });

  it('CODEX_API_KEY, seule, authentifie Codex', () => {
    expect(
      requisitionSiCredentialsManquantes(
        'codex',
        { CODEX_API_KEY: 'sk-x' },
        { sessionsHote: false },
      ),
    ).toBeNull();
    const sans = requisitionSiCredentialsManquantes('codex', {}, { sessionsHote: false });
    expect(sans?.detail).toContain('CODEX_API_KEY');
  });

  it('Cursor et Grok : leur session de l’hôte reste dehors, elle aussi', () => {
    const tout = (): boolean => true;
    const grokHome = { HOME: MAISON, GROK_HOME: '/home/membre/.grok' };
    expect(requisitionSiCredentialsManquantes('cursor', env, { existe: tout })).toBeNull();
    expect(requisitionSiCredentialsManquantes('grok', grokHome, { existe: tout })).toBeNull();
    const cursor = requisitionSiCredentialsManquantes('cursor', env, {
      existe: tout,
      sessionsHote: false,
    });
    const grok = requisitionSiCredentialsManquantes('grok', grokHome, {
      existe: tout,
      sessionsHote: false,
    });
    expect(cursor?.detail).toContain('CURSOR_API_KEY');
    expect(grok?.detail).toContain('XAI_API_KEY');
  });

  it('l’échec « non authentifié » en pleine tâche réclame lui aussi le jeton', () => {
    // Sans ça, la session de l'hôte faisait conclure « rien ne manque », et la
    // tâche retombait sur une réquisition générique qui ne nomme rien.
    const req = requisitionDepuisEchecInfra(
      'claude-code',
      'Not logged in · Please run /login',
      'Écrire le module',
      env,
      { sessionsHote: false },
    );
    expect(req?.genre).toBe('cle_api');
    expect(req?.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('le constat envoyé au hub ne dit pas « clé présente » sur la foi d’une session invisible', async () => {
    const poste = (sessionsHote: boolean) =>
      diagnostiquerAgents({
        agentsPresents: async () => ['claude-code'],
        env,
        existe: sessionClaude,
        plateforme: 'linux',
        sessionsHote,
      });
    const dehors = (await poste(true)).find((e) => e.agent === 'claude-code');
    const dedans = (await poste(false)).find((e) => e.agent === 'claude-code');
    expect(dehors?.cle).toBe('presente');
    expect(dedans?.cle).toBe('absente');
  });
});

describe('LE BAC NE S’ANNONCE PAS QUAND L’AGENT N’Y SERAIT PAS AUTHENTIFIÉ', () => {
  /** Une machine où `fournisseur` répond, et où le preflight réussit. */
  function machine(fournisseur: Fournisseur, existe: (chemin: string) => boolean = sessionClaude) {
    const sondes: string[] = [];
    const outils: OutilsBac = {
      trouver: async () => fournisseur,
      sonderAgent: async (_f, bin) => {
        sondes.push(bin);
        return { executable: true, motif: `agent « ${bin} » exécutable dans le bac` };
      },
      existe,
      plateforme: 'linux',
    };
    return { outils, sondes };
  }

  it('« auto » + session de l’hôte seule : repli ANNONCÉ, qui nomme le jeton à poser', async () => {
    const { outils, sondes } = machine(BWRAP);
    const bac = await preparerBac({ HOME: MAISON }, 'claude-code', outils);
    expect(bac.decision).toMatchObject({ isole: false, niveau: 'processus', refuse: false });
    expect(bac.decision.motif).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(bac.decision.motif).toMatch(/repli explicite/);
    expect(bac.codeSortie).toBe(CODE.SUCCES);
    // Rien d'isolé ne part au client, et le hub apprend la vérité.
    expect(optionBac(bac, ['HOME'])).toEqual({});
    expect(isolementDeclareDe(bac)).toEqual({ niveau: 'processus' });
    // Et aucun preflight inutile : l'agent n'aurait pas pu s'authentifier.
    expect(sondes).toEqual([]);
  });

  it('« exige » + session de l’hôte seule : le nœud REFUSE, et dit quoi poser', async () => {
    const { outils } = machine(PODMAN);
    const bac = await preparerBac({ HOME: MAISON, HIVE_ISOLEMENT: 'exige' }, 'claude-code', outils);
    expect(bac.refuse).toBe(true);
    expect(bac.codeSortie).toBe(CODE.REFUS_SECURITE);
    expect(bac.decision.motif).toContain('HIVE_ISOLEMENT=exige');
    expect(bac.decision.motif).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('avec le jeton, le bac tient — preflight de l’agent PUIS de Node', async () => {
    const { outils, sondes } = machine(BWRAP);
    const bac = await preparerBac(
      { HOME: MAISON, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' },
      'claude-code',
      outils,
    );
    expect(bac.decision).toMatchObject({ isole: true, niveau: 'conteneur' });
    expect(isolementDeclareDe(bac)).toEqual({ niveau: 'conteneur', fournisseur: 'bubblewrap' });
    expect(sondes).toEqual(['claude', 'node']);
  });

  it('sans aucun identifiant nulle part, le bac reste : sortir n’authentifierait rien', async () => {
    // La réquisition nommera la variable ; poser la clé dans `.env` puis
    // Accorder reprend la tâche DANS le bac — un repli ici l'aurait fait
    // tourner à découvert pour rien.
    const { outils } = machine(BWRAP, () => false);
    const bac = await preparerBac({ HOME: MAISON }, 'claude-code', outils);
    expect(bac.decision.isole).toBe(true);
  });

  it('bubblewrap n’a pas d’image : aucun message ne lui en prête une', async () => {
    const { outils } = machine(BWRAP);
    const bac = await preparerBac(
      { HOME: MAISON, ANTHROPIC_API_KEY: 'sk-x' },
      'claude-code',
      outils,
    );
    const preflight = bac.lignes.find((l) => l.includes('Preflight'));
    expect(preflight).toContain('exécutable dans le bac');
    expect(preflight).not.toContain('image');

    const echec = deciderAvecPreflight('auto', BWRAP, 'docker.io/library/node:20-slim', {
      executable: false,
      motif: 'agent « claude » absent ou non exécutable dans le bac',
    });
    expect(echec.decision.motif).not.toContain('image');
  });

  it('un conteneur, lui, dit toujours dans QUELLE image il a cherché', async () => {
    const { outils } = machine(PODMAN);
    const bac = await preparerBac(
      { HOME: MAISON, ANTHROPIC_API_KEY: 'sk-x', HIVE_ISOLEMENT_IMAGE: 'hive-agent:local' },
      'claude-code',
      outils,
    );
    expect(bac.lignes.find((l) => l.includes('Preflight'))).toContain('(image hive-agent:local)');
    const echec = deciderAvecPreflight('auto', PODMAN, 'hive-agent:local', {
      executable: false,
      motif: 'agent absent',
    });
    expect(echec.decision.motif).toContain('(image hive-agent:local)');
  });
});

describe('LE NŒUD DANS UN BAC RÉCLAME LE JETON, PAS UN `claude login`', () => {
  let racine = '';
  afterEach(() => {
    vi.unstubAllEnvs();
    if (racine) rmSync(racine, { recursive: true, force: true });
    racine = '';
  });

  it('à l’inscription, la réquisition nomme CLAUDE_CODE_OAUTH_TOKEN malgré ~/.claude', async () => {
    // Le poste a une session `claude login` — hors bac, rien ne manquerait.
    racine = mkdtempSync(path.join(os.tmpdir(), 'hive-identifiants-bac-'));
    const maison = path.join(racine, 'maison');
    mkdirSync(path.join(maison, '.claude'), { recursive: true });
    vi.stubEnv('HOME', maison);
    vi.stubEnv('USERPROFILE', maison);
    for (const cle of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) {
      vi.stubEnv(cle, '');
    }

    const hub = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const requisition = new Promise<Record<string, unknown>>((resolve) => {
      hub.on('connection', (ws) => {
        ws.on('message', (brut) => {
          const msg = JSON.parse(String(brut)) as Record<string, unknown>;
          if (msg.type === 'register')
            ws.send(JSON.stringify({ type: 'registered', nodeId: 'n-bac' }));
          if (msg.type === 'requisition_open') resolve(msg);
        });
      });
    });
    await new Promise<void>((resolve) => hub.once('listening', () => resolve()));
    const { port } = hub.address() as { port: number };
    const adapter: AgentAdapter = {
      name: 'claude-code',
      run: async () => ({ success: true, diff: '', logs: '', subAgents: [] }),
    };
    const client = new HiveNodeClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: 'jeton-de-ruche-suffisamment-long',
      name: 'poste-bac',
      ownerName: 'membre',
      agentType: 'claude-code',
      nodeId: 'n-bac',
      maxConcurrency: 1,
      workRoot: path.join(racine, 'travail'),
      adapter,
      quiet: true,
      bac: { fournisseur: BWRAP, variables: [], image: 'sans-objet' },
    });
    try {
      client.start();
      const msg = await requisition;
      expect(msg).toMatchObject({
        genre: 'cle_api',
        libelle: 'Clé ou session Anthropic (Claude Code)',
      });
      expect(String(msg.detail)).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    } finally {
      client.stop();
      await new Promise<void>((resolve) => hub.close(() => resolve()));
    }
  }, 15_000);
});
