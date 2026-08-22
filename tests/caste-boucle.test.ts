// LA BOUCLE COMPLÈTE D'UNE CASTE — de la production réelle au cadre injecté.
//
// ─── CE QUE LES TESTS EXISTANTS COUVRENT, ET CE QU'ILS SAUTENT ───────────────
//
// `polyethisme.test.ts` éprouve le module pur : à antécédents donnés, quelle
// caste. `polyethisme-wiring.test.ts` éprouve l'autre bout : à caste donnée,
// quel cadre. Entre les deux, ils SÈMENT les inspections à la main
// (`enregistrerInspection` appelé directement).
//
// Le maillon qu'aucun ne parcourt est donc justement celui du milieu :
//
//   un nœud rend une production → les Gardiennes l'inspectent À LA RÉCEPTION →
//   l'inspection se range → le corpus borné la relit → la caste change →
//   la tâche SUIVANTE reçoit un autre cadre.
//
// Cinq maillons, chacun testé, et rien ne vérifie qu'ils sont attachés. C'est
// exactement la forme des défauts trouvés cette nuit : le trou n'est dans aucune
// pièce, il est entre elles.
//
// ─── LA PROPRIÉTÉ LA PLUS CHÈRE : PAS DE CLIQUET ─────────────────────────────
//
// La doctrine du polyéthisme dit qu'une caste SE PERD exactement comme elle se
// gagne (règle 3) — un modèle qu'on remplace derrière le même nœud, un
// fournisseur qui dégrade son service, rien de tout cela n'est visible de la
// ruche. Cette règle est vérifiée dans le module pur, sur des antécédents
// fabriqués. Elle ne l'était pas sur le CORPUS RÉEL, qui est borné et relu à
// l'envers — et c'est là qu'un cliquet se cacherait sans qu'on le voie.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SEUIL_BATISSEUSE } from '../src/orchestrator/polyethisme.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-caste-suffisamment-long-42';
const NOEUD = 'noeud-observe';

/** Un diff réel : les Gardiennes refusent le vide, et c'est tout leur objet. */
const diffDe = (n: number): string =>
  [
    `diff --git a/src/f${n}.ts b/src/f${n}.ts`,
    '--- a/src/f' + n + '.ts',
    '+++ b/src/f' + n + '.ts',
    '@@ -1 +1,2 @@',
    ' const a = 1;',
    `+export const b${n} = ${n};`,
    '',
  ].join('\n');

// ─── LE SEUL FICHIER OÙ L'ORDRE EST LE SUJET ─────────────────────────────────
//
// `shuffle: false` déclare à vitest que cette suite est une TRAJECTOIRE, pas
// quatre vérifications indépendantes : une nourrice monte bâtisseuse sur ses
// productions, puis reperd la caste sur des productions creuses. Chaque test
// est un instant de cette courbe ; les jouer dans le désordre, c'est demander
// à la caste de descendre avant d'être montée.
//
// C'EST UNE PORTE DÉROBÉE, ET ELLE DOIT LE RESTER. Partout ailleurs, un test
// qui dépendait de son voisin a été rendu autonome — c'est le geste par
// défaut, et il n'a presque rien coûté. Ici il coûterait de reconstruire un
// corpus de SEUIL_BATISSEUSE tours à chaque test, sur un fichier qui budgète
// déjà 90 s, pour vérifier trois fois la même montée.
//
// `tests/ordre-declare.test.ts` tient la liste des suites autorisées à cette
// exemption, et rougit dès qu'une nouvelle apparaît sans être justifiée. Sans
// ce garde-fou, `shuffle: false` deviendrait la manière commode de faire taire
// un couplage accidentel — exactement ce que ce lot vient de corriger.
describe('de la production réelle à la caste, puis au cadre', { shuffle: false }, () => {
  let server: HiveServer;
  let dir: string;
  let ws: WebSocket;
  let projet = '';
  const assignations: { taskId: string; hiveContext?: string }[] = [];

  /** Attend qu'une condition devienne vraie, ou échoue en le disant. */
  const jusqua = async (quoi: string, cond: () => boolean, ms = 8_000): Promise<void> => {
    const fin = Date.now() + ms;
    while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 30));
    expect(cond(), `jamais advenu : ${quoi}`).toBe(true);
  };

  /** Crée une tâche prête et attend son assignation ; rend le cadre reçu. */
  const faireUneTache = async (titre: string): Promise<string> => {
    const avant = assignations.length;
    const t = server.store.createTask({
      projectId: projet,
      title: titre,
      // Une PROMESSE nommée : `empty_diff` ne se lève que lorsque les trois
      // conditions sont réunies — un dépôt, une promesse de modification, et
      // zéro octet rapporté.
      prompt: `modifier src/f${assignations.length}.ts`,
    });
    server.store.patchTask(t.id, { status: 'ready' });
    await jusqua(`assignation de « ${titre} »`, () => assignations.length > avant);
    return assignations[assignations.length - 1]!.hiveContext ?? '';
  };

  /**
   * Répond à une assignation.
   *
   * ⚠ LE NŒUD EST À `maxConcurrency: 1`. Toute tâche assignée doit recevoir sa
   * réponse, sinon plus aucune ne lui est confiée et l'attente suivante expire
   * sur un message qui parle d'inspection alors que le problème est ailleurs.
   */
  const repondre = (taskId: string, diff: string): void => {
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId,
        success: true,
        diff,
        logs: 'terminé',
        durationMs: 100,
        subAgents: [],
      }),
    );
  };

  /** Un tour complet : la tâche part, le nœud répond, l'inspection se range. */
  const unTour = async (titre: string, diff: string): Promise<string> => {
    const cadre = await faireUneTache(titre);
    const avant = inspections().length;
    repondre(assignations[assignations.length - 1]!.taskId, diff);
    await jusqua(`l’inspection de « ${titre} »`, () => inspections().length > avant);
    return cadre;
  };

  const inspections = () => server.store.listInspections().filter((i) => i.nodeId === NOEUD);
  const caste = () => {
    // On lit la caste PAR LA ROUTE, pas par le module pur : c'est le trajet
    // qu'on éprouve, et la route porte la mémoïsation qui pourrait figer.
    return fetch(`http://127.0.0.1:${server.port}/api/polyethisme`, {
      headers: { 'x-hive-token': TOKEN },
    })
      .then((r) => r.json() as Promise<{ noeuds: { nodeId: string; caste: string }[] }>)
      .then((v) => v.noeuds.find((n) => n.nodeId === NOEUD)?.caste ?? 'absent');
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-caste-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60,
      // Les deux doivent être allumés : sans Gardiennes, aucune inspection
      // n'est rangée et le polyéthisme s'éteint de lui-même.
      gardiennes: 'consultatif',
      polyethisme: 'consignes',
    });
    // LE DÉPÔT COMPTE. Les Gardiennes ne crient au diff vide que si un diff
    // POUVAIT exister : sans `repoUrl`, tout est jugé « clean » et la moitié
    // du fichier serait creuse sans qu'on le voie. C'est le code qui a raison —
    // c'est la première version de ce test qui avait tort.
    projet = server.store.createProject({
      name: 'Ruche observée',
      repoUrl: 'https://github.com/micka/observee.git',
    }).id;

    ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as {
        type: string;
        task?: { id: string };
        hiveContext?: string;
      };
      if (m.type === 'assign_task' && m.task) {
        assignations.push({
          taskId: m.task.id,
          ...(m.hiveContext !== undefined ? { hiveContext: m.hiveContext } : {}),
        });
      }
    });
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: NOEUD,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: NOEUD,
      }),
    );
  });

  afterAll(async () => {
    ws.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  let cadreDeNourrice = '';

  it('AU DÉPART, UNE NOURRICE — l’inconnu est le cas dangereux', async () => {
    cadreDeNourrice = await unTour('première tâche', diffDe(0));
    expect(await caste()).toBe('nourrice');
    // Et elle est ENCADRÉE : c'est ce que « nourrice » veut dire.
    expect(cadreDeNourrice).toMatch(/CADRE DE TRAVAIL/);
  }, 30_000);

  it('LES PRODUCTIONS RÉELLES REMPLISSENT LE CORPUS — sans qu’on sème rien', async () => {
    // Le maillon qu'aucun test ne parcourait : l'inspection est rangée par la
    // RÉCEPTION d'un résultat, pas par un appel direct au magasin.
    for (let i = 1; i < SEUIL_BATISSEUSE; i++) await unTour(`tâche ${i}`, diffDe(i));
    expect(inspections().length).toBeGreaterThanOrEqual(SEUIL_BATISSEUSE);
    // Et toutes propres : un diff réel n'est ni creux ni suspect.
    expect(inspections().every((i) => i.verdict === 'clean')).toBe(true);
  }, 60_000);

  it('LA CASTE MONTE, ET LE CADRE S’ALLÈGE', async () => {
    // La caste est mémoïsée quelques secondes côté serveur : on attend qu'elle
    // se recalcule plutôt que de supposer un instant.
    let vue = await caste();
    const fin = Date.now() + 8_000;
    while (vue === 'nourrice' && Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 200));
      vue = await caste();
    }
    expect(vue, 'la caste n’a pas bougé malgré des productions propres').toBe('batisseuse');

    // ET C'EST TOUT L'OBJET : la tâche SUIVANTE reçoit un autre cadre. Trop
    // encadrer une bonne ouvrière est aussi une faute — ça coûte des jetons et
    // ça rend du travail plus pauvre que ce dont elle est capable.
    const cadre = await unTour('après la montée', diffDe(99));
    expect(cadreDeNourrice.length, 'le cadre de nourrice était vide').toBeGreaterThan(0);
    expect(cadre.length, 'le cadre n’a pas changé de densité').toBeLessThan(cadreDeNourrice.length);
  }, 40_000);

  it('PAS DE CLIQUET — la caste se PERD comme elle se gagne, sur le vrai corpus', async () => {
    // La propriété la plus chère de la doctrine, et elle n'était vérifiée que
    // dans le module pur, sur des antécédents fabriqués. Un modèle remplacé
    // derrière le même nœud n'est pas visible de la ruche : c'est la qualité
    // observée, et elle seule, qui doit décider — dans les deux sens.
    // diff VIDE : c'est exactement ce que les Gardiennes attrapent.
    for (let i = 0; i < SEUIL_BATISSEUSE * 3; i++) await unTour(`production creuse ${i}`, '');
    expect(
      inspections().some((x) => x.verdict !== 'clean'),
      'aucune production n’a été jugée creuse — les Gardiennes ne mordent pas',
    ).toBe(true);
    let vue = await caste();
    const fin = Date.now() + 8_000;
    while (vue !== 'nourrice' && Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 200));
      vue = await caste();
    }
    expect(vue, 'la caste est restée acquise malgré des productions creuses').toBe('nourrice');
  }, 90_000);
});
