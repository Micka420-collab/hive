// L'application de bureau — reprendre une ruche installée par git sans y
// toucher (ADR 0013 § 4), et ce que l'app attend du code de Hive qu'elle
// charge au démarrage (le contrat).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ModuleAgents,
  type ModuleDemarrage,
  type ModuleEcriture,
  type ModuleLibelles,
  MODULES_HIVE,
  type ModuleSuperviseur,
} from '../desktop/src/contrat-hive.js';
import type { RecetteReglages } from '../desktop/src/reglages.js';
import {
  CLES_DE_L_APP,
  copiesHiveWork,
  dossiersCandidats,
  envImporte,
  lireSource,
} from '../desktop/src/reprise.js';
import * as ecriture from '../src/ecriture-atomique.js';
import * as installeur from '../src/installer.js';
import * as agents from '../src/node-client/agent-detect.js';
import * as superviseur from '../src/ruche-superviseur.js';
import * as libelles from '../src/shared/agent-libelle.js';
import * as demarrage from '../src/shared/demarrage.js';
import type { PlanOuvrieres } from '../src/shared/demarrage.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

describe('où chercher une ruche installée par git', () => {
  it('`HIVE_DIR` d’abord, puis `~/hive` — sans doublon', () => {
    const home = path.resolve('/home/a');
    expect(dossiersCandidats({}, home)).toEqual([path.join(home, 'hive')]);
    expect(dossiersCandidats({ HIVE_DIR: path.resolve('/srv/ruche') }, home)).toEqual([
      path.resolve('/srv/ruche'),
      path.join(home, 'hive'),
    ]);
    expect(dossiersCandidats({ HIVE_DIR: path.join(home, 'hive') }, home)).toEqual([
      path.join(home, 'hive'),
    ]);
  });
});

describe('ce qu’on lit d’une source', () => {
  const dossier = path.resolve('/home/a/hive');
  const fichiers = (contenus: Record<string, string>) => ({
    lire: (f: string) => contenus[f] ?? null,
    existe: (f: string) => f in contenus,
  });

  it('un `.env` avec jeton ET une base : une ruche à reprendre, base résolue comme la Reine', () => {
    const f = fichiers({
      [path.join(dossier, '.env')]: 'HIVE_TOKEN=jeton-assez-long-0123456789\nHIVE_PORT=7911\n',
      [path.join(dossier, 'data', 'hive.db')]: '',
    });
    expect(lireSource(dossier, f.lire, f.existe)).toEqual({
      dossier,
      db: path.join(dossier, 'data', 'hive.db'),
      port: 7911,
      jeton: 'jeton-assez-long-0123456789',
    });
  });

  it('`HIVE_DB` relatif se résout DEPUIS la source ; port absent ou 0 : 7777', () => {
    const f = fichiers({
      [path.join(dossier, '.env')]: 'HIVE_TOKEN=x\nHIVE_DB=./base/r.db\nHIVE_PORT=0\n',
      [path.join(dossier, 'base', 'r.db')]: '',
    });
    expect(lireSource(dossier, f.lire, f.existe)).toMatchObject({
      db: path.join(dossier, 'base', 'r.db'),
      port: 7777,
    });
  });

  it('un clone jamais lancé (pas de base), un `.env` sans jeton, pas de `.env` : rien à reprendre', () => {
    const sansBase = fichiers({ [path.join(dossier, '.env')]: 'HIVE_TOKEN=x\n' });
    expect(lireSource(dossier, sansBase.lire, sansBase.existe)).toBeNull();
    const sansJeton = fichiers({
      [path.join(dossier, '.env')]: 'HIVE_PORT=7777\n',
      [path.join(dossier, 'data', 'hive.db')]: '',
    });
    expect(lireSource(dossier, sansJeton.lire, sansJeton.existe)).toBeNull();
    expect(
      lireSource(
        dossier,
        () => null,
        () => true,
      ),
    ).toBeNull();
  });
});

describe('le `.env` importé — la source MOINS ce que l’app possède', () => {
  it('jeton et secret de session suivent ; base, hôte, port, adresse et dossiers restent à l’app', () => {
    const source = [
      '# Ma ruche',
      'HIVE_TOKEN=garde-moi',
      'HIVE_JWT_SECRET=garde-moi-aussi',
      'HIVE_DB=./data/hive.db',
      'export HIVE_PORT=7911',
      'HIVE_HOST=0.0.0.0',
      'HIVE_HTTP=http://localhost:7911',
      'HIVE_WORKDIR=./.hive-work',
      'HIVE_ENV_FILE=./cles.env',
      'ANTHROPIC_API_KEY=sk-garde',
    ].join('\n');
    const importe = installeur.lireEnv(envImporte(source));
    expect(importe.get('HIVE_TOKEN')).toBe('garde-moi');
    expect(importe.get('HIVE_JWT_SECRET')).toBe('garde-moi-aussi');
    expect(importe.get('ANTHROPIC_API_KEY')).toBe('sk-garde');
    for (const cle of CLES_DE_L_APP) expect(importe.has(cle), cle).toBe(false);
    // Le trou se dit dans le fichier.
    expect(envImporte(source)).toContain('# HIVE_HOST : fixé par l’application de bureau');
    expect(envImporte(source).startsWith('# Ma ruche\n')).toBe(true);
  });
});

describe('ce qu’on copie de `.hive-work/` — l’identité, pas le travail en cours', () => {
  it('par nœud : `node-id.txt`, `join/`, `livraisons/`', () => {
    const copies = copiesHiveWork('/s', '/c', ['nimbus']);
    expect(copies.map((c) => path.relative('/s', c.de))).toEqual([
      path.join('.hive-work', 'nimbus', 'node-id.txt'),
      path.join('.hive-work', 'nimbus', 'join'),
      path.join('.hive-work', 'nimbus', 'livraisons'),
    ]);
    for (const c of copies) expect(c.vers.startsWith(path.join('/c', '.hive-work'))).toBe(true);
  });

  it('un nom de dossier hostile ne sort pas de `.hive-work/`', () => {
    expect(copiesHiveWork('/s', '/c', ['..', '.', '', 'a/b', 'a\\b'])).toEqual([]);
  });
});

describe('le contrat : ce que l’app appelle existe, avec cette forme', () => {
  it('chaque vrai module satisfait son contrat (vérifié par le typage du dépôt)', () => {
    // Ces affectations SONT le banc : une signature qui diverge fait rougir
    // `npm run typecheck`, avant que l'app ne l'apprenne à l'exécution.
    const d: ModuleDemarrage<PlanOuvrieres> = demarrage;
    const s: ModuleSuperviseur = superviseur;
    const a: ModuleAgents = agents;
    const l: ModuleLibelles = libelles;
    const i: RecetteReglages = installeur;
    const e: ModuleEcriture = ecriture;
    for (const m of [d, s, a, l, i, e]) expect(m).toBeDefined();
  });

  it('chaque module chargé depuis `dist/` est l’image d’une source de `src/`', () => {
    for (const [nom, rel] of Object.entries(MODULES_HIVE)) {
      const source = rel.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(existsSync(path.join(RACINE, source)), `${nom} : ${source}`).toBe(true);
    }
  });
});

// ─── L'AMORCE DES PIÈCES (`desktop/app/piece.cjs`) ───────────────────────────
//
// Elle tourne ici sous Node : c'est le même code qu'Electron exécute en mode
// Node, et ce qu'elle promet ne dépend pas du binaire.
describe('l’amorce d’une pièce', () => {
  const PIECE = path.join(RACINE, 'desktop', 'app', 'piece.cjs');
  let dossier = '';
  afterEach(() => {
    if (dossier) rmSync(dossier, { recursive: true, force: true });
  });

  it('retire `ELECTRON_RUN_AS_NODE` et présente `argv` comme `node <entrée>`', async () => {
    dossier = mkdtempSync(path.join(tmpdir(), 'hive-piece-'));
    const entree = path.join(dossier, 'entree.mjs');
    writeFileSync(
      entree,
      `console.log(JSON.stringify({ env: process.env.ELECTRON_RUN_AS_NODE ?? null, argv: process.argv.slice(1) }));`,
    );
    const sortie = await new Promise<string>((resoudre, rejeter) => {
      const e = spawn(process.execPath, [PIECE, entree, 'a', 'b'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let s = '';
      e.stdout.setEncoding('utf8').on('data', (d: string) => (s += d));
      e.on('error', rejeter);
      e.on('close', () => resoudre(s));
    });
    expect(JSON.parse(sortie)).toEqual({ env: null, argv: [entree, 'a', 'b'] });
  });

  it('l’app morte (canal fermé) : la pièce reçoit l’ordre d’arrêt de la ruche', async () => {
    dossier = mkdtempSync(path.join(tmpdir(), 'hive-piece-'));
    const entree = path.join(dossier, 'entree.mjs');
    // Une pièce qui ne sort QUE sur l'ordre d'arrêt, comme la Reine et l'ouvrière.
    writeFileSync(
      entree,
      `process.on('message', (m) => { if (m && m.type === 'arret') process.exit(42); });
       process.send({ pret: true });
       setInterval(() => {}, 1000);`,
    );
    const code = await new Promise<number | null>((resoudre, rejeter) => {
      const e = spawn(process.execPath, [PIECE, entree], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      e.on('error', rejeter);
      e.once('message', () => e.disconnect());
      e.on('exit', (c) => resoudre(c));
    });
    expect(code).toBe(42);
  });
});
