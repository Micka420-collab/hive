import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/adapters/exec.js';
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

  it.skipIf(!runtime || !imageDemandee)(
    'exécute une commande réelle dans le seul workspace monté',
    async () => {
      // Ce test ne lance pas un modèle payant : il exerce le même chemin
      // d'exécution avec Node présent dans l'image agent-aware. La preuve
      // utile est l'enveloppe réelle (volume unique, HOME éphémère, aucune
      // variable de secret implicite), pas un faux résultat d'adaptateur.
      if (!runtime || !imageDemandee) return;
      const root = mkdtempSync(path.join(os.tmpdir(), 'hive-sandbox-runtime-'));
      const workspace = path.join(root, 'workspace');
      const secretPath = path.join(root, 'outside-secret.txt');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(secretPath, 'ne doit jamais être visible dans le conteneur\n');
      try {
        const probe = await runCommand(
          'node',
          [
            '-e',
            [
              "const fs = require('node:fs');",
              "const result = { cwd: process.cwd(), home: process.env.HOME, outside: fs.existsSync(process.env.HOST_SECRET_PATH ?? ''), token: process.env.HIVE_TOKEN ?? null };",
              "fs.writeFileSync('/hive/tache/probe.json', JSON.stringify(result));",
            ].join(''),
          ],
          {
            cwd: workspace,
            env: { PATH: process.env.PATH, HOST_SECRET_PATH: secretPath },
            attempt: 1,
            signal: new AbortController().signal,
            onProgress: () => {},
            bac: {
              fournisseur: runtime,
              image: imageDemandee,
              variables: ['HOST_SECRET_PATH'],
            },
          },
        );
        expect(probe.success, probe.logs).toBe(true);
        const result = JSON.parse(readFileSync(path.join(workspace, 'probe.json'), 'utf8')) as {
          cwd: string;
          home: string;
          outside: boolean;
          token: string | null;
        };
        expect(result).toEqual({
          cwd: '/hive/tache',
          home: '/tmp/hive-home',
          outside: false,
          token: null,
        });
        expect(readFileSync(secretPath, 'utf8')).toContain('ne doit jamais être visible');
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      }
    },
    120_000,
  );
});
