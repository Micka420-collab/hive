import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  fournisseurParNom,
  IMAGE_DEFAUT,
  sonderAgentDansBac,
  type Fournisseur,
} from '../src/node-client/isolement.js';

function runtimeDisponible(): Fournisseur | null {
  for (const nom of ['podman', 'docker']) {
    try {
      execFileSync(nom, ['--version'], { stdio: 'ignore', timeout: 4_000 });
      execFileSync(nom, ['info'], { stdio: 'ignore', timeout: 8_000 });
      return fournisseurParNom(nom);
    } catch {
      // Le test reste conditionnel : une CI sans runtime ne doit pas inventer
      // un résultat d'intégration qu'elle n'a pas exécuté.
    }
  }
  return null;
}

const runtime = runtimeDisponible();

describe('isolement — intégration runtime réel', () => {
  it.skipIf(!runtime)(
    'exécute réellement le preflight dans Docker/Podman',
    async () => {
      const node = await sonderAgentDansBac(runtime!, 'node', IMAGE_DEFAUT);
      expect(node.executable).toBe(true);

      const absent = await sonderAgentDansBac(runtime!, 'hive-agent-inexistant', IMAGE_DEFAUT);
      expect(absent.executable).toBe(false);
    },
    120_000,
  );
});
