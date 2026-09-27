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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, AdapterResult } from '../src/adapters/index.js';
import { RendezVousPont } from '../src/node-client/rendez-vous-pont.js';

const appels = vi.hoisted(() => [] as unknown[][]);

vi.mock('../src/adapters/exec.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../src/adapters/exec.js')>();
  return {
    ...reel,
    runCommandFlux: (...args: unknown[]): Promise<AdapterResult> => {
      appels.push(args);
      return Promise.resolve({ success: true, diff: '', logs: '', subAgents: [] });
    },
  };
});

const { createCodexAdapter } = await import('../src/adapters/codex.js');

const rendezVous = new RendezVousPont();
afterEach(() => {
  appels.length = 0;
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
