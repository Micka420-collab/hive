import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  fournisseurParNom,
  IMAGE_DEFAUT,
  sonderAgentDansBac,
  type Fournisseur,
} from '../src/node-client/isolement.js';

const imageDemandee = process.env.HIVE_ISOLEMENT_IMAGE?.trim() || '';

function runtimeDisponible(): Fournisseur | null {
  // Docker Desktop on the hosted Windows runner exposes the CLI but does not
  // provide a bind mount compatible with this Linux-container probe. Keep the
  // real integration lane active on Unix hosts and report Windows as
  // unavailable instead of turning infrastructure limits into a false failure.
  if (process.platform === 'win32') return null;
  for (const nom of ['podman', 'docker']) {
    try {
      execFileSync(nom, ['--version'], { stdio: 'ignore', timeout: 4_000 });
      execFileSync(nom, ['info'], { stdio: 'ignore', timeout: 8_000 });
      if (imageDemandee) {
        // Docker et Podman ont généralement des magasins distincts. Quand la
        // CI fournit une image déjà construite, retenir un moteur qui ne la
        // possède pas transformerait un problème de sélection en faux échec
        // « agent absent ».
        execFileSync(nom, ['image', 'inspect', imageDemandee], {
          stdio: 'ignore',
          timeout: 8_000,
        });
      }
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
  it.skipIf(!runtime && !imageDemandee)(
    'exécute réellement le preflight dans Docker/Podman',
    async () => {
      expect(runtime, 'HIVE_ISOLEMENT_IMAGE exige un runtime Docker/Podman actif').not.toBeNull();

      // Le chemin par défaut vérifie le contrat minimal de l’image Node. La
      // jambe CI qui construit l’image agent-aware pose HIVE_ISOLEMENT_IMAGE :
      // elle exerce alors les vrais binaires que le Worker lancera, pas une
      // simple commande `docker run` indépendante de Hive.
      const image = imageDemandee || IMAGE_DEFAUT;
      const binaires = imageDemandee ? ['claude', 'codex'] : ['node'];
      for (const binaire of binaires) {
        const resultat = await sonderAgentDansBac(runtime!, binaire, image);
        expect(resultat.executable, `${binaire} dans ${image}: ${resultat.motif}`).toBe(true);
      }

      const absent = await sonderAgentDansBac(runtime!, 'hive-agent-inexistant', image);
      expect(absent.executable).toBe(false);
    },
    120_000,
  );
});
