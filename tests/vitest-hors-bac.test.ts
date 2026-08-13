// LE BAC À SABLE DE LA RUCHE N'EST PAS RAMASSÉ PAR LA SUITE.
//
// ─── CE QUI CLOCHAIT ─────────────────────────────────────────────────────────
//
// Un nœud Hive qui travaille sur ce dépôt copie l'arbre dans
// `.hive-work/tasks/<tâche>/`. La copie emporte `tests/`, mais pas
// `node_modules/` : vitest ramassait donc une deuxième suite, incapable de
// résoudre le moindre import. Mesuré en faisant tourner Hive sur son propre
// code — 507 fichiers de test devenus 731, dont 224 rouges sur des
// `ERR_MODULE_NOT_FOUND` qui ne disaient rien du code sous test.
//
// C'est le pire genre de rouge : il n'apparaît que sur la machine de
// quelqu'un qui a une tâche en cours, jamais en CI, et il noie les vrais
// échecs sous des centaines de lignes de bruit.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Le fichier est LU, pas importé : `vitest.config.ts` est hors du programme
// TypeScript de ce projet (`include: ["src", "tests"]`), et l'y faire entrer
// pour une garde reviendrait à typer la configuration avec les tests.
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = readFileSync(path.join(RACINE, 'vitest.config.ts'), 'utf8');

describe('la configuration de test ignore le bac à sable de la ruche', () => {
  it('`.hive-work` est exclu — sinon la suite se dédouble dès qu’une tâche tourne', () => {
    expect(CONFIG).toMatch(/exclude:\s*\[[^\]]*\.hive-work/);
  });

  it('les exclusions par défaut sont CONSERVÉES, pas remplacées', () => {
    // Sans le déversement, `node_modules/` et `dist/` reviennent dans la suite.
    expect(CONFIG, 'les exclusions par défaut de vitest ont été REMPLACÉES').toMatch(
      /exclude:\s*\[\s*\.\.\.configDefaults\.exclude/,
    );
  });
});
