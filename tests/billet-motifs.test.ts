// Pourquoi un billet est refusé — et ce qu'on ne dit toujours pas.
//
// ─── LA DÉCISION, ET CE QUI L'A TRANCHÉE ─────────────────────────────────────
//
// « Billet refusé » sans raison était le cas d'échec le plus fréquent du
// chemin « rejoindre », et le plus vexant : quelqu'un attend deux jours avant
// de coller son billet, se fait refuser, et n'a aucun moyen de savoir s'il
// faut en redemander un ou vérifier sa connexion.
//
// L'objection était réelle : distinguer « inconnu » d'« expiré » transforme la
// route en ORACLE, où l'on peut énumérer les identifiants de billets qui
// existent. Mais en lisant le code, il s'est avéré que L'ORACLE EXISTAIT DÉJÀ,
// mesuré au chronomètre plutôt que lu dans la réponse : un identifiant inconnu
// était refusé SANS que PBKDF2 tourne — donc en une fraction du temps d'un
// identifiant connu. Le message uniforme prétendait cacher ce que l'horloge
// disait.
//
// La décision est donc un gain net, pas un compromis :
//
//   • le secret est vérifié D'ABORD, et TOUJOURS au même coût (empreinte
//     leurre quand le billet n'existe pas) — l'oracle temporel disparaît ;
//   • une fois le porteur authentifié, on lui dit POURQUOI : expiré, épuisé,
//     révoqué. Ces trois-là ne s'apprennent qu'avec le bon secret en main ;
//   • « inconnu » et « secret invalide » restent INDISTINGUABLES, à l'octet
//     près, et c'est cette indistinction qui ferme la porte.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import {
  EXPLICATION_REFUS,
  MOTIFS_DICIBLES,
  decoderBillet,
  empreinte,
  motifDicible,
} from '../src/shared/acces.js';

const TOKEN = 'jeton-motifs-assez-long-pour-passer';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer;
let dir: string;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-motifs-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'motifs.db'),
    simulation: false,
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function creerBillet(body: Record<string, unknown> = {}): Promise<string> {
  const rep = await fetch(`${base}/api/billets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: 'ws://127.0.0.1:7777/ws', ...body }),
  });
  const j = (await rep.json()) as { billet: string };
  return j.billet;
}

async function rejoindre(billet: string, nodeId: string): Promise<Response> {
  return fetch(`${base}/api/rejoindre`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ billet, nodeId }),
  });
}

/** Reforge un billet en changeant son secret — le cas « mauvais secret ». */
function avecAutreSecret(billet: string): string {
  const d = decoderBillet(billet, { id: 64, nom: 120 })!;
  const charge = { v: 2, url: d.url, id: d.id, s: 'un-secret-qui-nest-pas-le-bon-01234' };
  return `hive2_${Buffer.from(JSON.stringify(charge)).toString('base64url')}`;
}

/** Reforge un billet en changeant son identifiant — le cas « inconnu ». */
function avecAutreId(billet: string): string {
  const d = decoderBillet(billet, { id: 64, nom: 120 })!;
  const charge = { v: 2, url: d.url, id: 'billet-qui-nexiste-pas', s: d.secret };
  return `hive2_${Buffer.from(JSON.stringify(charge)).toString('base64url')}`;
}

describe('ce qu’on DIT au porteur du bon secret', () => {
  it('UN BILLET EXPIRÉ LE DIT, et dit quoi faire', async () => {
    // Posé directement en base avec une expiration passée : le TTL demandé au
    // serveur est borné à une minute minimum, et attendre une minute dans un
    // test est le meilleur moyen de le rendre lent puis désactivé.
    const secret = 'un-secret-de-billet-perime-0123456789';
    server.store.creerBillet({
      id: 'billet-perime',
      secretHash: empreinte(secret),
      expiresAt: 1,
      uses: 1,
    });
    const billet = `hive2_${Buffer.from(
      JSON.stringify({ v: 2, url: 'ws://127.0.0.1:7777/ws', id: 'billet-perime', s: secret }),
    ).toString('base64url')}`;

    const rep = await rejoindre(billet, 'node-a');
    expect(rep.status).toBe(401);
    const corps = (await rep.json()) as { error: string; motif?: string };
    expect(corps.motif).toBe('expire');
    expect(corps.error).toBe(EXPLICATION_REFUS.expire);
    expect(corps.error, 'un message qui ne dit pas quoi faire ne sert à rien').toMatch(/demandez/i);
  });

  it('un billet ÉPUISÉ le dit', async () => {
    const billet = await creerBillet({ uses: 1 });
    expect((await rejoindre(billet, 'node-a')).status).toBe(201);
    const rep = await rejoindre(billet, 'node-b');
    expect(rep.status).toBe(401);
    const corps = (await rep.json()) as { motif?: string };
    expect(corps.motif).toBe('epuise');
  });

  it('un billet RÉVOQUÉ le dit', async () => {
    const billet = await creerBillet();
    const id = decoderBillet(billet, { id: 64, nom: 120 })!.id;
    server.store.revoquerBillet(id);
    const rep = await rejoindre(billet, 'node-a');
    expect(rep.status).toBe(401);
    expect(((await rep.json()) as { motif?: string }).motif).toBe('revoque');
  });

  it('un billet valide passe — sans lui, tout ce qui précède serait vide de sens', async () => {
    expect((await rejoindre(await creerBillet(), 'node-a')).status).toBe(201);
  });
});

describe('ce qu’on NE DIT PAS, et ne dira jamais', () => {
  it('INCONNU ET MAUVAIS SECRET RENDENT LA MÊME RÉPONSE, À L’OCTET PRÈS', () => {
    // C'est cette indistinction qui empêche d'énumérer les identifiants de
    // billets existants. Si un jour les deux corps divergent, l'énumération
    // redevient possible.
    return creerBillet().then(async (billet) => {
      const inconnu = await rejoindre(avecAutreId(billet), 'node-a');
      const mauvais = await rejoindre(avecAutreSecret(billet), 'node-b');

      expect(inconnu.status).toBe(mauvais.status);
      expect(inconnu.status).toBe(401);
      expect(await inconnu.text()).toBe(await mauvais.text());
    });
  });

  it('aucun des deux ne porte de motif', async () => {
    const billet = await creerBillet();
    for (const forge of [avecAutreId(billet), avecAutreSecret(billet)]) {
      const corps = (await (await rejoindre(forge, 'node-x')).json()) as { motif?: string };
      expect(corps.motif, 'un motif ici rouvrirait l’oracle').toBeUndefined();
    }
  });

  it('LE TEMPS DE RÉPONSE NE TRAHIT PLUS L’EXISTENCE D’UN BILLET', async () => {
    // L'oracle qui existait AVANT ce changement : un identifiant inconnu était
    // refusé sans que PBKDF2 tourne, donc en une fraction du temps. On vérifie
    // que les deux chemins coûtent maintenant le même ordre de grandeur.
    //
    // La borne est volontairement LARGE (facteur 4) : une CI partagée est
    // bruyante, et un test qui rougit au hasard finit désactivé — ce qui vaut
    // moins que pas de test du tout. Un retour à l'ancien comportement donnait
    // un facteur de plusieurs dizaines, très au-delà de cette borne.
    const billet = await creerBillet();
    const chrono = async (b: string): Promise<number> => {
      const debut = performance.now();
      await rejoindre(b, `node-${Math.floor(performance.now())}`);
      return performance.now() - debut;
    };
    // Un tour à blanc : il paie le calcul du leurre et la mise en cache JIT.
    await chrono(avecAutreId(billet));

    const tInconnu = await chrono(avecAutreId(billet));
    const tMauvais = await chrono(avecAutreSecret(billet));
    const rapport = Math.max(tInconnu, tMauvais) / Math.max(1, Math.min(tInconnu, tMauvais));
    expect(
      rapport,
      `inconnu ${tInconnu.toFixed(1)}ms · mauvais ${tMauvais.toFixed(1)}ms`,
    ).toBeLessThan(4);
  });
});

describe('la liste des motifs dicibles', () => {
  it('ne contient QUE ce qui suppose le bon secret', () => {
    expect([...MOTIFS_DICIBLES].sort()).toEqual(['epuise', 'expire', 'revoque']);
    for (const interdit of ['inconnu', 'secret_invalide', 'course_perdue']) {
      expect(motifDicible(interdit), interdit).toBe(false);
    }
  });

  it('chaque motif dicible a une explication qui dit quoi faire', () => {
    for (const m of MOTIFS_DICIBLES) {
      expect(EXPLICATION_REFUS[m].length).toBeGreaterThan(20);
      expect(EXPLICATION_REFUS[m], m).toMatch(/hôte|demandez/i);
    }
  });
});
