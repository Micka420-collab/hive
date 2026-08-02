// « Lancer la ruche » — la composition, éprouvée sans démarrer un serveur.
//
// ─── LE DÉFAUT QUE ÇA RETIRE ────────────────────────────────────────────────
//
// Faire tourner une ruche demandait TROIS terminaux, et l'écran final de
// l'installeur listait cinq commandes sans dire lesquelles vont ensemble.
// Quelqu'un qui n'en lance qu'une voit une ruche qui « ne fait rien » — sans
// nœud, aucune tâche n'est exécutée — ou un écran vide.
//
// ─── POURQUOI CE FICHIER PEUT EXISTER ───────────────────────────────────────
//
// Parce que `demarrage.ts` ne lance rien : il CALCULE les commandes. La partie
// où l'on se trompe — un chemin, un ordre, un shim Windows — devient donc
// vérifiable sans ouvrir un port, depuis n'importe quelle plateforme.
//
// La garde qui compte est la dernière : les scripts visés doivent EXISTER sur
// le disque. Un chemin faux ne se voit qu'au `spawn`, par un ENOENT laconique
// noyé dans la sortie des processus qui, eux, ont démarré.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENTREES,
  SCRIPTS,
  largeurEtiquettes,
  pieces,
  prefixe,
  voeuDepuisArgv,
} from '../src/shared/demarrage.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const NODE = '/usr/bin/node';

describe('CE QU’ON LANCE, ET DANS QUEL ORDRE', () => {
  it('SANS DRAPEAU : les trois pièces — c’est tout l’objet de la commande', () => {
    const noms = pieces(NODE).map((p) => p.nom);
    expect(noms).toHaveLength(3);
    expect(noms).toContain('reine');
    expect(noms).toContain('ouvrière');
    expect(noms).toContain('écran');
  });

  it('LA REINE DÉMARRE AVANT L’OUVRIÈRE', () => {
    // ─── LA SEULE SUBTILITÉ DE CE MODULE ───────────────────────────────────
    //
    // Le nœud se connecte au hub. Le lancer en premier lui fait manquer sa
    // cible : il reconnecte, donc ça marche — mais l'humain lit une erreur de
    // connexion au démarrage de sa toute première ruche, ce qui est le pire
    // moment possible pour en voir une.
    const noms = pieces(NODE).map((p) => p.nom);
    expect(noms.indexOf('reine')).toBeLessThan(noms.indexOf('ouvrière'));
  });

  it('AUCUNE PIÈCE NE PASSE PAR `npm`, `npx` NI UN `.cmd`', () => {
    // ─── LE DÉFAUT QUI A DÉJÀ MORDU DEUX FOIS ──────────────────────────────
    //
    // Sous Windows `npm` est `npm.cmd`, et `spawn(…, { shell: false })` ne sait
    // pas lancer un `.cmd`. C'est le § 6.2 du journal. Viser le script réel et
    // lancer Node dessus est PLUS strict qu'autoriser un interpréteur, pas
    // moins : on sait quel fichier s'exécute.
    for (const p of pieces(NODE)) {
      expect(p.bin, `${p.nom} doit être lancé par le Node courant`).toBe(NODE);
      const tout = [p.bin, ...p.argv].join(' ');
      expect(tout, `${p.nom} ne doit pas viser un shim`).not.toMatch(/\.cmd\b|\bnpx\b|\bnpm run\b/);
    }
  });

  it('L’ARGV EST UN TABLEAU — c’est ce qui fait tenir `shell: false`', () => {
    // Un chemin qui contient une espace — `C:\Users\Jean Dupont\…` est banal
    // sous Windows — traverserait un interpréteur en DEUX arguments.
    for (const p of pieces(NODE)) {
      expect(Array.isArray(p.argv)).toBe(true);
      for (const a of p.argv) expect(typeof a).toBe('string');
    }
  });

  it('chaque pièce DIT ce qu’elle fait', () => {
    // Trois processus dans un terminal sans rien qui les présente, c'est trois
    // sources de bruit. Le rôle est ce qui les rend lisibles.
    for (const p of pieces(NODE)) expect(p.role.length, p.nom).toBeGreaterThan(10);
  });
});

describe('LES DRAPEAUX RETIRENT, JAMAIS N’AJOUTENT', () => {
  const noms = (argv: string[]): string[] => pieces(NODE, voeuDepuisArgv(argv)).map((p) => p.nom);

  it('`--sans-ecran` : le cas d’un serveur', () => {
    expect(noms(['--sans-ecran'])).toEqual(['reine', 'ouvrière']);
  });

  it('`--sans-noeud` : observer sans exécuter', () => {
    expect(noms(['--sans-noeud'])).toEqual(['reine', 'écran']);
  });

  it('`--ecran-seul` : le hub tourne déjà ailleurs', () => {
    expect(noms(['--ecran-seul'])).toEqual(['écran']);
  });

  it('un drapeau inconnu ne retire RIEN — il ne mutile pas en silence', () => {
    // Une faute de frappe qui retirerait le nœud donnerait une ruche qui
    // n'exécute rien, sans le dire. Le défaut « tout » est le seul sûr.
    expect(noms(['--sans-ecrans'])).toHaveLength(3);
    expect(noms([])).toHaveLength(3);
  });
});

describe('LES CHEMINS VISÉS EXISTENT VRAIMENT', () => {
  it('LES SCRIPTS DES OUTILS SONT SUR LE DISQUE', () => {
    // ─── LA GARDE QUI PORTE LE FICHIER ─────────────────────────────────────
    //
    // Le jour où `tsx` ou `vite` change son point d'entrée, ce test rougit ici,
    // en une seconde. Sans lui, le défaut n'apparaît qu'au `spawn` d'un
    // utilisateur, par un ENOENT noyé dans la sortie des processus qui, eux,
    // ont démarré.
    for (const [nom, rel] of Object.entries(SCRIPTS)) {
      expect(existsSync(path.join(RACINE, rel)), `${nom} : ${rel} est introuvable`).toBe(true);
    }
  });

  it('LES POINTS D’ENTRÉE DE LA RUCHE AUSSI', () => {
    for (const [nom, rel] of Object.entries(ENTREES)) {
      expect(existsSync(path.join(RACINE, rel)), `${nom} : ${rel} est introuvable`).toBe(true);
    }
  });

  it('les chemins sont RELATIFS — le lanceur fixe le `cwd`', () => {
    // Un chemin absolu calculé ici serait celui de la machine qui a écrit le
    // module, pas celle qui l'exécute.
    for (const rel of [...Object.values(SCRIPTS), ...Object.values(ENTREES)]) {
      expect(path.isAbsolute(rel), rel).toBe(false);
    }
  });
});

describe('LE PRÉFIXAGE DE LA SORTIE', () => {
  it('ALIGNE les étiquettes — c’est ce qui permet de suivre une colonne', () => {
    const liste = pieces(NODE);
    const l = largeurEtiquettes(liste);
    const largeurs = liste.map((p) => [...prefixe(p.nom, l)].length);
    expect(new Set(largeurs).size, 'toutes les étiquettes doivent faire la même largeur').toBe(1);
  });

  it('compte les POINTS DE CODE, pas les unités UTF-16', () => {
    // « ouvrière » porte un accent. Compter en unités UTF-16 déborderait sur un
    // nom contenant un caractère hors du plan de base, et l'alignement — la
    // seule raison d'être de cette fonction — sauterait.
    expect(largeurEtiquettes([{ nom: 'écran', bin: 'x', argv: [], role: 'r' }])).toBe(5);
    expect(largeurEtiquettes([{ nom: 'ouvrière', bin: 'x', argv: [], role: 'r' }])).toBe(8);
  });

  it('une liste vide ne casse pas le calcul', () => {
    expect(largeurEtiquettes([])).toBe(0);
  });
});

describe('LES DRAPEAUX SE CUMULENT — ils retirent, ils n’aiguillent pas', () => {
  // ─── LE DÉFAUT QUE L'AUDIT A TROUVÉ ────────────────────────────────────────
  //
  // `voeuDepuisArgv` était un aiguillage à retours successifs. Les deux
  // drapeaux documentés côte à côte dans l'en-tête de `scripts/ruche.mjs` —
  // la combinaison naturelle pour « la Reine SEULE » — rendaient au PREMIER
  // testé, et l'OUVRIÈRE démarrait quand même.
  //
  // Ce n'est pas un détail d'ergonomie : l'ouvrière est la pièce qui exécute du
  // code avec votre agent, sur votre machine. Elle démarrait alors qu'on venait
  // d'écrire, explicitement, qu'elle ne devait pas.

  it('« --sans-ecran --sans-noeud » ne laisse QUE la Reine', () => {
    const liste = pieces('/usr/bin/node', voeuDepuisArgv(['--sans-ecran', '--sans-noeud']));
    expect(liste.map((p) => p.nom)).toEqual(['reine']);
  });

  it('l’ordre des drapeaux ne change rien', () => {
    // C'était toute la faute : le premier testé gagnait.
    const a = pieces('/usr/bin/node', voeuDepuisArgv(['--sans-noeud', '--sans-ecran']));
    const b = pieces('/usr/bin/node', voeuDepuisArgv(['--sans-ecran', '--sans-noeud']));
    expect(a.map((p) => p.nom)).toEqual(b.map((p) => p.nom));
  });

  it('chacun seul retire bien SA pièce, et elle seule', () => {
    expect(pieces('/n', voeuDepuisArgv(['--sans-ecran'])).map((p) => p.nom)).toEqual([
      'reine',
      'ouvrière',
    ]);
    expect(pieces('/n', voeuDepuisArgv(['--sans-noeud'])).map((p) => p.nom)).toEqual([
      'reine',
      'écran',
    ]);
  });

  it('sans drapeau, les trois pièces démarrent', () => {
    expect(pieces('/n', voeuDepuisArgv([])).map((p) => p.nom)).toEqual([
      'reine',
      'ouvrière',
      'écran',
    ]);
  });

  it('« --ecran-seul » reste le seul drapeau qui DÉSIGNE au lieu de retirer', () => {
    // Il ne se cumule pas avec les autres, et son nom le dit.
    expect(pieces('/n', voeuDepuisArgv(['--ecran-seul'])).map((p) => p.nom)).toEqual(['écran']);
    expect(
      pieces('/n', voeuDepuisArgv(['--sans-noeud', '--ecran-seul'])).map((p) => p.nom),
    ).toEqual(['écran']);
  });
});
