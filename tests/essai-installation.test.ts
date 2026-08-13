// Le banc du seuil — qui garde le gardien.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// `scripts/essai-installation.sh` est la seule chose du dépôt qui mène
// l'installation en une commande jusqu'à une ruche qui répond. La CI l'appelle,
// et personne ne le regardait : un balayage de la loupe a muté son garde du
// `.env` — `||` en `&&` — et AUCUN cas de la suite n'a bougé.
//
// Un gardien que rien ne garde a la forme exacte du défaut qu'il existe pour
// attraper. Si ce script cessait silencieusement d'affirmer quoi que ce soit,
// la CI resterait verte et dirait « l'installation marche » sans l'avoir
// vérifiée — c'est-à-dire pire que si le pas n'existait pas.
//
// ─── CE QU'IL EXERCE, ET COMMENT ─────────────────────────────────────────────
//
// Le VRAI script, lancé par `sh`, dans un dossier temporaire où l'on plante :
//
//   - un faux `install.sh` dont on décide le code de sortie et le `.env` ;
//   - un `package.json` dont le script `ruche` lance un vrai serveur HTTP.
//
// Le script ne sait pas qu'on le trompe : il fait exactement ce qu'il fait en
// CI. Chaque cas ci-dessous change UNE chose et vérifie que le verdict change
// avec elle — c'est la seule façon de savoir qu'il affirme encore.
//
// ─── CE QUE CE BANC NE COUVRE PAS, ET C'EST DIT ──────────────────────────────
//
// Sous Windows, seule la syntaxe est vérifiée. Le script lit `/proc`, appelle
// `readlink` et `curl`, et son ménage suppose des processus POSIX : l'exercer
// sous Git Bash mesurerait l'émulation, pas le produit. Le travail `seuil` de
// la CI ne tourne lui non plus que sous Linux, et `docs/ETAPES.md` § 2.1 le
// note comme une couverture d'un système sur trois.
//
// Le cas « la ruche ne répond jamais » n'est pas exercé : le script attend
// soixante secondes avant de trancher, et cette durée n'est pas réglable de
// l'extérieur. Il a été mesuré à la main, sur un arbre cassé exprès
// (`app.listen({ port: config.port + 1 })`) — CODE=1, journal à l'appui.

import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// `fileURLToPath`, jamais `.pathname` : sur Windows ce dernier rend
// `/D:/a/hive/…` et `path.resolve` en fait `D:\D:\a\hive\…` (§ 6.1 du carnet).
const SCRIPT = fileURLToPath(new URL('../scripts/essai-installation.sh', import.meta.url));

describe('le banc du seuil — la syntaxe, sur tous les systèmes', () => {
  it('`sh -n` accepte le script', () => {
    // Rien d'autre ne relit ce fichier : une virgule de travers y dormirait
    // jusqu'à la prochaine PR, et rougirait alors sur un diff sans rapport.
    expect(() => execFileSync('sh', ['-n', SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });
});

/** Un port libre, demandé au système plutôt que deviné. */
function portLibre(): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const sonde = createServer();
    sonde.on('error', rejeter);
    sonde.listen(0, '127.0.0.1', () => {
      const adresse = sonde.address();
      if (adresse === null || typeof adresse === 'string') {
        sonde.close();
        rejeter(new Error('adresse inattendue'));
        return;
      }
      const port = adresse.port;
      sonde.close(() => resoudre(port));
    });
  });
}

// `runIf` plutôt qu'un saut muet : sous Windows ces cas seraient VERTS et sans
// objet, ce qui est la pire des deux façons de ne pas tester quelque chose.
describe.runIf(process.platform !== 'win32')('le banc du seuil — en comportement', () => {
  const dossiers: string[] = [];

  afterEach(() => {
    for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /**
   * Plante un faux chantier et rend le verdict du script.
   *
   * Le faux `install.sh` est un shell de trois lignes : c'est lui qui décide du
   * code de sortie et du `.env`, donc lui qui choisit ce que le script devrait
   * conclure. Rien d'autre n'est simulé — le script lit le `.env` pour de vrai,
   * lance `npm run ruche` pour de vrai, et interroge le port pour de vrai.
   */
  function courir(options: {
    codeInstall: number;
    env?: string | null;
    permissions?: number;
    rucheRepond?: boolean;
    args?: string[];
  }): { code: number; sortie: string } {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'banc-seuil-'));
    dossiers.push(dossier);

    cpSync(SCRIPT, path.join(dossier, 'essai-installation.sh'));

    // Tout est posé par le FAUX INSTALLEUR, dans le dossier qu'il reçoit en
    // `--dir` — pas à côté. Première version : les fichiers étaient écrits dans
    // le dossier de travail du banc, et `npm run ruche` mourait sur un
    // `package.json` introuvable. La leçon est celle du script lui-même : le
    // pas 3 lance la ruche DEPUIS l'installation, jamais depuis ailleurs.
    //
    // Les documents passent par des heredocs entre quotes : `printf '%s'`
    // n'interprète pas les échappements, et une chaîne JSON y aurait déposé un
    // « \n » littéral. Mesuré — le port lu valait `36465\nHIVE_TOKEN`.
    const ruche =
      options.rucheRepond === false
        ? 'process.exit(0);'
        : [
            "import { createServer } from 'node:http';",
            "import { readFileSync } from 'node:fs';",
            "const env = readFileSync(new URL('.env', import.meta.url), 'utf8');",
            "const port = Number(/^HIVE_PORT=(.*)$/m.exec(env)?.[1] ?? '0');",
            "createServer((_, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{}'); })",
            "  .listen(port, '127.0.0.1');",
          ].join('\n');

    const pose =
      options.env === null || options.env === undefined
        ? []
        : [
            'mkdir -p "$CIBLE"',
            'cat > "$CIBLE/.env" <<\'ENVFIN\'',
            options.env.replace(/\n$/, ''),
            'ENVFIN',
            `chmod ${(options.permissions ?? 0o600).toString(8).padStart(3, '0')} "$CIBLE/.env"`,
            'cat > "$CIBLE/package.json" <<\'PKGFIN\'',
            '{ "name": "faux-chantier", "private": true, "scripts": { "ruche": "node ruche.mjs" } }',
            'PKGFIN',
            'cat > "$CIBLE/ruche.mjs" <<\'RUCHEFIN\'',
            ruche,
            'RUCHEFIN',
          ];

    writeFileSync(
      path.join(dossier, 'install.sh'),
      [
        '#!/usr/bin/env sh',
        'CIBLE=""',
        'for a in "$@"; do case "$a" in --dir=*) CIBLE="${a#--dir=}" ;; esac; done',
        ...pose,
        `exit ${options.codeInstall}`,
        '',
      ].join('\n'),
    );
    chmodSync(path.join(dossier, 'install.sh'), 0o755);

    const verdict = spawnSync('sh', ['essai-installation.sh', ...(options.args ?? [])], {
      cwd: dossier,
      encoding: 'utf8',
      // shell: false par défaut — aucun argument ne traverse d'interpréteur.
      timeout: 90_000,
    });

    return { code: verdict.status ?? -1, sortie: `${verdict.stdout}${verdict.stderr}` };
  }

  function envValide(port: number): string {
    return `HIVE_PORT=${port}\nHIVE_TOKEN=jeton-de-banc-suffisamment-long\n`;
  }

  it('les trois affirmations passent quand tout va bien', async () => {
    const port = await portLibre();
    const { code, sortie } = courir({ codeInstall: 0, env: envValide(port) });

    expect(sortie).toContain('✔ 1/3');
    expect(sortie).toContain('✔ 2/3 — .env en -rw-------');
    expect(sortie, 'le seul pas qui ne peut pas être simulé').toContain('✔ 3/3');
    expect(code).toBe(0);
  });

  it('un `.env` ABSENT est dit, et il fait rougir', async () => {
    // C'est le mutant que la loupe avait planté : `[ -f … ] ||` devenu `&&`.
    // Avec lui, un `.env` manquant ne déclenche plus rien et le script échoue
    // plus loin, sur un `ls`, sans jamais nommer ce qui manque.
    const { code, sortie } = courir({ codeInstall: 0, env: null });

    expect(sortie).toContain('✘ .env absent');
    expect(code).toBe(1);
  });

  it('un `.env` lisible par tous fait rougir — un secret n’est pas un réglage', async () => {
    const port = await portLibre();
    const { code, sortie } = courir({
      codeInstall: 0,
      env: envValide(port),
      permissions: 0o644,
    });

    expect(sortie).toContain('un secret doit être en 0600');
    expect(sortie, 'le pas 2 ne doit pas se déclarer réussi').not.toContain('✔ 2/3');
    expect(code).toBe(1);
  });

  it('un `.env` sans HIVE_PORT fait rougir plutôt que de supposer 7777', async () => {
    // Supposer le port ferait passer le pas 3 sur une ruche qu'on n'a pas
    // installée — un vert emprunté, c'est-à-dire le pire des rouges.
    const { code, sortie } = courir({
      codeInstall: 0,
      env: 'HIVE_TOKEN=jeton-de-banc-suffisamment-long\n',
    });

    expect(sortie).toContain('✘ .env sans HIVE_PORT');
    expect(code).toBe(1);
  });

  it('une installation qui échoue est redonnée telle quelle, avec son code', async () => {
    const { code, sortie } = courir({ codeInstall: 7, env: null });

    expect(sortie).toContain('✘ installation sortie en 7');
    expect(code).toBe(1);
  });

  it('« je n’ai pas pu conclure » n’est PAS « le produit est cassé »', async () => {
    // 4 = PORT_OCCUPE : un service étranger tient le port par défaut.
    // Confondre ce cas avec un rouge apprend à relancer au lieu de lire, et
    // c'est ainsi qu'on cesse de croire aux rouges.
    const { code, sortie } = courir({ codeInstall: 4, env: null });

    expect(sortie).toContain('NON CONCLUANT');
    expect(code, '78, pas 1').toBe(78);
  });

  it('un drapeau inconnu est refusé plutôt qu’ignoré', async () => {
    const { code, sortie } = courir({ codeInstall: 0, env: null, args: ['--parapluie'] });

    expect(sortie).toContain('argument inconnu : --parapluie');
    expect(code).toBe(64);
  });

  it('le dossier d’essai ne survit pas à la course, même quand elle échoue', async () => {
    // Les deux ménages précédents laissaient des ruches vivantes, et le rouge
    // apparaissait plus tard dans un banc innocent (§ 9 sexquinquagies).
    const { sortie } = courir({ codeInstall: 0, env: null });

    const trace = /hive-essai-installation-\d+/.exec(sortie);
    expect(trace, 'le script annonce son dossier').not.toBeNull();
    expect(
      spawnSync('test', ['-d', path.join(os.tmpdir(), trace?.[0] ?? 'introuvable')]).status,
      'le dossier doit avoir disparu',
    ).not.toBe(0);
  });
});
