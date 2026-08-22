// UN MESSAGE MALFORMÉ D'UN PAIR NE DOIT PAS FAIRE LEVER LE PARSEUR.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Sonde de la forme NÉGATIVE du motif `typeof`/`null` (§ 9
// quaterseptuagicenties, qui raconte pourquoi cette forme avait été manquée par
// le recensement) : 26 occurrences, **18 nues**. Cinq d'entre elles vivent dans
// `src/shared/protocol.ts`, et ce sont les plus conséquentes du lot :
//
//     if (typeof s !== 'object' || s === null) return false;   // isSubAgents
//     if (typeof p !== 'object' || p === null) return false;   // isPresences
//     if (typeof d !== 'object' || d === null) return false;   // isMergeDiffs
//     if (typeof c !== 'object' || c === null) return false;   // isMergeConflicts
//     if (typeof data !== 'object' || data === null || …) return null;  // parseServerMessage
//
// ─── CE QUE LA MUTATION FAIT, ET POURQUOI C'EST GRAVE ICI ────────────────────
//
// `typeof null` rend `'object'`, donc `typeof s !== 'object'` est FAUX pour
// `null` : c'est le `||` qui écarte `null`, et lui seul. Mué en `&&`, le refus
// exige que les DEUX conditions tombent — `null` traverse la garde, et
// l'indexation qui suit (`sa.id`, `m.type`) lève un TypeError.
//
// `protocol.ts` valide les messages échangés entre la ruche et ses nœuds :
// des données qu'un PAIR envoie, que la ruche ne choisit pas. Un parseur qui
// lève au lieu de rendre `null` transforme « message rejeté » en « connexion
// qui casse » — et il suffit d'un `[null]` dans une liste pour le déclencher.
//
// Les deux `try` de ce fichier n'enveloppent que `JSON.parse` : la levée se
// propage bel et bien (vérifié avant d'écrire ce banc — § 9
// duoseptuagicenties, un `catch` large rendrait ces mutants équivalents).
//
// ─── POURQUOI `[null]` ET PAS UN OBJET INCOMPLET ─────────────────────────────
//
// Un `{}` ou un `{id: 42}` est REJETÉ proprement dans les deux mondes : la
// garde de forme passe, et les vérifications de champs disent non. Seul `null`
// sépare les deux mondes, parce que seul `null` a `typeof === 'object'` sans
// être indexable. Un décor avec `{}` aurait été vert des deux côtés.

import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from '../src/shared/protocol.js';

const TACHE = 'tache-1';
const MERGE = 'merge-1';

describe('parseClientMessage — un `null` glissé dans une liste est REFUSÉ, pas fatal', () => {
  it('subAgents: [null] — `task_update`', () => {
    const brut = JSON.stringify({
      type: 'task_update',
      taskId: TACHE,
      status: 'running',
      subAgents: [null],
    });
    expect(() => parseClientMessage(brut)).not.toThrow();
    expect(parseClientMessage(brut)).toBeNull();
  });

  it('presences: [null] — `task_update`', () => {
    const brut = JSON.stringify({
      type: 'task_update',
      taskId: TACHE,
      status: 'running',
      presences: [null],
    });
    expect(() => parseClientMessage(brut)).not.toThrow();
    expect(parseClientMessage(brut)).toBeNull();
  });

  it('subAgents: [null] — `task_result`', () => {
    const brut = JSON.stringify({
      type: 'task_result',
      taskId: TACHE,
      success: true,
      diff: '',
      logs: '',
      durationMs: 10,
      subAgents: [null],
    });
    expect(() => parseClientMessage(brut)).not.toThrow();
    expect(parseClientMessage(brut)).toBeNull();
  });

  it('conflicts: [null] — `merge_result`', () => {
    const brut = JSON.stringify({
      type: 'merge_result',
      mergeId: MERGE,
      applied: [],
      conflicts: [null],
      mergedDiff: '',
      testsRun: false,
      testsPassed: null,
    });
    expect(() => parseClientMessage(brut)).not.toThrow();
    expect(parseClientMessage(brut)).toBeNull();
  });

  // Le bord positif : sans lui, un parseur qui rendrait TOUJOURS `null`
  // passerait les quatre cas ci-dessus sans rien mesurer.
  it('une liste BIEN FORMÉE est toujours acceptée', () => {
    const brut = JSON.stringify({
      type: 'task_update',
      taskId: TACHE,
      status: 'running',
      subAgents: [{ id: 'sa-1', name: 'sous-agent', status: 'running' }],
    });
    const m = parseClientMessage(brut);
    expect(m, 'un message valide devrait être lu').not.toBeNull();
    expect(m?.type).toBe('task_update');
  });
});

describe('parseServerMessage — même règle, dans l’autre sens', () => {
  it('diffs: [null] — `assign_merge`', () => {
    const brut = JSON.stringify({
      type: 'assign_merge',
      mergeId: MERGE,
      repoUrl: 'https://github.com/Micka420-collab/hive.git',
      diffs: [null],
    });
    expect(() => parseServerMessage(brut)).not.toThrow();
    expect(parseServerMessage(brut)).toBeNull();
  });

  // La charge qui vaut littéralement `null` : elle passe `JSON.parse` sans
  // lever, donc le `catch` ne la voit pas. Seule la garde l'arrête.
  it('la charge entière valant `null` est refusée, pas fatale', () => {
    expect(() => parseServerMessage('null')).not.toThrow();
    expect(parseServerMessage('null')).toBeNull();
  });

  it('un message serveur BIEN FORMÉ est toujours accepté', () => {
    const m = parseServerMessage(JSON.stringify({ type: 'registered', nodeId: 'noeud-1' }));
    expect(m, 'un message valide devrait être lu').not.toBeNull();
    expect(m?.type).toBe('registered');
  });
});
