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
// Et ce qu'il ne peut pas rattraper, il le DIT : un trou élagué pendant la
// coupure est signalé, jamais présenté comme une histoire complète.
//
// ─── ET SANS DEVENIR UNE BOUCLE ──────────────────────────────────────────────
//
// Un rattrapage qui échoue referme la socket. La première version remettait le
// recul de reconnexion à une seconde à chaque OUVERTURE : un `/api/events` qui
// échouait toujours (un 429 du quota par adresse, n'importe quel 5xx) faisait
// reconnecter l'écran à 1 Hz pour toujours — mesuré : 60 sockets et 60
// bascules « connecté » en 60 s, chacune suivie d'une relecture de toutes les
// vues. Une lecture qui ne revenait pas, elle, gelait le Journal sans un mot.
//
// La Reine est remplacée ici par une fausse socket et un faux `fetch` : ce banc
// juge la DÉCISION du flux — d'où il relit, ce qu'il retient, ce qu'il écarte,
// quand il revient. Le côté Reine (l'instantané porte son point du journal,
// `?since=` rend la suite exacte) est éprouvé sur un vrai serveur dans
// `reine-veille-ws.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectFeed, saveToken } from '../dashboard/src/api';
import type { HiveFeed } from '../dashboard/src/api';
import { CODE_TABLEAU_TROP_LENT } from '../src/shared/protocol';
import type { HiveEvent } from '../src/shared/types';

/** Une socket que le banc pilote : il ouvre, fait parler la Reine, coupe. */
class FausseSocket {
  static toutes: FausseSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  fermee = false;
  accueillie = false;
  /** Horloge simulée : quand le flux l'a ouverte, quand elle s'est fermée. */
  readonly neeA = Date.now();
  fermeeA: number | null = null;

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
    this.fermeeA = Date.now();
    this.onclose?.({ code, reason: '' });
  }

  /** La Reine accepte l'abonnement : premier instantané, et son point du journal. */
  accueillir(dernierEvenementId: number): void {
    this.accueillie = true;
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

function evenement(id: number, type = 'task_progress'): HiveEvent {
  return { id, ts: id, type, payload: {} };
}

/** Ce que le flux a demandé au journal, et la réponse qu'on lui fera. */
interface Lecture {
  url: string;
  jeton: string | undefined;
  /** `types` : le type de certains ids, quand ce n'est pas un `task_progress`. */
  repondre: (ids: number[], types?: Record<number, string>) => void;
  echouer: () => void;
}

let lectures: Lecture[] = [];
let livres: number[] = [];
let statuts: { up: boolean; tropLent?: boolean }[] = [];
let trous: number[] = [];
let feed: HiveFeed | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  FausseSocket.toutes = [];
  lectures = [];
  livres = [];
  statuts = [];
  trous = [];
  localStorage.clear();
  saveToken('jeton-de-banc');
  vi.stubGlobal('WebSocket', FausseSocket);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      // Comme un vrai `fetch` : une lecture annulée échoue.
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('annulée', 'AbortError')),
      );
      lectures.push({
        url,
        jeton: (init?.headers as Record<string, string> | undefined)?.['x-hive-token'],
        repondre: (ids, types = {}) =>
          resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(ids.map((id) => evenement(id, types[id]))),
          } as Response),
        echouer: () => reject(new TypeError('réseau coupé')),
      });
    });
  });
  feed = connectFeed({
    onState: () => {},
    onEvent: (ev) => livres.push(ev.id),
    onStatus: (up, meta) => statuts.push({ up, ...(meta?.tropLent ? { tropLent: true } : {}) }),
    onJournalIncomplet: (manquants) => trous.push(manquants),
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

/** Pour chaque reconnexion : le temps passé entre la fermeture et la socket suivante. */
function reculs(): number[] {
  const s = FausseSocket.toutes;
  return s.slice(1).map((nee, i) => nee.neeA - (s[i]?.fermeeA ?? Number.NaN));
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

  it('UN RATTRAPAGE QUI ÉCHOUE TOUJOURS ESPACE SES RECONNEXIONS — il ne boucle pas à la seconde', async () => {
    // Une session saine, coupée : elle revient en une seconde, comme avant.
    courante().accueillir(3);
    courante().couper();
    // Puis chaque connexion est ACCEPTÉE et chaque rattrapage échoue — un 429
    // du quota REST, un 5xx. Une minute de temps simulé.
    for (let t = 0; t < 60_000; t += 100) {
      await vi.advanceTimersByTimeAsync(100);
      const s = courante();
      if (!s.accueillie) s.accueillir(9);
      for (const l of lectures.splice(0)) l.echouer();
    }
    // Une connexion qui n'a jamais servi ne ramène pas le recul à une seconde.
    expect(reculs().slice(0, 5), 'le flux reboucle sans recul').toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000,
    ]);
    expect(FausseSocket.toutes.length).toBeLessThan(10);
    // Et le trou n'a jamais été enjambé.
    expect(livres).toEqual([]);
  });

  it('UNE LECTURE QUI NE REVIENT PAS NE GÈLE PAS LE JOURNAL — elle échoue à son butoir', async () => {
    courante().accueillir(3);
    const retour = await couperEtRevenir();
    retour.accueillir(6);
    retour.direct(7);
    expect(lectures).toHaveLength(1);
    // La Reine (ou un proxy) garde la réponse. Le flux attend… mais pas toujours.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(retour.fermee).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(retour.fermee, 'une lecture sans réponse a gelé le flux pour toujours').toBe(true);
    // Le direct retenu n'est pas livré par-dessus le trou : il sera relu.
    expect(livres).toEqual([]);
  });

  it('UN TROU ÉLAGUÉ PENDANT LA COUPURE EST DIT — la fin n’est pas présentée comme toute l’histoire', async () => {
    courante().accueillir(10);
    courante().direct(11);

    const retour = await couperEtRevenir();
    retour.accueillir(31);
    // La Reine ne garde que ses derniers événements : 12 à 29 sont partis.
    lectures[0]?.repondre([30, 31]);
    await laisserRattraper();
    expect(livres).toEqual([11, 30, 31]);
    expect(trous, 'le trou du journal est passé sous silence').toEqual([18]);
  });

  it('UNE MESURE JAMAIS DIFFUSÉE N’ARRIVE PAS PAR LE RATTRAPAGE — et ne passe pas pour un trou', async () => {
    // `worker_usage` est rangé au journal sans être diffusé : le direct ne le
    // montre jamais. Le rattrapage ne doit pas le montrer davantage — sinon le
    // Journal dépendrait de l'historique de connexion de l'onglet.
    courante().accueillir(10);
    const retour = await couperEtRevenir();
    retour.accueillir(13);
    lectures[0]?.repondre([11, 12, 13], { 12: 'worker_usage' });
    await laisserRattraper();
    expect(livres).toEqual([11, 13]);
    expect(trous).toEqual([]);
  });

  it('UN ÉCRAN COUPÉ POUR LENTEUR LE SAIT — et ne revient pas plus vite qu’il ne lit', async () => {
    // Chaque session est saine — l'écran reçoit ses instantanés — mais la
    // Reine le coupe parce qu'il lit trop lentement. Revenir à la seconde
    // l'enverrait droit dans la même coupure.
    courante().accueillir(3);
    for (let i = 0; i < 3; i++) {
      courante().couper(CODE_TABLEAU_TROP_LENT);
      await vi.advanceTimersByTimeAsync(15_000);
      courante().accueillir(3);
    }
    expect(reculs()).toEqual([1_000, 2_000, 4_000]);
    expect(statuts.filter((s) => !s.up)).toEqual([
      { up: false, tropLent: true },
      { up: false, tropLent: true },
      { up: false, tropLent: true },
    ]);
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

describe('« Réessayer maintenant » : rappeler la ruche sans attendre le recul', () => {
  it('rouvre TOUT DE SUITE une liaison tombée — et ne double jamais une socket vivante', async () => {
    // Le recul monte à quinze secondes : un opérateur qui vient de relancer
    // la Reine attendait sans rien pouvoir faire. `reconnecter` coupe l'attente.
    courante().accueillir(0);
    expect(statuts.at(-1)).toEqual({ up: true });

    // Relié : ne rien ouvrir de plus (deux sockets = deux flux, deux livraisons).
    feed?.reconnecter();
    expect(FausseSocket.toutes.length, 'une seconde socket sur une liaison vivante').toBe(1);

    courante().couper();
    await vi.advanceTimersByTimeAsync(0);
    expect(FausseSocket.toutes.length, 'reconnecté avant la fin du recul').toBe(1);

    feed?.reconnecter();
    expect(FausseSocket.toutes.length, 'le rappel immédiat n’a rien ouvert').toBe(2);

    // La socket rouverte est en cours d'ouverture : un second clic n'en ouvre pas une troisième,
    // et le recul annulé ne rouvre rien derrière elle.
    feed?.reconnecter();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FausseSocket.toutes.length, 'le recul annulé a rouvert une socket de plus').toBe(2);
  });
});
