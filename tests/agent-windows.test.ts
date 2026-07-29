// Lancer un agent npm sur Windows — la branche qu'on ne teste jamais.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// Sur une machine Windows où Claude Code est installé par npm, la ruche ne s'en
// servait PAS : npm n'y expose qu'un shim `claude.cmd`, que `spawn` sans shell
// ne peut pas lancer. Le nœud retombait sur l'adaptateur `shell`, qui est
// SIMULÉ — la ruche avait l'air de tourner et produisait de faux diffs.
//
// Le correctif ne passe pas par un interpréteur de commandes : il vise le
// script réel et lance Node, exactement comme `lanceur.ts` le fait pour `npm`.
// C'est plus strict que `shell: true`, pas moins — on sait quel fichier on
// exécute au lieu de déléguer la résolution à `cmd.exe`.
//
// ─── LA PROPRIÉTÉ QUI PORTE LE FICHIER ───────────────────────────────────────
//
//   ON N'AJOUTE UN CHEMIN QUE LÀ OÙ IL N'Y EN AVAIT AUCUN.
//
// Hors Windows, et sur Windows quand rien n'est déductible, le résultat est
// `[bin]` — le comportement d'avant, à l'identique. Ce correctif ne peut donc
// pas dégrader une machine qui marchait ; au pire, elle reste où elle était.
//
// La plateforme et l'environnement sont des PARAMÈTRES, et l'existence du
// fichier est INJECTÉE : c'est ce qui rend la branche Windows vérifiable depuis
// Linux. Sans ça elle ne serait éprouvée que sur la machine où l'on ne teste
// jamais — et c'est exactement ce qui avait laissé une variante `.cmd`
// impossible à lancer en place pendant des mois.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAQUETS_AGENTS,
  argvAgent,
  prefixeNpmWindows,
  scriptAgentWindows,
} from '../src/shared/agent-windows.js';

const APPDATA = 'C:\\Users\\moi\\AppData\\Roaming';
const ATTENDU = path.win32.join(
  APPDATA,
  'npm',
  'node_modules',
  '@anthropic-ai',
  'claude-code',
  'cli.js',
);

/** Un disque où seul ce qui est listé existe. */
const disque =
  (...presents: string[]) =>
  (chemin: string): boolean =>
    presents.includes(chemin);

describe('LE PRÉFIXE NPM SOUS WINDOWS', () => {
  it('`npm_config_prefix` L’EMPORTE — quelqu’un a pu le déplacer', () => {
    // `npm config set prefix` est une chose que les gens font, et rien d'autre
    // ne le trahirait : deviner `APPDATA\\npm` viserait alors un dossier vide.
    expect(prefixeNpmWindows({ npm_config_prefix: 'D:\\outils\\npm', APPDATA })).toBe(
      'D:\\outils\\npm',
    );
  });

  it('à défaut, `APPDATA\\npm` — le défaut de l’installeur Node', () => {
    expect(prefixeNpmWindows({ APPDATA })).toBe(path.win32.join(APPDATA, 'npm'));
  });

  it('sans rien pour le déduire, on ne devine pas', () => {
    expect(prefixeNpmWindows({})).toBeNull();
    expect(prefixeNpmWindows({ APPDATA: '   ' })).toBeNull();
  });
});

describe('OÙ VIT LE SCRIPT DE L’AGENT', () => {
  it('LA PORTÉE NPM EST DEUX SEGMENTS SUR LE DISQUE, PAS UN NOM', () => {
    // `@anthropic-ai/claude-code` s'écrit avec une barre, et se range en DEUX
    // dossiers. Le traiter comme un seul nom viserait un dossier inexistant —
    // et l'erreur serait invisible ici, puisqu'on ne touche pas au disque.
    expect(scriptAgentWindows('claude', { APPDATA }, 'win32')).toBe(ATTENDU);
  });

  it('HORS WINDOWS, IL N’Y A RIEN À RÉSOUDRE', () => {
    // Ailleurs, les scripts portent un shebang et `spawn` les exécute. Le
    // problème n'existe que là où l'on ne teste jamais.
    for (const plateforme of ['linux', 'darwin', 'freebsd']) {
      expect(scriptAgentWindows('claude', { APPDATA }, plateforme), plateforme).toBeNull();
    }
  });

  it('un agent qu’on ne connaît pas n’est pas deviné', () => {
    // Se tromper de point d'entrée lancerait autre chose que ce qu'on croit.
    // `HIVE_AGENT_CMD` reste la porte de sortie pour tout le reste.
    expect(scriptAgentWindows('codex', { APPDATA }, 'win32')).toBeNull();
    expect(scriptAgentWindows('un-agent-inconnu', { APPDATA }, 'win32')).toBeNull();
  });

  it('la table des paquets reste courte et explicite', () => {
    expect(Object.keys(PAQUETS_AGENTS)).toEqual(['claude']);
  });
});

describe('L’ARGV — et la promesse de ne rien dégrader', () => {
  it('SOUS WINDOWS, AVEC LE SCRIPT PRÉSENT : on lance Node dessus', () => {
    expect(argvAgent('claude', { APPDATA }, 'win32', disque(ATTENDU))).toEqual(['node', ATTENDU]);
  });

  it('LE SCRIPT ABSENT REND LE COMPORTEMENT D’AVANT — pas une commande cassée', () => {
    // ─── LA PROPRIÉTÉ QUI REND CE CORRECTIF SÛR ────────────────────────────
    //
    // Si le fichier n'est pas là, on ne fabrique pas une commande qui échouera
    // plus loin : on rend `['claude']`, exactement ce qu'on rendait avant. La
    // machine reste où elle était, et la sonde conclura « pas d'agent » comme
    // auparavant.
    expect(argvAgent('claude', { APPDATA }, 'win32', disque())).toEqual(['claude']);
  });

  it('HORS WINDOWS, RIEN NE CHANGE — même si un fichier du même nom traînait', () => {
    // Le disque dit « oui » à tout, et pourtant rien ne bouge : c'est la
    // plateforme qui décide, pas le hasard d'un chemin existant.
    expect(argvAgent('claude', { APPDATA }, 'linux', () => true)).toEqual(['claude']);
    expect(argvAgent('claude', {}, 'darwin', () => true)).toEqual(['claude']);
  });

  it('un agent inconnu n’est jamais réécrit', () => {
    expect(argvAgent('codex', { APPDATA }, 'win32', () => true)).toEqual(['codex']);
  });

  it('C’EST UN TABLEAU, ET C’EST CE QUI FAIT TENIR `shell: false`', () => {
    // Rien n'est redécoupé par un interpréteur. Un chemin qui contient une
    // espace — `C:\\Users\\Jean Dupont\\…` est on ne peut plus banal sous
    // Windows — traverserait un shell en DEUX arguments.
    const espace = 'C:\\Users\\Jean Dupont\\AppData\\Roaming';
    const attendu = path.win32.join(
      espace,
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js',
    );
    const argv = argvAgent('claude', { APPDATA: espace }, 'win32', disque(attendu));
    expect(argv).toEqual(['node', attendu]);
    expect(argv, 'le chemin reste UN seul argument').toHaveLength(2);
  });
});
