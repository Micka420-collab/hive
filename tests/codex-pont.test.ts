// L'ADAPTATEUR CODEX REMET LE DOSSIER DE SON PONT À L'EXÉCUTEUR.
//
// Deux PR ont réécrit le même appel. #480 a sorti le pont de délégation du
// répertoire de la tâche (`rendez-vous-pont.ts`) : c'est désormais l'exécuteur
// qui monte son dossier, en lecture seule, dans le bac (`OptionsEnveloppe.pont`)
// — l'adaptateur doit donc le lui passer. #481 a remplacé `runCommand` par
// `runCommandFlux` (`codex exec --json`). Leur conflit portait sur cet argument,
// et le retirer ne faisait rougir aucun banc : dans un bac, Codex aurait tourné
// sans ses outils de délégation, sans un mot. Ce banc tient ce fil-là ;
// le montage lui-même est éprouvé par tests/isolement.test.ts.

import { realpathSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, AdapterResult } from '../src/adapters/index.js';
import { fournisseurParNom, MONTAGE } from '../src/node-client/isolement.js';
import { RendezVousPont } from '../src/node-client/rendez-vous-pont.js';

const appels = vi.hoisted(() => [] as unknown[][]);
/** Les sondes du bac de Codex (`runCommand`), que ce banc fait réussir. */
const sondes = vi.hoisted(() => [] as unknown[][]);

vi.mock('../src/adapters/exec.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../src/adapters/exec.js')>();
  const reussite = (): Promise<AdapterResult> =>
    Promise.resolve({ success: true, diff: '', logs: '', subAgents: [] });
  return {
    ...reel,
    runCommand: (...args: unknown[]): Promise<AdapterResult> => {
      sondes.push(args);
      return reussite();
    },
    runCommandFlux: (...args: unknown[]): Promise<AdapterResult> => {
      appels.push(args);
      return reussite();
    },
  };
});

const { createCodexAdapter } = await import('../src/adapters/codex.js');

const rendezVous = new RendezVousPont();
afterEach(() => {
  appels.length = 0;
  sondes.length = 0;
});

function contexte(avecPont: boolean): AdapterContext {
  return {
    cwd: process.cwd(),
    env: {},
    attempt: 1,
    signal: new AbortController().signal,
    onProgress: () => undefined,
    ...(avecPont
      ? {
          rendezVous,
          delegate: () => Promise.resolve({ ok: false, code: 'x', message: 'x' }),
          waitForDelegationResult: () => Promise.reject(new Error('jamais appelé')),
        }
      : {}),
  } as AdapterContext;
}

describe('codex : le dossier du pont va jusqu’à l’exécuteur', () => {
  it('avec délégation, `runCommandFlux` reçoit le dossier réservé au pont', async () => {
    const adaptateur = createCodexAdapter('jeton-de-banc-assez-long');
    await adaptateur.run({ id: 't-pont', prompt: 'x' } as never, contexte(true));
    expect(appels).toHaveLength(1);
    const pont = appels[0]?.[5];
    expect(typeof pont).toBe('string');
    expect(String(pont)).toContain('hive-pont-');
    rendezVous.fermer();
  });

  it('sans délégation, aucun pont n’est passé — rien ne sera monté', async () => {
    const adaptateur = createCodexAdapter('jeton-de-banc-assez-long');
    await adaptateur.run({ id: 't-sans', prompt: 'x' } as never, contexte(false));
    expect(appels).toHaveLength(1);
    expect(appels[0]?.[5]).toBeUndefined();
  });
});

describe('codex : le bac de Hive décide du bac de Codex', () => {
  it('dans le bac, Codex tourne sans le sien — aucune sonde, et le dépôt vu est le point de montage', async () => {
    const adaptateur = createCodexAdapter('jeton-de-banc-assez-long');
    const bac = {
      fournisseur: fournisseurParNom('podman'),
      image: 'localhost/hive-agent:local',
      variables: [],
    };
    await adaptateur.run(
      { id: 't-bac', prompt: 'x' } as never,
      {
        ...contexte(false),
        bac,
      } as AdapterContext,
    );
    expect(sondes).toHaveLength(0);
    const argv = appels[0]?.[1] as string[];
    expect(argv.slice(argv.indexOf('--sandbox'), argv.indexOf('--sandbox') + 2)).toEqual([
      '--sandbox',
      'danger-full-access',
    ]);
    expect(argv).toContain(`projects={${JSON.stringify(MONTAGE)}={trust_level="untrusted"}}`);
  });

  it.runIf(process.platform === 'linux')(
    'hors bac, sous Linux, le bac de Codex est sondé UNE fois pour la vie de l’adaptateur',
    async () => {
      const adaptateur = createCodexAdapter('jeton-de-banc-assez-long');
      await adaptateur.run({ id: 't-1', prompt: 'x' } as never, contexte(false));
      await adaptateur.run({ id: 't-2', prompt: 'x' } as never, contexte(false));
      const depot = JSON.stringify(realpathSync(process.cwd()));
      expect(sondes.map((s) => s[1])).toEqual([
        [
          'sandbox',
          '-c',
          'sandbox_mode="workspace-write"',
          '-c',
          `projects={${depot}={trust_level="untrusted"}}`,
          '--',
          'true',
        ],
      ]);
      expect(appels).toHaveLength(2);
      expect(appels[0]?.[1]).toContain('workspace-write');
    },
  );
});
