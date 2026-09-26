// Le bac à sable DÉCLARÉ par un nœud — du démarrage (`bac.ts`) jusqu'à la
// Reine (protocole, store) et retour par l'API.
//
// Trois règles tenues ici :
//   · la déclaration dit ce que le nœud a DÉCIDÉ au démarrage, jamais mieux :
//     sans moteur, pas de « conteneur » ;
//   · mal formée, l'inscription est refusée (doctrine du parseur de register),
//     bien formée, elle est reconstruite — rien d'autre ne passe ;
//   · une inscription qui ne la répète pas l'EFFACE : une affirmation de
//     sécurité ne survit pas au redémarrage qui ne la redit pas.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { annonce, codeDuBac, isolementDeclareDe, type Bac } from '../src/node-client/bac.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { decider, IMAGE_DEFAUT, type Fournisseur } from '../src/node-client/isolement.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { parseClientMessage } from '../src/shared/protocol.js';
import type { HiveNode } from '../src/shared/types.js';

const PODMAN: Fournisseur = {
  nom: 'podman',
  bin: 'podman',
  niveau: 'conteneur',
  installation: 'https://podman.io/docs/installation',
  garanties: ['seul le répertoire de la tâche est visible'],
};

function bacDe(mode: 'off' | 'auto' | 'exige', fournisseur: Fournisseur | null): Bac {
  const decision = decider(mode, fournisseur);
  return {
    decision,
    fournisseur,
    image: IMAGE_DEFAUT,
    lignes: annonce(decision, fournisseur),
    refuse: decision.refuse,
    codeSortie: codeDuBac(decision.refuse),
  };
}

const inscription = (isolement: unknown) =>
  parseClientMessage(
    JSON.stringify({
      type: 'register',
      token: 'jeton-suffisamment-long-pour-le-banc',
      name: 'poste',
      ownerName: 'banc',
      agentType: 'claude-code',
      maxConcurrency: 1,
      ...(isolement === undefined ? {} : { isolement }),
    }),
  );

describe('le bac à sable déclaré — ce que le nœud dit de lui-même', () => {
  it('DIT LE NIVEAU RÉELLEMENT DÉCIDÉ AU DÉMARRAGE — jamais « conteneur » sans moteur', () => {
    expect(isolementDeclareDe(bacDe('auto', PODMAN))).toEqual({
      niveau: 'conteneur',
      fournisseur: 'podman',
    });
    expect(isolementDeclareDe(bacDe('auto', null))).toEqual({ niveau: 'processus' });
    expect(isolementDeclareDe(bacDe('off', PODMAN)), 'isolement coupé : pas de bac').toEqual({
      niveau: 'processus',
    });
  });

  it('LE PROTOCOLE RECONSTRUIT UNE DÉCLARATION VALIDE, ET REFUSE UNE DÉCLARATION FAUSSE', () => {
    expect(
      inscription({ niveau: 'conteneur', fournisseur: 'docker', verdict: 'sûr' }),
    ).toMatchObject({ isolement: { niveau: 'conteneur', fournisseur: 'docker' } });
    expect(
      (
        inscription({ niveau: 'conteneur', fournisseur: 'docker', verdict: 'sûr' }) as {
          isolement?: Record<string, unknown>;
        }
      )?.isolement,
      'un champ glissé par le nœud ne passe pas',
    ).not.toHaveProperty('verdict');
    expect(inscription({ niveau: 'processus' })).toMatchObject({
      isolement: { niveau: 'processus' },
    });
    expect(inscription(undefined)).not.toHaveProperty('isolement');

    for (const faux of [
      { niveau: 'forteresse' },
      { niveau: 'conteneur', fournisseur: 'Docker Desktop' },
      { niveau: 'conteneur', fournisseur: 42 },
      'conteneur',
      null,
    ]) {
      expect(inscription(faux), JSON.stringify(faux)).toBeNull();
    }
  });

  it('LE STORE LA RANGE, ET L’EFFACE QUAND UNE INSCRIPTION NE LA REDIT PAS', () => {
    const store = new HiveStore(':memory:');
    const base = {
      nodeId: 'n1',
      name: 'poste',
      ownerName: 'banc',
      agentType: 'claude-code',
      maxConcurrency: 1,
    };
    const n = store.registerNode({
      ...base,
      isolement: { niveau: 'conteneur', fournisseur: 'podman' },
    });
    expect(n.isolement).toEqual({ niveau: 'conteneur', fournisseur: 'podman' });
    expect(store.listNodes()[0]?.isolement).toEqual({ niveau: 'conteneur', fournisseur: 'podman' });

    store.registerNode({ ...base, isolement: { niveau: 'processus' } });
    expect(store.getNode('n1')?.isolement, 'la dernière inscription gagne').toEqual({
      niveau: 'processus',
    });

    store.registerNode(base);
    expect(store.getNode('n1'), 'non redit : non déclaré').not.toHaveProperty('isolement');
    store.close();
  });
});

/** Aucun travail n'est confié ici : l'adaptateur n'est jamais appelé. */
const ADAPTATEUR = {
  name: 'banc',
  async run() {
    return { success: true, diff: '', logs: '', subAgents: [] };
  },
};

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let dossier = '';

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

describe('le bac à sable déclaré — d’un vrai nœud jusqu’à l’API de la Reine', () => {
  it('UN VRAI NŒUD LE DÉCLARE, L’API LE REND — et un redémarrage muet l’efface', async () => {
    const JETON = 'jeton-isolement-declare-assez-long';
    dossier = mkdtempSync(path.join(os.tmpdir(), 'isolement-declare-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    const s = serveur;
    const noeud = (isolement?: { niveau: 'conteneur'; fournisseur: string }) =>
      new HiveNodeClient({
        url: `ws://127.0.0.1:${s.port}/ws`,
        token: JETON,
        name: 'poste-isole',
        ownerName: 'banc',
        agentType: 'claude-code',
        maxConcurrency: 1,
        workRoot: path.join(dossier, 'travail'),
        adapter: ADAPTATEUR,
        ...(isolement ? { isolement } : {}),
        quiet: true,
      });
    const lireNoeuds = async (): Promise<HiveNode[]> => {
      const r = await fetch(`http://127.0.0.1:${s.port}/api/state`, {
        headers: { 'x-hive-token': JETON },
      });
      expect(r.status).toBe(200);
      return ((await r.json()) as { nodes: HiveNode[] }).nodes;
    };

    client = noeud({ niveau: 'conteneur', fournisseur: 'podman' });
    client.start();
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    const [declare] = await lireNoeuds();
    expect(declare?.isolement).toEqual({ niveau: 'conteneur', fournisseur: 'podman' });

    // Le même nœud redémarre sans rien déclarer (version antérieure, option
    // retirée) : l'ancien « conteneur » ne doit pas lui survivre.
    const nodeId = declare!.id;
    client.stop();
    await attendre(
      () => s.store.getNode(nodeId)?.status !== 'online',
      'le nœud ne se déconnecte pas',
    );
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${s.port}/ws`,
      token: JETON,
      name: 'poste-isole',
      ownerName: 'banc',
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      adapter: ADAPTATEUR,
      nodeId,
      quiet: true,
    });
    client.start();
    await attendre(() => s.store.getNode(nodeId)?.status === 'online', 'le nœud ne revient pas');
    const [muet] = await lireNoeuds();
    expect(muet?.id).toBe(nodeId);
    expect(muet, 'redémarré sans déclaration : non déclaré').not.toHaveProperty('isolement');
  });
});
