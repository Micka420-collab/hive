// LE RELEVÉ — la moitié qui REGARDE.
//
// ─── CE QU'UN TEST DE MODULE PUR NE PEUT PAS ATTRAPER ────────────────────────
//
// `doctor.test.ts` prouve que le jugement est juste, sur des faits qu'on lui
// donne. Il ne dit rien de la question qui compte ici : **est-ce qu'on mesure
// vraiment ?**
//
// Un relevé qui rend `null` parce que la mesure a échoué pour une raison
// stupide produit un verdict `inconnu` PARFAITEMENT LÉGITIME EN APPARENCE.
// C'est le pire des deux : un docteur définitivement aveugle sur un point, qui
// le dit d'un ton mesuré, et que personne ne va vérifier parce que « inconnu »
// est une réponse prévue.
//
// C'est exactement ce qui est arrivé. La première version appelait
// `require('better-sqlite3')` dans un module ESM, où `require` n'existe pas :
// la `ReferenceError` était attrapée, `null` rendu, et le docteur annonçait
// « intégrité non vérifiable (fichier verrouillé ?) » sur une base
// parfaitement lisible. Trouvé en LANÇANT la commande, pas en la relisant — le
// code se lit juste.
//
// D'où ce fichier : chaque mesure est essayée sur un cas où elle DOIT réussir,
// et sur un cas où elle DOIT rendre `null`. Une mesure qui ne sait que dire
// « je ne sais pas » n'est pas une mesure.

import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  baseIntegre,
  emplacements,
  octetsLibres,
  portLibre,
  portTenuParNous,
  relever,
} from '../src/doctor-releve.js';
import { diagnostiquer } from '../src/shared/doctor.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-doc-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CHAQUE MESURE DOIT SAVOIR RÉUSSIR, PAS SEULEMENT ÉCHOUER', () => {
  it('L’INTÉGRITÉ D’UNE VRAIE BASE SE LIT — le défaut historique', () => {
    // La garde qui aurait attrapé le `require` en ESM. Sans elle, la fonction
    // pouvait rendre `null` pour toujours sans que rien ne rougisse.
    const base = path.join(dir, 'vraie.db');
    return import('better-sqlite3').then(async (m) => {
      const Database = m.default as unknown as new (p: string) => {
        exec(s: string): void;
        close(): void;
      };
      const db = new Database(base);
      db.exec('CREATE TABLE t (x INTEGER)');
      db.close();

      expect(await baseIntegre(base), 'UNE BASE SAINE DOIT SE LIRE « intègre »').toBe(true);
    });
  });

  it('…et un fichier qui n’est pas une base rend `null`, pas `true`', async () => {
    const faux = path.join(dir, 'pas-une-base.db');
    writeFileSync(faux, 'ceci est du texte, pas du SQLite');
    expect(await baseIntegre(faux)).toBeNull();
  });

  it('LA PLACE LIBRE SE MESURE VRAIMENT — un nombre, pas `null`', () => {
    const libre = octetsLibres(dir);
    expect(libre, 'la place libre doit être mesurable sur un tmpdir').not.toBeNull();
    expect(libre as number).toBeGreaterThan(0);
  });

  it('…et un chemin qui n’existe pas rend `null`', () => {
    expect(octetsLibres(path.join(dir, 'nulle-part', 'du-tout'))).toBeNull();
  });

  it('UN PORT LIBRE EST VU LIBRE, un port occupé est vu occupé', async () => {
    // Les deux sens : une mesure qui répondrait toujours « libre » laisserait
    // passer le seul cas où elle sert.
    const s = createServer(() => undefined);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const pris = (s.address() as { port: number }).port;

    expect(await portLibre(pris), 'un port écouté n’est pas libre').toBe(false);
    await new Promise<void>((r) => s.close(() => r()));
    expect(await portLibre(pris), 'et une fois relâché, il l’est').toBe(true);
  });
});

describe('LE PORT : NOUS, OU QUELQU’UN D’AUTRE ?', () => {
  it('UNE VRAIE RUCHE SE RECONNAÎT', async () => {
    // On répond comme `/api/health` : `{ ok: true }`.
    const s = createServer((_q, r) => {
      r.writeHead(200, { 'content-type': 'application/json' });
      r.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as { port: number }).port;
    try {
      expect(await portTenuParNous(port)).toBe(true);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it('AUTRE CHOSE SUR LE PORT N’EST PAS UNE RUCHE — et on ne l’invente pas', async () => {
    // La distinction qui évite d'envoyer quelqu'un tuer sa propre ruche… et
    // son symétrique : ne pas prendre le serveur de quelqu'un d'autre pour la
    // nôtre.
    const s = createServer((_q, r) => {
      r.writeHead(200, { 'content-type': 'text/html' });
      r.end('<html>je suis un autre programme</html>');
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as { port: number }).port;
    try {
      expect(await portTenuParNous(port)).toBe(false);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it('un port où personne n’écoute : « pas une ruche », pas « je ne sais pas »', async () => {
    // Le refus de connexion est une réponse, pas une absence de réponse.
    const s = createServer(() => undefined);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as { port: number }).port;
    await new Promise<void>((r) => s.close(() => r()));
    expect(await portTenuParNous(port, '127.0.0.1', 800)).toBe(false);
  });
});

describe('LE RELEVÉ COMPLET, SUR UNE RACINE FABRIQUÉE', () => {
  it('UNE RACINE NUE PRODUIT UN VERDICT UTILISABLE, pas une exception', async () => {
    // Le cas du premier jour : rien n'est installé, rien n'est configuré. Le
    // docteur doit MARCHER là — c'est même son seul moment utile.
    const nue = mkdtempSync(path.join(os.tmpdir(), 'hive-nue-'));
    try {
      const r = await relever(nue, { HIVE_PORT: '0' }, 'linux');
      expect(r.fichierEnv.present, 'pas de .env').toBe(false);
      expect(r.jeton.present, 'pas de jeton').toBe(false);
      expect(r.dashboardConstruit, 'pas de tableau de bord').toBe(false);
      expect(r.base.presente, 'pas de base').toBe(false);
      expect(r.base.integre, 'pas de base ⇒ rien à vérifier').toBeNull();

      // Et le jugement tient : onze lignes, aucune exception.
      expect(diagnostiquer(r)).toHaveLength(11);
    } finally {
      rmSync(nue, { recursive: true, force: true });
    }
  });

  it('SUR WINDOWS, les permissions ne sont pas inventées', async () => {
    // `statSync().mode` rend une valeur PLAUSIBLE et FAUSSE sur Windows.
    // La rendre ferait dire « .env est privé » sans rien avoir vérifié.
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-win-'));
    try {
      writeFileSync(path.join(racine, '.env'), 'HIVE_TOKEN=x');
      const surWindows = await relever(racine, { HIVE_PORT: '0' }, 'win32');
      expect(surWindows.fichierEnv.present).toBe(true);
      expect(surWindows.fichierEnv.permissions, 'aucun bit POSIX inventé').toBeNull();

      const surLinux = await relever(racine, { HIVE_PORT: '0' }, 'linux');
      expect(surLinux.fichierEnv.permissions, 'ailleurs, on mesure').not.toBeNull();
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it('UN .env TROP OUVERT REMONTE JUSQU’AU VERDICT', async () => {
    // De bout en bout : le relevé mesure 0644, le module pur en fait un risque,
    // et la réparation dit `chmod 600`.
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-644-'));
    try {
      const env = path.join(racine, '.env');
      writeFileSync(env, 'HIVE_TOKEN=x');
      chmodSync(env, 0o644);
      const r = await relever(racine, { HIVE_PORT: '0' }, 'linux');
      const d = diagnostiquer(r).find((x) => x.cle === 'env_present');
      expect(d?.gravite).toBe('risque');
      expect(d?.reparation).toContain('chmod 600');
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it('LE JETON D’EXEMPLE EST RECONNU POUR CE QU’IL EST', async () => {
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-jet-'));
    try {
      const r = await relever(racine, { HIVE_PORT: '0', HIVE_TOKEN: 'change-me' }, 'linux');
      expect(r.jeton.trivial, 'la valeur livrée avec le dépôt est publique').toBe(true);
      expect(diagnostiquer(r).find((d) => d.cle === 'jeton')?.gravite).toBe('bloquant');
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it('LES RÉGLAGES DANGEREUX SONT LUS DE L’ENVIRONNEMENT, pas devinés', async () => {
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-reg-'));
    try {
      const r = await relever(
        racine,
        {
          HIVE_PORT: '0',
          HIVE_RUNNER: 'on',
          HIVE_HOST: '0.0.0.0',
          HIVE_GARDIENNES: 'off',
          HIVE_CORS_ORIGIN: '*',
        },
        'linux',
      );
      expect(r.reglages).toEqual({
        runner: 'on',
        bindPublic: true,
        gardiennes: 'off',
        corsOuvert: true,
      });
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it('L’ADAPTATEUR `shell`, QUI EST SIMULÉ, NE COMPTE PAS COMME UN AGENT', async () => {
    // `detectBestAgent` ne rend JAMAIS null : faute de mieux elle retombe sur
    // `shell`, qui simule. Le rapporter dirait « tout va bien » à qui n'a rien
    // d'installé, et son nœud produirait des diffs vides sans que personne
    // comprenne pourquoi.
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-ag-'));
    try {
      // La détection sonde le PATH réel de la machine : on ne peut pas la
      // forcer par l'environnement, d'où la couture d'injection.
      const r = await relever(racine, { HIVE_PORT: '0' }, 'linux', async () => ({
        agent: 'shell',
      }));
      expect(r.agent, '`shell` vaut « aucun agent » pour le docteur').toBeNull();
      expect(diagnostiquer(r).find((d) => d.cle === 'agent')?.gravite).toBe('risque');

      // Et un VRAI agent, lui, est bien rapporté — sinon le diagnostic
      // crierait sur toutes les machines correctement installées.
      const vrai = await relever(racine, { HIVE_PORT: '0' }, 'linux', async () => ({
        agent: 'claude-code',
      }));
      expect(vrai.agent).toBe('claude-code');
      expect(diagnostiquer(vrai).find((d) => d.cle === 'agent')?.gravite).toBe('ok');
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it('les emplacements suivent HIVE_DB et HIVE_WORKDIR', () => {
    const e = emplacements('/r', { HIVE_DB: '/ailleurs/h.db', HIVE_WORKDIR: '/gros/disque' });
    expect(e.base).toBe('/ailleurs/h.db');
    expect(e.travail).toBe('/gros/disque');
    expect(emplacements('/r', {}).base).toBe(path.join('/r', 'data', 'hive.db'));
  });
});

describe('LES TROIS POINTS QUE LA LOUPE A DÉSIGNÉS', () => {
  it('UNE RUCHE LIÉE À 0.0.0.0 SE SONDE SUR LA BOUCLE LOCALE', async () => {
    // `0.0.0.0` est une adresse d'ÉCOUTE, pas une adresse à laquelle se
    // connecter : s'y adresser échoue selon les plateformes, et le docteur
    // conclurait « rien ne répond » sur une ruche qui tourne très bien.
    const { hoteDeSondage } = await import('../src/doctor-releve.js');
    expect(hoteDeSondage('0.0.0.0')).toBe('127.0.0.1');
    // …et un hôte précis est repris TEL QUEL. Le retourner sonderait la boucle
    // locale d'une ruche liée ailleurs — et la déclarerait éteinte.
    expect(hoteDeSondage('192.168.1.10')).toBe('192.168.1.10');
    expect(hoteDeSondage('127.0.0.1')).toBe('127.0.0.1');
  });

  it('LE WEBSOCKET N’EST ESSAYÉ QUE SUR NOTRE RUCHE — et alors il conclut', async () => {
    // Le point de panne qui ne se voit pas : l'API répond, l'écran s'affiche,
    // et rien ne bouge. On ne peut le constater QUE sur une vraie ruche : sur
    // un port tenu par autre chose, un refus d'`Upgrade` ne dirait rien d'elle.
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-ws-'));
    const faireServeur = (sante: boolean): Promise<{ port: number; fermer: () => Promise<void> }> =>
      new Promise((resolve) => {
        const s = createServer((_q, r) => {
          r.writeHead(200, { 'content-type': 'application/json' });
          r.end(JSON.stringify(sante ? { ok: true } : { autre: 'programme' }));
        });
        s.listen(0, '127.0.0.1', () =>
          resolve({
            port: (s.address() as { port: number }).port,
            fermer: () => new Promise<void>((r) => s.close(() => r())),
          }),
        );
      });

    // 1. Une « ruche » qui répond en HTTP mais n'a AUCUN WebSocket : c'est
    //    exactement la panne qu'on cherche, et elle doit se conclure.
    const ruche = await faireServeur(true);
    try {
      const r = await relever(racine, { HIVE_PORT: String(ruche.port) }, 'linux');
      expect(r.port.parNous, 'elle se dit ruche').toBe(true);
      expect(r.wsJoignable, 'ESSAYÉ, ET REFUSÉ — le diagnostic doit mordre').toBe(false);
      expect(
        diagnostiquer(r).find((d) => d.cle === 'websocket')?.gravite,
        'HTTP répond, le WS non : c’est bloquant',
      ).toBe('bloquant');
    } finally {
      await ruche.fermer();
    }

    // 2. Autre chose sur le port : on N'ESSAIE PAS, et on ne conclut rien.
    const autre = await faireServeur(false);
    try {
      const r = await relever(racine, { HIVE_PORT: String(autre.port) }, 'linux');
      expect(r.port.parNous, 'ce n’est pas une ruche').toBe(false);
      expect(r.wsJoignable, 'donc on n’a rien essayé, et on ne sait rien').toBeNull();
    } finally {
      await autre.fermer();
      rmSync(racine, { recursive: true, force: true });
    }
  });
});

describe('LA COMMANDE, LANCÉE POUR DE VRAI', () => {
  // C'est en la LANÇANT qu'on a trouvé le `require` en ESM, pas en la relisant.
  // Ce test-ci est la version automatique de ce geste : il exécute la CLI dans
  // un vrai processus, sur une racine fabriquée, et lit ce qui en sort.
  //
  // Il attrape ce qu'aucun test unitaire ne voit : une commande débranchée du
  // répartiteur, un import qui ne résout pas, une sortie non-JSON sous `--json`,
  // un code de sortie qui ne reflète pas le verdict.

  const lancer = (racine: string, args: string[]): Promise<{ code: number; sortie: string }> =>
    import('node:child_process').then(
      ({ execFile }) =>
        new Promise((resolve) => {
          // `shell: false` (défaut d'execFile) : invariant du dépôt.
          // On lance depuis la RACINE DU DÉPÔT — `tsx` ne se résout pas
          // ailleurs — et on désigne l'installation à examiner par argument.
          execFile(
            process.execPath,
            ['--import', 'tsx', 'src/cli.ts', 'doctor', racine, ...args],
            { cwd: process.cwd(), timeout: 60_000, env: { ...process.env, HIVE_PORT: '0' } },
            (err, stdout) => {
              const code =
                err && typeof (err as { code?: unknown }).code === 'number'
                  ? (err as { code: number }).code
                  : 0;
              resolve({ code, sortie: stdout });
            },
          );
        }),
    );

  it('`doctor --json` REND DU JSON VALIDE, onze diagnostics, et un code de sortie', async () => {
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-cli-'));
    try {
      const { code, sortie } = await lancer(racine, ['--json']);
      const vu = JSON.parse(sortie) as {
        verdict: string;
        diagnostics: { cle: string; gravite: string; reparation: string | null }[];
      };
      expect(vu.diagnostics, 'les onze de la mission').toHaveLength(11);
      // Une racine nue n'a ni .env ni jeton : le verdict DOIT être bloquant, et
      // le code de sortie doit le dire à la supervision qui l'écoute.
      expect(vu.verdict).toBe('bloquant');
      expect(code, 'bloquant ⇒ 2').toBe(2);
      for (const d of vu.diagnostics) {
        if (d.gravite !== 'ok') expect(d.reparation, `${d.cle} sans réparation`).toBeTruthy();
      }
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  }, 90_000);

  it('sans `--json`, la réparation est écrite JUSTE SOUS son constat', async () => {
    // C'est ce qu'on copie-colle. La chercher ailleurs dans la sortie casserait
    // le geste, et le docteur redeviendrait un thermomètre.
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-cli2-'));
    try {
      const { sortie } = await lancer(racine, []);
      const lignes = sortie.split('\n');
      const i = lignes.findIndex((l) => l.includes('env_present'));
      expect(i, 'le diagnostic .env doit apparaître').toBeGreaterThan(-1);
      expect(lignes[i + 1], 'sa réparation vient à la ligne suivante').toContain('.env.example');
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  }, 90_000);
});
