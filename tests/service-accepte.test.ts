// LE FICHIER DE SERVICE, SOUMIS À CELUI QUI DOIT L'AVALER.
//
// ─── CE QUE `tests/service.test.ts` NE POUVAIT PAS DIRE ──────────────────────
//
// Son en-tête l'annonce honnêtement : « on ne peut PAS installer un vrai
// service dans une CI ». C'est vrai, et ça restait vrai. Mais entre « installer
// pour de bon » et « ne rien vérifier du tout », il y a un pas que je n'avais
// pas franchi parce que je ne l'avais pas CHIFFRÉ : demander à l'outil de la
// plateforme si le fichier est recevable.
//
//   · Linux  — `systemd-analyze verify` charge l'unité et rend ses erreurs,
//              sans gestionnaire, sans bus, sans privilège. 28 ms.
//   · macOS  — `plutil -lint` valide le plist. Sur la jambe `macos-latest`.
//   · Windows— `schtasks /Query /XML` relit la tâche. Sur `windows-latest`.
//
// ─── CE QUE ÇA A TROUVÉ DU PREMIER COUP ──────────────────────────────────────
//
// L'unité systemd que Hive écrit depuis le premier jour était REFUSÉE :
//
//   WorkingDirectory= path is not absolute: "/home/user/hive"
//   hive-ruche.service: Unit configuration has fatal error, unit will not be started.
//
// `citerSystemd` citait les quatre directives. Or systemd n'unquote que ce
// qu'il DÉCOUPE : `ExecStart=` et `ReadWritePaths=`. `WorkingDirectory=` prend
// la ligne entière et rejette l'unité ; `EnvironmentFile=` prend la ligne
// entière et IGNORE la valeur SANS RIEN DIRE — la ruche démarrait alors sans
// aucun secret, ce que l'en-tête de `src/shared/service.ts` dit exister pour
// empêcher.
//
// Les tests d'à côté étaient verts sur les deux : ils comparaient le fichier
// produit à la chaîne que j'attendais, jamais à son consommateur.
//
// ─── CE QUI EMPÊCHE CE FICHIER DE S'ÉTEINDRE EN SILENCE ──────────────────────
//
// Trois `runIf` ne tournent chacun que sur une plateforme. Si l'outil manquait,
// tout serait « sauté », donc vert. La CI vérifie donc la PRÉSENCE de l'outil
// avant de lancer la suite (étape « L'outil qui juge les fichiers de service
// est là »), et le dernier test de ce fichier — qui tourne PARTOUT — exige que
// cette étape existe toujours dans `.github/workflows/ci.yml`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Contexte, type Plan, planifier } from '../src/shared/service.js';
import { SYSTEME } from '../src/service-reel.js';

const RACINE_DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LINUX = process.platform === 'linux';
const MACOS = process.platform === 'darwin';
const WINDOWS = process.platform === 'win32';

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Un dossier temporaire, retiré après le test. */
function dossier(prefixe: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefixe));
  aNettoyer.push(d);
  return d;
}

/**
 * Le plan RÉEL de la plateforme courante, pour une racine qui existe vraiment.
 *
 * La racine est un vrai dossier : `systemd-analyze` ne vérifie pas l'existence
 * du `WorkingDirectory`, mais `plutil` et `schtasks` sont moins indulgents, et
 * un test qui passerait un chemin fantaisiste mesurerait la tolérance de
 * l'outil plutôt que la justesse du fichier.
 */
function planIci(o: Partial<Contexte> = {}): Plan {
  const racine = o.racine ?? dossier('ruche-racine-');
  const r = planifier({
    plateforme: process.platform,
    niveau: 'utilisateur',
    cible: 'ruche',
    racine,
    execNode: process.execPath,
    home: dossier('ruche-home-'),
    ...o,
  });
  if (r.genre === 'refus') throw new Error(`refus inattendu : ${r.motif}`);
  return r;
}

/**
 * Écrit le fichier du plan dans un dossier jetable, PAR LE VRAI ÉCRIVAIN.
 *
 * ─── LA PREMIÈRE VERSION A ÉTÉ REFUSÉE PAR WINDOWS, ET ELLE AVAIT TORT ───────
 *
 * Elle faisait `writeFileSync(ou, contenu, encodage)` — une réécriture à moi de
 * ce que `SYSTEME.ecrire` fait déjà. Or ce dernier préfixe les fichiers UTF-16
 * de la marque d'ordre `FF FE`, sans laquelle un analyseur XML ne sait pas dans
 * quel sens lire les paires d'octets. `schtasks` a répondu, à juste titre :
 *
 *   ERROR: The task XML is malformed.
 *   (1,2)::ERROR: one root element
 *
 * Le produit était correct ; c'est mon banc d'essai qui posait des octets que la
 * ruche n'écrit jamais. J'ai reproduit, DANS LE TEST DU LOT SUR CE SUJET, la
 * faute exacte que le lot corrige : fabriquer soi-même l'artefact au lieu de le
 * demander au code qui le fabrique.
 *
 * Le test y gagne : il couvre désormais la chaîne entière — plan → écrivain →
 * outil de la plateforme — au lieu de deux tiers de celle-ci.
 */
function poser(p: Plan, nomFichier = path.basename(p.fichier.chemin)): string {
  const ou = path.join(dossier('ruche-svc-'), nomFichier);
  SYSTEME.ecrire(ou, p.fichier.contenu, p.fichier.mode, p.fichier.encodage);
  return ou;
}

describe('LE FICHIER DE SERVICE EST RECEVABLE PAR SA PLATEFORME', () => {
  it.runIf(LINUX)('systemd accepte l’unité que Hive écrit', () => {
    // LA garde de ce fichier. Sortie vide = unité chargeable. Le moindre mot
    // sur la sortie d'erreur est un refus — `systemd-analyze` ne bavarde pas.
    const chemin = poser(planIci());
    const r = spawnSync('systemd-analyze', ['verify', chemin], {
      shell: false,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.error, `systemd-analyze introuvable : ${r.error?.message ?? ''}`).toBeUndefined();
    const dit = `${r.stdout}${r.stderr}`.trim();
    expect(
      dit,
      `systemd REFUSE l’unité :\n${dit}\n\n--- l’unité ---\n${readFileSync(chemin, 'utf8')}`,
    ).toBe('');
    expect(r.status, 'code de sortie non nul sans un mot d’explication').toBe(0);
  });

  it.runIf(LINUX)('…et il la refuserait si on remettait les guillemets', () => {
    // ─── LA MUTATION, ÉCRITE DANS LE TEST ──────────────────────────────────
    //
    // Sans cette moitié, le test du dessus ne prouve pas que `systemd-analyze`
    // REGARDE quoi que ce soit : un outil qui accepterait tout serait vert.
    // On lui donne donc la version d'AVANT le correctif, et on exige un refus
    // — le refus exact qu'il m'a rendu.
    const p = planIci();
    const casse = p.fichier.contenu.replace(
      /^WorkingDirectory=(.+)$/m,
      (_, v: string) => `WorkingDirectory="${v}"`,
    );
    expect(casse, 'la ligne n’a pas été mutée — le test ne prouve rien').not.toBe(
      p.fichier.contenu,
    );

    const ou = path.join(dossier('ruche-svc-casse-'), 'hive-casse.service');
    SYSTEME.ecrire(ou, casse, p.fichier.mode, p.fichier.encodage);
    const r = spawnSync('systemd-analyze', ['verify', ou], {
      shell: false,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(`${r.stdout}${r.stderr}`).toMatch(/path is not absolute/);
  });

  it.runIf(MACOS)('launchd : le plist est un plist', () => {
    // `plutil -lint` est l'analyseur d'Apple lui-même. Il dit « OK » et rien
    // d'autre quand le document est valide.
    const chemin = poser(planIci());
    const r = spawnSync('plutil', ['-lint', chemin], {
      shell: false,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.error, `plutil introuvable : ${r.error?.message ?? ''}`).toBeUndefined();
    expect(r.status, `plutil REFUSE le plist :\n${r.stdout}${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK\s*$/);
  });

  it.runIf(MACOS)('…et il refuserait un plist tronqué', () => {
    // Même exigence que sous Linux : prouver que l'outil regarde.
    const p = planIci();
    const ou = path.join(dossier('ruche-plist-casse-'), 'casse.plist');
    SYSTEME.ecrire(
      ou,
      p.fichier.contenu.replace('</plist>', ''),
      p.fichier.mode,
      p.fichier.encodage,
    );
    const r = spawnSync('plutil', ['-lint', ou], {
      shell: false,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.status, 'plutil accepte un plist sans balise fermante').not.toBe(0);
  });

  it.runIf(WINDOWS)('le planificateur Windows INSCRIT la tâche, puis on la retire', () => {
    // ─── POURQUOI ON INSCRIT POUR DE VRAI ──────────────────────────────────
    //
    // `schtasks /Create /XML` est le seul juge du XML : il n'existe pas de
    // mode « vérifie sans inscrire ». Une tâche à l'ouverture de session ne
    // demande AUCUN droit administrateur (`LeastPrivilege`,
    // `InteractiveToken`), et on la supprime aussitôt.
    //
    // Le nom porte le PID : deux exécutions concurrentes ne se marchent pas
    // dessus, et un `/Delete` raté ne laisse pas un nom qui bloque la suivante.
    const p = planIci();
    const nom = `hive-test-${process.pid}`;
    const chemin = poser(p, `${nom}.xml`);

    const creer = spawnSync('schtasks', ['/Create', '/TN', nom, '/XML', chemin, '/F'], {
      shell: false,
      encoding: 'utf8',
      timeout: 60_000,
    });
    try {
      expect(creer.status, `le planificateur REFUSE le XML :\n${creer.stdout}${creer.stderr}`).toBe(
        0,
      );

      // Inscrite ET relisible : `/Create` accepté ne dit pas que la tâche
      // existe sous le nom qu'on croit.
      const lire = spawnSync('schtasks', ['/Query', '/TN', nom], {
        shell: false,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(lire.status, `tâche introuvable après création :\n${lire.stderr}`).toBe(0);
    } finally {
      spawnSync('schtasks', ['/Delete', '/TN', nom, '/F'], {
        shell: false,
        encoding: 'utf8',
        timeout: 60_000,
      });
    }
  });

  it.runIf(WINDOWS)('…et il refuserait un XML dont la balise racine est fausse', () => {
    const p = planIci();
    const nom = `hive-test-casse-${process.pid}`;
    // MÊME écrivain que le cas favorable : sans ça, ce test rougirait pour la
    // marque d'ordre absente et non pour la balise racine mutée — vert pour la
    // mauvaise raison, ce qui ne garde rien.
    const ou = path.join(dossier('ruche-xml-casse-'), `${nom}.xml`);
    SYSTEME.ecrire(
      ou,
      p.fichier.contenu.replace('<Task ', '<Tache '),
      p.fichier.mode,
      p.fichier.encodage,
    );
    const r = spawnSync('schtasks', ['/Create', '/TN', nom, '/XML', ou, '/F'], {
      shell: false,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (r.status === 0) {
      spawnSync('schtasks', ['/Delete', '/TN', nom, '/F'], { shell: false, timeout: 60_000 });
    }
    expect(r.status, 'le planificateur accepte un XML à la racine inconnue').not.toBe(0);
  });
});

describe('CES GARDES NE PEUVENT PAS S’ÉTEINDRE SANS QUE ÇA SE VOIE', () => {
  it('la CI exige la présence des trois juges AVANT de lancer la suite', () => {
    // ─── LA RAISON D'ÊTRE DE CE TEST ───────────────────────────────────────
    //
    // Les six tests du dessus sont des `runIf`. Si `systemd-analyze`
    // disparaissait de l'image `ubuntu-latest`, ils seraient « sautés » — donc
    // verts, et sans objet, exactement le défaut que le lot Windows avait
    // laissé passer.
    //
    // La présence de l'outil ne peut pas être vérifiée depuis le test lui-même
    // sans le rendre rouge sur toute machine minimale légitime. Elle est donc
    // exigée par la CI, et c'est CETTE EXIGENCE que ce test-ci garde.
    const ci = readFileSync(path.join(RACINE_DEPOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    for (const outil of ['systemd-analyze', 'plutil', 'schtasks']) {
      expect(ci, `la CI ne vérifie plus la présence de « ${outil} »`).toContain(outil);
    }
    expect(ci, 'l’étape qui exige les juges a disparu').toContain(
      'L’outil qui juge le fichier de service est là',
    );
  });

  it('le module ne cite plus les deux directives qui prennent la ligne entière', () => {
    // Une garde de forme, sur la SOURCE, qui tient même là où aucun outil ne
    // tourne — sur la jambe macOS et Windows, `systemd-analyze` n'existe pas.
    //
    // ─── LE REPÈRE ÉTAIT NON UNIQUE, TROISIÈME FOIS ────────────────────────
    //
    // Ma première version cherchait la ligne contenant `` `WorkingDirectory= ``
    // — et la trouvait DANS LE COMMENTAIRE de `valeurSystemd`, qui cite les deux
    // directives par leur nom. La garde lisait donc de la prose et se prononçait
    // sur elle. On ne retient que les lignes de CODE, et on exige qu'il n'y en
    // ait qu'une : un repère non unique ne garde rien (§ 2 duodecies).
    const src = readFileSync(path.join(RACINE_DEPOT, 'src', 'shared', 'service.ts'), 'utf8');
    for (const directive of ['WorkingDirectory', 'EnvironmentFile']) {
      const lignes = src
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
        .filter((l) => l.includes(`\`${directive}=`));
      expect(lignes, `repère non unique pour ${directive}= : ${lignes.length} lignes`).toHaveLength(
        1,
      );
      expect(lignes[0], `${directive}= est de nouveau cité — systemd la rejette`).toContain(
        'valeurSystemd',
      );
    }
  });

  it('LINUX REFUSE UN CHEMIN QUI FINIT PAR UN ANTISLASH', () => {
    // Mesuré : `WorkingDirectory=/tmp/fin\` suivi de `ExecStart=…` fait dire à
    // systemd « Service has no ExecStart= » — la ligne suivante avait été
    // AVALÉE par la continuation.
    for (const champ of ['racine', 'execNode'] as const) {
      const r = planifier({
        plateforme: 'linux',
        niveau: 'utilisateur',
        cible: 'ruche',
        racine: '/home/moi/hive',
        execNode: '/usr/bin/node',
        home: '/home/moi',
        [champ]: champ === 'racine' ? '/home/moi/fin\\' : '/usr/bin/node\\',
      });
      expect(r.genre, `${champ} accepte un antislash final`).toBe('refus');
      if (r.genre === 'refus') expect(r.motif).toMatch(/antislash/);
    }
  });

  it('…mais un antislash AILLEURS dans le chemin reste accepté', () => {
    // Le pendant. Un refus trop large accuserait du code juste — c'est le
    // § 2 septies, et il s'est produit deux fois en une journée.
    const r = planifier({
      plateforme: 'linux',
      niveau: 'utilisateur',
      cible: 'ruche',
      racine: '/home/moi/a\\b/hive',
      execNode: '/usr/bin/node',
      home: '/home/moi',
    });
    expect(r.genre, 'un antislash au milieu du chemin est refusé à tort').toBe('plan');
  });

  it('un antislash DOUBLE en fin de chemin est refusé aussi', () => {
    // Mesuré : `…\\` ne continue PAS la ligne — un nombre pair d'antislashes
    // s'annule. Ma première expression ne refusait donc que les impairs, ce qui
    // était plus fin sans être plus juste : la valeur résultante n'est pas
    // observable d'ici. Cette ligne fixe le choix du refus large, pour qu'il ne
    // se desserre pas au nom de l'élégance.
    const r = planifier({
      plateforme: 'linux',
      niveau: 'utilisateur',
      cible: 'ruche',
      racine: '/home/moi/fin\\\\',
      execNode: '/usr/bin/node',
      home: '/home/moi',
    });
    expect(r.genre).toBe('refus');
  });

  it('WINDOWS, LUI, N’EST PAS TOUCHÉ — ses chemins sont pleins d’antislashes', () => {
    // Le refus vit dans `planLinux`, pas dans `planifier` : la règle est celle
    // de la grammaire de systemd, pas du projet. Si elle remontait d'un
    // niveau, plus aucune installation Windows ne serait planifiable.
    const r = planifier({
      plateforme: 'win32',
      niveau: 'utilisateur',
      cible: 'ruche',
      racine: 'C:\\Users\\moi\\hive',
      execNode: 'C:\\Program Files\\nodejs\\node.exe',
      home: 'C:\\Users\\moi',
    });
    expect(r.genre, 'le refus systemd a débordé sur Windows').toBe('plan');
  });

  it('l’outil existe ici, ou le test du dessus est une décoration', () => {
    // Sur la plateforme courante, le juge doit être là. Ce test ne dit rien de
    // ce qu'il pense du fichier — seulement qu'il RÉPOND. Un `runIf` sauté
    // sans que personne ne le remarque est le défaut qu'on ferme ici.
    const juge = LINUX
      ? { bin: 'systemd-analyze', args: ['--version'] }
      : MACOS
        ? { bin: 'plutil', args: [] }
        : { bin: 'schtasks', args: ['/Query', '/?'] };
    let repond: boolean;
    try {
      execFileSync(juge.bin, juge.args, { shell: false, stdio: 'ignore', timeout: 60_000 });
      repond = true;
    } catch (e) {
      // `plutil` sans argument et `schtasks /?` sortent en code non nul tout
      // en étant bien présents : ce qui distingue « absent » de « bavard »,
      // c'est ENOENT.
      repond = (e as NodeJS.ErrnoException).code !== 'ENOENT';
    }
    expect(repond, `${juge.bin} est introuvable : les gardes de ce fichier ne jugent rien`).toBe(
      true,
    );
  });
});

// Une garde de plus, hors plateforme : le chemin du fichier posé est bien celui
// que le plan annonce. `poser()` écrit ailleurs (dossier jetable), et sans cette
// ligne on pourrait valider un fichier au bon contenu et au mauvais nom.
describe('LE NOM DU FICHIER POSÉ EST CELUI QUE LE PLAN ANNONCE', () => {
  it('l’extension attendue par l’outil de la plateforme', () => {
    const attendu = LINUX ? '.service' : MACOS ? '.plist' : '.xml';
    const p = planIci();
    expect(path.extname(p.fichier.chemin)).toBe(attendu);
    expect(existsSync(poser(p)), 'le fichier posé n’existe pas').toBe(true);
  });
});
