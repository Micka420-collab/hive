// L'ADAPTATEUR CURSOR — trois fonctions sur quatre n'étaient éprouvées par RIEN.
//
// ─── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
//
// `src/adapters/cursor.ts` est arrivé avec la boucle production, et la garde de
// couverture l'a dit avant nous : 1 fonction couverte sur 4. Ce n'est pas un
// détail comptable — ce module compose l'`argv` d'un PROCESSUS RÉELLEMENT
// LANCÉ sur la machine de l'ouvrière, et choisit quel binaire lancer.
//
// Les deux décisions qui comptent :
//
//   · le prompt reste DERNIER, derrière `--`. Sans ce séparateur, un prompt
//     qui commence par un tiret — « --help », « -p », ou n'importe quoi qu'un
//     humain a écrit sans y penser — serait lu par le binaire comme UNE
//     OPTION. Le `--` est la frontière entre ce que la ruche commande et ce
//     qu'un humain a dicté.
//
//   · `--force` applique les modifications. Sans lui, `agent -p` se contente
//     de PROPOSER : l'ouvrière rendrait un diff vide en croyant avoir
//     travaillé, et la ruche compterait un succès sans production.

import { describe, expect, it } from 'vitest';
import { argvCursor, binaireCursor, createCursorAdapter } from '../src/adapters/cursor.js';

describe('argvCursor — le prompt reste derrière `--`, toujours', () => {
  it('place `--` juste avant le prompt, et le prompt en dernier', () => {
    const argv = argvCursor('corrige la garde nue');
    expect(argv[argv.length - 1]).toBe('corrige la garde nue');
    expect(argv[argv.length - 2]).toBe('--');
  });

  // LE CAS QUI JUSTIFIE LE SÉPARATEUR. Sans `--`, ce prompt-là serait lu comme
  // une option par le binaire, et l'ouvrière afficherait une aide au lieu de
  // travailler — ou pire, exécuterait autre chose que ce qu'on lui demande.
  it('un prompt qui RESSEMBLE à une option reste un prompt', () => {
    const argv = argvCursor('--help stp');
    expect(argv[argv.length - 1]).toBe('--help stp');
    expect(argv[argv.length - 2]).toBe('--');
    // Et il n'apparaît nulle part AVANT le séparateur.
    expect(argv.slice(0, argv.indexOf('--'))).not.toContain('--help stp');
  });

  it('`--force` est là — sans lui, l’agent propose au lieu d’appliquer', () => {
    expect(argvCursor('x')).toContain('--force');
  });

  it('le modèle, quand il est demandé, passe AVANT le séparateur', () => {
    const argv = argvCursor('x', 'sonnet');
    const sep = argv.indexOf('--');
    expect(argv.indexOf('--model')).toBeGreaterThan(-1);
    expect(argv.indexOf('--model')).toBeLessThan(sep);
    expect(argv[argv.indexOf('--model') + 1]).toBe('sonnet');
  });

  it('sans modèle, aucun `--model` n’est inventé', () => {
    expect(argvCursor('x')).not.toContain('--model');
  });
});

describe('binaireCursor — qui gagne, et dans quel ordre', () => {
  const JAMAIS = () => false;
  const TOUJOURS = () => true;

  it('`HIVE_CURSOR_BIN` prime sur tout le reste', () => {
    const bin = binaireCursor(
      { HIVE_CURSOR_BIN: '/opt/moi/agent', HOME: '/home/abeille' },
      'linux',
      TOUJOURS,
    );
    expect(bin).toBe('/opt/moi/agent');
  });

  it('l’espace autour de `HIVE_CURSOR_BIN` est coupé, et le vide ne compte pas', () => {
    expect(binaireCursor({ HIVE_CURSOR_BIN: '  /opt/x  ', HOME: '/h' }, 'linux', JAMAIS)).toBe(
      '/opt/x',
    );
    // Vide ⇒ on retombe sur la recherche, pas sur une chaîne vide passée à spawn.
    expect(binaireCursor({ HIVE_CURSOR_BIN: '   ', HOME: '/h' }, 'linux', JAMAIS)).toBe('agent');
  });

  it('sinon, un chemin natif EXISTANT est préféré au PATH', () => {
    const vus: string[] = [];
    const bin = binaireCursor({ HOME: '/home/abeille' }, 'linux', (c) => {
      vus.push(c);
      return c.endsWith('/.local/bin/cursor-agent');
    });
    expect(bin).toBe('/home/abeille/.local/bin/cursor-agent');
    expect(vus.length, 'la recherche doit vraiment sonder le disque').toBeGreaterThan(0);
  });

  it('`cursor-agent` est cherché AVANT `agent` — l’ordre est une décision', () => {
    // Les deux existent : c'est l'ordre de la boucle qui départage.
    const bin = binaireCursor({ HOME: '/h' }, 'linux', TOUJOURS);
    expect(bin).toBe('/h/.local/bin/cursor-agent');
  });

  it('sur Windows, la recherche suit USERPROFILE et l’extension .exe', () => {
    const bin = binaireCursor({ USERPROFILE: 'C:\\Users\\Abeille' }, 'win32', (c) =>
      c.endsWith('cursor-agent.exe'),
    );
    expect(bin).toContain('cursor-agent.exe');
  });

  it('rien trouvé ⇒ `agent`, laissé au PATH', () => {
    expect(binaireCursor({ HOME: '/h' }, 'linux', JAMAIS)).toBe('agent');
    // Sans maison connue, `cheminsNatifs` rend une liste vide : même issue.
    expect(binaireCursor({}, 'linux', JAMAIS)).toBe('agent');
  });
});

describe('createCursorAdapter — il refuse de travailler sous un jeton trivial', () => {
  // La même garde que les autres adaptateurs réels. Elle est la raison pour
  // laquelle `tests/readme.test.ts` lit les `case` du `switch` au lieu
  // d'appeler `getAdapter` : ici, « il jette » veut dire « il refuse ces
  // conditions », pas « il n'existe pas ».
  it('jette sur un jeton trop court, en nommant l’adaptateur', () => {
    expect(() => createCursorAdapter('court')).toThrow(/cursor/i);
  });

  it('se construit sous un jeton solide, et s’annonce `cursor`', () => {
    const adaptateur = createCursorAdapter('x'.repeat(40));
    expect(adaptateur.name).toBe('cursor');
  });
});
