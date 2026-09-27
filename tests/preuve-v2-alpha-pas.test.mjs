// LA SÉQUENCE DE LA PREUVE V2 ALPHA — pilotée par une ruche de laboratoire.
//
// La séquence ne juge rien ; elle doit : refuser sans ouvrière réelle, ne RIEN
// créer sans `creer`, dire chaque refus de la ruche, ne pas conclure avant la
// fin, et rassembler les faits de la BONNE tâche et du BON nœud.

import { describe, expect, it } from 'vitest';
import { MISSION, menerLaPreuve, ouvrieresReelles } from '../scripts/preuve-v2-alpha-pas.mjs';

const NOEUD_REEL = { id: 'n-reel', name: 'poste', agentType: 'claude-code', status: 'online' };
const NOEUD_SIMULE = { id: 'n-sim', name: 'banc', agentType: 'shell', status: 'online' };

/** Une ruche de laboratoire : chaque appel est journalisé, chaque réponse réglable. */
function laboratoire({
  noeuds = [NOEUD_REEL],
  projet = { status: 201, corps: { id: 'p1' } },
  tache = { status: 201, corps: [{ id: 't1' }] },
  statuts = ['assigned', 'running', 'done'],
  lectures = {},
} = {}) {
  const appels = [];
  let tour = 0;
  return {
    appels,
    ruche: {
      instantane: async () => {
        appels.push('instantane');
        const statut = statuts[Math.min(tour++, statuts.length - 1)];
        return {
          status: 200,
          corps: {
            nodes: noeuds,
            tasks:
              tour > 1
                ? [
                    { id: 't-autre', status: 'done' },
                    { id: 't1', status: statut },
                  ]
                : [],
          },
        };
      },
      creerProjet: async (corps) => {
        appels.push(`projet:${corps.name.startsWith('Preuve V2 Alpha') ? 'nommé' : corps.name}`);
        return projet;
      },
      creerTache: async (projetId, mission) => {
        appels.push(`tache:${projetId}:${mission.title}`);
        return tache;
      },
      lire: async (chemin) => {
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
  });

  it('UN PROJET OU UNE MISSION REFUSÉS SONT DITS — avec le statut', async () => {
    const projetRefuse = laboratoire({ projet: { status: 403, corps: null, texte: 'interdit' } });
    expect(await menerLaPreuve(projetRefuse.ruche, { creer: true })).toEqual({
      ok: false,
      raison: 'la ruche refuse le projet (403) : interdit',
    });

    const missionRefusee = laboratoire({ tache: { status: 400, corps: null, texte: 'invalide' } });
    expect(await menerLaPreuve(missionRefusee.ruche, { creer: true })).toEqual({
      ok: false,
      raison: 'la ruche refuse la mission (400) : invalide',
    });
  });

  it('ELLE NE CONCLUT PAS AVANT LA FIN — une mission interminable est dite telle', async () => {
    const { ruche } = laboratoire({ statuts: ['running'] });
    expect(await menerLaPreuve(ruche, { creer: true, patienceS: 3 })).toEqual({
      ok: false,
      raison: 'la mission t1 n’est pas terminée après 3 s',
    });
  });

  it('TERMINÉE, ELLE RASSEMBLE LES FAITS DE SA TÂCHE ET DU NŒUD QUI A PRODUIT', async () => {
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
    expect(issue.taskId).toBe('t1');
    expect(issue.faits.noeud?.id, 'le nœud de la production RÉUSSIE').toBe('n-reel');
    expect(issue.faits.tache).toEqual({ id: 't1', status: 'done' });
    expect(issue.faits.chronologie).toEqual({ attenteWorkerMs: 1 });
    expect(issue.faits.evaluation?.decision).toBe('human_review_required');
    expect(appels).toContain(`tache:p1:${MISSION.title}`);
    expect(appels).toContain('projet:nommé');
  });

  it('LES OUVRIÈRES RÉELLES : EN LIGNE, ET PAS UNE SIMULATION', () => {
    expect(
      ouvrieresReelles({
        nodes: [NOEUD_REEL, NOEUD_SIMULE, { ...NOEUD_REEL, id: 'x', status: 'offline' }],
      }).map((n) => n.id),
    ).toEqual(['n-reel']);
    expect(ouvrieresReelles(null)).toEqual([]);
  });
});
