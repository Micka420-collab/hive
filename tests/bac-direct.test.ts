// SANDBOX LIVE — les contrats purs : l'état en direct, le protocole, l'horloge
// suspendable, l'arbre des sous-agents, la lecture des mesures, et les
// décisions d'affichage.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// · un état en direct hors borne fait tomber le message ENTIER (comme tout
//   champ du protocole), et « inconnu » ne devient jamais un zéro ;
// · la fusion au hub : une tentative sur un autre nœud repart de zéro, les
//   validations se fusionnent clé par clé, une mesure qui ne vaut plus s'en va ;
// · le minuteur suspendu ne déclenche pas, et rend le temps qui restait ;
// · l'arbre des sous-agents suit `parent_tool_use_id`, et ne lie jamais ce que
//   le flux n'a pas lié ;
// · la table des processus et le `stats` des moteurs se lisent tels quels,
//   un champ illisible restant absent.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { createSubAgentTracker } from '../src/adapters/subagent-parser.js';
import {
  COMMANDE_DIRECT_MAX,
  DIFF_DIRECT_MAX,
  directTacheDepuis,
  etatDirectDepuis,
  fusionnerDirect,
} from '../src/shared/bac-direct.js';
import { creerMinuteurSuspendable } from '../src/shared/minuteur-suspendable.js';
import type { HorlogeMinuteur } from '../src/shared/minuteur-suspendable.js';
import { parseClientMessage, parseServerMessage } from '../src/shared/protocol.js';
import {
  cpuDuCgroup,
  descendance,
  dossierCgroup,
  dureePs,
  lireInspect,
  lireSortiePs,
  lireStatProc,
  picDuCgroup,
  taillePageAuxv,
  lireStatsMoteur,
  MesureArbre,
} from '../src/node-client/mesure-processus.js';
import {
  arbreSousAgents,
  controlesAffiches,
  etatsDesEtapes,
  gestePause,
  mesuresLisibles,
} from '../dashboard/src/views/bac-direct-rendu.js';

describe('l’état en direct — validé, borné, fusionné', () => {
  it('un champ hors contrat fait tomber l’état entier', () => {
    expect(etatDirectDepuis({ phase: 'agent', commande: 'claude -p x' })).toEqual({
      phase: 'agent',
      commande: 'claude -p x',
    });
    for (const faux of [
      { phase: 'fin' },
      { commande: 'x'.repeat(COMMANDE_DIRECT_MAX + 1) },
      { pausable: 'oui' },
      { metriques: { source: 'gpu' } },
      { metriques: { source: 'arbre', cpuPct: -1 } },
      { metriques: { source: 'arbre', rssOctets: Number.NaN } },
      { metriques: { source: 'arbre', processus: 1.5 } },
      { controles: { deploiement: 'passed' } },
      { controles: { tests: 'vert' } },
    ]) {
      expect(etatDirectDepuis(faux), JSON.stringify(faux)).toBeNull();
    }
  });

  it('`metriques: null` dit « plus mesurable » ; la fusion l’oublie', () => {
    const a = fusionnerDirect(
      undefined,
      't1',
      'n1',
      { metriques: { source: 'arbre', rssOctets: 10 } },
      100,
    );
    expect(a).toMatchObject({ metriques: { rssOctets: 10 }, metriquesA: 100 });
    const b = fusionnerDirect(a, 't1', 'n1', { metriques: null }, 200);
    expect(b.metriques).toBeUndefined();
    expect(b.metriquesA).toBeUndefined();
    expect(b.majA).toBe(200);
  });

  it('les validations se fusionnent clé par clé ; une nouvelle phase efface la commande', () => {
    let d = fusionnerDirect(undefined, 't1', 'n1', { phase: 'agent', commande: 'claude' }, 1);
    d = fusionnerDirect(d, 't1', 'n1', { phase: 'validations' }, 2);
    expect(d.commande).toBeUndefined();
    d = fusionnerDirect(d, 't1', 'n1', { controles: { lint: 'passed' } }, 3);
    d = fusionnerDirect(d, 't1', 'n1', { controles: { tests: 'en_cours' } }, 4);
    expect(d.controles).toEqual({ lint: 'passed', tests: 'en_cours' });
  });

  it('un AUTRE nœud repart de zéro : l’état d’une tentative ne colle pas à la suivante', () => {
    const d = fusionnerDirect(undefined, 't1', 'n1', { enPause: true, pausable: true }, 1);
    const e = fusionnerDirect(d, 't1', 'n2', { phase: 'agent' }, 2);
    expect(e).toEqual({ taskId: 't1', nodeId: 'n2', phase: 'agent', majA: 2 });
  });

  it('côté écran, l’état diffusé est revalidé, et doit être celui de la tâche nommée', () => {
    const direct = fusionnerDirect(undefined, 't1', 'n1', { phase: 'agent' }, 5);
    expect(directTacheDepuis(direct)).toEqual(direct);
    expect(
      parseServerMessage(JSON.stringify({ type: 'task_direct', taskId: 't1', direct })),
    ).toEqual({ type: 'task_direct', taskId: 't1', direct });
    expect(
      parseServerMessage(JSON.stringify({ type: 'task_direct', taskId: 't2', direct })),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ type: 'task_direct', taskId: 't1', direct: null })),
    ).toEqual({ type: 'task_direct', taskId: 't1', direct: null });
    expect(directTacheDepuis({ ...direct, taskId: '../x' })).toBeNull();
  });
});

describe('le protocole Sandbox Live', () => {
  const maj = { type: 'task_update', taskId: 'tache-1', status: 'running' };

  it('task_update porte l’état ; un état faux fait tomber le message', () => {
    expect(
      parseClientMessage(JSON.stringify({ ...maj, direct: { phase: 'agent', enPause: false } })),
    ).toEqual({ ...maj, direct: { phase: 'agent', enPause: false } });
    expect(parseClientMessage(JSON.stringify({ ...maj, direct: { phase: 'x' } }))).toBeNull();
  });

  it('sous-agents : un parent, s’il y en a un, est un identifiant', () => {
    const sa = { id: 'sa-2', name: 'b', status: 'running', parentId: 'sa-1' };
    expect(parseClientMessage(JSON.stringify({ ...maj, subAgents: [sa] }))).toMatchObject({
      subAgents: [sa],
    });
    expect(
      parseClientMessage(JSON.stringify({ ...maj, subAgents: [{ ...sa, parentId: '../x' }] })),
    ).toBeNull();
  });

  it('diff_direct : borné à DIFF_DIRECT_MAX, `tronque` obligatoire', () => {
    const base = { type: 'diff_direct', taskId: 't1', requestId: 'r1', diff: '+a', tronque: false };
    expect(parseClientMessage(JSON.stringify(base))).toEqual(base);
    expect(
      parseClientMessage(JSON.stringify({ ...base, diff: 'x'.repeat(DIFF_DIRECT_MAX + 1) })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...base, tronque: undefined }))).toBeNull();
  });

  it('pause_task, resume_task, demande_diff_direct : des identifiants, rien d’autre', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'pause_task', taskId: 't1' }))).toEqual({
      type: 'pause_task',
      taskId: 't1',
    });
    expect(parseServerMessage(JSON.stringify({ type: 'resume_task', taskId: '../x' }))).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'demande_diff_direct', taskId: 't1', requestId: 'r' }),
      ),
    ).toEqual({ type: 'demande_diff_direct', taskId: 't1', requestId: 'r' });
  });
});

describe('le minuteur suspendable — l’horloge d’une tâche en pause', () => {
  /** Une horloge de banc : le temps n'avance que quand on le dit. */
  function horlogeDeBanc(): HorlogeMinuteur & { avancer(ms: number): void } {
    let t = 0;
    const armes = new Map<number, { a: number; fn: () => void }>();
    let n = 0;
    return {
      maintenant: () => t,
      armer: (fn, ms) => {
        n += 1;
        armes.set(n, { a: t + ms, fn });
        return n;
      },
      desarmer: (p) => armes.delete(p as number),
      avancer(ms) {
        t += ms;
        for (const [id, a] of [...armes]) {
          if (a.a <= t) {
            armes.delete(id);
            a.fn();
          }
        }
      },
    };
  }

  it('suspendu, il ne déclenche pas ; repris, il rend exactement le temps qui restait', () => {
    const h = horlogeDeBanc();
    let declenche = 0;
    const m = creerMinuteurSuspendable(1_000, () => (declenche += 1), h);
    h.avancer(400);
    m.suspendre();
    expect(m.restant()).toBe(600);
    h.avancer(10_000);
    expect(declenche).toBe(0);
    m.reprendre();
    h.avancer(599);
    expect(declenche).toBe(0);
    h.avancer(1);
    expect(declenche).toBe(1);
    expect(m.restant()).toBe(0);
  });

  it('annulé, il ne déclenche jamais — même repris', () => {
    const h = horlogeDeBanc();
    let declenche = 0;
    const m = creerMinuteurSuspendable(100, () => (declenche += 1), h);
    m.suspendre();
    m.annuler();
    m.reprendre();
    h.avancer(1_000);
    expect(declenche).toBe(0);
  });
});

describe('l’arbre des sous-agents', () => {
  const ligne = (contenu: unknown[], parent?: string): string =>
    JSON.stringify({
      type: 'assistant',
      message: { content: contenu },
      ...(parent ? { parent_tool_use_id: parent } : {}),
    });
  const tache = (id: string, description: string) => ({
    type: 'tool_use',
    id,
    name: 'Task',
    input: { description },
  });

  it('une délégation lue DANS un sous-agent a ce sous-agent pour parent', () => {
    const t = createSubAgentTracker();
    t.feed(ligne([tache('toolu_a', 'Explorer')]));
    t.feed(ligne([tache('toolu_b', 'Lire le module')], 'toolu_a'));
    // Un parent inconnu du suivi : à la racine, jamais un lien inventé.
    t.feed(ligne([tache('toolu_c', 'Orphelin')], 'toolu_inconnu'));
    expect(t.list()).toEqual([
      { id: 'sa-1', name: 'Explorer', status: 'running' },
      { id: 'sa-2', name: 'Lire le module', status: 'running', parentId: 'sa-1' },
      { id: 'sa-3', name: 'Orphelin', status: 'running' },
    ]);
  });

  it('l’écran le rend en arbre ; un parent absent ou un cycle reste visible, à la racine', () => {
    const arbre = arbreSousAgents([
      { id: 'a', name: 'a', status: 'running' },
      { id: 'b', name: 'b', status: 'done', parentId: 'a' },
      { id: 'c', name: 'c', status: 'running', parentId: 'b' },
      { id: 'd', name: 'd', status: 'running', parentId: 'absent' },
      { id: 'x', name: 'x', status: 'running', parentId: 'y' },
      { id: 'y', name: 'y', status: 'running', parentId: 'x' },
    ]);
    const plat = (n: (typeof arbre)[number]): string =>
      n.enfants.length ? `${n.agent.id}(${n.enfants.map(plat).join(',')})` : n.agent.id;
    expect(arbre.map(plat)).toEqual(['a(b(c))', 'd', 'x(y)']);
  });
});

describe('lire une mesure — telle qu’elle est, ou pas du tout', () => {
  it('/proc/<pid>/stat : un nom de commande à parenthèses et espaces ne décale rien', () => {
    // utime 150, stime 50 ; cutime 30, cstime 10 (les enfants moissonnés) ; rss 256.
    const champs = [
      'S',
      '41',
      ...Array(9).fill('0'),
      '150',
      '50',
      '30',
      '10',
      ...Array(6).fill('0'),
      '256',
    ];
    const ligne = `42 (node (agent) x) ${champs.join(' ')}`;
    expect(lireStatProc(42, ligne, 4096)).toEqual({
      pid: 42,
      ppid: 41,
      cpuMs: 2_000,
      cpuEnfantsMs: 400,
      rssOctets: 256 * 4096,
    });
    // Un noyau arm64 en pages de 16 Kio : la même ligne pèse quatre fois plus.
    expect(lireStatProc(42, ligne, 16_384)?.rssOctets).toBe(256 * 16_384);
    // Taille de page inconnue : la mémoire est INCONNUE, pas convertie au jugé.
    expect(lireStatProc(42, ligne, null)).toEqual({
      pid: 42,
      ppid: 41,
      cpuMs: 2_000,
      cpuEnfantsMs: 400,
    });
    expect(lireStatProc(1, 'illisible', 4096)).toBeNull();
  });

  it('le BILAN de l’arbre : enfants moissonnés comptés, orphelin gardé, pic échantillonné', () => {
    const m = new MesureArbre(10);
    expect(m.bilan(), 'aucun relevé : aucun nombre').toEqual({ releves: 0 });
    // 11 travaille ; 10 a déjà moissonné 400 ms d'enfants brefs, jamais vus vivants.
    m.relever(
      [
        { pid: 10, ppid: 1, cpuMs: 100, cpuEnfantsMs: 400, rssOctets: 100 },
        { pid: 11, ppid: 10, cpuMs: 300, cpuEnfantsMs: 0, rssOctets: 900 },
        { pid: 99, ppid: 1, cpuMs: 9_999, rssOctets: 9_999 },
      ],
      0,
    );
    expect(m.bilan()).toEqual({ releves: 1, cpuMs: 800, picOctets: 1_000 });
    // 11 a fini et 10 l'a moissonné : son CPU PASSE dans le `cutime` de 10,
    // compté une fois. Le pic, lui, reste le plus haut relevé.
    m.relever([{ pid: 10, ppid: 1, cpuMs: 150, cpuEnfantsMs: 750, rssOctets: 100 }], 1_000);
    expect(m.bilan()).toEqual({ releves: 2, cpuMs: 900, picOctets: 1_000 });
    // Sous `ps` (pas de `cutime`), un processus sorti garde son dernier CPU vu.
    const ps = new MesureArbre(20);
    ps.relever(
      [
        { pid: 20, ppid: 1, cpuMs: 100, rssOctets: 10 },
        { pid: 21, ppid: 20, cpuMs: 500, rssOctets: 10 },
      ],
      0,
    );
    ps.relever([{ pid: 20, ppid: 1, cpuMs: 120, rssOctets: 10 }], 1_000);
    expect(ps.bilan()).toEqual({ releves: 2, cpuMs: 620, picOctets: 20 });
  });

  it('le cgroup d’un conteneur : le SIEN, ou rien — jamais celui d’un inconnu', () => {
    const id = 'a'.repeat(64);
    expect(lireInspect(`${id} 4242\n`)).toEqual({ id, pid: 4242 });
    // Pas encore lancé (pid 0), ou sortie illisible : à réessayer, pas à deviner.
    expect(lireInspect(`${id} 0`)).toBeNull();
    expect(lireInspect('Error: No such object')).toBeNull();
    expect(dossierCgroup(id, `0::/system.slice/docker-${id}.scope\n`)).toBe(
      `/sys/fs/cgroup/system.slice/docker-${id}.scope`,
    );
    expect(dossierCgroup(id, `0::/user.slice/libpod-${id}.scope/container`)).toBe(
      `/sys/fs/cgroup/user.slice/libpod-${id}.scope/container`,
    );
    // Le pid d'une VM (Docker Desktop) ou d'un autre espace nomme un INCONNU
    // sur l'hôte : son cgroup ne porte pas l'identifiant, on ne le lit pas.
    expect(dossierCgroup(id, '0::/user.slice/user-1000.slice/session-2.scope')).toBeNull();
    expect(dossierCgroup(id, `0::/x/../${id}`)).toBeNull();
    expect(dossierCgroup(id, `12:cpu:/docker/${id}`), 'cgroup v1 : pas lu').toBeNull();
    expect(cpuDuCgroup('usage_usec 1234567\nuser_usec 1000000\n')).toBe(1_234);
    expect(cpuDuCgroup('user_usec 1')).toBeNull();
    expect(picDuCgroup('52428800\n')).toBe(50 * 1024 * 1024);
    expect(picDuCgroup('max')).toBeNull();
  });

  it('la taille de page vient du vecteur auxiliaire du noyau, jamais d’une constante', () => {
    // Paires (type, valeur) d'un mot machine, closes par AT_NULL.
    const auxv = (mot: 4 | 8, paires: [number, number][], le = true): Uint8Array => {
      const b = new DataView(new ArrayBuffer((paires.length + 1) * 2 * mot));
      paires.forEach(([t, v], i) => {
        if (mot === 8) {
          b.setBigUint64(i * 16, BigInt(t), le);
          b.setBigUint64(i * 16 + 8, BigInt(v), le);
        } else {
          b.setUint32(i * 8, t, le);
          b.setUint32(i * 8 + 4, v, le);
        }
      });
      return new Uint8Array(b.buffer);
    };
    expect(
      taillePageAuxv(
        auxv(8, [
          [33, 7],
          [6, 16_384],
          [17, 100],
        ]),
        8,
        'LE',
      ),
    ).toBe(16_384);
    expect(taillePageAuxv(auxv(4, [[6, 65_536]]), 4, 'LE')).toBe(65_536);
    expect(taillePageAuxv(auxv(8, [[6, 4096]], false), 8, 'BE')).toBe(4096);
    // Absente, ou absurde : inconnue.
    expect(taillePageAuxv(auxv(8, [[33, 7]]), 8, 'LE')).toBeNull();
    expect(taillePageAuxv(auxv(8, [[6, 3000]]), 8, 'LE')).toBeNull();
    expect(taillePageAuxv(new Uint8Array(3), 8, 'LE')).toBeNull();
  });

  it('une mémoire inconnue dans l’arbre rend la somme inconnue', () => {
    const m = new MesureArbre(10);
    expect(
      m.relever(
        [
          { pid: 10, ppid: 1, cpuMs: 0, rssOctets: 100 },
          { pid: 11, ppid: 10, cpuMs: 0 },
        ],
        0,
      ),
    ).toEqual({ source: 'arbre', processus: 2 });
  });

  it('ps : durées et lignes illisibles', () => {
    expect(dureePs('01:02.50')).toBe(62_500);
    expect(dureePs('1-00:00:01')).toBe(86_401_000);
    expect(dureePs('abc')).toBeNull();
    expect(lireSortiePs('  10  1  2048 00:01.00\nligne cassée\n 11 10 1024 0:00.50\n')).toEqual([
      { pid: 10, ppid: 1, cpuMs: 1_000, rssOctets: 2 * 1024 ** 2 },
      { pid: 11, ppid: 10, cpuMs: 500, rssOctets: 1024 ** 2 },
    ]);
  });

  it('l’arbre : la racine et TOUTE sa descendance, rien d’autre', () => {
    const p = (pid: number, ppid: number) => ({ pid, ppid, cpuMs: 0, rssOctets: 0 });
    const table = [p(1, 0), p(10, 1), p(11, 10), p(12, 11), p(20, 1)];
    expect(descendance(table, 10).map((x) => x.pid)).toEqual([10, 11, 12]);
    expect(descendance(table, 99)).toEqual([]);
  });

  it('le CPU se mesure sur une FENÊTRE : pas au premier relevé, jamais négatif', () => {
    const m = new MesureArbre(10);
    const t1 = [
      { pid: 10, ppid: 1, cpuMs: 1_000, rssOctets: 100 },
      { pid: 11, ppid: 10, cpuMs: 500, rssOctets: 50 },
    ];
    expect(m.relever(t1, 0)).toEqual({ source: 'arbre', rssOctets: 150, processus: 2 });
    // 11 est mort, 12 est né : seul 10 a une différence mesurable (+500 ms en 1 s).
    const t2 = [
      { pid: 10, ppid: 1, cpuMs: 1_500, rssOctets: 100 },
      { pid: 12, ppid: 10, cpuMs: 9_000, rssOctets: 70 },
    ];
    expect(m.relever(t2, 1_000)).toEqual({
      source: 'arbre',
      cpuPct: 50,
      rssOctets: 170,
      processus: 2,
    });
    expect(m.relever([], 2_000)).toBeNull();
  });

  it('`stats` d’un moteur : Docker et Podman, champ illisible absent', () => {
    expect(lireStatsMoteur('12.34%|10.5MiB / 2GiB|7\n')).toEqual({
      source: 'conteneur',
      cpuPct: 12.34,
      rssOctets: Math.round(10.5 * 1024 ** 2),
      processus: 7,
    });
    expect(lireStatsMoteur('0.00%|312.4kB / 2.1GB|--')).toEqual({
      source: 'conteneur',
      cpuPct: 0,
      rssOctets: 312_400,
    });
    expect(lireStatsMoteur('pas de conteneur')).toBeNull();
  });
});

describe('les décisions d’affichage', () => {
  const direct = (d: Record<string, unknown>) =>
    ({ taskId: 't', nodeId: 'n', majA: 1, ...d }) as Parameters<typeof gestePause>[0];

  it('la pause n’est offerte que là où l’ouvrière a dit savoir la faire', () => {
    expect(gestePause(undefined)).toBeNull();
    expect(gestePause(direct({ pausable: false }))).toBeNull();
    expect(gestePause(direct({ pausable: true }))).toBe('pause');
    expect(gestePause(direct({ pausable: true, enPause: true }))).toBe('reprendre');
  });

  it('une mesure absente est « inconnue », jamais 0', () => {
    expect(mesuresLisibles(undefined)).toEqual({
      cpu: null,
      memoire: null,
      processus: null,
      source: null,
    });
    expect(
      mesuresLisibles(direct({ metriques: { source: 'arbre', rssOctets: 3 * 1024 ** 2 } })),
    ).toEqual({ cpu: null, memoire: '3.0 Mio', processus: null, source: 'arbre' });
  });

  it('sans phase connue, aucune étape n’est « en cours »', () => {
    expect(etatsDesEtapes(undefined)).toEqual({
      preparation: 'a_venir',
      agent: 'a_venir',
      validations: 'a_venir',
    });
    expect(etatsDesEtapes('validations')).toEqual({
      preparation: 'faite',
      agent: 'faite',
      validations: 'en_cours',
    });
  });

  it('les validations suivent l’ordre de #475, et n’apparaissent qu’une fois commencées', () => {
    expect(controlesAffiches(direct({}))).toEqual([]);
    expect(controlesAffiches(direct({ controles: { lint: 'passed' } }))).toEqual([
      { cle: 'tests', etat: null },
      { cle: 'typecheck', etat: null },
      { cle: 'build', etat: null },
      { cle: 'lint', etat: 'passed' },
    ]);
  });
});

describe('Scheduler — qui a le droit de dire l’état d’une exécution', () => {
  it('le nœud ASSIGNÉ seulement, et jamais derrière le résultat ; rien au journal', () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-bac-direct-'));
    const store = new HiveStore(path.join(dossier, 'hive.db'));
    try {
      const relayes: string[] = [];
      const scheduler = new Scheduler(store, {
        simulation: true,
        onDirect: (taskId, nodeId, direct) =>
          relayes.push(`${taskId}:${nodeId}:${JSON.stringify(direct)}`),
      });
      const profil = (name: string) => ({
        name,
        ownerName: 'banc',
        agentType: 'shell',
        maxConcurrency: 1,
      });
      const p = store.createProject({ name: 'P' });
      const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
      const n1 = scheduler.registerNode(profil('n1'));
      scheduler.tick();
      const n2 = scheduler.registerNode(profil('n2'));
      const maj = (nodeId: string) =>
        scheduler.handleTaskUpdate(nodeId, t.id, undefined, undefined, undefined, undefined, {
          phase: 'agent',
        });
      maj(n1.id);
      const avant = store.countEvents();
      maj(n1.id);
      maj(n2.id); // un nœud à qui la tâche n'appartient pas
      expect(store.countEvents()).toBe(avant);
      scheduler.handleTaskResult(n1.id, {
        taskId: t.id,
        success: true,
        diff: '',
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
      maj(n1.id); // posthume
      expect(relayes).toEqual([
        `${t.id}:${n1.id}:{"phase":"agent"}`,
        `${t.id}:${n1.id}:{"phase":"agent"}`,
      ]);
    } finally {
      store.close();
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
