// Codex tourne en `codex exec --json` : sa réponse, ses jetons et la raison de
// son échec viennent du FLUX d'événements, lu en entier — jamais de la sortie
// humaine, qui répète la consigne sur stderr.
//
// ─── D'OÙ VIENNENT LES FIXTURES ──────────────────────────────────────────────
//
// `tests/fixtures/flux-codex/` : codex-cli 0.156.0, ENREGISTRÉ sur le vrai
// binaire branché (CODEX_HOME jetable, `model_providers`) sur un faux
// fournisseur Responses local — aucun crédit dépensé. Chaque scénario l'est
// dans les DEUX modes, avec la même consigne et les mêmes réponses du faux
// fournisseur :
//
//   · `*.json.*` : `codex exec --json`, ce que Hive lance ;
//   · `*.humain.*` : `codex exec` sans `--json`, ce que Hive lançait.
//
// Scénarios : `relecture-outil` (l'agent lit un fichier, puis conteste),
// `echec-400` (la consigne parle d'API key, de login et de billing ; l'agent
// lance `grep -rn api_key` ; puis le fournisseur rend un 400 « string too
// long »), `echec-401` (même tâche, le fournisseur refuse la clé). Assainies
// seulement : le chemin de travail remplacé par `/travail/tasks/tache-hive`.
//
// Les cas de bout en bout lancent le VRAI adaptateur contre un faux `codex`
// posé sur le PATH, qui rejoue l'enregistrement du mode que Hive lui demande :
// sur le code d'avant (sans `--json`), il rejoue la sortie humaine — c'est
// ainsi que ces cas échouent sur l'ancien adaptateur, pour la raison qu'ils
// décrivent.

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { createLecteurFluxCodex } from '../src/adapters/flux-codex.js';
import type { AdapterContext } from '../src/adapters/index.js';
import { texteDEchec } from '../src/shared/texte-d-echec.js';
import type { Task } from '../src/shared/types.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'flux-codex');
const fixture = (nom: string): string => readFileSync(path.join(FIXTURES, nom), 'utf8');
const TOKEN = 'jeton-de-ruche-suffisamment-long';

/** La consigne enregistrée : elle parle d'API key, de login ET de billing. */
const CONSIGNE_PIEGE =
  'Ajoute une vérification de l’API key avant l’appel de facturation (billing)';
const OBJECTION =
  'conteste\n- aucun test ne couvre la clé absente : la garde peut disparaître sans qu’un banc rougisse.';

/** Rend un flux entier comme le nœud l'écrit dans ses logs. */
function rendre(flux: string): {
  logs: string;
  lecteur: ReturnType<typeof createLecteurFluxCodex>;
} {
  const lecteur = createLecteurFluxCodex();
  const logs = flux
    .split('\n')
    .map((l) => lecteur.lire(l))
    .filter((l): l is string => l !== undefined)
    .join('\n');
  return { logs, lecteur };
}

describe('le lecteur du flux `codex exec --json`', () => {
  it('RÉPONSE, JETONS, LOGS : le dernier message conclu, les jetons du tour, aucun JSON brut', () => {
    const { logs, lecteur } = rendre(fixture('relecture-outil.json.stdout.jsonl'));

    // La réponse est la même qu'en sortie humaine (stdout du mode texte).
    expect(lecteur.texte()).toBe(OBJECTION);
    expect(fixture('relecture-outil.humain.stdout.txt').trim()).toBe(OBJECTION);
    // Les jetons que `turn.completed` déclare — et rien d'autre : ni coût, ni
    // temps modèle, ni modèle exact.
    expect(lecteur.declaration()).toEqual({
      source: 'codex',
      jetonsEntree: 4_448,
      jetonsSortie: 104,
    });

    expect(logs).not.toContain('{"');
    expect(logs.split('\n')).toEqual([
      '┊ avertissement : Model metadata for `modele-de-test` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
      '┊ raisonnement : Je relis la garde sur l’API key avant de trancher.',
      '┊ codex : Je lis src/auth.ts.',
      "┊ commande lancée : /bin/bash -lc 'cat src/auth.ts'",
      "┊ commande réussie (code 0) — /bin/bash -lc 'cat src/auth.ts' :",
      '┊   export function facturer(api_key?: string) {',
      '┊     if (!api_key) throw new Error("login requis");',
      '┊     return api_key.length;',
      '┊   }',
      '┊ codex :',
      '┊   conteste',
      '┊   - aucun test ne couvre la clé absente : la garde peut disparaître sans qu’un banc rougisse.',
      '┊ tour terminé — jetons déclarés : 4448 en entrée (dont 2048 lus en cache) · 104 en sortie (dont 24 de raisonnement) — coût et temps modèle non déclarés',
    ]);
  });

  it('UN TOUR EN ÉCHEC : aucune réponse, et la seule ligne que l’échec dit est SA raison', () => {
    const { logs, lecteur } = rendre(fixture('echec-400.json.stdout.jsonl'));

    // L'agent avait parlé avant l'erreur : ce n'était pas une conclusion.
    expect(lecteur.texte()).toBeUndefined();
    expect(lecteur.declaration()).toBeUndefined();
    expect(texteDEchec(logs).split('\n')).toEqual([
      'codex : tour en échec — {"error":{"message":"Invalid \'input[4].output\': string too long. Expected a string with maximum length 10485760.","type":"invalid_request_error","code":"string_above_max_length"}}',
    ]);
  });

  it('UNE TENTATIVE REFAITE N’EST PAS L’ÉCHEC : un 429 réessayé ne fait pas d’un 400 une panne d’infra', () => {
    // Synthétique, sur le contrat de codex-rs : une erreur de flux que Codex va
    // réessayer sort en `error` (« Reconnecting... n/m (…) »,
    // core/src/responses_retry.rs) ; le tour échoue ensuite sur autre chose.
    const { logs } = rendre(
      [
        '{"type":"turn.started"}',
        '{"type":"error","message":"Reconnecting... 2/5 (unexpected status 429 Too Many Requests: Rate limit reached)"}',
        '{"type":"turn.failed","error":{"message":"unexpected status 400 Bad Request: context_length_exceeded"}}',
      ].join('\n'),
    );
    expect(logs).toContain('┊ erreur signalée : Reconnecting... 2/5');
    expect(texteDEchec(logs)).toBe(
      'codex : tour en échec — unexpected status 400 Bad Request: context_length_exceeded',
    );
  });

  it('UN TOUR SANS CONCLUSION (tué, interrompu) N’A PAS DE RÉPONSE, même si l’agent avait parlé', () => {
    const { lecteur } = rendre(
      [
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"valide"}}',
      ].join('\n'),
    );
    expect(lecteur.texte()).toBeUndefined();
  });

  it('UN USAGE À ZÉRO N’EST PAS UNE DÉCLARATION : Codex rend des zéros quand il n’a rien compté', () => {
    const { lecteur } = rendre(
      [
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"valide"}}',
        '{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}',
      ].join('\n'),
    );
    expect(lecteur.texte()).toBe('valide');
    expect(lecteur.declaration()).toBeUndefined();
  });

  it('UNE LIGNE INCONNUE OU TRONQUÉE SE DIT, SANS ÊTRE RECOPIÉE NI CASSER LA SUITE', () => {
    const { logs, lecteur } = rendre(
      [
        '{"type":"thread.future","secret":"ne doit pas sortir"}',
        '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"valide"',
        '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"valide"}}',
        '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
      ].join('\n'),
    );
    expect(logs).toContain('┊ événement codex non reconnu : thread.future');
    expect(logs).toMatch(/┊ événement codex illisible \(\d+ caractères\)/);
    expect(logs).not.toContain('ne doit pas sortir');
    expect(lecteur.texte()).toBe('valide');
    expect(texteDEchec(logs)).toBe('');
  });
});

// ─── Le vrai adaptateur, contre le vrai enregistrement ──────────────────────

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Un faux `codex` qui fait ce que fait codex-cli 0.156.0 : il lit stdin
 * jusqu'à sa fin, puis écrit l'enregistrement du MODE demandé — `--json` → le
 * flux d'événements, sinon la sortie humaine —, et sort en 1 sur un échec.
 */
function fauxCodex(scenario: string, code: number): AdapterContext {
  const dossier = mkdtempSync(path.join(tmpdir(), 'hive-flux-codex-'));
  aNettoyer.push(dossier);
  const chemin = (nom: string) => JSON.stringify(path.join(FIXTURES, `${scenario}.${nom}`));
  const bin = path.join(dossier, 'codex');
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('node:fs');",
      "const lire = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : '');",
      "const json = process.argv.includes('--json');",
      "process.stdin.on('data', () => undefined);",
      "process.stdin.on('end', () => {",
      `  process.stderr.write(lire(json ? ${chemin('json.stderr.txt')} : ${chemin('humain.stderr.txt')}));`,
      `  process.stdout.write(lire(json ? ${chemin('json.stdout.jsonl')} : ${chemin('humain.stdout.txt')}));`,
      `  process.exitCode = ${code};`,
      '});',
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  return {
    cwd: dossier,
    env: { PATH: `${dossier}${path.delimiter}${process.env.PATH ?? ''}` },
    attempt: 1,
    signal: new AbortController().signal,
    onProgress: () => undefined,
  };
}

const tache = (prompt: string): Task => ({
  id: 'tache-hive',
  projectId: 'p',
  title: 'Garde sur la clé',
  prompt,
  status: 'assigned',
  dependsOn: [],
  assignedNodeId: 'n',
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
});

describe.skipIf(process.platform === 'win32')(
  'le vrai adaptateur Codex, contre le vrai binaire enregistré',
  () => {
    it(
      'UNE CONSIGNE QUI PARLE D’API KEY N’EST PLUS UNE PANNE D’IDENTIFIANTS : le 400 est un échec de la tâche, rendu',
      { timeout: 15_000 },
      async () => {
        // En sortie humaine, la consigne répétée sur stderr — « API key »,
        // « login », « billing » — et le `grep -rn api_key` de l'agent
        // faisaient lire ce 400 comme une panne d'auth : réaffectation,
        // réquisition de clé, et l'échec jamais rendu.
        const r = await createCodexAdapter(TOKEN).run(
          tache(CONSIGNE_PIEGE),
          fauxCodex('echec-400', 1),
        );

        expect(r.success).toBe(false);
        expect(r.infra, texteDEchec(r.logs, r.finalText)).toBeUndefined();
        expect(r.finalText).toBeUndefined();
        expect(r.logs).not.toContain(CONSIGNE_PIEGE);
        expect(r.logs).toContain('codex : tour en échec — {"error":{"message":"Invalid');
        // La narration reste lisible à l'écran et aux Gardiennes.
        expect(r.logs).toContain(
          "┊ commande réussie (code 0) — /bin/bash -lc 'grep -rn api_key src'",
        );
      },
    );

    it(
      'UNE VRAIE CLÉ REFUSÉE (401) RESTE UNE PANNE D’INFRA — lue dans la raison de l’échec',
      { timeout: 15_000 },
      async () => {
        const r = await createCodexAdapter(TOKEN).run(
          tache(CONSIGNE_PIEGE),
          fauxCodex('echec-401', 1),
        );
        expect(r.success).toBe(false);
        expect(r.infra).toBe(true);
        // stderr (ses diagnostics) et la raison du tour : rien d'autre.
        expect(texteDEchec(r.logs, r.finalText)).toMatch(
          /^Reading additional input from stdin\.\.\.\ncodex : tour en échec — unexpected status 401 Unauthorized: Incorrect API key/,
        );
      },
    );

    it(
      'UNE RELECTURE RÉUSSIE : la même réponse qu’avant, et Codex DÉCLARE ses jetons — sans coût',
      { timeout: 15_000 },
      async () => {
        const r = await createCodexAdapter(TOKEN).run(
          tache('Relis la garde de src/auth.ts sur l’API key'),
          fauxCodex('relecture-outil', 0),
        );

        expect(r.success, r.logs).toBe(true);
        expect(r.finalText).toBe(OBJECTION);
        expect(r.fournisseur).toEqual({ source: 'codex', jetonsEntree: 4_448, jetonsSortie: 104 });
        expect(r.logs).toContain('Reading additional input from stdin...');
        expect(r.logs).not.toContain('{"type"');
      },
    );
  },
);
