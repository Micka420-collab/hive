// Motifs inter-projets — procédures ordonnées, pas de diff collé (ADR 0010 lot 10).

import { describe, expect, it } from 'vitest';
import {
  MOTIFS,
  VERSION_MOTIFS,
  appliquerMotif,
  catalogueCoherent,
  refuserDiffColle,
} from '../src/orchestrator/motifs.js';

describe('motifs', () => {
  it('version + catalogue', () => {
    expect(VERSION_MOTIFS).toBe(1);
    expect(MOTIFS.some((m) => m.id === 'jeu-3d')).toBe(true);
  });

  it('catalogueCoherent : tout le catalogue respecte son ordre déclaré', () => {
    expect(catalogueCoherent()).toEqual([]);
  });

  it('jeu-3d : Blender/fabrique avant assets', () => {
    const v = appliquerMotif('jeu-3d', 'fr');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const ids = v.motif.etapes.map((e) => e.id);
    expect(ids.indexOf('fabrique')).toBeLessThan(ids.indexOf('assets'));
    expect(v.titres[0]).toMatch(/Blender|Fabriquer/i);
  });

  it('saas-api : contrat avant backend avant UI (enfin gardé)', () => {
    const v = appliquerMotif('saas-api', 'fr');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const ids = v.motif.etapes.map((e) => e.id);
    expect(ids.indexOf('contrat')).toBeLessThan(ids.indexOf('backend'));
    expect(ids.indexOf('backend')).toBeLessThan(ids.indexOf('ui'));
  });

  it('cli-outil : fabrique avant packaging', () => {
    const v = appliquerMotif('cli-outil', 'fr');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const ids = v.motif.etapes.map((e) => e.id);
    expect(ids.indexOf('fabrique')).toBeLessThan(ids.indexOf('packaging'));
    expect(v.titres[0]).toMatch(/fabrique|script/i);
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

  it('catalogueCoherent détecte un ordre cassé', () => {
    const faux = [
      {
        id: 'casse',
        domaine: 'x',
        libelleFr: 'x',
        libelleEn: 'x',
        etapes: [
          { id: 'apres', titreFr: 'a', titreEn: 'a' },
          { id: 'avant', titreFr: 'b', titreEn: 'b' },
        ],
        ordre: [['avant', 'apres'] as const],
      },
    ];
    expect(catalogueCoherent(faux)).toEqual(['casse: avant doit précéder apres']);
  });
});
