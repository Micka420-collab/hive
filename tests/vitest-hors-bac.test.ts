// `.hive-work` ne doit pas être ramassé par la suite.
//
// Un nœud copie l'arbre dans `.hive-work/tasks/<tâche>/` — tests inclus,
// node_modules exclus. Sans cette garde, `npm test` pendant une tâche Hive
// double la suite et rougit sur ERR_MODULE_NOT_FOUND.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = readFileSync(path.join(RACINE, 'vitest.config.ts'), 'utf8');

describe('la suite ignore le bac à sable de la ruche', () => {
  it('exclut .hive-work ET garde les exclusions par défaut', () => {
    expect(CONFIG, 'configDefaults.exclude perdu : node_modules reviendrait').toContain(
      'configDefaults.exclude',
    );
    expect(CONFIG).toMatch(/\.hive-work/);
  });
});
