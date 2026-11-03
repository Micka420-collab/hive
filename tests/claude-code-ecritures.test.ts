// LES ÉCRITURES REFUSÉES PAR CLAUDE CODE NE SONT PAS UNE RÉUSSITE.
//
// Mesuré en E2E réel (Claude Code 2.1.317 sous Windows, mission lancée depuis
// l'accueil de Hive Studio) : les réglages du membre (`~/.claude/settings.json`)
// portaient `"ask": ["Edit", "Write"]`. En `claude -p`, une règle « ask »
// l'emporte sur `--permission-mode acceptEdits` et personne n'y répond : chaque
// écriture a été refusée, le CLI est sorti en 0, le diff était vide — et la
// tâche était rangée « réussie ». La ligne `result` du stream-json le disait
// pourtant (`permission_denials`) : ces bancs la lisent.

import { describe, expect, it } from 'vitest';
import {
  ecrituresRefusees,
  raisonEcrituresRefusees,
  reglesBloquantLEcriture,
} from '../src/adapters/claude-code.js';

/** La ligne `result` telle que Claude Code 2.1.317 l'a rendue pendant l'E2E (abrégée). */
const RESULT_REFUSE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 8,
  result: "La correction n'est pas appliquée : calc.js n'a pas changé.",
  permission_denials: [
    {
      tool_name: 'Edit',
      tool_use_id: 'toolu_01',
      tool_input: {
        file_path: 'C:\\Users\\m\\AppData\\Local\\Temp\\hive-e2e\\work\\tasks\\t-1\\calc.js',
        old_string: '  return a - b;',
        new_string: '  return a + b;',
      },
    },
    { tool_name: 'PowerShell', tool_use_id: 'toolu_02', tool_input: { command: 'npm test' } },
  ],
});

describe('les écritures refusées, lues dans le flux de Claude Code', () => {
  it('LA LIGNE `result` DIT QUELLES ÉCRITURES ONT ÉTÉ REFUSÉES — l’outil et le fichier', () => {
    expect(ecrituresRefusees(RESULT_REFUSE)).toEqual(['Edit calc.js']);
  });

  it('un refus de COMMANDE n’est pas un refus d’écriture ; une autre ligne ne dit rien', () => {
    const commande = JSON.stringify({
      type: 'result',
      permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'npm test' } }],
    });
    expect(ecrituresRefusees(commande)).toEqual([]);
    expect(ecrituresRefusees(JSON.stringify({ type: 'result', permission_denials: [] }))).toEqual(
      [],
    );
    // Le même champ hors d'une ligne `result` (un message de l'agent qui le cite).
    expect(
      ecrituresRefusees(
        JSON.stringify({ type: 'assistant', permission_denials: [{ tool_name: 'Edit' }] }),
      ),
    ).toEqual([]);
    expect(ecrituresRefusees('{"type":"result","permission_denials": [ cassé')).toEqual([]);
    expect(ecrituresRefusees('texte brut')).toEqual([]);
  });

  it('Write, MultiEdit et NotebookEdit sont des écritures ; sans chemin, l’outil seul', () => {
    const ligne = JSON.stringify({
      type: 'result',
      permission_denials: [
        { tool_name: 'Write', tool_input: { file_path: '/tmp/t/nouveau.ts' } },
        { tool_name: 'MultiEdit', tool_input: {} },
        { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/tmp/t/analyse.ipynb' } },
      ],
    });
    expect(ecrituresRefusees(ligne)).toEqual([
      'Write nouveau.ts',
      'MultiEdit',
      'NotebookEdit analyse.ipynb',
    ]);
  });

  it('LA RAISON DIT CE QUI EST ARRIVÉ ET LE REMÈDE — et que rien n’a été modifié', () => {
    const raison = raisonEcrituresRefusees(['Edit calc.js', 'Edit calc.js', 'Write b.ts']);
    expect(raison).toContain('Edit calc.js, Write b.ts');
    expect(raison).toContain('~/.claude/settings.json');
    expect(raison).toContain("Rien n'a été modifié");
    expect(raison).toMatch(/retirez Edit et Write/);
  });
});

describe('les réglages qui bloqueront toute écriture, vus AU DÉMARRAGE', () => {
  it('LES RÉGLAGES DU MEMBRE DE L’E2E : « ask » sur Edit et Write', () => {
    expect(
      reglesBloquantLEcriture({
        permissions: {
          allow: ['Read', 'Bash(npm run:*)'],
          deny: ['Bash(rm -rf:*)', 'Read(./.env)'],
          ask: ['Bash(git push:*)', 'Edit', 'Write'],
          defaultMode: 'default',
        },
      }),
    ).toEqual(['ask: Edit', 'ask: Write']);
  });

  it('un motif compte aussi (`deny: Edit(src/**)`) ; un « allow » ne bloque rien', () => {
    expect(
      reglesBloquantLEcriture({ permissions: { deny: ['Edit(src/**)'], allow: ['Write'] } }),
    ).toEqual(['deny: Edit(src/**)']);
    // « EditorMode » n'est pas l'outil Edit.
    expect(reglesBloquantLEcriture({ permissions: { ask: ['EditorMode', 'Writer'] } })).toEqual([]);
  });

  it('des réglages absents ou illisibles ne disent rien', () => {
    for (const r of [
      null,
      undefined,
      'texte',
      42,
      {},
      { permissions: null },
      { permissions: { ask: 'Edit' } },
    ]) {
      expect(reglesBloquantLEcriture(r)).toEqual([]);
    }
  });
});
