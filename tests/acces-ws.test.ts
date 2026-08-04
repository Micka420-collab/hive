// La révocation, sur le fil.
//
// Tout le reste peut être juste et la fonctionnalité rester fausse si ces trois
// propriétés-là ne tiennent pas :
//
//   1. une clé de nœud ouvre bien le WebSocket ;
//   2. une clé RÉVOQUÉE est refusée — MÊME si son porteur connaît le token
//      maître de la ruche. Sans cela, exclure quelqu'un ne serait qu'un
//      affichage : il lui suffirait de repasser par la porte de service ;
//
//      CE POINT A ÉTÉ ÉCRIT AVANT D'ÊTRE VRAI, et c'est la leçon du lot.
//      La garde ne tenait qu'au `nodeId` ANNONCÉ : mesuré sur serveur réel,
//      `node-exclu` était fermé en 4403 et `node-exclu-bis` était ADMIS. Le
//      banc ci-dessous n'éprouvait que le premier cas, donc il confirmait une
//      garantie qu'il ne mesurait pas — et l'affirmation était recopiée dans
//      `docs/FONCTIONNALITES.md`, à destination des utilisateurs.
//      Voir `les deux portes, après une exclusion` en fin de fichier ;
//   3. exclure quelqu'un COUPE sa connexion en cours. Une exclusion qui n'agit
//      qu'à la prochaine reconnexion laisse le membre exclu travailler — et
//      lire — aussi longtemps qu'il ne redémarre pas.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-maitre-de-la-ruche-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer;
let dir: string;
let base: string;
const ouverts: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-accesws-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'ws.db'),
    simulation: false,
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  for (const ws of ouverts.splice(0)) ws.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** Obtient une clé de nœud en passant par un billet, comme un vrai ami. */
async function obtenirCle(nodeId: string): Promise<string> {
  const bil = (await (
    await fetch(`${base}/api/billets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'ws://127.0.0.1:7777/ws' }),
    })
  ).json()) as { billet: string };
  const rep = await fetch(`${base}/api/rejoindre`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ billet: bil.billet, nodeId }),
  });
  return ((await rep.json()) as { cle: string }).cle;
}

/**
 * Tente un `register` et rend soit l'accusé de réception, soit le code de
 * fermeture. On ne teste jamais « ça n'a pas planté » : on regarde ce que le
 * serveur RÉPOND.
 */
function tenterRegister(
  nodeId: string,
  token: string,
): Promise<{ ok: true; ws: WebSocket } | { ok: false; code: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    ouverts.push(ws);
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'register',
          token,
          nodeId,
          name: nodeId,
          ownerName: 'testeur',
          agentType: 'shell',
          maxConcurrency: 1,
        }),
      );
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'registered') resolve({ ok: true, ws });
    });
    ws.on('close', (code) => resolve({ ok: false, code }));
    ws.on('error', () => {
      /* la fermeture porte déjà l'information */
    });
  });
}

describe('la clé de nœud sur le WebSocket', () => {
  it('une clé valide ouvre la porte', async () => {
    const cle = await obtenirCle('node-alpha');
    const r = await tenterRegister('node-alpha', cle);
    expect(r.ok).toBe(true);
  });

  it('le token MAÎTRE ouvre toujours la porte (compatibilité assumée)', async () => {
    // Couper cet accès aurait déconnecté toutes les ruches existantes au premier
    // `git pull`. Une mise à jour de sécurité qui casse la production ne se
    // déploie jamais — donc elle ne protège personne.
    const r = await tenterRegister('node-historique', TOKEN);
    expect(r.ok).toBe(true);
  });

  it('une clé inventée est refusée', async () => {
    const r = await tenterRegister('node-alpha', 'clé-que-je-viens-d-inventer');
    expect(r).toMatchObject({ ok: false, code: 4401 });
  });

  it('la clé d’un AUTRE nœud ne vaut rien pour celui-ci', async () => {
    // Les clés sont liées à leur nodeId : en emprunter une ne suffit pas.
    const cleA = await obtenirCle('node-a');
    await obtenirCle('node-b');
    const r = await tenterRegister('node-b', cleA);
    expect(r).toMatchObject({ ok: false, code: 4401 });
  });
});

describe('la révocation mord', () => {
  it('une clé révoquée est refusée', async () => {
    const cle = await obtenirCle('node-exclu');
    await fetch(`${base}/api/membres/node-exclu`, { method: 'DELETE', headers });
    const r = await tenterRegister('node-exclu', cle);
    expect(r).toMatchObject({ ok: false, code: 4403 });
  });

  it('UN MEMBRE EXCLU NE PEUT PAS RENTRER AVEC LE TOKEN MAÎTRE', async () => {
    // La propriété la plus importante du lot. Si elle tombe, la révocation
    // n'est qu'un affichage : un ancien membre qui a vu passer le token de la
    // ruche (il était dans son ancienne invitation !) rentrerait par la porte
    // de service. C'est précisément pour cela que le verdict « révoqué » est
    // distinct de « refusé », et qu'il court-circuite le repli.
    await obtenirCle('node-traitre');
    await fetch(`${base}/api/membres/node-traitre`, { method: 'DELETE', headers });
    const r = await tenterRegister('node-traitre', TOKEN);
    expect(r).toMatchObject({ ok: false, code: 4403 });
  });

  it('exclure COUPE la connexion en cours, sans attendre une reconnexion', async () => {
    const cle = await obtenirCle('node-en-vol');
    const r = await tenterRegister('node-en-vol', cle);
    expect(r.ok).toBe(true);
    const ws = (r as { ok: true; ws: WebSocket }).ws;

    const ferme = new Promise<number>((resolve) => ws.on('close', resolve));
    await fetch(`${base}/api/membres/node-en-vol`, { method: 'DELETE', headers });
    expect(await ferme).toBe(4403);
  });

  it('exclure UN membre ne touche pas les autres', async () => {
    const cleA = await obtenirCle('node-a');
    const cleB = await obtenirCle('node-b');
    const rb = await tenterRegister('node-b', cleB);
    expect(rb.ok).toBe(true);

    await fetch(`${base}/api/membres/node-a`, { method: 'DELETE', headers });

    // B est toujours connecté…
    expect((rb as { ok: true; ws: WebSocket }).ws.readyState).toBe(WebSocket.OPEN);
    // …et A ne revient pas.
    expect(await tenterRegister('node-a', cleA)).toMatchObject({ ok: false, code: 4403 });
  });

  it('réadmettre : un nouveau billet redonne une clé, et l’exclusion est levée', async () => {
    // La rotation de clé remet `revokedAt` à NULL. C'est voulu : présenter un
    // billet valide est le geste par lequel l'hôte réadmet quelqu'un.
    const cle = await obtenirCle('node-repenti');
    await fetch(`${base}/api/membres/node-repenti`, { method: 'DELETE', headers });
    expect(await tenterRegister('node-repenti', cle)).toMatchObject({ ok: false, code: 4403 });

    const nouvelle = await obtenirCle('node-repenti');
    expect(nouvelle).not.toBe(cle);
    expect((await tenterRegister('node-repenti', nouvelle)).ok).toBe(true);
  });
});

// ─── LA SECONDE PORTE, APRÈS UNE EXCLUSION ───────────────────────────────────
//
// Tout ce qui précède éprouve la porte du NŒUD. Rien n'éprouvait la porte du
// TOKEN MAÎTRE une fois l'exclusion prononcée — et c'est par là que l'exclu
// revenait, en changeant simplement le nom qu'il annonce.
//
// Le déclencheur est la PREMIÈRE EXCLUSION, jamais la mise à jour : les deux
// premiers bancs ci-dessous forment une paire, et c'est leur CONTRASTE qui
// porte la garantie. Le même geste, à la même seconde, avec le même token :
// admis dans une ruche qui n'a exclu personne, refusé dans une ruche qui a
// exclu. Un banc qui ne vérifierait que le refus laisserait passer une règle
// qui casse toutes les ruches du monde.

describe('les deux portes, après une exclusion', () => {
  it('UN EXCLU NE REVIENT PAS SOUS UN AUTRE NOM — la faille mesurée, refermée', async () => {
    // Le geste exact qui marchait : exclu sous `node-exclu`, il se represente
    // en `node-exclu-bis` avec le token de ruche, qu'il a forcément connu.
    const cle = await obtenirCle('node-exclu');
    expect((await tenterRegister('node-exclu', cle)).ok).toBe(true);
    await fetch(`${base}/api/membres/node-exclu`, { method: 'DELETE', headers });

    expect(await tenterRegister('node-exclu', TOKEN)).toMatchObject({ ok: false, code: 4403 });
    expect(await tenterRegister('node-exclu-bis', TOKEN)).toMatchObject({ ok: false, code: 4403 });
  });

  it('UNE RUCHE QUI N’A EXCLU PERSONNE NE CHANGE EN RIEN', async () => {
    // L'autre moitié de la garantie. Sans ce banc, on pourrait « corriger » la
    // faille en fermant le token maître pour tout le monde — ce qui casserait
    // toutes les ruches existantes au premier `git pull`, donc ne serait jamais
    // déployé, donc ne protégerait personne.
    expect((await tenterRegister('node-tout-neuf', TOKEN)).ok).toBe(true);
  });

  it('UNE MACHINE DÉJÀ CONNUE GARDE SA PORTE, MÊME APRÈS UNE EXCLUSION', async () => {
    // La condition qui rend le durcissement déployable : on ferme aux
    // INCONNUES, pas aux machines historiques de la ruche.
    const cle = await obtenirCle('node-historique');
    expect((await tenterRegister('node-historique', cle)).ok).toBe(true);

    const jetable = await obtenirCle('node-jetable');
    expect(jetable).toBeTruthy();
    await fetch(`${base}/api/membres/node-jetable`, { method: 'DELETE', headers });

    // La ruche a exclu quelqu'un, mais celle-ci était déjà là.
    expect((await tenterRegister('node-historique', TOKEN)).ok).toBe(true);
  });

  it('UNE MACHINE D’AVANT LES BILLETS SURVIT À L’EXCLUSION D’UNE AUTRE', async () => {
    // LE BANC QUE LA MUTATION A RÉCLAMÉ, et le plus important du lot.
    //
    // Les autres « machines connues » de ce fichier ont toutes obtenu une CLÉ
    // par billet : elles ont donc une ligne dans `node_keys`. La machine
    // vraiment historique n'en a pas — elle s'est enregistrée au token maître,
    // avant que les billets existent, et n'est connue que de la table `nodes`.
    //
    // C'est ELLE que la promesse « aucune ruche ne casse au premier git pull »
    // protège. Sans ce banc, supprimer le test `getNode` du câblage restait
    // VERT (mutation « un nœud connu n'est plus reconnu » : survivante), et la
    // seule garantie de compatibilité du lot ne reposait sur rien.
    expect((await tenterRegister('node-ancetre', TOKEN)).ok).toBe(true);

    const jetable = await obtenirCle('node-jetable-3');
    expect(jetable).toBeTruthy();
    await fetch(`${base}/api/membres/node-jetable-3`, { method: 'DELETE', headers });

    // La ruche a exclu quelqu'un ; l'ancêtre, elle, n'est pas dérangée.
    expect((await tenterRegister('node-ancetre', TOKEN)).ok).toBe(true);
  });

  it('UNE MACHINE INVITÉE MAIS JAMAIS VENUE EST CONNUE AUSSI', async () => {
    // L'autre moitié de « connue », réclamée par la mutation elle aussi.
    //
    // Deux tables disent qu'une machine est connue, et elles ne se recouvrent
    // pas : `nodes` (elle s'est déjà présentée) et `node_keys` (l'hôte lui a
    // remis une clé). Une machine invitée qui n'est jamais venue n'existe QUE
    // dans la seconde.
    //
    // Elle arrive ici parce qu'elle présente le token de ruche plutôt que sa
    // clé — le cas d'un script qui lit `HIVE_TOKEN` dans `.env`. L'hôte l'a
    // invitée explicitement : la refuser au motif qu'elle n'est pas encore
    // venue serait punir le geste d'invitation.
    const cle = await obtenirCle('node-invite-jamais-venue');
    expect(cle).toBeTruthy();

    const jetable = await obtenirCle('node-jetable-4');
    expect(jetable).toBeTruthy();
    await fetch(`${base}/api/membres/node-jetable-4`, { method: 'DELETE', headers });

    expect((await tenterRegister('node-invite-jamais-venue', TOKEN)).ok).toBe(true);
  });

  it('LE RÉSIDU EST DIT PLUTÔT QUE CACHÉ — usurper un nom CONNU reste possible', async () => {
    // Ce banc n'affirme pas que tout est fermé : il ÉPINGLE ce qui reste
    // ouvert, pour que personne ne le redécouvre en croyant à une régression,
    // et pour que la documentation ne se remette pas à promettre trop.
    //
    // Le porteur du token maître peut encore se faire passer pour une machine
    // connue. Ce n'est pas discret : ça COUPE la connexion de la vraie machine
    // (4000, « remplacé par une nouvelle connexion »). La vraie réponse à un
    // token qui a fui est de changer le token, pas d'exclure un membre.
    const cle = await obtenirCle('node-titulaire');
    expect((await tenterRegister('node-titulaire', cle)).ok).toBe(true);

    const jetable = await obtenirCle('node-jetable-2');
    expect(jetable).toBeTruthy();
    await fetch(`${base}/api/membres/node-jetable-2`, { method: 'DELETE', headers });

    expect((await tenterRegister('node-titulaire', TOKEN)).ok).toBe(true);
  });
});
