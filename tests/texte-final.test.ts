// La réponse FINALE d'un agent — lue là où son CLI la déclare, jamais dans ses
// logs.
//
// ─── D'OÙ VIENNENT LES FIXTURES ──────────────────────────────────────────────
//
// `tests/fixtures/texte-final/` contient des sorties ENREGISTRÉES sur les vrais
// binaires, pas écrites à la main :
//
//   · `claude-*.stream.jsonl` : Claude Code 2.1.283 (`claude -p --output-format
//     stream-json --verbose`), branché par ANTHROPIC_BASE_URL sur un faux
//     serveur Messages qui rendait la réponse voulue — relecture, éclaireuses,
//     et trois erreurs d'API réelles du CLI (dont deux 400 différents) ;
//   · `codex-relecture.*` : codex-cli 0.156.0 (`codex exec`), branché sur un
//     faux fournisseur Responses, avec la VRAIE consigne de critique
//     (`consigneDeCritique`) — stderr et stdout gardés séparés.
//
// Assainies seulement : chemins de travail remplacés, listes d'outils et de
// commandes de la ligne `init` réduites aux noms publics. Aucun octet de la
// réponse n'a été retouché.
//
// Les derniers cas lancent les VRAIS adaptateurs contre de faux binaires posés
// sur le PATH, qui rejouent ces enregistrements octet pour octet.

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createClineAdapter } from '../src/adapters/cline.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { createCursorAdapter } from '../src/adapters/cursor.js';
import { runCommand } from '../src/adapters/exec.js';
import type { AdapterContext } from '../src/adapters/index.js';
import {
  borneTexteFinal,
  createTexteFinalTracker,
  texteFinalCline,
  texteFinalStreamJson,
} from '../src/adapters/texte-final.js';
import { LIMITS } from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'texte-final');
const fixture = (nom: string): string => readFileSync(path.join(FIXTURES, nom), 'utf8');
const TOKEN = 'jeton-de-ruche-suffisamment-long';

/** La réponse que le faux serveur a fait rendre au relecteur Claude. */
const REPONSE_CLAUDE =
  'conteste\n' +
  "- `verifier('')` rend toujours `false` sans le dire : la garde traite `undefined`, pas le jeton vide.\n" +
  "- Aucun test ne couvre `jeton === ''` : la garde peut disparaître sans qu'un banc rougisse.";

describe('borneTexteFinal — la fin du texte, rognée, jamais vide', () => {
  it('rogne, et rend ABSENT un texte vide ou blanc', () => {
    expect(borneTexteFinal('  valide \n')).toBe('valide');
    expect(borneTexteFinal('')).toBeUndefined();
    expect(borneTexteFinal(' \n\t ')).toBeUndefined();
  });

  it('garde les DERNIERS caractères : le marqueur « en tout dernier » survit', () => {
    const marqueur = 'HIVE_AVIS {"type":"soutien","force":8,"raison":"vérifié"}';
    const texte = `${'réflexion '.repeat(2_000)}\n${marqueur}`;
    const borne = borneTexteFinal(texte)!;
    expect(borne.length).toBeLessThanOrEqual(LIMITS.finalText);
    expect(borne.endsWith(marqueur)).toBe(true);
  });

  it('ne laisse jamais un demi-caractère en tête après la coupe', () => {
    // « 🐝 » tient sur deux unités UTF-16 : une coupe au milieu laisserait la
    // seconde moitié seule en tête, une chaîne mal formée à ranger en base.
    const texte = `${'🐝'.repeat(LIMITS.finalText)}fin`;
    const borne = borneTexteFinal(texte)!;
    expect(borne.endsWith('fin')).toBe(true);
    expect(borne.isWellFormed()).toBe(true);
  });
});

describe('lire l’événement final d’un flux JSON par lignes', () => {
  const suivre = (lignes: readonly string[], lire = texteFinalStreamJson) => {
    const suivi = createTexteFinalTracker(lire);
    for (const l of lignes) suivi.feed(l);
    return suivi.texte();
  };

  it('Claude Code enregistré : la réponse du relecteur, retours à la ligne compris', () => {
    const lignes = fixture('claude-relecture.stream.jsonl').split('\n');
    expect(suivre(lignes)).toBe(REPONSE_CLAUDE);
  });

  it('Claude Code en échec : le `result` d’erreur, ou à défaut les `errors` déclarés', () => {
    const lignes = fixture('claude-echec-prompt-trop-long.stream.jsonl').split('\n');
    expect(suivre(lignes)).toBe('Prompt is too long');
    // Variante `SDKResultError` : pas de `result`, des `errors`.
    expect(
      suivre([
        JSON.stringify({ type: 'result', subtype: 'error_max_turns', errors: ['a', 42, 'b'] }),
      ]),
    ).toBe('a\nb');
    expect(suivre([JSON.stringify({ type: 'result', subtype: 'error_max_turns' })])).toBe(
      undefined,
    );
  });

  it('Cursor : même ligne `result`, `request_id` en plus — même lecture', () => {
    const ligne = {
      type: 'result',
      subtype: 'success',
      duration_ms: 10,
      duration_api_ms: 10,
      is_error: false,
      result: 'valide',
      session_id: 's',
      request_id: 'r',
    };
    expect(suivre([JSON.stringify(ligne)])).toBe('valide');
  });

  it('Cline : `text` de `run_result`, et rien d’autre', () => {
    const lignes = [
      JSON.stringify({ ts: 't', type: 'run_start', providerId: 'p', modelId: 'm' }),
      JSON.stringify({ ts: 't', type: 'result', result: 'pas le format de Cline' }),
      JSON.stringify({ ts: 't', type: 'run_result', finishReason: 'completed', text: 'valide' }),
    ];
    expect(suivre(lignes, texteFinalCline)).toBe('valide');
    expect(suivre(lignes.slice(0, 2), texteFinalCline)).toBeUndefined();
  });

  it('ignore bannières, lignes tronquées et tableaux ; la DERNIÈRE déclaration gagne', () => {
    expect(
      suivre([
        'bannière non JSON',
        '{"type":"result","result":"tronqué',
        '[{"type":"result","result":"tableau"}]',
        JSON.stringify({ type: 'result', result: 'brouillon' }),
        JSON.stringify({ type: 'assistant', message: {} }),
        JSON.stringify({ type: 'result', result: 'définitif' }),
      ]),
    ).toBe('définitif');
  });
});

// ─── LES VRAIS ADAPTATEURS, CONTRE DE FAUX BINAIRES ──────────────────────────

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Un dossier jetable qui sert à la fois de PATH et de répertoire de travail. */
function dossierJetable(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'hive-texte-final-'));
  aNettoyer.push(d);
  return d;
}

/**
 * Pose un faux binaire Node (CommonJS : un fichier sans extension n'est pas un
 * module ES) qui exécute `corps`.
 */
function fauxBinaire(dossier: string, nom: string, corps: string): string {
  const chemin = path.join(dossier, nom);
  writeFileSync(chemin, `#!/usr/bin/env node\n'use strict';\n${corps}\n`);
  chmodSync(chemin, 0o755);
  return chemin;
}

function contexte(dossier: string, signal = new AbortController().signal): AdapterContext {
  return {
    cwd: dossier,
    env: { PATH: `${dossier}${path.delimiter}${process.env.PATH ?? ''}` },
    attempt: 1,
    signal,
    onProgress: () => undefined,
  };
}

const tache = (prompt: string): Task => ({
  id: 'tache-texte-final',
  projectId: 'p',
  title: 'Relire',
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

/** Remplace une variable d'environnement le temps d'un test. */
async function avecEnv<T>(nom: string, valeur: string, f: () => Promise<T>): Promise<T> {
  const avant = process.env[nom];
  process.env[nom] = valeur;
  try {
    return await f();
  } finally {
    if (avant === undefined) delete process.env[nom];
    else process.env[nom] = avant;
  }
}

describe.skipIf(process.platform === 'win32')(
  'les vrais adaptateurs rapportent le texte final',
  () => {
    it('CLAUDE CODE : la ligne `result` du flux enregistré, pas les logs JSON', async () => {
      const dossier = dossierJetable();
      const flux = path.join(FIXTURES, 'claude-relecture.stream.jsonl');
      fauxBinaire(
        dossier,
        'claude',
        `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(flux)}));`,
      );

      const r = await createClaudeCodeAdapter(TOKEN).run(tache('relis'), contexte(dossier));

      expect(r.success, r.logs).toBe(true);
      expect(r.finalText).toBe(REPONSE_CLAUDE);
      // Les logs restent la sortie brute, complète : le texte final ne la remplace pas.
      expect(r.logs.startsWith('{"type":"system"')).toBe(true);
    });

    it(
      'CODEX : la sortie standard seule — la consigne répétée sur stderr n’y entre pas',
      { timeout: 15_000 },
      async () => {
        // Le faux `codex` fait ce que fait codex-cli 0.156.0 avec un prompt en
        // argument : il lit d'abord stdin JUSQU'À SA FIN (« Reading additional
        // input from stdin… »). Avec un tube laissé ouvert, il ne répondait
        // jamais — ce cas restait pendu jusqu'au délai de garde de 15 minutes.
        const dossier = dossierJetable();
        const stderr = path.join(FIXTURES, 'codex-relecture.stderr.txt');
        const stdout = path.join(FIXTURES, 'codex-relecture.stdout.txt');
        fauxBinaire(
          dossier,
          'codex',
          [
            "const fs = require('node:fs');",
            "process.stdin.on('data', () => undefined);",
            "process.stdin.on('end', () => {",
            `  process.stderr.write(fs.readFileSync(${JSON.stringify(stderr)}));`,
            `  process.stdout.write(fs.readFileSync(${JSON.stringify(stdout)}));`,
            '});',
          ].join('\n'),
        );

        const r = await createCodexAdapter(TOKEN).run(tache('relis'), contexte(dossier));

        expect(r.success, r.logs).toBe(true);
        expect(r.finalText).toBe('valide');
        // Le piège est bien dans les logs : la consigne, répétée, dit « conteste ».
        expect(r.logs).toContain('« valide » ou « conteste »');
      },
    );

    it('CURSOR : la ligne `result` est lue même quand les logs sont plafonnés avant elle', async () => {
      // La ligne finale arrive EN DERNIER, là où le plafond de 512 ko coupe les
      // logs d'une longue exécution. Elle doit être lue au fil de l'eau.
      const dossier = dossierJetable();
      const bin = fauxBinaire(
        dossier,
        'cursor-agent',
        [
          "const bavard = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(1000) }] } }) + '\\n';",
          'for (let i = 0; i < 700; i++) process.stdout.write(bavard);',
          "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'conteste\\n- une garde manque', session_id: 's', request_id: 'r' }) + '\\n');",
        ].join('\n'),
      );

      const r = await avecEnv('HIVE_CURSOR_BIN', bin, () =>
        createCursorAdapter(TOKEN).run(tache('relis'), contexte(dossier)),
      );

      expect(r.success, r.logs.slice(-300)).toBe(true);
      expect(r.logs).not.toContain('"type":"result"');
      expect(r.finalText).toBe('conteste\n- une garde manque');
    });

    it('CLINE : le `text` de `run_result`', async () => {
      const dossier = dossierJetable();
      const bin = fauxBinaire(
        dossier,
        'cline',
        [
          "process.stdout.write(JSON.stringify({ ts: 't', type: 'run_start', providerId: 'p', modelId: 'm' }) + '\\n');",
          "process.stdout.write(JSON.stringify({ ts: 't', type: 'run_result', finishReason: 'completed', text: 'valide' }) + '\\n');",
        ].join('\n'),
      );

      const r = await avecEnv('HIVE_CLINE_BIN', bin, () =>
        createClineAdapter(TOKEN).run(tache('relis'), contexte(dossier)),
      );

      expect(r.success, r.logs).toBe(true);
      expect(r.finalText).toBe('valide');
    });

    it('un processus TUÉ par le délai de garde n’a pas de réponse finale', async () => {
      const dossier = dossierJetable();
      const bin = fauxBinaire(
        dossier,
        'lent',
        "process.stdout.write('début de réponse'); setTimeout(() => undefined, 60_000);",
      );

      const r = await runCommand(bin, [], contexte(dossier), 300, 'sortie-standard');

      expect(r.success).toBe(false);
      expect(r.logs).toContain('début de réponse');
      expect(r.finalText).toBeUndefined();
    });

    it('sans source déclarée (le shell), aucun texte final n’est inventé', async () => {
      const dossier = dossierJetable();
      const bin = fauxBinaire(dossier, 'commande', "process.stdout.write('valide\\n');");

      const r = await runCommand(bin, [], contexte(dossier));

      expect(r.success).toBe(true);
      expect(r).not.toHaveProperty('finalText');
    });
  },
);
