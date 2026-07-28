// L'empreinte de Hive sur une machine — et la garde qui la tient à jour.
//
// ─── CE QUE CE FICHIER VÉRIFIE, ET POURQUOI C'EST INHABITUEL ─────────────────
//
// `docs/INSTALLATION.md` promet : « Hive n'écrit rien hors de son dossier. Le
// supprimer suffit. » C'est vrai aujourd'hui. Le problème n'est pas la
// promesse, c'est qu'AUCUN mécanisme ne la maintient : le jour où quelqu'un
// écrira un `writeFileSync(path.join(os.homedir(), '.hiverc'), …)`, rien ne
// s'en apercevra, et la phrase deviendra un mensonge sans qu'une seule ligne
// de documentation ait bougé.
//
// La dernière section de ce fichier RELÈVE les appels d'écriture réels de
// `src/` et les compare à une liste déclarée. Un fichier qui se met à écrire,
// ou un `os.homedir()` qui apparaît, fait rougir — et la personne doit alors
// décider : soit c'est légitime et elle l'ajoute à `src/shared/empreinte.ts`
// (donc à `hive desinstaller`, donc à la doc), soit elle ne devait pas.
//
// C'est le motif que ce dépôt a appris à ses dépens : une règle écrite sans
// câblage n'est pas une règle.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Contexte,
  PREFIXE_FUSION,
  empreinte,
  horsDuDossier,
} from '../src/shared/empreinte.js';
import { DISQUE, contexteReel, relever, retirer, taillelisible } from '../src/desinstallation.js';

const RACINE = new URL('..', import.meta.url);
/**
 * La racine EN CHEMIN DE FICHIER, pas en URL.
 *
 * ─── LE § 6.1, RECOMMIS DANS LE FICHIER QUI LE CITE ──────────────────────────
 *
 * `new URL('..', import.meta.url).pathname` vaut `/D:/a/hive/` sous Windows —
 * une barre AVANT la lettre de lecteur. Passé en `cwd` d'un `spawn`, ça échoue
 * (« expected -1 to be +0 ») ; passé à `readdir`, ça rend une liste VIDE.
 *
 * Le second est le pire des deux : le relevé des écritures de `src/` ne voyait
 * plus aucun fichier, et la garde « os.homedir() n'apparaît nulle part »
 * bouclait sur zéro élément — donc PASSAIT, en n'ayant rien regardé. C'est le
 * § 1.2 rejoué : une garde qu'on croit tenue et qui ne tourne nulle part.
 *
 * `fileURLToPath` est la seule conversion correcte. `.pathname` ne l'est
 * jamais, sur aucune plateforme.
 */
const RACINE_CHEMIN = fileURLToPath(RACINE);

const ctxPosix: Contexte = {
  racine: '/home/moi/hive',
  dbPath: '/home/moi/hive/data/hive.db',
  workdir: '/home/moi/hive/.hive-work',
  tmpdir: '/tmp',
  home: '/home/moi',
  plateforme: 'linux',
};

describe('L’EMPREINTE — module pur', () => {
  it('nomme les six endroits où la ruche peut écrire', () => {
    expect(empreinte(ctxPosix).map((e) => e.cle)).toEqual([
      'env',
      'base',
      'rayons',
      'travail',
      'service',
      'fusions',
    ]);
  });

  it('L’ÉTAT ET LES SECRETS NE SONT JAMAIS RETIRABLES — décision de l’ADR 0004', () => {
    // « Un outil d'installation n'est pas un outil de destruction ; le jour où
    //   quelqu'un lance uninstall en croyant désinstaller le service, il ne
    //   doit pas perdre six mois de ruche. »
    //
    // Cette assertion est la traduction exécutable de cette phrase. Si un jour
    // quelqu'un bascule `retirable` sur `.env` ou sur la base, il le fera en
    // rougissant ce test, pas par mégarde.
    for (const e of empreinte(ctxPosix)) {
      if (e.genre === 'etat' || e.genre === 'secret') {
        expect(e.retirable, `${e.cle} est ${e.genre} et pourtant retirable`).toBe(false);
      }
    }
  });

  it('chaque emplacement DIT ce qu’on perd', () => {
    // Un inventaire qui liste des chemins sans dire ce qu'ils coûtent ne sert
    // qu'à faire peur. C'est la même exigence que `hive doctor`, où chaque
    // échec porte la commande qui répare.
    for (const e of empreinte(ctxPosix)) {
      expect(e.quoi.length, `${e.cle} sans description`).toBeGreaterThan(10);
      expect(e.consequence.length, `${e.cle} sans conséquence`).toBeGreaterThan(10);
    }
  });

  it('les fichiers frères de SQLite sont comptés — `-wal` et `-shm`', () => {
    // Les oublier donnerait une taille fausse dans l'inventaire, et surtout
    // une sauvegarde incomplète à qui ne copierait que « le » fichier de base.
    const base = empreinte(ctxPosix).find((e) => e.cle === 'base')!;
    const chemins = (base.contenu ?? []).map((c) => c.chemin);
    expect(chemins).toContain('/home/moi/hive/data/hive.db-wal');
    expect(chemins).toContain('/home/moi/hive/data/hive.db-shm');
  });

  it('la clé du nœud est NOMMÉE, parce qu’elle disparaît avec `.hive-work`', () => {
    const travail = empreinte(ctxPosix).find((e) => e.cle === 'travail')!;
    const cle = (travail.contenu ?? []).find((c) => c.chemin.endsWith('node-key.txt'));
    expect(cle, 'node-key.txt absent de l’inventaire').toBeTruthy();
    expect(cle?.quoi).toMatch(/billet/);
  });

  it('LA PLATEFORME EST UN PARAMÈTRE : la forme Windows se vérifie depuis Linux', () => {
    // § 6.3 de `docs/ERREURS.md`. Une branche par plateforme qui lit
    // `process.platform` au passage n'est lisible que sur cette plateforme,
    // donc jamais éprouvée.
    const win = empreinte({
      racine: 'C:\\Users\\moi\\hive',
      dbPath: 'C:\\Users\\moi\\hive\\data\\hive.db',
      workdir: 'C:\\Users\\moi\\hive\\.hive-work',
      tmpdir: 'C:\\Users\\moi\\AppData\\Local\\Temp',
      home: 'C:\\Users\\moi',
      plateforme: 'win32',
    });
    expect(win.find((e) => e.cle === 'env')!.chemin).toBe('C:\\Users\\moi\\hive\\.env');
    expect(win.find((e) => e.cle === 'rayons')!.chemin).toBe('C:\\Users\\moi\\hive\\data\\rayons');
    // Windows range son XML de tâche planifiée DANS l'installation, pas dans le
    // dossier personnel — contrairement à systemd et à launchd. C'est le seul
    // des trois pour lequel « supprimer le dossier » emporte aussi le fichier
    // de service (mais pas son inscription : `hive service uninstall` reste le
    // bon geste).
    expect(win.find((e) => e.cle === 'service')!.chemin).toBe(
      'C:\\Users\\moi\\hive\\data\\hive-ruche.xml',
    );
  });

  it('DEUX choses sortent du dossier d’installation, et pas une de plus', () => {
    // Les restes de fusion, toujours — et le fichier de SERVICE, qui vit dans
    // le dossier personnel quand on en a demandé un. Ce second est arrivé avec
    // le lot du service, et c'est ce test qui a exigé qu'on le dise : la
    // documentation annonçait « une seule écriture hors du dossier ».
    const dehors = horsDuDossier(ctxPosix);
    expect(dehors.map((e) => e.cle)).toEqual(['service', 'fusions']);
    expect(dehors.find((e) => e.cle === 'fusions')!.prefixe).toBe(PREFIXE_FUSION);
    // Le fichier de service n'est jamais retiré à la main : `hive service
    // uninstall` désinscrit d'abord.
    expect(dehors.find((e) => e.cle === 'service')!.retirable).toBe(false);
  });

  it('…et `HIVE_DB` hors du dossier le fait savoir', () => {
    // Quelqu'un qui pose sa base sur un autre disque ne doit pas lire « rien
    // hors du dossier » : c'est faux POUR LUI, et c'est justement le cas où il
    // faut le dire.
    const ailleurs = horsDuDossier({ ...ctxPosix, dbPath: '/var/lib/hive/hive.db' });
    expect(ailleurs.map((e) => e.cle).sort()).toEqual(['base', 'fusions', 'rayons', 'service']);
  });
});

describe('LE RELEVÉ — sur un vrai disque', () => {
  const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-desinst-'));
  const ctx: Contexte = {
    racine: path.join(bac, 'ruche'),
    dbPath: path.join(bac, 'ruche', 'data', 'hive.db'),
    workdir: path.join(bac, 'ruche', '.hive-work'),
    tmpdir: path.join(bac, 'temp'),
    home: path.join(bac, 'maison'),
    plateforme: process.platform,
  };

  const poser = (): void => {
    mkdirSync(path.join(ctx.racine, 'data', 'rayons', 'p1'), { recursive: true });
    mkdirSync(path.join(ctx.workdir, 'join'), { recursive: true });
    mkdirSync(ctx.tmpdir, { recursive: true });
    writeFileSync(path.join(ctx.racine, '.env'), 'HIVE_TOKEN=x\n');
    writeFileSync(ctx.dbPath, 'x'.repeat(4096));
    writeFileSync(path.join(ctx.workdir, 'join', 'node-key.txt'), 'k');
    // Deux restes de fusion, et un dossier qui n'en est PAS un : le balayage
    // par préfixe doit distinguer les deux.
    mkdirSync(path.join(ctx.tmpdir, `${PREFIXE_FUSION}aaa`), { recursive: true });
    mkdirSync(path.join(ctx.tmpdir, `${PREFIXE_FUSION}bbb`), { recursive: true });
    mkdirSync(path.join(ctx.tmpdir, 'rien-a-voir'), { recursive: true });
  };

  it('trouve ce qui est là, et seulement ça', () => {
    poser();
    const r = relever(ctx);
    const par = (cle: string) => r.find((t) => t.emplacement.cle === cle)!;

    expect(par('env').presents).toHaveLength(1);
    expect(par('base').octets).toBe(4096);
    expect(par('rayons').presents).toHaveLength(1);

    // LE BALAYAGE PAR PRÉFIXE. Deux restes, et le dossier voisin épargné.
    expect(par('fusions').presents).toHaveLength(2);
    expect(par('fusions').presents.every((c) => path.basename(c).startsWith(PREFIXE_FUSION))).toBe(
      true,
    );

    // La clé est signalée comme présente, pas seulement annoncée.
    expect(par('travail').contenu.map((c) => path.basename(c.chemin))).toContain('node-key.txt');
  });

  it('un emplacement absent rend zéro, sans exploser', () => {
    // Tous les champs pointent ailleurs, pas seulement `racine` : ma première
    // version gardait le vrai `workdir` et croyait mesurer le vide.
    const nulPart = path.join(bac, 'nulle-part');
    const vide: Contexte = {
      ...ctx,
      racine: nulPart,
      dbPath: path.join(nulPart, 'x.db'),
      workdir: path.join(nulPart, '.hive-work'),
    };
    for (const t of relever(vide)) {
      if (t.emplacement.cle === 'fusions') continue;
      expect(t.presents, t.emplacement.cle).toHaveLength(0);
      expect(t.octets).toBe(0);
    }
  });

  it('`retirer` ENLÈVE le travail et les restes, et REFUSE l’état', () => {
    poser();
    const gestes = retirer(relever(ctx));
    const issue = (cle: string) => gestes.find((g) => g.cle === cle)!.issue;

    expect(issue('env')).toBe('protege');
    expect(issue('base')).toBe('protege');
    expect(issue('rayons')).toBe('supprime');
    expect(issue('travail')).toBe('supprime');
    expect(issue('fusions')).toBe('supprime');

    // LA VÉRIFICATION QUI COMPTE : on regarde le DISQUE, pas le rapport.
    // Un `retirer` qui rendrait « supprimé » sans rien effacer passerait les
    // trois assertions du dessus.
    expect(existsSync(path.join(ctx.racine, '.env')), '.env a été supprimé').toBe(true);
    expect(existsSync(ctx.dbPath), 'la base a été supprimée').toBe(true);
    expect(existsSync(ctx.workdir), '.hive-work survit').toBe(false);
    expect(existsSync(path.join(ctx.tmpdir, `${PREFIXE_FUSION}aaa`)), 'reste de fusion').toBe(
      false,
    );
    // Et le voisin qui ne porte pas le préfixe n'a pas été emporté.
    expect(existsSync(path.join(ctx.tmpdir, 'rien-a-voir')), 'voisin emporté').toBe(true);

    rmSync(bac, { recursive: true, force: true });
  });

  it('la taille NE SUIT PAS les liens symboliques', () => {
    // Un agent a le droit de créer un lien dans son espace de travail. Un lien
    // vers `/` ferait parcourir le système entier pour afficher une taille.
    //
    // (Cette garde a été écrite avec `statSync`, qui SUIT les liens : elle ne
    //  gardait donc rien. `lstatSync` corrigé — c'est la famille § 1.1.)
    //
    // ─── ET LA SONDE, ELLE AUSSI, A DÛ CHANGER DE QUESTION ───────────────────
    //
    // Première version : `execFileSync('ln', ['-s', …])`, avec un `catch` qui
    // s'abstenait « s'il n'y a pas de `ln` ». Sous Windows, Git Bash EN A UN,
    // il réussit — et COPIE le dossier au lieu de lier. Le test a mesuré
    // 51 000 octets et accusé la garde d'avoir suivi un lien qui n'existait
    // pas. C'est le § 6.5, recommis : j'ai sondé une CAPACITÉ là où seul
    // comptait le RÉSULTAT.
    //
    // On crée donc le lien avec `node:fs` — pas d'outil externe — puis on
    // VÉRIFIE que c'en est un. Si le système ne sait pas en faire (Windows sans
    // droit ni mode développeur), il n'y a rien à conclure et rien à casser.
    const b = mkdtempSync(path.join(os.tmpdir(), 'hive-lien-'));
    try {
      const dossier = path.join(b, 'd');
      mkdirSync(dossier, { recursive: true });
      writeFileSync(path.join(dossier, 'vrai.bin'), 'x'.repeat(1000));
      const cible = path.join(b, 'gros');
      mkdirSync(cible, { recursive: true });
      writeFileSync(path.join(cible, 'enorme.bin'), 'y'.repeat(50_000));

      const lien = path.join(dossier, 'lien');
      try {
        symlinkSync(cible, lien, 'junction');
      } catch {
        console.warn('⚠ ce système ne crée pas de lien ici : garde non exercée.');
        return;
      }
      if (!lstatSync(lien).isSymbolicLink()) {
        console.warn('⚠ ce qui a été créé n’est pas un lien : garde non exercée.');
        return;
      }

      expect(DISQUE.taille(dossier), 'le lien a été suivi').toBe(1000);
    } finally {
      rmSync(b, { recursive: true, force: true });
    }
  });

  it('`contexteReel` respecte HIVE_DB et HIVE_WORKDIR', () => {
    const c = contexteReel('/r', { HIVE_DB: '/ailleurs/x.db', HIVE_WORKDIR: '/w' });
    expect(c.dbPath).toBe('/ailleurs/x.db');
    expect(c.workdir).toBe('/w');
    // Et sans elles, tout retombe sous la racine.
    const d = contexteReel('/r', {});
    expect(d.dbPath).toBe(path.join('/r', 'data', 'hive.db'));
    expect(d.workdir).toBe(path.join('/r', '.hive-work'));
  });

  it('UNE VARIABLE VIDE NE DIT RIEN — elle ne redirige pas vers le vide', () => {
    // `env.HIVE_DB ?? défaut` garde `''` : une chaîne vide n'est pas nullish.
    // `dbPath` valait alors `''`, `dirname('')` vaut `'.'`, et le relevé —
    // donc la SUPPRESSION — visait le répertoire courant au lieu de
    // l'installation. Un `HIVE_DB=` vide dans un `.env` ou un `docker run -e`
    // suffit à le déclencher.
    for (const vide of ['', '   ']) {
      const c = contexteReel('/r', { HIVE_DB: vide, HIVE_WORKDIR: vide });
      expect(c.dbPath, `HIVE_DB=${JSON.stringify(vide)}`).toBe(path.join('/r', 'data', 'hive.db'));
      expect(c.workdir).toBe(path.join('/r', '.hive-work'));
    }
  });

  it('les tailles se lisent', () => {
    expect(taillelisible(512)).toBe('512 o');
    expect(taillelisible(2048)).toBe('2.0 ko');
    expect(taillelisible(5 * 1024 * 1024)).toBe('5.0 Mo');
    expect(taillelisible(20 * 1024 * 1024)).toBe('20 Mo');
  });
});

describe('`hive desinstaller` LANCÉ POUR DE VRAI', () => {
  // Le module pur et sa moitié impure sont éprouvés au-dessus. Ceci vérifie le
  // CÂBLAGE — que la commande existe, qu'elle vise la racine qu'on lui donne,
  // et surtout qu'elle ne supprime rien sans qu'on le lui ait demandé.
  //
  // C'est la règle n° 1 de `docs/ERREURS.md` : ce qui n'est pas exécuté n'est
  // pas vérifié. Une commande branchée dans un `else if` que personne ne
  // traverse est du code mort qui a l'air vivant.

  const lancer = (args: string[]): { code: number; sortie: string } => {
    try {
      return {
        code: 0,
        // ─── PAS `npx`, ET C'EST UNE LEÇON DÉJÀ PAYÉE ───────────────────────
        //
        // La première version lançait `execFileSync('npx', ['tsx', …])`. Sous
        // Windows, `npx` est `npx.cmd`, et Node REFUSE d'exécuter un `.cmd`
        // sans `shell: true` — durci depuis la CVE-2024-27980. Ces trois tests
        // auraient rougi sur la seule plateforme où je ne les avais pas vus
        // tourner. C'est exactement le § 6.2 de `docs/ERREURS.md`, le défaut
        // que ce dépôt a déjà sorti une fois, dans `agent-detect`.
        //
        // `process.execPath` est un VRAI exécutable partout, et `--import tsx`
        // est l'invocation documentée de tsx v4. Aucun `.cmd` sur le chemin,
        // aucune résolution de `npx` à faire, et c'est plus rapide.
        sortie: execFileSync(
          process.execPath,
          ['--import', 'tsx', 'src/cli.ts', 'desinstaller', ...args],
          {
            cwd: RACINE_CHEMIN,
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

  it('SANS `--oui`, elle n’efface RIEN — même ce qu’elle a le droit d’effacer', () => {
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-cli-desinst-'));
    try {
      mkdirSync(path.join(bac, 'data', 'rayons'), { recursive: true });
      mkdirSync(path.join(bac, '.hive-work'), { recursive: true });
      writeFileSync(path.join(bac, '.env'), 'HIVE_TOKEN=x\n');

      const r = lancer([bac]);
      expect(r.code, r.sortie).toBe(0);
      expect(r.sortie).toMatch(/Rien n’a été supprimé/);

      // LA VÉRIFICATION QUI COMPTE : le disque, pas le message. Un défaut qui
      // supprimerait quand même laisserait cette phrase intacte.
      expect(existsSync(path.join(bac, '.env'))).toBe(true);
      expect(existsSync(path.join(bac, 'data', 'rayons'))).toBe(true);
      expect(existsSync(path.join(bac, '.hive-work'))).toBe(true);

      // ─── LE `rm -rf` SUGGÉRÉ NE VISE QUE L'ÉTAT ────────────────────────────
      //
      // La loupe a fait survivre un mutant ici : inverser la condition ferait
      // suggérer `rm -rf` sur ce qui est RECONSTRUCTIBLE, sous le titre
      // « l'état n'est jamais retiré par cette commande ». Un mauvais conseil
      // affiché avec autorité, pas un détail cosmétique.
      const suggestions = r.sortie
        .split('\n')
        .filter((l) => l.trim().startsWith('rm -rf'))
        .join('\n');
      expect(suggestions, 'le `.env` devrait être suggéré').toContain(path.join(bac, '.env'));
      expect(suggestions, '`.hive-work` est reconstructible, pas à suggérer').not.toContain(
        '.hive-work',
      );
      expect(suggestions, 'les rayons sont reconstructibles').not.toContain('rayons');

      // Et un emplacement ABSENT n'est pas affiché avec une liste vide : ici,
      // il n'y a pas de base — la ligne ne doit pas apparaître.
      expect(r.sortie, 'un emplacement absent est affiché').not.toMatch(/mémoire de la ruche/);
      expect(r.sortie).toMatch(/absent\(s\) ici/);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it('AVEC `--oui`, elle enlève le reconstructible et GARDE `.env` et la base', () => {
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-cli-desinst-'));
    try {
      mkdirSync(path.join(bac, 'data', 'rayons', 'p1'), { recursive: true });
      mkdirSync(path.join(bac, '.hive-work', 'join'), { recursive: true });
      writeFileSync(path.join(bac, '.env'), 'HIVE_TOKEN=x\n');
      writeFileSync(path.join(bac, 'data', 'hive.db'), 'base');
      writeFileSync(path.join(bac, '.hive-work', 'join', 'node-key.txt'), 'k');

      const r = lancer([bac, '--oui']);
      expect(r.code, r.sortie).toBe(0);

      expect(existsSync(path.join(bac, '.env')), '.env supprimé').toBe(true);
      expect(existsSync(path.join(bac, 'data', 'hive.db')), 'base supprimée').toBe(true);
      expect(existsSync(path.join(bac, 'data', 'rayons')), 'rayons gardés').toBe(false);
      expect(existsSync(path.join(bac, '.hive-work')), '.hive-work gardé').toBe(false);

      // ─── CE QUI RESTE DOIT ÊTRE DIT, AVEC SON CHEMIN ───────────────────────
      //
      // Quelqu'un qui désinstalle doit savoir ce qui SUBSISTE, pas seulement ce
      // qui est parti. Un mutant survivait ici : la ligne « conservé » pouvait
      // s'afficher pour un emplacement absent, donc avec une liste de chemins
      // VIDE — « ⚠ env — conservé : » et rien derrière.
      const conserves = r.sortie
        .split('\n')
        .filter((l) => l.includes('conservé'))
        .map((l) => l.trim());
      expect(conserves.length, 'rien n’annonce ce qui reste').toBeGreaterThan(0);
      for (const l of conserves) {
        expect(l, `ligne « conservé » sans chemin : ${l}`).toMatch(/conservé\s*:\s*\S/);
      }
      expect(conserves.join('\n')).toContain(path.join(bac, '.env'));
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it('un emplacement PROTÉGÉ mais ABSENT n’est pas annoncé comme conservé', () => {
    // ─── LE SCÉNARIO QUE MON PREMIER TEST N'ATTEIGNAIT PAS ───────────────────
    //
    // La loupe faisait survivre un mutant sur `issue === 'protege' && chemins
    // .length > 0` : passé en `||`, la ligne « conservé » s'affiche pour un
    // emplacement protégé même quand il n'y a RIEN — « ⚠ base — conservé : »
    // suivi du vide.
    //
    // Mon test précédent créait toujours `.env` ET la base : les deux
    // emplacements protégés avaient un chemin, donc le mutant restait
    // invisible. C'est le § 2.4 — prétendre couvrir un chemin qu'on
    // n'emprunte pas. Ici, `.env` existe et la base NON.
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-cli-desinst-'));
    try {
      mkdirSync(path.join(bac, '.hive-work'), { recursive: true });
      writeFileSync(path.join(bac, '.env'), 'HIVE_TOKEN=x\n');

      const r = lancer([bac, '--oui']);
      expect(r.code, r.sortie).toBe(0);

      const conserves = r.sortie
        .split('\n')
        .filter((l) => l.includes('conservé'))
        .map((l) => l.trim());
      // Le `.env` est là : il DOIT être annoncé, avec son chemin.
      expect(conserves.join('\n')).toContain(path.join(bac, '.env'));
      // La base ne l'est pas : rien ne doit prétendre l'avoir conservée.
      expect(conserves.join('\n'), 'une base absente annoncée conservée').not.toMatch(
        /^\s*⚠ base\b/m,
      );
      for (const l of conserves) {
        expect(l, `ligne « conservé » sans chemin : ${l}`).toMatch(/conservé\s*:\s*\S/);
      }
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it('`--json` rend un objet, pour une supervision', () => {
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-cli-desinst-'));
    try {
      const r = lancer([bac, '--json']);
      expect(r.code, r.sortie).toBe(0);
      const vu = JSON.parse(r.sortie) as {
        racine: string;
        emplacements: { cle: string; retirable: boolean }[];
      };
      expect(vu.racine).toBe(path.resolve(bac));
      expect(vu.emplacements.map((e) => e.cle)).toContain('base');
      expect(vu.emplacements.find((e) => e.cle === 'base')!.retirable).toBe(false);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });
});

describe('LA GARDE : aucune écriture ne s’ajoute en douce hors de l’inventaire', () => {
  // ─── CE QUE CETTE SECTION FAIT ─────────────────────────────────────────────
  //
  // Elle relève les appels d'écriture RÉELS de `src/` et les compare à une
  // liste déclarée. Elle ne prouve pas qu'un chemin donné reste sous la racine
  // — un regard sur du texte ne peut pas faire ça. Elle prouve qu'une écriture
  // NOUVELLE ne peut pas apparaître sans qu'un humain la voie, et c'est
  // exactement ce qui manquait à la promesse de `docs/INSTALLATION.md`.

  // ─── LES DEUX FAMILLES, ET LE TROU QUE CETTE GARDE A TROUVÉ CHEZ ELLE ──────
  //
  // Première version : seulement les noms en `…Sync`. Elle a déclaré que
  // `src/orchestrator/miroir.ts` n'écrivait pas — alors qu'il fait
  // `await fs.mkdir(...)`, l'API à promesses, importée en
  // `import { promises as fs } from 'node:fs'`.
  //
  // C'est le désaccord entre la garde et mon relevé à la main qui l'a montré.
  // Une garde qui rate une famille entière d'appels donne PIRE que rien : la
  // confiance d'un vert.
  const ECRITURES_SYNC = [
    'writeFileSync',
    'appendFileSync',
    'mkdirSync',
    'mkdtempSync',
    'rmSync',
    'unlinkSync',
    'renameSync',
    'copyFileSync',
    'cpSync',
    'createWriteStream',
  ];
  const ECRITURES_PROMESSES = [
    'writeFile',
    'appendFile',
    'mkdir',
    'mkdtemp',
    'rm',
    'unlink',
    'rename',
    'copyFile',
    'cp',
  ];
  /**
   * L'un ou l'autre : un nom `…Sync` nu, ou un membre d'un objet `fs`-like.
   *
   * Le préfixe est exigé côté promesses (`fs.`, `fsp.`, `promises.`) : un
   * `rm(` ou un `cp(` nus attraperaient n'importe quelle méthode du dépôt.
   */
  const MOTIF_ECRITURE = new RegExp(
    `\\b(?:${ECRITURES_SYNC.join('|')})\\s*\\(` +
      `|\\b(?:fs|fsp|promises|fsPromises)\\.(?:${ECRITURES_PROMESSES.join('|')})\\s*\\(`,
  );
  const ECRITURES = ECRITURES_SYNC;

  /**
   * Les fichiers de `src/` qui ont le droit d'écrire, et sous quelle racine.
   *
   * Toute entrée ajoutée ici est une DÉCISION : si la racine n'est pas déjà
   * dans `src/shared/empreinte.ts`, il faut l'y ajouter — donc dans
   * `hive desinstaller`, donc dans la documentation.
   */
  const AUTORISES: Record<string, string> = {
    'src/cli.ts': '.hive-work/bin — le binaire cloudflared téléchargé',
    'src/desinstallation.ts': 'c’est LUI qui supprime, sur ordre explicite',
    'src/installer-main.ts': '<racine>/.env, écrit en 600 par écriture atomique',
    'src/node-client/client.ts': '<workdir>/<nom> — l’espace d’une tâche',
    'src/node-client/join.ts': '<workdir>/join — identifiant et clé du nœud',
    'src/node-client/merge-runner.ts': 'os.tmpdir()/hive-merge-* — effacé en finally',
    'src/node-client/workspace.ts': '<workdir>/<nom> et son .tmp voisin',
    'src/orchestrator/miroir.ts': '<données>/rayons — les miroirs git',
    'src/service-reel.ts':
      'le fichier de service — unité systemd, LaunchAgent ou tâche planifiée. ' +
      'Décidé ici plutôt que subi : c’est le seul écrit de Hive dans le dossier ' +
      'personnel, il est opt-in, et il figure dans `empreinte()` sous la clé ' +
      '« service » — donc dans `hive desinstaller`.',
    'src/orchestrator/store.ts': '<données> — le dossier de la base SQLite',
  };

  const sources = (): { chemin: string; texte: string }[] => {
    const trouves: { chemin: string; texte: string }[] = [];
    const pile = ['src'];
    while (pile.length > 0) {
      const d = pile.pop()!;
      for (const nom of DISQUE.lister(path.join(RACINE_CHEMIN, d))) {
        const rel = `${d}/${nom}`;
        const abs = path.join(RACINE_CHEMIN, rel);
        if (DISQUE.estDossier(abs)) pile.push(rel);
        else if (nom.endsWith('.ts') && !nom.endsWith('.d.ts')) {
          trouves.push({ chemin: rel, texte: readFileSync(abs, 'utf8') });
        }
      }
    }
    // ─── SANS CECI, TOUTE CETTE SECTION EST DU DÉCOR ─────────────────────────
    //
    // Sous Windows, un chemin mal converti a rendu ce parcours VIDE. La garde
    // « la liste des fichiers qui écrivent » a bien rougi — elle comparait à
    // une liste attendue. Mais celle de `os.homedir()` bouclait sur zéro
    // élément et PASSAIT, en n'ayant rien regardé.
    //
    // Un plancher grossier suffit à rendre ce silence impossible : `src/`
    // compte des dizaines de modules, il n'en aura jamais moins de vingt sans
    // que quelqu'un s'en aperçoive autrement.
    if (trouves.length < 20) {
      throw new Error(
        `le relevé de \`src/\` n’a trouvé que ${trouves.length} fichier(s) — ` +
          'le parcours est cassé, et toutes les gardes qui en dépendent ne ' +
          'regardent plus rien.',
      );
    }
    return trouves;
  };

  /** Sans commentaires ni chaînes : sinon la prose ferait passer la garde. */
  const nu = (s: string): string =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  it('LA LISTE DES FICHIERS QUI ÉCRIVENT est exactement celle qui est déclarée', () => {
    const reels = sources()
      .filter((f) => MOTIF_ECRITURE.test(nu(f.texte)))
      .map((f) => f.chemin)
      .sort();

    expect(
      reels,
      'un fichier de `src/` s’est mis à écrire (ou a cessé). Si c’est voulu, ' +
        'ajoutez-le à `src/shared/empreinte.ts` — donc à `hive desinstaller` et ' +
        'à `docs/INSTALLATION.md` — puis à la liste AUTORISES de ce test.',
    ).toEqual(Object.keys(AUTORISES).sort());
  });

  it('`os.homedir()` n’apparaît QUE là où c’est déclaré, et jamais pour ÉCRIRE', () => {
    // ─── UNE RÈGLE QUI A DÛ ÉVOLUER, ET POURQUOI ─────────────────────────────
    //
    // Cette garde disait « nulle part », et c'était juste tant que Hive
    // n'écrivait rien dans le dossier personnel. Le service a changé ça : une
    // unité `systemd --user` et un `LaunchAgent` y vivent, par construction.
    //
    // Interdire `homedir()` serait devenu faux ; le retirer aurait rendu la
    // porte de sortie la plus banale — un `~/.hiverc`, un cache dans
    // `~/.cache` — de nouveau invisible. La règle devient donc : `homedir()`
    // n'apparaît que dans les deux fichiers qui construisent un CONTEXTE, et
    // jamais dans la même expression qu'un appel d'écriture.
    //
    // Les modules PURS, eux, reçoivent le dossier personnel en paramètre : ce
    // sont eux qui composent les chemins, et ils sont testables sans disque.
    const DECLARES: Record<string, string> = {
      'src/desinstallation.ts': 'construit le contexte du relevé — il CHERCHE, il n’écrit pas',
      'src/service-reel.ts': 'construit le contexte du service — le chemin vient du module pur',
    };
    const avec = sources()
      .filter((f) => /\bhomedir\s*\(/.test(nu(f.texte)))
      .map((f) => f.chemin)
      .sort();
    expect(
      avec,
      'un fichier de `src/` s’est mis à lire le dossier personnel. Si c’est ' +
        'légitime, déclarez-le ici — et vérifiez qu’il ne compose pas un chemin ' +
        'd’écriture avec.',
    ).toEqual(Object.keys(DECLARES).sort());

    // Et la garde qui compte vraiment : jamais un `homedir()` DANS un appel
    // d'écriture. `writeFileSync(path.join(os.homedir(), …))` reste interdit.
    for (const f of sources()) {
      for (const appel of f.texte.matchAll(new RegExp(MOTIF_ECRITURE.source + '[^;]*', 'g'))) {
        expect(appel[0], `${f.chemin} écrit à partir de os.homedir()`).not.toMatch(
          /\bhomedir\s*\(/,
        );
      }
    }
  });

  it('UN SEUL fichier CRÉE quelque chose dans `os.tmpdir()`, et il l’efface', () => {
    // On regarde `mkdtemp`, pas `tmpdir` : `src/desinstallation.ts` LIT le
    // dossier temporaire pour y chercher des restes — c'est son travail — mais
    // il n'y crée rien. Viser la lecture ferait rougir la bonne intention.
    const createurs = sources().filter((f) => /\bmkdtemp(Sync)?\s*\(/.test(nu(f.texte)));
    expect(createurs.map((f) => f.chemin)).toEqual(['src/node-client/merge-runner.ts']);
    // Et le même fichier doit le nettoyer. Un `mkdtemp` sans `rmSync` remplit
    // le disque de quelqu'un, lentement, sans jamais rien dire.
    expect(nu(createurs[0]!.texte)).toMatch(/rmSync/);
    expect(createurs[0]!.texte).toMatch(/finally/);
  });

  it('aucun chemin ABSOLU de système n’est écrit', () => {
    // Les `/etc/ssl` du bac à sable sont des montages `--ro-bind`, en lecture
    // seule. On vérifie qu'aucun d'eux n'arrive à une fonction d'écriture.
    const dangereux = /(['"`])(\/etc\/|\/usr\/|\/var\/|\/opt\/|[A-Za-z]:\\\\?Windows)/;
    const motif = new RegExp(`\\b(${ECRITURES.join('|')})\\s*\\(\\s*[^)]*`, 'g');
    for (const f of sources()) {
      for (const appel of f.texte.matchAll(motif)) {
        expect(appel[0], `${f.chemin} écrit dans un chemin système`).not.toMatch(dangereux);
      }
    }
  });
});
