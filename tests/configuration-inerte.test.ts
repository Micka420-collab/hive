// Cursor et Cline n'exécutent plus les hooks ni les plugins du dépôt d'une tâche.
//
// Ni l'un ni l'autre n'a de drapeau pour les couper (PR #508, audit) : Cursor
// en mode print (`--force` = confiance du dossier) lance les hooks de
// `.cursor/hooks.json` et, au format Claude, de `.claude/settings*.json` ;
// Cline lance ceux de `.clinerules/hooks/` et `.cline/hooks/` et charge
// `.cline/plugins/` comme du code. Le nœud les ÉCARTE de l'arbre avant l'agent
// et les REMET avant le diff (`src/node-client/configuration-inerte.ts`).
//
// Ce banc tient trois promesses :
//   · rien de ce que le dépôt apporte ne tourne — un dépôt témoin porte chaque
//     vecteur, et `fixtures/chargeurs-config-agent.mjs` rejoue la découverte de
//     chaque CLI (le banc vérifie d'abord qu'il est ARMÉ : sans écartement,
//     chaque témoin s'allume) ;
//   · le diff est celui qu'on aurait eu sans écartement — aucune suppression
//     fantôme, la configuration remise octet pour octet ;
//   · git ne les ressuscite pas pendant l'exécution (`checkout`, `reset
//     --hard`, `stash`, ni un `pull --rebase` qui amène la version que
//     l'auteur a poussée APRÈS l'envoi), même sous une autre casse, et une panne d'écartement REFUSE la tâche au lieu de
//     lancer l'agent avec une configuration à moitié écartée.
// Les bancs sans lien ni binaire tournent sur les trois OS ; ceux qui posent
// des liens symboliques, retirent des droits ou lancent un faux CLI par
// l'adaptateur réel sont POSIX.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIGURATION_EXECUTEE_CLINE, createClineAdapter } from '../src/adapters/cline.js';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { CONFIGURATION_EXECUTEE_CURSOR, createCursorAdapter } from '../src/adapters/cursor.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import {
  ConfigurationNonNeutralisable,
  ecarterConfiguration,
  noteConfigurationEcartee,
  reserveDeConfiguration,
} from '../src/node-client/configuration-inerte.js';
import { prepareWorkspace } from '../src/node-client/workspace.js';
import { createServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-configuration-inerte-long';
const POSIX = process.platform !== 'win32';
const RACINE_OU_ADMIN = typeof process.getuid === 'function' && process.getuid() === 0;
const CHARGEURS = fileURLToPath(new URL('./fixtures/chargeurs-config-agent.mjs', import.meta.url));

/** Identité et réglages des commits FABRIQUÉS par le banc — rien de la personne. */
const REGLAGES_BANC = [
  '-c',
  'user.email=banc@hive.local',
  '-c',
  'user.name=Banc Hive',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossierJetable(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'hive-config-inerte-'));
  aNettoyer.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...REGLAGES_BANC, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * git DANS la tâche, comme l'agent le lance : la configuration de la machine
 * telle quelle. Sous Windows, le `core.autocrlf=true` du système a écrit le
 * clone ; le forcer à `false` ici ferait voir chaque fichier modifié.
 */
function gitAgent(cwd: string, ...args: string[]): string {
  return git(cwd, '-c', `core.autocrlf=${autocrlfDeLaMachine()}`, ...args);
}

function autocrlfDeLaMachine(): string {
  try {
    return execFileSync('git', ['config', '--get', 'core.autocrlf'], { encoding: 'utf8' }).trim();
  } catch {
    return 'false';
  }
}

function ecrire(racine: string, relatif: string, contenu: string): void {
  const chemin = path.join(racine, ...relatif.split('/'));
  mkdirSync(path.dirname(chemin), { recursive: true });
  writeFileSync(chemin, contenu);
}

/** Un script de hook qui allume le témoin `nom` dans `HIVE_TEMOINS`. */
const temoin = (nom: string): string =>
  `require('fs').writeFileSync(require('path').join(process.env.HIVE_TEMOINS, ${JSON.stringify(nom)}), 'allumé\\n');\n`;

/** Chaque vecteur, par CLI, avec le témoin qu'il allume. */
const VECTEURS = {
  cursor: ['cursor-hooks-json', 'claude-settings', 'claude-settings-local'],
  cline: ['clinerules-hooks', 'cline-hooks', 'cline-plugins'],
} as const;

/** Les consignes du dépôt : ce ne sont pas du code, elles restent visibles. */
const CONSIGNES = ['.cursor/rules/style.mdc', '.clinerules/regles.md', '.cline/rules/style.md'];

function fichiersDuDepotPiege(): Record<string, string> {
  const commande = (script: string): string => `node ${script}`;
  return {
    'src/a.txt': 'base\n',
    'README.md': '# dépôt piégé\n',
    '.cursor/hooks.json': JSON.stringify({
      version: 1,
      hooks: { sessionStart: [{ command: commande('.cursor/hooks/temoin.js') }] },
    }),
    '.cursor/hooks/temoin.js': temoin('cursor-hooks-json'),
    '.claude/settings.json': JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: commande('.claude/temoin.js') }] },
        ],
      },
    }),
    '.claude/temoin.js': temoin('claude-settings'),
    '.claude/settings.local.json': JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: commande('.claude/temoin-local.js') }],
          },
        ],
      },
    }),
    '.claude/temoin-local.js': temoin('claude-settings-local'),
    '.clinerules/hooks/TaskStart.js': temoin('clinerules-hooks'),
    '.cline/hooks/PreToolUse.js': temoin('cline-hooks'),
    '.cline/plugins/espion.js': temoin('cline-plugins'),
    '.cursor/rules/style.mdc': 'tabulations\n',
    '.clinerules/regles.md': 'français\n',
    '.cline/rules/style.md': 'dense\n',
  };
}

/** Un dépôt amont committé, cloné ensuite par `prepareWorkspace` comme une vraie tâche. */
function amont(fichiers: Record<string, string>, liens: Record<string, string> = {}): string {
  const depot = path.join(dossierJetable(), 'amont');
  mkdirSync(depot, { recursive: true });
  git(depot, 'init', '-q', '-b', 'main');
  for (const [relatif, contenu] of Object.entries(fichiers)) ecrire(depot, relatif, contenu);
  for (const [lien, cible] of Object.entries(liens)) symlinkSync(cible, path.join(depot, lien));
  git(depot, 'add', '-A');
  git(depot, 'commit', '-q', '-m', 'base');
  return depot;
}

const tache = (id: string): Task => ({
  id,
  projectId: 'p',
  title: 'Travailler dans un dépôt piégé',
  prompt: 'ajouter une ligne',
  status: 'assigned',
  dependsOn: [],
  assignedNodeId: 'n',
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
});

/** Rejoue ce que le CLI charge du dépôt dans `racine` ; rend les témoins allumés. */
function charger(agent: 'cursor' | 'cline', racine: string): string[] {
  const temoins = dossierJetable();
  execFileSync(process.execPath, [CHARGEURS, agent, racine], {
    env: { ...process.env, HIVE_TEMOINS: temoins },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return readdirSync(temoins).sort();
}

describe('le banc est armé : sans écartement, chaque vecteur tourne', () => {
  it.each(['cursor', 'cline'] as const)('%s allume tous ses témoins', async (agent) => {
    const ws = await prepareWorkspace(
      dossierJetable(),
      tache(`arme-${agent}`),
      amont(fichiersDuDepotPiege()),
    );
    expect(ws.configurationEcartee).toEqual([]);
    expect(charger(agent, ws.cwd)).toEqual([...VECTEURS[agent]].sort());
  });
});

describe('écartée de l’arbre pendant l’exécution, remise avant le diff', () => {
  it.each([
    ['cursor', CONFIGURATION_EXECUTEE_CURSOR],
    ['cline', CONFIGURATION_EXECUTEE_CLINE],
  ] as const)(
    '%s : aucun témoin, consignes visibles, réserve hors de la tâche',
    async (agent, declares) => {
      const ws = await prepareWorkspace(
        dossierJetable(),
        tache(`inerte-${agent}`),
        amont(fichiersDuDepotPiege()),
        [],
        '',
        false,
        declares,
      );
      expect(ws.configurationEcartee).toEqual([...declares].sort());
      expect(charger(agent, ws.cwd)).toEqual([]);
      for (const consigne of CONSIGNES) expect(existsSync(path.join(ws.cwd, consigne))).toBe(true);
      // La réserve vit À CÔTÉ de la tâche : le bac ne monte que la tâche.
      const reserve = reserveDeConfiguration(ws.cwd);
      expect(existsSync(reserve)).toBe(true);
      expect(path.relative(ws.cwd, reserve).startsWith('..')).toBe(true);
      await ws.collectDiff();
      expect(existsSync(reserve)).toBe(false);
      ws.cleanup();
    },
  );

  it.each([
    ['cursor', CONFIGURATION_EXECUTEE_CURSOR],
    ['cline', CONFIGURATION_EXECUTEE_CLINE],
  ] as const)(
    '%s : UNE REPRISE sur la branche de sa PR (#518) écarte aussi la configuration',
    async (agent, declares) => {
      // La branche livrée porte le dépôt piégé, comme `main` : une reprise
      // la clone à sa tête au lieu de créer la sienne — et l'agent n'y
      // exécute pas davantage les hooks du dépôt.
      const depot = amont(fichiersDuDepotPiege());
      git(depot, 'checkout', '-q', '-b', 'hive/livree');
      ecrire(depot, 'src/travail.ts', 'export const livre = 1;\n');
      git(depot, 'add', '-A');
      git(depot, 'commit', '-q', '-m', 'le travail livré');
      git(depot, 'checkout', '-q', 'main');
      const ws = await prepareWorkspace(
        dossierJetable(),
        { ...tache(`reprise-${agent}`), branch: 'hive/livree' },
        depot,
        [],
        '',
        true,
        declares,
      );
      expect(ws.branch).toBe('hive/livree');
      expect(existsSync(path.join(ws.cwd, 'src', 'travail.ts')), 'la tête de la PR').toBe(true);
      expect(ws.configurationEcartee).toEqual([...declares].sort());
      expect(charger(agent, ws.cwd)).toEqual([]);
      await ws.collectDiff();
      ws.cleanup();
    },
  );

  it('le diff est celui d’un arbre jamais écarté, et la configuration revient octet pour octet', async () => {
    const depot = amont(fichiersDuDepotPiege());
    const produire = (cwd: string): void => {
      writeFileSync(path.join(cwd, 'src', 'a.txt'), 'base\nligne de l’agent\n');
      writeFileSync(path.join(cwd, 'nouveau.txt'), 'nouveau\n');
      rmSync(path.join(cwd, 'README.md'));
    };
    const jamaisEcarte = await prepareWorkspace(dossierJetable(), tache('diff-temoin'), depot);
    produire(jamaisEcarte.cwd);
    const attendu = await jamaisEcarte.collectDiff();

    const ws = await prepareWorkspace(
      dossierJetable(),
      tache('diff-ecarte'),
      depot,
      [],
      '',
      false,
      [...CONFIGURATION_EXECUTEE_CURSOR, ...CONFIGURATION_EXECUTEE_CLINE],
    );
    produire(ws.cwd);
    const diff = await ws.collectDiff();
    expect(diff).toBe(attendu);
    expect(diff).toContain('nouveau.txt');
    expect(diff).not.toMatch(/\.cursor|\.claude|\.cline/);
    // Contre l'arbre jamais écarté, pas contre les chaînes du banc : sous
    // Windows, le `core.autocrlf` du système réécrit les fins de ligne au clone.
    for (const relatif of Object.keys(fichiersDuDepotPiege())) {
      if (relatif === 'src/a.txt' || relatif === 'README.md') continue;
      expect(readFileSync(path.join(ws.cwd, relatif)), relatif).toEqual(
        readFileSync(path.join(jamaisEcarte.cwd, relatif)),
      );
    }
    // Idempotent : un second diff ne remet rien deux fois.
    expect(await ws.collectDiff()).toBe(attendu);
  });

  it('ce que l’agent a écrit à ces chemins reste le sien, et le diff le montre', async () => {
    const ws = await prepareWorkspace(
      dossierJetable(),
      tache('collision'),
      amont(fichiersDuDepotPiege()),
      [],
      '',
      false,
      [...CONFIGURATION_EXECUTEE_CURSOR, ...CONFIGURATION_EXECUTEE_CLINE],
    );
    ecrire(ws.cwd, '.cursor/hooks.json', '{"version":1,"hooks":{}}\n');
    ecrire(ws.cwd, '.cline/hooks/PostToolUse.js', '// hook de l’agent\n');
    const diff = await ws.collectDiff();
    expect(diff).toContain('diff --git a/.cursor/hooks.json b/.cursor/hooks.json');
    expect(diff).toContain('+{"version":1,"hooks":{}}');
    expect(diff).toContain('b/.cline/hooks/PostToolUse.js');
    // Le hook du dépôt, dans le même dossier, est remis — pas supprimé.
    expect(diff).not.toContain('PreToolUse.js');
    expect(existsSync(path.join(ws.cwd, '.cline', 'hooks', 'PreToolUse.js'))).toBe(true);
  });
});

describe('git ne les ressuscite pas pendant l’exécution', () => {
  it('`git status` propre ; checkout, reset --hard, stash, restore ne les recréent pas', async () => {
    const ws = await prepareWorkspace(
      dossierJetable(),
      tache('git-agent'),
      amont(fichiersDuDepotPiege()),
      [],
      '',
      false,
      [...CONFIGURATION_EXECUTEE_CURSOR, ...CONFIGURATION_EXECUTEE_CLINE],
    );
    const absents = (): boolean =>
      [...CONFIGURATION_EXECUTEE_CURSOR, ...CONFIGURATION_EXECUTEE_CLINE].every(
        (c) => !existsSync(path.join(ws.cwd, c)),
      );
    // Le `.git` de la tâche, comme l'agent le voit.
    expect(gitAgent(ws.cwd, 'status', '--porcelain')).toBe('');
    writeFileSync(path.join(ws.cwd, 'src', 'a.txt'), 'modifié\n');
    gitAgent(ws.cwd, 'checkout', '--', '.');
    expect(absents()).toBe(true);
    gitAgent(ws.cwd, 'restore', '.');
    expect(absents()).toBe(true);
    gitAgent(ws.cwd, 'reset', '-q', '--hard');
    expect(absents()).toBe(true);
    writeFileSync(path.join(ws.cwd, 'src', 'a.txt'), 'modifié\n');
    gitAgent(ws.cwd, 'stash', '-q');
    gitAgent(ws.cwd, 'stash', 'pop', '-q');
    expect(absents()).toBe(true);
    expect(charger('cursor', ws.cwd)).toEqual([]);
    expect(charger('cline', ws.cwd)).toEqual([]);
    // Et le diff, lui, ne voit que ce qui a vraiment changé.
    const diff = await ws.collectDiff();
    expect(diff).toContain('+modifié');
    expect(diff).not.toMatch(/\.cursor|\.claude|\.cline/);
  });
});

describe('ni la version que l’auteur pousse APRÈS l’envoi de la tâche', () => {
  it('`pull --rebase`, `checkout <rév>`, `reset --hard <rév>` : rien ne revient, pas même un vecteur neuf', async () => {
    // `.clinerules/hooks` n'existe pas encore : l'auteur l'amènera par un commit.
    const { '.clinerules/hooks/TaskStart.js': _absent, ...depart } = fichiersDuDepotPiege();
    const depot = amont(depart);
    const ws = await prepareWorkspace(
      dossierJetable(),
      tache('pousse-apres'),
      depot,
      [],
      '',
      false,
      [...CONFIGURATION_EXECUTEE_CURSOR, ...CONFIGURATION_EXECUTEE_CLINE],
    );
    const absents = (): string[] =>
      [...CONFIGURATION_EXECUTEE_CURSOR, ...CONFIGURATION_EXECUTEE_CLINE].filter((c) =>
        existsSync(path.join(ws.cwd, c)),
      );
    ecrire(depot, '.cursor/hooks.json', '{"version":1,"hooks":{"stop":[]}}\n');
    ecrire(depot, '.cline/hooks/PreToolUse.js', `${temoin('cline-hooks')}// v2\n`);
    ecrire(depot, '.clinerules/hooks/TaskStart.js', temoin('clinerules-hooks'));
    ecrire(depot, 'src/b.txt', 'amont\n');
    git(depot, 'add', '-A');
    git(depot, 'commit', '-q', '-m', 'hooks poussés après l’envoi');

    // Une « synchronisation avec main » d'allure anodine, par le git de l'agent.
    gitAgent(ws.cwd, 'pull', '-q', '--rebase', 'origin', 'main');
    expect(existsSync(path.join(ws.cwd, 'src', 'b.txt'))).toBe(true);
    expect(absents()).toEqual([]);
    expect(gitAgent(ws.cwd, 'status', '--porcelain')).toBe('');
    gitAgent(ws.cwd, 'checkout', '-q', 'HEAD~1');
    expect(absents()).toEqual([]);
    gitAgent(ws.cwd, 'reset', '-q', '--hard', 'origin/main');
    expect(absents()).toEqual([]);
    expect(charger('cursor', ws.cwd)).toEqual([]);
    expect(charger('cline', ws.cwd)).toEqual([]);

    // Remise : l'ORIGINAL revient, le diff ne montre que ce que l'agent a tiré.
    const diff = await ws.collectDiff();
    expect(diff).toContain('b/src/b.txt');
    expect(diff).not.toMatch(/\.cursor|\.claude|\.cline/);
  });

  it('sous `core.ignorecase=true`, une variante de casse est écartée, cachée à git et remise sous SON nom', async () => {
    // Cursor ouvre `.cursor/hooks.json` : sur un disque insensible à la casse
    // (macOS, Windows), c'est `.Cursor/Hooks.json` qu'il lit. Les motifs de
    // git et le déplacement doivent viser le nom RÉEL.
    const clone = path.join(dossierJetable(), 'clone');
    execFileSync('git', [
      'clone',
      '-q',
      amont({ 'src/a.txt': 'base\n', '.Cursor/Hooks.json': '{"version":1}\n' }),
      clone,
    ]);
    git(clone, 'config', 'core.ignorecase', 'true');
    const depot = { gitDir: path.join(clone, '.git'), workTree: clone };
    const ecartee = await ecarterConfiguration(depot, CONFIGURATION_EXECUTEE_CURSOR);
    expect(ecartee.chemins).toEqual(['.Cursor/Hooks.json']);
    expect(gitAgent(clone, 'ls-files', '-v', '--', '.Cursor')).toBe('S .Cursor/Hooks.json\n');
    expect(gitAgent(clone, 'status', '--porcelain')).toBe('');
    gitAgent(clone, 'checkout', '--', '.');
    expect(existsSync(path.join(clone, '.Cursor', 'Hooks.json'))).toBe(false);
    ecartee.remettre();
    expect(readdirSync(path.join(clone, '.Cursor'))).toEqual(['Hooks.json']);
  });
});

describe.runIf(POSIX)('liens symboliques : le lien part, jamais sa cible', () => {
  it('un `.cline` lien est écarté tel quel, puis remis', async () => {
    const fichiers = {
      'src/a.txt': 'base\n',
      'config-cline/hooks/TaskStart.js': temoin('cline-hooks'),
      'config-cline/plugins/espion.js': temoin('cline-plugins'),
    };
    const ws = await prepareWorkspace(
      dossierJetable(),
      tache('lien-cline'),
      amont(fichiers, { '.cline': 'config-cline' }),
      [],
      '',
      false,
      CONFIGURATION_EXECUTEE_CLINE,
    );
    expect(ws.configurationEcartee).toEqual(['.cline']);
    expect(charger('cline', ws.cwd)).toEqual([]);
    // La cible, elle, n'a pas bougé : ce n'est pas un chemin de Cline.
    expect(existsSync(path.join(ws.cwd, 'config-cline', 'hooks', 'TaskStart.js'))).toBe(true);
    expect(await ws.collectDiff()).toBe('');
  });

  it('un lien posé par l’agent sur le chemin n’est jamais traversé à la remise', async () => {
    const ws = await prepareWorkspace(
      dossierJetable(),
      tache('lien-agent'),
      amont(fichiersDuDepotPiege()),
      [],
      '',
      false,
      CONFIGURATION_EXECUTEE_CURSOR,
    );
    const dehors = dossierJetable();
    rmSync(path.join(ws.cwd, '.claude'), { recursive: true });
    symlinkSync(dehors, path.join(ws.cwd, '.claude'));
    await ws.collectDiff();
    // Rien n'a été écrit HORS de la tâche, sur l'hôte.
    expect(readdirSync(dehors)).toEqual([]);
  });
});

describe('une panne d’écartement refuse la tâche', () => {
  it.runIf(POSIX && !RACINE_OU_ADMIN)(
    'rien ne reste écarté, et l’erreur dit quoi et où',
    async () => {
      const clone = path.join(dossierJetable(), 'clone');
      execFileSync('git', ['clone', '-q', amont(fichiersDuDepotPiege()), clone]);
      const depot = { gitDir: path.join(clone, '.git'), workTree: clone };
      // `.cursor` en lecture seule : `.claude/*` part d'abord, puis le renommage
      // de `.cursor/hooks.json` échoue.
      chmodSync(path.join(clone, '.cursor'), 0o555);
      try {
        const echec = await ecarterConfiguration(depot, CONFIGURATION_EXECUTEE_CURSOR).then(
          () => null,
          (e: unknown) => e,
        );
        expect(echec).toBeInstanceOf(ConfigurationNonNeutralisable);
        expect((echec as Error).message).toBe(
          'hooks du dépôt non neutralisables : EACCES (.cursor/hooks.json)',
        );
        expect((echec as Error).message.length).toBeLessThanOrEqual(120);
        expect(existsSync(path.join(clone, '.claude', 'settings.json'))).toBe(true);
        expect(existsSync(path.join(clone, '.claude', 'settings.local.json'))).toBe(true);
        expect(existsSync(reserveDeConfiguration(clone))).toBe(false);
        expect(git(clone, 'status', '--porcelain')).toBe('');
      } finally {
        chmodSync(path.join(clone, '.cursor'), 0o755);
      }
    },
  );
});

describe('qui déclare quoi', () => {
  it('Cursor et Cline déclarent leurs vecteurs ; Claude Code et Codex n’en ont pas besoin', () => {
    expect(createCursorAdapter(TOKEN).configurationExecutee).toEqual(CONFIGURATION_EXECUTEE_CURSOR);
    expect(createClineAdapter(TOKEN).configurationExecutee).toEqual(CONFIGURATION_EXECUTEE_CLINE);
    // Claude Code : `--setting-sources user` et hooks coupés (claude-code.ts) ;
    // Codex : couche projet désactivée sans confiance explicite (PR #508).
    expect(createClaudeCodeAdapter(TOKEN).configurationExecutee).toBeUndefined();
    expect(createCodexAdapter(TOKEN).configurationExecutee).toBeUndefined();
  });

  it('la note du journal cite ce qui a été écarté', () => {
    expect(noteConfigurationEcartee(['.cline/hooks', '.cline/plugins'])).toBe(
      "configuration d'agent du dépôt ignorée (hooks, plugins) : .cline/hooks, .cline/plugins — " +
        "écartée de l'arbre pendant l'exécution, remise avant le diff",
    );
  });
});

// ─── PAR LE VRAI NŒUD ET LES VRAIS ADAPTATEURS ─────────────────────────────
//
// Une Reine réelle, `HiveNodeClient`, l'adaptateur Cursor ou Cline tel que le
// nœud le crée, et un faux CLI (`HIVE_CURSOR_BIN` / `HIVE_CLINE_BIN`) qui rejoue
// la découverte du vrai puis produit une ligne. POSIX : le faux CLI est un
// script `sh`.
describe.runIf(POSIX)('par le nœud : aucun témoin, un diff exact, la note au journal', () => {
  it.each([
    ['cursor', 'HIVE_CURSOR_BIN', createCursorAdapter],
    ['cline', 'HIVE_CLINE_BIN', createClineAdapter],
  ] as const)('%s', { timeout: 60_000 }, async (agent, variable, creer) => {
    const racine = dossierJetable();
    const temoins = path.join(racine, 'temoins');
    mkdirSync(temoins);
    const faux = path.join(racine, `faux-${agent}`);
    writeFileSync(
      faux,
      `#!/bin/sh\nHIVE_TEMOINS='${temoins}' HIVE_PRODUIRE=1 exec '${process.execPath}' '${CHARGEURS}' ${agent}\n`,
    );
    chmodSync(faux, 0o755);
    const avant = process.env[variable];
    process.env[variable] = faux;
    const server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(racine, 'hive.db'),
      simulation: false,
      tickMs: 20,
    });
    const adapter: AgentAdapter = creer(TOKEN);
    const client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: `noeud-${agent}`,
      ownerName: 'banc',
      agentType: 'custom',
      nodeId: `noeud-${agent}`,
      maxConcurrency: 1,
      workRoot: path.join(racine, 'work'),
      adapter,
      quiet: true,
    });
    client.start();
    const attendre = async (condition: () => boolean, message: string): Promise<void> => {
      const limite = Date.now() + 30_000;
      while (Date.now() < limite) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(message);
    };
    try {
      await attendre(
        () => server.store.listNodes().some((n) => n.id === `noeud-${agent}`),
        'le nœud ne rejoint pas la ruche',
      );
      const projet = server.store.createProject({
        name: `Dépôt piégé ${agent}`,
        repoUrl: amont(fichiersDuDepotPiege()),
      });
      const t = server.store.createTask({
        projectId: projet.id,
        title: 'Ajouter une ligne',
        prompt: 'ajouter une ligne à src/a.txt',
      });
      server.store.patchTask(t.id, { status: 'ready' });
      await attendre(
        () => server.store.resultsForTask(t.id).length > 0,
        'aucun résultat de la tâche',
      );
      const resultat = server.store.resultsForTask(t.id).at(-1);
      expect(resultat?.success, resultat?.logs).toBe(true);
      expect(readdirSync(temoins)).toEqual([]);
      expect(resultat?.diff).toContain('+ligne de l’agent');
      expect(resultat?.diff).not.toMatch(/\.cursor|\.claude|\.cline/);
      const notes = server.store
        .listEvents(0, 1000)
        .filter((e) => e.type === 'task_progress' && e.payload.taskId === t.id)
        .map((e) => e.payload.log);
      expect(notes).toContain(noteConfigurationEcartee([...adapter.configurationExecutee!].sort()));
    } finally {
      client.stop();
      await server.stop();
      if (avant === undefined) delete process.env[variable];
      else process.env[variable] = avant;
    }
  });
});
