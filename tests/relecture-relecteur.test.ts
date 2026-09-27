// UNE RELECTURE NE CHANGE PAS DE FAMILLE.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// Une contre-expertise est confiée à une famille DIFFÉRENTE du producteur
// (`choisirCritiques`), et le lien consigne laquelle. Son verdict est rangé
// sous cette famille, et l'Aiguillage en apprend.
//
// Or la file ne savait pas qu'une relecture a une famille : revenue en file —
// relecteur saturé qui refuse (`noeud_sature`), ou déconnecté —, elle partait
// au premier nœud libre. Très souvent le PRODUCTEUR lui-même, qui venait
// justement de se libérer en rendant sa production : Claude relisait Claude,
// et le verdict était consigné comme celui de Codex.
//
// Ce n'était pas une vue de l'esprit sur le chemin par défaut : avec une
// ouvrière par agent, chacune à une tâche à la fois (`planOuvrieres`), le
// relecteur est occupé chaque fois que sa propre production tourne encore.
//
// La relecture attend donc SA famille — n'importe quel nœud de celle-ci. Et
// l'attente a un bout : une famille ABSENTE (aucun nœud en ligne) se dit au
// journal, puis fait échouer la relecture au-delà d'`ATTENTE_RELECTEUR_ABSENT_MS`.
// Une relecture prête pour toujours, sans un mot, ne vaut pas mieux qu'une
// relecture faite par le mauvais modèle.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTENTE_RELECTEUR_ABSENT_MS, Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { AGENTS_SANS_AVIS } from '../src/shared/contre-expertise.js';

/** Un instant fixe : tout le banc est daté, rien ne dépend de l'horloge. */
const T = 1_000_000;
/** Au-delà du refroidissement d'un refus (`REJECT_COOLDOWN_MS`, 3 s). */
const APRES_REFROIDISSEMENT = T + 10_000;
/** Une heure : le pas des veilles longues, bien au-delà de toute attente bornée. */
const HEURE = 3_600_000;
/** La consigne d'une relecture : elle cite les fichiers du diff qu'elle juge. */
const CONSIGNE = 'CONTRE-EXPERTISE — relis :\ndiff --git a/src/auth.ts b/src/auth.ts\n+garde';

describe('UNE RELECTURE NE CHANGE PAS DE FAMILLE', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  beforeEach(() => {
    store = new HiveStore(':memory:');
    scheduler = new Scheduler(store);
  });
  afterEach(() => store.close());

  /** Les charges d'un type d'événement, dans l'ordre du journal. */
  const evenements = (type: string): Array<Record<string, unknown>> =>
    store
      .listEvents(0, 1000)
      .filter((e) => e.type === type)
      .map((e) => e.payload);

  /**
   * Une production de Claude, et sa relecture confiée à Codex, posée comme le
   * hub la pose : tâche `pending`, liée AVANT toute passe du planificateur.
   * Codex tient une autre tâche : à une tâche à la fois, il est saturé. Le
   * producteur est nommé pour passer EN PREMIER dans l'ordre par défaut
   * (charge égale, puis nom) : c'est lui que la file choisissait.
   */
  function scene(): {
    producteur: string;
    relecteur: string;
    relecture: string;
    production: string;
    occupation: string;
    projet: string;
  } {
    const producteur = scheduler.registerNode(
      { name: 'aaa-claude', ownerName: 'banc', agentType: 'claude-code', maxConcurrency: 1 },
      T,
    ).id;
    const relecteur = scheduler.registerNode(
      { name: 'zzz-codex', ownerName: 'banc', agentType: 'codex', maxConcurrency: 1 },
      T,
    ).id;
    const p = store.createProject({ name: 'P' });
    const production = store.createTask({
      projectId: p.id,
      title: 'Ajoute un endpoint',
      prompt: 'implémente la route',
    });
    store.patchTask(production.id, { status: 'done', assignedNodeId: producteur }, T);
    const occupation = store.createTask({
      projectId: p.id,
      title: 'Travail de Codex',
      prompt: 'x',
    });
    store.patchTask(occupation.id, { status: 'running', assignedNodeId: relecteur }, T);
    // Sa consigne CITE le diff jugé, comme `consigneDeCritique` : des chemins.
    const relecture = store.createTask({
      projectId: p.id,
      title: 'Contre-expertise — Ajoute un endpoint',
      prompt: CONSIGNE,
    });
    store.inscrireRelecture({
      relectureTaskId: relecture.id,
      productionTaskId: production.id,
      relecteurNodeId: relecteur,
      relecteurAgent: 'codex',
      producteurAgent: 'claude-code',
      now: T,
    });
    return {
      producteur,
      relecteur,
      relecture: relecture.id,
      production: production.id,
      occupation: occupation.id,
      projet: p.id,
    };
  }

  it('LE RELECTEUR EST OCCUPÉ : la relecture l’attend, elle ne part pas chez le producteur libre', () => {
    const { producteur, relecteur, relecture, occupation } = scene();

    scheduler.tick(T + 10);
    const enFile = store.getTask(relecture);
    expect(enFile?.assignedNodeId ?? null, 'Claude relirait Claude sous le nom de Codex').not.toBe(
      producteur,
    );
    expect(enFile?.status, 'la relecture attend, en file').toBe('ready');
    // Occupé n'est pas absent : aucune attente à annoncer.
    expect(evenements('contre_expertise_review_waiting')).toEqual([]);

    store.patchTask(occupation, { status: 'done' }, T + 20);
    scheduler.tick(T + 20);
    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);
  });

  it('LE RELECTEUR SATURÉ REFUSE : la relecture revient en file, et lui revient à lui', () => {
    const { producteur, relecteur, relecture, occupation } = scene();
    // Une vue de la charge en retard d'un battement : le nœud Codex reçoit la
    // relecture et répond `noeud_sature` — son geste réel.
    store.patchTask(relecture, { status: 'assigned', assignedNodeId: relecteur }, T);
    scheduler.rejectTask(relecteur, relecture, 'noeud_sature', false, T + 10);

    expect(store.getTask(relecture)?.status).toBe('ready');
    scheduler.tick(T + 20);
    expect(store.getTask(relecture)?.assignedNodeId ?? null).not.toBe(producteur);

    store.patchTask(occupation, { status: 'done' }, APRES_REFROIDISSEMENT);
    scheduler.tick(APRES_REFROIDISSEMENT);
    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);
  });

  it('LE RELECTEUR SE DÉCONNECTE : l’attente se dit UNE fois, et il la reprend à son retour', () => {
    const { producteur, relecteur, relecture, occupation, production } = scene();
    store.patchTask(occupation, { status: 'done' }, T + 5);
    scheduler.tick(T + 5);
    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);

    // Perte du nœud Codex : ses tâches actives repartent en file.
    scheduler.nodeDisconnected(relecteur, 'ws_close', T + 10);
    for (let t = T + 20; t < T + 60_000; t += 2_000) scheduler.tick(t);
    expect(store.getTask(relecture)?.status).toBe('ready');
    expect(store.getTask(relecture)?.assignedNodeId ?? null, 'confiée au producteur').not.toBe(
      producteur,
    );
    // Trente ticks, UN fait : qui l'on attend, pour quelle production.
    expect(evenements('contre_expertise_review_waiting')).toEqual([
      {
        taskId: production,
        relecture,
        relecteur: 'codex',
        reviewerNodeId: relecteur,
        delaiMs: ATTENTE_RELECTEUR_ABSENT_MS,
      },
    ]);

    // Il revient (même identité, stable par dossier de travail).
    scheduler.heartbeat(relecteur, T + 60_000);
    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);
  });

  it('LA FAMILLE NE REVIENT JAMAIS : la relecture ÉCHOUE, dite — pas prête pour toujours', () => {
    // Le cas que la garde de famille rendait possible sans bout : ouvrière
    // ajoutée tombée, ruche relancée en `--une-ouvriere`, CLI désinstallé.
    const { producteur, relecteur, relecture, occupation, production } = scene();
    store.patchTask(occupation, { status: 'done' }, T + 5);
    scheduler.tick(T + 5);
    scheduler.nodeDisconnected(relecteur, 'ws_close', T + 10);
    scheduler.tick(T + 10);

    // Juste avant la borne : elle attend encore, sans avoir changé de mains.
    const avantBorne = T + 10 + ATTENTE_RELECTEUR_ABSENT_MS - 1;
    scheduler.heartbeat(producteur, avantBorne);
    scheduler.tick(avantBorne);
    expect(store.getTask(relecture)?.status).toBe('ready');
    expect(evenements('contre_expertise_review_failed')).toEqual([]);

    // Cinquante heures d'un producteur libre et vivant : l'issue tombe à la
    // borne, et une seule fois.
    for (let h = 1; h <= 50; h += 1) {
      scheduler.heartbeat(producteur, T + h * HEURE);
      scheduler.tick(T + h * HEURE);
    }
    const tache = store.getTask(relecture);
    expect(tache?.status, 'une relecture sans relecteur doit finir').toBe('failed');
    expect(tache?.assignedNodeId ?? null, 'et jamais chez le producteur').toBeNull();
    expect(evenements('task_failed')).toEqual([{ taskId: relecture, reason: 'relecteur_absent' }]);
    expect(evenements('contre_expertise_review_failed')).toEqual([
      {
        taskId: production,
        relecture,
        relecteur: 'codex',
        terminal: true,
        attempt: 0,
        motif: 'relecteur_absent',
      },
    ]);
    expect(evenements('contre_expertise_review_waiting')).toHaveLength(1);
  });

  it('LA RELECTURE ÉCHOUÉE FAUTE DE FAMILLE FERME SON SOUS-ARBRE DÉLÉGUÉ — rien n’en repart', () => {
    // Un relecteur tombé a pu déléguer avant de tomber. L'échec `relecteur_absent`
    // est une transition terminale comme les autres : ses enfants n'ont plus de
    // destinataire. Celui qui tourne est annulé chez son nœud ; celui qui
    // attend en file ne part plus — pas même sur la place que l'annulation du
    // premier vient de libérer, dans la passe même qui tranche.
    const annulations: Array<{ nodeId: string; taskId: string; reason: string }> = [];
    scheduler = new Scheduler(store, {
      onCancel: (nodeId, taskId, reason) => annulations.push({ nodeId, taskId, reason }),
    });
    const { producteur, relecteur, relecture, occupation } = scene();
    store.patchTask(occupation, { status: 'done' }, T + 5);
    scheduler.tick(T + 5);
    scheduler.handleTaskUpdate(relecteur, relecture);
    const deleguer = (childTaskId: string, at: number): void => {
      const creation = store.createDelegatedTask(
        {
          childTaskId,
          parentTaskId: relecture,
          title: `Sous-tâche ${childTaskId}`,
          prompt: 'Vérifie ce cas limite et rapporte les preuves.',
          durationMs: 60_000,
          costMicros: 100_000,
          resourceUnits: 1,
        },
        undefined,
        at,
      );
      expect(creation.ok, childTaskId).toBe(true);
      scheduler.tick(at);
    };
    deleguer('enfant', T + 6);
    // Codex tient la relecture : l'enfant part chez Claude, seul libre…
    expect(store.getTask('enfant')?.assignedNodeId).toBe(producteur);
    deleguer('enfant-en-file', T + 7);
    // … et le second attend en file, faute de place.
    expect(store.getTask('enfant-en-file')?.status).toBe('ready');

    scheduler.nodeDisconnected(relecteur, 'ws_close', T + 10);
    const borne = T + 10 + ATTENTE_RELECTEUR_ABSENT_MS;
    scheduler.heartbeat(producteur, borne);
    scheduler.tick(borne);

    expect(store.getTask(relecture)?.status).toBe('failed');
    for (const id of ['enfant', 'enfant-en-file']) {
      expect(store.getTask(id), id).toMatchObject({ status: 'failed', assignedNodeId: null });
    }
    expect(annulations).toEqual([
      { nodeId: producteur, taskId: 'enfant', reason: 'ancestor_failed' },
    ]);
    expect(
      evenements('delegation_cancelled').map((e) => [e.childTaskId, e.ancestorTaskId, e.reason]),
    ).toEqual([
      ['enfant', relecture, 'ancestor_failed'],
      ['enfant-en-file', relecture, 'ancestor_failed'],
    ]);
    expect(
      evenements('task_assigned').filter((e) => e.taskId === 'enfant-en-file'),
      'un descendant annulé a été réassigné par la passe qui l’annulait',
    ).toEqual([]);
  });

  // La garde de famille (`n.agentType === lien.relecteurAgent`) masque l'autre :
  // un lien sain désigne par construction une famille indépendante. Celle-ci
  // (`relecteurIndependant`) doit tenir SEULE pour un lien qui ne le serait pas
  // — ligne ancienne, ou inscrite par un autre chemin que `choisirCritiques`.
  for (const relecteurAgent of ['claude-code', ...AGENTS_SANS_AVIS]) {
    it(`UN LIEN NON INDÉPENDANT (${relecteurAgent}) NE PART PAS, même vers un nœud de sa famille en ligne`, () => {
      const { relecture, production, occupation } = scene();
      store.patchTask(occupation, { status: 'done' }, T + 5);
      const famille = scheduler.registerNode(
        { name: 'mmm-famille', ownerName: 'banc', agentType: relecteurAgent, maxConcurrency: 1 },
        T + 5,
      ).id;
      store.inscrireRelecture({
        relectureTaskId: relecture,
        productionTaskId: production,
        relecteurNodeId: famille,
        relecteurAgent,
        producteurAgent: 'claude-code',
        now: T + 5,
      });

      scheduler.tick(T + 20);

      const tache = store.getTask(relecture);
      expect(tache?.status).toBe('ready');
      expect(tache?.assignedNodeId ?? null, 'un avis non indépendant a été commandé').toBeNull();
      // Sa famille est en ligne : ce n'est pas une absence à annoncer.
      expect(evenements('contre_expertise_review_waiting')).toEqual([]);
    });
  }

  it('UN AUTRE NŒUD DE LA MÊME FAMILLE la prend — c’est la famille qui relit, pas le poste', () => {
    const { producteur, relecteur, relecture } = scene();
    const autreCodex = scheduler.registerNode(
      { name: 'mmm-codex', ownerName: 'banc', agentType: 'codex', maxConcurrency: 1 },
      T + 5,
    ).id;
    scheduler.nodeDisconnected(relecteur, 'ws_close', T + 10);

    scheduler.tick(T + 20);

    const assigne = store.getTask(relecture)?.assignedNodeId;
    expect(assigne).toBe(autreCodex);
    expect(assigne).not.toBe(producteur);
    expect(evenements('contre_expertise_review_waiting')).toEqual([]);
  });

  it('LE NŒUD DÉSIGNÉ A CHANGÉ DE FAMILLE : il ne la prend pas', () => {
    // Même dossier, même identité — mais relancé avec Claude Code : la lui
    // confier, ce serait Claude relisant Claude sous l'identité désignée.
    const { relecteur, relecture, occupation } = scene();
    store.patchTask(occupation, { status: 'done' }, T + 5);
    scheduler.registerNode(
      {
        nodeId: relecteur,
        name: 'zzz-codex',
        ownerName: 'banc',
        agentType: 'claude-code',
        maxConcurrency: 1,
      },
      T + 10,
    );

    scheduler.tick(T + 20);

    expect(store.getTask(relecture)?.assignedNodeId ?? null).toBeNull();
    expect(evenements('contre_expertise_review_waiting')).toHaveLength(1);
  });

  it('UNE RELECTURE SORTIE DE LA FILE OUBLIE SON ATTENTE — elle ne revient pas déjà condamnée', () => {
    // Le relecteur revient en DÉCLARANT la relecture qu'il exécutait :
    // `reconcileNode` la ré-adopte avant toute passe, sans que la file la voie
    // servie. Une attente gardée de la première absence la ferait échouer sur
    // l'instant à la seconde.
    const { relecteur, relecture, occupation } = scene();
    store.patchTask(occupation, { status: 'done' }, T + 5);
    scheduler.tick(T + 5);
    scheduler.nodeDisconnected(relecteur, 'ws_close', T + 10);
    scheduler.tick(T + 10);
    expect(evenements('contre_expertise_review_waiting')).toHaveLength(1);

    scheduler.registerNode(
      {
        nodeId: relecteur,
        name: 'zzz-codex',
        ownerName: 'banc',
        agentType: 'codex',
        maxConcurrency: 1,
      },
      T + 20,
    );
    scheduler.reconcileNode(relecteur, [relecture], T + 20);
    scheduler.tick(T + 20);
    expect(store.getTask(relecture)?.status).toBe('running');

    // Bien après la borne, il retombe : l'attente REPART, elle ne tranche pas.
    const plusTard = T + 2 * ATTENTE_RELECTEUR_ABSENT_MS;
    scheduler.nodeDisconnected(relecteur, 'ws_close', plusTard);
    scheduler.tick(plusTard);
    expect(store.getTask(relecture)?.status).toBe('ready');
    expect(evenements('contre_expertise_review_waiting')).toHaveLength(2);
    expect(evenements('contre_expertise_review_failed')).toEqual([]);
  });

  it('LES RELECTURES PASSENT AVANT LES PRODUCTIONS PLUS ANCIENNES', () => {
    // Une relecture achève un travail déjà payé. En file par date, elle
    // passait derrière toute production prête plus ancienne — la mission
    // entière avant sa première contre-revue.
    const { producteur, relecteur, relecture, occupation, projet } = scene();
    const ancienne = store.createTask(
      { projectId: projet, title: 'Écris la doc', prompt: 'doc' },
      T - 1_000,
    );
    store.patchTask(ancienne.id, { status: 'ready' }, T - 1_000);
    // Le producteur est pris : seul Codex, qui se libère, peut servir quelqu'un.
    const tenue = store.createTask({ projectId: projet, title: 'Travail de Claude', prompt: 'y' });
    store.patchTask(tenue.id, { status: 'running', assignedNodeId: producteur }, T);
    store.patchTask(occupation, { status: 'done' }, T + 20);

    scheduler.tick(T + 20);

    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);
    expect(store.getTask(ancienne.id)?.status).toBe('ready');
  });

  it('UNE RELECTURE N’ÉDITE RIEN — le Sting Detector ne la retient pas, et elle ne retient personne', () => {
    // Sa consigne CITE les fichiers du diff qu'elle juge. Comptée comme une
    // édition, elle sérialisait les relectrices d'une même production — leurs
    // consignes citent les mêmes fichiers — et retenait toute production du
    // projet qui les cite aussi, le temps d'une relecture qui ne touche à rien.
    const { producteur, relecteur, relecture, occupation, production, projet } = scene();
    const cursor = scheduler.registerNode(
      { name: 'mmm-cursor', ownerName: 'banc', agentType: 'cursor', maxConcurrency: 1 },
      T,
    ).id;
    const seconde = store.createTask({
      projectId: projet,
      title: 'Contre-expertise — Ajoute un endpoint',
      prompt: CONSIGNE,
    });
    store.inscrireRelecture({
      relectureTaskId: seconde.id,
      productionTaskId: production,
      relecteurNodeId: cursor,
      relecteurAgent: 'cursor',
      producteurAgent: 'claude-code',
      now: T,
    });
    const voisine = store.createTask({
      projectId: projet,
      title: 'Durcis src/auth.ts',
      prompt: 'ajoute une garde dans src/auth.ts',
    });
    store.patchTask(occupation, { status: 'done' }, T + 20);

    scheduler.tick(T + 20);

    // Les deux relectrices partent ensemble, chacune à SA famille…
    expect(store.getTask(relecture)?.assignedNodeId).toBe(relecteur);
    expect(store.getTask(seconde.id)?.assignedNodeId).toBe(cursor);
    // … et la production qui cite le même fichier n'attend pas une relecture.
    expect(store.getTask(voisine.id)?.assignedNodeId).toBe(producteur);
    expect(evenements('task_conflict_deferred')).toEqual([]);
  });

  // Le fait `contre_expertise_review_failed` (`terminal`) est le déclencheur
  // UNIQUE de la suite d'une relecture close sans avis (secours, ou revue
  // humaine nommée — tests/relecture-issue-terminale.test.ts). Un chemin
  // terminal qui l'omettait laissait la production en suspens sans un mot.
  it('L’AGENT RELECTEUR NE DÉMARRE NULLE PART : la relecture close le DIT, comme toute clôture sans avis', () => {
    const { producteur, relecteur, relecture, occupation, production } = scene();
    store.patchTask(occupation, { status: 'done' }, T + 5);
    // Deux nœuds en ligne : la borne des refus d'infrastructure est max(3, 2×3).
    for (let i = 0; i < 6; i += 1) {
      const t = T + 10 + i * 10_000;
      // Vivant, sans quoi le tick le faucherait (`NODE_TIMEOUT_MS`).
      scheduler.heartbeat(relecteur, t);
      scheduler.heartbeat(producteur, t);
      scheduler.tick(t);
      expect(store.getTask(relecture)?.assignedNodeId, `refus n°${i + 1}`).toBe(relecteur);
      scheduler.rejectTask(relecteur, relecture, 'agent_absent', true, t + 1);
    }

    expect(store.getTask(relecture)?.status).toBe('failed');
    expect(evenements('contre_expertise_review_failed')).toEqual([
      {
        taskId: production,
        relecture,
        relecteur: 'codex',
        terminal: true,
        attempt: 0,
        motif: 'aucun_agent_fonctionnel',
      },
    ]);
  });

  it('UN HUMAIN ANNULE LA RELECTURE : la clôture sans avis est dite, motif `annulee`', () => {
    const { relecture, production } = scene();

    scheduler.cancelTask(relecture, 'annulée par un humain', T + 10);

    expect(evenements('contre_expertise_review_failed')).toEqual([
      {
        taskId: production,
        relecture,
        relecteur: 'codex',
        terminal: true,
        attempt: 0,
        motif: 'annulee',
      },
    ]);
  });

  it('UNE TÂCHE ORDINAIRE ANNULÉE N’EST PAS UNE RELECTURE : aucun fait de relecture', () => {
    const { projet } = scene();
    const ordinaire = store.createTask({ projectId: projet, title: 'Écris la doc', prompt: 'doc' });

    scheduler.cancelTask(ordinaire.id, 'annulée par un humain', T + 10);

    expect(evenements('contre_expertise_review_failed')).toEqual([]);
  });

  it('PAS DE COURSE SUR UNE RELECTURE — la course enrôlerait le producteur', () => {
    const { relecteur, relecture } = scene();
    scheduler.nodeDisconnected(relecteur, 'ws_close', T + 10);
    // Prête, et visiblement en attente : exactement celle qu'on serait tenté
    // de courir à la main.
    expect(store.getTask(relecture)?.status).toBe('ready');

    const course = scheduler.startRace(relecture, 2, T + 20);

    expect(course.ok).toBe(false);
    expect(course.ok === false && course.error).toContain('contre-expertise');
    expect(store.getTask(relecture)?.assignedNodeId ?? null).toBeNull();
  });

  it('UNE TÂCHE ORDINAIRE, ELLE, VA TOUJOURS AU PREMIER NŒUD LIBRE', () => {
    // La garde ne vise QUE les relectures : une production n'a pas de famille
    // désignée, et la bloquer en attente serait une ruche qui ralentit pour rien.
    const { producteur } = scene();
    const p = store.createProject({ name: 'Q' });
    const ordinaire = store.createTask({ projectId: p.id, title: 'Écris la doc', prompt: 'doc' });

    scheduler.tick(T + 20);

    expect(store.getTask(ordinaire.id)?.assignedNodeId).toBe(producteur);
  });
});
