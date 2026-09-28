// SUPPRIMER UN PROJET — pour de bon, sauf une ligne d'audit.
//
// ─── LE MANQUE QUE CE FICHIER FERME ──────────────────────────────────────────
//
// La Reine savait créer un projet, pas s'en défaire : aucune route ne le
// permettait, et un projet de test ou un dépôt importé par erreur restait pour
// toujours sur l'écran de tout le monde. Décision du propriétaire : SUPPRIMER,
// pas archiver — un projet supprimé n'existe plus nulle part, sauf l'événement
// `project_deleted`.
//
// ─── CE QUI EST PROUVÉ ICI, ET À QUELLE FRONTIÈRE ────────────────────────────
//
//   · LE MAGASIN : la cascade ne laisse AUCUNE ligne orpheline. Le banc relit
//     le SCHÉMA — toute table qui porte `projectId`, un identifiant de tâche, de
//     séance ou de résultat est remplie pour deux projets, puis on efface l'un
//     et on fouille TOUTES les tables. Une table ajoutée demain avec une colonne
//     `projectId` est remplie d'office par ce banc : si la cascade l'oublie, il
//     rougit.
//   · LE PLANIFICATEUR : le travail en vol est annulé, les ouvrières prévenues
//     APRÈS le COMMIT, et l'ouvrière libérée ne reçoit pas une tâche en file du
//     projet qu'on efface.
//   · LA ROUTE : le refus 409 qui nomme les tâches qui tournent, `force` qui
//     les annule d'abord, ce qui refuse même forcé, le miroir du Rayon effacé du
//     disque, et le fait d'audit — le seul qui reste.
//
// La garde des DEUX côtés (propriétaire, administratrice, jeton sur un orphelin
// / membre, tiers, jeton sur le projet d'autrui, anonyme) vit avec toutes les
// autres dans tests/engagement-projet.test.ts.

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { AUDITS_SUPPRESSION_CONSERVES, HiveStore } from '../src/orchestrator/store.js';
import { CHANTIER_TIMEOUT_MS } from '../src/shared/butoirs-noeud.js';
import type { HiveEvent, Task } from '../src/shared/types.js';
import { TYPES_REGISTRE_GENOME } from '../src/shared/registre-genome.js';
import { fenetreSeule } from './aide/journal-retenu.js';

const profil = (name: string) => ({
  name,
  ownerName: 'test',
  agentType: 'shell',
  maxConcurrency: 1,
});

// ─── Le magasin : aucune ligne orpheline ─────────────────────────────────────

/** Une colonne qui rattache une ligne à un projet — directement ou par l'un de ses objets. */
const LIEN = /^(projectId|taskId|[a-z]+TaskId|sessionId|resultId)$/;

/**
 * Les valeurs que les contraintes `CHECK` du schéma imposent. Une table neuve
 * avec un `CHECK` inconnu ici fait échouer l'insertion — le banc le dit, il ne
 * saute pas la table (voir l'assertion « chaque table liée a sa ligne »).
 */
const IMPOSEES: Readonly<Record<string, string>> = {
  'contre_visites.suite': 'appliquer',
  'reviews.state': 'approved',
  'sauvegardes.kind': 'manuel',
  'task_delegations.origin': 'hive',
  'garde_fou_exigences.exigence': 'exigee',
  'souvenirs_proposes.issue': 'retenu',
  'souvenirs_proposes.validePar': 'evaluator',
  'souvenirs_proposes.episode': 'contre_revue',
};

interface Colonne {
  name: string;
  type: string;
  pk: number;
}

/** Ce qui appartient à un projet, et qui doit disparaître (ou survivre) avec lui. */
interface Possessions {
  projet: string;
  tache: string;
  seance: string;
  resultat: number;
  requisition: string;
  /** Les identifiants TEXTE à chercher partout — un `resultId` entier n'est pas cherchable. */
  traces: string[];
}

describe('effacerProjet — la cascade du magasin', () => {
  let dir: string;
  let dbPath: string;
  let store: HiveStore;
  let brut: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-suppr-'));
    dbPath = path.join(dir, 'hive.db');
    store = new HiveStore(dbPath);
    // Une SECONDE connexion, pour écrire et lire ce que l'API du magasin
    // n'expose pas : c'est le schéma qu'on éprouve, pas l'API.
    brut = new Database(dbPath);
  });

  afterEach(() => {
    brut.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tables = (): string[] =>
    (
      brut
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((r) => r.name);
  const colonnes = (table: string): Colonne[] =>
    brut.prepare(`PRAGMA table_info(${table})`).all() as Colonne[];
  /** Les tables qu'un projet peut posséder, relues du schéma — jamais d'une liste tenue à la main. */
  const tablesLiees = (): string[] =>
    tables().filter((t) => t === 'events' || colonnes(t).some((c) => LIEN.test(c.name)));

  /** Les lignes de `table` qui nomment l'un de ces identifiants, n'importe où. */
  const lignesDe = (table: string, traces: readonly string[]): unknown[] =>
    (brut.prepare(`SELECT * FROM ${table}`).all() as unknown[]).filter((ligne) => {
      const texte = JSON.stringify(ligne);
      return traces.some((id) => texte.includes(id));
    });

  /** Un projet garni : ses objets de base par l'API, tout le reste par le schéma. */
  const garnir = (nom: string, noeud: string, compte: string): Possessions => {
    const projet = store.createProject({ name: nom }).id;
    const tache = store.createTask({
      id: randomUUID(),
      projectId: projet,
      title: 't',
      prompt: 'p',
    }).id;
    const seance = `conseil-${randomUUID()}`;
    store.creerSession({ id: seance, question: 'q', projectId: projet, version: 1 });
    const resultat = store.insertResult({
      taskId: tache,
      nodeId: noeud,
      success: true,
      diff: 'diff --git a/x b/x\n+y',
      logs: '',
      durationMs: 5,
      subAgents: [],
    });
    const req = store.ouvrirRequisition(noeud, 'cle_api', 'Une clé', null, tache);
    if (!req.ok) throw new Error('réquisition impossible');
    const p: Possessions = {
      projet,
      tache,
      seance,
      resultat,
      requisition: req.id,
      traces: [projet, tache, seance, req.id],
    };
    const DEJA = new Set(['projects', 'tasks', 'conseil_sessions', 'results', 'requisitions']);
    // UNE transaction pour tout le remplissage : sous Windows, chaque écriture
    // validée seule coûte un fsync, et ce banc en ferait une quarantaine.
    const remplir = brut.transaction(() => {
      for (const table of tablesLiees()) {
        if (table === 'events' || DEJA.has(table)) continue;
        remplirTable(table);
      }
    });
    const remplirTable = (table: string): void => {
      const cols = colonnes(table).filter((c) => !(c.pk === 1 && c.type === 'INTEGER'));
      const valeur = (c: Colonne): string | number => {
        if (c.name === 'projectId') return p.projet;
        if (c.name === 'taskId' || /TaskId$/.test(c.name)) return p.tache;
        if (c.name === 'sessionId') return p.seance;
        if (c.name === 'resultId') return p.resultat;
        if (/nodeId$/i.test(c.name)) return noeud;
        if (c.name === 'userId') return compte;
        const imposee = IMPOSEES[`${table}.${c.name}`];
        if (imposee !== undefined) return imposee;
        if (c.pk > 0) return randomUUID();
        return c.type === 'INTEGER' ? 1 : 'x';
      };
      // OR IGNORE : une table déjà remplie par l'API (sauvegarde d'étape,
      // mémoire…) garde sa ligne. Une contrainte violée saute la ligne — et
      // l'assertion « chaque table liée a sa ligne » le fait voir.
      brut
        .prepare(
          `INSERT OR IGNORE INTO ${table} (${cols.map((c) => c.name).join(', ')})
           VALUES (${cols.map(() => '?').join(', ')})`,
        )
        .run(...cols.map(valeur));
    };
    remplir();
    // Le journal, sous chacune des clés qui désignent le projet ou ses objets.
    store.appendEvent('project_created', { projectId: projet, name: nom });
    store.appendEvent('task_done', { taskId: tache, nodeId: noeud });
    store.appendEvent('delegation_created', { childTaskId: tache, parentTaskId: 'ailleurs' });
    store.appendEvent('council_decided', { sessionId: seance });
    store.appendEvent('requisition_ouverte', { id: req.id, nodeId: noeud, genre: 'cle_api' });
    return p;
  };

  it('AUCUNE LIGNE NE SURVIT AU PROJET, DANS AUCUNE TABLE — et le voisin ne perd rien', () => {
    const noeud = store.registerNode(profil('n1')).id;
    const compte = store.createUser({ email: 'a@b.c', passwordHash: 'h', displayName: 'A' }).id;
    const efface = garnir('À effacer', noeud, compte);
    const garde = garnir('À garder', noeud, compte);
    store.appendEvent('thermo_shift', { bande: 'tiede', facteur: 1 });

    // Le banc n'a de valeur que si CHAQUE table liée a vraiment reçu une ligne
    // du projet effacé : une table sautée passerait la fouille pour rien.
    const liees = tablesLiees();
    expect(liees.length, 'le schéma relu ne rattache presque rien aux projets').toBeGreaterThan(30);
    for (const table of liees) {
      expect(lignesDe(table, efface.traces).length, `${table} n’a pas été garnie`).toBeGreaterThan(
        0,
      );
    }
    const avant = new Map(tables().map((t) => [t, lignesDe(t, garde.traces).length]));

    const bilan = store.effacerProjet(efface.projet);

    expect(bilan, 'le projet existait').not.toBeNull();
    // Le bilan nomme chaque table liée : une table neuve que la cascade ne
    // visite pas rougit ICI, avec son nom, avant même la fouille.
    for (const table of liees) {
      expect(Object.keys(bilan ?? {}), `${table} n’est pas dans la cascade`).toContain(table);
    }
    for (const table of tables()) {
      expect(lignesDe(table, efface.traces), `${table} garde une ligne du projet`).toEqual([]);
    }
    expect(
      brut.prepare('SELECT COUNT(*) AS n FROM results WHERE id = ?').get(efface.resultat),
      'le résultat du projet est resté',
    ).toEqual({ n: 0 });
    for (const table of tables()) {
      expect(lignesDe(table, garde.traces).length, `${table} : le projet voisin a perdu`).toBe(
        avant.get(table),
      );
    }
    // Ce qui n'appartient à aucun projet ne bouge pas.
    expect(store.getNode(noeud)).toBeDefined();
    expect(store.listEvents().some((e) => e.type === 'thermo_shift')).toBe(true);
  });

  it('un identifiant de tâche COURT n’efface pas un événement qui porte le même mot ailleurs', () => {
    // Les tâches acceptent des identifiants libres (`socle`, `tests`). Un
    // effacement qui chercherait le mot dans tout le payload emporterait une
    // catégorie, un motif, une bande — le journal d'un AUTRE projet.
    const projet = store.createProject({ name: 'P' }).id;
    store.createTask({ id: 'socle', projectId: projet, title: 't', prompt: 'p' });
    const sienne = store.appendEvent('task_ready', { taskId: 'socle' });
    const voisine = store.appendEvent('pheromone_route', { categorie: 'socle' });

    store.effacerProjet(projet);

    const restants = store.listEvents().map((e) => e.id);
    expect(restants, 'l’événement de la tâche est resté').not.toContain(sienne.id);
    expect(restants, 'un événement étranger a été effacé sur un mot').toContain(voisine.id);
  });

  // #497 × #498. La rétention tient un registre de CE QU'ELLE A RETIRÉ, et le
  // registre Genome se dit « tronqué » dès que le journal a perdu des lignes
  // que ce registre n'explique pas. La cascade est l'autre chemin qui retire
  // des événements : muette au registre, une seule suppression de projet
  // laissait le Genome de TOUTE la ruche « tronqué » pour la vie de la base.
  it('LE REGISTRE DE LA RÉTENTION EXPLIQUE CE QUE LA CASCADE RETIRE — le Genome ne se dit pas tronqué', () => {
    const projet = store.createProject({ name: 'P' }).id;
    const tache = store.createTask({ projectId: projet, title: 't', prompt: 'p' }).id;
    store.appendEvent('task_done', { taskId: tache, nodeId: 'n1' });
    store.appendEvent('task_progress', { taskId: tache, message: '…' });
    store.appendEvent('project_created', { projectId: projet, name: 'P' });
    store.appendEvent('thermo_shift', { bande: 'tiede', facteur: 1 });
    expect(store.faitsElagues(TYPES_REGISTRE_GENOME), 'le banc : rien de perdu avant').toBe(false);

    store.effacerProjet(projet, 42);

    expect(store.faitsElagues(TYPES_REGISTRE_GENOME)).toBe(false);
    expect(
      brut
        .prepare('SELECT type, motif, supprimes, dernierA FROM journal_elagages ORDER BY type')
        .all(),
    ).toEqual([
      { type: 'project_created', motif: 'trace', supprimes: 1, dernierA: 42 },
      { type: 'task_done', motif: 'orpheline', supprimes: 1, dernierA: 42 },
      { type: 'task_progress', motif: 'trace', supprimes: 1, dernierA: 42 },
    ]);
  });

  it('une ligne de journal ILLISIBLE ne fait pas échouer la suppression — et reste', () => {
    // La rétention (#497) sait qu'un payload peut être illisible et le lit
    // gardé ; `json_extract` / `json_each` nus LÈVENT sur lui, et la
    // transaction entière aurait échoué sur une seule ligne abîmée.
    const projet = store.createProject({ name: 'P' }).id;
    const tache = store.createTask({ projectId: projet, title: 't', prompt: 'p' }).id;
    store.appendEvent('task_done', { taskId: tache });
    brut
      .prepare(`INSERT INTO events (ts, type, payload) VALUES (1, 'task_done', '{pas du json')`)
      .run();

    expect(store.effacerProjet(projet)).not.toBeNull();
    expect(store.getProject(projet)).toBeUndefined();
    expect(
      brut.prepare(`SELECT payload FROM events`).all(),
      'seule la ligne illisible reste : elle ne nomme rien',
    ).toEqual([{ payload: '{pas du json' }]);
  });

  it('un projet inconnu : `null`, et rien n’est touché', () => {
    const projet = store.createProject({ name: 'P' }).id;
    store.createTask({ projectId: projet, title: 't', prompt: 'p' });
    const total = (): number =>
      tables().reduce(
        (n, t) => n + (brut.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
        0,
      );
    const avant = total();
    expect(store.effacerProjet('projet-qui-nexiste-pas')).toBeNull();
    expect(total()).toBe(avant);
  });
});

// ─── Le planificateur : annuler, effacer, journaliser — en un seul geste ─────

describe('Scheduler.supprimerProjet — le travail en vol', () => {
  let store: HiveStore;

  beforeEach(() => {
    store = new HiveStore(':memory:');
  });
  afterEach(() => store.close());

  it('L’OUVRIÈRE EST PRÉVENUE APRÈS LE COMMIT — et ne repart pas sur le projet effacé', () => {
    // LE PIÈGE que `cancelTask` aurait tendu : il relance l'assignation dans la
    // foulée. L'ouvrière libérée par l'annulation aurait reçu la tâche EN FILE
    // du projet même qu'on efface — un travail parti pour un projet disparu.
    const annulations: Array<{ nodeId: string; taskId: string; raison: string; resteA: boolean }> =
      [];
    const assignations: string[] = [];
    const diffuses: HiveEvent[] = [];
    const scheduler = new Scheduler(store, {
      onCancel: (nodeId, taskId, raison) =>
        annulations.push({ nodeId, taskId, raison, resteA: store.getTask(taskId) !== undefined }),
      onAssign: (_nodeId, task: Task) => assignations.push(task.id),
      onEvent: (e) => diffuses.push(e),
    });
    const a = store.createProject({ name: 'À effacer' });
    const b = store.createProject({ name: 'Voisin' });
    const noeud = scheduler.registerNode(profil('n1'));
    const enVol = store.createTask({ projectId: a.id, title: 'en vol', prompt: 'p' });
    scheduler.tick();
    expect(store.getTask(enVol.id)?.status, 'le banc : la tâche doit tourner').toBe('assigned');
    const enFile = store.createTask({ projectId: a.id, title: 'en file', prompt: 'p' });
    const voisine = store.createTask({ projectId: b.id, title: 'voisine', prompt: 'p' });
    scheduler.tick();
    expect(store.getTask(enFile.id)?.status, 'le banc : une seule place').toBe('ready');
    assignations.length = 0;

    const fait = scheduler.supprimerProjet(a, 'compte-42');

    expect(fait?.annulees).toBe(1);
    expect(annulations).toEqual([
      { nodeId: noeud.id, taskId: enVol.id, raison: 'project_deleted', resteA: false },
    ]);
    expect(assignations, 'l’ouvrière libérée doit servir le VOISIN').toEqual([voisine.id]);
    expect(store.getTask(enFile.id), 'la tâche en file est partie avec le projet').toBeUndefined();
    expect(store.getProject(a.id)).toBeUndefined();

    // Le fait d'audit : rangé, diffusé, et le SEUL qui nomme encore le projet.
    const audit = store.listEvents().filter((e) => JSON.stringify(e.payload).includes(a.id));
    expect(audit.map((e) => e.type)).toEqual(['project_deleted']);
    expect(audit[0]?.payload).toMatchObject({
      projectId: a.id,
      name: 'À effacer',
      parUserId: 'compte-42',
      annulees: 1,
      effaces: { projects: 1, tasks: 2 },
    });
    expect(diffuses.map((e) => e.type)).toContain('project_deleted');
  });

  it('le plafond et le grand livre OUBLIENT le projet — la porte ne lit plus un fantôme', () => {
    const scheduler = new Scheduler(store, { balance: { mode: 'observation' } });
    const p = store.createProject({ name: 'P' });
    const noeud = scheduler.registerNode(profil('n1'));
    const t = store.createTask({ projectId: p.id, title: 't', prompt: 'p' });
    scheduler.setPlafond(p.id, 60_000);
    scheduler.tick();
    scheduler.handleTaskResult(noeud.id, {
      taskId: t.id,
      success: true,
      diff: '',
      logs: '',
      durationMs: 10,
      subAgents: [],
    });
    scheduler.tick();
    expect(
      scheduler.balance.soldes.map((s) => s.projectId),
      'le banc : le projet est au livre',
    ).toContain(p.id);

    scheduler.supprimerProjet(p, null);

    expect(scheduler.balance.soldes.map((s) => s.projectId)).not.toContain(p.id);
    expect(store.getBudget(p.id)).toBeNull();
  });

  it('LE FAIT D’AUDIT SURVIT À L’ÉLAGAGE DU JOURNAL — sinon le projet n’aurait jamais existé', () => {
    // Le journal tourne en quelques heures sur une ruche occupée. La seule
    // trace d'un projet supprimé ne doit pas partir avec : sans elle, plus
    // rien ne dit qu'il a existé, ni qui l'a effacé, ni ce qui est parti.
    const scheduler = new Scheduler(store);
    const p = store.createProject({ name: 'Éphémère' });
    scheduler.supprimerProjet(p, 'compte-7');
    const retention = 50;
    for (let i = 0; i <= retention; i++) store.appendEvent('thermo_shift', { i });

    expect(
      store.pruneEvents(fenetreSeule(retention)).supprimes,
      'le banc : l’élagage doit mordre',
    ).toBeGreaterThan(0);

    const audit = store.listEvents(0, 10_000).filter((e) => e.type === 'project_deleted');
    expect(audit.map((e) => e.payload)).toEqual([
      expect.objectContaining({ projectId: p.id, name: 'Éphémère', parUserId: 'compte-7' }),
    ]);
  });

  it('LES FAITS D’AUDIT SONT ÉPARGNÉS PAR NOMBRE, PAS SANS FIN — les plus anciens partent, et le registre le dit', () => {
    // « Un geste humain » ne bornait rien : un script qui crée et supprime des
    // projets en boucle posait autant de lignes qu'il voulait, chacune hors de
    // la fenêtre ET du plafond. Seuls les `AUDITS_SUPPRESSION_CONSERVES` plus
    // récents sont épargnés ; les autres redeviennent des traces (#527).
    const surplus = 3;
    store.enTransaction(() => {
      for (let i = 0; i < AUDITS_SUPPRESSION_CONSERVES + surplus; i++) {
        store.appendEvent('project_deleted', { projectId: `p-${i}`, name: `P${i}` });
      }
    });
    for (let i = 0; i <= 50; i++) store.appendEvent('thermo_shift', { i });

    const bilan = store.pruneEvents(fenetreSeule(50));

    const audits = store
      .listEvents(0, 10_000)
      .filter((e) => e.type === 'project_deleted')
      .map((e) => e.payload.projectId);
    expect(audits).toHaveLength(AUDITS_SUPPRESSION_CONSERVES);
    expect(audits, 'un audit ancien a survécu au-delà du nombre').not.toContain('p-2');
    expect(audits, 'le plus récent est parti').toContain(
      `p-${AUDITS_SUPPRESSION_CONSERVES + surplus - 1}`,
    );
    expect(audits, 'le plus ancien épargné est parti').toContain(`p-${surplus}`);
    expect(bilan.supprimes, 'le registre ne compte pas ce qui part').toBeGreaterThanOrEqual(
      surplus,
    );
  });

  it('un projet inconnu : `null`, aucune annulation, aucun fait', () => {
    const annulations: string[] = [];
    const scheduler = new Scheduler(store, { onCancel: (_n, taskId) => annulations.push(taskId) });
    const avant = store.listEvents().length;
    expect(scheduler.supprimerProjet({ id: 'fantome', name: 'F' }, null)).toBeNull();
    expect(annulations).toEqual([]);
    expect(store.listEvents()).toHaveLength(avant);
  });
});

// ─── La route : refus, forçage, disque, audit ────────────────────────────────

const TOKEN = 'jeton-de-ruche-suffisamment-long-42';

describe('DELETE /api/projects/:projectId', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-suppr-route-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const supprimer = (projet: string, force = false): Promise<Response> =>
    fetch(`${base}/api/projects/${projet}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
      headers: { 'x-hive-token': TOKEN },
    });
  /** Un projet de la ruche (orphelin : le jeton en répond), avec une tâche qui tourne. */
  const projetQuiTourne = (): { projet: string; tache: string; noeud: string } => {
    const s = server.store;
    const projet = s.createProject({ name: `En cours ${randomUUID()}` }).id;
    const noeud = s.registerNode(profil('n-route')).id;
    const tache = s.createTask({ projectId: projet, title: 'Tâche qui tourne', prompt: 'p' }).id;
    s.patchTask(tache, { status: 'running', assignedNodeId: noeud });
    return { projet, tache, noeud };
  };

  it('DES TÂCHES TOURNENT : 409 qui les NOMME, et le projet reste entier', async () => {
    const { projet, tache, noeud } = projetQuiTourne();
    const r = await supprimer(projet);
    expect(r.status).toBe(409);
    const corps = (await r.json()) as { code: string; taches: unknown[] };
    expect(corps.code).toBe('taches_en_vol');
    expect(corps.taches).toEqual([
      { id: tache, title: 'Tâche qui tourne', status: 'running', nodeId: noeud },
    ]);
    expect(server.store.getProject(projet), 'refusé, mais effacé quand même').toBeDefined();
    expect(server.store.getTask(tache)?.status).toBe('running');
  });

  it('`force=true` les annule D’ABORD, puis supprime — et le dit', async () => {
    const { projet, tache } = projetQuiTourne();
    const r = await supprimer(projet, true);
    expect(r.status).toBe(200);
    const corps = (await r.json()) as {
      supprime: boolean;
      annulees: number;
      effaces: Record<string, number>;
      lignes: number;
    };
    expect(corps).toMatchObject({ supprime: true, annulees: 1 });
    expect(corps.effaces).toMatchObject({ projects: 1, tasks: 1 });
    expect(corps.lignes).toBeGreaterThanOrEqual(2);
    expect(server.store.getProject(projet)).toBeUndefined();
    expect(server.store.getTask(tache)).toBeUndefined();
  });

  it.each([
    [
      'une livraison dont l’appel GitHub est en vol',
      'travail_non_annulable',
      (projet: string, tache: string) =>
        server.store.reserverLivraison({
          taskId: tache,
          projectId: projet,
          depot: 'o/r',
          branche: 'b',
        }),
    ],
    [
      'un abonnement actif',
      'hebergement_actif',
      (projet: string) =>
        server.store.setAbonnement({
          projectId: projet,
          plan: 'eclaireuse',
          etat: 'actif',
          refExterne: 'sub_1',
          finPeriode: null,
          impayeDepuis: null,
          majA: 1,
        }),
    ],
    [
      'une machine encore chez le fournisseur',
      'hebergement_actif',
      (projet: string) =>
        server.store.setServeur({
          id: randomUUID(),
          projectId: projet,
          refAbonnement: 'sub_2',
          etat: 'arrete',
          fournisseur: 'fictif',
          refMachine: 'm-1',
          gabarit: 'petit',
          motif: '',
          creeA: 1,
          majA: 1,
          arreteA: 1,
        }),
    ],
  ] as const)('%s : 409 MÊME FORCÉ — cela ne s’annule pas', async (_cas, code, poser) => {
    // Forcer annule des tâches ; il n'arrête ni un appel GitHub en vol, ni une
    // machine qu'on paie. Effacer la ligne `serveurs` d'une machine existante
    // perdrait la seule trace de ce qui coûte, et personne ne l'éteindrait.
    const projet = server.store.createProject({ name: `Bloqué ${randomUUID()}` }).id;
    const tache = server.store.createTask({ projectId: projet, title: 't', prompt: 'p' }).id;
    poser(projet, tache);
    const r = await supprimer(projet, true);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe(code);
    expect(server.store.getProject(projet)).toBeDefined();
  });

  it('LE MIROIR DU RAYON QUITTE LE DISQUE de la Reine', async () => {
    const projet = server.store.createProject({ name: 'Avec miroir' }).id;
    const miroir = path.join(dir, 'rayons', projet);
    mkdirSync(path.join(miroir, '.git'), { recursive: true });
    writeFileSync(path.join(miroir, 'index.html'), '<h1>ancien code</h1>');
    // Le reclone voisin (#509) d'une Reine arrêtée en plein clone.
    const voisin = path.join(dir, 'rayons', `.neuf-${projet}`);
    mkdirSync(path.join(voisin, '.git'), { recursive: true });

    const r = await supprimer(projet);

    expect(r.status).toBe(200);
    expect(((await r.json()) as { miroir: string }).miroir).toBe('efface');
    expect(existsSync(miroir), 'le clone du dépôt est resté sur le disque').toBe(false);
    expect(existsSync(voisin), 'le reclone interrompu est resté sur le disque').toBe(false);
    // Sans miroir, la réponse le dit aussi — elle n'invente pas un effacement.
    const sans = server.store.createProject({ name: 'Sans miroir' }).id;
    expect(((await (await supprimer(sans)).json()) as { miroir: string }).miroir).toBe('absent');
  });

  // Un disque qui refuse (droits retirés sur le dossier parent). Sans objet
  // sous Windows, où `chmod` ne retire pas le droit d'effacer, et pour root,
  // qui passe outre.
  const disqueRefusable = process.platform !== 'win32' && process.getuid?.() !== 0;
  it.runIf(disqueRefusable)(
    'UN MIROIR QUI RÉSISTE N’ANNULE PAS LA SUPPRESSION — il se DIT, avec son dossier',
    async () => {
      const projet = server.store.createProject({ name: 'Miroir coriace' }).id;
      const racine = path.join(dir, 'rayons');
      const miroir = path.join(racine, projet);
      mkdirSync(path.join(miroir, '.git'), { recursive: true });
      const dits: string[] = [];
      const errOrigine = console.error;
      console.error = (...args: unknown[]) => void dits.push(args.map(String).join(' '));
      chmodSync(racine, 0o500);
      try {
        const r = await supprimer(projet);
        expect(r.status, 'la suppression est rangée : le disque ne la défait pas').toBe(200);
        expect(((await r.json()) as { miroir: string }).miroir).toBe('echec');
      } finally {
        chmodSync(racine, 0o700);
        console.error = errOrigine;
      }
      expect(server.store.getProject(projet)).toBeUndefined();
      expect(dits.join('\n'), 'l’hôte ne saurait pas quoi effacer').toContain(miroir);
    },
  );

  it('LE JOURNAL DU PROJET PART, SAUF LE FAIT D’AUDIT — qui dit qui, quoi, combien', async () => {
    const creation = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ name: 'Journal à effacer' }),
    });
    const { id: projet } = (await creation.json()) as { id: string };
    await fetch(`${base}/api/projects/${projet}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ tasks: [{ title: 'Une tâche', prompt: 'faire' }] }),
    });
    const nomment = () =>
      server.store.listEvents(0, 10_000).filter((e) => JSON.stringify(e.payload).includes(projet));
    expect(
      nomment().map((e) => e.type),
      'le banc : le projet a un journal',
    ).toEqual(expect.arrayContaining(['project_created', 'task_created']));

    expect((await supprimer(projet)).status).toBe(200);

    const restes = nomment();
    expect(restes.map((e) => e.type)).toEqual(['project_deleted']);
    expect(restes[0]?.payload).toMatchObject({
      projectId: projet,
      name: 'Journal à effacer',
      annulees: 0,
      effaces: { projects: 1, tasks: 1 },
    });
    // Le jeton de ruche n'est le compte de personne : aucun auteur inventé.
    expect(restes[0]?.payload).not.toHaveProperty('parUserId');
    // Et l'écran n'a plus de carte à montrer.
    const etat = (await (
      await fetch(`${base}/api/state`, { headers: { 'x-hive-token': TOKEN } })
    ).json()) as { projects: { id: string }[] };
    expect(etat.projects.map((p) => p.id)).not.toContain(projet);
  });

  it('`force` n’accepte qu’un booléen — un mot mal tapé ne force rien', async () => {
    const { projet } = projetQuiTourne();
    const r = await fetch(`${base}/api/projects/${projet}?force=oui`, {
      method: 'DELETE',
      headers: { 'x-hive-token': TOKEN },
    });
    expect(r.status).toBe(400);
    expect(server.store.getProject(projet)).toBeDefined();
  });
});

// ─── Ce qui ne s'annule pas, EN VRAI : un merge, un chantier, un cycle ───────
//
// Le banc au-dessus pose une livraison en vol à la main. Un merge, un chantier
// ou un cycle d'autonomie, eux, ne vivent qu'EN MÉMOIRE de la Reine : on ne
// peut les mettre en vol qu'en les lançant vraiment — un vrai socket d'ouvrière
// qui reçoit son `assign_merge` / `assign_chantier` et se tait, un vrai cycle
// d'autonomie suspendu sur un GitHub simulé qui ne répond pas encore. Chacun
// doit refuser la suppression MÊME FORCÉE, avec son compte, et laisser le
// projet entier : son résultat reviendrait sinon pour un projet disparu.

describe('ce qui ne s’annule pas refuse même forcé — lancé pour de vrai', () => {
  const dossiers: string[] = [];
  const sockets: WebSocket[] = [];
  let srv: HiveServer | null = null;

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await srv?.stop();
    srv = null;
    for (const d of dossiers.splice(0)) {
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const demarrer = async (): Promise<{ srv: HiveServer; base: string }> => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-suppr-vol-'));
    dossiers.push(dir);
    srv = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    return { srv, base: `http://127.0.0.1:${srv.port}` };
  };

  /** Une ouvrière connectée qui reçoit ce qu'on lui confie — et ne rend jamais rien. */
  const ouvriereMuette = (port: number, nodeId: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(ws);
      ws.on('open', () =>
        ws.send(JSON.stringify({ type: 'register', token: TOKEN, nodeId, ...profil(nodeId) })),
      );
      ws.on('message', (d) => {
        if ((JSON.parse(d.toString()) as { type?: string }).type === 'registered') resolve();
      });
      ws.on('error', reject);
    });

  const supprimerForce = (base: string, projet: string): Promise<Response> =>
    fetch(`${base}/api/projects/${projet}?force=true`, {
      method: 'DELETE',
      headers: { 'x-hive-token': TOKEN },
    });
  const post = (base: string, chemin: string, corps: unknown = {}): Promise<Response> =>
    fetch(`${base}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify(corps),
    });

  it('UN MERGE CONFIÉ À UNE OUVRIÈRE : 409 `merges: 1`, et le projet reste entier', async () => {
    const { srv: s, base } = await demarrer();
    await ouvriereMuette(s.port, 'muette-merge');
    const projet = s.store.createProject({
      name: 'Merge en vol',
      repoUrl: 'https://github.com/o/r.git',
    }).id;
    const tache = s.store.createTask({ projectId: projet, title: 't', prompt: 'p' }).id;
    s.store.patchTask(tache, { status: 'done' });
    s.store.insertResult({
      taskId: tache,
      nodeId: 'seed',
      success: true,
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    const lance = await post(base, `/api/projects/${projet}/merge/run`);
    expect(lance.status, 'le banc : le merge doit partir').toBe(202);

    const r = await supprimerForce(base, projet);

    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'travail_non_annulable', merges: 1 });
    expect(s.store.getProject(projet)).toBeDefined();
    expect(s.store.getTask(tache)).toBeDefined();
  });

  it('UN CHANTIER CONFIÉ À UNE OUVRIÈRE : 409 `chantiers: 1`, et le projet reste entier', async () => {
    const { srv: s, base } = await demarrer();
    await ouvriereMuette(s.port, 'muette-chantier');
    // Un vrai dépôt LOCAL qui déclare `test` : la Reine clone son miroir pour
    // lire le `package.json` avant d'accepter le chantier — sans réseau.
    const { simpleGit } = await import('simple-git');
    const depot = mkdtempSync(path.join(os.tmpdir(), 'hive-suppr-depot-'));
    dossiers.push(depot);
    writeFileSync(
      path.join(depot, 'package.json'),
      JSON.stringify({ name: 'depot', scripts: { test: 'vitest run' } }),
    );
    const g = simpleGit({ baseDir: depot });
    await g.init();
    await g.addConfig('user.email', 't@example.com');
    await g.addConfig('user.name', 'T');
    await g.addConfig('commit.gpgsign', 'false');
    await g.add('.');
    await g.commit('initial');
    const projet = s.store.createProject({ name: 'Chantier en vol', repoUrl: depot }).id;
    const lance = await post(base, `/api/projects/${projet}/chantiers/test/run`);
    expect(lance.status, 'le banc : le chantier doit partir').toBe(202);

    const r = await supprimerForce(base, projet);

    expect(r.status).toBe(409);
    const corps = (await r.json()) as { code: string; chantiers: number; conseil: string };
    expect(corps).toMatchObject({ code: 'travail_non_annulable', chantiers: 1 });
    // La borne dite est celle du CHANTIER, pas celle d'un merge qui ne tourne pas.
    expect(corps.conseil).toContain(`${Math.ceil(CHANTIER_TIMEOUT_MS / 60_000)} min`);
    expect(s.store.getProject(projet)).toBeDefined();
  });
});

describe('un cycle d’autonomie en vol refuse même forcé', () => {
  let srv: HiveServer | null = null;
  let dir: string | null = null;
  let github: Server | null = null;
  let liberer: (() => void) | null = null;
  const avant: Record<string, string | undefined> = {};
  const CLES = ['HIVE_RUNNER', 'HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API'] as const;

  afterEach(async () => {
    liberer?.();
    liberer = null;
    await srv?.stop();
    srv = null;
    await new Promise<void>((r) => (github ? github.close(() => r()) : r()));
    github = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    for (const cle of CLES) {
      if (avant[cle] === undefined) delete process.env[cle];
      else process.env[cle] = avant[cle];
    }
  });

  it('LA RUCHE LIVRE TOUTE SEULE : 409 `autonomie: 1` tant que GitHub n’a pas répondu', async () => {
    // Un GitHub simulé qui RETIENT la première lecture : le cycle d'autonomie
    // (le pas « livrer ») reste suspendu dessus, en vol, jusqu'à la libération.
    let vu = false;
    github = createHttp((req, rep) => {
      req.resume();
      vu = true;
      liberer = () => {
        rep.writeHead(500, { 'content-type': 'application/json' });
        rep.end('{"message":"libéré par le banc"}');
      };
    });
    await new Promise<void>((r) => github?.listen(0, '127.0.0.1', r));
    const port = (github.address() as { port: number }).port;
    for (const cle of CLES) avant[cle] = process.env[cle];
    process.env.HIVE_RUNNER = 'on';
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-simule';
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${port}/api`;
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-suppr-auto-'));
    srv = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 30,
    });
    const base = `http://127.0.0.1:${srv.port}`;

    // Un projet GOUVERNABLE (deux ouvrières irréprochables en ligne) avec une
    // production relue et approuvée : le pas décidé est « livrer ».
    const projet = srv.store.createProject({
      name: 'Autonome',
      repoUrl: 'https://github.com/moi/projet.git',
    }).id;
    for (let i = 0; i < 2; i++) {
      const id = `gouv-${i}`;
      srv.store.registerNode({ nodeId: id, ...profil(id) });
      srv.store.setNodeStatus(id, 'online');
      for (let k = 0; k < SEUIL_BUTINEUSE; k++) {
        srv.store.enregistrerInspection({
          resultId: i * 1000 + k + 1,
          taskId: `T${i}-${k}`,
          nodeId: id,
          verdict: 'clean',
          score: 0,
          applique: false,
          griefs: [],
        });
      }
    }
    const t = srv.store.createTask({ projectId: projet, title: 'Passer a à 2', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'done' });
    srv.store.insertResult({
      taskId: t.id,
      nodeId: 'gouv-0',
      success: true,
      diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;',
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
    srv.store.setTaskReview(t.id, 'approved');
    const reglage = await fetch(`${base}/api/projects/${projet}/essaim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ niveau: 'gouverne', depotInscrit: false }),
    });
    expect(reglage.status, 'le banc : le niveau doit se poser').toBeLessThan(300);
    const fin = Date.now() + 5_000;
    while (!vu && Date.now() < fin) await new Promise((r) => setTimeout(r, 25));
    expect(vu, 'le banc : le cycle doit être suspendu sur GitHub').toBe(true);

    const r = await fetch(`${base}/api/projects/${projet}?force=true`, {
      method: 'DELETE',
      headers: { 'x-hive-token': TOKEN },
    });

    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'travail_non_annulable', autonomie: 1 });
    expect(srv.store.getProject(projet)).toBeDefined();
  });
});
