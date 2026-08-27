// L'ADAPTATEUR CLINE — et la raison pour laquelle il n'emploie PAS `--`.
//
// ─── LE POINT QUI DEMANDE DE L'ATTENTION ─────────────────────────────────────
//
// `claude-code` et `cursor` posent le terminateur POSIX `--` devant le prompt,
// et c'est la bonne réponse : elle a été VÉRIFIÉE sur leur binaire. Pour
// `cline`, rien dans sa documentation ne dit qu'il le comprend. Lui en injecter
// un « par symétrie » serait supposer une grammaire — exactement ce que la
// mission interdit, et un moyen sûr de casser la commande sur une machine
// qu'on n'a pas sous la main.
//
// D'où `texteNonOption()`, que le dépôt a écrit pour ce cas précis : une espace
// de tête suffit à ce qu'aucun analyseur d'arguments ne lise une option, et ne
// veut rien dire en langage naturel. Le prompt arrive intact, y compris quand
// il commence par une liste Markdown — le cas légitime qu'un refus aurait cassé.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { argvCline, binaireCline, createClineAdapter } from '../src/adapters/cline.js';

describe('argvCline — le prompt ne peut pas devenir une option', () => {
  it('le prompt est le DERNIER argument', () => {
    const argv = argvCline('corrige la garde nue');
    expect(argv[argv.length - 1]).toBe('corrige la garde nue');
  });

  it('un prompt qui commence par un tiret est neutralisé, pas refusé', () => {
    // Le cas qui a motivé tout le module : « --version » exécuté comme option
    // sortirait sans jamais voir de prompt.
    const argv = argvCline('--version');
    expect(argv[argv.length - 1]).toBe(' --version');
    expect(argv[argv.length - 1]!.startsWith('-')).toBe(false);
  });

  it('une liste Markdown reste lisible — le cas légitime qu’un refus casserait', () => {
    const argv = argvCline('- corriger le bug\n- ajouter un banc');
    expect(argv[argv.length - 1]).toBe(' - corriger le bug\n- ajouter un banc');
  });

  it('un prompt ordinaire n’est pas touché', () => {
    expect(argvCline('bonjour').at(-1)).toBe('bonjour');
  });

  it('N’EMPLOIE PAS `--` — sa grammaire n’a pas été vérifiée', () => {
    // Ce banc défend une DÉCISION, pas un comportement heureux. Si quelqu'un
    // ajoute `--` par symétrie avec cursor.ts sans avoir éprouvé le binaire, il
    // doit relire le commentaire d'en-tête avant de rendre ce banc vert.
    expect(argvCline('bonjour')).not.toContain('--');
  });

  it('demande le JSON par lignes et l’exécution sans confirmation', () => {
    const argv = argvCline('x');
    expect(argv).toContain('--json');
    // Sans lui, `cline` attend une confirmation que personne ne donnera : la
    // tâche resterait suspendue jusqu'au délai, et la ruche compterait un échec
    // là où il n'y a qu'une question sans réponse.
    expect(argv.join(' ')).toContain('--auto-approve true');
  });

  it('l’ordre est stable — deux appels rendent le même argv', () => {
    expect(argvCline('même prompt')).toEqual(argvCline('même prompt'));
  });
});

describe('binaireCline — quel exécutable, et dans quel ordre', () => {
  it('`HIVE_CLINE_BIN` prime sur tout le reste', () => {
    expect(binaireCline({ HIVE_CLINE_BIN: '/opt/cline-a-moi' }, 'linux', () => true)).toBe(
      '/opt/cline-a-moi',
    );
  });

  it('une valeur vide ou blanche ne compte pas pour un choix', () => {
    expect(binaireCline({ HIVE_CLINE_BIN: '   ' }, 'linux', () => false)).toBe('cline');
  });

  it('un chemin natif existant est préféré au nom nu', () => {
    const trouve = binaireCline({ HOME: '/home/abeille' }, 'linux', (c) => c.includes('cline'));
    expect(trouve).not.toBe('cline');
    expect(trouve).toContain('cline');
  });

  it('sans rien sur le disque, on retombe sur le PATH', () => {
    expect(binaireCline({ HOME: '/home/abeille' }, 'linux', () => false)).toBe('cline');
  });
});

describe('l’adaptateur lui-même', () => {
  it('refuse de se construire sans un jeton de ruche solide', () => {
    // La même garde que tous les adaptateurs réels : un jeton trivial signifie
    // une démonstration, et une démonstration ne lance pas de vrai processus.
    expect(() => createClineAdapter('change-me')).toThrow();
  });

  it('porte son nom', () => {
    const a = createClineAdapter('un-jeton-de-banc-suffisamment-long-pour-passer');
    expect(a.name).toBe('cline');
  });

  it('le registre connaît `cline` — lu dans la SOURCE, pas par un appel', () => {
    // Le dépôt a consigné cette leçon deux fois, et je viens de la refaire une
    // troisième : `getAdapter()` refuse de se construire sans un HIVE_TOKEN
    // solide. Sonder le registre en l'APPELANT confond donc « cet adaptateur
    // n'existe pas » avec « cet adaptateur refuse de travailler dans ces
    // conditions » — deux échecs qui n'ont rien à voir.
    //
    // On lit la branche du `switch`, comme `agent-type-garde.test.ts` et
    // `readme.test.ts` le font déjà.
    const source = readFileSync(new URL('../src/adapters/index.ts', import.meta.url), 'utf8');
    const branches = [...source.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!);
    expect(branches).toContain('cline');
  });
});
