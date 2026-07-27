// Configuration Vitest.
//
// Elle n'existe que pour une raison : donner aux tests un `HIVE_JWT_SECRET`.
//
// La ruche refuse de démarrer sans secret de session (voir la garde dans
// `createServer`), et une quarantaine de tests montent un vrai serveur. Poser
// le secret ici, c'est reproduire ce que fait une installation réelle — plutôt
// que d'affaiblir la garde pour arranger les tests.
//
// `tests/jwt-secret.test.ts` retire cette variable lui-même : la garde y est
// donc bien exercée, et la casser rend ce fichier-là rouge.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      HIVE_JWT_SECRET: 'secret-de-session-des-tests-pas-un-secret-reel',
    },
  },
});
