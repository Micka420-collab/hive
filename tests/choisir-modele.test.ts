import { describe, expect, it, vi } from 'vitest';
import {
  agentAccepteModele,
  interpreterChoixModele,
  menuChoixModele,
  resoudreModelesAuDemarrage,
} from '../src/node-client/choisir-modele.js';
import type { ModeleLocal } from '../src/node-client/modeles-locaux.js';

const candidats: ModeleLocal[] = [
  { id: 'sonnet', source: 'configuration' },
  { id: 'opus', source: 'suggestion' },
];

describe('choix simple du modèle au premier lancement', () => {
  it('explique automatique, provenance locale et Aiguillage', () => {
    const menu = menuChoixModele(candidats);
    expect(menu).toContain('1. Automatique');
    expect(menu).toContain('2. sonnet · trouvé dans la configuration locale');
    expect(menu).toContain('3. opus · suggestion — accès compte à confirmer');
    expect(menu).toContain('Tous les modèles listés');
  });

  it('interprète automatique, un modèle, tous, et refuse le reste', () => {
    expect(interpreterChoixModele('', candidats)).toEqual({ ok: true, modeles: null });
    expect(interpreterChoixModele('2', candidats)).toEqual({
      ok: true,
      modeles: ['sonnet'],
    });
    expect(interpreterChoixModele('4', candidats)).toEqual({
      ok: true,
      modeles: ['sonnet', 'opus'],
    });
    expect(interpreterChoixModele('99', candidats)).toEqual({ ok: false });
  });

  it('HIVE_MODELES explicite prime et ne pose aucune question', async () => {
    const demander = vi.fn(async () => '1');
    await expect(
      resoudreModelesAuDemarrage({
        agent: 'claude-code',
        env: { HIVE_MODELES: 'sonnet,opus' },
        candidats,
        stdinEstTty: true,
        demander,
      }),
    ).resolves.toEqual(['sonnet', 'opus']);
    expect(demander).not.toHaveBeenCalled();
  });

  it('une préférence automatique évite de redemander à chaque lancement', async () => {
    const demander = vi.fn(async () => '2');
    await expect(
      resoudreModelesAuDemarrage({
        agent: 'cursor',
        preference: null,
        candidats: [{ id: 'auto', source: 'suggestion' }],
        stdinEstTty: true,
        demander,
      }),
    ).resolves.toBeUndefined();
    expect(demander).not.toHaveBeenCalled();
  });

  it('Codex et Grok honorent maintenant le choix ; Cline reste honnête', () => {
    expect(agentAccepteModele('claude-code')).toBe(true);
    expect(agentAccepteModele('cursor')).toBe(true);
    expect(agentAccepteModele('codex')).toBe(true);
    expect(agentAccepteModele('grok')).toBe(true);
    expect(agentAccepteModele('cline')).toBe(false);
  });

  it('ne déclare rien pour un adaptateur qui ignore les modèles', async () => {
    const informer = vi.fn();
    await expect(
      resoudreModelesAuDemarrage({
        agent: 'cline',
        env: { HIVE_MODELES: 'modele-inerte' },
        candidats: [],
        stdinEstTty: true,
        demander: async () => '1',
        informer,
      }),
    ).resolves.toBeUndefined();
    expect(informer).toHaveBeenCalledWith(expect.stringContaining('HIVE_MODELES ignoré'));
  });
});
