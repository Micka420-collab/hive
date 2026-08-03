// LOT 17 — LA TABLE `tasks` A ENFIN SA BORNE, ET L'INSTANTANÉ SA FENÊTRE.
//
// ─── LES DEUX DÉFAUTS QUI ONT MOTIVÉ CE FICHIER ──────────────────────────────
//
// 1. `getSnapshot()` chargeait la table ENTIÈRE, et `broadcastState()` la
//    rediffuse à chaque changement d'état. Mesuré sur ce dépôt :
//
//        tâches | getSnapshot | JSON.stringify | octets
//        -------|-------------|----------------|--------
//           500 |     3,9 ms  |      2,3 ms    | 0,23 Mo
//         2 000 |    14,2 ms  |      8,9 ms    | 0,91 Mo
//         5 000 |    39,4 ms  |     21,5 ms    | 2,28 Mo
//        20 000 |   182,1 ms  |     94,6 ms    | 9,13 Mo
//
//    À 20 000 tâches, un seul changement d'état bloque la boucle 277 ms et
//    pousse 9,1 Mo à chaque tableau de bord. L'orchestrateur est mono-thread :
//    pendant ce temps, il ne répond à personne.
//
// 2. `tasks` était la SEULE table du dépôt sans élagueur — et deux bornes
//    référentielles justifiaient leur conception par un élagage qui n'existait
//    pas. Elles supprimaient 0 ligne, pour toujours.
//
// ─── CE QUE CE FICHIER SURVEILLE EN PRIORITÉ ─────────────────────────────────
//
// Pas « la borne existe » : **la borne SUPPRIME**, et **elle ne supprime pas ce
// qu'il ne faut pas**. Une borne qui rend 0 est le défaut d'origine ; une borne
// qui emporte une dépendance vivante est pire, parce qu'elle bloque une tâche
// sans rien dire.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import { LIMITE_TACHES_INSTANTANE } from '../src/shared/types.js';
import type { Task, TaskStatus } from '../src/shared/types.js';

const JOUR = 24 * 60 * 60 * 1000;

let dossier: string;
let store: HiveStore;
let projet: string;

beforeEach(() => {
  dossier = mkdtempSync(path.join(tmpdir(), 'taches-bornees-'));
  store = new HiveStore(path.join(dossier, 'ruche.db'));
  projet = store.createProject({ name: 'lot 17' }).id;
  horloge = 0;
});

afterEach(() => {
  // ─── FERMER LA BASE AVANT D'EFFACER SON DOSSIER ──────────────────────────
  //
  // Sans cette ligne, les 19 tests de ce fichier passaient ici et tombaient en
  // CI Windows : `EPERM, Permission denied` sur `rmSync`. Windows refuse de
  // supprimer un fichier dont un handle est encore ouvert ; Linux l'accepte, et
  // le laisse donc passer.
  //
  // Ce n'est pas une bizarrerie de plateforme à contourner par `maxRetries` :
  // c'est une base laissée ouverte par le test, et Windows a raison de le dire.
  // Toutes les autres suites du dépôt ferment leur store — celle-ci l'oubliait.
  store.close();
  rmSync(dossier, { recursive: true, force: true });
});

/**
 * Une horloge de création qui AVANCE à chaque tâche.
 *
 * ─── SANS ELLE, UN TEST DE CE FICHIER ÉTAIT CREUX ──────────────────────────
 *
 * `createTask` prend `now = Date.now()` par défaut. Six tâches posées dans une
 * boucle naissent donc à la MÊME milliseconde, et « la liste est triée par
 * createdAt » devient vrai quel que soit l'ordre — six valeurs identiques sont
 * triées dans tous les sens.
 *
 * La mutation qui retirait le tri final a survécu à ce test. C'est la mutation
 * qui l'a dit, pas la relecture.
 */
let horloge = 0;

/** Une tâche dans l'état et à l'âge voulus, née après toutes les précédentes. */
function poser(opts: {
  titre: string;
  statut: TaskStatus;
  ageJours: number;
  dependsOn?: string[];
}): Task {
  horloge += 1000;
  const t = store.createTask(
    {
      projectId: projet,
      title: opts.titre,
      prompt: 'peu importe',
      dependsOn: opts.dependsOn ?? [],
    },
    horloge,
  );
  // `updatedAt` porte l'âge : c'est LUI que la rétention regarde, pas la
  // création — une tâche créée il y a un an mais rejouée hier est récente.
  // `patchTask` prend le `now` en paramètre, ce qui évite de figer l'horloge.
  return store.patchTask(t.id, { status: opts.statut }, Date.now() - opts.ageJours * JOUR)!;
}

const idsDe = (taches: Task[]): string[] => taches.map((t) => t.id).sort();

describe('L’ÉLAGUEUR DES TÂCHES SUPPRIME VRAIMENT', () => {
  it('une tâche terminée et vieille part', () => {
    const vieille = poser({ titre: 'vieille', statut: 'done', ageJours: 40 });
    expect(store.pruneTasks(30 * JOUR), 'la borne n’a rien supprimé').toBe(1);
    expect(store.getTask(vieille.id), 'la tâche est encore là').toBeUndefined();
  });

  it('une tâche ÉCHOUÉE et vieille part aussi', () => {
    // `failed` est terminal au même titre que `done` : la garder pour toujours
    // ferait de la table un journal des échecs qui ne s'élague jamais.
    poser({ titre: 'échouée', statut: 'failed', ageJours: 40 });
    expect(store.pruneTasks(30 * JOUR)).toBe(1);
  });

  it.each([
    ['pending', 'pending' as TaskStatus],
    ['ready', 'ready' as TaskStatus],
    ['assigned', 'assigned' as TaskStatus],
    ['running', 'running' as TaskStatus],
  ])('une tâche %s NE PART PAS, même très vieille', (_, statut) => {
    // Une tâche bloquée depuis six mois est précisément celle qu'on cherche
    // quand quelque chose ne va pas. L'effacer supprimerait la panne de
    // l'écran, pas de la ruche.
    const t = poser({ titre: 'vivante', statut, ageJours: 400 });
    expect(store.pruneTasks(30 * JOUR)).toBe(0);
    expect(store.getTask(t.id)).toBeDefined();
  });

  it('LA BORNE TOMBE PILE : la tâche qui a EXACTEMENT l’âge de rétention reste', () => {
    // `updatedAt < seuil` mutée en `<=` : la tâche dont l'âge vaut EXACTEMENT
    // la rétention part un tour trop tôt. Les cas voisins vivent à 3 et à 40
    // jours pour une rétention de 30 — à des jours de la frontière, ils ne la
    // départagent pas (§ 2 quindecies, la même leçon que sur les accès).
    //
    // L'horloge est FIXÉE : `poser` date par soustraction sur `Date.now()`, et
    // un élagage qui rappellerait l'heure quelques millisecondes plus tard
    // ferait basculer le cas limite au hasard — c'est un intermittent qu'on
    // fabrique soi-même.
    const maintenant = Date.now();
    const pile = poser({ titre: 'pile à la borne', statut: 'done', ageJours: 30 });
    store.patchTask(pile.id, { status: 'done' }, maintenant - 30 * JOUR);
    expect(
      store.pruneTasks(30 * JOUR, maintenant),
      'à l’âge exact, la rétention n’est pas encore écoulée',
    ).toBe(0);
    expect(store.getTask(pile.id), 'elle est toujours là').toBeDefined();

    // …et une milliseconde plus tard, elle part : la borne ne s'inverse pas.
    expect(store.pruneTasks(30 * JOUR, maintenant + 1), 'un instant après, elle part').toBe(1);
    expect(store.getTask(pile.id)).toBeUndefined();
  });

  it('une tâche terminée mais RÉCENTE ne part pas', () => {
    const t = poser({ titre: 'récente', statut: 'done', ageJours: 3 });
    expect(store.pruneTasks(30 * JOUR)).toBe(0);
    expect(store.getTask(t.id)).toBeDefined();
  });

  it('LA CHAÎNE ENTIÈRE part — sinon la borne est un no-op de plus', () => {
    // ─── LE PIÈGE QUE CE TEST DÉSAMORCE ────────────────────────────────────
    //
    // Protéger « tout id cité par une tâche, quelle qu'elle soit » aurait l'air
    // prudent. Sur une chaîne A ← B ← C toutes terminées et vieilles, ça garde
    // A (cité par B) et B (cité par C) : la borne ne supprimerait que le
    // dernier maillon, à jamais. C'est-à-dire presque rien.
    //
    // On n'exclut donc que les ids cités par les tâches qui SURVIVENT.
    const a = poser({ titre: 'A', statut: 'done', ageJours: 40 });
    const b = poser({ titre: 'B', statut: 'done', ageJours: 40, dependsOn: [a.id] });
    poser({ titre: 'C', statut: 'done', ageJours: 40, dependsOn: [b.id] });
    expect(store.pruneTasks(30 * JOUR), 'la chaîne n’est pas partie en entier').toBe(3);
    expect(store.listTasks()).toEqual([]);
  });

  it('UNE DÉPENDANCE DONT UNE TÂCHE VIVANTE A ENCORE BESOIN RESTE', () => {
    // C'est la correction qui compte. `dependsOn` cite des identifiants : une
    // tâche qui attend un id disparu n'est JAMAIS prête, et rien ne le dit.
    const socle = poser({ titre: 'socle', statut: 'done', ageJours: 90 });
    const attend = poser({
      titre: 'attend le socle',
      statut: 'pending',
      ageJours: 90,
      dependsOn: [socle.id],
    });
    expect(store.pruneTasks(30 * JOUR), 'le socle d’une tâche vivante a été effacé').toBe(0);
    expect(store.getTask(socle.id), 'le socle a disparu').toBeDefined();
    expect(store.getTask(attend.id)?.dependsOn, 'la dépendance ne pointe plus nulle part').toEqual([
      socle.id,
    ]);
  });

  it('la borne est IDEMPOTENTE : un second passage ne supprime rien', () => {
    poser({ titre: 'vieille', statut: 'done', ageJours: 40 });
    expect(store.pruneTasks(30 * JOUR)).toBe(1);
    expect(store.pruneTasks(30 * JOUR), 'un second passage a resupprimé').toBe(0);
  });

  it('le verdict de relecture part AVEC sa tâche', () => {
    // Un verdict sur une tâche qui n'existe plus ne désigne rien, et aucune
    // autre borne ne nettoierait `reviews`.
    const t = poser({ titre: 'relue', statut: 'done', ageJours: 40 });
    store.setTaskReview(t.id, 'approved');
    expect(store.getTaskReview(t.id)).not.toBeNull();
    store.pruneTasks(30 * JOUR);
    expect(store.getTaskReview(t.id), 'le verdict a survécu à sa tâche').toBeNull();
  });

  it('LA MÉMOIRE, ELLE, SURVIT — et c’est délibéré', () => {
    // Le Cerveau existe pour que le SAVOIR dure plus longtemps que l'épisode
    // qui l'a produit. Il a sa propre borne, par genre et par usage. Cascader
    // ici effacerait les leçons en même temps que les faits.
    const t = poser({ titre: 'a appris quelque chose', statut: 'done', ageJours: 40 });
    store.recordMemory({
      projectId: projet,
      taskId: t.id,
      title: 'Une leçon',
      content: 'Ce qu’il ne faut plus refaire.',
    });
    store.pruneTasks(30 * JOUR);
    expect(store.getTask(t.id), 'la tâche devait partir').toBeUndefined();
    expect(
      store.listMemories().map((m) => m.title),
      'la leçon est partie avec l’épisode',
    ).toContain('Une leçon');
  });
});

describe('L’INSTANTANÉ EST UNE FENÊTRE, ET IL LE DIT', () => {
  it('sous la limite, il porte tout et ne prétend rien', () => {
    poser({ titre: 'une', statut: 'done', ageJours: 1 });
    poser({ titre: 'deux', statut: 'running', ageJours: 1 });
    const s = store.getSnapshot(10);
    expect(s.tasks).toHaveLength(2);
    expect(s.tasksTotal, 'le total ne compte pas ce qu’il y a vraiment').toBe(2);
  });

  it('AU-DELÀ, `tasksTotal` reste le compte RÉEL', () => {
    // Sans ce champ, un instantané tronqué a exactement l'air d'un instantané
    // complet — et l'écran fait compter faux à qui le lit.
    for (let i = 0; i < 12; i++) poser({ titre: `t${i}`, statut: 'done', ageJours: 1 });
    const s = store.getSnapshot(5);
    expect(s.tasks, 'la limite n’est pas appliquée').toHaveLength(5);
    expect(s.tasksTotal, 'le total a été tronqué lui aussi').toBe(12);
  });

  it('LES TÂCHES VIVANTES PASSENT TOUTES, même les plus anciennes', () => {
    // ─── L'ORDRE N'EST PAS « LES PLUS RÉCENTES » ───────────────────────────
    //
    // Une fenêtre par date perdrait une tâche bloquée depuis longtemps —
    // exactement celle qu'on cherche quand quelque chose ne va pas.
    const bloquee = poser({ titre: 'bloquée depuis un an', statut: 'running', ageJours: 365 });
    for (let i = 0; i < 20; i++) poser({ titre: `finie ${i}`, statut: 'done', ageJours: 0 });

    const s = store.getSnapshot(3);
    expect(s.tasks).toHaveLength(3);
    expect(idsDe(s.tasks), 'la tâche vivante a été rognée par la fenêtre').toContain(bloquee.id);
  });

  it('quand les vivantes DÉBORDENT la limite, aucune terminée ne passe devant', () => {
    // Le cas limite de la règle précédente : cinq vivantes pour une fenêtre de
    // trois. On préfère perdre une vivante qu'afficher une terminée à sa place
    // — la fenêtre est annoncée, et l'ordre reste « le vivant d'abord ».
    for (let i = 0; i < 5; i++) poser({ titre: `vivante ${i}`, statut: 'running', ageJours: 10 });
    for (let i = 0; i < 5; i++) poser({ titre: `finie ${i}`, statut: 'done', ageJours: 0 });
    const s = store.getSnapshot(3);
    expect(
      s.tasks.every((t) => t.status === 'running'),
      'une tâche terminée est passée devant une vivante',
    ).toBe(true);
  });

  it('parmi les terminées, ce sont les PLUS RÉCENTES qui restent', () => {
    const vieille = poser({ titre: 'vieille', statut: 'done', ageJours: 100 });
    const recente = poser({ titre: 'récente', statut: 'done', ageJours: 1 });
    const s = store.getSnapshot(1);
    expect(idsDe(s.tasks)).toEqual([recente.id]);
    expect(idsDe(s.tasks)).not.toContain(vieille.id);
  });

  it('la fenêtre ne change pas l’ORDRE promis : createdAt croissant', () => {
    // `listTasks` promet cet ordre. Une fenêtre doit réduire la taille, pas
    // réécrire le contrat — sinon chaque écran qui s'y fiait se met à mentir.
    //
    // ─── LE TEST DOIT POUVOIR ÉCHOUER, ET C'EST DÉLICAT ICI ────────────────
    //
    // La requête rend les terminées de la PLUS FRAÎCHE à la plus vieille. Pour
    // que le tri final ait quelque chose à faire, il faut donc que la DERNIÈRE
    // créée soit la plus fraîche : la requête la sort en tête, alors que
    // l'ordre promis la met en queue.
    //
    // `ageJours: 6 - i` fait exactement ça. Deux versions s'y sont trompées
    // avant celle-ci — l'une avec des dates de création toutes identiques,
    // l'autre avec les deux ordres dans le même sens. Dans les deux cas la
    // requête rendait déjà le bon ordre, le tri final ne changeait rien, et le
    // retirer laissait le test vert.
    for (let i = 0; i < 6; i++) poser({ titre: `t${i}`, statut: 'done', ageJours: 6 - i });
    const s = store.getSnapshot(4);
    const dates = s.tasks.map((t) => t.createdAt);
    expect(
      new Set(dates).size,
      'les dates de création sont identiques : le tri est indécidable',
    ).toBe(dates.length);
    expect(
      [...dates].sort((a, b) => a - b),
      'l’ordre par création est perdu',
    ).toEqual(dates);
  });

  it('la limite par défaut est celle qui a été MESURÉE', () => {
    // Une constante partagée plutôt qu'un nombre écrit dans `getSnapshot` : le
    // tableau de bord et les tests parlent alors du même seuil.
    expect(LIMITE_TACHES_INSTANTANE).toBe(2000);
  });
});
