// Le banc d'ombre sur une VRAIE Reine, avec de vrais nœuds en WebSocket.
//
// ─── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
//
// La politique pure (tests/shadow-bench.test.ts) ne dit rien de ce qui compte
// vraiment ici, et qui vit ENTRE le planificateur, le hub et le store :
//
//   · le banc est ÉTEINT tant qu'un humain ne l'a pas réglé — il coûte de
//     vrais appels de modèle ;
//   · allumé, l'ombre part au SECOND modèle, et à lui seul ;
//   · elle n'est JAMAIS livrée : ni par la route, ni par la réservation
//     atomique, ni par la liste du travail du projet que lisent le merge et
//     la livraison autonome ;
//   · elle passe par le même jugement que toute production — validations,
//     contre-revue, Evaluator — mais n'a qu'UN essai : une contre-revue qui
//     la conteste ne la relance pas, et le refus se journalise ;
//   · elle n'entre dans AUCUN poids du routing (récompense, élections en vol)
//     ni dans la mémoire de la ruche ;
//   · sa comparaison arrive au registre Genome, de provenance `shadow` ;
//   · le budget l'arrête, et l'état courant le dit.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { RegistreGenome } from '../src/shared/registre-genome.js';

const TOKEN = 'jeton-banc-ombre-suffisamment-long';
const JETON = { 'x-hive-token': TOKEN };
const DIFF =
  'diff --git a/src/somme.ts b/src/somme.ts\n--- /dev/null\n+++ b/src/somme.ts\n' +
  '@@ -0,0 +1 @@\n+export const somme = (a: number, b: number) => a + b;\n';
const BASE = 'a'.repeat(40);

interface Assignation {
  task: { id: string; title: string };
  modele?: string;
}

interface Noeud {
  recues: Assignation[];
  /** Les codes des délégations que la Reine a refusées à ce nœud. */
  delegationsRefusees: string[];
  envoyer: (message: Record<string, unknown>) => void;
}

/** Les validations du bac d'une production : les tests disent `tests`, le reste n'est pas déclaré. */
const validations = (tests: 'passed' | 'failed') => ({
  baseSha: BASE,
  controles: {
    tests: { etat: tests, raison: 'termine', script: 'test', code: tests === 'passed' ? 0 : 1 },
    typecheck: { etat: 'not_applicable', raison: 'non_declare' },
    build: { etat: 'not_applicable', raison: 'non_declare' },
    lint: { etat: 'not_applicable', raison: 'non_declare' },
  },
});

describe('le banc d’ombre sur une vraie Reine', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function attendre(condition: () => boolean, message: string, ms = 10_000): Promise<void> {
    const fin = Date.now() + ms;
    while (!condition() && Date.now() < fin) await new Promise((r) => setTimeout(r, 25));
    expect(condition(), message).toBe(true);
  }

  async function ruche(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-banc-ombre-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 40,
    });
    return server;
  }

  /**
   * Un nœud réel : il déclare son agent, ses modèles et son bac (`conteneur`
   * par défaut — le seul où une ombre peut partir), et note chaque
   * assignation reçue.
   */
  async function noeud(
    srv: HiveServer,
    nodeId: string,
    agentType: string,
    modeles: string[],
    niveau: 'conteneur' | 'processus' = 'conteneur',
  ): Promise<Noeud> {
    const recues: Assignation[] = [];
    const delegationsRefusees: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as {
        type: string;
        code?: string;
      } & Partial<Assignation>;
      if (m.type === 'assign_task' && m.task) {
        recues.push({ task: m.task, ...(m.modele ? { modele: m.modele } : {}) });
      }
      if (m.type === 'delegation_rejected') delegationsRefusees.push(m.code ?? '?');
    });
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: nodeId,
        ownerName: 'banc',
        agentType,
        modeles,
        maxConcurrency: 2,
        nodeId,
        isolement: { niveau, ...(niveau === 'conteneur' ? { fournisseur: 'bubblewrap' } : {}) },
      }),
    );
    await attendre(() => srv.store.getNode(nodeId)?.status === 'online', 'nœud non inscrit');
    return {
      recues,
      delegationsRefusees,
      envoyer: (message) => ws.send(JSON.stringify(message)),
    };
  }

  /** L'assignation d'une tâche, attendue chez l'un des nœuds — rend le nœud qui l'a reçue. */
  async function recuePar(
    noeuds: Noeud[],
    taskId: string,
  ): Promise<{ noeud: Noeud; assignation: Assignation }> {
    let trouve: { noeud: Noeud; assignation: Assignation } | undefined;
    await attendre(() => {
      for (const n of noeuds) {
        const a = n.recues.find((r) => r.task.id === taskId);
        if (a) trouve = { noeud: n, assignation: a };
      }
      return trouve !== undefined;
    }, `personne n’a reçu ${taskId}`);
    return trouve!;
  }

  const produire = (
    n: Noeud,
    taskId: string,
    tests: 'passed' | 'failed',
    extra: Record<string, unknown> = {},
  ): void =>
    n.envoyer({
      type: 'task_result',
      taskId,
      success: true,
      diff: DIFF,
      logs: 'ok',
      finalText: 'fait',
      durationMs: 5,
      subAgents: [],
      validations: validations(tests),
      ...extra,
    });

  /** Rend l'avis d'une relecture : son texte est sa réponse finale. */
  const relire = (n: Noeud, relectureId: string, avis: string): void =>
    n.envoyer({
      type: 'task_result',
      taskId: relectureId,
      success: true,
      diff: '',
      logs: avis,
      finalText: avis,
      durationMs: 5,
      subAgents: [],
    });

  const regler = (srv: HiveServer, projectId: string, corps: Record<string, unknown>) =>
    fetch(`http://127.0.0.1:${srv.port}/api/projects/${projectId}/banc-ombre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...JETON },
      body: JSON.stringify(corps),
    });

  const tache = (srv: HiveServer, projectId: string, title: string): string => {
    const t = srv.store.createTask({
      projectId,
      title,
      prompt: 'écris somme(a, b) dans src/somme.ts',
    });
    srv.store.patchTask(t.id, { status: 'ready' });
    return t.id;
  };

  it('ÉTEINT PAR DÉFAUT : une production testable n’ouvre aucune ombre, et le banc se tait', async () => {
    const srv = await ruche();
    const codex = await noeud(srv, 'n-codex', 'codex', ['codex-banc']);
    const claude = await noeud(srv, 'n-claude', 'claude-code', ['opus-banc']);
    const projet = srv.store.createProject({ name: 'Sans banc' });
    const t = tache(srv, projet.id, 'Ajouter une fonction somme');
    const { noeud: producteur } = await recuePar([codex, claude], t);
    produire(producteur, t, 'passed');
    await attendre(() => srv.store.getTask(t)?.status === 'done', 'la production ne se range pas');

    // La décision est prise dans le même geste que le rangement du résultat.
    expect(srv.store.ombreDeOriginale(t)).toBeNull();
    expect(
      srv.store.evenementsParTypes(['shadow_bench_started', 'shadow_bench_skipped'], 100),
    ).toEqual([]);
    const etat = (await (
      await fetch(`http://127.0.0.1:${srv.port}/api/projects/${projet.id}/banc-ombre`, {
        headers: JETON,
      })
    ).json()) as { actif: boolean; reglage: unknown };
    expect(etat).toMatchObject({ actif: false, reglage: null });
  });

  it('ALLUMÉ : l’ombre part au second modèle, n’est jamais livrée, n’apprend rien au routing, et sa comparaison entre au Genome — puis le budget l’arrête', async () => {
    const srv = await ruche();
    const codex = await noeud(srv, 'n-codex', 'codex', ['codex-banc']);
    const claude = await noeud(srv, 'n-claude', 'claude-code', ['opus-banc']);
    const projet = srv.store.createProject({ name: 'Banc' });
    const pose = await regler(srv, projet.id, {
      actif: true,
      tauxPourMille: 1000,
      executionsParJour: 1,
      plafondCoutUsd: 1,
    });
    expect(pose.status).toBe(200);

    // ─── L'originale : élue sur un modèle, produite, testée verte ────────────
    const t1 = tache(srv, projet.id, 'Ajouter une fonction somme');
    const { noeud: producteur, assignation } = await recuePar([codex, claude], t1);
    const modeleOriginal = assignation.modele;
    expect(modeleOriginal, 'l’Aiguillage commande un modèle à l’originale').toBeTypeOf('string');
    produire(producteur, t1, 'passed');
    await attendre(() => srv.store.ombreDeOriginale(t1) !== null, 'aucune ombre ouverte');
    const lien = srv.store.ombreDeOriginale(t1)!;
    const s = lien.tacheOmbre;
    const modeleOmbre = modeleOriginal === 'codex-banc' ? 'opus-banc' : 'codex-banc';
    expect(lien).toMatchObject({ modeleOriginal, modeleOmbre });

    // ─── L'ombre part au SECOND modèle, chez le seul nœud qui l'offre ───────
    const { noeud: porteur, assignation: aOmbre } = await recuePar([codex, claude], s);
    expect(aOmbre.modele).toBe(modeleOmbre);
    // Chez le nœud qui DÉCLARE ce modèle — lancée ailleurs, elle tournerait sur
    // le défaut d'un autre agent et mesurerait un autre modèle.
    expect(porteur).toBe(modeleOmbre === 'opus-banc' ? claude : codex);
    const porteurId = porteur === claude ? 'n-claude' : 'n-codex';
    expect(aOmbre.task.title.startsWith('Ombre — ')).toBe(true);
    expect(srv.store.getTask(s)?.prompt).toBe(srv.store.getTask(t1)?.prompt);

    // ─── Jamais livrée, jamais comptée comme travail du projet ───────────────
    expect(srv.store.listTasks(projet.id).map((x) => x.id)).not.toContain(s);
    const livrer = await fetch(`http://127.0.0.1:${srv.port}/api/livraison`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...JETON },
      body: JSON.stringify({ taskId: s }),
    });
    expect(livrer.status).toBe(409);
    expect(((await livrer.json()) as { code: string }).code).toBe('tache_ombre');
    expect(
      srv.store.reserverLivraison({
        taskId: s,
        projectId: projet.id,
        depot: 'o/r',
        branche: `hive/${s}`,
      }),
      'la réservation atomique refuse une ombre',
    ).toBe(false);
    expect(srv.store.getLivraison(s)).toBeNull();

    // ─── Aucun poids du routing ne la voit en vol ───────────────────────────
    expect(srv.store.modeleAiguillageDe(s)).toBeNull();
    expect(srv.store.electionsEnVolAiguillage().some((e) => e.title.startsWith('Ombre — '))).toBe(
      false,
    );

    // Elle ne délègue pas : un enfant ferait travailler d'autres modèles sous
    // son nom, et la comparaison ne mesurerait plus UNE production.
    porteur.envoyer({
      type: 'delegate_task',
      requestId: 'req-ombre',
      childTaskId: 'enfant-de-l-ombre',
      parentTaskId: s,
      reason: 'découper',
      title: 'Sous-tâche',
      prompt: 'fais une partie',
      durationMs: 1_000,
      costMicros: 0,
      resourceUnits: 1,
    });
    await attendre(
      () => porteur.delegationsRefusees.includes('parent_ombre'),
      'la délégation d’une ombre n’est pas refusée',
    );
    expect(srv.store.getTask('enfant-de-l-ombre')).toBeUndefined();

    // L'originale est relue par l'autre famille, favorablement.
    const relectureOriginale = srv.store.relecturesDeProduction(t1)[0]!;
    const { noeud: relecteurO } = await recuePar([codex, claude], relectureOriginale);
    relire(relecteurO, relectureOriginale, 'valide');

    // ─── L'ombre rend : tests ROUGES, un coût déclaré ────────────────────────
    produire(porteur, s, 'failed', {
      fournisseur: { source: 'banc', coutUsd: 0.02 },
    });
    await attendre(() => srv.store.relecturesDeProduction(s).length > 0, 'l’ombre n’est pas relue');
    const relectureOmbre = srv.store.relecturesDeProduction(s)[0]!;
    // Rendue mais encore RELUE, l'ombre n'a pas fini de dépenser : elle tient
    // sa place en vol, et la suivante attendrait le coût de sa relecture.
    expect(srv.store.getTask(s)?.status).toBe('done');
    expect(srv.store.usageBancOmbre(projet.id, 0).enVol).toBe(1);

    // Là où elle a TOURNÉ, elle se voit : la Chambre de son ouvrière la liste,
    // et l'instantané de l'écran la marque — pour la tenir hors de la file de
    // revue, pas pour la cacher.
    const chambre = (await (
      await fetch(`http://127.0.0.1:${srv.port}/api/chambre/${porteurId}`, { headers: JETON })
    ).json()) as { tasks: { id: string }[] };
    expect(chambre.tasks.map((x) => x.id)).toContain(s);
    const ecran = srv.store.tachesPourEcran(100);
    expect(ecran.find((x) => x.id === s)?.ombre).toBe(true);
    expect(ecran.find((x) => x.id === t1)).not.toHaveProperty('ombre');
    const { noeud: relecteurS } = await recuePar([codex, claude], relectureOmbre);
    relire(relecteurS, relectureOmbre, 'conteste\n- la somme ignore les nombres négatifs');

    // Contestée, elle n'est PAS relancée : un essai, jugé tel quel — et le
    // refus se lit au journal.
    await attendre(
      () =>
        srv.store
          .evenementsDeTache(s, ['evaluator_retry_skipped'])
          .some((e) => e.payload.reason === 'shadow_task'),
      'le refus de corriger l’ombre n’est pas journalisé',
    );
    expect(srv.store.getTask(s)).toMatchObject({ status: 'done', attempts: 0 });
    const retry = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${s}/evaluation/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...JETON },
      body: JSON.stringify({ resultId: srv.store.resultsForTask(s)[0]!.resultId }),
    });
    expect(retry.status).toBe(409);
    expect(((await retry.json()) as { code: string }).code).toBe('shadow_task');

    // ─── Rien dans la récompense de l'Aiguillage, rien dans la mémoire ──────
    expect(
      srv.store.observationsAiguillage().some((o) => o.title.startsWith('Ombre — ')),
      'le verdict de l’ombre a nourri la récompense de l’Aiguillage',
    ).toBe(false);
    expect(srv.store.listMemories().some((m) => m.taskId === s)).toBe(false);

    // ─── Le Genome : un fait de provenance « shadow », avec sa confiance ─────
    const genome = (await (
      await fetch(`http://127.0.0.1:${srv.port}/api/genome`, { headers: JETON })
    ).json()) as RegistreGenome;
    expect(genome.ombre.comparaisons[0]).toMatchObject({
      provenance: 'shadow',
      tacheOmbre: s,
      tacheOriginale: t1,
      etat: 'comparee',
      verdict: 'originale_meilleure',
      // L'ombre est CONTESTÉE : le verdict reste celui des tests, la
      // confiance tombe — ses tests ne prouvent plus qu'elle a fait la tâche.
      confiance: 'faible',
      original: { modele: modeleOriginal, issue: 'tests_verts', revue: 'validee' },
      ombre: { modele: modeleOmbre, issue: 'tests_rouges', revue: 'contestee' },
    });
    expect(genome.ombre.lignes.find((l) => l.modele === modeleOmbre)).toMatchObject({
      provenance: 'shadow',
      commeOmbre: 1,
      defaites: 1,
    });

    // La comparaison est RANGÉE, pas relue du journal : un journal élagué à
    // zéro la rend intacte — le banc a payé pour elle. Depuis la rétention à
    // un propriétaire (#497), les preuves d'une tâche vivante survivent à la
    // fenêtre : seul un plafond nul vide VRAIMENT le journal.
    srv.store.pruneEvents({ fenetre: 0, preuvesClosesMs: 0, plafond: 0 });
    const apresElagage = (await (
      await fetch(`http://127.0.0.1:${srv.port}/api/genome`, { headers: JETON })
    ).json()) as RegistreGenome;
    expect(apresElagage.ombre.comparaisons[0]).toEqual(genome.ombre.comparaisons[0]);
    expect(apresElagage.ombre.lignes).toEqual(genome.ombre.lignes);

    // ─── Le budget : une ombre par 24 h — la suivante est refusée, dite ──────
    const t2 = tache(srv, projet.id, 'Ajouter une fonction produit');
    const { noeud: producteur2 } = await recuePar([codex, claude], t2);
    produire(producteur2, t2, 'passed');
    await attendre(
      () =>
        srv.store
          .evenementsDeTache(t2, ['shadow_bench_skipped'])
          .some((e) => e.payload.motif === 'budget_executions'),
      'le budget n’a pas arrêté le banc',
    );
    expect(srv.store.ombreDeOriginale(t2)).toBeNull();

    const etat = (await (
      await fetch(`http://127.0.0.1:${srv.port}/api/projects/${projet.id}/banc-ombre`, {
        headers: JETON,
      })
    ).json()) as {
      actif: boolean;
      budget: {
        executions: number;
        coutDeclareUsd: number;
        executionsMuettes: number;
        arret: string;
      };
    };
    // Le coût de l'ombre est déclaré ; sa relecture n'a rien dit du sien :
    // elle est comptée MUETTE, jamais gratuite.
    expect(etat).toMatchObject({
      actif: true,
      budget: {
        executions: 1,
        coutDeclareUsd: 0.02,
        executionsMuettes: 1,
        arret: 'budget_executions',
      },
    });
  });
  it('le banc décide sur la PREMIÈRE production seulement — une reprise ne rouvre rien', async () => {
    const srv = await ruche();
    const codex = await noeud(srv, 'n-codex', 'codex', ['codex-banc']);
    const claude = await noeud(srv, 'n-claude', 'claude-code', ['opus-banc']);
    const projet = srv.store.createProject({ name: 'Reprise' });
    await regler(srv, projet.id, {
      actif: true,
      tauxPourMille: 1000,
      executionsParJour: 5,
      plafondCoutUsd: 1,
    });
    const t = tache(srv, projet.id, 'Ajouter une fonction somme');
    // Premier essai en échec : sans verdict de tests, le banc l'écarte — et
    // le dit, UNE fois.
    const { noeud: premier } = await recuePar([codex, claude], t);
    premier.envoyer({
      type: 'task_result',
      taskId: t,
      success: false,
      diff: '',
      logs: 'Error: plantage du premier essai',
      finalText: 'échec',
      durationMs: 5,
      subAgents: [],
    });
    await attendre(
      () => srv.store.evenementsDeTache(t, ['shadow_bench_skipped']).length === 1,
      'le premier essai n’a pas été jugé',
    );
    // La reprise, verte et testée : elle a lu la critique du premier essai,
    // l'ombre partirait sans — ce ne serait plus la même tâche.
    await attendre(
      () => [codex, claude].some((n) => n.recues.filter((r) => r.task.id === t).length === 2),
      'la tâche n’est pas reprise',
    );
    const second = [codex, claude].find(
      (n) => n.recues.filter((r) => r.task.id === t).length === 2,
    )!;
    produire(second, t, 'passed');
    await attendre(() => srv.store.getTask(t)?.status === 'done', 'la reprise ne se range pas');
    expect(srv.store.ombreDeOriginale(t)).toBeNull();
    expect(
      srv.store.evenementsDeTache(t, ['shadow_bench_skipped', 'shadow_bench_started']),
      'la reprise a été soumise au banc une seconde fois',
    ).toHaveLength(1);
  });

  it('l’échec d’une OMBRE n’entre pas au Cerveau, et se range comme un côté en échec', async () => {
    const srv = await ruche();
    const codex = await noeud(srv, 'n-codex', 'codex', ['codex-banc']);
    const claude = await noeud(srv, 'n-claude', 'claude-code', ['opus-banc']);
    const projet = srv.store.createProject({ name: 'Cerveau' });
    await regler(srv, projet.id, {
      actif: true,
      tauxPourMille: 1000,
      executionsParJour: 5,
      plafondCoutUsd: 1,
    });
    const t = tache(srv, projet.id, 'Ajouter une fonction somme');
    const { noeud: producteur } = await recuePar([codex, claude], t);
    produire(producteur, t, 'passed');
    await attendre(() => srv.store.ombreDeOriginale(t) !== null, 'aucune ombre ouverte');
    const s = srv.store.ombreDeOriginale(t)!.tacheOmbre;
    const { noeud: porteur } = await recuePar([codex, claude], s);
    porteur.envoyer({
      type: 'task_result',
      taskId: s,
      success: false,
      diff: '',
      // Un log EXPLOITABLE : sur une production ordinaire, il écrirait un
      // épisode (tests/cerveau-wiring.test.ts).
      logs: 'Error: PANNE_OMBRE_SIGNATURE_UNIQUE lors de la compilation',
      finalText: 'échec',
      durationMs: 5,
      subAgents: [],
    });
    await attendre(() => srv.store.getTask(s)?.status === 'failed', 'l’ombre ne se clôt pas');
    expect(
      srv.store.listEvents(0, 1_000).filter((e) => e.type === 'cerveau_episode'),
      'la panne d’une ombre a été servie en leçon au projet',
    ).toEqual([]);
    expect(srv.store.ombreDe(s)?.ombre).toMatchObject({ succes: false, tests: null });
  });

  it('ÉTEINDRE ne demande rien d’autre : le budget rangé reste, et allumer l’exige', async () => {
    const srv = await ruche();
    const projet = srv.store.createProject({ name: 'Interrupteur' });
    // Éteindre un banc jamais réglé : rien à ranger, rien d'inventé.
    const vierge = await regler(srv, projet.id, { actif: false });
    expect(vierge.status).toBe(200);
    expect(await vierge.json()).toMatchObject({ actif: false, reglage: null });
    // Allumer sans budget : refusé, nommément.
    const sansBudget = await regler(srv, projet.id, { actif: true });
    expect(sansBudget.status).toBe(400);
    expect(((await sansBudget.json()) as { code: string }).code).toBe('budget_exige');

    await regler(srv, projet.id, {
      actif: true,
      tauxPourMille: 200,
      executionsParJour: 4,
      plafondCoutUsd: 2,
    });
    const eteint = await regler(srv, projet.id, { actif: false });
    expect(eteint.status).toBe(200);
    expect(await eteint.json()).toMatchObject({
      actif: false,
      reglage: { tauxPourMille: 200, executionsParJour: 4, plafondCoutUsd: 2 },
    });
    expect(srv.store.getBancOmbre(projet.id)?.actif).toBe(false);
  });

  it('SANS bac isolé, aucune ombre ne part — et le motif le dit', async () => {
    const srv = await ruche();
    const codex = await noeud(srv, 'n-codex', 'codex', ['codex-banc'], 'processus');
    const claude = await noeud(srv, 'n-claude', 'claude-code', ['opus-banc'], 'processus');
    const projet = srv.store.createProject({ name: 'Sans bac' });
    await regler(srv, projet.id, {
      actif: true,
      tauxPourMille: 1000,
      executionsParJour: 5,
      plafondCoutUsd: 1,
    });
    const t = tache(srv, projet.id, 'Ajouter une fonction somme');
    const { noeud: producteur } = await recuePar([codex, claude], t);
    produire(producteur, t, 'passed');
    await attendre(
      () =>
        srv.store
          .evenementsDeTache(t, ['shadow_bench_skipped'])
          .some((e) => e.payload.motif === 'aucun_bac_isole'),
      'le banc n’a pas dit pourquoi il n’admet rien',
    );
    expect(srv.store.ombreDeOriginale(t)).toBeNull();
  });
});
