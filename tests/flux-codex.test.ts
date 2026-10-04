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
import { signatureEchec } from '../src/orchestrator/essaim.js';
import { LIMITS } from '../src/shared/protocol.js';
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

/**
 * Rend un flux entier comme le nœud l'écrit dans ses logs : les lignes rendues,
 * puis le bilan à la sortie du processus (`code`), comme l'exécuteur.
 */
function rendre(
  flux: string,
  code = 1,
): {
  logs: string;
  lecteur: ReturnType<typeof createLecteurFluxCodex>;
} {
  const lecteur = createLecteurFluxCodex();
  const lignes = flux
    .split('\n')
    .map((l) => lecteur.lire(l)?.texte)
    .filter((l): l is string => l !== undefined);
  const bilan = lecteur.bilan(code, false);
  return { logs: [...lignes, ...(bilan !== undefined ? [bilan] : [])].join('\n'), lecteur };
}

describe('le lecteur du flux `codex exec --json`', () => {
  it('RÉPONSE, JETONS, LOGS : le dernier message conclu, les jetons du tour, aucun JSON brut', () => {
    const { logs, lecteur } = rendre(fixture('relecture-outil.json.stdout.jsonl'), 0);

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

  it('UN TOUR INTERROMPU (sortie en 1, aucun tour conclu) DIT CE QUI S’EST PASSÉ : la bannière de stderr n’est plus la signature de tous les échecs', () => {
    // codex-rs/exec/src/lib.rs : un tour `Interrupted` lève `error_seen` —
    // sortie en 1 — et le flux JSON n'en émet RIEN. Sans bilan, ce que
    // l'échec dit se réduisait à la bannière de stderr, commune à tous.
    const flux = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"npm test a échoué : TypeError x, je vérifie l’API key"}}',
    ].join('\n');
    const { logs } = rendre(flux, 1);
    const journal = `Reading additional input from stdin...\n${logs}`;

    expect(texteDEchec(journal).split('\n')).toEqual([
      'Reading additional input from stdin...',
      'codex : échec — sortie en code 1 sans que le tour se conclue (ni `turn.completed` ni `turn.failed` : tour interrompu)',
    ]);
    expect(signatureEchec(journal)).not.toBe('reading additional input from stdin...');
    expect(signatureEchec(journal)).toContain('sans que le tour se conclue');

    // Tué par Hive : le marqueur `[hive]` le dit déjà, pas de bilan en plus.
    const tue = createLecteurFluxCodex();
    for (const l of flux.split('\n')) tue.lire(l);
    expect(tue.bilan(null, true)).toBeUndefined();
  });

  it('UN CODEX SANS `--json` (sortie en erreur, aucun événement) LE DIT : trop ancien, ou lancement en échec', () => {
    const { logs } = rendre('', 2);
    expect(logs).toBe(
      'codex : échec — sortie en code 2 sans aucun événement `--json` (codex-cli trop ancien pour `--json`, ou lancement en échec : voir stderr)',
    );
  });

  it('UN USAGE À ZÉRO N’EST PAS UNE DÉCLARATION : Codex rend des zéros quand il n’a rien compté', () => {
    const { lecteur } = rendre(
      [
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"valide"}}',
        '{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}',
      ].join('\n'),
      0,
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
      0,
    );
    expect(logs).toContain('┊ événement codex non reconnu : thread.future');
    expect(logs).toMatch(/┊ événement codex illisible \(\d+ caractères\)/);
    expect(logs).not.toContain('ne doit pas sortir');
    expect(lecteur.texte()).toBe('valide');
    expect(texteDEchec(logs)).toBe('');
  });

  it('UNE COMMANDE SUR PLUSIEURS LIGNES RESTE NARRATION JUSQU’À SA DERNIÈRE LIGNE, en-tête compris', () => {
    // Codex joint la commande par `shlex_join`, retours à la ligne gardés :
    // un heredoc mettait ses lignes suivantes HORS de la marque, dans l'en-tête.
    const { logs } = rendre(
      [
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_1',
            type: 'command_execution',
            command:
              "/bin/bash -lc \"python3 - <<'PY'\nimport os\nprint(os.environ.get('OPENAI_API_KEY'))  # api key / login\nPY\"",
            aggregated_output: 'None\n',
            exit_code: 0,
            status: 'completed',
          },
        }),
        '{"type":"turn.failed","error":{"message":"unexpected status 400 Bad Request: context_length_exceeded"}}',
      ].join('\n'),
    );
    expect(
      logs
        .split('\n')
        .slice(0, -1)
        .every((l) => l.startsWith('┊')),
    ).toBe(true);
    expect(texteDEchec(logs)).toBe(
      'codex : tour en échec — unexpected status 400 Bad Request: context_length_exceeded',
    );
  });

  it('LE PLAN SE DIT À SON OUVERTURE ET À SA CLÔTURE, pas à chaque mise à jour', () => {
    const plan = (phase: string, fait: boolean) =>
      JSON.stringify({
        type: phase,
        item: {
          id: 'item_0',
          type: 'todo_list',
          items: [
            { text: 'lire', completed: fait },
            { text: 'corriger', completed: false },
          ],
        },
      });
    const { logs } = rendre(
      [plan('item.started', false), plan('item.updated', true), plan('item.updated', true)].join(
        '\n',
      ),
      0,
    );
    expect(logs.match(/┊ plan :/g)).toHaveLength(1);
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
 *
 * `scenario` : un enregistrement de `tests/fixtures/flux-codex`, ou un flux
 * `--json` SYNTHÉTIQUE (`{ jsonl }`), écrit sur le contrat de codex-rs pour un
 * cas que le faux fournisseur ne sait pas provoquer.
 */
function fauxCodex(
  scenario: string | { jsonl: string; stderr?: string },
  code: number,
): AdapterContext {
  const dossier = mkdtempSync(path.join(tmpdir(), 'hive-flux-codex-'));
  aNettoyer.push(dossier);
  const racine =
    typeof scenario === 'string'
      ? path.join(FIXTURES, scenario)
      : path.join(dossier, 'synthetique');
  if (typeof scenario !== 'string') {
    writeFileSync(`${racine}.json.stdout.jsonl`, scenario.jsonl);
    if (scenario.stderr !== undefined) writeFileSync(`${racine}.json.stderr.txt`, scenario.stderr);
  }
  const chemin = (nom: string) => JSON.stringify(`${racine}.${nom}`);
  const bin = path.join(dossier, 'codex');
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      // La sonde du bac de Codex (`codex sandbox … -- true`, codex.ts) : un
      // hôte où il démarre. Ses échecs sont éprouvés par codex-ecriture.test.ts.
      "if (process.argv[2] === 'sandbox') process.exit(0);",
      "const fs = require('node:fs');",
      "const lire = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : '');",
      "const json = process.argv.includes('--json');",
      "process.stdin.on('data', () => undefined);",
      "process.stdin.on('end', () => {",
      `  process.stderr.write(lire(json ? ${chemin('json.stderr.txt')} : ${chemin('humain.stderr.txt')}));`,
      // stdout APRÈS stderr, comme codex (diagnostics au lancement, puis le
      // flux) : sans la pause, les deux tubes arrivent dans un ordre libre.
      '  setTimeout(() => {',
      `    process.stdout.write(lire(json ? ${chemin('json.stdout.jsonl')} : ${chemin('humain.stdout.txt')}));`,
      `    process.exitCode = ${code};`,
      '  }, 100);',
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

    it(
      'UNE COMMANDE EN HEREDOC QUI PARLE D’API KEY NE FAIT PAS D’UN 400 UNE PANNE D’IDENTIFIANTS',
      { timeout: 15_000 },
      async () => {
        const r = await createCodexAdapter(TOKEN).run(
          tache('Répare le test'),
          fauxCodex(
            {
              jsonl: [
                '{"type":"thread.started","thread_id":"t"}',
                '{"type":"turn.started"}',
                JSON.stringify({
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                    type: 'command_execution',
                    command:
                      "/bin/bash -lc \"python3 - <<'PY'\nimport os\nprint(os.environ.get('OPENAI_API_KEY'))  # check api key / login\nPY\"",
                    aggregated_output: 'None\n',
                    exit_code: 0,
                    status: 'completed',
                  },
                }),
                '{"type":"turn.failed","error":{"message":"unexpected status 400 Bad Request: context_length_exceeded"}}',
              ].join('\n'),
            },
            1,
          ),
        );
        expect(r.success).toBe(false);
        expect(r.infra, texteDEchec(r.logs, r.finalText)).toBeUndefined();
        expect(r.logs).toContain('┊   PY"');
      },
    );

    it(
      'UNE ERREUR NON REFAITE SUR UN TOUR CONCLU (sortie en 1) : la raison est l’erreur, jamais la réponse de l’agent',
      { timeout: 15_000 },
      async () => {
        // codex-rs/exec/src/lib.rs : une `error` sans `will_retry` fait
        // sortir en 1 même si le tour se conclut. La réponse — qui parle
        // d'API key — n'est pas ce que l'échec dit.
        const r = await createCodexAdapter(TOKEN).run(
          tache('Documente la clé'),
          fauxCodex(
            {
              jsonl: [
                '{"type":"thread.started","thread_id":"t"}',
                '{"type":"turn.started"}',
                '{"type":"error","message":"stream disconnected before completion: 400 Bad Request"}',
                '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"J’ai documenté l’API key et le login dans le README."}}',
                '{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":30}}',
              ].join('\n'),
            },
            1,
          ),
        );
        expect(r.success).toBe(false);
        expect(r.infra, texteDEchec(r.logs, r.finalText)).toBeUndefined();
        // La réponse reste la réponse : inchangée, simplement pas l'échec.
        expect(r.finalText).toBe('J’ai documenté l’API key et le login dans le README.');
        expect(texteDEchec(r.logs, r.finalText)).toBe(
          'codex : erreur signalée — stream disconnected before completion: 400 Bad Request',
        );
      },
    );

    it(
      'UNE NARRATION PLUS LONGUE QUE LE JOURNAL NE POUSSE PAS LA RAISON DEHORS : le 401 reste une panne d’infra',
      { timeout: 15_000 },
      async () => {
        const sortie = 'ligne de test verbeuse\n'.repeat(40_000); // ~900 ko
        const r = await createCodexAdapter(TOKEN).run(
          tache('Lance la suite'),
          fauxCodex(
            {
              jsonl: [
                '{"type":"thread.started","thread_id":"t"}',
                '{"type":"turn.started"}',
                JSON.stringify({
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                    type: 'command_execution',
                    command: 'npm test',
                    aggregated_output: sortie,
                    exit_code: 1,
                    status: 'failed',
                  },
                }),
                '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Incorrect API key provided"}}',
              ].join('\n'),
            },
            1,
          ),
        );
        expect(r.infra).toBe(true);
        // Ce que le nœud envoie au hub (`logs.slice(0, LIMITS.log)`) la garde.
        expect(r.logs.length).toBeLessThanOrEqual(LIMITS.log);
        expect(r.logs.slice(0, LIMITS.log)).toMatch(
          /\ncodex : tour en échec — unexpected status 401 Unauthorized: Incorrect API key provided$/,
        );
      },
    );

    it(
      'UN QUOTA CHATGPT ÉPUISÉ EST UNE PANNE D’INFRA — « usage limit », la phrase de Codex',
      { timeout: 15_000 },
      async () => {
        const r = await createCodexAdapter(TOKEN).run(
          tache('Répare le test'),
          fauxCodex(
            {
              jsonl: [
                '{"type":"thread.started","thread_id":"t"}',
                '{"type":"turn.started"}',
                // codex-rs/protocol/src/error.rs, `UsageLimitReachedError`.
                '{"type":"turn.failed","error":{"message":"You’ve hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again later."}}',
              ].join('\n'),
            },
            1,
          ),
        );
        expect(r.success).toBe(false);
        expect(r.infra).toBe(true);
      },
    );

    it(
      'UN 429 QUE CODEX A REFAIT N’EST PAS LA RAISON D’UNE SORTIE EN 1 APRÈS UN TOUR CONCLU',
      { timeout: 15_000 },
      async () => {
        // `error_seen` se lève aussi sans erreur non refaite (une requête du
        // serveur mal traitée : codex-rs/exec/src/lib.rs, `handle_server_request`).
        // La tentative « Reconnecting... » (`will_retry`) n'en est pas la raison.
        const r = await createCodexAdapter(TOKEN).run(
          tache('Répare le test'),
          fauxCodex(
            {
              jsonl: [
                '{"type":"thread.started","thread_id":"t"}',
                '{"type":"turn.started"}',
                '{"type":"error","message":"Reconnecting... 2/5 (unexpected status 429 Too Many Requests: Rate limit reached)"}',
                '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"corrigé"}}',
                '{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":30}}',
              ].join('\n'),
            },
            1,
          ),
        );
        expect(r.success).toBe(false);
        expect(r.infra, texteDEchec(r.logs, r.finalText)).toBeUndefined();
        expect(texteDEchec(r.logs, r.finalText)).toBe(
          'codex : échec — sortie en code 1 après un tour conclu, sans erreur non refaite dans le flux (raison non déclarée, voir stderr)',
        );
      },
    );

    it(
      'UN MORCEAU DE STDERR SANS FIN DE LIGNE NE DÉMARQUE PAS LA NARRATION QUI LE SUIT',
      { timeout: 15_000 },
      async () => {
        // Collée derrière « WARN partiel », la ligne `┊ codex : …API key…`
        // ne commençait plus par sa marque : ce que l'échec dit redevenait
        // les mots de l'agent, et le 400 une panne d'identifiants.
        const r = await createCodexAdapter(TOKEN).run(
          tache('Répare le test'),
          fauxCodex(
            {
              stderr: 'WARN partiel',
              jsonl: [
                '{"type":"thread.started","thread_id":"t"}',
                '{"type":"turn.started"}',
                '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Je vérifie l’API key et le login."}}',
                '{"type":"turn.failed","error":{"message":"unexpected status 400 Bad Request: context_length_exceeded"}}',
              ].join('\n'),
            },
            1,
          ),
        );
        expect(r.success).toBe(false);
        expect(r.infra, texteDEchec(r.logs, r.finalText)).toBeUndefined();
        expect(texteDEchec(r.logs, r.finalText)).toBe(
          'WARN partiel\ncodex : tour en échec — unexpected status 400 Bad Request: context_length_exceeded',
        );
      },
    );

    it(
      'UN FLUX D’UN AUTRE DIALECTE (sortie en 0, aucun tour conclu) EST UN ÉCHEC DIT, pas une réussite muette',
      { timeout: 15_000 },
      async () => {
        const r = await createCodexAdapter(TOKEN).run(
          tache('Relis'),
          fauxCodex({ jsonl: '{"id":"0","msg":{"type":"task_complete"}}\n' }, 0),
        );
        expect(r.success).toBe(false);
        expect(r.finalText).toBeUndefined();
        expect(r.logs).toContain('dialecte non reconnu (codex-cli 0.156.0 ou plus récent attendu)');
      },
    );
  },
);
