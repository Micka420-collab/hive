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
import { lireDiff } from '../src/shared/caviardage.js';
import {
  ETIQUETTE_PORTE,
  MAX_CONSTATS_PORTE,
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
import type { PorteSecurite, SourceLue } from '../src/shared/porte-securite.js';

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
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      'MIIEvAIBADANBgkqhkiG9w0BAQEF',
      '-----END PRIVATE KEY-----',
    ];
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
    expect(porteSecuriteDepuis(JSON.parse(JSON.stringify(porte)))).toEqual(porte);
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
  ])('REFUSÉ EN ENTIER : %s', (_cas, patch) => {
    expect(porteSecuriteDepuis({ ...porte, ...patch })).toBeNull();
  });

  it('CE QUE LE NŒUD AJOUTERAIT n’est pas recopié — pas même une valeur', () => {
    const bavard = JSON.parse(JSON.stringify(porte)) as Record<string, Record<string, unknown>>;
    (bavard.secrets!.constats as Record<string, unknown>[])[0]!.valeur = SECRETE_AWS;
    bavard.secrets!.extrait = SECRETE_AWS;
    const relu = porteSecuriteDepuis(bavard);
    expect(relu).toEqual(porte);
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
