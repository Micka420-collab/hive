// CE QUE LA BALANCE CALCULE — la barre, la promesse du mode, et le geste.
//
// ─── D'OÙ VIENT CE BANC ──────────────────────────────────────────────────────
//
// `decouper` et `effetDuMode` étaient DÉJÀ des fonctions pures. Elles vivaient
// simplement dans `Balance.tsx` sans `export`, donc hors d'atteinte de tout banc
// qui ne monte pas la vue entière. Un balayage échantillonné de
// `dashboard/src/views` (base épinglée `f0fc005`) les a rendues nues toutes les
// deux, plus la garde du geste qui pose un plafond.
//
// Rien à refactorer : le seul geste manquant était le mot `export`.

import { describe, expect, it } from 'vitest';
import type { Compte } from '../dashboard/src/views/balance-rendu.js';
import { POSTES, decouper, effetDuMode, peutPoser } from '../dashboard/src/views/balance-rendu.js';

const fr = (f: string) => f;
const en = (_f: string, e: string) => e;
const nomme = (poste: string) => `«${poste}»`;

const compte = (utile: number, reprise: number, echec: number, rebute: number): Compte => ({
  utileMs: utile,
  repriseMs: reprise,
  echecMs: echec,
  rebuteMs: rebute,
  totalMs: utile + reprise + echec + rebute,
});

describe('decouper — la garde `> 0` est une division par zéro qui attend', () => {
  it('LE CAS QUI TRANCHE : un compte VIDE ne produit aucun NaN', () => {
    // Le mutant `>` → `>=` fait `0 / 0`, donc NaN, posé dans un `width: ${pct}%`.
    // Le navigateur jette la règle, la barre disparaît, et l'écran ne dit rien.
    //
    // Le cas arrive tout seul, et il est même le PREMIER que voit un arrivant :
    // un projet neuf n'a aucune milliseconde à son compte.
    const segments = decouper(compte(0, 0, 0, 0), nomme);
    expect(segments).toHaveLength(4);
    for (const s of segments) {
      expect(Number.isNaN(s.pct), `${s.poste} rend NaN`).toBe(false);
      expect(s.pct).toBe(0);
    }
  });

  it('les parts d’un compte réel somment à 100', () => {
    const segments = decouper(compte(50, 25, 15, 10), nomme);
    expect(segments.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(100, 10);
    expect(segments.find((s) => s.poste === 'utile')?.pct).toBe(50);
  });

  it('un poste à zéro DANS un compte non vide reste à zéro, sans disparaître', () => {
    const segments = decouper(compte(100, 0, 0, 0), nomme);
    expect(segments).toHaveLength(4);
    expect(segments.find((s) => s.poste === 'rebute')?.pct).toBe(0);
  });

  it('les quatre postes sortent dans l’ordre de l’écran, avec leur libellé', () => {
    const segments = decouper(compte(1, 1, 1, 1), nomme);
    expect(segments.map((s) => s.poste)).toEqual(POSTES);
    expect(segments[0]?.libelle).toBe('«utile»');
  });
});

describe('effetDuMode — la phrase engage la ruche, elle est lue AVANT de poser', () => {
  it('LE CAS QUI TRANCHE : « observation » promet que RIEN ne sera arrêté', () => {
    // Le mutant `=== 'observation'` → `!==` fait tomber ce mode dans le repli,
    // qui ne dit pas « rien ne sera arrêté ». On perdrait la seule phrase qui
    // distingue observer de bloquer.
    expect(effetDuMode('observation', fr)).toContain('RIEN ne sera arrêté');
    expect(effetDuMode('observation', en)).toContain('NOTHING will be stopped');
  });

  it('« strict » promet l’arrêt des assignations, pas des tâches en vol', () => {
    // La nuance compte : celles déjà en vol vont à leur terme.
    expect(effetDuMode('strict', fr)).toContain('cessera d’assigner');
    expect(effetDuMode('strict', fr)).toContain('en vol iront à leur terme');
  });

  it('« strict » et « observation » ne disent JAMAIS la même chose', () => {
    // C'est le pire des trois échanges possibles : promettre un blocage à
    // quelqu'un qui n'en aura pas, ou l'inverse.
    expect(effetDuMode('strict', fr)).not.toBe(effetDuMode('observation', fr));
  });

  it('« off » avertit sans rien interrompre — c’est le repli, et il existe', () => {
    expect(effetDuMode('off', fr)).toContain('sans rien interrompre');
  });
});

describe('peutPoser — deux refus, et le mutant les annule tous les deux', () => {
  it('LE CAS QUI TRANCHE : sans cible, on ne pose RIEN', () => {
    // `||` → `&&` exigerait les deux à la fois pour bloquer. Cliquer sans cible
    // enverrait un plafond `null` à la ruche.
    expect(peutPoser(null, false)).toBe(false);
  });

  it('pendant un envoi, on ne repose pas — deux clics vifs n’envoient pas deux fois', () => {
    expect(peutPoser(3600, true)).toBe(false);
  });

  it('une cible et rien en cours : le geste passe', () => {
    expect(peutPoser(3600, false)).toBe(true);
  });

  it('une cible à ZÉRO est une cible — c’est `null` qui dit « aucune »', () => {
    // Zéro est un plafond légitime (« plus rien après ça »), et le confondre
    // avec l'absence rendrait ce réglage-là impossible à poser.
    expect(peutPoser(0, false)).toBe(true);
  });
});
