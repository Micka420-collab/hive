// Preuve de la frontière entre validation d'un crochet et son lancement.
// Les fonctions fs sont simulées pour pouvoir exercer le chemin réel sans
// créer `/workspace` sur l'hôte du runner.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMocks);

const { lancerCrochets } = await import('../src/atelier/reveil.js');

describe('crochets de réveil — chemin validé lancé', () => {
  it('ne relance pas la directory entry après realpath()', async () => {
    fsMocks.readdir.mockResolvedValue(['alias']);
    fsMocks.realpath.mockResolvedValue('/workspace/.wake-hooks/verifie');
    fsMocks.stat.mockResolvedValue({
      mode: 0o755,
      uid: 10001,
      isFile: () => true,
    });

    const child = new EventEmitter();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    const rapport = await lancerCrochets({
      dossier: '/workspace/.wake-hooks',
      uidHive: 10001,
      spawnFn: spawnFn as unknown as typeof spawn,
    });

    expect(rapport).toMatchObject({ ok: true, lances: 1 });
    expect(spawnFn).toHaveBeenCalledWith('/workspace/.wake-hooks/verifie', [], {
      cwd: '/workspace',
      shell: false,
      windowsHide: true,
    });
  });
});
