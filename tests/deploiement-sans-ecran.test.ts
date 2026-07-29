// Le déploiement sans écran — l'exemple, EXERCÉ.
//
// ─── POURQUOI CE FICHIER, ET PAS SEULEMENT LE SCRIPT ─────────────────────────
//
// Le critère 9 demande un déploiement sans écran : `--non-interactive`, les
// secrets par l'environnement, et des codes de sortie exploitables. Les trois
// existaient depuis longtemps, et le carnet le disait : « les drapeaux et les
// codes existent, le script de bout en bout manque ».
//
// Un exemple qui vit dans `examples/` sans que rien ne le lance est la forme
// la plus courante du mensonge dans un dépôt : il a l'air d'une preuve, il n'en
// est pas une. Il pourrit exactement comme la vitrine du site, et personne ne
// s'en aperçoit — parce qu'on ne relit pas un exemple, on le copie.
//
// ─── CE QUE CE FICHIER EXERCE VRAIMENT ───────────────────────────────────────
//
// Pas un simulacre : le VRAI script, lancé par `sh`, dans un dossier temporaire
// dont le `package.json` déclare un `install:hive` qui rend le code voulu. Le
// code traverse donc `npm run` pour de bon — y compris sa propagation, que
// personne ne devrait tenir pour acquise sans l'avoir vue.
//
// ─── L'ASSERTION QUI PORTE LE FICHIER ────────────────────────────────────────
//
//   CHAQUE CODE EST TRAITÉ SÉPARÉMENT, ET REDONNÉ TEL QUEL.
//
// C'est tout l'objet du critère. Un script qui fait `|| exit 1` transforme sept
// situations distinctes en une seule, et la seule réponse qui reste à
// l'appelant est « relancer et espérer ». Le distinguo n'a de valeur que s'il
// SURVIT au script d'exemple.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CODE, SENS } from '../src/codes-sortie.js';

/**
 * Le chemin du script — par `fileURLToPath`, JAMAIS par `.pathname`.
 *
 * ─── UNE ERREUR DÉJÀ ÉCRITE DANS LE JOURNAL, ET REFAITE QUAND MÊME ───────────
 *
 * La première version faisait
 * `path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', …)`.
 * Verte sur Linux et macOS, ROUGE sur Windows, avec cette ligne :
 *
 *     sh -n D:\D:\a\hive\hive\examples\deploiement-sans-ecran.sh
 *
 * **La lettre de lecteur est DOUBLÉE.** `.pathname` rend `/D:/a/hive/…` — avec
 * une barre oblique en tête — et `path.resolve` la lit comme la racine du
 * lecteur courant, qu'il préfixe. C'est le § 6.1 du journal des erreurs, mot
 * pour mot, écrit bien avant ce fichier.
 *
 * Ce qui l'a laissée passer : le `readFileSync(new URL(…))` juste en dessous
 * est CORRECT — `fs` accepte une URL `file:` et la convertit lui-même. Les deux
 * formes se ressemblent, une seule est juste, et seule la CI Windows sait le
 * dire. Un journal qu'on a écrit ne dispense pas de le relire.
 */
const SCRIPT = fileURLToPath(new URL('../examples/deploiement-sans-ecran.sh', import.meta.url));

const SOURCE = readFileSync(
  new URL('../examples/deploiement-sans-ecran.sh', import.meta.url),
  'utf8',
);

/** La source SANS ses commentaires — la prose ne doit rien prouver (§ 2.3). */
const NU = SOURCE.replace(/^\s*#.*$/gm, '');

/** Ce banc lance `sh` : sous Windows, il n'y en a pas. */
const POSIX = process.platform !== 'win32';

describe('l’exemple de déploiement sans écran', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  /**
   * Un faux dépôt dont `npm run install:hive` rend le code demandé.
   *
   * ─── POURQUOI `sh -c` ET SURTOUT PAS `node -e` ─────────────────────────────
   *
   * Première version : `node -e "process.exit(2)"`. Tous les cas rendaient
   * **9**, quel que soit le code demandé, et j'ai d'abord cru que `npm run`
   * n'était pas fidèle.
   *
   * Il l'est. Ce que le script d'exemple lance, c'est
   * `npm run install:hive -- --non-interactive --json` : npm passe donc ces
   * deux drapeaux AU SCRIPT. `node -e "…" --non-interactive` les lit comme des
   * options de NODE, n'en connaît aucune, et sort en 9.
   *
   * Le faux dépôt doit donc IGNORER ses arguments, comme le vrai installeur
   * les consomme. `sh -c 'exit N'` le fait : les arguments qui suivent
   * deviennent `$0`, `$1`… et personne ne les lit.
   *
   * (Le vrai chemin, lui, est intact : `tsx src/installer-main.ts` déclare ces
   * drapeaux, et la mesure de bout en bout du critère 1 l'a exercé — code 0,
   * sortie JSON complète.)
   */
  function depot(code: number): string {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-deploiement-'));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'faux-depot',
        scripts: { 'install:hive': `sh -c 'exit ${String(code)}'` },
      }),
    );
    return dir;
  }

  /** Lance le vrai script et rend son code et sa sortie. */
  function lancer(cwd: string, env: Record<string, string> = {}): { code: number; sortie: string } {
    try {
      const sortie = execFileSync('sh', [SCRIPT], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          HIVE_TOKEN: 'un-jeton-assez-long-pour-passer',
          HIVE_JWT_SECRET: 'x'.repeat(64),
          ...env,
        },
      });
      return { code: 0, sortie };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('le script est du sh valide, sans bashisme de syntaxe', () => {
    // Même règle qu'`install.sh` : les images minimales n'ont pas bash, et un
    // exemple qui échoue sur « bash: not found » rate les machines qu'il vise.
    expect(() => execFileSync('sh', ['-n', SCRIPT], { encoding: 'utf8' })).not.toThrow();
  });

  it.runIf(POSIX)(
    'CHAQUE CODE DE L’INSTALLEUR EST REDONNÉ TEL QUEL — pas aplati en 1',
    { timeout: 120_000 },
    () => {
      // ─── LE CŒUR DU CRITÈRE 9 ──────────────────────────────────────────
      //
      // Sept situations, sept réponses possibles pour l'appelant. Les aplatir
      // en « erreur » rendrait les codes inutiles — et c'est précisément ce
      // qu'un exemple non exercé finit par faire.
      for (const code of [
        CODE.PREREQUIS,
        CODE.REPONSE_MANQUANTE,
        CODE.PORT_OCCUPE,
        CODE.REFUS_SECURITE,
      ]) {
        const r = lancer(depot(code));
        expect(r.code, `${SENS[code]} — sortie : ${r.sortie}`).toBe(code);
      }
    },
  );

  it.runIf(POSIX)('UN ^C N’EST PAS UN ÉCHEC — 130 traverse', { timeout: 60_000 }, () => {
    // Un superviseur qui confondrait 130 avec une panne réinstallerait ce que
    // quelqu'un venait d'annuler à la main.
    const r = lancer(depot(CODE.INTERROMPU));
    expect(r.code).toBe(CODE.INTERROMPU);
    expect(r.sortie).toMatch(/interrompu/i);
  });

  it.runIf(POSIX)('UN SECRET ABSENT REND 3, ET N’APPELLE RIEN', { timeout: 60_000 }, () => {
    // Le refus est EN AMONT : découvrir l'absence d'un secret après avoir
    // écrit la moitié d'une configuration ne rend service à personne. Le
    // dépôt rendrait 0 si on l'appelait — donc si le script rend 3, c'est
    // qu'il n'a pas appelé.
    const r = lancer(depot(CODE.SUCCES), { HIVE_TOKEN: '', HIVE_JWT_SECRET: '' });
    expect(r.code).toBe(CODE.REPONSE_MANQUANTE);
    expect(r.sortie).toMatch(/HIVE_TOKEN/);
    expect(r.sortie).toMatch(/HIVE_JWT_SECRET/);
  });

  it.runIf(POSIX)(
    'un secret sur DEUX manque : le refus nomme celui qui manque',
    { timeout: 60_000 },
    () => {
      const r = lancer(depot(CODE.SUCCES), { HIVE_JWT_SECRET: '' });
      expect(r.code).toBe(CODE.REPONSE_MANQUANTE);
      // C'est la LISTE qui doit être juste, pas la page entière : le message
      // montre ensuite les deux `export` d'exemple, et c'est très bien — un
      // opérateur à qui il manque une variable veut voir les deux formes.
      const liste = r.sortie.split('\n')[0] ?? '';
      expect(liste).toMatch(/HIVE_JWT_SECRET/);
      expect(liste, 'la liste ne doit nommer que ce qui manque').not.toMatch(/HIVE_TOKEN/);
    },
  );

  it('LE SCRIPT TRAITE TOUS LES CODES QUE LE MODULE DÉCLARE', () => {
    // ─── LA GARDE CONTRE LA DÉRIVE ─────────────────────────────────────────
    //
    // `codes-sortie.ts` dit de lui-même : « ces codes sont une INTERFACE
    // PUBLIQUE […] on en ajoute ; on n'en renumérote pas ». Le jour où l'on en
    // ajoute un, cet exemple doit le traiter — sinon il retombe dans le
    // fourre-tout, en silence, et l'ajout n'aura servi à rien.
    //
    // Sur la source NUE : un code cité dans un commentaire ne prouve rien.
    const branches = new Set([...NU.matchAll(/^\s*(\d+)\)/gm)].map((m) => Number(m[1])));
    const attendus = [
      CODE.SUCCES,
      CODE.PREREQUIS,
      CODE.REPONSE_MANQUANTE,
      CODE.PORT_OCCUPE,
      CODE.REFUS_SECURITE,
      CODE.INTERROMPU,
    ];
    const oublies = attendus.filter((c) => !branches.has(c));
    expect(
      oublies.map((c) => `${String(c)} (${SENS[c]})`),
      'code(s) déclaré(s) par `codes-sortie.ts` et non traité(s) par l’exemple',
    ).toEqual([]);
  });

  it('LES SECRETS NE PASSENT JAMAIS EN ARGUMENT', () => {
    // `/proc/*/cmdline` est lisible par les autres processus, et l'historique
    // du shell garde ce qu'on a tapé. Un jeton en argument est un jeton publié.
    expect(NU).not.toMatch(/--token[= ]/);
    expect(NU).not.toMatch(/HIVE_TOKEN=\$/);
    // Il les LIT dans l'environnement — c'est la forme attendue.
    expect(NU).toMatch(/\$\{HIVE_TOKEN:-\}/);
  });

  it('IL N’EST JAMAIS INTERACTIF', () => {
    // Un déploiement sans écran qui poserait une question se bloquerait pour
    // toujours dans un `systemd` ou un `Makefile`.
    expect(NU).toMatch(/--non-interactive/);
    expect(NU, 'un `read` rendrait le script bloquant').not.toMatch(/^\s*read\s/m);
  });
});
