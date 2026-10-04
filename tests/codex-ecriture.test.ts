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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  argvCodex,
  bacWindowsDeclare,
  createCodexAdapter,
  executionCodex,
} from '../src/adapters/codex.js';
import { createLecteurFluxCodex } from '../src/adapters/flux-codex.js';
import { LIGNE_ANNULATION } from '../src/adapters/exec.js';
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

describe('le lecteur du flux : un tour conclu où rien ne s’est écrit sous le bac de Codex', () => {
  const lire = (nom: string, bacCodexEnEcriture = true) => {
    const lecteur = createLecteurFluxCodex({ bacCodexEnEcriture });
    for (const l of readFileSync(path.join(FIXTURES, nom), 'utf8').split('\n')) lecteur.lire(l);
    return lecteur.bilan(0, false);
  };

  it.each(['bac-casse.json.stdout.jsonl', 'bac-casse-commande.json.stdout.jsonl'])(
    'LE BAC CASSÉ (enregistré, %s) : sortie en 0, correctif `failed`, aucune commande → bilan dit',
    (nom) => {
      expect(lire(nom)).toBe(
        "codex : échec — tour conclu sans que rien ne s'écrive (1 correctif(s) en échec, aucun appliqué, aucune commande réussie) : le bac de Codex n'a rien laissé faire, rien n'a été produit",
      );
    },
  );

  it.each(['rattrape-dossier.json.stdout.jsonl', 'rattrape-lecture-seule.json.stdout.jsonl'])(
    'UN CORRECTIF RATÉ DANS UN BAC SAIN, RATTRAPÉ PAR UNE COMMANDE (enregistré, %s) : une réussite',
    (nom) => {
      expect(lire(nom)).toBeUndefined();
    },
  );

  it('DANS LE BAC DE HIVE (pas de bac Codex en écriture), la règle ne s’applique pas', () => {
    expect(lire('bac-casse.json.stdout.jsonl', false)).toBeUndefined();
    // Le défaut est le même : sans option, aucun bilan de ce genre.
    const lecteur = createLecteurFluxCodex();
    for (const l of readFileSync(path.join(FIXTURES, 'bac-casse.json.stdout.jsonl'), 'utf8').split(
      '\n',
    )) {
      lecteur.lire(l);
    }
    expect(lecteur.bilan(0, false)).toBeUndefined();
  });

  it('une RELECTURE (aucun correctif tenté) reste une réussite', () => {
    expect(lire('relecture-outil.json.stdout.jsonl')).toBeUndefined();
  });

  it('un correctif en échec puis un appliqué : le travail a eu lieu, pas de bilan', () => {
    const lecteur = createLecteurFluxCodex({ bacCodexEnEcriture: true });
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

  it('une commande en ÉCHEC ne lève pas le doute : seule une commande réussie le fait', () => {
    const lecteur = createLecteurFluxCodex({ bacCodexEnEcriture: true });
    for (const e of [
      { type: 'item.completed', item: { type: 'file_change', changes: [], status: 'failed' } },
      {
        type: 'item.completed',
        item: { type: 'command_execution', command: 'x', exit_code: 1, status: 'failed' },
      },
      { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
    ]) {
      lecteur.lire(JSON.stringify(e));
    }
    expect(lecteur.bilan(0, false)).toContain('sans que rien ne s');
  });
});

describe('bacWindowsDeclare : le bac Windows de Codex, lu dans son config.toml', () => {
  it.each([
    ['[windows]\nsandbox = "unelevated"\n', true],
    ["[windows]\nsandbox = 'elevated'\n", true],
    ['[features]\nexperimental_windows_sandbox = true\n', true],
    ['[features]\nelevated_windows_sandbox = true\n', true],
    ['[features]\nenable_experimental_windows_sandbox = true\n', true],
    ['', false],
    ['[windows]\nsandbox = "mxc"\n', false],
    ['sandbox = "unelevated"\n', false],
    ['[profiles.x]\n[windows.y]\nsandbox = "unelevated"\n', false],
    ['[features]\nexperimental_windows_sandbox = false\n', false],
  ])('%j → %s', (texte, attendu) => {
    expect(bacWindowsDeclare(texte)).toBe(attendu);
  });
});

/**
 * Un faux `codex` : `codex sandbox …` (la sonde) rend `sonde` ; `codex exec`
 * rejoue l'enregistrement `scenario` et laisse un témoin — qu'il ait tourné,
 * c'est-à-dire qu'un modèle aurait été payé.
 */
function fauxCodex(
  scenario: string,
  sonde: { code: number; stderr?: string; attendMs?: number },
  cwd?: string,
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
      `  setTimeout(() => process.exit(${sonde.code}), ${sonde.attendMs ?? 0});`,
      '  return;',
      '}',
      // Le cwd que Codex voit — celui que rend le noyau, liens résolus.
      `fs.writeFileSync(${JSON.stringify(temoin)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));`,
      `process.stderr.write(fs.readFileSync(${chemin('json.stderr.txt')}));`,
      `setTimeout(() => process.stdout.write(fs.readFileSync(${chemin('json.stdout.jsonl')})), 50);`,
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  return {
    temoin,
    ctx: {
      cwd: cwd ?? dossier,
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

    // #503 × #507. Une annulation n'est plus un échec d'infra (#503) : la sonde
    // annulée rendait donc un échec ordinaire, que Codex lisait comme SON bac
    // cassé — « le bac de Codex ne démarre pas sur cet hôte », remède compris,
    // pour une tâche qu'un humain venait d'annuler.
    it.runIf(process.platform === 'linux')(
      'UNE ANNULATION PENDANT LA SONDE se dit comme telle — jamais un bac cassé, aucun modèle payé',
      { timeout: 15_000 },
      async () => {
        const { ctx, temoin } = fauxCodex('bac-casse', { code: 0, attendMs: 10_000 });
        const arret = new AbortController();
        setTimeout(() => arret.abort(), 300);
        const r = await createCodexAdapter(TOKEN).run(tache('Create hello.txt'), {
          ...ctx,
          signal: arret.signal,
        });
        expect(r.success).toBe(false);
        expect(r.infra).toBeUndefined();
        expect(existsSync(temoin)).toBe(false);
        expect(r.logs).toContain(LIGNE_ANNULATION);
        expect(texteDEchec(r.logs, r.finalText)).not.toContain('le bac de Codex');
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
        expect(texteDEchec(r.logs, r.finalText)).toContain("tour conclu sans que rien ne s'écrive");
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
        const { argv } = JSON.parse(readFileSync(temoin, 'utf8')) as { argv: string[] };
        expect(argv.slice(0, 4)).toEqual(['exec', '--json', '--sandbox', 'workspace-write']);
      },
    );

    it.each(['rattrape-dossier', 'rattrape-lecture-seule'])(
      'UN CORRECTIF RATÉ PUIS RATTRAPÉ PAR UNE COMMANDE (enregistré, %s) : la production réussit',
      { timeout: 15_000 },
      async (scenario) => {
        const { ctx } = fauxCodex(scenario, { code: 0 });
        const r = await createCodexAdapter(TOKEN).run(tache('Create hello.txt'), ctx);
        expect(r.success, r.logs).toBe(true);
      },
    );

    it(
      'UNE RELECTURE DITE PAR LE HUB tourne en `read-only`, et un refus d’écrire n’y est pas un échec',
      { timeout: 15_000 },
      async () => {
        const { ctx, temoin } = fauxCodex('lecture-seule', { code: 0 });
        const r = await createCodexAdapter(TOKEN).run(tache('Relis'), {
          ...ctx,
          role: 'relecture',
        });
        expect(r.success, r.logs).toBe(true);
        const { argv } = JSON.parse(readFileSync(temoin, 'utf8')) as { argv: string[] };
        expect(argv.slice(2, 4)).toEqual(['--sandbox', 'read-only']);
      },
    );

    it(
      'UN CWD DERRIÈRE UN LIEN (macOS : /var → /private/var) : la clé `untrusted` est le cwd que Codex voit',
      { timeout: 15_000 },
      async () => {
        const reel = dossierJetable();
        const lien = path.join(dossierJetable(), 'lien');
        symlinkSync(reel, lien);
        const { ctx, temoin } = fauxCodex('relecture-outil', { code: 0 }, lien);
        await createCodexAdapter(TOKEN).run(tache('Relis'), ctx);
        const vu = JSON.parse(readFileSync(temoin, 'utf8')) as { argv: string[]; cwd: string };
        expect(vu.cwd).toBe(realpathSync(reel));
        // Codex ne cherche que SON cwd (canonique puis tel quel) : une clé
        // posée sur le lien ne le couvrirait pas, et l'auto-confiance reviendrait.
        expect(vu.argv).toContain(`projects={${JSON.stringify(vu.cwd)}={trust_level="untrusted"}}`);
        expect(vu.argv.join(' ')).not.toContain(lien);
      },
    );

    it.runIf(process.platform === 'linux')(
      'CODEX ABSENT : la sonde rend l’échec de LANCEMENT de l’exécuteur (infra), pas un bac cassé',
      { timeout: 15_000 },
      async () => {
        const vide = dossierJetable();
        const r = await createCodexAdapter(TOKEN).run(tache('Create hello.txt'), {
          cwd: vide,
          env: { PATH: vide },
          attempt: 1,
          signal: new AbortController().signal,
          onProgress: () => undefined,
        });
        expect(r.success).toBe(false);
        expect(r.infra).toBe(true);
        expect(r.logs).toContain('échec du lancement de « codex »');
        expect(r.logs).not.toContain('le bac de Codex');
      },
    );
  },
);

describe.runIf(process.platform === 'win32')(
  'Windows : le bac de Codex, dit avant de payer',
  () => {
    it('SANS [windows] sandbox, une production échoue AVANT l’agent, remède compris', async () => {
      const maison = dossierJetable();
      const r = await createCodexAdapter(TOKEN).run(tache('Create hello.txt'), {
        cwd: dossierJetable(),
        env: { USERPROFILE: maison, PATH: '' },
        attempt: 1,
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });
      expect(r.success).toBe(false);
      expect(r.infra).toBeUndefined();
      expect(r.logs).toContain('[windows] sandbox = "unelevated"');
    });
  },
);
