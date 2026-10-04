// LA PORTE DE SÉCURITÉ, CÔTÉ NŒUD — de vrais dépôts git, de vrais processus.
//
// Ce banc lance `passerLaPorte` comme le client du nœud le fait : sur le diff
// BRUT d'une production, dans son répertoire, avec le dépôt épinglé et son
// commit de base. Les outils sont les faux de `fixtures/faux-outils-porte.ts`,
// posés en tête du PATH : ils LISENT ce que la porte leur donne et rejouent
// les sorties réelles de betterleaks 1.9.0 et d'osv-scanner 2.6.0. Tout le
// reste est réel : le miroir, les drapeaux, les codes de sortie, la relecture
// des rapports, le caviardage qui en découle.
//
// Le critère de preuve de la carte (G10), à cette frontière :
//   · une clé AWS factice ajoutée → un constat, et ses DEUX moitiés caviardées
//     partout où le résultat part ; le rapport ne porte jamais une valeur ;
//   · un lockfile qui ajoute une version vulnérable connue → l'avis est cité ;
//   · une vulnérabilité déjà à la base → rien ne bloque ;
//   · un binaire absent → « non vérifié », avec sa raison — jamais « rien ».
//
// POSIX seulement : les faux outils sont des scripts à shebang.

import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { poserRegistre } from '../src/node-client/git-hote.js';
import { etiquetteImage, type Fournisseur } from '../src/node-client/isolement.js';
import { passerLaPorte, versionPourLaPorte } from '../src/node-client/porte-securite.js';
import { ETIQUETTE_PORTE, type PorteSecurite } from '../src/shared/porte-securite.js';
import { creerCaviardeur, SECRET_CAVIARDE } from '../src/shared/caviardage.js';
import { appelsDuFauxBac, fauxBac } from './fixtures/faux-bac.js';
import {
  appelsDesOutils,
  fauxOutilsPorte,
  proxysRecus,
  requetesEnvoyees,
  type FauxOutils,
} from './fixtures/faux-outils-porte.js';

const POSIX = process.platform !== 'win32';

/** Assemblées à l'exécution : en clair, la protection des secrets de GitHub refuserait la poussée. */
const ID_AWS = ['AKIA', 'Z7Q4XWERT2LMNOPQ'].join('');
const SECRETE_AWS = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYzq9Lr3Tn8v'].join('/');
const JETON_GITHUB = ['ghp', 'jOkYRBMeyyMDHqJ38aRUhR4IWrXPvhsBkDa9'].join('_');
const STRIPE = ['sk', 'live', 'u8jzPde0IgxLd6GncfBAepfJ'].join('_');

const dossiers: string[] = [];
const PATH_AVANT = process.env.PATH;
let outils: FauxOutils;

beforeEach(() => {
  outils = fauxOutilsPorte(dossiers);
  process.env.PATH = `${outils.dossier}${path.delimiter}${PATH_AVANT ?? ''}`;
});

afterEach(() => {
  process.env.PATH = PATH_AVANT;
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

/** Un package-lock v3 qui épingle `deps` (la forme que lit osv-scanner). */
const verrou = (deps: Record<string, string>): string =>
  JSON.stringify(
    {
      name: 'projet',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'projet', version: '1.0.0', dependencies: deps },
        ...Object.fromEntries(
          Object.entries(deps).map(([nom, version]) => [
            `node_modules/${nom}`,
            {
              version,
              resolved: `https://registry.npmjs.org/${nom}/-/${nom}-${version}.tgz`,
              license: 'MIT',
            },
          ]),
        ),
      },
    },
    null,
    2,
  ) + '\n';

/**
 * Un dépôt à `base`, épinglé comme le nœud l'épingle (`poserRegistre`), puis
 * « produit » par `production` — écrit dans l'arbre, comme un agent. Rend le
 * diff BRUT que le nœud calculerait, et de quoi lancer la porte.
 */
async function produire(
  base: Record<string, string>,
  production: Record<string, string | null | { lien: string }>,
): Promise<{ cwd: string; diff: string; depot: Parameters<typeof passerLaPorte>[0]['depot'] }> {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'hive-porte-noeud-'));
  dossiers.push(parent);
  const cwd = path.join(parent, 'tache');
  const ecrire = (fichiers: Record<string, string | null | { lien: string }>): void => {
    for (const [nom, contenu] of Object.entries(fichiers)) {
      const cible = path.join(cwd, nom);
      if (contenu === null || typeof contenu === 'object') {
        rmSync(cible, { force: true });
        // Un LIEN à la place du fichier — comme un agent peut en poser un.
        if (contenu) symlinkSync(contenu.lien, cible);
        continue;
      }
      mkdirSync(path.dirname(cible), { recursive: true });
      writeFileSync(cible, contenu);
    }
  };
  mkdirSync(cwd);
  ecrire(base);
  const git = simpleGit({ baseDir: cwd });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  const baseSha = (await git.revparse(['HEAD'])).trim();
  const registre = await poserRegistre(cwd, path.join(parent, 'registre'), baseSha);
  ecrire(production);
  await git.add(['-A']);
  const diff = await git.diff(['--cached', baseSha]);
  return { cwd, diff, depot: { depot: registre, baseSha } };
}

const CONFIG_BASE = "export const region = 'eu-west-3';\n";
const CONFIG_AWS =
  CONFIG_BASE +
  `export const awsAccessKeyId = '${ID_AWS}';\n` +
  `export const awsSecretAccessKey = '${SECRETE_AWS}';\n`;

const miroirsRestants = (cwd: string): string[] =>
  readdirSync(cwd).filter((n) => n.startsWith('.hive-porte-'));

describe.runIf(POSIX)('passerLaPorte — les secrets que la production AJOUTE', () => {
  it('UNE CLÉ AWS FACTICE : un constat par moitié de la paire, les deux caviardées — jamais rapportées', async () => {
    const p = await produire({ 'src/config.ts': CONFIG_BASE }, { 'src/config.ts': CONFIG_AWS });
    // Le trou que la porte ferme : sans elle, le caviardage du nœud ne
    // connaissait aucun motif AWS, et la paire partait au hub en clair.
    expect(creerCaviardeur([]).diff(p.diff)).toContain(SECRETE_AWS);

    const { rapport, valeurs } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });

    expect(rapport.secrets).toEqual({
      etat: 'constat',
      raison: 'trouve',
      outil: { nom: 'betterleaks', version: '1.9.0' },
      constats: [
        { regle: 'aws-access-token', fichier: 'src/config.ts', ligne: 2 },
        { regle: 'aws-secret-access-key', fichier: 'src/config.ts', ligne: 3 },
      ],
      total: 2,
    });
    expect(JSON.stringify(rapport)).not.toContain(ID_AWS);
    expect(JSON.stringify(rapport)).not.toContain(SECRETE_AWS);
    // Les valeurs, relues dans le diff aux colonnes rapportées, rejoignent le
    // caviardeur de tout ce qui part — le diff d'abord.
    expect(valeurs).toEqual(expect.arrayContaining([ID_AWS, SECRETE_AWS]));
    const sortant = creerCaviardeur(valeurs).diff(p.diff);
    expect(sortant).not.toContain(ID_AWS);
    expect(sortant).not.toContain(SECRETE_AWS);
    expect(sortant).toContain(`export const awsSecretAccessKey = '${SECRET_CAVIARDE}';`);

    // L'outil a lu le MIROIR avec la configuration que la porte impose, la
    // valeur caviardée dans son propre rapport ; le miroir est retiré.
    const [sonde, analyse] = appelsDesOutils(outils);
    expect(sonde).toMatch(/^betterleaks --version$/);
    for (const drapeau of ['--redact', '--ignore-gitleaks-allow', '--no-banner']) {
      expect(analyse).toContain(drapeau);
    }
    expect(analyse).toContain('--confidence high');
    expect(analyse).toMatch(/^betterleaks dir \.hive-porte-[^/ ]+\/secrets /);
    expect(analyse).toMatch(/--config \.hive-porte-[^/ ]+\/regles\/betterleaks\.toml/);
    expect(analyse).toMatch(/--gitleaks-ignore-path \.hive-porte-[^/ ]+\/regles /);
    expect(miroirsRestants(p.cwd)).toEqual([]);
    // Aucun lockfile touché : osv-scanner ne tourne pas, et rien ne part à osv.dev.
    expect(rapport.dependances).toEqual({
      etat: 'rien_trouve',
      raison: 'aucun_lockfile',
      constats: [],
      total: 0,
    });
    expect(appelsDesOutils(outils).some((l) => l.startsWith('osv-scanner'))).toBe(false);
  });

  it('UNE CLÉ PEM : caviardée par ses lignes de base64 — jamais par son en-tête, qu’un code sain écrit aussi', async () => {
    const corps = Array.from({ length: 4 }, () => randomBytes(48).toString('base64'));
    const entete = `-----BEGIN ${'PRIVATE'} KEY-----`;
    const pem = [entete, ...corps, `-----END ${'PRIVATE'} KEY-----`];
    // Une ligne LÉGITIME, ajoutée par la même production, qui porte l'en-tête.
    const sain = `export const estUneCle = (pem: string) => pem.startsWith('${entete}');`;
    const p = await produire(
      { 'README.md': '# projet\n' },
      { 'config/cle.pem': `${pem.join('\n')}\n`, 'src/pem.ts': `${sain}\n` },
    );
    const { rapport, valeurs } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.secrets.constats).toEqual([
      { regle: 'private-key', fichier: 'config/cle.pem', ligne: 1 },
    ]);
    const sortant = creerCaviardeur(valeurs).diff(p.diff);
    for (const ligne of corps) expect(sortant).not.toContain(ligne);
    expect(sortant).toContain(`+${sain}\n`);
    expect(sortant).toContain(`+${entete}\n`);
  });

  it('DES COLONNES QUI NE SE RELISENT PAS : le constat reste — mais rien n’est réécrit sur sa seule foi', async () => {
    // La porte caviardait alors les LIGNES ENTIÈRES, partout où une ligne
    // identique partait : un caviardage qui ne visait plus un secret, mais du code.
    outils.mode('betterleaks', 'decale');
    const p = await produire({ 'src/config.ts': CONFIG_BASE }, { 'src/config.ts': CONFIG_AWS });
    const { rapport, valeurs } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.secrets.etat).toBe('constat');
    expect(rapport.secrets.total).toBe(2);
    expect(valeurs).toEqual([]);
  });

  it('LES RÈGLES GÉNÉRIQUES NE PARLENT PAS, et seul le secret est réécrit — chaque ligne saine part intacte', async () => {
    // Les lignes que l'outil réel lisait comme des mots de passe (confiance
    // basse) : `dashboard/src/AccountPanel.tsx` et une fixture de banc. Leur
    // « valeur » relue — `new-password` — devenait `[secret]` dans le diff, les
    // logs et le texte final, et chaque production demandait une correction
    // impossible, qu'aucune approbation ne levait.
    const panneau =
      "            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}";
    const fixture = "      password: 'motdepasse-assez-long-42',";
    const p = await produire(
      { 'src/config.ts': CONFIG_BASE },
      {
        'src/config.ts': CONFIG_AWS,
        'dashboard/src/Compte.tsx': `export const C = () => (\n  <input\n${panneau}\n  />\n);\n`,
        'tests/auth.test.ts': `const corps = {\n${fixture}\n};\n`,
      },
    );
    const { rapport, valeurs } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });

    expect(rapport.secrets.constats.map((c) => c.regle)).toEqual([
      'aws-access-token',
      'aws-secret-access-key',
    ]);
    expect(valeurs.sort()).toEqual([ID_AWS, SECRETE_AWS].sort());
    const sortant = creerCaviardeur(valeurs).diff(p.diff);
    expect(sortant).toContain(`+${panneau}\n`);
    expect(sortant).toContain(`+${fixture}\n`);
    // Hors des deux valeurs, le diff qui part est OCTET POUR OCTET celui de la production.
    expect(sortant).toBe(
      p.diff.replaceAll(ID_AWS, SECRET_CAVIARDE).replaceAll(SECRETE_AWS, SECRET_CAVIARDE),
    );
  });

  it('UN OUTIL QUI N’APPLIQUE PAS LA CONFIANCE DEMANDÉE : « non vérifié », et rien de son rapport n’est caviardé', async () => {
    outils.mode('betterleaks', 'sans-confiance');
    const p = await produire(
      { 'src/config.ts': CONFIG_BASE },
      {
        'src/config.ts': CONFIG_AWS,
        'tests/auth.test.ts': "const corps = {\n      password: 'motdepasse-assez-long-42',\n};\n",
      },
    );
    const { rapport, valeurs } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.secrets).toEqual({
      etat: 'non_verifie',
      raison: 'outil_en_echec',
      outil: { nom: 'betterleaks', version: '1.9.0' },
      constats: [],
      total: 0,
    });
    expect(valeurs).toEqual([]);
  });

  it('UNE CLÉ DANS UN SVG, UN `*.min.js`, UN `go.sum` : lue — le préfiltre par défaut de l’outil est éteint', async () => {
    // Mesuré sur 1.9.0 : son préfiltre écarte ces fichiers par leur NOM, et le
    // miroir garde ce nom. Une clé Stripe — qu'aucun motif de Hive ne connaît —
    // y partait au hub en clair, sans constat.
    const p = await produire(
      { 'README.md': '# projet\n' },
      {
        'assets/logo.svg': `<svg><!-- ${STRIPE} --></svg>\n`,
        'vendor/jquery-3.6.0.min.js': `var k = "${STRIPE}";\n`,
        'go.sum': `exemple.test/x v1.0.0 h1:${STRIPE}\n`,
      },
    );
    const { rapport, valeurs } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.secrets.constats).toEqual([
      { regle: 'stripe-access-token', fichier: 'assets/logo.svg', ligne: 1 },
      { regle: 'stripe-access-token', fichier: 'go.sum', ligne: 1 },
      { regle: 'stripe-access-token', fichier: 'vendor/jquery-3.6.0.min.js', ligne: 1 },
    ]);
    expect(creerCaviardeur(valeurs).diff(p.diff)).not.toContain(STRIPE);
  });

  it('CE QUE LE NŒUD RÉÉCRIVAIT EN SILENCE devient un constat — même sans Betterleaks', async () => {
    outils.mode('betterleaks', 'absent');
    const p = await produire(
      { 'src/gh.ts': 'export const owner = "hive";\n' },
      { 'src/gh.ts': `export const owner = "hive";\nexport const jeton = '${JETON_GITHUB}';\n` },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.secrets).toEqual({
      etat: 'constat',
      raison: 'trouve',
      constats: [{ regle: 'hive-caviardage', fichier: 'src/gh.ts', ligne: 2 }],
      total: 1,
    });
  });
});

describe.runIf(POSIX)('passerLaPorte — les dépendances que la production INTRODUIT', () => {
  /** Les vulnérabilités du volet, en lignes lisibles. */
  const vulnerabilites = (rapport: PorteSecurite): string[][] =>
    rapport.dependances.constats.flatMap((c) =>
      c.genre === 'vulnerabilite'
        ? [[c.paquet, c.version, c.avis, c.alias.join(','), c.gravite ?? '', c.fichier]]
        : [],
    );

  it('UN LOCKFILE QUI AJOUTE UNE VERSION VULNÉRABLE CONNUE : l’avis est cité, ceux de la base non', async () => {
    const p = await produire(
      { 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      { 'package-lock.json': verrou({ lodash: '4.17.20', minimist: '1.2.0' }) },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances.etat).toBe('constat');
    expect(rapport.dependances.outil).toEqual({ nom: 'osv-scanner', version: '2.6.0' });
    expect(vulnerabilites(rapport)).toEqual([
      [
        'minimist',
        '1.2.0',
        'GHSA-vh95-rmgr-6w4m',
        'CVE-2020-7598',
        'MODERATE',
        'package-lock.json',
      ],
      [
        'minimist',
        '1.2.0',
        'GHSA-xvch-5gv4-984h',
        'CVE-2021-44906',
        'CRITICAL',
        'package-lock.json',
      ],
    ]);
    // lodash 4.17.20 est vulnérable lui aussi — mais il l'était à la base.
    expect(JSON.stringify(rapport)).not.toContain('lodash');
    // DEUX PASSES : chaque fichier extrait HORS LIGNE, un par un, sous son nom ;
    // puis une interrogation, sur le SBOM que la porte a écrit — rien d'autre.
    const appels = appelsDesOutils(outils).filter((l) => l.startsWith('osv-scanner scan'));
    expect(appels).toHaveLength(3);
    const [tete, base, interrogation] = appels;
    expect(tete).toMatch(/-L \.hive-porte-[^/ ]+\/dependances\/tete\/0\/package-lock\.json /);
    expect(base).toMatch(/-L \.hive-porte-[^/ ]+\/dependances\/base\/0\/package-lock\.json /);
    for (const extraction of [tete, base]) {
      expect(extraction).toContain('--experimental-disable-plugins vulnmatch/osvdev');
      expect(extraction).toContain('--all-packages');
    }
    expect(interrogation).toMatch(/-L \.hive-porte-[^/ ]+\/sboms\/tete\/0\/bom\.cdx\.json /);
    expect(interrogation).not.toContain('vulnmatch/osvdev');
    for (const a of appels) {
      expect(a).toContain('--no-resolve');
      expect(a).toMatch(/--config \.hive-porte-[^/ ]+\/regles\/osv-scanner\.toml/);
    }
    // CE QUI PART : le seul paquet introduit. Ni lodash, inchangé, ni la base.
    expect(requetesEnvoyees(outils)).toEqual([
      { version: '1.2.0', package: { name: 'minimist', ecosystem: 'npm' } },
    ]);
    expect(miroirsRestants(p.cwd)).toEqual([]);
  });

  it('UNE VULNÉRABILITÉ DÉJÀ À LA BASE : rien ne bloque — la montée de version n’a rien introduit', async () => {
    const p = await produire(
      { 'package-lock.json': verrou({ lodash: '4.17.19' }) },
      { 'package-lock.json': verrou({ lodash: '4.17.20' }) },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances).toEqual({
      etat: 'rien_trouve',
      raison: 'analyse_propre',
      outil: { nom: 'osv-scanner', version: '2.6.0' },
      constats: [],
      total: 0,
    });
    // La tête qui change, et la base du MÊME paquet, pour comparer.
    expect(requetesEnvoyees(outils).map((r) => JSON.stringify(r))).toEqual([
      JSON.stringify({ version: '4.17.20', package: { name: 'lodash', ecosystem: 'npm' } }),
      JSON.stringify({ version: '4.17.19', package: { name: 'lodash', ecosystem: 'npm' } }),
    ]);
  });

  it('CE QUI PART À OSV.DEV : le seul paquet PUBLIC introduit — jamais un registre privé, un commit git, une dépendance `file:`', async () => {
    // Mesuré par interception avec le vrai osv-scanner : tout cela partait,
    // et tous les paquets inchangés de la base et de la tête avec.
    const prive = {
      version: '1.0.0',
      resolved:
        'https://npm.acme-internal.example/@acme-internal/secret-project/-/secret-project-1.0.0.tgz',
    };
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const tete = JSON.parse(verrou({ lodash: '4.17.20', minimist: '1.2.0' })) as {
      packages: Record<string, unknown>;
    };
    Object.assign(tete.packages, {
      'node_modules/@acme-internal/secret-project': prive,
      'node_modules/local-lib': { resolved: '../local-lib', link: true },
      '../local-lib': { name: 'local-lib', version: '0.0.1' },
      'node_modules/gitdep': {
        version: '1.0.0',
        resolved: `git+ssh://git@github.com/acme-internal/gitdep.git#${commit}`,
      },
    });
    const p = await produire(
      { 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      { 'package-lock.json': `${JSON.stringify(tete, null, 2)}\n` },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    const envoye = JSON.stringify(requetesEnvoyees(outils));
    expect(requetesEnvoyees(outils)).toEqual([
      { version: '1.2.0', package: { name: 'minimist', ecosystem: 'npm' } },
    ]);
    for (const secret of ['acme-internal', 'secret-project', commit, 'local-lib', 'gitdep']) {
      expect(envoye).not.toContain(secret);
    }
    // Jamais verts : comptés, par nom — le privé, le local, le git.
    expect(rapport.dependances).toMatchObject({ etat: 'constat', nonInterroges: 3 });
  });

  it('DES PAQUETS INTRODUITS, AUCUN D’INTERROGEABLE : « non vérifié » — et rien n’est parti', async () => {
    const p = await produire(
      { 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      {
        'package-lock.json': verrou({ lodash: '4.17.20' }).replace(
          '"license": "MIT"',
          '"license": "MIT" }, "node_modules/@acme-internal/x": { "version": "2.0.0", "resolved": "https://npm.acme-internal.example/x.tgz"',
        ),
      },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances).toEqual({
      etat: 'non_verifie',
      raison: 'sources_non_publiques',
      outil: { nom: 'osv-scanner', version: '2.6.0' },
      constats: [],
      total: 0,
      nonInterroges: 1,
    });
    expect(requetesEnvoyees(outils)).toEqual([]);
  });

  it('`gradle.lockfile` QUI AJOUTE log4j-core 2.14.1 : l’avis est cité — il passait pour « aucun lockfile »', async () => {
    const base = 'org.slf4j:slf4j-api:1.7.36=compileClasspath\n';
    const p = await produire(
      { 'gradle.lockfile': base },
      {
        'gradle.lockfile': `${base}org.apache.logging.log4j:log4j-core:2.14.1=compileClasspath\n`,
      },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(vulnerabilites(rapport)).toEqual([
      [
        'org.apache.logging.log4j:log4j-core',
        '2.14.1',
        'GHSA-jfh8-c2jp-5v3q',
        'CVE-2021-44228',
        'CRITICAL',
        'gradle.lockfile',
      ],
    ]);
  });

  it('`requirements.txt` : une contrainte `>=` n’est pas une version — elle ne part pas, elle est comptée', async () => {
    // osv-scanner lit `flask>=0.1` comme « flask 0.1 » : la borne basse, que
    // pip n'installe jamais. La porte demandait de corriger un faux positif.
    const p = await produire(
      { 'requirements.txt': 'requests==2.31.0\n' },
      { 'requirements.txt': 'requests==2.31.0\nflask>=0.1\n' },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances).toMatchObject({
      etat: 'non_verifie',
      raison: 'sources_non_publiques',
      nonInterroges: 1,
    });
    expect(requetesEnvoyees(outils)).toEqual([]);
    // Épinglée, elle part — et l'avis est cité.
    const q = await produire(
      { 'requirements.txt': 'requests==2.31.0\n' },
      { 'requirements.txt': 'requests==2.31.0\nflask==0.1\n' },
    );
    const { rapport: epingle } = await passerLaPorte({ ...q, caviardeur: creerCaviardeur([]) });
    expect(vulnerabilites(epingle).map((v) => v[2])).toEqual(['GHSA-562c-5r94-xh97']);
  });

  it('UN LOCKFILE DE TÊTE MAL FORMÉ est un CONSTAT — et il n’aveugle plus les autres', async () => {
    // Le vrai osv-scanner échoue sur TOUT son passage dès qu'un fichier ne se
    // lit pas (sortie 127) : lus ensemble, un seul lockfile cassé rendait le
    // volet « outil en échec », donc vert hors de `strict`.
    const p = await produire(
      {
        'package-lock.json': verrou({ lodash: '4.17.20' }),
        'web/package-lock.json': verrou({ lodash: '4.17.20' }),
      },
      {
        'package-lock.json': '{ "lockfileVersion": 3, "packages": {',
        'web/package-lock.json': verrou({ lodash: '4.17.20', minimist: '1.2.0' }),
      },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances.etat).toBe('constat');
    expect(rapport.dependances.constats[0]).toEqual({
      genre: 'lockfile_illisible',
      fichier: 'package-lock.json',
      motif: 'mal_forme',
    });
    expect(vulnerabilites(rapport).map((v) => [v[0], v[5]])).toEqual([
      ['minimist', 'web/package-lock.json'],
      ['minimist', 'web/package-lock.json'],
    ]);
  });

  it('UN LOCKFILE DE TÊTE REMPLACÉ PAR UN LIEN est un constat — la porte ne le suit pas', async () => {
    const p = await produire(
      { 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      { 'package-lock.json': { lien: '/etc/hostname' } },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances).toMatchObject({
      etat: 'constat',
      constats: [
        { genre: 'lockfile_illisible', fichier: 'package-lock.json', motif: 'pas_un_fichier' },
      ],
    });
    // Aucun outil pour un défaut que la porte voit seule.
    expect(appelsDesOutils(outils).some((l) => l.startsWith('osv-scanner'))).toBe(false);
  });

  it('UN LOCKFILE DE BASE MAL FORMÉ : rien à quoi comparer pour lui — « non vérifié », pas un défaut du producteur', async () => {
    const p = await produire(
      { 'package-lock.json': '{ cassé' },
      { 'package-lock.json': verrou({ minimist: '1.2.0' }) },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances).toMatchObject({
      etat: 'non_verifie',
      raison: 'lockfile_illisible',
    });
  });

  it('OSV.DEV INJOIGNABLE : « non vérifiée », et la raison NOMME api.osv.dev — jamais « rien trouvé »', async () => {
    outils.mode('osv-scanner', 'hors-ligne');
    const p = await produire(
      { 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      { 'package-lock.json': verrou({ lodash: '4.17.20', minimist: '1.2.0' }) },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances).toEqual({
      etat: 'non_verifie',
      raison: 'osv_injoignable',
      outil: { nom: 'osv-scanner', version: '2.6.0' },
      constats: [],
      total: 0,
    });
  });

  it('LE PROXY SORTANT de l’hôte va à l’interrogation d’osv.dev — et à elle seule', async () => {
    const avant = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.entreprise.test:3128';
    try {
      const p = await produire(
        { 'src/config.ts': CONFIG_BASE, 'package-lock.json': verrou({ lodash: '4.17.20' }) },
        {
          'src/config.ts': `${CONFIG_BASE}export const zone = 'b';\n`,
          'package-lock.json': verrou({ lodash: '4.17.20', minimist: '1.2.0' }),
        },
      );
      await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    } finally {
      if (avant === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = avant;
    }
    expect(proxysRecus(outils)).toEqual([
      'betterleaks -',
      'betterleaks -',
      'extraction -',
      'extraction -',
      'interrogation http://proxy.entreprise.test:3128',
    ]);
  });
});

describe.runIf(POSIX)('passerLaPorte — ce qui ne se vérifie pas le DIT', () => {
  it('BINAIRES ABSENTS : « non vérifié », raison `outil_absent` — jamais « rien trouvé »', async () => {
    outils.mode('betterleaks', 'absent');
    outils.mode('osv-scanner', 'absent');
    const p = await produire(
      { 'src/a.ts': 'export const a = 1;\n', 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      {
        'src/a.ts': 'export const a = 2;\n',
        'package-lock.json': verrou({ lodash: '4.17.20', minimist: '1.2.0' }),
      },
    );
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    for (const volet of [rapport.secrets, rapport.dependances]) {
      expect(volet).toEqual({
        etat: 'non_verifie',
        raison: 'outil_absent',
        constats: [],
        total: 0,
      });
    }
    expect(miroirsRestants(p.cwd)).toEqual([]);
  });

  it.each([
    ['plante (sortie 2, aucun rapport)', 'plante'],
    ['se contredit (constats au rapport, sortie 0)', 'menteur'],
  ])('UN BETTERLEAKS QUI %s : « non vérifié », outil en échec', async (_cas, mode) => {
    outils.mode('betterleaks', mode);
    const p = await produire({ 'src/config.ts': CONFIG_BASE }, { 'src/config.ts': CONFIG_AWS });
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.secrets).toEqual({
      etat: 'non_verifie',
      raison: 'outil_en_echec',
      outil: { nom: 'betterleaks', version: '1.9.0' },
      constats: [],
      total: 0,
    });
  });

  it('RIEN À LIRE (aucune ligne ajoutée, aucun lockfile) : « rien trouvé », et RIEN ne se lance', async () => {
    const p = await produire({ 'src/a.ts': 'un\ndeux\n' }, { 'src/a.ts': 'un\n' });
    const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });
    expect(rapport.secrets).toMatchObject({ etat: 'rien_trouve', raison: 'aucun_ajout' });
    expect(rapport.dependances).toMatchObject({ etat: 'rien_trouve', raison: 'aucun_lockfile' });
    expect(appelsDesOutils(outils)).toEqual([]);
  });

  it('UNE PRODUCTION EN ÉCHEC : ses secrets sont lus, ses dépendances NON EXAMINÉES — osv-scanner ne tourne pas', async () => {
    const p = await produire(
      { 'src/config.ts': CONFIG_BASE, 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      {
        'src/config.ts': CONFIG_AWS,
        'package-lock.json': verrou({ lodash: '4.17.20', minimist: '1.2.0' }),
      },
    );
    const { rapport, valeurs } = await passerLaPorte({
      ...p,
      caviardeur: creerCaviardeur([]),
      dependances: 'production_en_echec',
    });
    expect(rapport.secrets).toMatchObject({ etat: 'constat', total: 2 });
    expect(valeurs).toEqual(expect.arrayContaining([ID_AWS, SECRETE_AWS]));
    expect(rapport.dependances).toEqual({
      etat: 'non_verifie',
      raison: 'production_en_echec',
      constats: [],
      total: 0,
    });
    expect(appelsDesOutils(outils).some((l) => l.startsWith('osv-scanner'))).toBe(false);
  });

  it('UN LOCKFILE TOUCHÉ SANS COMMIT DE BASE : « non vérifié » — rien à quoi comparer', async () => {
    const p = await produire(
      { 'package-lock.json': verrou({ lodash: '4.17.20' }) },
      { 'package-lock.json': verrou({ lodash: '4.17.20', minimist: '1.2.0' }) },
    );
    const { rapport } = await passerLaPorte({ ...p, depot: null, caviardeur: creerCaviardeur([]) });
    expect(rapport.dependances).toMatchObject({ etat: 'non_verifie', raison: 'sans_base' });
  });
});

describe.runIf(POSIX)(
  'passerLaPorte — l’outil lancé est celui de l’HÔTE, jamais celui de la tâche',
  () => {
    // ─── LE BINAIRE QUE L'AGENT POSE DANS SA TÂCHE ─────────────────────────────
    //
    // Les outils tournaient par leur NOM, depuis le répertoire de la tâche. Or
    // `execvp` lit une entrée vide du PATH (`PATH=/usr/bin:/bin:`) ou `.` comme
    // le répertoire courant : un `betterleaks` écrit par l'agent à la racine de
    // sa production y était trouvé AVANT le vrai — exécuté hors du bac, et libre
    // de répondre « rien trouvé ».
    it.each([
      ['une entrée vide en fin de PATH', (d: string) => `${d}${path.delimiter}`],
      ['`.` en tête du PATH', (d: string) => `.${path.delimiter}${d}`],
    ])('%s : le `betterleaks` de la tâche ne se lance pas', async (_cas, chemin) => {
      // Le vrai est absent de l'hôte : seul celui de l'agent pourrait répondre.
      outils.mode('betterleaks', 'absent');
      const p = await produire({ 'src/config.ts': CONFIG_BASE }, { 'src/config.ts': CONFIG_AWS });
      const trace = path.join(p.cwd, '..', 'lance-par-la-porte');
      writeFileSync(
        path.join(p.cwd, 'betterleaks'),
        `#!/bin/sh\necho lance > '${trace}'\necho 'betterleaks version 1.9.0'\n` +
          'case "$1" in dir) shift; while [ "$1" != "--report-path" ]; do shift; done; echo "[]" > "$2";; esac\n',
      );
      chmodSync(path.join(p.cwd, 'betterleaks'), 0o755);
      process.env.PATH = chemin(outils.dossier);

      const { rapport } = await passerLaPorte({ ...p, caviardeur: creerCaviardeur([]) });

      expect(existsSync(trace), 'le binaire de la tâche a été lancé par la porte').toBe(false);
      expect(rapport.secrets).toMatchObject({ etat: 'non_verifie', raison: 'outil_absent' });
    });
  },
);

describe.runIf(POSIX)('passerLaPorte — dans le bac du nœud', () => {
  it('LES OUTILS PASSENT PAR LE MOTEUR, sans aucune variable de l’agent', async () => {
    const bac = fauxBac(dossiers);
    const p = await produire({ 'src/config.ts': CONFIG_BASE }, { 'src/config.ts': CONFIG_AWS });
    const { rapport } = await passerLaPorte({
      ...p,
      bac: { ...bac, variables: ['ANTHROPIC_API_KEY'] },
      caviardeur: creerCaviardeur([]),
    });
    expect(rapport.secrets.etat).toBe('constat');
    const lancements = appelsDuFauxBac(bac);
    expect(lancements.some((l) => l.includes('betterleaks --version'))).toBe(true);
    expect(lancements.some((l) => l.includes('betterleaks dir'))).toBe(true);
    expect(lancements.join('\n')).not.toContain('ANTHROPIC_API_KEY');
  });
});

describe.runIf(POSIX)('les sondes de `hive doctor` — celles du nœud', () => {
  it('`versionPourLaPorte` dit ce que la PORTE trouverait, ou null — jamais une version supposée', async () => {
    expect(await versionPourLaPorte('betterleaks')).toBe('1.9.0');
    expect(await versionPourLaPorte('osv-scanner')).toBe('2.6.0');
    outils.mode('osv-scanner', 'absent');
    expect(await versionPourLaPorte('osv-scanner')).toBeNull();
    // Un `osv-scanner` dans le répertoire COURANT, atteint par une entrée
    // relative du PATH : la porte ne le lancerait pas, le docteur ne le compte pas.
    const ici = mkdtempSync(path.join(os.tmpdir(), 'hive-porte-cwd-'));
    dossiers.push(ici);
    writeFileSync(path.join(ici, 'osv-scanner'), '#!/bin/sh\necho "osv-scanner version: 2.6.0"\n');
    chmodSync(path.join(ici, 'osv-scanner'), 0o755);
    const cwdAvant = process.cwd();
    process.chdir(ici);
    try {
      process.env.PATH = `.${path.delimiter}${outils.dossier}`;
      expect(await versionPourLaPorte('osv-scanner')).toBeNull();
    } finally {
      process.chdir(cwdAvant);
    }
  });

  it('`etiquetteImage` lit l’étiquette par le moteur, sans rien lancer dans l’image', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-faux-moteur-etiquette-'));
    dossiers.push(dir);
    const bin = path.join(dir, 'moteur');
    writeFileSync(
      bin,
      '#!/bin/sh\n' +
        'printf \'%s\\n\' "$*" >> "$(dirname "$0")/appels"\n' +
        '[ "$1 $2" = "image inspect" ] || exit 2\n' +
        'cat "$(dirname "$0")/etiquette"\n' +
        'exit "$(cat "$(dirname "$0")/code")"\n',
    );
    chmodSync(bin, 0o755);
    const moteur: Fournisseur = {
      nom: 'docker',
      bin,
      niveau: 'conteneur',
      installation: '',
      garanties: [],
    };
    const repondre = (etiquette: string, code: number): void => {
      writeFileSync(path.join(dir, 'etiquette'), etiquette);
      writeFileSync(path.join(dir, 'code'), String(code));
    };
    const lire = (): Promise<string | null> =>
      etiquetteImage(moteur, 'localhost/hive-agent:local', ETIQUETTE_PORTE);
    repondre('betterleaks=1.9.0 osv-scanner=2.6.0\n', 0);
    expect(await lire()).toBe('betterleaks=1.9.0 osv-scanner=2.6.0');
    repondre('<no value>\n', 0);
    expect(await lire()).toBe('');
    repondre('', 1);
    expect(await lire()).toBeNull();
  });
});
