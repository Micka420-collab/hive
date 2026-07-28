// Le lanceur — et la seule raison pour laquelle ce module est pur.
//
// ─── CE QUE CES TESTS RATTRAPENT ─────────────────────────────────────────────
//
// La préparation d'un merge lance `npm ci`. Sur un nœud Windows, ça ne marchait
// pas : `npm` y est `npm.cmd`, et Node documente qu'un `.cmd` ne peut pas être
// lancé sans interpréteur de commandes. La fonctionnalité était INOPÉRANTE sur
// toute machine Windows, en silence, et aucune CI ne tournait là-bas pour le
// dire. Le premier run Windows l'a sorti en une ligne :
//
//     [hive] échec du lancement : spawn npm ENOENT
//
// La correction ne passe PAS par `shell: true` — la contrainte §5.1 l'interdit,
// et elle a raison : la commande vient du dépôt connecté. On vise donc
// l'exécutable RÉEL, ce qui est plus strict qu'avant.
//
// ─── ET POURQUOI CES TESTS EXISTENT PLUTÔT QUE « ÇA MARCHERA SOUS WINDOWS » ──
//
// `decider()` prend la plateforme EN PARAMÈTRE. C'est tout l'intérêt : la
// branche win32 se vérifie ici, sur Linux, à chaque CI. Sans ce paramètre, elle
// ne serait éprouvée que sur la machine où justement on ne la teste jamais —
// c'est exactement ce qui a laissé le défaut passer.

import { describe, expect, it } from 'vitest';
import { decider } from '../src/shared/lanceur.js';
import { LanceurIndisponible, resoudreLanceur } from '../src/lanceur-reel.js';

describe('SUR UN SYSTÈME POSIX, LE MODULE NE FAIT RIEN', () => {
  it('tout passe tel quel — y compris npm, qui y porte un shebang', () => {
    for (const p of ['linux', 'darwin', 'freebsd']) {
      for (const bin of ['npm', 'yarn', 'pnpm', 'mvn', 'node', 'n-importe-quoi']) {
        expect(decider(bin, p), `${bin} sur ${p}`).toEqual({ genre: 'tel-quel' });
      }
    }
  });

  it('et `resoudreLanceur` y est l’identité, arguments compris', () => {
    expect(resoudreLanceur('npm', ['ci', '--no-audit'], 'linux')).toEqual({
      bin: 'npm',
      args: ['ci', '--no-audit'],
    });
  });
});

describe('SOUS WINDOWS — la plateforme que rien n’exerçait', () => {
  it('NPM VISE L’INTERPRÉTEUR, PAS LE SHIM', () => {
    expect(decider('npm', 'win32')).toEqual({
      genre: 'via-node',
      script: 'node_modules/npm/bin/npm-cli.js',
    });
    expect(decider('npx', 'win32')).toEqual({
      genre: 'via-node',
      script: 'node_modules/npm/bin/npx-cli.js',
    });
  });

  it('le nom se reconnaît malgré l’extension et le chemin', () => {
    // C'est sous cette forme que le nom arrive parfois : `npm.cmd`, ou un
    // chemin complet. S'y tromper redonnerait un refus sur un lanceur valide.
    for (const forme of ['npm.cmd', 'NPM.CMD', 'C:\\Program Files\\nodejs\\npm.cmd', 'npm.exe']) {
      expect(decider(forme, 'win32'), forme).toMatchObject({ genre: 'via-node' });
    }
  });

  it('les VRAIS exécutables restent lancés tels quels', () => {
    // Ceux-là sont des `.exe` sous Windows : les faire passer par node serait
    // absurde, et les refuser casserait ce qui marche.
    for (const bin of ['node', 'deno', 'bun', 'go', 'cargo', 'dotnet', 'python', 'git']) {
      expect(decider(bin, 'win32'), bin).toEqual({ genre: 'tel-quel' });
    }
  });

  it('UN SHIM QU’ON NE SAIT PAS LANCER EST REFUSÉ EN LE DISANT', () => {
    // La moitié qui compte : un `ENOENT` ne se lit pas, un refus motivé si.
    for (const bin of ['yarn', 'pnpm', 'mvn', 'gradle', 'composer']) {
      const d = decider(bin, 'win32');
      expect(d.genre, bin).toBe('refus');
      const motif = d.genre === 'refus' ? d.motif : '';
      expect(motif, `${bin} : le refus doit NOMMER l’outil`).toContain(bin);
      // Et il doit dire quoi faire, pas seulement que c'est impossible.
      expect(motif.length, `${bin} : refus trop vague`).toBeGreaterThan(80);
      expect(motif).toMatch(/npm|Linux|macOS/);
    }
  });

  it('le refus NE PARLE PAS de shell:true — ce n’est pas une issue proposée', () => {
    // Garde sur l'intention : le jour où quelqu'un « débloquerait » ce chemin
    // en suggérant un interpréteur de commandes, ce test le dirait.
    const d = decider('yarn', 'win32');
    const motif = d.genre === 'refus' ? d.motif : '';
    expect(motif).not.toMatch(/shell\s*:\s*true/);
  });
});

describe('LA RÉSOLUTION DU CHEMIN, côté disque', () => {
  it('npm devient « <node> <…>/npm-cli.js », et les arguments suivent', () => {
    const vu = resoudreLanceur(
      'npm',
      ['ci'],
      'win32',
      'C:\\Program Files\\nodejs\\node.exe',
      () => true,
    );
    expect(vu.bin).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(vu.args[0]).toMatch(/npm-cli\.js$/);
    expect(vu.args.slice(1)).toEqual(['ci']);
  });

  it('UN SCRIPT ABSENT SE DIT, il ne se suppose pas', () => {
    // Sans cette vérification, une installation Node exotique repartirait pour
    // un ENOENT illisible — celui-là même qu'on est en train de supprimer.
    expect(() =>
      resoudreLanceur('npm', ['ci'], 'win32', 'C:\\nodejs\\node.exe', () => false),
    ).toThrow(LanceurIndisponible);
  });

  it('le refus remonte comme LanceurIndisponible, pas comme une Error nue', () => {
    // L'appelant doit pouvoir distinguer « la ruche refuse » de « le système a
    // répondu ENOENT » — c'est ce qui lui permet d'écrire un message utile.
    let capture: unknown;
    try {
      resoudreLanceur('yarn', [], 'win32', 'C:\\nodejs\\node.exe', () => true);
    } catch (e) {
      capture = e;
    }
    expect(capture).toBeInstanceOf(LanceurIndisponible);
    expect((capture as LanceurIndisponible).motif).toContain('yarn');
  });

  it('sur cette machine-ci, npm reste npm — aucune régression POSIX', () => {
    // Le test qui protège les 2000 autres : si la résolution se déclenchait
    // hors Windows, toute la suite d'exécution changerait de binaire.
    const vu = resoudreLanceur('npm', ['ci']);
    if (process.platform === 'win32') {
      expect(vu.bin).toBe(process.execPath);
    } else {
      expect(vu).toEqual({ bin: 'npm', args: ['ci'] });
    }
  });
});
