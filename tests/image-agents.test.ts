// L'image docker/agents installe un arbre ÉPINGLÉ — pas seulement trois CLI.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// L'image installait les CLI par `npm install --global <cli>@<version>` : les
// CLI étaient épinglés, leurs dépendances transitives NON (un global ne lit
// aucun lockfile). Le 25 septembre, la construction a cassé sur main et sur
// toutes les PR ouvertes sans qu'une ligne du dépôt change : `cline@3.0.65` a
// tiré `@ai-sdk/openai@4.0.77`, publiée à l'instant et pas encore servie par le
// registre. L'arbre complet vit maintenant dans docker/agents/package-lock.json
// et l'image l'installe par `npm ci`.
//
// Ces bancs ne construisent pas l'image (la jambe CI « L'image se construit »
// le fait, avec les sondes `--version` et le preflight durci) : ils gardent le
// CONTRAT qui rend cette construction reproductible.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = path.resolve(import.meta.dirname, '..');
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

const DOCKERFILE = lire('docker/agents/Dockerfile');
/** Les instructions seules : le commentaire raconte l'ancien `npm install --global`. */
const INSTRUCTIONS = DOCKERFILE.split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');
const PAQUET = JSON.parse(lire('docker/agents/package.json')) as {
  dependencies: Record<string, string>;
};
const VERROU = JSON.parse(lire('docker/agents/package-lock.json')) as {
  packages: Record<
    string,
    {
      version?: string;
      integrity?: string;
      link?: boolean;
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
    }
  >;
};

/** Les CLI que la jambe CI sonde dans le bac (tests/isolement-runtime.integration.test.ts). */
const CLI_SONDES: Record<string, string> = {
  '@anthropic-ai/claude-code': 'claude',
  '@openai/codex': 'codex',
  cline: 'cline',
};

describe('l’image docker/agents — un arbre épinglé', () => {
  it('ELLE INSTALLE PAR `npm ci` DEPUIS LE LOCK — jamais par un global qui n’en lit aucun', () => {
    expect(INSTRUCTIONS).toMatch(
      /COPY docker\/agents\/package\.json docker\/agents\/package-lock\.json/,
    );
    expect(INSTRUCTIONS).toMatch(/\bnpm ci\b/);
    expect(INSTRUCTIONS, 'un `npm install --global` ne lit aucun lockfile').not.toMatch(
      /npm install (--global|-g)\b/,
    );
  });

  it('LE LOCK ÉPINGLE EXACTEMENT LES VERSIONS DU PAQUET', () => {
    const racine = VERROU.packages['']?.dependencies ?? {};
    expect(racine).toEqual(PAQUET.dependencies);
    for (const [nom, version] of Object.entries(PAQUET.dependencies)) {
      expect(version, `${nom} doit être une version exacte`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(VERROU.packages[`node_modules/${nom}`]?.version, nom).toBe(version);
    }
  });

  it('CHAQUE PAQUET VERROUILLÉ PORTE SON EMPREINTE D’INTÉGRITÉ', () => {
    const sansEmpreinte = Object.entries(VERROU.packages)
      .filter(([cle, p]) => cle !== '' && !p.link && !p.integrity)
      .map(([cle]) => cle);
    expect(sansEmpreinte).toEqual([]);
  });

  it('CHAQUE CLI SONDÉ EST DANS LE LOCK, AVEC SON BINAIRE', () => {
    for (const [nom, bin] of Object.entries(CLI_SONDES)) {
      expect(PAQUET.dependencies[nom], `${nom} manque au paquet de l’image`).toBeTruthy();
      expect(
        VERROU.packages[`node_modules/${nom}`]?.bin?.[bin],
        `${nom} ne fournit pas « ${bin} »`,
      ).toBeTruthy();
    }
    // …et c'est bien le PATH de l'image qui les rend joignables.
    expect(INSTRUCTIONS).toMatch(/PATH=\/opt\/hive-agents\/node_modules\/\.bin:\$PATH/);
  });
});
