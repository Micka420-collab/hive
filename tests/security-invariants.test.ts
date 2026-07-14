// Test de garde des invariants de sécurité (master prompt §5). Il ne teste pas un
// comportement mais VERROUILLE des propriétés de tout le code source : il scanne
// src/ et échoue si une régression réintroduit un risque (spawn shell, CORS « * »,
// token trivial). Objectif : qu'aucune modification future ne puisse, par
// inadvertance, affaiblir la sécurité sans faire rougir la CI.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Chemins absolus de tous les .ts sous src/. */
function srcFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(SRC, f));
}

/** Retire commentaires de bloc et de ligne : on VERROUILLE le code réel, pas la
 *  doc (« jamais shell:true » en commentaire ne doit pas déclencher le garde).
 *  Le « [^:] » évite de couper les « :// » des URL dans les chaînes. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = srcFiles();
const content = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));
const read = (f: string): string => content.get(f) ?? '';
/** Contenu du premier fichier dont le chemin se termine par `suffix` (séparateurs normalisés). */
function fileEndingWith(suffix: string): string {
  const match = files.find((f) => f.replace(/\\/g, '/').endsWith(suffix));
  expect(match, `fichier attendu : ${suffix}`).toBeTruthy();
  return match ? read(match) : '';
}

describe('invariants de sécurité (§5)', () => {
  it('scanne effectivement l’arborescence source', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('§5.1 — aucun spawn en shell:true dans src/', () => {
    const offenders = files.filter((f) => /shell\s*:\s*true/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('§5.1 — tout fichier qui appelle spawn() force explicitement shell:false', () => {
    const spawners = files.filter((f) => /\bspawn\s*\(/.test(read(f)));
    expect(spawners.length).toBeGreaterThan(0); // le sondage d'agents / l'exec réelle
    for (const f of spawners) {
      expect(read(f), `${f} appelle spawn sans shell:false`).toMatch(/shell\s*:\s*false/);
    }
  });

  it('§5.1 — le garde d’exécution réelle refuse un token trivial', () => {
    const exec = fileEndingWith('adapters/exec.ts');
    expect(exec).toContain('assertRealExecutionAllowed');
    expect(exec).toContain('DEFAULT_TOKEN');
    expect(exec).toContain('MIN_TOKEN_LENGTH');
  });

  it('§5.1 — chaque adaptateur à exécution réelle passe par ce garde', () => {
    for (const adapter of ['adapters/shell.ts', 'adapters/codex.ts', 'adapters/claude-code.ts']) {
      expect(fileEndingWith(adapter)).toContain('assertRealExecutionAllowed');
    }
  });

  it('§5 — CORS ne vaut jamais « * » ni true, et « * » est explicitement rejeté', () => {
    const server = fileEndingWith('orchestrator/server.ts');
    expect(server).not.toMatch(/origin\s*:\s*['"]\*['"]/); // pas d'origine joker
    expect(server).not.toMatch(/origin\s*:\s*true\b/); // pas de « toutes origines »
    expect(server).toMatch(/corsOrigins\.includes\(\s*['"]\*['"]\s*\)/); // garde présent
  });

  it('§5 — comparaison de token en temps constant + rejet du token trivial', () => {
    const server = fileEndingWith('orchestrator/server.ts');
    expect(server).toContain('timingSafeEqual'); // pas de comparaison naïve ===
    expect(server).toContain('MIN_TOKEN_LENGTH');
    expect(server).toContain('DEFAULT_TOKEN');
  });
});
