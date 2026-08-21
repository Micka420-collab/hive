// Motifs inter-projets — procédures ordonnées, pas de diff collé (ADR 0010 lot 10).

import { describe, expect, it } from 'vitest';
import {
  MOTIFS,
  VERSION_MOTIFS,
  appliquerMotif,
  refuserDiffColle,
} from '../src/orchestrator/motifs.js';

describe('motifs', () => {
  it('version + catalogue', () => {
    expect(VERSION_MOTIFS).toBe(1);
    expect(MOTIFS.some((m) => m.id === 'jeu-3d')).toBe(true);
  });

  it('jeu-3d : Blender/fabrique avant assets', () => {
    const v = appliquerMotif('jeu-3d', 'fr');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const ids = v.motif.etapes.map((e) => e.id);
    expect(ids.indexOf('fabrique')).toBeLessThan(ids.indexOf('assets'));
    expect(v.titres[0]).toMatch(/Blender|Fabriquer/i);
  });

  it('refuse un diff git collé', () => {
    expect(refuserDiffColle('diff --git a/x b/x\n--- a/x\n+++ b/x\n')).toEqual({
      ok: false,
      motif: 'diff_interdit',
    });
    expect(
      appliquerMotif(
        'saas-api',
        'en',
        'diff --git a/secret b/secret\n+++ b/secret\n@@ -1 +1 @@\n+stolen\n',
      ),
    ).toEqual({ ok: false, motif: 'diff_interdit' });
  });

  it('motif inconnu', () => {
    expect(appliquerMotif('inexistant')).toEqual({ ok: false, motif: 'inconnu' });
  });
});
