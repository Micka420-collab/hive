import { describe, expect, it } from 'vitest';
import {
  assignationProductionAutorisee,
  demarrageNoeudAutorise,
  estAgentSimule,
  messageRefusShellProduction,
} from '../src/shared/agent-production.js';

describe('agent-production', () => {
  it('shell et sim sont simulés', () => {
    expect(estAgentSimule('shell')).toBe(true);
    expect(estAgentSimule('sim')).toBe(true);
    expect(estAgentSimule('claude-code')).toBe(false);
  });

  it('refuse shell en production orchestrateur et nœud', () => {
    expect(assignationProductionAutorisee('shell', { simulation: false })).toBe(false);
    expect(assignationProductionAutorisee('shell', { simulation: true })).toBe(true);
    expect(assignationProductionAutorisee('codex', { simulation: false })).toBe(true);
    expect(demarrageNoeudAutorise('shell', {})).toBe(false);
    expect(demarrageNoeudAutorise('shell', { HIVE_SIMULATION: '1' })).toBe(true);
    expect(demarrageNoeudAutorise('shell', { HIVE_AGENT: 'shell' })).toBe(true);
  });

  it('message refus shell non vide', () => {
    expect(messageRefusShellProduction('fr')).toMatch(/Claude Code/);
    expect(messageRefusShellProduction('en')).toMatch(/Claude Code/);
  });
});
