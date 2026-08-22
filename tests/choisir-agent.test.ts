// Choix d'agent quand plusieurs sont détectés — règles pures + résolution.

import { describe, expect, it, vi } from 'vitest';
import {
  agentsReels,
  fautDemanderChoixAgent,
  interpreterChoixAgent,
  menuChoixAgent,
  resoudreAgentAuDemarrage,
} from '../src/node-client/choisir-agent.js';

describe('agentsReels', () => {
  it('retire le simulateur shell', () => {
    expect(agentsReels(['claude-code', 'cursor', 'shell'])).toEqual(['claude-code', 'cursor']);
  });
});

describe('fautDemanderChoixAgent', () => {
  it('non si HIVE_AGENT force, ou un seul réel, ou hors TTY', () => {
    expect(
      fautDemanderChoixAgent({
        forceAgent: 'cursor',
        agentCmd: '',
        reels: ['claude-code', 'cursor'],
        stdinEstTty: true,
      }),
    ).toBe(false);
    expect(
      fautDemanderChoixAgent({
        forceAgent: '',
        agentCmd: 'aider',
        reels: ['custom'],
        stdinEstTty: true,
      }),
    ).toBe(false);
    expect(
      fautDemanderChoixAgent({
        forceAgent: '',
        agentCmd: '',
        reels: ['cursor'],
        stdinEstTty: true,
      }),
    ).toBe(false);
    expect(
      fautDemanderChoixAgent({
        forceAgent: '',
        agentCmd: '',
        reels: ['claude-code', 'cursor'],
        stdinEstTty: false,
      }),
    ).toBe(false);
  });

  it('oui seulement si plusieurs réels, TTY, sans force', () => {
    expect(
      fautDemanderChoixAgent({
        forceAgent: '',
        agentCmd: '',
        reels: ['claude-code', 'cursor'],
        stdinEstTty: true,
      }),
    ).toBe(true);
  });
});

describe('interpreterChoixAgent', () => {
  const reels = ['claude-code', 'cursor', 'codex'] as const;

  it('Entrée → défaut', () => {
    expect(interpreterChoixAgent('', reels, 'cursor')).toBe('cursor');
    expect(interpreterChoixAgent('  ', reels, 'claude-code')).toBe('claude-code');
  });

  it('numéro valide → agent', () => {
    expect(interpreterChoixAgent('2', reels, 'claude-code')).toBe('cursor');
  });

  it('hors bornes → null', () => {
    expect(interpreterChoixAgent('9', reels, 'claude-code')).toBeNull();
    expect(interpreterChoixAgent('abc', reels, 'claude-code')).toBeNull();
  });
});

describe('menuChoixAgent', () => {
  it('liste numérotée avec libellés lisibles', () => {
    const m = menuChoixAgent(['claude-code', 'cursor']);
    expect(m).toContain('1. Claude Code');
    expect(m).toContain('2. Cursor');
  });
});

describe('resoudreAgentAuDemarrage', () => {
  const sonde = async (argv: readonly string[]): Promise<boolean> => {
    const b = argv[0] ?? '';
    return b.startsWith('claude') || b.startsWith('agent') || b.startsWith('cursor');
  };

  it('HIVE_AGENT force sans demander', async () => {
    const demander = vi.fn(async () => '2');
    const vu = await resoudreAgentAuDemarrage({
      env: { HIVE_AGENT: 'codex' },
      sonder: sonde,
      stdinEstTty: true,
      demander,
    });
    expect(vu.agent).toBe('codex');
    expect(demander).not.toHaveBeenCalled();
  });

  it('plusieurs agents + TTY → demande et retient le numéro', async () => {
    const demander = vi.fn(async () => '2');
    const vu = await resoudreAgentAuDemarrage({
      env: {},
      sonder: sonde,
      stdinEstTty: true,
      demander,
    });
    expect(vu.agent).toBe('cursor');
    expect(demander).toHaveBeenCalledOnce();
  });

  it('plusieurs agents hors TTY → préférence (Claude d’abord)', async () => {
    const demander = vi.fn(async () => '2');
    const vu = await resoudreAgentAuDemarrage({
      env: {},
      sonder: sonde,
      stdinEstTty: false,
      demander,
    });
    expect(vu.agent).toBe('claude-code');
    expect(demander).not.toHaveBeenCalled();
  });
});
