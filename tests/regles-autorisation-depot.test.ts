// permissions.allow COMPILÉ (G12) — la liste découle LITTÉRALEMENT des
// déclarations du dépôt de base, et argvClaude l'injecte au --settings de G02.

import { describe, expect, it } from 'vitest';
import { argvClaude, REGLAGES_IMPOSES, reglagesImposes } from '../src/adapters/claude-code.js';
import { HIVE_APPROVE_TOOL } from '../src/adapters/delegation-bridge.js';
import { reglesAutorisationDepot } from '../src/shared/validations-bac.js';

describe('reglesAutorisationDepot — le dépôt décide, Hive n’invente rien', () => {
  it('chaque script de validation déclaré donne sa règle exacte et sa règle préfixe', () => {
    const manifeste = {
      scripts: {
        test: 'vitest run',
        build: 'tsc -p tsconfig.json',
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        // Un script hors SCRIPTS_DE_VALIDATION ne donne AUCUNE règle : deviner
        // que `deploy` est une validation serait inventer une commande.
        deploy: 'node scripts/deploy.mjs',
      },
    };
    expect(reglesAutorisationDepot(manifeste)).toEqual([
      'Bash(npm run test)',
      'Bash(npm run test:*)',
      'Bash(npm run typecheck)',
      'Bash(npm run typecheck:*)',
      'Bash(npm run build)',
      'Bash(npm run build:*)',
      'Bash(npm run lint)',
      'Bash(npm run lint:*)',
    ]);
  });

  it('le test par défaut de npm init (qui échoue exprès) n’autorise rien', () => {
    const manifeste = {
      scripts: { test: 'echo "Error: no test specified" && exit 1', build: 'tsc' },
    };
    expect(reglesAutorisationDepot(manifeste)).toEqual([
      'Bash(npm run build)',
      'Bash(npm run build:*)',
    ]);
  });

  it('sans manifeste lisible : aucune règle', () => {
    expect(reglesAutorisationDepot(null)).toEqual([]);
    expect(reglesAutorisationDepot('pas un objet')).toEqual([]);
  });

  it('des dépendances déclarées + un lockfile : l’installation que LE LOCKFILE fixe', () => {
    const manifeste = { scripts: { test: 'vitest run' }, dependencies: { ws: '^8' } };
    expect(reglesAutorisationDepot(manifeste, (f) => f === 'package-lock.json')).toContain(
      'Bash(npm ci)',
    );
    expect(reglesAutorisationDepot(manifeste, (f) => f === 'pnpm-lock.yaml')).toContain(
      'Bash(pnpm install --frozen-lockfile)',
    );
    // Sans lockfile, `npm install` résoudrait des versions que personne n'a
    // choisies : aucune règle d'installation.
    expect(
      reglesAutorisationDepot(manifeste, () => false).some(
        (r) => r.includes('install') || r.includes('npm ci'),
      ),
    ).toBe(false);
  });
});

describe('reglagesImposes — le durcissement G02 survit à l’enrichissement G12', () => {
  it('sans règles : exactement les réglages imposés historiques', () => {
    expect(reglagesImposes()).toBe(REGLAGES_IMPOSES);
    expect(reglagesImposes([])).toBe(REGLAGES_IMPOSES);
  });

  it('avec règles : permissions.allow S’AJOUTE, disableAllHooks reste vrai', () => {
    const regles = ['Bash(npm run test)', 'Bash(npm run test:*)'];
    const reglages = JSON.parse(reglagesImposes(regles)) as {
      disableAllHooks: boolean;
      permissions: { allow: string[] };
    };
    expect(reglages.disableAllHooks).toBe(true);
    expect(reglages.permissions.allow).toEqual(regles);
  });
});

describe('argvClaude — le npm test déclaré passe sans rien demander (critère G12 a)', () => {
  const regles = ['Bash(npm run test)', 'Bash(npm run test:*)'];

  it('les règles compilées voyagent dans le --settings existant de G02', () => {
    const argv = argvClaude(
      'fais',
      'sonnet',
      '/p/mcp.json',
      'hive_1',
      undefined,
      undefined,
      regles,
    );
    const settings = argv[argv.indexOf('--settings') + 1]!;
    expect(JSON.parse(settings)).toEqual({
      disableAllHooks: true,
      permissions: { allow: regles },
    });
    // Les gardes G02 restent intactes à côté de l'enrichissement.
    expect(argv).toContain('--strict-mcp-config');
    expect(argv.slice(argv.indexOf('--setting-sources'))[1]).toBe('user');
    // Le prompt reste strictement dernier, derrière `--` (contrat prompt-argv).
    expect(argv.slice(-2)).toEqual(['--', 'fais']);
  });

  it('l’outil de décision n’est promis que quand le pont porte la capacité', () => {
    const avec = argvClaude(
      'p',
      undefined,
      '/p/mcp.json',
      'hive_1',
      undefined,
      undefined,
      [],
      true,
    );
    expect(avec).toContain('--permission-prompt-tool');
    expect(avec[avec.indexOf('--permission-prompt-tool') + 1]).toBe(
      `mcp__hive_1__${HIVE_APPROVE_TOOL}`,
    );
    expect(avec[avec.indexOf('--allowedTools') + 1]).toContain(`mcp__hive_1__${HIVE_APPROVE_TOOL}`);

    const sans = argvClaude('p', undefined, '/p/mcp.json', 'hive_1');
    expect(sans).not.toContain('--permission-prompt-tool');
    expect(sans[sans.indexOf('--allowedTools') + 1]).not.toContain(HIVE_APPROVE_TOOL);
  });

  it('sans pont MCP : aucun outil de décision, même la capacité en main', () => {
    const argv = argvClaude('p', undefined, undefined, 'hive_1', undefined, undefined, [], true);
    expect(argv).not.toContain('--permission-prompt-tool');
    expect(argv).not.toContain('--allowedTools');
  });
});
