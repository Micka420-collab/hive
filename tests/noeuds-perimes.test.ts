// QUAND UNE OUVRIÈRE EST-ELLE RÉPUTÉE MUETTE — et à la milliseconde près ?
//
// ─── POURQUOI LA BORNE EXACTE MÉRITE UN BANC ─────────────────────────────────
//
// `staleNodes(cutoff)` alimente le filet qui déclare un nœud hors ligne et
// REQUALIFIE ses tâches en cours (`scheduler.ts` : `staleNodes(now - timeout)` →
// `nodeDisconnected`). Se tromper d'un côté de la borne coûte des deux façons :
// trop tôt, on arrache son travail à une ouvrière qui répondait encore ; trop
// tard, une ouvrière morte garde ses tâches.
//
// La méthode documente « antérieur à `cutoff` » — donc STRICTEMENT avant. Un
// heartbeat qui vaut EXACTEMENT la limite n'est pas en retard : il est à
// l'heure, à la milliseconde près.
//
// ─── CE QUI A ÉTÉ MESURÉ ─────────────────────────────────────────────────────
//
// La loupe, une fois dotée des bornes RELÂCHÉES (`< → <=`), a désigné cette
// ligne comme nue. Rien n'éprouvait le cas d'égalité : le filet aurait pu
// basculer du strict au large sans qu'un seul test rougisse.
//
// C'est le cas le plus facile à casser par accident, parce qu'il n'arrive
// presque jamais — et « presque jamais » sur une ruche qui tourne des mois,
// c'est plusieurs fois.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';

let dir: string;
let chemin: string;
let store: HiveStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-perimes-'));
  chemin = path.join(dir, 'hive.db');
  store = new HiveStore(chemin);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Une ouvrière en ligne dont le dernier signe de vie est posé à la ms près. */
function ouvriere(id: string, dernierSigne: number): void {
  store.registerNode({
    nodeId: id,
    name: id,
    ownerName: 'testeur',
    agentType: 'shell',
    maxConcurrency: 1,
  });
  store.setNodeStatus(id, 'online');
  store.touchNode(id, dernierSigne);
}

const LIMITE = 1_000_000;
const perimes = (): string[] => store.staleNodes(LIMITE).map((n) => n.id);

describe('staleNodes — « antérieur à », pas « au plus tard »', () => {
  it('UN HEARTBEAT EXACTEMENT À LA LIMITE N’EST PAS EN RETARD', () => {
    // Le cas d'égalité, celui que la loupe a trouvé nu. `<` mué en `<=` le
    // ferait basculer côté périmé — et le filet arracherait ses tâches à une
    // ouvrière qui a répondu pile à l'heure.
    ouvriere('pile-a-l-heure', LIMITE);
    expect(perimes(), 'un signe de vie À la limite n’est pas antérieur À elle').toEqual([]);
  });

  it('une milliseconde plus tôt, elle EST périmée', () => {
    // La contre-épreuve, sans laquelle le banc du dessus serait vert pour la
    // mauvaise raison : une méthode qui ne rendrait JAMAIS personne le
    // satisferait aussi.
    ouvriere('en-retard-d-une-ms', LIMITE - 1);
    expect(perimes()).toEqual(['en-retard-d-une-ms']);
  });

  it('une milliseconde plus tard, elle ne l’est pas', () => {
    ouvriere('en-avance-d-une-ms', LIMITE + 1);
    expect(perimes()).toEqual([]);
  });

  it('une ouvrière qui n’a JAMAIS donné signe de vie est périmée', () => {
    // `lastSeen IS NULL` : la branche voisine de la comparaison. Elle n'a pas de
    // borne à discuter — sans aucun signe, il n'y a rien à attendre.
    //
    // Ce `NULL` n'est PAS atteignable par la surface publique du magasin :
    // `registerNode` pose toujours un `lastSeen`. C'est une ligne d'AVANT ce
    // champ, ou écrite par une version antérieure — exactement ce que la branche
    // défend. On l'écrit donc par une seconde connexion au même fichier, plutôt
    // que d'aller chercher un membre privé : ce que le banc simule, c'est un
    // magasin trouvé dans cet état, pas un magasin poussé dedans.
    ouvriere('jamais-vue', LIMITE + 999_999);
    const brut = new Database(chemin);
    brut.prepare('UPDATE nodes SET lastSeen = NULL WHERE id = ?').run('jamais-vue');
    brut.close();
    expect(perimes()).toEqual(['jamais-vue']);
  });

  it('une ouvrière HORS LIGNE n’est pas re-périmée — le filet ne repasse pas', () => {
    // La garde de statut, sur la même requête : sans elle, chaque tour
    // redéclarerait hors ligne des nœuds déjà hors ligne, et le journal se
    // remplirait d'événements qui ne disent rien.
    ouvriere('deja-partie', LIMITE - 10_000);
    store.setNodeStatus('deja-partie', 'offline');
    expect(perimes()).toEqual([]);
  });
});

describe('la requête reste ciblée quand la ruche grandit', () => {
  it('ne rend QUE les périmées, même au milieu des vivantes', () => {
    for (let i = 0; i < 20; i++) ouvriere(`vivante-${String(i)}`, LIMITE + i);
    ouvriere('muette-a', LIMITE - 5);
    ouvriere('muette-b', LIMITE - 50_000);
    expect(perimes().sort()).toEqual(['muette-a', 'muette-b']);
  });
});
