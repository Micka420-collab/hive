// Un Codex PRODUCTEUR doit pouvoir écrire — et quand il ne le peut pas, l'échec
// se DIT : jamais une réussite au diff vide.
//
// ─── D'OÙ VIENNENT LES FIXTURES ──────────────────────────────────────────────
//
// `tests/fixtures/flux-codex/`, enregistrées sur le vrai codex-cli 0.156.0
// (compte ChatGPT, consigne « Create a file named hello.txt containing the
// word hi »), chemin de travail remplacé par `/travail/tasks/tache-hive` :
//
//   · `lecture-seule.*` : l'argv d'AVANT (`codex exec --json`, sans
//     `--sandbox`) — le correctif est refusé (« writing is blocked by read-only
//     sandbox »), sortie en 0, aucun fichier ;
//   · `bac-casse.*` : `--sandbox workspace-write` avec, en tête du PATH, une
//     copie de bubblewrap que le profil AppArmor d'Ubuntu ne couvre pas
//     (`kernel.apparmor_restrict_unprivileged_userns=1`) — le correctif sort
//     `failed`, le modèle conclut, sortie en 0, aucun fichier
//     (openai/codex#46246).

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { argvCodex, createCodexAdapter, executionCodex } from '../src/adapters/codex.js';
import { createLecteurFluxCodex } from '../src/adapters/flux-codex.js';
import type { AdapterContext } from '../src/adapters/index.js';
import { fournisseurParNom, MONTAGE } from '../src/node-client/isolement.js';
import { texteDEchec } from '../src/shared/texte-d-echec.js';
import type { Task } from '../src/shared/types.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'flux-codex');
const TOKEN = 'jeton-de-ruche-suffisamment-long';

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossierJetable(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'hive-codex-ecriture-'));
  aNettoyer.push(d);
  return d;
}

describe('argvCodex : le mode suit le bac de Hive', () => {
  it('HORS BAC : workspace-write, éphémère, sans exiger de dépôt, et le dépôt jamais de confiance', () => {
    // Canonique : macOS range `os.tmpdir()` derrière un lien (`/var` → `/private/var`).
    const cwd = realpathSync(dossierJetable());
    const execution = executionCodex({ cwd });
    expect(execution).toEqual({ sandbox: 'workspace-write', depot: cwd });
    expect(argvCodex('fais-le', execution)).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--ephemeral',
      '--skip-git-repo-check',
      '-c',
      `projects={${JSON.stringify(cwd)}={trust_level="untrusted"}}`,
      '--',
      'fais-le',
    ]);
  });

  it('DANS LE BAC : danger-full-access — le bac de Hive est la frontière — et le dépôt vu est le montage', () => {
    const bac = {
      fournisseur: fournisseurParNom('bwrap')!,
      image: 'localhost/hive-agent:local',
      variables: [],
    };
    const execution = executionCodex({ cwd: '/nulle/part', bac });
    expect(execution).toEqual({ sandbox: 'danger-full-access', depot: MONTAGE });
    const argv = argvCodex('x', execution, 'gpt-5');
    expect(argv.slice(2, 6)).toEqual([
      '--sandbox',
      'danger-full-access',
      '--ephemeral',
      '--skip-git-repo-check',
    ]);
    expect(argv).toContain(`projects={"${MONTAGE}"={trust_level="untrusted"}}`);
    expect(argv.slice(-2)).toEqual(['--', 'x']);
  });

  it('un chemin avec des points reste UNE clé TOML (pas `projects."/a".b`)', () => {
    const argv = argvCodex('x', { sandbox: 'workspace-write', depot: '/w/t.1/"q"' });
    expect(argv).toContain('projects={"/w/t.1/\\"q\\""={trust_level="untrusted"}}');
  });
});

describe('le lecteur du flux : un tour conclu sans aucun correctif appliqué est un échec', () => {
  const lire = (nom: string, code: number) => {
    const lecteur = createLecteurFluxCodex();
    for (const l of readFileSync(path.join(FIXTURES, nom), 'utf8').split('\n')) lecteur.lire(l);
    return lecteur.bilan(code, false);
  };

  it('LE BAC CASSÉ (enregistré) : sortie en 0, correctif `failed` → bilan dit', () => {
    expect(lire('bac-casse.json.stdout.jsonl', 0)).toBe(
      "codex : échec — tour conclu sans qu'aucun correctif s'applique (1 en échec) : le bac de Codex n'a pas laissé écrire, rien n'a été produit",
    );
  });

  it('une RELECTURE (aucun correctif tenté) reste une réussite', () => {
    expect(lire('relecture-outil.json.stdout.jsonl', 0)).toBeUndefined();
  });

  it('un correctif en échec puis un appliqué : le travail a eu lieu, pas de bilan', () => {
    const lecteur = createLecteurFluxCodex();
    const correctif = (status: string) =>
      JSON.stringify({
        type: 'item.completed',
        item: { id: status, type: 'file_change', changes: [{ path: 'a', kind: 'add' }], status },
      });
    for (const l of [
      correctif('failed'),
      correctif('completed'),
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
    ]) {
      lecteur.lire(l);
    }
    expect(lecteur.bilan(0, false)).toBeUndefined();
  });
});

/**
 * Un faux `codex` : `codex sandbox …` (la sonde) rend `sonde` ; `codex exec`
 * rejoue l'enregistrement `scenario` et laisse un témoin — qu'il ait tourné,
 * c'est-à-dire qu'un modèle aurait été payé.
 */
function fauxCodex(
  scenario: string,
  sonde: { code: number; stderr?: string },
): { ctx: AdapterContext; temoin: string } {
  const dossier = dossierJetable();
  const temoin = path.join(dossier, 'exec-lance');
  const chemin = (nom: string) => JSON.stringify(path.join(FIXTURES, `${scenario}.${nom}`));
  const bin = path.join(dossier, 'codex');
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('node:fs');",
      "if (process.argv[2] === 'sandbox') {",
      `  process.stderr.write(${JSON.stringify(sonde.stderr ?? '')});`,
      `  process.exit(${sonde.code});`,
      '}',
      `fs.writeFileSync(${JSON.stringify(temoin)}, JSON.stringify(process.argv.slice(2)));`,
      `process.stderr.write(fs.readFileSync(${chemin('json.stderr.txt')}));`,
      `setTimeout(() => process.stdout.write(fs.readFileSync(${chemin('json.stdout.jsonl')})), 50);`,
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  return {
    temoin,
    ctx: {
      cwd: dossier,
      env: { PATH: `${dossier}${path.delimiter}${process.env.PATH ?? ''}` },
      attempt: 1,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    },
  };
}

const tache = (prompt: string): Task => ({
  id: 'tache-hive',
  projectId: 'p',
  title: 'Écrire hello.txt',
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
  'le vrai adaptateur Codex : jamais une réussite muette sans écriture',
  () => {
    it.runIf(process.platform === 'linux')(
      'LE BAC DE CODEX NE DÉMARRE PAS : échec VISIBLE avant l’agent, cause et remède, aucun modèle payé',
      { timeout: 15_000 },
      async () => {
        const { ctx, temoin } = fauxCodex('bac-casse', {
          code: 1,
          stderr: 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted\n',
        });
        const r = await createCodexAdapter(TOKEN).run(tache('Create hello.txt'), ctx);
        expect(r.success).toBe(false);
        // Pas « auth/quota » : c'est ce poste qui doit être réparé.
        expect(r.infra).toBeUndefined();
        expect(existsSync(temoin)).toBe(false);
        const dit = texteDEchec(r.logs, r.finalText);
        expect(dit).toContain("codex : échec avant l'agent — le bac de Codex");
        expect(dit).toContain('Failed RTM_NEWADDR');
        expect(dit).toContain('openai/codex#46246');
      },
    );

    it(
      'LE BAC CASSÉ QUE LA SONDE N’A PAS VU (enregistré, sortie en 0) : l’exécution est un échec dit',
      { timeout: 15_000 },
      async () => {
        const { ctx, temoin } = fauxCodex('bac-casse', { code: 0 });
        const r = await createCodexAdapter(TOKEN).run(tache('Create hello.txt'), ctx);
        expect(existsSync(temoin)).toBe(true);
        expect(r.success).toBe(false);
        expect(r.infra).toBeUndefined();
        expect(texteDEchec(r.logs, r.finalText)).toContain(
          "tour conclu sans qu'aucun correctif s'applique",
        );
      },
    );

    it(
      'UN BAC EN LECTURE SEULE (enregistré : l’argv d’avant) : la signature de Codex fait l’échec',
      { timeout: 15_000 },
      async () => {
        const { ctx } = fauxCodex('lecture-seule', { code: 0 });
        const r = await createCodexAdapter(TOKEN).run(tache('Create hello.txt'), ctx);
        expect(r.success).toBe(false);
        expect(texteDEchec(r.logs, r.finalText)).toContain(
          "le bac de Codex était en lecture seule et a refusé d'écrire",
        );
      },
    );

    it(
      'UNE RELECTURE (rien à écrire) reste une réussite, avec le nouvel argv',
      { timeout: 15_000 },
      async () => {
        const { ctx, temoin } = fauxCodex('relecture-outil', { code: 0 });
        const r = await createCodexAdapter(TOKEN).run(tache('Relis'), ctx);
        expect(r.success, r.logs).toBe(true);
        const argv = JSON.parse(readFileSync(temoin, 'utf8')) as string[];
        expect(argv.slice(0, 4)).toEqual(['exec', '--json', '--sandbox', 'workspace-write']);
      },
    );
  },
);
