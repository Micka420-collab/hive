// LA RÉTENTION DU JOURNAL — UN SEUL PROPRIÉTAIRE, ÉPROUVÉ À SES TROIS ÉTAGES.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// Le journal gardait ses 5 000 derniers événements tous types confondus : une
// nuit de `task_progress` poussait dehors la CI d'une production qui attendait
// un humain, l'annonce de sa contre-revue, la critique d'un renvoi, la raison du
// routing. La politique (`shared/retention-journal.ts`) garde désormais les
// PREUVES avec leur tâche, la fenêtre pour les traces, et un plafond dur en
// dernier recours ; `HiveStore.pruneEvents` la tient seul.
//
// Trois étages, trois bancs :
//   1. la décision, PURE (`clotureDe`, `planDeRetention`, `payloadDeBilan`) ;
//   2. le magasin qui l'exécute — et le registre qui en garde le compte, y
//      compris sur une base écrite par la version précédente ;
//   3. la Reine qui la cadence au tick : c'est là que vivait le défaut, et
//      c'est là que le banc de régression le rejoue — il rougit sur le code
//      d'avant, où le tick élaguait ces preuves.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CORPUS_AIGUILLAGE } from '../src/orchestrator/aiguillage.js';
import { CONSEILS_CONSERVES } from '../src/orchestrator/conseil-runner.js';
import type { EvaluationResult } from '../src/orchestrator/evaluator.js';
import type { ReplayResult } from '../src/orchestrator/replay.js';
import {
  POLITIQUE_JOURNAL,
  TACHES_RETENTION_MS,
  createServer,
  type HiveServer,
} from '../src/orchestrator/server.js';
import { AUDITS_SUPPRESSION_CONSERVES, HiveStore } from '../src/orchestrator/store.js';
import { TYPES_CHRONOLOGIE } from '../src/shared/chronologie-tache.js';
import {
  TACHES_NOMMEES,
  TYPES_NOMMES,
  TYPES_PREUVE,
  bilanDeRetraits,
  clotureDe,
  payloadDeBilan,
  planDeRetention,
  type FaitsCloture,
  type LigneJournal,
  type PolitiqueJournal,
  type Retrait,
} from '../src/shared/retention-journal.js';
import { TYPES_REGISTRE_GENOME, type RegistreGenome } from '../src/shared/registre-genome.js';
import { TYPES_ROUTAGE } from '../src/shared/routage-vue.js';
import { TYPES_WAR_ROOM } from '../src/shared/war-room.js';
import { TRENTE_JOURS_MS } from './aide/journal-retenu.js';

const JOUR = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

// ─── 1. LA DÉCISION, PURE ───────────────────────────────────────────────────

describe('la clôture d’une tâche : quand la ruche n’a plus rien à en décider', () => {
  const faits = (f: Partial<FaitsCloture>): FaitsCloture => ({
    status: 'done',
    updatedAt: 1_000,
    livraison: null,
    revue: null,
    rendueAUneAutre: false,
    ...f,
  });
  const cas: Array<[string, Partial<FaitsCloture>, number | null]> = [
    ['en attente de ses dépendances', { status: 'pending' }, null],
    ['prête', { status: 'ready' }, null],
    ['en vol', { status: 'running' }, null],
    ['rendue, sans revue ni livraison — elle attend un humain', {}, null],
    ['approuvée, pas encore livrée', { revue: { state: 'approved', updatedAt: 2_000 } }, null],
    [
      'PR ouverte : l’Evaluator décide encore de la fusion',
      { livraison: { etat: 'ouverte', majA: 3_000 } },
      null,
    ],
    [
      'livraison échouée : un humain doit la reprendre',
      { livraison: { etat: 'echouee', majA: 3_000 } },
      null,
    ],
    ['livraison en cours', { livraison: { etat: 'en_cours', majA: 3_000 } }, null],
    ['échouée', { status: 'failed', updatedAt: 4_000 }, 4_000],
    [
      'fusionnée — à l’instant de la fusion',
      { livraison: { etat: 'fusionnee', majA: 5_000 } },
      5_000,
    ],
    [
      'rejetée par un humain sans nouvel essai',
      { revue: { state: 'rejected', updatedAt: 6_000 } },
      6_000,
    ],
    [
      'rejetée, puis rendue À NOUVEAU par une autre reprise — le nouveau résultat attend son humain',
      { updatedAt: 7_000, revue: { state: 'rejected', updatedAt: 6_000 } },
      null,
    ],
    ['relecture ou enfant délégué rendu', { rendueAUneAutre: true }, 1_000],
    ['relecture encore en vol', { status: 'running', rendueAUneAutre: true }, null],
  ];
  for (const [nom, f, attendu] of cas) {
    it(nom, () => expect(clotureDe(faits(f))).toBe(attendu));
  }

  it('LE FAIT LE PLUS RÉCENT DATE LA CLÔTURE — une fusion plus ancienne que le dernier état ne la vieillit pas', () => {
    expect(
      clotureDe(faits({ updatedAt: 9_000, livraison: { etat: 'fusionnee', majA: 5_000 } })),
    ).toBe(9_000);
  });
});

describe('le plan de rétention', () => {
  const politique = (p: Partial<PolitiqueJournal> = {}): PolitiqueJournal => ({
    fenetre: 0,
    preuvesClosesMs: 10 * JOUR,
    plafond: 1_000,
    ...p,
  });
  const l = (id: number, type: string, taskId: string | null = null): LigneJournal => ({
    id,
    type,
    taskId,
  });
  const motifs = (r: Retrait[]): Array<[number, string]> => r.map((x) => [x.id, x.motif]);

  it('TRACES, ORPHELINES, ÉCHUES PARTENT ; LES PREUVES VIVANTES ET CLOSES RÉCENTES RESTENT', () => {
    const clotures = new Map<string, number | null>([
      ['vivante', null],
      ['close-recente', T0 - 2 * JOUR],
      ['close-ancienne', T0 - 11 * JOUR],
    ]);
    const plan = planDeRetention(
      [
        l(1, 'task_progress', 'vivante'), // bavardage : jamais une preuve
        l(2, 'validation_recorded', 'vivante'),
        l(3, 'task_retry', 'close-recente'),
        l(4, 'task_reviewed', 'close-ancienne'),
        l(5, 'contre_expertise', 'disparue'),
        l(6, 'delivery_merged'), // preuve sans tâche nommée : une trace
        l(7, 'node_online'),
      ],
      (id) => (clotures.has(id) ? clotures.get(id) : undefined),
      new Set(),
      new Map(),
      politique(),
      7,
      T0,
    );
    expect(motifs(plan)).toEqual([
      [1, 'trace'],
      [4, 'echue'],
      [5, 'orpheline'],
      [6, 'trace'],
      [7, 'trace'],
    ]);
  });

  it('LES FAITS RANGÉS NE SONT JAMAIS PRIS — ni comme trace, ni par le plafond', () => {
    const plan = planDeRetention(
      [l(1, 'council_decided'), l(2, 'task_done', 'vivante'), l(3, 'task_done', 'vivante')],
      () => null,
      new Set([1]),
      new Map(),
      politique({ plafond: 0 }),
      3,
      T0,
    );
    expect(motifs(plan)).toEqual([
      [2, 'plafond_vivante'],
      [3, 'plafond_vivante'],
    ]);
  });

  it('LE PLAFOND PREND LES CLOSES D’ABORD (la plus anciennement close en tête), PUIS LES VIVANTES LES PLUS INACTIVES — tâche entière', () => {
    const clotures = new Map<string, number | null>([
      ['close-hier', T0 - JOUR],
      ['close-avant-hier', T0 - 2 * JOUR],
      ['vivante-active', null],
      ['vivante-endormie', null],
    ]);
    const lignes = [
      l(1, 'task_done', 'vivante-endormie'),
      l(2, 'task_done', 'close-hier'),
      l(3, 'task_done', 'close-avant-hier'),
      l(4, 'task_retry', 'close-hier'),
      l(5, 'task_assigned', 'vivante-active'),
      l(6, 'task_assigned', 'vivante-endormie'),
      l(7, 'task_assigned', 'vivante-active'),
    ];
    const lire = (plafond: number): Retrait[] =>
      planDeRetention(
        lignes,
        (id) => clotures.get(id),
        new Set(),
        new Map(),
        politique({ plafond }),
        7,
        T0,
      );

    // Un excès d'UNE ligne retire quand même toute la tâche close la plus
    // ancienne — jamais la moitié d'un dossier.
    expect(motifs(lire(6))).toEqual([[3, 'plafond_close']]);
    expect(motifs(lire(5))).toEqual([
      [3, 'plafond_close'],
      [2, 'plafond_close'],
      [4, 'plafond_close'],
    ]);
    // Les vivantes ensuite : l'endormie (dernière preuve n° 6) avant l'active (n° 7).
    expect(motifs(lire(2))).toEqual([
      [3, 'plafond_close'],
      [2, 'plafond_close'],
      [4, 'plafond_close'],
      [1, 'plafond_vivante'],
      [6, 'plafond_vivante'],
    ]);
    expect(bilanDeRetraits(lire(2), 2).tachesPlafond).toEqual([
      'close-avant-hier',
      'close-hier',
      'vivante-endormie',
    ]);
  });

  it('EN DERNIER RECOURS, LA COUPE : les preuves remplacées (même dans la fenêtre) d’abord, puis les plus anciennes, une à une', () => {
    const lignes = [
      l(1, 'task_retry', 'active'), // seule de son type : partira en dernier
      l(2, 'task_assigned', 'active'), // remplacée par n° 4
      l(3, 'task_started', 'active'), // remplacée DANS la fenêtre
      l(4, 'task_assigned', 'active'), // la dernière assignation connue sous la fenêtre
    ];
    const lire = (plafond: number): Retrait[] =>
      planDeRetention(
        lignes,
        () => null,
        new Set(),
        new Map([['active', new Set(['task_started'])]]),
        politique({ plafond }),
        6, // + deux lignes dans la fenêtre
        T0,
      );
    expect(lire(6)).toEqual([]);
    expect(motifs(lire(5))).toEqual([[2, 'plafond_coupe']]);
    expect(motifs(lire(4))).toEqual([
      [2, 'plafond_coupe'],
      [3, 'plafond_coupe'],
    ]);
    expect(motifs(lire(2))).toEqual([
      [2, 'plafond_coupe'],
      [3, 'plafond_coupe'],
      [1, 'plafond_coupe'],
      [4, 'plafond_coupe'],
    ]);
    expect(bilanDeRetraits(lire(2), 2).tachesPlafond).toEqual(['active']);
  });

  it('SOUS LE PLAFOND, LE PLAFOND NE PREND RIEN — le compte part des lignes restantes', () => {
    // Dix lignes, dont six traces qui partent : il en reste quatre, sous un
    // plafond de quatre. Compter les dix aurait retiré des preuves pour rien.
    const lignes = [
      ...Array.from({ length: 6 }, (_, i) => l(i + 1, 'task_progress')),
      ...Array.from({ length: 4 }, (_, i) => l(i + 7, 'task_done', 'vivante')),
    ];
    const plan = planDeRetention(
      lignes,
      () => null,
      new Set(),
      new Map(),
      politique({ plafond: 4 }),
      10,
      T0,
    );
    expect(plan.every((r) => r.motif === 'trace')).toBe(true);
    expect(plan).toHaveLength(6);
  });
});

describe('les types qui prouvent', () => {
  it('TOUT CE QUE RELIT UN LECTEUR PAR TÂCHE EST UNE PREUVE — Genome, routage, chronologie, War Room', () => {
    const preuves = new Set(TYPES_PREUVE);
    const lus = [
      ...TYPES_REGISTRE_GENOME,
      ...TYPES_ROUTAGE,
      ...TYPES_CHRONOLOGIE,
      // Les Conseils ne sont la preuve d'aucune tâche (leur décision courante
      // est un fait rangé à part).
      ...TYPES_WAR_ROOM.filter((t) => !t.startsWith('council_')),
    ];
    expect(lus.filter((t) => !preuves.has(t))).toEqual([]);
  });

  it('ET CE QUE RELISENT L’EVALUATOR, LA LIVRAISON ET LA REPRISE', () => {
    const preuves = new Set(TYPES_PREUVE);
    for (const t of [
      'validation_recorded',
      'ci_validation_recorded',
      // Ce que la porte de sécurité a vu : élagué, un constat serait oublié.
      'security_gate_recorded',
      // Et pourquoi un de ses volets n'est pas vérifié (refusé à la réception).
      'security_gate_rejected',
      'contre_expertise_impossible',
      'evaluator_overridden',
      'delivery_opened',
      // La provenance d'une reprise sur la même branche (#518).
      'delivery_advanced',
      // La preuve d'instabilité d'un job que le garde de PR a relancé.
      'garde_pr_relance',
      'critique_context',
      'brood_context',
      'worker_usage',
      'worker_final_text',
    ]) {
      expect(preuves.has(t), t).toBe(true);
    }
  });

  it('LE BAVARDAGE N’EN EST PAS UNE — sinon rien ne partirait jamais', () => {
    for (const t of ['task_progress', 'node_online', 'task_created', 'journal_elagage']) {
      expect(TYPES_PREUVE.includes(t), t).toBe(false);
    }
  });
});

describe('le récit d’une passe est borné', () => {
  it('DOUZE TYPES NOMMÉS, LE RESTE SOMMÉ ; VINGT TÂCHES NOMMÉES, LE TOTAL COMPTÉ', () => {
    const retraits: Retrait[] = [];
    for (let i = 0; i < TYPES_NOMMES + 3; i++) {
      for (let k = 0; k <= i; k++) {
        retraits.push({ id: retraits.length + 1, type: `t${i}`, motif: 'trace', taskId: null });
      }
    }
    for (let i = 0; i < TACHES_NOMMEES + 5; i++) {
      retraits.push({
        id: retraits.length + 1,
        type: 'task_done',
        motif: 'plafond_close',
        taskId: `x${i}`,
      });
    }
    const payload = payloadDeBilan(bilanDeRetraits(retraits, 7));
    expect(Object.keys(payload.parType as object)).toHaveLength(TYPES_NOMMES);
    // Les plus retirés d'abord : `task_done` (25) puis t14 (15)…
    expect(Object.keys(payload.parType as object)[0]).toBe('task_done');
    expect(payload.autresTypes).toBeGreaterThan(0);
    expect(payload.tachesPlafond).toHaveLength(TACHES_NOMMEES);
    expect(payload.tachesPlafondTotal).toBe(TACHES_NOMMEES + 5);
    expect(payload).toMatchObject({ supprimes: retraits.length, restants: 7 });
  });

  it('UNE PASSE SANS PLAFOND NE NOMME AUCUNE TÂCHE', () => {
    const payload = payloadDeBilan(
      bilanDeRetraits([{ id: 1, type: 'node_online', motif: 'trace', taskId: null }], 1),
    );
    expect(payload).not.toHaveProperty('tachesPlafond');
    expect(payload).not.toHaveProperty('autresTypes');
  });
});

describe('la politique de la Reine', () => {
  it('LE PLAFOND DÉPASSE LA FENÊTRE ET LES FAITS RANGÉS — sinon il ne pourrait pas tenir sa promesse', () => {
    // Le plafond ne touche jamais la fenêtre ni les faits rangés (une décision
    // par Conseil conservé, un verdict par production du corpus, les derniers
    // audits de suppression de projet) : il ne peut
    // borner le journal que s'il leur laisse de la place, et des preuves au-delà.
    expect(POLITIQUE_JOURNAL.plafond).toBeGreaterThan(
      POLITIQUE_JOURNAL.fenetre +
        CONSEILS_CONSERVES +
        CORPUS_AIGUILLAGE +
        AUDITS_SUPPRESSION_CONSERVES,
    );
  });

  it('LES PREUVES D’UNE TÂCHE CLOSE DURENT AUTANT QUE LA TÂCHE TERMINÉE ELLE-MÊME', () => {
    expect(POLITIQUE_JOURNAL.preuvesClosesMs).toBe(TACHES_RETENTION_MS);
  });
});

// ─── 2. LE MAGASIN QUI L'EXÉCUTE ────────────────────────────────────────────

describe('HiveStore.pruneEvents — le propriétaire unique', () => {
  let store: HiveStore;
  const ouvrir = (): HiveStore => (store = new HiveStore(':memory:'));
  afterEach(() => store?.close());

  const politique = (p: Partial<PolitiqueJournal> = {}): PolitiqueJournal => ({
    fenetre: 5,
    preuvesClosesMs: TRENTE_JOURS_MS,
    plafond: 1_000_000,
    ...p,
  });
  const bavarder = (n: number): void => {
    for (let i = 0; i < n; i++) store.appendEvent('task_progress', { i }, T0);
  };
  const typesRestants = (): string[] => store.listEvents(0, 1000).map((e) => e.type);

  it('UNE TÂCHE OUVERTE GARDE SES PREUVES SOUS LA FENÊTRE ; LE BAVARDAGE PART, ET LE REGISTRE LE COMPTE', () => {
    ouvrir();
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'Garde', prompt: 'p' }, T0);
    store.appendEvent('task_assigned', { taskId: t.id, nodeId: 'n', modele: 'm' }, T0);
    store.appendEvent('task_progress', { taskId: t.id, log: 'bla' }, T0);
    store.appendEvent('task_retry', { taskId: t.id, source: 'evaluator' }, T0);
    bavarder(20);

    const bilan = store.pruneEvents(politique(), T0);

    expect(typesRestants().slice(0, 2)).toEqual(['task_assigned', 'task_retry']);
    expect(store.countEvents()).toBe(2 + 5);
    expect(bilan).toMatchObject({
      supprimes: 16,
      restants: 7,
      parMotif: { trace: 16, orpheline: 0, echue: 0, plafond_close: 0, plafond_vivante: 0 },
      parType: { task_progress: 16 },
      tachesPlafond: [],
    });
    // Des traces seulement : aucun fait d'une tâche connue n'a manqué.
    expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(false);
    expect(store.journalElague()).toBe(true);
  });

  it('CLOSE, UNE TÂCHE GARDE SES PREUVES TRENTE JOURS — puis les perd, MÊME SI UNE SURVIVANTE LA GARDE EN TABLE', () => {
    ouvrir();
    const p = store.createProject({ name: 'P' });
    const ancienne = store.createTask({ projectId: p.id, title: 'A', prompt: 'p' }, T0);
    // Une survivante qui dépend d'elle : `pruneTasks` ne la supprimera pas.
    store.createTask({ projectId: p.id, title: 'B', prompt: 'p', dependsOn: [ancienne.id] }, T0);
    store.patchTask(ancienne.id, { status: 'failed' }, T0);
    store.appendEvent('task_failed', { taskId: ancienne.id, nodeId: 'n' }, T0);
    bavarder(10);

    store.pruneEvents(politique(), T0 + 29 * JOUR);
    expect(typesRestants()).toContain('task_failed');

    const bilan = store.pruneEvents(politique(), T0 + 31 * JOUR);
    expect(typesRestants()).not.toContain('task_failed');
    expect(bilan.parMotif.echue).toBe(1);
    expect(store.getTask(ancienne.id), 'la tâche, elle, reste en table').toBeDefined();
    // Un fait Genome d'une tâche encore connue est parti : le registre le sait.
    expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(true);
  });

  it('LA FUSION DATE LA CLÔTURE : une production fusionnée hier garde ses preuves, même rendue il y a un mois', () => {
    ouvrir();
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'A', prompt: 'p' }, T0);
    store.patchTask(t.id, { status: 'done' }, T0);
    store.appendEvent('delivery_opened', { taskId: t.id, pr: 7 }, T0);
    store.setLivraison({
      taskId: t.id,
      projectId: p.id,
      depot: 'o/r',
      pr: 7,
      branche: 'hive/x',
      etat: 'fusionnee',
      now: T0 + 30 * JOUR,
    });
    bavarder(10);
    store.pruneEvents(politique(), T0 + 31 * JOUR);
    expect(typesRestants()).toContain('delivery_opened');
  });

  it('UNE TÂCHE DISPARUE NE GARDE RIEN — et ses faits ne tronquent pas le Genome, qui les ignore déjà', () => {
    ouvrir();
    store.appendEvent('task_done', { taskId: 'disparue', nodeId: 'n' }, T0);
    bavarder(10);
    const bilan = store.pruneEvents(politique(), T0);
    expect(bilan.parMotif.orpheline).toBe(1);
    expect(typesRestants()).not.toContain('task_done');
    expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(false);
  });

  it('LE PLAFOND : les closes d’abord, puis les vivantes — jamais la fenêtre, et le registre l’avoue', () => {
    ouvrir();
    const p = store.createProject({ name: 'P' });
    const close = store.createTask({ projectId: p.id, title: 'C', prompt: 'p' }, T0);
    store.patchTask(close.id, { status: 'failed' }, T0);
    const vivante = store.createTask({ projectId: p.id, title: 'V', prompt: 'p' }, T0);
    store.appendEvent('task_assigned', { taskId: vivante.id, nodeId: 'n' }, T0);
    store.appendEvent('task_failed', { taskId: close.id, nodeId: 'n' }, T0);
    store.appendEvent('task_retry', { taskId: vivante.id, source: 'evaluator' }, T0);
    bavarder(5);

    // 8 lignes, plafond 7 : la close suffit.
    let bilan = store.pruneEvents(politique({ plafond: 7 }), T0);
    expect(bilan).toMatchObject({
      supprimes: 1,
      parMotif: { plafond_close: 1, plafond_vivante: 0 },
      tachesPlafond: [close.id],
    });
    expect(typesRestants()).toEqual([
      'task_assigned',
      'task_retry',
      ...Array(5).fill('task_progress'),
    ]);

    // Plafond 5 : la vivante part en entier ; la fenêtre (les cinq derniers) reste.
    bilan = store.pruneEvents(politique({ plafond: 5 }), T0);
    expect(bilan.parMotif.plafond_vivante).toBe(2);
    expect(typesRestants()).toEqual(Array(5).fill('task_progress'));

    // Même un plafond nul ne touche pas la fenêtre.
    bilan = store.pruneEvents(politique({ plafond: 0 }), T0);
    expect(bilan.supprimes).toBe(0);
    expect(store.countEvents()).toBe(5);
    expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(true);
  });

  it('LE PLAFOND PREND LES DOSSIERS ENTIERS AVANT DE COUPER : une tâche qui a des preuves dans la fenêtre n’est prise qu’en dernier, et l’inactivité se lit sur tout le journal', () => {
    ouvrir();
    const p = store.createProject({ name: 'P' });
    const active = store.createTask({ projectId: p.id, title: 'A', prompt: 'p' }, T0);
    const endormie = store.createTask({ projectId: p.id, title: 'B', prompt: 'p' }, T0);
    // L'active : une vieille critique sous la fenêtre, sa tentative en cours DEDANS.
    store.appendEvent('task_retry', { taskId: active.id, source: 'evaluator' }, T0);
    store.appendEvent('task_assigned', { taskId: endormie.id, nodeId: 'n' }, T0);
    store.appendEvent('task_done', { taskId: endormie.id, nodeId: 'n' }, T0);
    bavarder(3);
    store.appendEvent('task_assigned', { taskId: active.id, nodeId: 'n' }, T0);
    store.appendEvent('task_started', { taskId: active.id, nodeId: 'n' }, T0);
    bavarder(3);

    // 11 lignes, fenêtre 5 : trois traces partent, il en reste 8 pour un plafond de 7.
    const bilan = store.pruneEvents(politique({ plafond: 7 }), T0);
    expect(bilan.tachesPlafond).toEqual([endormie.id]);
    expect(bilan.parMotif).toMatchObject({ trace: 3, plafond_vivante: 2 });
    // La critique de l'active est restée avec sa tentative.
    expect(typesRestants()).toEqual([
      'task_retry',
      'task_assigned',
      'task_started',
      ...Array(3).fill('task_progress'),
    ]);

    // Un plafond que les dossiers entiers ne tiennent plus COUPE, en tout
    // dernier recours et sous son propre motif — la fenêtre, elle, reste.
    expect(store.pruneEvents(politique({ plafond: 0 }), T0)).toMatchObject({
      supprimes: 1,
      parMotif: { plafond_coupe: 1 },
      tachesPlafond: [active.id],
    });
    expect(typesRestants()).toEqual([
      'task_assigned',
      'task_started',
      ...Array(3).fill('task_progress'),
    ]);
  });

  it('LE PLAFOND TIENT MÊME CONTRE UNE TÂCHE QUI BOUCLE — les preuves remplacées partent d’abord, la critique reste', () => {
    // Refusée pour saturation, remise en `ready`, réassignée trois secondes plus
    // tard (`scheduler.rejectTask`) : la tâche a TOUJOURS une preuve dans la
    // fenêtre. Sans la coupe, ses assignations d'en dessous survivaient toutes
    // et le journal grossissait sans borne, bien au-delà du plafond.
    ouvrir();
    const p = store.createProject({ name: 'P' });
    const boucle = store.createTask({ projectId: p.id, title: 'B', prompt: 'p' }, T0);
    store.appendEvent('task_retry', { taskId: boucle.id, source: 'evaluator' }, T0);
    for (let i = 0; i < 1_000; i++) {
      store.appendEvent('task_assigned', { taskId: boucle.id, nodeId: 'n' }, T0);
      store.appendEvent('task_rejected', { taskId: boucle.id, nodeId: 'n' }, T0);
      store.appendEvent('node_heartbeat', { nodeId: 'n' }, T0);
    }

    const bilan = store.pruneEvents(politique({ fenetre: 30, plafond: 200 }), T0);

    expect(store.countEvents()).toBe(200);
    expect(bilan.restants).toBe(200);
    expect(bilan.parMotif.plafond_coupe).toBeGreaterThan(0);
    expect(bilan.tachesPlafond).toEqual([boucle.id]);
    // La critique n'a pas de remplaçante : elle passe après les assignations
    // et refus répétés, et reste avec la tentative en cours.
    expect(typesRestants()[0]).toBe('task_retry');
    // Une seconde passe n'a plus rien à couper.
    expect(store.pruneEvents(politique({ fenetre: 30, plafond: 200 }), T0).supprimes).toBe(0);
  });

  it('L’AVEU « FAITS PERDUS » TOMBE QUAND LA DERNIÈRE TÂCHE QUI A PU LES PERDRE DISPARAÎT', () => {
    ouvrir();
    const p = store.createProject({ name: 'P' });
    const ancienne = store.createTask({ projectId: p.id, title: 'A', prompt: 'p' }, T0);
    const suite = store.createTask(
      { projectId: p.id, title: 'B', prompt: 'p', dependsOn: [ancienne.id] },
      T0,
    );
    store.patchTask(ancienne.id, { status: 'failed' }, T0);
    store.appendEvent('task_failed', { taskId: ancienne.id, nodeId: 'n' }, T0);
    bavarder(10);
    expect(store.pruneEvents(politique(), T0 + 31 * JOUR).parMotif.echue).toBe(1);
    expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(true);

    // Une tâche créée APRÈS le retrait n'a rien pu y perdre.
    store.createTask({ projectId: p.id, title: 'Neuve', prompt: 'p' }, T0 + 32 * JOUR);
    store.patchTask(suite.id, { status: 'failed' }, T0);
    expect(store.pruneTasks(TRENTE_JOURS_MS, T0 + 32 * JOUR)).toBe(2);
    expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(false);
  });

  it('LES FAITS RANGÉS SURVIVENT À L’ÉCHÉANCE ET AU PLAFOND : décision de Conseil, verdict du corpus de l’Aiguillage', () => {
    ouvrir();
    const p = store.createProject({ name: 'P' });
    store.creerSession({ id: 'conseil-1', question: 'Q', version: 1, now: T0 });
    store.appendEvent('council_decided', { sessionId: 'conseil-1', propositionId: 'a' }, T0);
    store.appendEvent('council_decided', { sessionId: 'conseil-1', propositionId: 'b' }, T0);
    // Une production close depuis longtemps, qu'une survivante garde en table,
    // et qui compte encore pour l'apprentissage de l'Aiguillage.
    const prod = store.createTask({ projectId: p.id, title: 'Prod', prompt: 'p' }, T0);
    store.createTask({ projectId: p.id, title: 'Suite', prompt: 'p', dependsOn: [prod.id] }, T0);
    store.patchTask(prod.id, { status: 'failed' }, T0);
    store.enregistrerContreVisite({
      productionTaskId: prod.id,
      suite: 'appliquer',
      raison: '',
      visiteurNodeId: 'v',
      visiteurAgent: 'codex',
      now: T0,
    });
    store.appendEvent(
      'contre_expertise_verdict',
      {
        source: 'hive_counter_review',
        taskId: prod.id,
        resultId: 1,
        producteurModele: 'opus-exact',
      },
      T0,
    );
    bavarder(5);

    store.pruneEvents(politique({ plafond: 0 }), T0 + 60 * JOUR);
    const restants = store.listEvents(0, 1000);
    expect(
      restants.filter((e) => e.type === 'council_decided').map((e) => e.payload.propositionId),
    ).toEqual(['b']);
    expect(restants.some((e) => e.type === 'contre_expertise_verdict')).toBe(true);
    expect(store.observationsAiguillage()[0]?.modeleExact).toBe('opus-exact');
  });

  it('DEUX PASSES SUR LES MÊMES FAITS : la seconde ne retire rien, le registre ne double rien', () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-retention-'));
    const chemin = path.join(dossier, 'hive.db');
    try {
      store = new HiveStore(chemin);
      bavarder(12);
      expect(store.pruneEvents(politique(), T0).supprimes).toBe(7);
      expect(store.pruneEvents(politique(), T0).supprimes).toBe(0);
      expect(registre(chemin)).toEqual([
        { type: 'task_progress', motif: 'trace', supprimes: 7, dernierA: T0 },
      ]);
    } finally {
      store.close();
      rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

/** Le registre des élagages tel qu'il est rangé, relu par une seconde connexion en lecture seule. */
function registre(
  chemin: string,
): Array<{ type: string; motif: string; supprimes: number; dernierA: number }> {
  const db = new Database(chemin, { readonly: true });
  try {
    return db
      .prepare('SELECT type, motif, supprimes, dernierA FROM journal_elagages ORDER BY type, motif')
      .all() as Array<{ type: string; motif: string; supprimes: number; dernierA: number }>;
  } finally {
    db.close();
  }
}

describe('une base écrite par la version précédente', () => {
  it('GAGNE L’INDEX PAR TYPE ET LE REGISTRE, ET AVOUE UNE SEULE FOIS CE QU’ELLE AVAIT DÉJÀ PERDU', () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-retention-ancienne-'));
    const chemin = path.join(dossier, 'hive.db');
    try {
      // Les tables telles que la version précédente les posait : un journal
      // AUTOINCREMENT déjà élagué à l'aveugle (dix ids attribués, quatre
      // restants), une tâche créée avant la mise à jour — et ni
      // `idx_events_type`, ni `journal_elagages`.
      const ancienne = new Database(chemin);
      ancienne.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, repoUrl TEXT, description TEXT,
          visibility TEXT NOT NULL DEFAULT 'private', ownerId TEXT, createdAt INTEGER NOT NULL);
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id),
          title TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          dependsOn TEXT NOT NULL DEFAULT '[]', assignedNodeId TEXT, result TEXT, branch TEXT,
          attempts INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}');
        CREATE INDEX idx_events_ts ON events(ts, type);
        INSERT INTO projects (id, name, createdAt) VALUES ('p', 'P', ${T0});
        INSERT INTO tasks (id, projectId, title, prompt, createdAt, updatedAt)
          VALUES ('d-avant', 'p', 'Avant', 'p', ${T0}, ${T0});
      `);
      const inserer = ancienne.prepare(
        "INSERT INTO events (ts, type, payload) VALUES (?, 'task_assigned', ?)",
      );
      for (let i = 0; i < 10; i++) inserer.run(T0, JSON.stringify({ taskId: 'd-avant', i }));
      ancienne.exec('DELETE FROM events WHERE id <= 6');
      // Un payload ILLISIBLE, écrit par une version qui ne le validait pas :
      // l'index par tâche et la passe de rétention doivent le lire comme une
      // trace, pas faire tomber l'ouverture de la base.
      ancienne
        .prepare("INSERT INTO events (ts, type, payload) VALUES (?, 'task_done', ?)")
        .run(T0, '{not json');
      ancienne.close();

      const avant = Date.now();
      let store = new HiveStore(chemin);
      const indexes = (): string[] => {
        const db = new Database(chemin, { readonly: true });
        try {
          return (
            db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
              name: string;
            }>
          ).map((r) => r.name);
        } finally {
          db.close();
        }
      };
      try {
        expect(indexes()).toEqual(expect.arrayContaining(['idx_events_type', 'idx_events_tache']));
        const amorce = registre(chemin);
        expect(amorce).toEqual([
          { type: '*', motif: 'avant_registre', supprimes: 6, dernierA: expect.any(Number) },
        ]);
        expect(amorce[0]?.dernierA).toBeGreaterThanOrEqual(avant);
        // Les six perdus avaient un type inconnu, et la tâche d'avant est là :
        // ses faits ont pu partir avec.
        expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(true);
        expect(store.countEvents()).toBe(5);
        // La passe relit le payload illisible sans tomber : une trace, comptée.
        const bilan = store.pruneEvents(
          { fenetre: 0, preuvesClosesMs: TRENTE_JOURS_MS, plafond: 1_000_000 },
          T0,
        );
        expect(bilan.parType).toEqual({ task_done: 1 });
        expect(bilan.parMotif.trace).toBe(1);
        expect(store.countEvents()).toBe(4);
      } finally {
        store.close();
      }

      // Réouverture : rien n'est réamorcé, rien n'est compté deux fois.
      store = new HiveStore(chemin);
      try {
        expect(registre(chemin)).toHaveLength(2);
        expect(registre(chemin)[0]?.supprimes).toBe(6);
        // Une tâche créée après n'a rien pu perdre à l'ancienne rétention…
        store.createTask({ projectId: 'p', title: 'Après', prompt: 'p' }, Date.now() + 1_000);
        expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(true);
        // …et quand la dernière tâche d'avant disparaît, l'aveu tombe avec elle.
        store.patchTask('d-avant', { status: 'failed' }, T0);
        expect(store.pruneTasks(0, Date.now())).toBe(1);
        expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(false);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('UNE BASE NEUVE N’A RIEN PERDU ET NE S’EN ACCUSE PAS', () => {
    const store = new HiveStore(':memory:');
    try {
      expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(false);
      expect(store.journalElague()).toBe(false);
    } finally {
      store.close();
    }
  });
});

// ─── 3. LA REINE QUI LA CADENCE — le banc de régression ─────────────────────
//
// C'est au tick que le défaut vivait : `store.pruneEvents(EVENT_RETENTION)`
// gardait les 5 000 derniers événements de tous types. Rejoué sur le code
// d'avant, ce banc rougit dès sa première attente de preuve — la critique de
// la tâche rouverte est partie avec le bavardage.

const JETON = 'jeton-retention-suffisamment-long-pour-le-banc';

describe('au tick de la Reine, une production garde ses preuves sous le bavardage', () => {
  let serveur: HiveServer | null = null;
  let dossier = '';
  afterEach(async () => {
    await serveur?.stop();
    serveur = null;
    if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
    dossier = '';
  });

  it('LA CRITIQUE, LA CI, LES FAITS GENOME RESTENT ; LE DIRECT RESTE LA FENÊTRE ; LA PASSE SE RACONTE', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-retention-reine-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: true,
      tickMs: 50,
    });
    const s = serveur;
    const lire = async <T>(route: string): Promise<T> => {
      const r = await fetch(`http://127.0.0.1:${s.port}${route}`, {
        headers: { 'x-hive-token': JETON },
      });
      expect(r.status, route).toBe(200);
      return (await r.json()) as T;
    };
    const p = s.store.createProject({ name: 'P' });

    // Une tâche rouverte par l'Evaluator, qui attend un Worker avec sa critique.
    const rouverte = s.store.createTask({ projectId: p.id, title: 'Garde', prompt: 'p' });
    s.store.appendEvent('task_retry', {
      taskId: rouverte.id,
      source: 'evaluator',
      attempt: 1,
      critique: { source: 'contre_revue', objections: ['le jeton vide passe'], raisons: [] },
    });

    // Une production rendue, qui attend un humain : sa CI, et ses faits Genome.
    const production = s.store.createTask({ projectId: p.id, title: 'Implémenter', prompt: 'p' });
    s.store.appendEvent('task_assigned', { taskId: production.id, nodeId: 'n1', modele: 'opus' });
    const resultId = s.store.insertResult({
      taskId: production.id,
      nodeId: 'n1',
      success: true,
      diff: 'diff --git a/x b/x\n+x',
      logs: '',
      durationMs: 5,
      subAgents: [],
    });
    s.store.appendEvent('task_done', { taskId: production.id, nodeId: 'n1', durationMs: 5 });
    s.store.appendEvent('validation_recorded', {
      source: 'github_pull_request',
      taskId: production.id,
      projectId: p.id,
      resultId,
      recordedAt: Date.now(),
      validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
      depot: 'o/r',
      pr: 42,
      branch: 'hive/mission-1',
      commitSha: 'a'.repeat(40),
    });
    s.store.patchTask(production.id, { status: 'done' });

    // Une nuit de progrès d'agent : plus qu'une fenêtre et qu'un lot.
    const bavardage = POLITIQUE_JOURNAL.fenetre + 600;
    s.store.enTransaction(() => {
      for (let i = 0; i < bavardage; i++) {
        s.store.appendEvent('task_progress', { taskId: production.id, log: `ligne ${i}` });
      }
    });
    const fin = Date.now() + 15_000;
    while (s.store.countEvents() > bavardage && Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(s.store.countEvents(), 'le tick a élagué').toBeLessThanOrEqual(bavardage);

    const critique = await lire<{ reprise: { critique: { objections: string[] } } | null }>(
      `/api/tasks/${rouverte.id}/critique`,
    );
    expect(critique.reprise?.critique.objections).toEqual(['le jeton vide passe']);

    const evaluation = await lire<EvaluationResult>(`/api/tasks/${production.id}/evaluation`);
    expect(evaluation.evidence.tests).toBe('passed');
    expect(evaluation.evidence.validationProvenance).toMatchObject({ pr: 42 });

    const genome = await lire<RegistreGenome>('/api/genome');
    expect(genome.lignes).toEqual([
      expect.objectContaining({ modele: 'opus', affectations: 1, rendus: 1 }),
    ]);
    expect(genome.fenetre.tronquee, 'seules des traces sont parties').toBe(false);

    // Le direct reste la fenêtre : la Chronique ne commence pas par les
    // preuves retenues d'en dessous.
    const replay = await lire<ReplayResult>('/api/replay?since=0');
    expect(replay.frames[0]?.eventId).toBeGreaterThan(
      replay.lastEventId - POLITIQUE_JOURNAL.fenetre,
    );
    expect(replay.eventCount).toBe(POLITIQUE_JOURNAL.fenetre);
    // `/api/events` sans curseur (`hive events`) aussi — « depuis 0 » rendait
    // la critique retenue de la tâche rouverte à la place de l'activité.
    const direct = await lire<Array<{ id: number }>>('/api/events?limit=1');
    expect(direct[0]?.id).toBeGreaterThan(replay.lastEventId - POLITIQUE_JOURNAL.fenetre);

    // La passe s'est racontée.
    const [recit] = s.store.evenementsParTypes(['journal_elagage'], 1);
    expect(recit?.payload).toMatchObject({
      parMotif: { trace: expect.any(Number), plafond_vivante: 0 },
      parType: { task_progress: expect.any(Number) },
    });
  });

  it('LES CYCLES DE L’ESSAIM SE LISENT AU DIRECT, PAS SOUS LES PREUVES RETENUES D’EN DESSOUS', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-retention-cycles-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: true,
      tickMs: 60_000,
    });
    const s = serveur;
    const p = s.store.createProject({ name: 'P' });
    const ouverte = s.store.createTask({ projectId: p.id, title: 'Ouverte', prompt: 'p' });
    // Plus de preuves retenues qu'une lecture « depuis l'id 0 » n'en prenait
    // (800), puis trois cycles, puis du direct.
    s.store.enTransaction(() => {
      for (let i = 0; i < 900; i++) s.store.appendEvent('task_requeued', { taskId: ouverte.id, i });
      for (let n = 1; n <= 3; n++) s.store.appendEvent('essaim_cycle', { projectId: p.id, n });
      s.store.appendEvent('essaim_cycle', { projectId: 'autre', n: 99 });
      for (let i = 0; i < 10; i++) s.store.appendEvent('task_progress', { i });
    });
    s.store.pruneEvents({ fenetre: 50, preuvesClosesMs: TRENTE_JOURS_MS, plafond: 1_000_000 });
    expect(s.store.countEvents(), 'les preuves de la tâche ouverte restent').toBeGreaterThan(900);

    const r = await fetch(`http://127.0.0.1:${s.port}/api/projects/${p.id}/essaim/cycles`, {
      headers: { 'x-hive-token': JETON },
    });
    expect(r.status).toBe(200);
    const { cycles } = (await r.json()) as { cycles: Array<{ n: number }> };
    expect(cycles.map((c) => c.n)).toEqual([3, 2, 1]);
  });
});
