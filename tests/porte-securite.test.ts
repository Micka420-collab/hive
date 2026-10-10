// LA PORTE DE SÉCURITÉ — le module pur : ce qu'il lit des outils, ce qu'il
// compare, et ce qu'il laisse traverser le réseau et le journal.
//
// Les rapports de ce banc ont la forme EXACTE de ceux des vrais outils —
// betterleaks 1.9.0 et osv-scanner 2.6.0, relevés le 4 octobre : champs,
// colonnes en OCTETS, composants d'une règle composite, groupes d'alias, et
// jusqu'aux colonnes de la paire AWS et de la ligne accentuée, reprises des
// rapports réels. Les clés sont ASSEMBLÉES à l'exécution : écrites en clair,
// elles feraient refuser la poussée par la protection des secrets de GitHub.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/orchestrator/evaluator.js';
import type { CrossReviewEvidence, EvaluatorInput } from '../src/orchestrator/evaluator.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { lireDiff } from '../src/shared/caviardage.js';
import {
  CONFIANCE_BETTERLEAKS,
  CONFIG_BETTERLEAKS,
  ETIQUETTE_PORTE,
  MAX_CONSTATS_PORTE,
  formeCaviardable,
  PORTE_SANS_RAPPORT,
  PUBLICATION_OUTIL,
  VALEUR_ETIQUETTE_PORTE,
  VERSION_EPINGLEE,
  lireRapportBetterleaks,
  lireRapportOsv,
  porteSecuriteDepuis,
  valeurDuSecret,
  versionDeSortie,
  voletAvec,
  voletSans,
  vulnerabilitesIntroduites,
} from '../src/shared/porte-securite.js';
import type {
  ConstatDependance,
  PorteSecurite,
  SourceLue,
  VoletPorte,
} from '../src/shared/porte-securite.js';
import { parseClientMessage } from '../src/shared/protocol.js';

const ID_AWS = ['AKIA', 'Z7Q4XWERT2LMNOPQ'].join('');
const SECRETE_AWS = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYzq9Lr3Tn8v'].join('/');
const STRIPE = ['sk', 'live', 'u8jzPde0IgxLd6GncfBAepfJ'].join('_');

/** Les lignes d'un fichier du miroir, à leur numéro. */
const lignes = (...texte: string[]): Map<number, string> =>
  new Map(texte.map((t, i): [number, string] => [i + 1, t]));

/** Une trouvaille, telle que Betterleaks 1.9.0 l'écrit avec `--redact` (champs réels). */
const trouvaille = (o: Record<string, unknown>): Record<string, unknown> => ({
  RuleID: 'aws-access-token',
  Description: 'Identified an AWS access key ID paired with a secret access key.',
  StartLine: 2,
  EndLine: 2,
  StartColumn: 32,
  EndColumn: 51,
  Match: 'REDACTED',
  Secret: 'REDACTED',
  Attributes: { confidence: 'high', path: 'm/secrets/0/config.ts', resource: 'fs.content' },
  Tags: [],
  Fingerprint: 'm/secrets/0/config.ts:aws-access-token:2',
  File: 'm/secrets/0/config.ts',
  SymlinkFile: '',
  Commit: '',
  Entropy: 4.121928,
  Author: '',
  Email: '',
  Date: '',
  Message: '',
  ...o,
});

const COMPOSANT_AWS = {
  RuleID: 'aws-secret-access-key',
  Optional: false,
  StartLine: 3,
  EndLine: 3,
  StartColumn: 17,
  EndColumn: 76,
  Match: "SecretAccessKey = 'REDACTED'",
  Secret: 'REDACTED',
};

describe('Betterleaks — le rapport, lu comme 1.9.0 l’écrit', () => {
  it('UNE PAIRE AWS : l’identifiant ET la clé secrète, rapportée en COMPOSANT sur sa ligne', () => {
    const lu = lireRapportBetterleaks(
      JSON.stringify([trouvaille({ ComponentSets: [{ components: [COMPOSANT_AWS] }] })]),
    );
    expect(lu).toHaveLength(1);
    const [t] = lu ?? [];
    expect(t?.regle).toBe('aws-access-token');
    expect(t?.composants.map((c) => [c.regle, c.debutLigne])).toEqual([
      ['aws-secret-access-key', 3],
    ]);
    // Les colonnes rapportées désignent exactement les valeurs dans les
    // lignes que le nœud a écrites — l'identifiant, puis la clé secrète,
    // dépouillée de ce que `Match` garde autour de `REDACTED`.
    const fichier = lignes(
      "export const region = 'eu-west-3';",
      `export const awsAccessKeyId = '${ID_AWS}';`,
      `export const awsSecretAccessKey = '${SECRETE_AWS}';`,
    );
    expect(t && valeurDuSecret(fichier, t)).toBe(ID_AWS);
    expect(t?.composants[0] && valeurDuSecret(fichier, t.composants[0])).toBe(SECRETE_AWS);
  });

  it('LES COLONNES SONT EN OCTETS UTF-8 — la ligne accentuée du rapport réel', () => {
    const [t] =
      lireRapportBetterleaks(
        JSON.stringify([
          trouvaille({
            RuleID: 'stripe-access-token',
            StartLine: 3,
            EndLine: 3,
            StartColumn: 26,
            EndColumn: 58,
            Match: "REDACTED'",
          }),
        ]),
      ) ?? [];
    const fichier = lignes('', '', `const étéécoleçà = '${STRIPE}'; // gitleaks:allow`);
    // En caractères, la clé commence à la colonne 21 : lue ainsi, on
    // caviarderait le mauvais morceau, et la clé partirait.
    expect(t && valeurDuSecret(fichier, t)).toBe(STRIPE);
  });

  it('UNE CLÉ SUR PLUSIEURS LIGNES se relit en entier', () => {
    const cle = ['PRIVATE', 'KEY'].join(' ');
    const pem = [`-----BEGIN ${cle}-----`, 'MIIEvAIBADANBgkqhkiG9w0BAQEF', `-----END ${cle}-----`];
    const [t] =
      lireRapportBetterleaks(
        JSON.stringify([
          trouvaille({
            RuleID: 'private-key',
            StartLine: 1,
            EndLine: 3,
            StartColumn: 1,
            EndColumn: 25,
          }),
        ]),
      ) ?? [];
    expect(t && valeurDuSecret(lignes(...pem), t)).toBe(pem.join('\n'));
  });

  it('RIEN TROUVÉ est un tableau vide ; un rapport mal formé, ou un composant illisible, n’en est pas un', () => {
    expect(lireRapportBetterleaks('[]')).toEqual([]);
    for (const casse of [
      'null',
      'pas du JSON',
      '{"File": "x"}',
      JSON.stringify([trouvaille({ StartLine: 0 })]),
      JSON.stringify([trouvaille({ EndLine: 1 })]),
      JSON.stringify([trouvaille({ RuleID: 'règle avec espaces' })]),
      JSON.stringify([trouvaille({ ComponentSets: 'pas un tableau' })]),
      JSON.stringify([
        trouvaille({ ComponentSets: [{ components: [{ ...COMPOSANT_AWS, StartLine: 'x' }] }] }),
      ]),
      JSON.stringify([trouvaille({ ComponentSets: [{}] })]),
    ]) {
      expect(lireRapportBetterleaks(casse), casse.slice(0, 60)).toBeNull();
    }
  });

  it('UNE CORRESPONDANCE QUI NE SE RELIT PAS rend null — jamais un morceau au hasard', () => {
    const [t] = lireRapportBetterleaks(JSON.stringify([trouvaille({})])) ?? [];
    expect(t && valeurDuSecret(lignes('une seule ligne'), t)).toBeNull();
    expect(t && valeurDuSecret(lignes('', 'courte'), t)).toBeNull();
  });

  it('LA CONFIANCE DE LA RÈGLE se lit dans `Attributes` ; ses composants n’en portent pas', () => {
    const [haute, basse, muette] =
      lireRapportBetterleaks(
        JSON.stringify([
          trouvaille({ ComponentSets: [{ components: [COMPOSANT_AWS] }] }),
          trouvaille({
            RuleID: 'generic-password',
            Attributes: { confidence: 'low', path: 'm/secrets/1/AccountPanel.tsx' },
          }),
          trouvaille({ Attributes: undefined }),
        ]),
      ) ?? [];
    expect(haute?.confiance).toBe('high');
    expect(basse?.confiance).toBe('low');
    expect(muette?.confiance).toBeNull();
  });

  it('LA CONFIGURATION IMPOSÉE garde les règles par défaut et ÉTEINT leur préfiltre', () => {
    expect(CONFIG_BETTERLEAKS).toMatch(/^prefilter = '''false'''$/m);
    expect(CONFIG_BETTERLEAKS).toMatch(/^\[extend\]\nuseDefault = true$/m);
    expect(CONFIANCE_BETTERLEAKS).toBe('high');
  });

  it('SEULE UNE FORME DE JETON SE CAVIARDE PARTOUT — jamais un mot, ni l’en-tête d’une clé PEM', () => {
    for (const jeton of [ID_AWS, SECRETE_AWS, STRIPE, 'MIIEvAIBADANBgkqhkiG9w0BAQEF']) {
      expect(formeCaviardable(jeton), jeton.slice(0, 6)).toBe(true);
    }
    // Ce qu'une règle générique lisait comme un mot de passe, l'en-tête d'une
    // clé, un fragment trop court : réécrits partout, ils corrompaient du code.
    for (const forme of [
      'new-password',
      `-----BEGIN ${'PRIVATE'} KEY-----`,
      'AB12cd==',
      'un mot de passe assez long',
    ]) {
      expect(formeCaviardable(forme), forme).toBe(false);
    }
  });
});

/** Un rapport d'osv-scanner 2.6.0 (`--format json`), sources absolues comme l'outil les écrit. */
const rapportOsv = (results: unknown[]): string =>
  JSON.stringify({
    results,
    experimental_config: { licenses: { summary: false, allowlist: null } },
  });

const vuln = (id: string, aliases: string[], severity: string, summary: string) => ({
  modified: '2026-03-13T22:11:59.523514Z',
  published: '2022-03-18T00:01:09Z',
  schema_version: '1.9.0',
  id,
  aliases,
  summary,
  details: summary,
  affected: [],
  references: [],
  database_specific: { cwe_ids: ['CWE-1321'], github_reviewed: true, severity },
  severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', type: 'CVSS_V3' }],
});

const LODASH = {
  package: { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
  groups: [
    {
      ids: ['GHSA-35jh-r3h4-6jhm', 'GHSA-r5fr-rjxr-66jc'],
      aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-35jh-r3h4-6jhm', 'GHSA-r5fr-rjxr-66jc'],
      max_severity: '8.1',
    },
  ],
  vulnerabilities: [
    vuln(
      'GHSA-35jh-r3h4-6jhm',
      ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc'],
      'HIGH',
      'Command Injection in lodash',
    ),
  ],
};

const MINIMIST = {
  package: { name: 'minimist', version: '1.2.0', ecosystem: 'npm' },
  groups: [
    {
      ids: ['GHSA-xvch-5gv4-984h'],
      aliases: ['CVE-2021-44906', 'GHSA-xvch-5gv4-984h'],
      max_severity: '9.8',
    },
  ],
  vulnerabilities: [
    vuln('GHSA-xvch-5gv4-984h', ['CVE-2021-44906'], 'CRITICAL', 'Prototype Pollution in minimist'),
  ],
};

const source = (chemin: string, packages: unknown[]) => ({
  source: { path: chemin, type: 'lockfile' },
  packages,
});

describe('osv-scanner — le rapport, et ce que la tête INTRODUIT', () => {
  const lu = lireRapportOsv(
    rapportOsv([
      source('/travail/t/.hive-porte-x/dependances/base/0/package-lock.json', [LODASH]),
      source('/travail/t/.hive-porte-x/dependances/tete/0/package-lock.json', [LODASH, MINIMIST]),
    ]),
  );

  it('LIT LE RAPPORT RÉEL : sources, paquets, avis, alias et gravité', () => {
    expect(lu?.map((s) => s.paquets.map((p) => `${p.nom}@${p.version}`))).toEqual([
      ['lodash@4.17.20'],
      ['lodash@4.17.20', 'minimist@1.2.0'],
    ]);
    expect(lu?.[1]?.paquets[1]?.vulnerabilites[0]).toEqual({
      id: 'GHSA-xvch-5gv4-984h',
      alias: ['CVE-2021-44906'],
      resume: 'Prototype Pollution in minimist',
      gravite: 'CRITICAL',
    });
  });

  it('SEULES LES VULNÉRABILITÉS INTRODUITES COMPTENT — celles de la base ne bloquent rien', () => {
    const [base, tete] = lu as SourceLue[];
    const introduites = vulnerabilitesIntroduites(base ? [base] : [], [
      { fichier: 'package-lock.json', source: tete as SourceLue },
    ]);
    expect(introduites).toEqual([
      {
        genre: 'vulnerabilite',
        paquet: 'minimist',
        version: '1.2.0',
        ecosysteme: 'npm',
        avis: 'GHSA-xvch-5gv4-984h',
        alias: ['CVE-2021-44906'],
        gravite: 'CRITICAL',
        resume: 'Prototype Pollution in minimist',
        fichier: 'package-lock.json',
      },
    ]);
  });

  it('UNE MONTÉE DE VERSION QUI GARDE LE MÊME AVIS n’introduit rien', () => {
    const avant = { ...LODASH, package: { ...LODASH.package, version: '4.17.19' } };
    const [base, tete] =
      lireRapportOsv(
        rapportOsv([
          source('/b/package-lock.json', [avant]),
          source('/t/package-lock.json', [LODASH]),
        ]),
      ) ?? [];
    expect(
      vulnerabilitesIntroduites(
        [base as SourceLue],
        [{ fichier: 'package-lock.json', source: tete as SourceLue }],
      ),
    ).toEqual([]);
  });

  it('LA GRAVITÉ MANQUANTE se lit dans le groupe d’alias, sinon reste null', () => {
    const sansGravite = {
      ...MINIMIST,
      vulnerabilities: [{ ...MINIMIST.vulnerabilities[0], database_specific: {} }],
    };
    const [s] = lireRapportOsv(rapportOsv([source('/t/package-lock.json', [sansGravite])])) ?? [];
    expect(s?.paquets[0]?.vulnerabilites[0]?.gravite).toBe('9.8');
    const sansRien = { ...sansGravite, groups: [] };
    const [r] = lireRapportOsv(rapportOsv([source('/t/package-lock.json', [sansRien])])) ?? [];
    expect(r?.paquets[0]?.vulnerabilites[0]?.gravite).toBeNull();
  });

  it('OSV.DEV INJOIGNABLE : le rapport est VIDE et valide — c’est le code de sortie qui juge', () => {
    // Mesuré sur 2.6.0 : sortie 127, et ce rapport-là. Lu seul, il dirait
    // « rien trouvé » ; le nœud ne le croit qu'avec un code 0 ou 1.
    expect(lireRapportOsv(rapportOsv([]))).toEqual([]);
    for (const casse of [
      '{}',
      'null',
      '[]',
      rapportOsv([{ source: {} }]),
      rapportOsv([source('/t', [{}])]),
    ]) {
      expect(lireRapportOsv(casse), casse.slice(0, 60)).toBeNull();
    }
  });
});

describe('ce qui traverse le réseau et le journal — reconstruit, validé FERMÉ', () => {
  const porte: PorteSecurite = {
    secrets: voletAvec(
      [
        { regle: 'aws-access-token', fichier: 'src/config.ts', ligne: 2 },
        { regle: 'aws-secret-access-key', fichier: 'src/config.ts', ligne: 3 },
      ],
      { nom: 'betterleaks', version: '1.9.0' },
    ),
    dependances: voletSans('analyse_propre', { nom: 'osv-scanner', version: '2.6.0' }),
  };

  it('UN RAPPORT BIEN FORMÉ passe tel quel', () => {
    expect(porteSecuriteDepuis(JSON.parse(JSON.stringify(porte)))).toEqual({ porte, rejetes: [] });
  });

  it('LES NOUVELLES FORMES DU VOLET DÉPENDANCES passent : lockfile illisible, paquets non interrogés', () => {
    const riche: PorteSecurite = {
      ...porte,
      dependances: {
        ...voletAvec<ConstatDependance>(
          [
            { genre: 'lockfile_illisible', fichier: 'package-lock.json', motif: 'mal_forme' },
            {
              genre: 'vulnerabilite',
              paquet: 'minimist',
              version: '1.2.0',
              ecosysteme: 'npm',
              avis: 'GHSA-xvch-5gv4-984h',
              alias: ['CVE-2021-44906'],
              gravite: 'CRITICAL',
              resume: 'Prototype Pollution in minimist',
              fichier: 'web/package-lock.json',
            },
          ],
          { nom: 'osv-scanner', version: '2.6.0' },
        ),
        nonInterroges: 3,
      },
    };
    expect(porteSecuriteDepuis(JSON.parse(JSON.stringify(riche)))).toEqual({
      porte: riche,
      rejetes: [],
    });
  });

  it('SANS RAPPORT, la porte n’est jamais verte', () => {
    expect(PORTE_SANS_RAPPORT.secrets).toMatchObject({
      etat: 'non_verifie',
      raison: 'rapport_absent',
    });
    expect(PORTE_SANS_RAPPORT.dependances).toMatchObject({
      etat: 'non_verifie',
      raison: 'rapport_absent',
    });
  });

  it.each([
    ['un état qui contredit sa raison', { secrets: { ...porte.secrets, etat: 'rien_trouve' } }],
    ['un constat sans rien de trouvé', { secrets: { ...porte.secrets, constats: [], total: 0 } }],
    [
      'des trouvailles sous un « rien »',
      { dependances: { ...porte.dependances, constats: porte.secrets.constats, total: 2 } },
    ],
    ['une raison inconnue', { dependances: { ...porte.dependances, raison: 'tout_va_bien' } }],
    [
      'l’outil d’un autre volet',
      { dependances: { ...porte.dependances, outil: { nom: 'betterleaks', version: '1.9.0' } } },
    ],
    [
      'une version d’outil qui n’en est pas une',
      { secrets: { ...porte.secrets, outil: { nom: 'betterleaks', version: '$(id)' } } },
    ],
    ['un total plus petit que les constats', { secrets: { ...porte.secrets, total: 1 } }],
    [
      'plus de constats que la borne',
      {
        secrets: {
          ...porte.secrets,
          constats: Array.from({ length: MAX_CONSTATS_PORTE + 1 }, (_, i) => ({
            regle: 'r',
            fichier: 'f',
            ligne: i + 1,
          })),
          total: MAX_CONSTATS_PORTE + 1,
        },
      },
    ],
    [
      'un texte tiers sur deux lignes',
      {
        secrets: {
          ...porte.secrets,
          constats: [{ regle: 'r', fichier: 'a\nb', ligne: 1 }],
          total: 1,
        },
      },
    ],
    ['un volet manquant', { dependances: undefined }],
    [
      'un constat de dépendance d’un genre inconnu',
      {
        dependances: {
          ...porte.dependances,
          etat: 'constat',
          raison: 'trouve',
          constats: [{ genre: 'rumeur', fichier: 'package-lock.json' }],
          total: 1,
        },
      },
    ],
    [
      'une version vide — le nœud ne l’écrit plus (« ? »)',
      {
        dependances: {
          ...porte.dependances,
          etat: 'constat',
          raison: 'trouve',
          constats: [
            {
              genre: 'vulnerabilite',
              paquet: 'x',
              version: '',
              ecosysteme: 'npm',
              avis: 'GHSA-xvch-5gv4-984h',
              alias: [],
              gravite: null,
              resume: '',
              fichier: 'package-lock.json',
            },
          ],
          total: 1,
        },
      },
    ],
    [
      'un compte de paquets non interrogés à zéro',
      { dependances: { ...porte.dependances, nonInterroges: 0 } },
    ],
    [
      'des paquets non interrogés sous le volet secrets',
      { secrets: { ...porte.secrets, nonInterroges: 2 } },
    ],
  ])('REFUSÉ — CE VOLET SEUL, l’autre tient : %s', (_cas, patch) => {
    const relue = porteSecuriteDepuis({ ...porte, ...patch });
    const [touche] = Object.keys(patch) as ('secrets' | 'dependances')[];
    expect(relue.rejetes).toEqual([touche]);
    expect(relue.porte[touche!]).toEqual({
      etat: 'non_verifie',
      raison: 'rapport_rejete',
      constats: [],
      total: 0,
    });
    // Un volet mal formé n'efface plus le constat d'un secret : l'autre tient.
    const autre = touche === 'secrets' ? 'dependances' : 'secrets';
    expect(relue.porte[autre]).toEqual(porte[autre]);
  });

  it('UN RAPPORT QUI N’EST PAS UN OBJET : les DEUX volets refusés — jamais « rien trouvé »', () => {
    for (const casse of [null, 'rien', 42, []]) {
      const relue = porteSecuriteDepuis(casse);
      expect(relue.rejetes).toEqual(['secrets', 'dependances']);
      expect(relue.porte.secrets.raison).toBe('rapport_rejete');
    }
  });

  it('CE QUE LE NŒUD AJOUTERAIT n’est pas recopié — pas même une valeur', () => {
    const bavard = JSON.parse(JSON.stringify(porte)) as Record<string, Record<string, unknown>>;
    (bavard.secrets!.constats as Record<string, unknown>[])[0]!.valeur = SECRETE_AWS;
    bavard.secrets!.extrait = SECRETE_AWS;
    const relu = porteSecuriteDepuis(bavard);
    expect(relu).toEqual({ porte, rejetes: [] });
    expect(JSON.stringify(relu)).not.toContain(SECRETE_AWS);
  });
});

describe('les outils épinglés — le Dockerfile, la table, l’étiquette', () => {
  const dockerfile = readFileSync(
    path.join(import.meta.dirname, '..', 'docker', 'agents', 'Dockerfile'),
    'utf8',
  );
  const arg = (nom: string): string | undefined =>
    new RegExp(`^ARG ${nom}=(.*)$`, 'm').exec(dockerfile)?.[1]?.trim();

  it('L’IMAGE ÉPINGLE LES VERSIONS DE `VERSION_EPINGLEE`, et une empreinte SHA-256 par architecture', () => {
    // Le docteur conseille ces versions, et les rapports ont été éprouvés sur
    // elles : une image qui en porte d'autres se verrait ici.
    expect(arg('BETTERLEAKS_VERSION')).toBe(VERSION_EPINGLEE.betterleaks);
    expect(arg('OSV_SCANNER_VERSION')).toBe(VERSION_EPINGLEE['osv-scanner']);
    const empreintes = [
      'BETTERLEAKS_SHA256_AMD64',
      'BETTERLEAKS_SHA256_ARM64',
      'OSV_SCANNER_SHA256_AMD64',
      'OSV_SCANNER_SHA256_ARM64',
    ].map(arg);
    for (const e of empreintes) expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(empreintes).size).toBe(4);
    // Vérifiées avant d'être installées, et une empreinte vide arrête tout.
    expect(dockerfile).toContain(
      '| sha256sum -c -; \\\n  tar -xzf betterleaks.tar.gz betterleaks;',
    );
    expect(dockerfile).toContain('echo "${osv_sha}  osv-scanner" | sha256sum -c -;');
    expect(dockerfile).toContain('if [ -z "$bl_sha" ] || [ -z "$osv_sha" ]; then');
  });

  it('LES BINAIRES VIENNENT DES RELEASES OFFICIELLES — celles que le docteur conseille', () => {
    for (const { depot } of Object.values(PUBLICATION_OUTIL)) {
      expect(dockerfile).toContain(`https://github.com/${depot}/releases/download/v`);
    }
  });

  it('L’ÉTIQUETTE que lit le docteur dit les versions installées — et vient APRÈS leur vérification', () => {
    const etiquette = new RegExp(`^LABEL ${ETIQUETTE_PORTE.replace('.', '\\.')}="(.*)"$`, 'm').exec(
      dockerfile,
    );
    const valeur = etiquette?.[1]
      ?.replace('${BETTERLEAKS_VERSION}', arg('BETTERLEAKS_VERSION') ?? '')
      .replace('${OSV_SCANNER_VERSION}', arg('OSV_SCANNER_VERSION') ?? '');
    expect(valeur).toBe(VALEUR_ETIQUETTE_PORTE);
    expect(dockerfile.indexOf('LABEL hive.porte-securite')).toBeGreaterThan(
      dockerfile.indexOf('osv-scanner --version'),
    );
  });

  it('LA VERSION se lit dans ce que chaque outil imprime réellement', () => {
    expect(versionDeSortie('betterleaks version 1.9.0\n')).toBe('1.9.0');
    expect(
      versionDeSortie(
        'osv-scanner version: 2.6.0\nosv-scalibr version: 0.5.2\ncommit: e840a6e8\nbuilt at: 2026-09-14T01:44:58Z\n',
      ),
    ).toBe('2.6.0');
    expect(versionDeSortie('command not found')).toBeNull();
  });
});

describe('lireDiff — les lignes AJOUTÉES, à leur numéro dans le fichier d’après', () => {
  it('compte les hunks par leurs en-têtes, pas par le premier caractère', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' un',
      '-deux',
      '+DEUX',
      '+++ trois', // dans un hunk : une ligne AJOUTÉE « ++ trois »
      ' quatre',
      '@@ -10,2 +11,2 @@',
      ' dix',
      '-onze',
      '+ONZE',
      'diff --git a/package-lock.json b/package-lock.json',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/package-lock.json',
      '@@ -0,0 +1 @@',
      '+{}',
      '',
    ].join('\n');
    const { fichiers, ajoutees } = lireDiff(diff);
    expect(fichiers).toEqual([
      { avant: 'src/a.ts', apres: 'src/a.ts' },
      { avant: null, apres: 'package-lock.json' },
    ]);
    expect(ajoutees.map((a) => [a.fichier, a.numero, a.texte])).toEqual([
      ['src/a.ts', 2, 'DEUX'],
      ['src/a.ts', 3, '++ trois'],
      ['src/a.ts', 12, 'ONZE'],
      ['package-lock.json', 1, '{}'],
    ]);
  });

  it('rend les chemins que git CITE — accents en octets échappés, espace suffixée d’une tabulation', () => {
    const diff = [
      'diff --git "a/r\\303\\251sum\\303\\251.md" "b/r\\303\\251sum\\303\\251.md"',
      '--- "a/r\\303\\251sum\\303\\251.md"',
      '+++ "b/r\\303\\251sum\\303\\251.md"',
      '@@ -0,0 +1 @@',
      '+été',
      'diff --git a/c d.txt b/c d.txt',
      '--- a/c d.txt\t',
      '+++ b/c d.txt\t',
      '@@ -0,0 +1 @@',
      '+x',
    ].join('\n');
    expect(lireDiff(diff).fichiers.map((f) => f.apres)).toEqual(['résumé.md', 'c d.txt']);
  });
});

// ─── L'Evaluator : où la porte se place parmi ses règles ─────────────────────

/** Une contre-revue favorable d'une AUTRE famille : sans elle, rien n'est `accepted`. */
const favorable: CrossReviewEvidence = {
  source: 'hive_counter_review',
  taskId: 't',
  resultId: 1,
  status: 'applied',
  decision: 'appliquer',
  reviewers: [
    {
      relectureTaskId: 'r-1',
      reviewerNodeId: 'n2',
      reviewerAgent: 'codex',
      producerAgent: 'claude-code',
      decision: 'appliquer',
      reason: '',
      recordedAt: 1,
    },
  ],
  objections: [],
  findings: [],
  reviewerCount: 1,
  contestingReviewers: 0,
  approvingReviewers: 1,
  recordedAt: 1,
};

/** La production que tout accepte : chaque cas n'en change qu'une chose. */
const accepte: EvaluatorInput = {
  taskId: 't',
  taskStatus: 'done',
  results: [
    {
      taskId: 't',
      nodeId: 'n1',
      resultId: 1,
      diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-a\n+b',
      logs: '',
      success: true,
      durationMs: 12,
      subAgents: [],
    },
  ],
  inspection: { verdict: 'clean', score: 0, griefs: [] },
  validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
  crossReview: favorable,
};

const passee: PorteSecurite = {
  secrets: voletSans('analyse_propre', { nom: 'betterleaks', version: '1.9.0' }),
  dependances: voletSans('aucun_lockfile'),
};
const avecSecret: PorteSecurite = {
  ...passee,
  secrets: voletAvec([{ regle: 'aws-access-token', fichier: 'src/config.ts', ligne: 2 }], {
    nom: 'betterleaks',
    version: '1.9.0',
  }),
};

describe('l’Evaluator — la porte parmi ses règles', () => {
  it('UNE PORTE PASSÉE est dite dans les motifs d’`accepted`', () => {
    const v = evaluate({ ...accepte, securite: { porte: passee, nodeId: 'n1' } });
    expect(v.decision).toBe('accepted');
    expect(v.reasons).toContain(
      'porte de sécurité passée : secrets — rien trouvé (betterleaks 1.9.0) ; ' +
        'dépendances — aucun lockfile touché (osv-scanner)',
    );
  });

  it('NON VÉRIFIÉE, HORS DE `strict` : rien n’est retenu — mais jamais comptée verte, et dit', () => {
    const v = evaluate(accepte);
    expect(v.decision).toBe('accepted');
    expect(v.evidence.securite).toEqual(PORTE_SANS_RAPPORT);
    const motif = v.reasons.find((r) => r.startsWith('porte de sécurité'));
    expect(motif).toContain('porte de sécurité non vérifiée');
    expect(motif).toContain('jamais comptée verte');
    expect(v.reasons.join(' ')).not.toContain('porte de sécurité passée');
  });

  it('EN `strict`, UNE PORTE VÉRIFIÉE ne retient rien', () => {
    const v = evaluate({
      ...accepte,
      securite: { porte: passee, nodeId: 'n1' },
      securiteStricte: true,
    });
    expect(v.decision).toBe('accepted');
  });

  it('UN CONSTAT PASSE AVANT L’APPROBATION HUMAINE — une approbation ne laisse pas partir une clé', () => {
    const v = evaluate({
      ...accepte,
      humanReview: 'approved',
      securite: { porte: avecSecret, nodeId: 'n1' },
    });
    expect(v.decision).toBe('correction_required');
    expect(v.canMerge).toBe(false);
    expect(v.retryRecommended).toBe(true);
    expect(v.reasons[1]).toBe(
      'secrets, valeurs caviardées par le nœud et jamais transmises : aws-access-token src/config.ts:2',
    );
  });

  it('…ET AVANT LES GARDIENNES SUSPECTES : le défaut constaté est nommé d’abord', () => {
    const v = evaluate({
      ...accepte,
      inspection: { verdict: 'suspect', score: 1, griefs: [] },
      securite: { porte: avecSecret, nodeId: 'n1' },
    });
    expect(v.reasons[0]).toMatch(/^la porte de sécurité a trouvé 1 secret\(s\) ajouté\(s\)/);
  });

  it('UN RÉSULTAT EN ÉCHEC reste rejeté — et le secret qu’il ajoutait est nommé, pour la correction', () => {
    const [ok] = accepte.results;
    const v = evaluate({
      ...accepte,
      results: [{ ...ok!, success: false }],
      securite: { porte: avecSecret, nodeId: 'n1' },
    });
    expect(v.decision).toBe('rejected');
    expect(v.reasons[0]).toBe('le dernier résultat a échoué');
    expect(v.reasons[1]).toMatch(/^la porte de sécurité a trouvé 1 secret\(s\) ajouté\(s\)/);
    // Sans constat, l'échec reste seul.
    expect(evaluate({ ...accepte, results: [{ ...ok!, success: false }] }).reasons).toEqual([
      'le dernier résultat a échoué',
    ]);
  });

  it('CE QUE LA BORNE DU PROTOCOLE A LAISSÉ TOMBER est compté, pas tu', () => {
    const constats = Array.from({ length: MAX_CONSTATS_PORTE + 5 }, (_, i) => ({
      regle: 'generic-api-key',
      fichier: 'src/a.ts',
      ligne: i + 1,
    }));
    const v = evaluate({
      ...accepte,
      securite: { porte: { ...passee, secrets: voletAvec(constats) }, nodeId: 'n1' },
    });
    expect(v.reasons[0]).toContain('25 secret(s) ajouté(s)');
    expect(v.reasons[1]).toMatch(/ ; … et 5 autre\(s\)$/);
  });
});

// ─── Le protocole et la base : ce qu'un nœud envoie n'est cru qu'après relecture

const resultat = (porteSecurite: unknown): unknown =>
  parseClientMessage(
    JSON.stringify({
      type: 'task_result',
      taskId: 't1',
      success: true,
      diff: 'diff --git a/x b/x',
      logs: '',
      durationMs: 5,
      subAgents: [],
      porteSecurite,
    }),
  );

describe('le protocole et la base — ADDITIF, validé fermé', () => {
  it('task_result : un rapport bien formé passe ; un volet mal formé est refusé SEUL, et le refus est rendu', () => {
    expect(resultat(avecSecret)).toMatchObject({ type: 'task_result', porteSecurite: avecSecret });
    expect(resultat(avecSecret)).not.toHaveProperty('porteSecuriteRejetee');
    // Le volet dépendances mal formé : le constat du secret TIENT.
    const casse = resultat({
      ...avecSecret,
      dependances: { ...avecSecret.dependances, etat: 'constat' },
    });
    expect(casse).toMatchObject({
      type: 'task_result',
      taskId: 't1',
      success: true,
      porteSecurite: {
        secrets: avecSecret.secrets,
        dependances: { etat: 'non_verifie', raison: 'rapport_rejete' },
      },
      porteSecuriteRejetee: ['dependances'],
    });
    // Un nœud antérieur à la porte n'envoie rien : le message reste valide.
    expect(resultat(undefined)).not.toHaveProperty('porteSecurite');
    // Le refus n'est jamais lu du réseau : un nœud ne peut pas en annoncer un.
    const annonce = parseClientMessage(
      JSON.stringify({
        type: 'task_result',
        taskId: 't1',
        success: true,
        diff: '',
        logs: '',
        durationMs: 5,
        subAgents: [],
        porteSecurite: avecSecret,
        porteSecuriteRejetee: ['secrets'],
      }),
    );
    expect(annonce).not.toHaveProperty('porteSecuriteRejetee');
  });

  it('UN VOLET REFUSÉ EST JOURNALISÉ par la Reine — de quel nœud, sur quel résultat, lequel', () => {
    const store = new HiveStore(':memory:');
    const scheduler = new Scheduler(store);
    try {
      const noeud = scheduler.registerNode({
        name: 'n',
        ownerName: 'banc',
        agentType: 'shell',
        maxConcurrency: 1,
      });
      const projet = store.createProject({ name: 'P' });
      const tache = store.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
      store.patchTask(tache.id, { status: 'ready' });
      scheduler.tick(1_000);
      const lu = resultat({
        ...avecSecret,
        dependances: { ...avecSecret.dependances, etat: 'constat' },
      }) as { porteSecurite: PorteSecurite; porteSecuriteRejetee: VoletPorte[] };
      expect(
        scheduler.handleTaskResult(noeud.id, {
          taskId: tache.id,
          success: true,
          diff: 'diff --git a/x b/x',
          logs: '',
          durationMs: 5,
          subAgents: [],
          porteSecurite: lu.porteSecurite,
          porteSecuriteRejetee: lu.porteSecuriteRejetee,
        }),
      ).toBe(true);
      const resultId = store.resultsForTask(tache.id).at(-1)?.resultId;
      const [refus] = store.evenementsDeTache(tache.id, ['security_gate_rejected']);
      expect(refus?.payload).toMatchObject({
        taskId: tache.id,
        resultId,
        nodeId: noeud.id,
        volets: ['dependances'],
      });
      // Et ce qui est rangé garde le constat du secret.
      expect(store.porteSecuriteDe(tache.id, resultId ?? 0)?.porte.secrets).toEqual(
        avecSecret.secrets,
      );
    } finally {
      store.close();
    }
  });

  it('la base relit le fait par les mêmes règles — un volet altéré devient « rapport refusé », l’autre tient', () => {
    const store = new HiveStore(':memory:');
    const fait = (porte: unknown, nodeId = 'n1') =>
      store.appendEvent('security_gate_recorded', {
        taskId: 't1',
        projectId: 'p1',
        resultId: 7,
        nodeId,
        porte,
        recordedAt: 1_000,
      });
    fait(avecSecret);
    expect(store.porteSecuriteDe('t1', 7)).toEqual({
      porte: avecSecret,
      nodeId: 'n1',
      recordedAt: 1_000,
    });
    // Le fait d'un AUTRE résultat ne parle pas de celui-ci.
    expect(store.porteSecuriteDe('t1', 8)).toBeNull();
    // Le plus récent l'emporte — et son volet altéré n'est jamais vert.
    fait({ ...avecSecret, secrets: { ...avecSecret.secrets, etat: 'rien_trouve' } });
    expect(store.porteSecuriteDe('t1', 7)?.porte).toEqual({
      secrets: { etat: 'non_verifie', raison: 'rapport_rejete', constats: [], total: 0 },
      dependances: avecSecret.dependances,
    });
    fait(passee, '');
    expect(store.porteSecuriteDe('t1', 7)).toBeNull();
    store.close();
  });
});
