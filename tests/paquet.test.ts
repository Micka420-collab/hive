// Ce qu'un ami télécharge pour prêter du temps-machine.
//
// ─── LE CHIFFRE QUI A MOTIVÉ CE FICHIER ──────────────────────────────────────
//
// Rejoindre la ruche d'un ami demandait un `git clone` puis un `npm install`
// de **218 Mo et 279 paquets** — dont un moteur 3D de 27 Mo, React, et six
// paquets d'éditeur de code, pour un dashboard que le nœud membre N'OUVRE
// JAMAIS. On ne demande pas ça à quelqu'un qui rend un service.
//
// La cartographie des imports a montré qu'un nœud n'atteint, à l'exécution,
// que DEUX paquets : `ws` et `simple-git`. Tout le reste se répartit en
// paquets de navigateur (bundlés par Vite, jamais chargés par Node) et en
// paquets d'orchestrateur (Fastify, SQLite) qu'un nœud ne touche pas.
//
// Résultat mesuré : **4,1 Mo et 9 paquets**, en une commande, sans clone.
//
// ─── POURQUOI UNE GARDE ──────────────────────────────────────────────────────
//
// Ce classement est invisible au quotidien : sur la machine d'un développeur,
// tout est installé et tout marche. Remettre React dans `dependencies` ne
// casserait RIEN localement — ça multiplierait seulement par cinquante ce que
// téléchargent les amis, sans que personne s'en aperçoive avant longtemps.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Paquet {
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

const paquet = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as Paquet;

const deps = Object.keys(paquet.dependencies ?? {});
const opt = Object.keys(paquet.optionalDependencies ?? {});
const dev = Object.keys(paquet.devDependencies ?? {});

describe('ce qu’un nœud membre télécharge', () => {
  it('SEULEMENT `ws` ET `simple-git` — rien d’autre n’est atteint à l’exécution', () => {
    // Vérifié par cartographie des imports depuis `join.ts` et `main.ts` :
    // la fermeture transitive n'atteint que ces deux paquets.
    expect([...deps].sort()).toEqual(['simple-git', 'ws']);
  });

  it('AUCUN PAQUET DE NAVIGATEUR dans les dépendances d’exécution', () => {
    // Vite les bundle dans `dashboard/dist` ; Node ne les charge jamais. Les
    // laisser en `dependencies` fait payer 40 Mo à quelqu'un qui n'ouvrira
    // pas le dashboard.
    const front = ['react', 'react-dom', 'react-router-dom', 'codemirror'];
    for (const p of front) {
      expect(deps, `${p} doit être une dépendance de développement`).not.toContain(p);
      expect(opt, `${p} n’est pas optionnel : il est de build`).not.toContain(p);
    }
    for (const prefixe of ['@codemirror/', '@galacean/']) {
      expect(
        deps.filter((d) => d.startsWith(prefixe)),
        `${prefixe}* n’a rien à faire dans dependencies`,
      ).toEqual([]);
    }
  });

  it('l’orchestrateur est OPTIONNEL, pas absent', () => {
    // Un nœud ne compile pas un moteur SQLite natif pour un serveur qu'il ne
    // lancera jamais. Mais la ruche complète en a besoin : optionnel, donc —
    // installé par défaut, et retirable par `--omit=optional`.
    for (const p of ['fastify', '@fastify/cors', '@fastify/static', 'better-sqlite3']) {
      expect(opt, `${p} doit être optionnel`).toContain(p);
      expect(deps, `${p} ne doit pas être exigé d’un nœud`).not.toContain(p);
    }
  });

  it('un paquet n’est jamais dans deux listes à la fois', () => {
    // npm ne s'en plaint pas et le résultat dépend de l'ordre : une même
    // dépendance déclarée deux fois est une source de surprise silencieuse.
    for (const p of deps) expect(opt, p).not.toContain(p);
    for (const p of deps) expect(dev, p).not.toContain(p);
    for (const p of opt) expect(dev, p).not.toContain(p);
  });
});

describe('la commande installée', () => {
  it('`hive` pointe vers le point d’entrée compilé', () => {
    expect(paquet.bin?.hive).toBe('./dist/bin.js');
  });

  it('LE PAQUET EMBARQUE `dist`, ET PAS LES TESTS NI LES SOURCES', () => {
    // Personne n'a besoin de nos tests pour faire tourner une ruche, et les
    // embarquer gonfle ce qu'on demande aux gens de télécharger.
    expect(paquet.files).toContain('dist');
    expect(paquet.files).not.toContain('tests');
    expect(paquet.files).not.toContain('src');
    expect(paquet.files).not.toContain('dashboard');
  });

  it('le socle Node est déclaré — sans quoi l’échec arrive à l’exécution', () => {
    expect(paquet.engines?.node).toBeDefined();
  });
});
