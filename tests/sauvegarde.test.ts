// La sauvegarde de la base.
//
// ─── CE QUE CE FICHIER PROUVE, ET QUI NE SE DEVINE PAS ───────────────────────
//
// Le premier test de la dernière section est le plus important du fichier : il
// prend une VRAIE base en mode WAL, la copie des deux façons, et compte.
//
// `VACUUM INTO` rend toutes les lignes. Une copie de fichier à chaud en perd —
// silencieusement, dans un fichier qui s'ouvre sans erreur et passe
// `integrity_check`. C'est la pire forme de sauvegarde : celle qu'on croit
// avoir.
//
// Sans ce test, « il faut utiliser VACUUM INTO » resterait une phrase dans un
// commentaire, c'est-à-dire une règle que le premier remaniement pressé
// remplacerait par un `copyFileSync` — qui marcherait, sur une base au repos.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Contexte,
  PREFIXE,
  aElaguer,
  estUneSauvegarde,
  nomDe,
  planifier,
} from '../src/shared/sauvegarde.js';
import { type Base, citerSql, contexteReel, sauvegarder } from '../src/sauvegarde-reelle.js';

const ctx = (o: Partial<Contexte> = {}): Contexte => ({
  racine: '/home/moi/hive',
  dbPath: '/home/moi/hive/data/hive.db',
  maintenant: '2026-07-28T20:30:00.000Z',
  garder: 7,
  plateforme: 'linux',
  ...o,
});

describe('LE NOM D’UNE SAUVEGARDE', () => {
  it('n’a pas de `:` — Windows les refuse dans un nom de fichier', () => {
    // Une sauvegarde qui ne peut pas s'écrire sur une des trois plateformes
    // n'est pas une sauvegarde.
    const n = nomDe('2026-07-28T20:30:00.000Z');
    expect(n).toBe('hive-2026-07-28T20-30-00.000Z.db');
    expect(n).not.toContain(':');
  });

  it('SON ORDRE ALPHABÉTIQUE EST SON ORDRE CHRONOLOGIQUE', () => {
    // C'est ce qui permet d'élaguer sans lire une seule date de modification —
    // donc sans avoir à départager deux fichiers de même milliseconde. Ce dépôt
    // a payé trois fois pour un tri sans départage (§ 7 de `docs/ERREURS.md`) ;
    // ici le problème n'existe pas, par construction.
    const instants = [
      '2026-01-01T00:00:00.000Z',
      '2026-07-28T20:30:00.000Z',
      '2026-07-28T20:30:00.001Z',
      '2026-12-31T23:59:59.999Z',
    ];
    const noms = instants.map(nomDe);
    expect([...noms].sort()).toEqual(noms);
  });

  it('un `.part` n’est JAMAIS pris pour une sauvegarde publiée', () => {
    expect(estUneSauvegarde('hive-2026-07-28T20-30-00.000Z.db')).toBe(true);
    expect(estUneSauvegarde('hive-2026-07-28T20-30-00.000Z.part.db')).toBe(false);
    expect(estUneSauvegarde('autre-chose.db')).toBe(false);
    expect(estUneSauvegarde('hive-truc.txt')).toBe(false);
  });
});

describe('LE PLAN', () => {
  it('écrit dans `<données>/sauvegardes` par défaut', () => {
    const p = planifier(ctx());
    expect(p.genre).toBe('plan');
    if (p.genre !== 'plan') return;
    expect(p.dossier).toBe('/home/moi/hive/data/sauvegardes');
    expect(p.definitif).toBe('/home/moi/hive/data/sauvegardes/hive-2026-07-28T20-30-00.000Z.db');
    expect(p.temporaire).toBe(
      '/home/moi/hive/data/sauvegardes/hive-2026-07-28T20-30-00.000Z.part.db',
    );
  });

  it('LA PLATEFORME EST UN PARAMÈTRE : la forme Windows se vérifie depuis Linux', () => {
    const p = planifier(
      ctx({ plateforme: 'win32', dbPath: 'C:\\Users\\moi\\hive\\data\\hive.db' }),
    );
    if (p.genre !== 'plan') throw new Error('refus inattendu');
    expect(p.dossier).toBe('C:\\Users\\moi\\hive\\data\\sauvegardes');
    expect(p.definitif).toContain('\\');
    expect(p.definitif).not.toContain('/');
  });

  it('un chemin de base RELATIF est refusé', () => {
    // Une sauvegarde se lance aussi depuis un service ou une tâche planifiée,
    // dont le répertoire courant n'est pas celui de la personne.
    const r = planifier(ctx({ dbPath: 'data/hive.db' }));
    expect(r.genre).toBe('refus');
    if (r.genre === 'refus') expect(r.motif).toMatch(/absolus/);
  });

  it('`garder 0` est refusé — une sauvegarde qui s’élague elle-même n’en est pas une', () => {
    for (const garder of [0, -1, 1.5, Number.NaN]) {
      expect(planifier(ctx({ garder })).genre, `garder=${garder}`).toBe('refus');
    }
    expect(planifier(ctx({ garder: 1 })).genre).toBe('plan');
  });
});

describe('L’ÉLAGAGE — la borne arrive avec la fonctionnalité', () => {
  const noms = [
    'hive-2026-01-01T00-00-00.000Z.db',
    'hive-2026-02-01T00-00-00.000Z.db',
    'hive-2026-03-01T00-00-00.000Z.db',
    'hive-2026-04-01T00-00-00.000Z.db',
  ];

  it('garde les N plus RÉCENTES', () => {
    const { retirer } = aElaguer(noms, 2);
    expect(retirer).toEqual([
      'hive-2026-01-01T00-00-00.000Z.db',
      'hive-2026-02-01T00-00-00.000Z.db',
    ]);
  });

  it('ne retire rien quand il y en a moins que la borne', () => {
    expect(aElaguer(noms, 10).retirer).toEqual([]);
    expect(aElaguer([], 3).retirer).toEqual([]);
  });

  it('IGNORE ce qui n’est pas à nous', () => {
    // Un dossier de sauvegardes est un endroit où les gens déposent des
    // choses. On ne supprime que ce qu'on a écrit.
    const { retirer } = aElaguer([...noms, 'notes.txt', 'ancienne-base.db', 'photo.png'], 1);
    expect(retirer.every((n) => n.startsWith(PREFIXE))).toBe(true);
    expect(retirer).not.toContain('ancienne-base.db');
  });

  it('ramasse les `.part` d’un processus tué, séparément', () => {
    const { retirer, restes } = aElaguer([...noms, 'hive-2026-05-01T00-00-00.000Z.part.db'], 10);
    expect(retirer).toEqual([]);
    expect(restes).toEqual(['hive-2026-05-01T00-00-00.000Z.part.db']);
  });
});

describe('LA CITATION SQL — `VACUUM INTO` n’accepte pas de paramètre lié', () => {
  it('double les apostrophes', () => {
    // `/home/j'ai/hive` refermerait la chaîne SQL, et le reste du chemin
    // deviendrait des instructions. C'est le seul endroit du dépôt où une
    // valeur entre dans du SQL sans passer par un paramètre — parce que
    // SQLite ne l'autorise pas ici.
    expect(citerSql('/home/moi/hive')).toBe("'/home/moi/hive'");
    expect(citerSql("/home/j'ai/hive")).toBe("'/home/j''ai/hive'");
  });

  it('UN CHEMIN HOSTILE NE PEUT PAS AJOUTER D’INSTRUCTION', () => {
    const mechant = "/tmp/x'); DROP TABLE t; --";
    const cite = citerSql(mechant);
    // Toute apostrophe interne est doublée : il n'en reste aucune qui ferme
    // la chaîne avant la fin.
    expect(cite.slice(1, -1).split("''").join('')).not.toContain("'");
    expect(cite.startsWith("'")).toBe(true);
    expect(cite.endsWith("'")).toBe(true);
  });
});

describe('SAUVEGARDER POUR DE VRAI', () => {
  /** Une base simulée : elle écrit un fichier, comme `VACUUM INTO` le ferait. */
  const bidon = (contenu = 'base'): ((p: string) => Promise<Base>) => {
    return () =>
      Promise.resolve({
        copierVers: (cible) => writeFileSync(cible, contenu),
        fermer: () => undefined,
      });
  };

  it('publie sous un nom DÉFINITIF, et le temporaire ne survit pas', () => {
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-sauv-'));
    try {
      const c = ctx({ dbPath: path.join(bac, 'hive.db'), dossier: path.join(bac, 'sauv') });
      return sauvegarder(c, bidon()).then((r) => {
        expect('fichier' in r, 'refus inattendu').toBe(true);
        if ('fichier' in r) {
          expect(existsSync(r.fichier), 'la sauvegarde n’a pas été publiée').toBe(true);
          expect(r.octets).toBeGreaterThan(0);
        }
        // Le `.part` a été renommé, pas laissé derrière.
        expect(readdirSync(path.join(bac, 'sauv')).filter((n) => n.includes('.part'))).toEqual([]);
        rmSync(bac, { recursive: true, force: true });
      });
    } catch (e) {
      rmSync(bac, { recursive: true, force: true });
      throw e;
    }
  });

  it('ÉLAGUE APRÈS avoir publié, jamais avant', async () => {
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-sauv-'));
    try {
      const dossier = path.join(bac, 'sauv');
      mkdirSync(dossier, { recursive: true });
      // Trois anciennes, plus un reste de processus tué.
      for (const n of [
        'hive-2026-01-01T00-00-00.000Z.db',
        'hive-2026-02-01T00-00-00.000Z.db',
        'hive-2026-03-01T00-00-00.000Z.db',
        'hive-2026-02-15T00-00-00.000Z.part.db',
      ]) {
        writeFileSync(path.join(dossier, n), 'x');
      }

      const r = await sauvegarder(
        ctx({ dbPath: path.join(bac, 'hive.db'), dossier, garder: 2 }),
        bidon(),
      );
      if (!('fichier' in r)) throw new Error('refus inattendu');

      const restants = readdirSync(dossier).sort();
      // La borne : deux au total, dont CELLE QU'ON VIENT D'ÉCRIRE.
      expect(restants).toEqual([
        'hive-2026-03-01T00-00-00.000Z.db',
        'hive-2026-07-28T20-30-00.000Z.db',
      ]);
      expect(existsSync(r.fichier), 'on a élagué celle qu’on venait d’écrire').toBe(true);
      // Et le `.part` orphelin a été ramassé.
      expect(r.restes).toEqual(['hive-2026-02-15T00-00-00.000Z.part.db']);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });
});

describe('LE CONTEXTE RÉEL', () => {
  it('`--vers` absent laisse le module pur choisir le dossier', () => {
    // La clé ne doit pas être posée à `undefined` : `planifier` distingue
    // « pas de dossier demandé » de « ce dossier-ci », et un `undefined`
    // explicite lui ferait composer un chemin depuis rien.
    const c = contexteReel('/r', '/r/data/hive.db', 7);
    expect('dossier' in c).toBe(false);
  });

  it('`--vers` fourni est RENDU ABSOLU', () => {
    // Une sauvegarde se lance aussi depuis un service, dont le répertoire
    // courant n'est pas celui de la personne.
    const c = contexteReel('/r', '/r/data/hive.db', 7, 'ailleurs');
    expect(c.dossier).toBe(path.resolve('ailleurs'));
    expect(path.isAbsolute(c.dossier!)).toBe(true);
  });

  it('l’instant est un PARAMÈTRE, pas une horloge lue au passage', () => {
    expect(contexteReel('/r', '/r/x.db', 7, undefined, '2020-01-01T00:00:00.000Z').maintenant).toBe(
      '2020-01-01T00:00:00.000Z',
    );
    // Et sans paramètre, c'est bien maintenant — un ISO valide.
    expect(Number.isNaN(Date.parse(contexteReel('/r', '/r/x.db', 7).maintenant))).toBe(false);
  });
});

describe('`hive sauvegarde` LANCÉ POUR DE VRAI', () => {
  // Le module et sa moitié impure sont éprouvés au-dessus. Ceci vérifie le
  // CÂBLAGE : que la commande existe, qu'elle lit ses drapeaux, et qu'elle
  // vise la racine qu'on lui donne.
  //
  // `process.execPath`, pas `npx` : sous Windows `npx` est `npx.cmd`, que Node
  // refuse d'exécuter sans shell (§ 6.2, déjà payé deux fois).
  const lancer = (args: string[]): { code: number; sortie: string } => {
    try {
      return {
        code: 0,
        sortie: execFileSync(
          process.execPath,
          ['--import', 'tsx', 'src/cli.ts', 'sauvegarde', ...args],
          {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            encoding: 'utf8',
            env: { ...process.env, NO_COLOR: '1', HIVE_DB: '', HIVE_WORKDIR: '' },
          },
        ),
      };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  /** Une racine avec une VRAIE base minuscule, pour ne rien simuler ici. */
  const avecBase = async (): Promise<string> => {
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-cli-sauv-'));
    mkdirSync(path.join(bac, 'data'), { recursive: true });
    // Un fichier SQLite valide, écrit par SQLite lui-même — pas un leurre :
    // la commande ouvre la base pour de bon, un fichier bidon la ferait
    // échouer pour une raison qui n'a rien à voir avec ce qu'on teste.
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(bac, 'data', 'hive.db'));
    db.exec('create table t(x); insert into t values (1)');
    db.close();
    return bac;
  };

  const avecSqlite = ((): boolean => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return typeof require('better-sqlite3') === 'function';
    } catch {
      return false;
    }
  })();

  it.runIf(avecSqlite)('`--vers` DÉCIDE où la sauvegarde atterrit', async () => {
    const bac = await avecBase();
    try {
      const vers = path.join(bac, 'ailleurs');
      const r = lancer([bac, `--vers=${vers}`]);
      expect(r.code, r.sortie).toBe(0);
      const dedans = readdirSync(vers).filter((n) => n.endsWith('.db'));
      expect(dedans, 'rien n’a été écrit dans le dossier demandé').toHaveLength(1);
      // Et RIEN dans l'emplacement par défaut.
      expect(existsSync(path.join(bac, 'data', 'sauvegardes'))).toBe(false);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it.runIf(avecSqlite)('`--garder=N` EST LU — la borne suit le drapeau', async () => {
    const bac = await avecBase();
    try {
      const vers = path.join(bac, 'sauv');
      // Quatre sauvegardes d'affilée, borne à 2 : il doit en rester deux.
      for (let i = 0; i < 4; i++) {
        const r = lancer([bac, `--vers=${vers}`, '--garder=2']);
        expect(r.code, r.sortie).toBe(0);
      }
      const restants = readdirSync(vers).filter((n) => n.endsWith('.db'));
      expect(restants, `borne non respectée : ${restants.join(', ')}`).toHaveLength(2);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it.runIf(avecSqlite)('`--json` rend un objet, pour une supervision', async () => {
    const bac = await avecBase();
    try {
      const r = lancer([bac, `--vers=${path.join(bac, 'sauv')}`, '--json']);
      expect(r.code, r.sortie).toBe(0);
      const vu = JSON.parse(r.sortie) as { fichier: string; octets: number };
      expect(vu.fichier.endsWith('.db')).toBe(true);
      expect(vu.octets).toBeGreaterThan(0);
      expect(existsSync(vu.fichier)).toBe(true);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });
});

describe('LA MESURE QUI JUSTIFIE TOUT CE MODULE', () => {
  // ─── `VACUUM INTO` CONTRE UN `cp`, SUR UNE VRAIE BASE EN MODE WAL ──────────
  //
  // Ce test est le seul du fichier qui exige `better-sqlite3`. Il s'abstient
  // proprement s'il manque — c'est une dépendance OPTIONNELLE, absente d'une
  // installation de nœud allégée — mais il tourne partout où la ruche complète
  // est installée, donc à chaque CI.

  const avecSqlite = ((): boolean => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return typeof require('better-sqlite3') === 'function';
    } catch {
      return false;
    }
  })();

  it('cette machine a-t-elle better-sqlite3 ? — la question doit être posée', () => {
    if (!avecSqlite) {
      console.warn('⚠ better-sqlite3 absent : la mesure WAL n’est PAS faite ici.');
    }
    expect(typeof avecSqlite).toBe('boolean');
  });

  it.runIf(avecSqlite)('UNE COPIE À CHAUD PERD DES LIGNES, `VACUUM INTO` non', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { copyFileSync } = await import('node:fs');
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-wal-'));
    try {
      const source = path.join(bac, 'source.db');
      const db = new Database(source);
      // LE MODE WAL EST CE QUI REND LA COPIE FAUSSE. C'est aussi le mode que la
      // ruche utilise : sans lui, ce test ne prouverait rien du vrai système.
      db.pragma('journal_mode = WAL');
      db.exec('create table t(x)');
      const ins = db.prepare('insert into t values (?)');
      for (let i = 0; i < 5000; i++) ins.run('x'.repeat(100));

      const parVacuum = path.join(bac, 'vacuum.db');
      db.exec(`VACUUM INTO ${citerSql(parVacuum)}`);

      const parCopie = path.join(bac, 'copie.db');
      copyFileSync(source, parCopie);

      const compter = (f: string): number => {
        const d = new Database(f, { readonly: true });
        const n = (d.prepare('select count(*) n from t').get() as { n: number }).n;
        const integrite = (d.pragma('integrity_check') as { integrity_check: string }[])[0]!
          .integrity_check;
        d.close();
        // LES DEUX passent `integrity_check`. C'est bien le problème : la copie
        // à chaud n'est pas corrompue, elle est INCOMPLÈTE — et rien ne le dit.
        expect(integrite, `${path.basename(f)} : intégrité`).toBe('ok');
        return n;
      };

      const attendu = (db.prepare('select count(*) n from t').get() as { n: number }).n;
      db.close();

      expect(compter(parVacuum), 'VACUUM INTO a perdu des lignes').toBe(attendu);
      expect(
        compter(parCopie),
        'la copie à chaud était complète — le WAL a été replié ?',
      ).toBeLessThan(attendu);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });
});
