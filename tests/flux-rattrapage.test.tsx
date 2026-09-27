// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE FLUX DU TABLEAU DE BORD RATTRAPE LE JOURNAL À SON RETOUR.
//
// Extension `.tsx` à dessein, comme `api-queen-fabrique` : ce banc importe
// l'API du tableau de bord, qui vit sous `dashboard/tsconfig.json`.
//
// ─── LE TROU QUE CE BANC FERME ───────────────────────────────────────────────
//
// Carte Notion « Auditer WebSocket, reconnexion et perte de messages ». À la
// reconnexion, l'écran recevait un instantané frais — l'ÉTAT se rattrapait —
// mais aucun des événements émis pendant la coupure : le Journal, les tiroirs,
// l'horloge des chantiers racontaient une histoire trouée sans le savoir. La
// route `GET /api/events?since=` existait ; aucun code du tableau de bord ne
// l'appelait.
//
// ─── CE QUE LE FLUX PROMET, ET QUE CHAQUE BANC TIENT ─────────────────────────
//
// Chaque événement du journal est livré à `onEvent` UNE fois, dans l'ordre de
// ses ids — qu'il arrive en direct, par le rattrapage, ou par les deux.
//
// La Reine est remplacée ici par une fausse socket et un faux `fetch` : ce banc
// juge la DÉCISION du flux — d'où il relit, ce qu'il retient, ce qu'il écarte.
// Le côté Reine (l'instantané porte son point du journal, `?since=` rend la
// suite exacte) est éprouvé sur un vrai serveur dans `reine-veille-ws.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectFeed, saveToken } from '../dashboard/src/api';
import type { HiveFeed } from '../dashboard/src/api';
import type { HiveEvent } from '../src/shared/types';

/** Une socket que le banc pilote : il ouvre, fait parler la Reine, coupe. */
class FausseSocket {
  static toutes: FausseSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  fermee = false;

  constructor(readonly url: string) {
    FausseSocket.toutes.push(this);
  }

  send(): void {
    // Le `subscribe` : la fausse Reine l'accepte toujours.
  }

  close(): void {
    this.couper(1000);
  }

  couper(code = 1006): void {
    if (this.fermee) return;
    this.fermee = true;
    this.onclose?.({ code, reason: '' });
  }

  /** La Reine accepte l'abonnement : premier instantané, et son point du journal. */
  accueillir(dernierEvenementId: number): void {
    this.onopen?.();
    this.parler({
      type: 'state',
      snapshot: { projects: [], nodes: [], tasks: [], tasksTotal: 0 },
      dernierEvenementId,
    });
  }

  direct(...ids: number[]): void {
    for (const id of ids) this.parler({ type: 'event', event: evenement(id) });
  }

  private parler(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function evenement(id: number): HiveEvent {
  return { id, ts: id, type: 'task_progress', payload: {} };
}

/** Ce que le flux a demandé au journal, et la réponse qu'on lui fera. */
interface Lecture {
  url: string;
  jeton: string | undefined;
  repondre: (ids: number[]) => void;
  echouer: () => void;
}

let lectures: Lecture[] = [];
let livres: number[] = [];
let feed: HiveFeed | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  FausseSocket.toutes = [];
  lectures = [];
  livres = [];
  localStorage.clear();
  saveToken('jeton-de-banc');
  vi.stubGlobal('WebSocket', FausseSocket);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      lectures.push({
        url,
        jeton: (init?.headers as Record<string, string> | undefined)?.['x-hive-token'],
        repondre: (ids) =>
          resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(ids.map(evenement)),
          } as Response),
        echouer: () => reject(new TypeError('réseau coupé')),
      });
    });
  });
  feed = connectFeed({
    onState: () => {},
    onEvent: (ev) => livres.push(ev.id),
    onStatus: () => {},
  });
});

afterEach(() => {
  feed?.close();
  feed = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** La socket courante — celle que le flux vient d'ouvrir. */
function courante(): FausseSocket {
  const s = FausseSocket.toutes.at(-1);
  if (!s) throw new Error('le flux n’a ouvert aucune socket');
  return s;
}

/** Coupe, laisse passer le recul de reconnexion, rend la nouvelle socket. */
async function couperEtRevenir(): Promise<FausseSocket> {
  const avant = FausseSocket.toutes.length;
  courante().couper();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(FausseSocket.toutes.length, 'le flux ne s’est pas reconnecté').toBe(avant + 1);
  return courante();
}

/** Laisse les promesses du rattrapage aboutir. */
async function laisserRattraper(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function suite(de: number, a: number): number[] {
  return Array.from({ length: a - de + 1 }, (_, i) => de + i);
}

describe('le flux du tableau de bord, à la reconnexion', () => {
  it('CE QUI S’EST PASSÉ PENDANT LA COUPURE EST LIVRÉ AU RETOUR — une fois, dans l’ordre', async () => {
    courante().accueillir(10);
    courante().direct(11);
    expect(livres).toEqual([11]);

    const retour = await couperEtRevenir();
    retour.accueillir(14);
    // Le rattrapage part du dernier LIVRÉ, avec le jeton de la ruche.
    expect(lectures).toHaveLength(1);
    expect(lectures[0]?.url).toContain('/api/events?since=11');
    expect(lectures[0]?.jeton).toBe('jeton-de-banc');

    // Le direct continue PENDANT le rattrapage : 14 arrive des deux côtés, 15
    // n'existait pas encore quand le journal a été lu. Rien ne passe avant son
    // tour.
    retour.direct(14, 15);
    expect(livres, 'le direct a doublé le rattrapage').toEqual([11]);

    lectures[0]?.repondre([12, 13, 14]);
    await laisserRattraper();
    expect(livres).toEqual([11, 12, 13, 14, 15]);
  });

  it('UN ÉCRAN QUI N’AVAIT ENCORE RIEN VU RATTRAPE QUAND MÊME — page après page', async () => {
    // Une ruche calme : aucun événement pendant la première session. Sans le
    // point porté par l'instantané, le flux ne saurait pas d'où relire.
    courante().accueillir(7);
    expect(livres).toEqual([]);

    const retour = await couperEtRevenir();
    retour.accueillir(1_009);
    expect(lectures, 'aucun rattrapage n’a été demandé').toHaveLength(1);
    expect(lectures[0]?.url).toContain('since=7');
    // Une page PLEINE (le plafond de la route) : il en reste peut-être.
    lectures[0]?.repondre(suite(8, 1_007));
    await laisserRattraper();
    expect(lectures[1]?.url, 'le flux s’est arrêté à la première page').toContain('since=1007');
    lectures[1]?.repondre([1_008, 1_009]);
    await laisserRattraper();
    expect(livres).toEqual(suite(8, 1_009));
  });

  it('UN RATTRAPAGE QUI ÉCHOUE NE LIVRE PAS LE DIRECT PAR-DESSUS LE TROU — il retente', async () => {
    courante().accueillir(3);
    courante().direct(4);

    const retour = await couperEtRevenir();
    retour.accueillir(6);
    retour.direct(7);
    lectures[0]?.echouer();
    await laisserRattraper();
    // Livrer 7 maintenant rendrait 5 et 6 perdus pour toujours.
    expect(livres, 'le direct est passé par-dessus le trou').toEqual([4]);
    expect(retour.fermee, 'le flux est resté branché sur un journal troué').toBe(true);

    // La reconnexion suivante relit depuis le MÊME point.
    const encore = await couperEtRevenir();
    encore.accueillir(7);
    expect(lectures[1]?.url).toContain('since=4');
    lectures[1]?.repondre([5, 6, 7]);
    await laisserRattraper();
    expect(livres).toEqual([4, 5, 6, 7]);
  });

  it('UN JOURNAL REPARTI DE ZÉRO NE FAIT PAS TAIRE LE DIRECT', async () => {
    // Base remplacée, Reine redémarrée : les ids repartent de 1. Garder
    // l'ancien point écarterait tout ce qui suit comme « déjà vu ».
    courante().accueillir(500);
    courante().direct(501);

    const retour = await couperEtRevenir();
    retour.accueillir(2);
    expect(lectures, 'rien à relire dans un journal qui n’est plus le même').toHaveLength(0);
    retour.direct(3);
    expect(livres).toEqual([501, 3]);
  });
});
