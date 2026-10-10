// Tests de validation du protocole WebSocket : les messages malformés ou
// malveillants sont rejetés, les champs inconnus ne sont jamais propagés.

import { describe, expect, it } from 'vitest';
import {
  assignationIllisible,
  isValidLocalRepoPath,
  isValidRemoteRepoUrl,
  isValidRepoUrl,
  isValidTask,
  LIMITS,
  motifDepotIllisible,
  parseClientMessage,
  parseServerMessage,
} from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

const validTask: Task = {
  id: 'tache-1',
  projectId: 'projet-1',
  title: 'Titre',
  prompt: 'faire',
  status: 'assigned',
  dependsOn: [],
  assignedNodeId: 'n1',
  result: null,
  branch: 'hive/tache-1',
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
};

const register = {
  type: 'register',
  token: 'jeton',
  name: 'noeud',
  ownerName: 'membre',
  agentType: 'shell',
  maxConcurrency: 2,
};

describe('parseClientMessage', () => {
  it('accepte un register valide et ne conserve que les champs connus', () => {
    const msg = parseClientMessage(JSON.stringify({ ...register, injecte: 'nope' }));
    expect(msg).not.toBeNull();
    expect(msg).not.toHaveProperty('injecte');
    expect(msg?.type).toBe('register');
  });

  it('rejette JSON invalide, tableaux, non-chaînes et types inconnus', () => {
    expect(parseClientMessage('pas du json')).toBeNull();
    expect(parseClientMessage('[1,2]')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage(42 as unknown as string)).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'hack' }))).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('rejette un register invalide (bornes, types, identifiants)', () => {
    expect(parseClientMessage(JSON.stringify({ ...register, maxConcurrency: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, maxConcurrency: 999 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, maxConcurrency: '2' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, token: '' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, name: 'x'.repeat(200) }))).toBeNull();
    // Un nodeId ne peut pas contenir de caractères de chemin (anti-traversal).
    expect(parseClientMessage(JSON.stringify({ ...register, nodeId: '../evil' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...register, nodeId: 'a/b' }))).toBeNull();
  });

  it('accepte les modèles déclarés par un nœud, et les conserve', () => {
    // Le champ que l'Aiguillage appris consomme : les modèles qu'un nœud sait
    // faire tourner. On vérifie qu'ils passent ET qu'ils ressortent intacts —
    // un champ accepté mais silencieusement jeté ne servirait à personne.
    const msg = parseClientMessage(
      JSON.stringify({ ...register, modeles: ['claude-opus-5', 'claude-fable-5'] }),
    );
    expect(msg).not.toBeNull();
    expect(msg).toMatchObject({ modeles: ['claude-opus-5', 'claude-fable-5'] });

    // PILE À LA BORNE. Le refus au-dessus (17) est déjà éprouvé plus bas ; le
    // côté ACCEPTÉ du seuil ne l'était nulle part. Sans lui, la garde
    // `v.length <= LIMITS.modeles` se resserre en `<` sans qu'aucun banc rougisse
    // — un nœud qui déclare EXACTEMENT LIMITS.modeles modèles serait refusé, et
    // sa liste (peut-être son meilleur modèle en queue) tomberait avec le message.
    const pileALaBorne = Array.from({ length: LIMITS.modeles }, (_, i) => `m${String(i)}`);
    const auBord = parseClientMessage(JSON.stringify({ ...register, modeles: pileALaBorne }));
    expect(auBord, 'une liste pile à la borne est acceptée').not.toBeNull();
    expect(auBord).toMatchObject({ modeles: pileALaBorne });
  });

  it('LES EFFORTS DÉCLARÉS : connus et sans doublon, ou le register ENTIER tombe', () => {
    // Un effort qu'aucun CLI ne connaît, commandé par l'Aiguillage, brûlerait
    // la tentative sans verdict : même sévérité que `modeles`.
    const efforts = (e: unknown) => parseClientMessage(JSON.stringify({ ...register, efforts: e }));
    expect(efforts(['low', 'max'])).toMatchObject({ efforts: ['low', 'max'] });
    expect(efforts([]), 'liste vide').toBeNull();
    expect(efforts(['turbo']), 'niveau inconnu').toBeNull();
    expect(efforts(['low', 'low']), 'doublon').toBeNull();
    expect(efforts('low'), 'pas un tableau').toBeNull();
    expect(parseClientMessage(JSON.stringify(register))).not.toHaveProperty('efforts');
  });

  it('un register SANS modèles reste valide — aucun nœud n’est forcé de les déclarer', () => {
    // Compatibilité : un nœud d'avant l'Aiguillage, ou un agent à modèle unique,
    // n'envoie rien. Le hub ne doit pas le refuser, ni inventer une liste.
    const msg = parseClientMessage(JSON.stringify(register));
    expect(msg).not.toBeNull();
    expect(msg).not.toHaveProperty('modeles');
  });

  it('rejette une liste de modèles malformée — le message ENTIER tombe', () => {
    // Même sévérité que `plateforme` : un champ optionnel mal formé est un
    // client qui ment ou qui bogue. On refuse tout plutôt que de garder une
    // moitié de vérité que l'Aiguillage prendrait pour argent comptant.
    const modeles = (m: unknown) => JSON.stringify({ ...register, modeles: m });
    expect(parseClientMessage(modeles('claude-opus-5')), 'pas un tableau').toBeNull();
    expect(parseClientMessage(modeles([])), 'liste vide').toBeNull();
    expect(parseClientMessage(modeles([''])), 'un nom vide').toBeNull();
    expect(parseClientMessage(modeles(['ok', 42])), 'un élément non-chaîne').toBeNull();
    expect(parseClientMessage(modeles(['x'.repeat(200)])), 'un nom démesuré').toBeNull();
    expect(
      parseClientMessage(modeles(Array.from({ length: 17 }, (_, i) => `m${String(i)}`))),
      'trop de modèles (borne à 16)',
    ).toBeNull();
  });

  it('rejette task_update et task_result malformés', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'task_update', taskId: 'a b', status: 'running' })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: 'task_update', taskId: 't1', status: 'done' })),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'task_update',
          taskId: 't1',
          status: 'running',
          subAgents: [{ id: 'x', name: '', status: 'running' }],
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't1',
          success: 'oui',
          diff: '',
          logs: '',
          durationMs: 1,
          subAgents: [],
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't1',
          success: true,
          diff: '',
          logs: '',
          durationMs: -1,
          subAgents: [],
        }),
      ),
    ).toBeNull();
  });

  it('rejette un message dépassant la taille maximale', () => {
    const big = JSON.stringify({
      type: 'task_result',
      taskId: 't1',
      success: true,
      diff: 'x'.repeat(LIMITS.message),
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    expect(parseClientMessage(big)).toBeNull();
  });

  it('accepte un task_result valide aux limites', () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: 'task_result',
        taskId: 't-1_A',
        success: false,
        diff: '',
        logs: 'journal',
        durationMs: 0,
        subAgents: [{ id: 'sa1', name: 'ouvrière', status: 'done' }],
      }),
    );
    expect(msg?.type).toBe('task_result');
  });

  it('les ressources de l’AGENT : les deux formes, et une mesure fausse tombe seule', () => {
    const resultat = (mesure: Record<string, unknown>) =>
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't-usage',
          success: true,
          diff: '',
          logs: '',
          durationMs: 12,
          subAgents: [],
          ...mesure,
        }),
      );
    for (const ressources of [
      { portee: 'arbre', releves: 7, cpuMs: 1_234, picOctets: 512 * 1024 * 1024, memoire: 'pss' },
      { portee: 'arbre', releves: 2, cpuMs: 9, picOctets: 700, memoire: 'somme_rss' },
      { portee: 'arbre', releves: 3, cpuMs: 10 },
      { portee: 'conteneur', releves: 2, cpuMs: 80, picOctets: 9_000, memoire: 'noyau' },
      { portee: 'conteneur', releves: 1, picOctets: 9_000, memoire: 'moteur' },
      { portee: 'aucune', raison: 'plateforme' },
    ]) {
      expect(resultat({ ressources }), JSON.stringify(ressources)).toMatchObject({
        type: 'task_result',
        ressources,
      });
    }

    // Un nœud d'avant envoyait `usage` : les compteurs de SON processus Node.
    // Accepté — le résultat ne se perd pas —, mais jamais pris pour l'agent.
    const usage = {
      userCpuMicros: 12_000,
      systemCpuMicros: 3_000,
      maxRssBytes: 8 * 1024 * 1024,
      rssBytes: 6 * 1024 * 1024,
      heapUsedBytes: 3 * 1024 * 1024,
    };
    const ancien = resultat({ usage });
    expect(ancien).toMatchObject({
      type: 'task_result',
      ressources: { portee: 'aucune', raison: 'noeud_ancien' },
    });
    expect(ancien && 'usage' in ancien).toBe(false);

    // Hors contrat : la mesure tombe, le résultat reste (une tâche pendue
    // pour une mesure serait pire que la mesure absente).
    for (const mesure of [
      { usage: { ...usage, rssBytes: -1 } },
      { ressources: { portee: 'arbre', releves: 0, cpuMs: 1 } },
      { ressources: { portee: 'arbre', releves: 1 } },
      { ressources: { portee: 'arbre', releves: 1, cpuMs: -5 } },
      // Une mémoire sans dire laquelle, ou l'inverse, ou une que sa portée ne lit pas.
      { ressources: { portee: 'arbre', releves: 1, picOctets: 9 } },
      { ressources: { portee: 'arbre', releves: 1, cpuMs: 5, memoire: 'pss' } },
      { ressources: { portee: 'arbre', releves: 1, picOctets: 9, memoire: 'noyau' } },
      { ressources: { portee: 'conteneur', releves: 1, picOctets: 9, memoire: 'pss' } },
      { ressources: { portee: 'arbre', releves: 1, picOctets: 9, memoire: 'vss' } },
      { ressources: { portee: 'noeud', releves: 1, cpuMs: 5 } },
      { ressources: { portee: 'aucune', raison: 'flemme' } },
      { ressources: { portee: 'arbre', releves: 1, picOctets: 2 ** 51, memoire: 'pss' } },
    ]) {
      const msg = resultat(mesure);
      expect(msg?.type, JSON.stringify(mesure)).toBe('task_result');
      expect(msg && 'ressources' in msg, JSON.stringify(mesure)).toBe(false);
    }
  });

  it('delegation_result : la mesure de l’enfant, sous les deux formes', () => {
    const resultat = (mesure: Record<string, unknown>) =>
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_result',
          parentTaskId: 'parent-1',
          childTaskId: 'enfant-1',
          success: true,
          diff: '',
          logs: '',
          durationMs: 10,
          ...mesure,
        }),
      );
    const ressources = {
      portee: 'arbre',
      releves: 2,
      cpuMs: 300,
      picOctets: 1_000,
      memoire: 'pss',
    };
    expect(resultat({ ressources })).toMatchObject({ ressources });
    expect(
      resultat({
        usage: {
          userCpuMicros: 1,
          systemCpuMicros: 1,
          maxRssBytes: 1,
          rssBytes: 1,
          heapUsedBytes: 1,
        },
      }),
    ).toMatchObject({ ressources: { portee: 'aucune', raison: 'noeud_ancien' } });
    const faux = resultat({ ressources: { portee: 'arbre', releves: -1, cpuMs: 1 } });
    expect(faux?.type, 'un parent qui perdrait son enfant attendrait jusqu’à l’échéance').toBe(
      'delegation_result',
    );
    expect(faux && 'ressources' in faux).toBe(false);
  });

  it('garde la déclaration fournisseur valide, et abandonne un champ faux sans perdre le résultat', () => {
    const resultat = (fournisseur: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't-cout',
          success: true,
          diff: '',
          logs: '',
          durationMs: 12,
          subAgents: [],
          fournisseur,
        }),
      );
    const declaration = {
      source: 'claude-code',
      coutUsd: 0.0421,
      dureeApiMs: 7_250,
      modeles: ['claude-sonnet-4-5-20250929'],
      jetonsEntree: 12_012,
      jetonsSortie: 850,
    };
    expect(resultat(declaration)).toMatchObject({ type: 'task_result', fournisseur: declaration });

    // Champ par champ : un coût négatif, un nom de modèle avec espace, des
    // jetons fractionnaires sont abandonnés ; le reste de la déclaration tient.
    expect(
      resultat({
        source: 'claude-code',
        coutUsd: -3,
        dureeApiMs: 400,
        modeles: ['ok-model', 'nom avec espace', 42],
        jetonsEntree: 1.5,
      }),
    ).toMatchObject({
      fournisseur: { source: 'claude-code', dureeApiMs: 400, modeles: ['ok-model'] },
    });

    // Une déclaration illisible ne fait jamais rejeter le travail du Worker.
    for (const faux of ['0.04 $', { source: 'Pas Une Source', coutUsd: 1 }, { source: 'x' }]) {
      const msg = resultat(faux);
      expect(msg?.type, JSON.stringify(faux)).toBe('task_result');
      expect(msg).not.toHaveProperty('fournisseur');
    }
    // Bornée : pas plus de huit modèles.
    const beaucoup = Array.from({ length: 12 }, (_, i) => `m-${i}`);
    expect(
      (
        resultat({ source: 'claude-code', modeles: beaucoup }) as {
          fournisseur?: { modeles?: string[] };
        }
      )?.fournisseur?.modeles,
    ).toHaveLength(8);
  });

  it('transporte le texte final, et abandonne un texte malformé SANS perdre le résultat', () => {
    // Le texte final est ce que la contre-expertise et le Conseil lisent. Un
    // texte illisible ne doit jamais coûter la production du Worker : il est
    // abandonné, et son absence se voit (« aucune réponse finale »).
    const resultat = (finalText: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't-texte',
          success: true,
          diff: '',
          logs: '',
          durationMs: 12,
          subAgents: [],
          finalText,
        }),
      );
    expect(resultat('conteste\n- une objection')).toMatchObject({
      type: 'task_result',
      finalText: 'conteste\n- une objection',
    });
    expect(resultat('x'.repeat(LIMITS.finalText))).toHaveProperty('finalText');
    for (const faux of ['x'.repeat(LIMITS.finalText + 1), '   \n ', 42, { texte: 'valide' }]) {
      const msg = resultat(faux);
      expect(msg?.type, String(faux).slice(0, 20)).toBe('task_result');
      expect(msg).not.toHaveProperty('finalText');
    }
  });

  it('task_reject : « avant l’agent » ne voyage qu’avec un refus d’infrastructure', () => {
    const refus = (extra: Record<string, unknown>) =>
      parseClientMessage(
        JSON.stringify({ type: 'task_reject', taskId: 't1', reason: 'clone', ...extra }),
      );
    expect(refus({ infra: true, avantAgent: true })).toEqual({
      type: 'task_reject',
      taskId: 't1',
      reason: 'clone',
      infra: true,
      avantAgent: true,
    });
    expect(refus({ avantAgent: true })).not.toHaveProperty('avantAgent');
    expect(refus({ infra: true, avantAgent: 'oui' })).toBeNull();
  });

  it('task_reject : « illisible » ne voyage qu’avec un refus avant l’agent', () => {
    // Ce n'est pas une panne : la température et les fantômes l'écartent. Sans
    // `avantAgent`, rien ne dit qu'aucun agent n'a tourné — le drapeau tombe.
    const refus = (extra: Record<string, unknown>) =>
      parseClientMessage(
        JSON.stringify({ type: 'task_reject', taskId: 't1', reason: 'illisible', ...extra }),
      );
    expect(refus({ infra: true, avantAgent: true, illisible: true })).toEqual({
      type: 'task_reject',
      taskId: 't1',
      reason: 'illisible',
      infra: true,
      avantAgent: true,
      illisible: true,
    });
    expect(refus({ infra: true, illisible: true })).not.toHaveProperty('illisible');
    expect(refus({ illisible: true })).not.toHaveProperty('illisible');
    expect(refus({ infra: true, avantAgent: true, illisible: 'oui' })).toBeNull();
  });

  it('accepte task_reject et register avec activeTasks, rejette les invalides', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'task_reject', taskId: 't1', reason: 'sature' }))
        ?.type,
    ).toBe('task_reject');
    expect(
      parseClientMessage(JSON.stringify({ type: 'task_reject', taskId: 'a b', reason: 'x' })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ ...register, activeTasks: ['t1', 't2'] }))?.type,
    ).toBe('register');
    // Un activeTasks contenant un id invalide fait rejeter tout le register.
    expect(
      parseClientMessage(JSON.stringify({ ...register, activeTasks: ['../evil'] })),
    ).toBeNull();
  });

  it('valide une demande de délégation Worker bornée et reconstruit ses champs', () => {
    const delegation = {
      type: 'delegate_task',
      requestId: 'req-1',
      childTaskId: 'child-1',
      parentTaskId: 'parent-1',
      reason: 'séparer la vérification de sécurité',
      title: 'Vérifier la sécurité',
      prompt: 'Analyse les chemins sensibles et rapporte les preuves.',
      durationMs: 60_000,
      costMicros: 100_000,
      resourceUnits: 1,
      preferredAgent: 'codex',
      preferredModel: 'modele-explore',
      injecte: 'ignoré',
    };
    expect(parseClientMessage(JSON.stringify(delegation))).toEqual({
      type: 'delegate_task',
      requestId: 'req-1',
      childTaskId: 'child-1',
      parentTaskId: 'parent-1',
      reason: 'séparer la vérification de sécurité',
      title: 'Vérifier la sécurité',
      prompt: 'Analyse les chemins sensibles et rapporte les preuves.',
      durationMs: 60_000,
      costMicros: 100_000,
      resourceUnits: 1,
      preferredAgent: 'codex',
      preferredModel: 'modele-explore',
    });
    expect(
      parseClientMessage(JSON.stringify({ ...delegation, childTaskId: '../evil' })),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ ...delegation, durationMs: LIMITS.delegationDurationMs + 1 }),
      ),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...delegation, resourceUnits: -1 }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ ...delegation, prompt: 'x'.repeat(LIMITS.prompt + 1) })),
    ).toBeNull();
  });

  it('accepte requisition_open valide et rejette les invalides', () => {
    const ok = parseClientMessage(
      JSON.stringify({
        type: 'requisition_open',
        genre: 'cle_api',
        libelle: 'Clé Seedance',
        detail: 'pour vidéo',
      }),
    );
    expect(ok).toEqual({
      type: 'requisition_open',
      genre: 'cle_api',
      libelle: 'Clé Seedance',
      detail: 'pour vidéo',
    });
    expect(
      parseClientMessage(JSON.stringify({ type: 'requisition_open', genre: '', libelle: 'x' })),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'requisition_open', genre: 'mcp', libelle: 'x'.repeat(201) }),
      ),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'requisition_open', injecte: 1 }))).toBeNull();
  });

  it('requisition_open (G12) : la corrélation requestId voyage, validée comme un id', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'requisition_open',
          genre: 'action',
          libelle: 'git push',
          taskId: 't1',
          requestId: 'r-1',
        }),
      ),
    ).toEqual({
      type: 'requisition_open',
      genre: 'action',
      libelle: 'git push',
      taskId: 't1',
      requestId: 'r-1',
    });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'requisition_open',
          genre: 'action',
          libelle: 'git push',
          requestId: 'x'.repeat(65),
        }),
      ),
    ).toBeNull();
  });

  it('requisition_open (revue G12) : le budget du run voyage — entier positif, sinon le message tombe', () => {
    const message = (budgetMs: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: 'requisition_open',
          genre: 'action',
          libelle: 'git push',
          requestId: 'r-1',
          budgetMs,
        }),
      );
    expect(message(120_000)).toMatchObject({ budgetMs: 120_000 });
    expect(message(undefined)).toMatchObject({ type: 'requisition_open' });
    expect(message(0)).toBeNull();
    expect(message(-5)).toBeNull();
    expect(message(1.5)).toBeNull();
    expect(message('vite')).toBeNull();
  });
});

describe('parseServerMessage — validation des messages du hub (anti-traversal/RCE)', () => {
  it('accepte les réponses explicites d’une délégation', () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_accepted',
          requestId: 'req-1',
          parentTaskId: 'parent-1',
          childTaskId: 'child-1',
          depth: 1,
        }),
      ),
    ).toEqual({
      type: 'delegation_accepted',
      requestId: 'req-1',
      parentTaskId: 'parent-1',
      childTaskId: 'child-1',
      depth: 1,
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_rejected',
          requestId: 'req-1',
          parentTaskId: 'parent-1',
          code: 'parent_termine',
          message: 'une tâche terminée ne délègue plus',
        }),
      ),
    ).toMatchObject({ type: 'delegation_rejected', code: 'parent_termine' });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_accepted',
          requestId: 'req-1',
          parentTaskId: 'parent-1',
          childTaskId: 'child-1',
          depth: 0,
        }),
      ),
    ).toBeNull();

    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_result',
          parentTaskId: 'parent-1',
          childTaskId: 'child-1',
          success: true,
          diff: 'diff enfant',
          logs: 'tests verts',
          durationMs: 42,
          resultId: 7,
          injecte: 'ignoré',
        }),
      ),
    ).toEqual({
      type: 'delegation_result',
      parentTaskId: 'parent-1',
      childTaskId: 'child-1',
      success: true,
      diff: 'diff enfant',
      logs: 'tests verts',
      durationMs: 42,
      resultId: 7,
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_result',
          parentTaskId: 'parent-1',
          childTaskId: 'child-1',
          success: false,
          diff: '',
          logs: '',
          durationMs: 0,
        }),
      ),
    ).toMatchObject({ type: 'delegation_result', success: false });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_result',
          parentTaskId: 'parent-1',
          childTaskId: 'child-1',
          success: true,
          diff: 'x'.repeat(LIMITS.diff + 1),
          logs: '',
          durationMs: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_result',
          parentTaskId: 'parent-1',
          childTaskId: 'child-1',
          success: true,
          diff: '',
          logs: '',
          durationMs: -1,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'delegation_result',
          parentTaskId: 'parent-1',
          childTaskId: 'child-1',
          success: true,
          diff: '',
          logs: '',
          durationMs: 1,
          resultId: 0,
        }),
      ),
    ).toBeNull();
  });

  it('accepte un assign_task valide', () => {
    const msg = parseServerMessage(
      JSON.stringify({
        type: 'assign_task',
        task: validTask,
        repoUrl: null,
        delegationBudget: { durationMs: 60_000, costMicros: 42, resourceUnits: 1 },
        delegationRootTaskId: 'racine-1',
      }),
    );
    expect(msg).toMatchObject({
      type: 'assign_task',
      delegationBudget: { durationMs: 60_000, costMicros: 42, resourceUnits: 1 },
      delegationRootTaskId: 'racine-1',
    });
    // La racine sert à un guichet qui construit des décisions locales : un
    // identifiant malformé fait tomber tout le message, comme le reste.
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'assign_task', task: validTask, delegationRootTaskId: '../x' }),
      ),
    ).toBeNull();
  });

  it('L’EFFORT D’UN assign_task : un niveau connu passe, un inconnu fait tomber le message', () => {
    const message = (effort: unknown) =>
      parseServerMessage(JSON.stringify({ type: 'assign_task', task: validTask, effort }));
    expect(message('high')).toMatchObject({ type: 'assign_task', effort: 'high' });
    expect(message('turbo')).toBeNull();
    expect(message(3)).toBeNull();
  });

  it('L’AUTONOMIE d’un assign_task (G12) : un niveau connu passe, un inventé fait tomber le message', () => {
    const message = (autonomie: unknown) =>
      parseServerMessage(JSON.stringify({ type: 'assign_task', task: validTask, autonomie }));
    expect(message('gouverne')).toMatchObject({ type: 'assign_task', autonomie: 'gouverne' });
    expect(message(undefined)).toMatchObject({ type: 'assign_task' });
    expect(message('total')).toBeNull();
    expect(message(3)).toBeNull();
  });

  it('rejette un budget enfant malformé dans assign_task', () => {
    const budget = { durationMs: 60_000, costMicros: 42, resourceUnits: 1 };
    const message = (delegationBudget: unknown) =>
      JSON.stringify({ type: 'assign_task', task: validTask, delegationBudget });
    expect(parseServerMessage(message(budget))).not.toBeNull();
    expect(parseServerMessage(message({ ...budget, durationMs: -1 }))).toBeNull();
    expect(
      parseServerMessage(message({ ...budget, durationMs: LIMITS.delegationDurationMs + 1 })),
    ).toBeNull();
    expect(parseServerMessage(message({ ...budget, resourceUnits: '1' }))).toBeNull();
    expect(parseServerMessage(message({ ...budget, extra: 'injecte' }))).toMatchObject({
      type: 'assign_task',
      delegationBudget: budget,
    });
    expect(parseServerMessage(message({ ...budget, costMicros: 1_000_000_001 }))).toBeNull();
  });

  it('LE PLAFOND D’UNE TENTATIVE (G09a) : nul ou non entier, tout l’assign_task tombe ; un arrêt inconnu est abandonné, pas le résultat', () => {
    const assignation = (plafondCoutMicros: unknown) =>
      parseServerMessage(
        JSON.stringify({ type: 'assign_task', task: validTask, plafondCoutMicros }),
      );
    expect(assignation(50_000)).toMatchObject({ type: 'assign_task', plafondCoutMicros: 50_000 });
    // `0` : le CLI le refuse (« must be a positive number greater than 0 »).
    for (const mauvais of [0, -1, 0.5, '50000', LIMITS.delegationCostMicros + 1]) {
      expect(assignation(mauvais), String(mauvais)).toBeNull();
    }
    const resultat = (arretBudgetaire: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't1',
          success: false,
          diff: '',
          logs: '',
          durationMs: 1,
          subAgents: [],
          arretBudgetaire,
        }),
      );
    expect(resultat('cout')).toMatchObject({ type: 'task_result', arretBudgetaire: 'cout' });
    // Hive ne passe aucun plafond de tours : `tours` n'est pas un arrêt connu.
    for (const inconnu of ['tours', 'duree']) {
      const lu = resultat(inconnu);
      expect(lu, inconnu).toMatchObject({ type: 'task_result', success: false });
      expect(lu, inconnu).not.toHaveProperty('arretBudgetaire');
    }
  });

  it('rejette assign_task sans task ou avec un task.id malveillant (path traversal)', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'assign_task' }))).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'assign_task', task: { ...validTask, id: '../../evil' } }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'assign_task', task: { ...validTask, id: 'C:\\Windows' } }),
      ),
    ).toBeNull();
  });

  it('rejette assign_task avec un repoUrl à transport dangereux (RCE ext::)', () => {
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'assign_task', task: validTask, repoUrl: "ext::sh -c 'id'" }),
      ),
    ).toBeNull();
  });

  it('accepte le modèle de l’Aiguillage dans assign_task, et le conserve', () => {
    // Le champ que le nœud passera à `--model`. Optionnel : un hub d'avant
    // l'Aiguillage n'en envoie pas, et le nœud emploie son modèle par défaut.
    const avec = parseServerMessage(
      JSON.stringify({ type: 'assign_task', task: validTask, modele: 'claude-opus-5' }),
    );
    expect(avec).toMatchObject({ type: 'assign_task', modele: 'claude-opus-5' });
    const sans = parseServerMessage(JSON.stringify({ type: 'assign_task', task: validTask }));
    expect(sans).not.toBeNull();
    expect(sans).not.toHaveProperty('modele');
  });

  it('rejette un modèle malformé dans assign_task — tout le message tombe', () => {
    const m = (modele: unknown) => JSON.stringify({ type: 'assign_task', task: validTask, modele });
    expect(parseServerMessage(m('')), 'un nom vide').toBeNull();
    expect(parseServerMessage(m('x'.repeat(200))), 'un nom démesuré').toBeNull();
    expect(parseServerMessage(m(42)), 'pas une chaîne').toBeNull();
  });

  it('rejette cancel_task sans taskId valide', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'cancel_task', reason: 'x' }))).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ type: 'cancel_task', taskId: 't1', reason: 'x' }))?.type,
    ).toBe('cancel_task');
  });
});

describe('isValidRepoUrl', () => {
  it('accepte les schémas de transport sûrs', () => {
    expect(isValidRepoUrl('https://github.com/x/y.git')).toBe(true);
    expect(isValidRepoUrl('http://host/x.git')).toBe(true);
    expect(isValidRepoUrl('git://host/x.git')).toBe(true);
    expect(isValidRepoUrl('ssh://git@host/x.git')).toBe(true);
    expect(isValidRepoUrl('git@github.com:x/y.git')).toBe(true);
    expect(isValidRepoUrl('C:\\repos\\x')).toBe(true);
    expect(isValidRepoUrl('/home/user/repo')).toBe(true);
  });

  it('sépare les sources distantes des chemins locaux', () => {
    expect(isValidRemoteRepoUrl('https://github.com/x/y.git')).toBe(true);
    expect(isValidRemoteRepoUrl('git@github.com:x/y.git')).toBe(true);
    expect(isValidRemoteRepoUrl('/home/user/repo')).toBe(false);
    expect(isValidRemoteRepoUrl('C:\\repos\\x')).toBe(false);

    expect(isValidLocalRepoPath('/home/user/repo')).toBe(true);
    expect(isValidLocalRepoPath('C:\\repos\\x')).toBe(true);
    expect(isValidLocalRepoPath('/tmp/../etc')).toBe(false);
    expect(isValidLocalRepoPath('relative/repo')).toBe(false);
  });

  it('rejette ext::, une injection d’argument, et le vide', () => {
    expect(isValidRepoUrl("ext::sh -c 'id'")).toBe(false);
    expect(isValidRepoUrl('-oProxyCommand=evil')).toBe(false);
    expect(isValidRepoUrl('file:///etc/passwd')).toBe(false);
    expect(isValidRepoUrl('')).toBe(false);
    expect(isValidRepoUrl(42)).toBe(false);
  });

  it('rejette un caractère de contrôle — où qu’il soit, l’URL entière', () => {
    // Mesuré (git 2.53) : un saut de ligne dans les identifiants faisait
    // citer à git la clé de configuration ENTIÈRE, jeton compris — et le
    // lavage s'arrête au premier blanc. La route de création refuse donc
    // l'URL, et un message du hub qui en porterait une est écarté.
    for (const url of [
      'https://u:SECRET\nX@github.com/o/r.git',
      'https://github.com/o/r.git\n',
      'https://github.com/o/\tr.git',
      'git@github.com:o/r\r.git',
      '/home/user/re\u0000po',
      '/srv/dé\tpôt',
      'C:\\depots\\dé\u007fpôt',
      'https://github.com/o/r.git\u007f',
    ]) {
      expect(isValidRepoUrl(url), JSON.stringify(url)).toBe(false);
      expect(isValidRemoteRepoUrl(url), JSON.stringify(url)).toBe(false);
      // Le chemin local d'un administrateur suit la même règle : accepté, il
      // faisait refuser par chaque nœud toutes les assignations du projet.
      expect(isValidLocalRepoPath(url), JSON.stringify(url)).toBe(false);
    }
  });

  it('motifDepotIllisible : LA cause du refus, par la même règle — jamais l’adresse', () => {
    const cas: Array<[unknown, string | null]> = [
      ['https://github.com/x/y.git', null],
      ['/home/user/repo', null],
      ['', 'absente'],
      [42, 'absente'],
      [`https://h/${'x'.repeat(500)}`, 'plus de 500 caractères'],
      ['-oProxyCommand=evil', 'tiret initial'],
      ['https://u:SECRET-DU-PROJET@h/o/r.git\nX', 'caractère de contrôle'],
      ["ext::sh -c 'id'", 'transport non permis'],
      ['file:///etc/passwd', 'transport non permis'],
    ];
    for (const [url, defaut] of cas) {
      const motif = motifDepotIllisible(url);
      expect(motif, JSON.stringify(url)).toBe(
        defaut === null
          ? null
          : `URL de dépôt du projet illisible (${defaut}) — recréez le projet avec une URL valide`,
      );
      // Une seule règle : la garde et sa cause ne peuvent pas diverger.
      expect(isValidRepoUrl(url), JSON.stringify(url)).toBe(defaut === null);
      if (motif === null || typeof url !== 'string' || url === '') continue;
      // C'est la raison d'un `task_reject` : au-delà, la Reine refuserait le refus.
      expect(motif.length).toBeLessThanOrEqual(LIMITS.name);
      expect(motif, 'le motif recopie l’adresse').not.toContain(url.slice(0, 12));
      // Ni la suite : c'est là, dans les identifiants, que vit le jeton.
      expect(motif, 'le motif recopie le jeton').not.toContain('SECRET');
    }
  });
});

describe('assignationIllisible — ce que le nœud répond à ce qu’il ne sait pas lire', () => {
  const URL_ILLISIBLE = 'https://marie:ghp_SECRET0123456789@h.invalid/o/r.git\nX';
  const MOTIF =
    'URL de dépôt du projet illisible (caractère de contrôle) — recréez le projet avec une URL valide';
  const HORS_PROTOCOLE =
    'assignation illisible pour ce nœud — versions Reine/nœud différentes, ou champ hors bornes (titre, consigne, plafond)';

  it('UN REFUS QUE LA REINE SAIT LIRE, pour chaque travail et chaque cause — sans le jeton', () => {
    const cas: Array<[Record<string, unknown>, string]> = [
      [{ type: 'assign_task', task: validTask, repoUrl: URL_ILLISIBLE }, MOTIF],
      [{ type: 'assign_merge', mergeId: 'm1', repoUrl: URL_ILLISIBLE, diffs: [] }, MOTIF],
      [{ type: 'assign_chantier', chantierId: 'c1', repoUrl: URL_ILLISIBLE, nom: 'test' }, MOTIF],
      // Sans dépôt reproché (absent, ou nul pour une tâche), un champ hors
      // protocole : un niveau qu'un nœud plus ancien ne connaît pas — aligner
      // les versions —, un titre qu'un producteur n'a pas borné — qu'aucune
      // mise à jour ne lève. Le motif dit les deux.
      [{ type: 'assign_task', task: validTask, repoUrl: null, effort: 'inconnu' }, HORS_PROTOCOLE],
      [
        { type: 'assign_task', task: { ...validTask, title: 'x'.repeat(LIMITS.title + 1) } },
        HORS_PROTOCOLE,
      ],
    ];
    for (const [message, motif] of cas) {
      const brut = JSON.stringify(message);
      const nom = `${String(message.type)} → ${motif.slice(0, 40)}`;
      expect(parseServerMessage(brut), `prémisse : ${nom} est illisible`).toBeNull();
      const illisible = assignationIllisible(brut);
      expect(illisible?.motif, nom).toBe(motif);
      // La Reine relit la réponse avec SON parseur : une réponse qu'il
      // refuserait (une raison au-delà de `LIMITS.name`) serait un second silence.
      const reponse = illisible?.reponse;
      expect(reponse, nom).not.toBeNull();
      expect(parseClientMessage(JSON.stringify(reponse)), nom).toEqual(reponse);
      expect(JSON.stringify(illisible), nom).not.toContain('ghp_SECRET');
    }
  });

  it('SANS IDENTIFIANT SÛR, AUCUNE RÉPONSE — et ce qui n’est pas une assignation ne la concerne pas', () => {
    expect(
      assignationIllisible(
        JSON.stringify({
          type: 'assign_task',
          task: { ...validTask, id: '../x' },
          repoUrl: URL_ILLISIBLE,
        }),
      ),
    ).toEqual({ type: 'assign_task', motif: MOTIF, reponse: null });
    for (const message of [
      { type: 'assign_task', repoUrl: URL_ILLISIBLE },
      { type: 'assign_merge', mergeId: '../m', repoUrl: URL_ILLISIBLE, diffs: [] },
      { type: 'assign_chantier', chantierId: 'c1', repoUrl: URL_ILLISIBLE, nom: '--evil' },
    ]) {
      expect(assignationIllisible(JSON.stringify(message))?.reponse, message.type).toBeNull();
    }
    // Une pose n'est illisible que par ses identifiants : jamais de réponse sûre.
    expect(
      assignationIllisible(JSON.stringify({ type: 'poser_outil', poseId: '../p', outilId: 'x' })),
    ).toEqual({
      type: 'poser_outil',
      motif: 'identifiant de pose ou d’outil mal formé',
      reponse: null,
    });
    for (const brut of ['pas du json', '[]', JSON.stringify({ type: 'cancel_task' }), 42]) {
      expect(assignationIllisible(brut), String(brut)).toBeNull();
    }
  });
});

describe('isValidTask', () => {
  it('accepte une tâche bien formée et rejette les cas limites', () => {
    expect(isValidTask(validTask)).toBe(true);
    expect(isValidTask({ ...validTask, id: '../x' })).toBe(false);
    expect(isValidTask({ ...validTask, status: 'zombie' })).toBe(false);
    expect(isValidTask({ ...validTask, dependsOn: ['ok', '../bad'] })).toBe(false);
    expect(isValidTask(null)).toBe(false);
    expect(isValidTask({ ...validTask, attempts: -1 })).toBe(false);
  });
});

describe('parseServerMessage', () => {
  it('accepte les types connus et rejette le reste', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'registered', nodeId: 'n1' }))).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'requisition_ack',
          id: 'req-1',
          genre: 'cle_api',
          libelle: 'Clé Seedance',
        }),
      ),
    ).toMatchObject({ type: 'requisition_ack', id: 'req-1' });
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'requisition_result', id: 'req-1', statut: 'accordee' }),
      ),
    ).toMatchObject({ statut: 'accordee' });
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'requisition_result', id: 'req-1', statut: 'peut-etre' }),
      ),
    ).toBeNull();
    // G12 : l'échéance est un statut terminal transporté, pas un refus déguisé.
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'requisition_result', id: 'req-1', statut: 'expiree' }),
      ),
    ).toMatchObject({ statut: 'expiree' });
    // G12 : l'ack rend la corrélation telle quelle, et la valide comme un id.
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'requisition_ack',
          id: 'req-1',
          genre: 'action',
          libelle: 'git push',
          requestId: 'r-1',
        }),
      ),
    ).toMatchObject({ requestId: 'r-1' });
    // Revue G12 : l'échéance effective revient dans l'ack — un entier positif,
    // sinon le message tombe (le filet local retomberait sur son plafond figé).
    const ack = (expiresAt: unknown) =>
      parseServerMessage(
        JSON.stringify({
          type: 'requisition_ack',
          id: 'req-1',
          genre: 'action',
          libelle: 'git push',
          requestId: 'r-1',
          expiresAt,
        }),
      );
    expect(ack(1_700_000_600_000)).toMatchObject({ expiresAt: 1_700_000_600_000 });
    expect(ack(undefined)).toMatchObject({ type: 'requisition_ack' });
    expect(ack(0)).toBeNull();
    expect(ack('demain')).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'intrus' }))).toBeNull();
    expect(parseServerMessage('')).toBeNull();
    expect(parseServerMessage('{}')).toBeNull();
  });
});
