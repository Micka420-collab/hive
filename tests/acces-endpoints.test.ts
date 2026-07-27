// Le trou de vol, de bout en bout : créer un billet, l'échanger, se connecter
// avec sa clé, se faire exclure.
//
// Ces tests portent sur ce qui SE PASSE RÉELLEMENT sur le fil, pas sur les
// intentions du module pur. Une sécurité qui n'est vraie qu'en théorie — un
// billet à usage unique consommable deux fois par deux requêtes simultanées,
// une révocation qui laisse la connexion ouverte — est une sécurité fausse.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { decoderBillet } from '../src/shared/acces.js';

const TOKEN = 'jeton-acces-assez-long-pour-passer';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
const LIMITES = { id: 64, nom: 120 };

let server: HiveServer;
let dir: string;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-acces-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'acces.db'),
    simulation: false,
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** Crée un billet et rend la réponse JSON. */
async function creerBillet(body: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${base}/api/billets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: 'ws://127.0.0.1:7777/ws', ...body }),
  });
}

async function rejoindre(billet: string, nodeId: string): Promise<Response> {
  return fetch(`${base}/api/rejoindre`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ billet, nodeId }),
  });
}

describe('créer un billet', () => {
  it('exige le token de la ruche', async () => {
    const rep = await fetch(`${base}/api/billets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(rep.status).toBe(401);
  });

  it('rend un billet décodable, à usage unique et daté', async () => {
    const rep = await creerBillet();
    expect(rep.status).toBe(201);
    const j = (await rep.json()) as Record<string, unknown>;
    expect(j.uses).toBe(1);
    expect(j.transport).toBe('clair_prive');
    expect(typeof j.expiresAt).toBe('number');
    const decode = decoderBillet(j.billet, LIMITES);
    expect(decode).not.toBeNull();
    expect(decode?.url).toBe('ws://127.0.0.1:7777/ws');
  });

  it('le SECRET du billet n’est jamais rangé en base — seulement son empreinte', async () => {
    // C'est la propriété centrale : une base volée ne donne aucun accès.
    const j = (await (await creerBillet()).json()) as { billet: string; id: string };
    const secret = decoderBillet(j.billet, LIMITES)!.secret;
    const range = server.store.getBillet(j.id)!;
    expect(range.secretHash).not.toContain(secret);
    expect(JSON.stringify(range)).not.toContain(secret);
  });

  it('REFUSE le clair vers une adresse publique, et le dit précisément', async () => {
    const rep = await creerBillet({ url: 'ws://ruche.exemple.com/ws' });
    expect(rep.status).toBe(400);
    const j = (await rep.json()) as { error: string; detail: string };
    expect(j.error).toContain('clair');
    // Le message doit nommer ce qui fuite VRAIMENT : pas seulement le billet.
    expect(j.detail).toMatch(/diffs|code source/i);
  });

  it('…sauf si l’hôte le demande explicitement (insecure)', async () => {
    const rep = await creerBillet({ url: 'ws://ruche.exemple.com/ws', insecure: true });
    expect(rep.status).toBe(201);
    expect(((await rep.json()) as { transport: string }).transport).toBe('clair_public');
  });

  it('wss:// public passe sans drapeau : c’est le chemin recommandé', async () => {
    const rep = await creerBillet({ url: 'wss://ruche.exemple.com/ws' });
    expect(rep.status).toBe(201);
    expect(((await rep.json()) as { transport: string }).transport).toBe('sur');
  });

  it('borne le TTL et les usages plutôt que de refuser des valeurs folles', async () => {
    const rep = await creerBillet({ uses: 50, ttlMs: 60_000 });
    expect(rep.status).toBe(201);
    expect(((await rep.json()) as { uses: number }).uses).toBe(50);
    // Au-delà du plafond de schéma, c'est un 400 franc.
    expect((await creerBillet({ uses: 9_999 })).status).toBe(400);
  });
});

describe('échanger un billet', () => {
  it('rend une clé propre au nœud, différente du token de ruche', async () => {
    const j = (await (await creerBillet()).json()) as { billet: string };
    const rep = await rejoindre(j.billet, 'node-alpha');
    expect(rep.status).toBe(201);
    const { cle } = (await rep.json()) as { cle: string };
    expect(cle).toBeTruthy();
    expect(cle).not.toBe(TOKEN); // sinon on aurait juste renommé le partage du maître
  });

  it('la clé n’est pas rangée en clair non plus', async () => {
    const j = (await (await creerBillet()).json()) as { billet: string };
    const { cle } = (await (await rejoindre(j.billet, 'node-alpha')).json()) as { cle: string };
    const range = server.store.getCleNoeud('node-alpha')!;
    expect(range.keyHash).not.toContain(cle);
  });

  it('un billet à usage UNIQUE ne s’échange pas deux fois', async () => {
    const j = (await (await creerBillet()).json()) as { billet: string };
    expect((await rejoindre(j.billet, 'node-a')).status).toBe(201);
    expect((await rejoindre(j.billet, 'node-b')).status).toBe(401);
  });

  it('DEUX ÉCHANGES SIMULTANÉS : un seul gagne (consommation atomique)', async () => {
    // Le cas que `SELECT` puis `UPDATE` aurait laissé passer. Sans atomicité,
    // un billet « à usage unique » en laisserait entrer deux — et l'hôte
    // croirait n'avoir invité qu'une machine.
    const j = (await (await creerBillet()).json()) as { billet: string };
    const reps = await Promise.all(
      Array.from({ length: 8 }, (_, i) => rejoindre(j.billet, `node-course-${i}`)),
    );
    expect(reps.filter((r) => r.status === 201)).toHaveLength(1);
    expect(reps.filter((r) => r.status === 401)).toHaveLength(7);
  });

  it('un billet à N usages en laisse passer exactement N', async () => {
    const j = (await (await creerBillet({ uses: 3 })).json()) as { billet: string };
    const reps = await Promise.all(
      Array.from({ length: 10 }, (_, i) => rejoindre(j.billet, `node-n-${i}`)),
    );
    expect(reps.filter((r) => r.status === 201)).toHaveLength(3);
  });

  it('un billet RÉVOQUÉ ne s’échange plus', async () => {
    const j = (await (await creerBillet()).json()) as { billet: string; id: string };
    const rev = await fetch(`${base}/api/billets/${j.id}`, { method: 'DELETE', headers });
    expect(rev.status).toBe(200);
    expect((await rejoindre(j.billet, 'node-a')).status).toBe(401);
  });

  it('un billet EXPIRÉ ne s’échange plus', async () => {
    const j = (await (await creerBillet({ ttlMs: 60_000 })).json()) as {
      billet: string;
      id: string;
    };
    // On vieillit le billet en base plutôt que l'horloge : le test reste
    // instantané et ne dépend d'aucun minuteur.
    server.store.getBillet(j.id); // s'assure qu'il existe
    (
      server.store as unknown as {
        db: { prepare: (s: string) => { run: (...a: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE invite_tickets SET expiresAt = ? WHERE id = ?')
      .run(Date.now() - 1, j.id);
    expect((await rejoindre(j.billet, 'node-a')).status).toBe(401);
  });

  it('un billet illisible ou au secret faux est refusé SANS révéler lequel', async () => {
    // Distinguer « inconnu » de « mauvais secret » dirait à un inconnu quels
    // identifiants existent. Les deux doivent rendre exactement la même chose.
    const j = (await (await creerBillet()).json()) as { billet: string };
    const decode = decoderBillet(j.billet, LIMITES)!;
    const faux = Buffer.from(
      JSON.stringify({ v: 2, url: decode.url, id: decode.id, s: 'x'.repeat(43) }),
    ).toString('base64url');

    const repFaux = await rejoindre(`hive2_${faux}`, 'node-a');
    const repInconnu = await rejoindre(
      'hive2_' +
        Buffer.from(
          JSON.stringify({ v: 2, url: decode.url, id: 'bil-inexistant', s: 'x'.repeat(43) }),
        ).toString('base64url'),
      'node-a',
    );
    expect(repFaux.status).toBe(401);
    expect(repInconnu.status).toBe(401);
    expect(await repFaux.json()).toEqual(await repInconnu.json());
  });

  it('un identifiant DÉJÀ PRIS est refusé — on n’éjecte pas un membre en place', async () => {
    // Sans cette garde, `INSERT OR REPLACE` faisait une rotation de la clé du
    // nœud visé : n'importe quel porteur d'un billet valide pouvait éjecter un
    // membre déjà installé en réclamant son identifiant. Une fonctionnalité qui
    // sert à protéger les accès ne peut pas offrir ce geste-là.
    const a = (await (await creerBillet()).json()) as { billet: string };
    const c1 = (await (await rejoindre(a.billet, 'node-x')).json()) as { cle: string };

    const b = (await (await creerBillet()).json()) as { billet: string; id: string };
    const rep = await rejoindre(b.billet, 'node-x');
    expect(rep.status).toBe(409);
    expect(((await rep.json()) as { detail: string }).detail).toContain('exclure node-x');

    // La clé du membre en place est INTACTE…
    const range = server.store.getCleNoeud('node-x')!;
    expect(range.revokedAt).toBeNull();
    expect(range.ticketId).not.toBe(b.id);
    // …et le billet du second n'a PAS été brûlé : un refus ne consomme rien.
    expect(server.store.getBillet(b.id)?.usesLeft).toBe(1);
    expect(c1.cle).toBeTruthy();
  });

  it('après une exclusion, l’identifiant redevient disponible', async () => {
    // Le chemin de récupération : « j'ai perdu ma clé ». Il passe par un GESTE
    // HUMAIN de l'hôte, comme le merge et comme le plafond — re-cléer un nœud
    // est une décision, pas un effet de bord d'une requête anonyme.
    const a = (await (await creerBillet()).json()) as { billet: string };
    const c1 = (await (await rejoindre(a.billet, 'node-y')).json()) as { cle: string };
    await fetch(`${base}/api/membres/node-y`, { method: 'DELETE', headers });

    const b = (await (await creerBillet()).json()) as { billet: string };
    const rep = await rejoindre(b.billet, 'node-y');
    expect(rep.status).toBe(201);
    const c2 = (await rep.json()) as { cle: string };
    expect(c2.cle).not.toBe(c1.cle); // vraie rotation, vraiment vérifiée
    expect(server.store.getCleNoeud('node-y')?.revokedAt).toBeNull(); // réadmis
    expect(server.store.listClesNoeuds().filter((c) => c.nodeId === 'node-y')).toHaveLength(1);
  });
});

describe('la garde de débit de /api/rejoindre', () => {
  it('NE compte PAS les réussites : un atelier derrière une seule IP passe', async () => {
    // Le NAT d'un bureau ou d'une école donne UNE adresse à tout le monde.
    // Compter les réussites aurait refusé des gens que l'hôte venait justement
    // d'inviter — et c'était inutile : les réussites sont déjà bornées par le
    // nombre d'usages du billet.
    const j = (await (await creerBillet({ uses: 20 })).json()) as { billet: string };
    const codes: number[] = [];
    for (let i = 0; i < 15; i++)
      codes.push((await rejoindre(j.billet, `node-atelier-${i}`)).status);
    expect(codes.every((c) => c === 201)).toBe(true);
  });

  it('coupe au-delà de 10 ÉCHECS par minute — le PBKDF2 est cher', async () => {
    // Cette route est publique et vérifie un secret par PBKDF2 (~50 ms de CPU).
    // Sous la seule limite globale (400 req / 10 s), une machine pouvait
    // réclamer 20 SECONDES de calcul par fenêtre de 10 s : le hub cessait de
    // répondre sans qu'aucune faille ne soit exploitée.
    const j = (await (await creerBillet()).json()) as { billet: string };
    const decode = decoderBillet(j.billet, LIMITES)!;
    const faux =
      'hive2_' +
      Buffer.from(
        JSON.stringify({ v: 2, url: decode.url, id: decode.id, s: 'z'.repeat(43) }),
      ).toString('base64url');

    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await rejoindre(faux, `node-flood-${i}`)).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[codes.length - 1]).toBe(429);
  });
});

describe('les membres', () => {
  it('la liste n’expose JAMAIS d’empreinte ni de secret', async () => {
    const j = (await (await creerBillet()).json()) as { billet: string };
    await rejoindre(j.billet, 'node-alpha');
    const vue = await (await fetch(`${base}/api/membres`, { headers })).json();
    const brut = JSON.stringify(vue);
    expect(brut).not.toMatch(/Hash|secret|keyHash/i);
    expect(brut).toContain('node-alpha');
  });

  it('exige le token, comme toute vue d’administration', async () => {
    expect((await fetch(`${base}/api/membres`)).status).toBe(401);
  });

  it('l’état d’un billet est CALCULÉ, pas rangé : le temps le fait expirer seul', async () => {
    const j = (await (await creerBillet({ ttlMs: 60_000 })).json()) as { id: string };
    type Vue = { billets: { id: string; etat: string }[] };
    const avant = (await (await fetch(`${base}/api/membres`, { headers })).json()) as Vue;
    expect(avant.billets.find((b) => b.id === j.id)?.etat).toBe('vivant');

    (
      server.store as unknown as {
        db: { prepare: (s: string) => { run: (...a: unknown[]) => void } };
      }
    ).db
      .prepare('UPDATE invite_tickets SET expiresAt = ? WHERE id = ?')
      .run(Date.now() - 1, j.id);

    const apres = (await (await fetch(`${base}/api/membres`, { headers })).json()) as Vue;
    expect(apres.billets.find((b) => b.id === j.id)?.etat).toBe('expire');
  });

  it('EXCLURE un membre invalide sa clé — sans toucher aux autres', async () => {
    // Le geste que l'ancien modèle rendait impossible : couper UNE personne.
    const a = (await (await creerBillet()).json()) as { billet: string };
    await rejoindre(a.billet, 'node-a');
    const b = (await (await creerBillet()).json()) as { billet: string };
    await rejoindre(b.billet, 'node-b');

    const rep = await fetch(`${base}/api/membres/node-a`, { method: 'DELETE', headers });
    expect(rep.status).toBe(200);
    expect(server.store.getCleNoeud('node-a')?.revokedAt).not.toBeNull();
    expect(server.store.getCleNoeud('node-b')?.revokedAt).toBeNull(); // l'autre est intact
  });

  it('exclure un inconnu rend 404, exclure deux fois aussi', async () => {
    expect((await fetch(`${base}/api/membres/fantome`, { method: 'DELETE', headers })).status).toBe(
      404,
    );
    const j = (await (await creerBillet()).json()) as { billet: string };
    await rejoindre(j.billet, 'node-a');
    expect((await fetch(`${base}/api/membres/node-a`, { method: 'DELETE', headers })).status).toBe(
      200,
    );
    expect((await fetch(`${base}/api/membres/node-a`, { method: 'DELETE', headers })).status).toBe(
      404,
    );
  });
});

describe('l’élagage', () => {
  it('supprime les billets MORTS et jamais les vivants', async () => {
    const vivant = (await (await creerBillet()).json()) as { id: string };
    const mort = (await (await creerBillet()).json()) as { id: string };
    await fetch(`${base}/api/billets/${mort.id}`, { method: 'DELETE', headers });

    // Grâce nulle : tout ce qui est mort et créé avant « maintenant » part.
    const supprimes = server.store.pruneAcces(0, Date.now() + 1);
    expect(supprimes).toBe(1);
    expect(server.store.getBillet(mort.id)).toBeNull();
    // Un billet encore valide qui disparaîtrait rendrait une invitation en
    // circulation silencieusement inutilisable : le pire mode d'échec ici.
    expect(server.store.getBillet(vivant.id)).not.toBeNull();
  });

  it('la période de grâce garde un billet mort récent, pour pouvoir dire « révoqué »', async () => {
    const j = (await (await creerBillet()).json()) as { id: string };
    await fetch(`${base}/api/billets/${j.id}`, { method: 'DELETE', headers });
    expect(server.store.pruneAcces(3_600_000)).toBe(0);
    expect(server.store.getBillet(j.id)).not.toBeNull();
  });
});
