// `npm run install:hive` — 116 lignes à 0 %, et c'est le PREMIER GESTE.
//
// ─── CE QUE LA COUVERTURE CACHAIT, ET CE QU'ELLE MONTRAIT QUAND MÊME ─────────
//
// `installer-main.ts` est exercé par la CI via `install.sh`, mais jamais par un
// test qui REGARDE : les jambes CI vérifient un code de sortie global, pas ce
// que le dry-run écrit (rien), pas le mode du `.env` (0600), pas l'idempotence
// octet pour octet. La logique pure vit dans `installer.ts`, testée — ce
// fichier-ci teste L'ENCHAÎNEMENT, en sous-processus, dans un cwd jetable.
//
// ─── LA RÉPARTITION NODE 22 / NODE 24, ASSUMÉE ───────────────────────────────
//
// L'installeur refuse Node < 24. Ce dépôt tourne parfois sous Node 22 (le
// conteneur de développement) et parfois sous Node 24 (la CI). Plutôt que de
// subir cette différence, on s'en sert :
//
//   · sous un Node TROP VIEUX, on teste LA PORTE elle-même — le refus
//     `CODE.PREREQUIS` avec le message qui dit quoi faire. La CI, qui a
//     Node 24, ne peut pas exercer ce chemin ;
//   · sous Node ≥ 24 (la CI, ou un Node 24 trouvé sous /opt/nvm), on teste
//     les chemins complets : dry-run qui n'écrit rien, JSON pur, `.env` créé
//     en 0600, idempotence, port occupé.
//
// Chaque moitié saute là où elle ne peut pas tourner, ET LE DIT dans son nom.
//
// ─── DEUX PIÈGES D'INSTRUMENT, MESURÉS AVANT D'ÉCRIRE CE FICHIER ─────────────
//
// · `cmd | head; echo $?` lit le code de HEAD — mes deux premiers sondages
//   rendaient « 0 » quoi qu'il arrive (le pendant shell du § 9 terdecies) ;
// · `--import tsx` se résout depuis le CWD, or ces tests EXIGENT un cwd
//   jetable (`CHEMIN_ENV = cwd/.env`). On lance donc `tsx/dist/cli.mjs` par
//   son chemin absolu — pas `.bin/tsx`, qui est un `.cmd` sous Windows et
//   qu'un spawn sans shell ne sait pas lancer (§ 6.2).

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { CODE } from '../src/codes-sortie.js';
import { PORT_DEFAUT, nodeSuffisant } from '../src/installer.js';

const execFileAsync = promisify(execFile);
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const INSTALLEUR = path.join(RACINE, 'src', 'installer-main.ts');
const TSX = path.join(RACINE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const POSIX = process.platform !== 'win32';

/**
 * Un Node qui PASSE la porte de l'installeur, ou `null`.
 *
 * `process.execPath` d'abord — c'est le cas de la CI. Sinon on regarde sous
 * `/opt/nvm` (le conteneur de développement) : les noms de dossiers y sont des
 * versions (`v24.18.1`), la même forme que `process.version`, donc le même
 * juge (`nodeSuffisant`) tranche les deux.
 */
function nodeQuiPasseLaPorte(): string | null {
  if (nodeSuffisant(process.version)) return process.execPath;
  const racine = '/opt/nvm/versions/node';
  try {
    for (const d of readdirSync(racine)) {
      const bin = path.join(racine, d, 'bin', 'node');
      if (nodeSuffisant(d) && existsSync(bin)) return bin;
    }
  } catch {
    /* pas de nvm ici : la moitié Node 24 sautera, et son nom le dira */
  }
  return null;
}

const NODE_OK = nodeQuiPasseLaPorte();
const NODE_TROP_VIEUX = !nodeSuffisant(process.version);

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Lance l'installeur pour de vrai, dans un cwd JETABLE — c'est là que son
 * `.env` naît, et un test qui écrirait dans le dépôt souillerait la machine
 * de qui fait tourner la suite.
 *
 * `CI=1` rend le passage non interactif ; `HIVE_ISOLEMENT=off` évite de sonder
 * docker/podman (des secondes perdues qui ne sont pas le sujet) ; les HIVE_*
 * sont retirés pour que les valeurs engendrées soient bien ENGENDRÉES, pas
 * héritées de l'environnement de la suite.
 */
async function lancer(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; sortie: string; stdout: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', HIVE_ISOLEMENT: 'off', NO_COLOR: '1' };
  for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
  env.HIVE_ISOLEMENT = 'off';
  try {
    const { stdout, stderr } = await execFileAsync(bin, [TSX, INSTALLEUR, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
      env,
    });
    return { code: 0, sortie: `${stdout}${stderr}`, stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: err.code ?? -1,
      sortie: `${err.stdout ?? ''}${err.stderr ?? ''}`,
      stdout: err.stdout ?? '',
    };
  }
}

function dossier(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'ruche-installeur-'));
  aNettoyer.push(d);
  return d;
}

describe('l’installeur — la porte, sous un Node trop vieux', () => {
  it.runIf(NODE_TROP_VIEUX)(
    'NODE TROP VIEUX : refus NET, code PREREQUIS, et quoi faire — la CI ne peut pas tester ça',
    async () => {
      // La CI a Node 24 : ce chemin n'y est JAMAIS emprunté. Ici, si.
      const r = await lancer(process.execPath, ['--dry-run'], dossier());
      expect(r.code, 'un Node trop vieux doit rendre CODE.PREREQUIS').toBe(CODE.PREREQUIS);
      expect(r.sortie).toContain('minimum');
      // Le refus dit QUOI FAIRE — c'est ce qui distingue une porte d'un mur.
      expect(r.sortie).toMatch(/nodejs\.org|nvm install/);
    },
  );

  it('l’aide et le refus d’option valent sous TOUT Node — la porte vient après', async () => {
    // `--help` et l'analyse des drapeaux précèdent la vérification de Node :
    // demander de l'aide ne demande aucun prérequis.
    const aide = await lancer(process.execPath, ['--help'], dossier());
    expect(aide.code).toBe(0);
    expect(aide.sortie).toContain('--dry-run');
    expect(aide.sortie).toContain('Codes de sortie');

    const inconnu = await lancer(process.execPath, ['--drapeau-inconnu'], dossier());
    expect(inconnu.code, 'une option inconnue doit rendre un code non nul').toBe(CODE.ERREUR);
    expect(inconnu.sortie).toContain('option inconnue');
    // Et l'aide suit le refus : la personne n'a pas à relancer pour l'avoir.
    expect(inconnu.sortie).toContain('--dry-run');
  });
});

describe.runIf(NODE_OK !== null)('l’installeur — les chemins complets, sous Node 24', () => {
  const bin = (): string => NODE_OK as string;

  it('LE DRY-RUN ANNONCE, PUIS N’ÉCRIT RIEN — c’est toute sa promesse', async () => {
    const cwd = dossier();
    const r = await lancer(bin(), ['--dry-run'], cwd);
    expect(r.code, `sortie :\n${r.sortie}`).toBe(0);
    // Le récapitulatif nomme le fichier et son mode AVANT de ne pas l'écrire.
    expect(r.sortie).toContain('.env — créé (permissions 0600)');
    expect(r.sortie).toContain('rien n’a été écrit');
    expect(existsSync(path.join(cwd, '.env')), 'LE DRY-RUN A ÉCRIT UN FICHIER').toBe(false);
  });

  it('--json REND DU JSON, RIEN QUE DU JSON — analysable sans filtre', async () => {
    const cwd = dossier();
    const r = await lancer(bin(), ['--dry-run', '--json'], cwd);
    expect(r.code).toBe(0);
    // La promesse du drapeau est `jq` SANS prétraitement : le stdout entier
    // doit s'analyser. Une bannière égarée au milieu casse Ansible, pas nous.
    const machine = JSON.parse(r.stdout) as {
      version: string;
      dryRun: boolean;
      env: { action: string; clesAjoutees: string[] };
    };
    expect(machine.dryRun).toBe(true);
    expect(machine.env.action).toBe('cree');
    expect(machine.env.clesAjoutees.length).toBeGreaterThan(3);
  });

  it('LE VRAI PASSAGE : .env EN 0600, PUIS L’IDEMPOTENCE OCTET POUR OCTET', async () => {
    const cwd = dossier();
    const premier = await lancer(bin(), [], cwd);
    expect(premier.code, `sortie :\n${premier.sortie}`).toBe(0);
    const chemin = path.join(cwd, '.env');
    expect(existsSync(chemin), 'aucun .env créé').toBe(true);

    const contenu = readFileSync(chemin, 'utf8');
    expect(contenu).toContain('HIVE_TOKEN=');
    expect(contenu).toContain('HIVE_JWT_SECRET=');
    // Le jeton est montré UNE fois, à la création.
    expect(premier.sortie).toContain('jeton');

    if (POSIX) {
      // Un `.env` lisible par tous les comptes vaut le même jeton pour
      // personne. (Windows n'exprime pas ses ACL dans `mode` : hors sujet là-bas.)
      expect(statSync(chemin).mode & 0o777, 'le .env n’est pas en 0600').toBe(0o600);
    }

    // Second passage : RIEN ne bouge — ni le contenu, ni le code de sortie.
    // « Complété, jamais écrasé » : écraser un jeton en service couperait
    // tous les nœuds déjà connectés.
    const second = await lancer(bin(), [], cwd);
    expect(second.code).toBe(0);
    expect(second.sortie).toContain('déjà complet');
    expect(readFileSync(chemin, 'utf8'), 'LE SECOND PASSAGE A RÉÉCRIT LE FICHIER').toBe(contenu);
  }, 120_000);

  it('PORT OCCUPÉ : le code de sortie le dit, sans annuler le reste', async () => {
    // On occupe le port de la ruche DEPUIS LE TEST : le code de sortie doit le
    // rapporter (un script de supervision ne lit pas la prose), et le dry-run
    // doit quand même dérouler — un port pris n'empêche pas d'écrire un .env.
    const bouchon: Server = createServer();
    await new Promise<void>((resoudre, rejeter) => {
      bouchon.once('error', rejeter);
      bouchon.listen(PORT_DEFAUT, '127.0.0.1', resoudre);
    });
    try {
      const r = await lancer(bin(), ['--dry-run'], dossier());
      expect(r.code, 'le port occupé doit se lire dans le code de sortie').toBe(CODE.PORT_OCCUPE);
      expect(r.sortie).toContain('occupé');
      // …et la suite a bien déroulé : le récapitulatif est là.
      expect(r.sortie).toContain('rien n’a été écrit');
    } finally {
      await new Promise((resoudre) => bouchon.close(resoudre));
    }
  });

  // ═══ LA SONDE DOIT REGARDER LA PORTE QU'ON VA OUVRIR ════════════════════════
  //
  // L'installeur n'écrase jamais un `.env` : le port qu'il retient est celui du
  // fichier existant, et `PORT_DEFAUT` seulement à défaut. La sonde, elle,
  // regardait `PORT_DEFAUT` sans condition — parce qu'elle court AVANT que le
  // `.env` ne soit lu.
  //
  // Sur une première installation les deux coïncident, et c'est tout ce que la
  // suite exerçait. Sur une RÉINSTALLATION avec un port personnalisé — le cas
  // de quiconque a déjà 7777 pris par autre chose — la sonde répond sur une
  // porte que la ruche n'ouvrira pas. Les deux cas ci-dessous vont dans les
  // deux sens : faux calme, puis fausse alerte.

  /** Un port que personne ne tient. Demandé au système, jamais deviné. */
  async function portLibre(): Promise<number> {
    const sonde = createServer();
    const port = await new Promise<number>((resoudre, rejeter) => {
      sonde.once('error', rejeter);
      sonde.listen(0, '127.0.0.1', () => {
        const a = sonde.address();
        if (a === null || typeof a === 'string') rejeter(new Error('adresse inattendue'));
        else resoudre(a.port);
      });
    });
    await new Promise((resoudre) => sonde.close(resoudre));
    return port;
  }

  /** Occupe un port pour la durée d'un cas, et le rend quoi qu'il arrive. */
  async function occuper<T>(port: number, faire: () => Promise<T>): Promise<T> {
    const bouchon: Server = createServer();
    await new Promise<void>((resoudre, rejeter) => {
      bouchon.once('error', rejeter);
      bouchon.listen(port, '127.0.0.1', resoudre);
    });
    try {
      return await faire();
    } finally {
      await new Promise((resoudre) => bouchon.close(resoudre));
    }
  }

  it('LE PORT DU .env EST OCCUPÉ : la sonde le voit, même si 7777 est libre', async () => {
    const cwd = dossier();
    const pris = await portLibre();
    writeFileSync(path.join(cwd, '.env'), `HIVE_PORT=${pris}\n`);

    const r = await occuper(pris, () => lancer(bin(), ['--dry-run'], cwd));

    expect(r.sortie, 'la sonde doit nommer le port RETENU').toContain(String(pris));
    expect(r.sortie).toContain('occupé');
    expect(r.code, 'un script de supervision ne lit pas la prose').toBe(CODE.PORT_OCCUPE);
  }, 120_000);

  it('LE PORT DU .env EST LIBRE : pas d’alerte, même si 7777 est pris', async () => {
    // Le sens inverse, et il compte autant : une fausse alerte apprend à
    // ignorer les alertes. Ici la ruche n'ira jamais sur 7777 — s'en plaindre
    // serait un rouge sans objet.
    const cwd = dossier();
    const choisi = await portLibre();
    writeFileSync(path.join(cwd, '.env'), `HIVE_PORT=${choisi}\n`);

    const r = await occuper(PORT_DEFAUT, () => lancer(bin(), ['--dry-run'], cwd));

    expect(r.sortie, 'la sonde ne doit pas parler d’un port qu’on n’ouvrira pas').not.toContain(
      'occupé',
    );
    expect(r.code, `sortie :\n${r.sortie}`).toBe(0);
  }, 120_000);
});
