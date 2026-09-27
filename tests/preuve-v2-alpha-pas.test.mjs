// LA SÉQUENCE DE LA PREUVE V2 ALPHA — pilotée par une ruche de laboratoire.
//
// La séquence ne juge rien ; elle doit : refuser sans ouvrière réelle, ne RIEN
// créer sans `creer`, dire chaque refus de la ruche, ne pas relire avant que
// chaque production soit RÉGLÉE (contre-revue rendue, aucun retry en
// attente), et rassembler les faits de la BONNE tâche et des BONS nœuds.

import { describe, expect, it } from 'vitest';
import { HIVE_DELEGATE_TOOL, HIVE_WAIT_TOOL } from '../src/adapters/delegation-bridge.ts';
import { depotDepuisUrl } from '../src/orchestrator/livraison.ts';
import {
  MISSION,
  OUTIL_ATTENDRE,
  OUTIL_DELEGUER,
  argumentsDeLaPreuve,
  bacLePlusFaible,
  depotGithub,
  menerLaPreuve,
  missionsEssaim,
  ouvrieresReelles,
} from '../scripts/preuve-v2-alpha-pas.mjs';
import { conclurePreuve } from '../scripts/preuve-v2-alpha-rapport.mjs';
import { jugerV2Alpha } from '../scripts/preuve-v2-alpha-verdict.mjs';

const PODMAN = { niveau: 'conteneur', fournisseur: 'podman' };
const NOEUD_REEL = { id: 'n-reel', name: 'poste', agentType: 'claude-code', status: 'online' };
const NOEUD_SIMULE = { id: 'n-sim', name: 'banc', agentType: 'shell', status: 'online' };
const NOEUD_CODEX = { id: 'n-codex', name: 'relectrice', agentType: 'codex', status: 'online' };

const ev = (id, type, payload) => ({ id, ts: id * 100, type, payload });

/** Ce que la ruche avait déjà consigné AVANT la preuve : jamais gardé. */
const ANCIENS = [
  ev(1, 'task_done', { taskId: 't1', nodeId: 'n-reel' }),
  ev(2, 'contre_expertise', { taskId: 't1', possible: true, relectures: ['r-vieille'] }),
];

/** t1 démarre, puis se termine sans contre-revue possible. */
const TOURS_SIMPLES = [
  { taches: [] },
  { taches: [{ id: 't1', status: 'assigned' }] },
  {
    taches: [{ id: 't1', status: 'running' }],
    evenements: [ev(10, 'task_started', { taskId: 't1', nodeId: 'n-reel' })],
  },
  {
    taches: [{ id: 't1', status: 'done' }],
    evenements: [
      ev(11, 'task_done', { taskId: 't1', nodeId: 'n-reel' }),
      ev(12, 'contre_expertise', { taskId: 't1', resultId: 1, possible: false }),
    ],
  },
];

/** La sonde GitHub d'une Reine qui a son jeton. */
const GITHUB_PRET = { '/api/github/status': { configure: true } };

/**
 * Une ruche de laboratoire : chaque appel est journalisé, chaque réponse
 * réglable. `tours[k]` est ce que rend le k-ième instantané (le tour 0 est
 * celui d'avant la création), avec ses `noeuds` s'il en donne ; le journal
 * montre ANCIENS puis les `evenements` des tours déjà servis.
 */
function laboratoire({
  noeuds = [NOEUD_REEL],
  projet = { status: 201, corps: { id: 'p1' } },
  creation,
  tours = TOURS_SIMPLES,
  lectures = {},
  journalLisible = true,
} = {}) {
  const appels = [];
  let servi = -1;
  const journal = () => [
    ...ANCIENS,
    ...tours.slice(0, Math.max(servi, 0) + 1).flatMap((t) => t.evenements ?? []),
  ];
  return {
    appels,
    ruche: {
      instantane: async () => {
        appels.push('instantane');
        servi = Math.min(servi + 1, tours.length - 1);
        return {
          status: 200,
          corps: { nodes: tours[servi].noeuds ?? noeuds, tasks: tours[servi].taches },
        };
      },
      creerProjet: async (corps) => {
        appels.push(
          `projet:${corps.name.startsWith('Preuve V2 Alpha') ? 'nommé' : corps.name}` +
            `${corps.repoUrl ? `:${corps.repoUrl}` : ''}`,
        );
        return projet;
      },
      creerTaches: async (projetId, taches) => {
        appels.push(`taches:${projetId}:${taches.map((t) => t.title).join('|')}`);
        return (
          creation ?? {
            status: 201,
            corps: taches.map((t, i) => ({ id: `t${i + 1}`, title: t.title })),
          }
        );
      },
      livrer: async (taskId) => {
        appels.push(`livrer:${taskId}`);
        return { status: 201, corps: { pr: 7, branche: `hive/${taskId}`, commitSha: 'c0ffee' } };
      },
      lire: async (chemin) => {
        if (chemin.startsWith('/api/events?')) {
          if (!journalLisible) return { status: 500, corps: null };
          const depuis = Number(new URL(chemin, 'http://x').searchParams.get('since'));
          return { status: 200, corps: journal().filter((e) => e.id > depuis) };
        }
        appels.push(`lire:${chemin}`);
        return chemin in lectures
          ? { status: 200, corps: lectures[chemin] }
          : { status: 404, corps: null };
      },
      patienter: async () => {},
    },
  };
}

describe('preuve V2 Alpha — la séquence', () => {
  it('SANS OUVRIÈRE RÉELLE, ELLE REFUSE — une simulation ne prouve rien', async () => {
    const { ruche, appels } = laboratoire({
      noeuds: [NOEUD_SIMULE, { ...NOEUD_REEL, status: 'offline' }],
    });
    const issue = await menerLaPreuve(ruche, { creer: true });

    expect(issue.ok).toBe(false);
    expect(issue.raison).toContain('aucune ouvrière avec un agent réel en ligne');
    expect(appels, 'rien n’est créé').toEqual(['instantane']);
  });

  it('SANS `creer`, ELLE DIT CE QU’ELLE FERAIT ET NE CRÉE RIEN — la mission coûte des crédits', async () => {
    const { ruche, appels } = laboratoire({ noeuds: [NOEUD_REEL, NOEUD_SIMULE] });
    const issue = await menerLaPreuve(ruche);

    expect(issue).toMatchObject({ ok: false, plan: true });
    expect(issue.message).toContain('1 ouvrière(s) réelle(s) — poste (claude-code)');
    expect(issue.message).toContain('--oui');
    expect(appels).toEqual(['instantane']);

    // Les exigences ne dépensent rien non plus : seul `creer` confie. La
    // sonde GitHub est une lecture, et l'URL montrée perd ses identifiants.
    const essaim = laboratoire({
      noeuds: [NOEUD_REEL, NOEUD_CODEX, { ...NOEUD_REEL, id: 'n3' }],
      lectures: GITHUB_PRET,
    });
    const plan = await menerLaPreuve(essaim.ruche, {
      ouvrieres: 3,
      depot: 'https://moi:ghp_secret@github.com/demo/hive.git',
    });
    expect(plan.message).toContain(
      'confier 4 tâches (3 indépendantes, 1 qui délègue) sur https://github.com/demo/hive.git, puis la livrer',
    );
    expect(plan.message).not.toContain('ghp_secret');
    expect(essaim.appels).toEqual(['instantane', 'lire:/api/github/status']);
  });

  it('UN PROJET OU UNE MISSION REFUSÉS SONT DITS — avec le statut', async () => {
    const projetRefuse = laboratoire({ projet: { status: 403, corps: null, texte: 'interdit' } });
    expect(await menerLaPreuve(projetRefuse.ruche, { creer: true })).toEqual({
      ok: false,
      raison: 'la ruche refuse le projet (403) : interdit',
    });

    const missionRefusee = laboratoire({
      creation: { status: 400, corps: null, texte: 'invalide' },
    });
    expect(await menerLaPreuve(missionRefusee.ruche, { creer: true })).toEqual({
      ok: false,
      raison: 'la ruche refuse la mission (400) : invalide',
    });
  });

  it('UN JOURNAL ILLISIBLE ARRÊTE TOUT AVANT LA CRÉATION — rien ne serait vérifiable', async () => {
    const { ruche, appels } = laboratoire({ journalLisible: false });
    expect(await menerLaPreuve(ruche, { creer: true })).toEqual({
      ok: false,
      raison: 'le journal de la Reine (/api/events) est illisible : rien ne serait vérifiable',
    });
    expect(appels).toEqual(['instantane']);
  });

  it('ELLE NE CONCLUT PAS AVANT QUE LA MISSION SOIT RÉGLÉE — et dit ce qu’elle attend encore', async () => {
    const { ruche } = laboratoire({ tours: TOURS_SIMPLES.slice(0, 3) });
    expect(await menerLaPreuve(ruche, { creer: true, patienceS: 3 })).toEqual({
      ok: false,
      raison: 'la mission t1 n’est pas réglée après 3 s — t1 running',
    });
  });

  it('DONE N’EST PAS RÉGLÉE : ELLE ATTEND LA CONTRE-REVUE, SUIT LE RETRY, ET RELIT LA PRODUCTION FINALE', async () => {
    const tours = [
      ...TOURS_SIMPLES.slice(0, 3),
      {
        // Rendue : la contre-revue part dans le même geste.
        taches: [
          { id: 't1', status: 'done' },
          { id: 'r1', status: 'assigned' },
        ],
        evenements: [
          ev(11, 'task_done', { taskId: 't1', nodeId: 'n-reel' }),
          ev(12, 'contre_expertise', {
            taskId: 't1',
            resultId: 1,
            possible: true,
            relectures: ['r1'],
          }),
          ev(13, 'task_started', { taskId: 'r1', nodeId: 'n-codex' }),
        ],
      },
      {
        // L'objection revient : l'Evaluator renvoie t1 en correction.
        taches: [
          { id: 't1', status: 'ready' },
          { id: 'r1', status: 'done' },
        ],
        evenements: [
          ev(14, 'task_done', { taskId: 'r1', nodeId: 'n-codex' }),
          ev(15, 'contre_expertise_verdict', { taskId: 't1', resultId: 1, conteste: true }),
          ev(16, 'task_retry', { taskId: 't1', source: 'evaluator', resultId: 1 }),
        ],
      },
      {
        // Seconde production : `r1` est terminale, mais elle relisait la PREMIÈRE.
        taches: [
          { id: 't1', status: 'done' },
          { id: 'r1', status: 'done' },
          { id: 'r2', status: 'running' },
        ],
        evenements: [
          ev(17, 'task_started', { taskId: 't1', nodeId: 'n-reel' }),
          ev(18, 'task_done', { taskId: 't1', nodeId: 'n-reel' }),
          ev(19, 'contre_expertise', {
            taskId: 't1',
            resultId: 2,
            possible: true,
            relectures: ['r2'],
          }),
          ev(20, 'task_started', { taskId: 'r2', nodeId: 'n-codex' }),
        ],
      },
      {
        taches: [
          { id: 't1', status: 'done' },
          { id: 'r1', status: 'done' },
          { id: 'r2', status: 'done' },
        ],
        evenements: [ev(21, 'task_done', { taskId: 'r2', nodeId: 'n-codex' })],
      },
    ];
    const { ruche, appels } = laboratoire({
      noeuds: [
        { ...NOEUD_REEL, isolement: PODMAN },
        { ...NOEUD_CODEX, isolement: { niveau: 'processus' } },
      ],
      tours,
      lectures: {
        '/api/tasks/t1/results': [
          { nodeId: 'n-reel', success: true, diff: '+somme', resultId: 1 },
          { nodeId: 'n-reel', success: true, diff: '+somme corrigée', resultId: 2 },
        ],
        '/api/tasks/t1/evaluation': { decision: 'additional_test_required' },
      },
    });
    const issue = await menerLaPreuve(ruche, { creer: true, patienceS: 20 });

    expect(issue.ok, issue.raison).toBe(true);
    const lecture = appels.indexOf('lire:/api/tasks/t1/evaluation');
    expect(
      appels.slice(0, lecture).filter((a) => a === 'instantane'),
      'l’évaluation est lue après le dernier tour, pas au premier `done`',
    ).toHaveLength(tours.length);
    // Qui a exécuté : le producteur ET la relectrice — la vieille relecture
    // d'avant la preuve (`r-vieille`) n'y entre pas.
    expect(issue.faits.executants.map((n) => n.id)).toEqual(['n-reel', 'n-codex']);
    expect(issue.faits.executants[1].isolement).toEqual({ niveau: 'processus' });
  });

  it('RÉGLÉE, ELLE RASSEMBLE LES FAITS DE SA TÂCHE ET DU NŒUD QUI A PRODUIT', async () => {
    const { ruche, appels } = laboratoire({
      noeuds: [NOEUD_SIMULE, NOEUD_REEL],
      lectures: {
        '/api/tasks/t1/results': [
          { nodeId: 'n-sim', success: false, diff: '' },
          { nodeId: 'n-reel', success: true, diff: '+somme' },
        ],
        '/api/tasks/t1/routage': { affectations: [{ modele: 'sonnet' }] },
        '/api/tasks/t1/chronologie': { chronologie: { attenteWorkerMs: 1 } },
        '/api/tasks/t1/evaluation': { decision: 'human_review_required' },
        '/api/genome': { lignes: [] },
        '/api/workers': { workers: [] },
      },
    });
    const issue = await menerLaPreuve(ruche, { creer: true });

    expect(issue.ok).toBe(true);
    expect(issue.mode).toBe('mission');
    expect(issue.taskId).toBe('t1');
    expect(issue.faits.noeud?.id, 'le nœud de la production RÉUSSIE').toBe('n-reel');
    expect(issue.faits.tache).toEqual({ id: 't1', status: 'done' });
    expect(issue.faits.chronologie).toEqual({ attenteWorkerMs: 1 });
    expect(issue.faits.evaluation?.decision).toBe('human_review_required');
    expect(issue.livraisons, 'sans dépôt, rien n’est livré').toBeNull();
    expect(appels).toContain(`taches:p1:${MISSION.title}`);
    expect(appels).toContain('projet:nommé');
    expect(appels.some((a) => a.startsWith('livrer:'))).toBe(false);
  });

  it('SOUS --exige-bac, UNE OUVRIÈRE HORS CONTENEUR ARRÊTE TOUT AVANT DE DÉPENSER', async () => {
    const { ruche, appels } = laboratoire({
      noeuds: [
        { ...NOEUD_REEL, isolement: PODMAN },
        { ...NOEUD_CODEX, isolement: { niveau: 'processus' } },
        { ...NOEUD_REEL, id: 'n3', name: 'muet' },
        { ...NOEUD_REEL, id: 'n4', name: 'sans-moteur', isolement: { niveau: 'conteneur' } },
      ],
    });
    const issue = await menerLaPreuve(ruche, { creer: true, exigeBac: true });

    expect(issue.ok).toBe(false);
    expect(issue.raison).toContain(
      '--exige-bac : ces ouvrières réelles ne déclarent pas de bac conteneur — ' +
        'relectrice (processus), muet (bac non déclaré), sans-moteur (conteneur)',
    );
    expect(appels).toEqual(['instantane']);

    const isolees = laboratoire({ noeuds: [{ ...NOEUD_REEL, isolement: PODMAN }] });
    expect((await menerLaPreuve(isolees.ruche, { creer: true, exigeBac: true })).ok).toBe(true);
  });

  it('AVEC UN DÉPÔT, LE PROJET Y TRAVAILLE ET CHAQUE TÂCHE EST LIVRÉE — APRÈS le réglage', async () => {
    const { ruche, appels } = laboratoire({ lectures: GITHUB_PRET });
    const issue = await menerLaPreuve(ruche, {
      creer: true,
      depot: 'https://github.com/demo/hive.git',
    });

    expect(appels).toContain('projet:nommé:https://github.com/demo/hive.git');
    expect(appels.indexOf('livrer:t1')).toBeGreaterThan(
      appels.indexOf('lire:/api/tasks/t1/evaluation'),
    );
    expect(issue.livraisons).toEqual([
      { taskId: 't1', status: 201, corps: { pr: 7, branche: 'hive/t1', commitSha: 'c0ffee' } },
    ]);
  });

  it('SOUS --depot, UNE REINE QUI NE SAURAIT PAS LIVRER EST REFUSÉE AVANT DE DÉPENSER', async () => {
    // Sans jeton, `/api/livraison` rend 501 — mais seulement APRÈS la mission.
    const sansJeton = laboratoire({ lectures: { '/api/github/status': { configure: false } } });
    expect(
      await menerLaPreuve(sansJeton.ruche, {
        creer: true,
        depot: 'https://github.com/demo/hive.git',
      }),
    ).toEqual({
      ok: false,
      raison:
        '--depot : la Reine n’a pas de jeton GitHub — définissez HIVE_GITHUB_TOKEN dans son ' +
        'environnement et relancez-la, sinon aucune tâche ne serait livrée',
    });
    expect(sansJeton.appels, 'rien n’est créé').toEqual(['instantane', 'lire:/api/github/status']);

    // Une sonde illisible ne permet pas de promettre une livraison non plus.
    const muette = laboratoire();
    expect(
      (await menerLaPreuve(muette.ruche, { depot: 'https://github.com/demo/hive.git' })).raison,
    ).toBe('--depot : impossible de savoir si la Reine peut livrer (/api/github/status rend 404)');
  });

  it('AVEC UN DÉPÔT, LA SOUS-TÂCHE DÉLÉGUÉE EST LIVRÉE AUSSI — son diff ne revient au parent qu’en texte', async () => {
    const tours = [
      { taches: [] },
      {
        taches: [
          { id: 't1', status: 'running' },
          { id: 'enfant', status: 'running' },
        ],
        evenements: [
          ev(10, 'task_started', { taskId: 't1', nodeId: 'n-reel' }),
          ev(11, 'delegation_created', { parentTaskId: 't1', childTaskId: 'enfant' }),
          ev(12, 'task_started', { taskId: 'enfant', nodeId: 'n-codex' }),
        ],
      },
      {
        taches: [
          { id: 't1', status: 'done' },
          { id: 'enfant', status: 'done' },
        ],
        evenements: [
          ev(13, 'task_done', { taskId: 'enfant', nodeId: 'n-codex' }),
          ev(14, 'contre_expertise', { taskId: 'enfant', possible: false }),
          ev(15, 'task_done', { taskId: 't1', nodeId: 'n-reel' }),
          ev(16, 'contre_expertise', { taskId: 't1', possible: false }),
        ],
      },
    ];
    const { ruche, appels } = laboratoire({
      noeuds: [NOEUD_REEL, NOEUD_CODEX],
      tours,
      lectures: GITHUB_PRET,
    });
    const issue = await menerLaPreuve(ruche, {
      creer: true,
      depot: 'https://github.com/demo/hive.git',
    });

    expect(issue.ok, issue.raison).toBe(true);
    expect(appels.filter((a) => a.startsWith('livrer:'))).toEqual(['livrer:t1', 'livrer:enfant']);
    // L'enfant a tourné pour la mission : son nœud est l'un de ses exécutants.
    expect(issue.faits.executants.map((n) => n.id)).toEqual(['n-reel', 'n-codex']);
  });
  it('L’ESSAIM EXIGE ASSEZ D’OUVRIÈRES RÉELLES DE DEUX FAMILLES — et le dit avant de dépenser', async () => {
    const trop = laboratoire({ noeuds: [NOEUD_REEL, NOEUD_CODEX, NOEUD_SIMULE] });
    const issue = await menerLaPreuve(trop.ruche, { creer: true, ouvrieres: 3 });
    expect(issue.raison).toBe(
      '--workers 3 : il faut 3 ouvrières réelles en ligne de 2 familles au moins ; ' +
        'en ligne : 2 de 2 famille(s) — poste (claude-code), relectrice (codex)',
    );
    expect(trop.appels).toEqual(['instantane']);

    const uneFamille = laboratoire({
      noeuds: [NOEUD_REEL, { ...NOEUD_REEL, id: 'n2' }, { ...NOEUD_REEL, id: 'n3' }],
    });
    const refus = await menerLaPreuve(uneFamille.ruche, { creer: true, ouvrieres: 3 });
    expect(refus.raison).toContain('en ligne : 3 de 1 famille(s)');

    // Deux familles, mais aucune dont l'adaptateur porte le pont : la tâche
    // qui délègue ne pourrait que tomber à côté.
    const sansPont = laboratoire({
      noeuds: [
        { id: 'k1', name: 'k1', agentType: 'cursor', status: 'online' },
        { id: 'k2', name: 'k2', agentType: 'cline', status: 'online' },
        { id: 'k3', name: 'k3', agentType: 'cursor', status: 'online' },
      ],
    });
    expect((await menerLaPreuve(sansPont.ruche, { ouvrieres: 3 })).raison).toBe(
      '--workers 3 : aucune ouvrière en ligne dont l’adaptateur porte le pont de délégation ' +
        '(claude-code, codex) — la délégation serait impossible ; en ligne : ' +
        'k1 (cursor), k2 (cline), k3 (cursor)',
    );

    // Une seule en porte un : le plan le dit avant de dépenser.
    const mixte = laboratoire({
      noeuds: [
        NOEUD_REEL,
        { id: 'k1', name: 'k1', agentType: 'cursor', status: 'online' },
        { id: 'k2', name: 'k2', agentType: 'cline', status: 'online' },
      ],
    });
    expect((await menerLaPreuve(mixte.ruche, { ouvrieres: 3 })).message).toContain(
      'La tâche qui délègue peut échoir à k1 (cursor), k2 (cline), sans pont de délégation',
    );
  });

  it('SOUS --exige-bac, LE NŒUD ARRIVÉ EN COURS DE ROUTE QUI PREND LA SOUS-TÂCHE EST JUGÉ AUSSI', async () => {
    // Tous en conteneur au départ : la vérification d'avant la mission passe.
    // Puis un nœud hors bac rejoint la ruche, et c'est lui qui exécute
    // l'enfant délégué — un agent lancé pour la mission, hors du bac.
    const noeuds = [
      { ...NOEUD_REEL, id: 'n-a', name: 'alpha', isolement: PODMAN },
      { ...NOEUD_CODEX, id: 'n-b', name: 'beta', isolement: PODMAN },
      { ...NOEUD_REEL, id: 'n-c', name: 'gamma', isolement: PODMAN },
    ];
    const tardive = {
      ...NOEUD_REEL,
      id: 'n-t',
      name: 'tardive',
      isolement: { niveau: 'processus' },
    };
    const confiees = ['t1', 't2', 't3', 't4'].map((id) => ({
      id,
      status: 'done',
      projectId: 'p1',
    }));
    const tours = [
      { taches: [] },
      {
        noeuds: [...noeuds, tardive],
        taches: [...confiees, { id: 'v2a-g1-double', status: 'running', projectId: 'p1' }],
        evenements: [
          ev(10, 'task_started', { taskId: 't4', nodeId: 'n-a' }),
          ev(11, 'delegation_created', { parentTaskId: 't4', childTaskId: 'v2a-g1-double' }),
          ev(12, 'task_started', { taskId: 'v2a-g1-double', nodeId: 'n-t' }),
          ...confiees.map((t, i) => ev(13 + i, 'task_done', { taskId: t.id, nodeId: 'n-a' })),
        ],
      },
      {
        noeuds: [...noeuds, tardive],
        taches: [...confiees, { id: 'v2a-g1-double', status: 'done', projectId: 'p1' }],
        evenements: [ev(20, 'task_done', { taskId: 'v2a-g1-double', nodeId: 'n-t' })],
      },
    ];
    const { ruche } = laboratoire({ noeuds, tours });
    const issue = await menerLaPreuve(ruche, {
      creer: true,
      exigeBac: true,
      ouvrieres: 3,
      graine: 'g1',
    });

    expect(issue.ok, issue.raison).toBe(true);
    const deleguante = issue.missions[3].faits;
    expect(deleguante.executants.map((n) => n.id)).toEqual(['n-a', 'n-t']);
    expect(jugerV2Alpha(deleguante).find((v) => v.critere === 'A-bac')).toMatchObject({
      etat: 'echec',
      detail: 'tardive « processus » seulement — pas un conteneur',
    });
    const conclusion = conclurePreuve(issue, { exigeBac: true });
    expect(conclusion.prouve).toBe(false);
    expect(conclusion.texte).toMatch(/✘ A-bac\s+Bac à sable — tardive « processus »/);
  });

  it('UN NŒUD EST JUGÉ SUR LE BAC LE PLUS FAIBLE QU’IL A DÉCLARÉ PENDANT LA MISSION — pas sur le dernier', async () => {
    // Le poste se réinscrit hors du bac le temps d'exécuter, puis revient en
    // conteneur avant le dernier relevé.
    const hors = { ...NOEUD_REEL, isolement: { niveau: 'processus' } };
    const tours = TOURS_SIMPLES.map((t, i) => (i === 2 ? { ...t, noeuds: [hors] } : t));
    const { ruche } = laboratoire({ noeuds: [{ ...NOEUD_REEL, isolement: PODMAN }], tours });
    const issue = await menerLaPreuve(ruche, { creer: true });

    expect(issue.faits.executants).toEqual([{ ...NOEUD_REEL, isolement: { niveau: 'processus' } }]);
    expect(jugerV2Alpha(issue.faits).find((v) => v.critere === 'A-bac')?.etat).toBe('echec');

    const bwrap = { niveau: 'conteneur', fournisseur: 'bubblewrap' };
    expect(bacLePlusFaible([PODMAN, bwrap]), 'tout en conteneur : la dernière').toEqual(bwrap);
    expect(bacLePlusFaible([PODMAN, null]), 'un relevé muet rend le bac inconnu').toBeNull();
    expect(bacLePlusFaible([PODMAN, { niveau: 'conteneur' }])).toEqual({ niveau: 'conteneur' });
    expect(bacLePlusFaible([null, { niveau: 'processus' }])).toEqual({ niveau: 'processus' });
    expect(bacLePlusFaible([])).toBeNull();
  });

  it('L’ESSAIM CONFIE UN SEUL LOT, ATTEND AUSSI LA SOUS-TÂCHE DÉLÉGUÉE, ET REND LES FAITS DE CHAQUE TÂCHE', async () => {
    const noeuds = [NOEUD_REEL, NOEUD_CODEX, { ...NOEUD_REEL, id: 'n3', name: 'troisieme' }];
    const confiees = ['t1', 't2', 't3', 't4'].map((id) => ({
      id,
      status: 'done',
      projectId: 'p1',
    }));
    const tours = [
      { taches: [] },
      {
        taches: [...confiees, { id: 'v2a-g1-double', status: 'running', projectId: 'p1' }],
        evenements: [
          ev(10, 'delegation_created', { parentTaskId: 't4', childTaskId: 'v2a-g1-double' }),
          ...confiees.map((t, i) => ev(11 + i, 'task_done', { taskId: t.id })),
        ],
      },
      {
        taches: [
          ...confiees,
          { id: 'v2a-g1-double', status: 'done', projectId: 'p1' },
          { id: 'ailleurs', status: 'done', projectId: 'autre' },
        ],
        evenements: [ev(20, 'task_done', { taskId: 'v2a-g1-double' })],
      },
    ];
    const { ruche, appels } = laboratoire({ noeuds, tours });
    const issue = await menerLaPreuve(ruche, { creer: true, ouvrieres: 3, graine: 'g1' });

    expect(issue.ok, issue.raison).toBe(true);
    expect(issue.mode).toBe('essaim');
    expect(appels.filter((a) => a.startsWith('taches:'))).toEqual([
      'taches:p1:Preuve V2 Alpha — ajoute1|Preuve V2 Alpha — ajoute2|' +
        'Preuve V2 Alpha — ajoute3|Preuve V2 Alpha — délégation',
    ]);
    expect(
      appels.filter((a) => a === 'instantane'),
      'la sous-tâche en vol retient la relecture d’un tour',
    ).toHaveLength(3);
    expect(issue.missions.map((m) => [m.taskId, m.role])).toEqual([
      ['t1', 'independante'],
      ['t2', 'independante'],
      ['t3', 'independante'],
      ['t4', 'deleguante'],
    ]);
    expect(issue.missions[3].faits.attendu.test('+++ b/delegation-g1.md')).toBe(true);
    expect(issue.essaim.productions).toEqual(['t1', 't2', 't3', 't4', 'v2a-g1-double']);
    expect(issue.essaim.independantes).toEqual(['t1', 't2', 't3']);
    expect(issue.essaim.deleguante).toBe('t4');
    expect(issue.essaim.requis).toBe(3);
    expect(
      issue.essaim.taches.map((t) => t.id),
      'seules les tâches du projet de la mission',
    ).not.toContain('ailleurs');
  });

  it('LES MISSIONS DE L’ESSAIM : UN FICHIER PAR TÂCHE, ET LA DÉLÉGATION NOMME LES OUTILS DU PONT', () => {
    const missions = missionsEssaim(3, 'abc123');

    expect(missions).toHaveLength(4);
    expect(
      missions.slice(0, 3).map((m, i) => m.attendu.test(`+export const ajoute${i + 1} = (x) =>`)),
    ).toEqual([true, true, true]);
    expect(missions[0].attendu.test('+ajoute12'), 'ajoute1 n’est pas ajoute12').toBe(false);
    // Le script tourne en Node nu : il recopie les noms, ce banc les tient égaux.
    expect([OUTIL_DELEGUER, OUTIL_ATTENDRE]).toEqual([HIVE_DELEGATE_TOOL, HIVE_WAIT_TOOL]);
    const deleguante = missions[3].tache.prompt;
    expect(deleguante).toContain(`\`${OUTIL_DELEGUER}\` avec childTaskId « v2a-abc123-double »`);
    expect(deleguante).toContain(`\`${OUTIL_ATTENDRE}\` (childTaskId « v2a-abc123-double »)`);
    // Le lot est posté tel quel : la route refuse toute clé en plus.
    expect(Object.keys(missions[3].tache).sort()).toEqual(['prompt', 'title']);
  });

  it('LES OUVRIÈRES RÉELLES : EN LIGNE, ET PAS UNE SIMULATION', () => {
    expect(
      ouvrieresReelles({
        nodes: [NOEUD_REEL, NOEUD_SIMULE, { ...NOEUD_REEL, id: 'x', status: 'offline' }],
      }).map((n) => n.id),
    ).toEqual(['n-reel']);
    expect(ouvrieresReelles(null)).toEqual([]);
  });

  it('UNE OUVRIÈRE DONT LE NŒUD DIT SON AGENT NON CONNECTÉ N’EST PAS RÉELLE', () => {
    // La preuve V2 Alpha comptait « preuve-v2-cursor (cursor) » parmi ses
    // ouvrières réelles, alors que `cursor-agent status` disait « Not logged in ».
    const cursor = {
      id: 'n-cursor',
      name: 'poste-cursor',
      agentType: 'cursor',
      status: 'online',
      outils: [{ agent: 'cursor', binaire: true, cle: 'absente' }],
    };
    // Le constat d'un AUTRE agent du poste ne compte pas : seul le sien.
    const reel = { ...NOEUD_REEL, outils: [{ agent: 'cursor', binaire: true, cle: 'absente' }] };
    expect(ouvrieresReelles({ nodes: [cursor, reel] }).map((n) => n.id)).toEqual(['n-reel']);
  });
});

describe('preuve V2 Alpha — les arguments', () => {
  it('UN DRAPEAU INCONNU OU MAL ÉCRIT ARRÊTE TOUT — une exigence ignorée serait prouvée par accident', () => {
    expect(argumentsDeLaPreuve(['--racine', '.', '--exige-bacs'])).toEqual({
      erreur: 'argument inconnu : --exige-bacs',
    });
    expect(argumentsDeLaPreuve(['--racine', '.', 'oui'])).toEqual({
      erreur: 'argument inconnu : oui',
    });
    expect(argumentsDeLaPreuve(['--racine', '--oui'])).toEqual({
      erreur: '--racine attend une valeur',
    });
    expect(argumentsDeLaPreuve(['--oui'])).toEqual({ erreur: '--racine est obligatoire' });
  });

  it('--workers ET --patience SONT BORNÉS, ET RIEN N’EST EXIGÉ QUI N’A ÉTÉ DEMANDÉ', () => {
    expect(argumentsDeLaPreuve(['--racine', '.'])).toEqual({
      racine: '.',
      creer: false,
      exigeBac: false,
      ouvrieres: 0,
      depot: null,
    });
    expect(
      argumentsDeLaPreuve([
        '--racine',
        '/r',
        '--oui',
        '--workers',
        '3',
        '--exige-bac',
        '--depot',
        'https://github.com/demo/hive.git',
        '--patience',
        '60',
      ]),
    ).toEqual({
      racine: '/r',
      creer: true,
      exigeBac: true,
      ouvrieres: 3,
      depot: 'https://github.com/demo/hive.git',
      patienceS: 60,
    });
    for (const n of ['2', '9', '3.5', 'trois']) {
      expect(argumentsDeLaPreuve(['--racine', '.', '--workers', n]), n).toEqual({
        erreur: '--workers attend un entier de 3 à 8',
      });
    }
    expect(argumentsDeLaPreuve(['--racine', '.', '--patience', '0'])).toEqual({
      erreur: '--patience attend un nombre de secondes positif',
    });
  });

  it('--depot N’ACCEPTE QUE CE QUE LA REINE SAIT LIVRER — refusé avant la moindre requête', () => {
    const refus = {
      erreur:
        '--depot attend l’URL https d’un dépôt GitHub (https://github.com/<owner>/<repo>) : ' +
        'la Reine ne livre que là',
    };
    for (const url of [
      'git@github.com:demo/hive.git',
      'https://gitlab.com/demo/hive',
      'http://github.com/demo/hive',
      'https://github.com/demo/hive/tree/main',
      '/srv/depots/hive',
    ]) {
      expect(argumentsDeLaPreuve(['--racine', '.', '--depot', url]), url).toEqual(refus);
    }
    expect(
      argumentsDeLaPreuve(['--racine', '.', '--depot', 'https://moi:jeton@github.com/demo/hive'])
        .depot,
      'un dépôt privé cloné avec ses identifiants reste livrable',
    ).toBe('https://moi:jeton@github.com/demo/hive');
  });

  it('LA RÈGLE DU DÉPÔT EST CELLE DE LA LIVRAISON — recopiée, et tenue égale à l’original', () => {
    for (const url of [
      'https://github.com/demo/hive.git',
      'https://www.github.com/demo/hive',
      'https://moi:jeton@github.com/demo/hive.git',
      'git@github.com:demo/hive.git',
      'https://gitlab.com/demo/hive',
      'http://github.com/demo/hive',
      'https://github.com/demo',
      'https://github.com/demo/hive/tree/main',
      'https://github.com/de..mo/hive',
      'https://github.com/demo/hi ve',
      '/srv/depots/hive',
      'pas une url',
    ]) {
      expect(depotGithub(url), url).toBe(depotDepuisUrl(url));
    }
  });
});
