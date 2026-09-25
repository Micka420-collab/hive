// La déclaration fournisseur de Claude Code — lue dans la ligne `result` du
// flux stream-json, jamais estimée.
//
// Le dernier cas lance le VRAI adaptateur `claude-code` contre un faux binaire
// `claude` posé sur le PATH : le flux traverse `runCommandStreaming`, le suivi
// ligne à ligne, et la déclaration ressort dans le résultat de l'adaptateur.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import {
  createDeclarationFournisseurTracker,
  declarationDepuisResultat,
} from '../src/adapters/fournisseur-parser.js';
import type { Task } from '../src/shared/types.js';

/** Une ligne `result` au format documenté de `claude -p --output-format stream-json`. */
const LIGNE_RESULTAT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 9_800,
  duration_api_ms: 7_250,
  num_turns: 4,
  result: 'texte de la réponse — ne doit jamais quitter le nœud',
  session_id: 'session-secrete',
  total_cost_usd: 0.0421,
  usage: {
    input_tokens: 12,
    cache_creation_input_tokens: 3_000,
    cache_read_input_tokens: 9_000,
    output_tokens: 850,
  },
  modelUsage: {
    'claude-sonnet-4-5-20250929': { costUSD: 0.04 },
    'claude-haiku-4-5-20251001': { costUSD: 0.0021 },
  },
};

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('déclaration fournisseur — ligne `result` de Claude Code', () => {
  it('retient coût, temps modèle, jetons et modèles exacts — rien d’autre', () => {
    const declaration = declarationDepuisResultat(LIGNE_RESULTAT, 'claude-code');

    expect(declaration).toEqual({
      source: 'claude-code',
      coutUsd: 0.0421,
      dureeApiMs: 7_250,
      jetonsEntree: 12_012,
      jetonsSortie: 850,
      modeles: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
    });
    expect(JSON.stringify(declaration)).not.toContain('session-secrete');
    expect(JSON.stringify(declaration)).not.toContain('texte de la réponse');
  });

  it('laisse absent ce qui n’est pas déclaré, et ne déclare rien sans mesure', () => {
    expect(
      declarationDepuisResultat(
        { type: 'result', total_cost_usd: -1, duration_api_ms: 'lent' },
        'claude-code',
      ),
    ).toBeUndefined();
    expect(
      declarationDepuisResultat({ type: 'result', duration_api_ms: 1_000 }, 'claude-code'),
    ).toEqual({ source: 'claude-code', dureeApiMs: 1_000 });
    expect(
      declarationDepuisResultat({ type: 'assistant', total_cost_usd: 1 }, 'claude-code'),
    ).toBeUndefined();
  });

  it('suit le flux : ignore le bruit, garde la dernière déclaration', () => {
    const suivi = createDeclarationFournisseurTracker('claude-code');
    suivi.feed('bannière non JSON');
    suivi.feed(JSON.stringify({ type: 'system', subtype: 'init', model: 'x' }));
    suivi.feed('{"type":"result", tronqué');
    expect(suivi.declaration()).toBeUndefined();

    suivi.feed(JSON.stringify({ type: 'result', total_cost_usd: 0.01 }));
    suivi.feed(JSON.stringify(LIGNE_RESULTAT));
    expect(suivi.declaration()?.coutUsd).toBe(0.0421);
  });

  it.skipIf(process.platform === 'win32')(
    'LE VRAI ADAPTATEUR claude-code RAPPORTE LA DÉCLARATION D’UN CLI (faux binaire sur le PATH)',
    async () => {
      const dossier = mkdtempSync(path.join(tmpdir(), 'faux-claude-'));
      aNettoyer.push(dossier);
      const binaire = path.join(dossier, 'claude');
      const lignes = [
        { type: 'system', subtype: 'init', model: 'claude-sonnet-4-5-20250929' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
        LIGNE_RESULTAT,
      ]
        .map((l) => JSON.stringify(l))
        .join('\n');
      writeFileSync(
        binaire,
        `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${lignes}\n`)});\n`,
      );
      chmodSync(binaire, 0o755);

      const tache: Task = {
        id: 'tache-faux-claude',
        projectId: 'p',
        title: 'Écrire',
        prompt: 'écrire le module',
        status: 'assigned',
        dependsOn: [],
        assignedNodeId: 'n',
        result: null,
        branch: null,
        attempts: 0,
        createdAt: 0,
        updatedAt: 0,
      };
      const resultat = await createClaudeCodeAdapter('jeton-de-ruche-suffisamment-long').run(
        tache,
        {
          cwd: dossier,
          env: { PATH: `${dossier}${path.delimiter}${process.env.PATH ?? ''}` },
          attempt: 1,
          signal: new AbortController().signal,
          onProgress: () => undefined,
        },
      );

      expect(resultat.success, resultat.logs).toBe(true);
      expect(resultat.fournisseur).toMatchObject({
        source: 'claude-code',
        coutUsd: 0.0421,
        dureeApiMs: 7_250,
        modeles: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
      });
    },
  );
});
