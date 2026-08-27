// Tests de validation du protocole WebSocket : les messages malformés ou
// malveillants sont rejetés, les champs inconnus ne sont jamais propagés.

import { describe, expect, it } from 'vitest';
import {
  isValidRepoUrl,
  isValidTask,
  LIMITS,
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
});

describe('parseServerMessage — validation des messages du hub (anti-traversal/RCE)', () => {
  it('accepte un assign_task valide', () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: 'assign_task', task: validTask, repoUrl: null }),
    );
    expect(msg?.type).toBe('assign_task');
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

  it('rejette ext::, une injection d’argument, et le vide', () => {
    expect(isValidRepoUrl("ext::sh -c 'id'")).toBe(false);
    expect(isValidRepoUrl('-oProxyCommand=evil')).toBe(false);
    expect(isValidRepoUrl('file:///etc/passwd')).toBe(false);
    expect(isValidRepoUrl('')).toBe(false);
    expect(isValidRepoUrl(42)).toBe(false);
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
    expect(parseServerMessage(JSON.stringify({ type: 'intrus' }))).toBeNull();
    expect(parseServerMessage('')).toBeNull();
    expect(parseServerMessage('{}')).toBeNull();
  });
});
