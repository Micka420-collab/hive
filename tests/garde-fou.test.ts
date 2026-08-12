// L'AGENT GARDE-FOUS — la ruche apprend, par projet, le bon réglage du trou de
// vol, DANS des bornes qu'un humain a posées.
//
// Ce que ce banc protège, en une phrase : « le meilleur COMPROMIS, pas le plus
// strict, et jamais hors des bornes consenties ». Trois dangers guettent, chacun
// éprouvé à part :
//   · le strict qui gagnerait trivialement (la récompense doit faire payer le
//     péage de la contre-visite) ;
//   · le léger qui gagnerait par paresse (un creux qui passe vaut zéro) ;
//   · l'agent qui s'échapperait (il n'élit JAMAIS hors de {min, max}).

import { describe, expect, it } from 'vitest';
import {
  BORNES_DEFAUT,
  CORPUS_GARDE_FOU,
  ECHELONS,
  NOTE_TRAVERSEE,
  NOTE_VERDICT,
  POIDS_FLUIDITE,
  POIDS_QUALITE,
  REGLAGES,
  classerEchelons,
  echelonsPermis,
  elireEchelon,
  normaliserBornes,
  observationDepuisFaits,
  rangEchelon,
  recompenseGardeFou,
  replierAntecedentsGardeFou,
  type Echelon,
  type FaitsProduction,
  type ObservationGardeFou,
  type Traversee,
} from '../src/orchestrator/garde-fou.js';
import type { Verdict } from '../src/orchestrator/gardiennes.js';

/** Fabrique une observation, pour ne pas répéter la forme. */
function obs(
  echelon: Echelon,
  verdict: Verdict,
  traversee: Traversee,
  reprise = false,
): ObservationGardeFou {
  return { echelon, verdict, traversee, reprise };
}

describe("l'échelle — trois échelons ordonnés, jamais « off »", () => {
  it('est ordonnée du plus ouvert au plus serré', () => {
    expect(ECHELONS).toEqual(['leger', 'standard', 'strict']);
    expect(rangEchelon('leger')).toBe(0);
    expect(rangEchelon('standard')).toBe(1);
    expect(rangEchelon('strict')).toBe(2);
  });

  it('le PLANCHER garde les Gardiennes allumées — « tout éteindre » est inatteignable', () => {
    // Le méta garde-fou structurel : même l'échelon le plus bas allume le
    // contrôle d'entrée. Aucun échelon ne met un mode à `off`.
    for (const e of ECHELONS) {
      expect(REGLAGES[e].gardiennes, e).not.toBe('off');
      expect(REGLAGES[e].polyethisme, e).not.toBe('off');
    }
  });

  it("chaque échelon commande le bon paquet — c'est une échelle, pas un interrupteur", () => {
    // `standard` tient les Gardiennes strictes SANS la contre-visite : c'est le
    // palier intermédiaire qui n'existerait pas avec un unique bouton on/off.
    expect(REGLAGES.leger).toEqual({ gardiennes: 'consultatif', polyethisme: 'consignes' });
    expect(REGLAGES.standard).toEqual({ gardiennes: 'strict', polyethisme: 'consignes' });
    expect(REGLAGES.strict).toEqual({ gardiennes: 'strict', polyethisme: 'strict' });
  });
});

describe('la récompense — le compromis qualité / fluidité', () => {
  it('une production propre qui passe sans entrave vaut le maximum', () => {
    expect(recompenseGardeFou(obs('standard', 'clean', 'directe'))).toBeCloseTo(1);
  });

  it('un creux retenu à la revue humaine vaut zéro — le pire des deux côtés', () => {
    expect(recompenseGardeFou(obs('strict', 'hollow', 'en_attente'))).toBeCloseTo(0);
  });

  it('la QUALITÉ pèse double, la FLUIDITÉ simple — et l’asymétrie se mesure', () => {
    // clean + en_attente : qualité 1, fluidité 0 → (2·1 + 1·0)/3 = 2/3.
    // hollow + directe   : qualité 0, fluidité 1 → (2·0 + 1·1)/3 = 1/3.
    // Ces deux nombres, PRIS ENSEMBLE, distinguent « qualité double » d'un
    // barème où les poids seraient égaux (les deux vaudraient 1/2) ou inversés.
    expect(recompenseGardeFou(obs('strict', 'clean', 'en_attente'))).toBeCloseTo(2 / 3);
    expect(recompenseGardeFou(obs('leger', 'hollow', 'directe'))).toBeCloseTo(1 / 3);
    // La constante elle-même : la qualité DOIT peser plus que la fluidité, sinon
    // le compromis penche du mauvais côté.
    expect(POIDS_QUALITE).toBeGreaterThan(POIDS_FLUIDITE);
  });

  it('le « suspect » ne compte qu’aux deux tiers — l’indulgence du grief heuristique', () => {
    // suspect + directe : qualité 2/3, fluidité 1 → (2·(2/3) + 1)/3 = 7/9.
    expect(recompenseGardeFou(obs('standard', 'suspect', 'directe'))).toBeCloseTo(7 / 9);
    expect(NOTE_VERDICT.suspect).toBeCloseTo(2 / 3);
  });

  it('une contre-visite qui relit puis relâche coûte un demi — le péage du strict', () => {
    // clean + retenue_puis_relachee : qualité 1, fluidité 1/2 → (2 + 0.5)/3 = 5/6.
    expect(recompenseGardeFou(obs('strict', 'clean', 'retenue_puis_relachee'))).toBeCloseTo(5 / 6);
    expect(NOTE_TRAVERSEE.retenue_puis_relachee).toBeCloseTo(0.5);
  });

  it('une REPRISE écrase la qualité à zéro, quel que soit le verdict d’entrée', () => {
    // clean + directe, MAIS reprise : la qualité tombe à 0 → (2·0 + 1·1)/3 = 1/3,
    // là où sans reprise ce serait 1. C'est le démenti le plus dur du verdict.
    expect(recompenseGardeFou(obs('leger', 'clean', 'directe', true))).toBeCloseTo(1 / 3);
    expect(recompenseGardeFou(obs('leger', 'clean', 'directe', false))).toBeCloseTo(1);
  });
});

describe('observationDepuisFaits — la traversée est une VUE, pas un fait rangé', () => {
  const faits = (p: Partial<FaitsProduction>): FaitsProduction => ({
    echelon: 'standard',
    verdict: 'clean',
    suite: null,
    exigence: null,
    ...p,
  });

  it('une contre-visite a eu lieu ⇒ retenue_puis_relachee, quel que soit son verdict', () => {
    expect(observationDepuisFaits(faits({ suite: 'appliquer' }))).toMatchObject({
      traversee: 'retenue_puis_relachee',
      reprise: false,
    });
    expect(observationDepuisFaits(faits({ suite: 'ameliorer' }))).toMatchObject({
      traversee: 'retenue_puis_relachee',
    });
  });

  it('une suite « refaire » lève la REPRISE — la production a été renvoyée', () => {
    expect(observationDepuisFaits(faits({ suite: 'refaire' }))).toMatchObject({
      traversee: 'retenue_puis_relachee',
      reprise: true,
    });
  });

  it('exigée mais AUCUNE contre-visite ⇒ en_attente — pend à la revue humaine', () => {
    expect(observationDepuisFaits(faits({ suite: null, exigence: 'exigee' }))).toMatchObject({
      traversee: 'en_attente',
      reprise: false,
    });
  });

  it('dispensée ⇒ directe — passée sans entrave', () => {
    expect(observationDepuisFaits(faits({ suite: null, exigence: 'dispensee' }))).toMatchObject({
      traversee: 'directe',
    });
  });

  it('NI contre-visite NI exigence ⇒ null : EN VOL, fermé par défaut', () => {
    // Le piège qu'on refuse : sans décision, on ne suppose PAS « directe ». Une
    // production non tranchée ne pèse pas encore, elle ne se déguise pas en butin.
    expect(observationDepuisFaits(faits({ suite: null, exigence: null }))).toBeNull();
  });

  it('reporte l’échelon et le verdict tels quels', () => {
    expect(
      observationDepuisFaits(faits({ echelon: 'leger', verdict: 'hollow', exigence: 'dispensee' })),
    ).toEqual({
      echelon: 'leger',
      verdict: 'hollow',
      traversee: 'directe',
      reprise: false,
    });
  });
});

describe('les antécédents — repliés par échelon, avec oubli', () => {
  it('compte les essais et somme les récompenses par échelon', () => {
    const memoire = replierAntecedentsGardeFou([
      obs('strict', 'clean', 'directe'), // 1
      obs('strict', 'hollow', 'directe'), // (2·0 + 1)/3 = 1/3
      obs('leger', 'clean', 'directe'), // 1
    ]);
    expect(memoire.get('strict')?.essais).toBe(2);
    expect(memoire.get('strict')?.recompenseTotale).toBeCloseTo(1 + 1 / 3);
    expect(memoire.get('leger')?.essais).toBe(1);
    expect(memoire.get('leger')?.recompenseTotale).toBeCloseTo(1);
    expect(memoire.has('standard')).toBe(false);
  });

  it('OUBLIE au-delà du corpus — seules les dernières comptent', () => {
    // Une observation ANCIENNE sur `leger`, puis CORPUS observations sur `strict`.
    // La fenêtre `slice(-CORPUS)` garde les CORPUS dernières : `leger` tombe hors
    // champ, `strict` en garde exactement CORPUS.
    const anciennes: ObservationGardeFou[] = [obs('leger', 'clean', 'directe')];
    const recentes: ObservationGardeFou[] = Array.from({ length: CORPUS_GARDE_FOU }, () =>
      obs('strict', 'clean', 'directe'),
    );
    const memoire = replierAntecedentsGardeFou([...anciennes, ...recentes]);
    expect(memoire.has('leger'), 'l’ancienne est oubliée').toBe(false);
    expect(memoire.get('strict')?.essais).toBe(CORPUS_GARDE_FOU);
  });
});

describe('les bornes — reçues, jamais rendues, fermées par défaut', () => {
  it('des bornes déjà ordonnées passent telles quelles', () => {
    expect(normaliserBornes({ min: 'leger', max: 'strict' })).toEqual({
      min: 'leger',
      max: 'strict',
    });
    expect(normaliserBornes({ min: 'standard', max: 'standard' })).toEqual({
      min: 'standard',
      max: 'standard',
    });
  });

  it('des bornes INVERSÉES se resserrent sur le PLUS STRICT — jamais sur le plus lâche', () => {
    // `min` plus strict que `max` est une méprise : on échoue vers PLUS de
    // garde-fous. Le PLUS STRICT est TOUJOURS `min` dans ce cas — on l'éprouve
    // sur les TROIS inversions possibles, pour que « resserrer sur `min` » (et
    // jamais sur `max`) soit défendu par un test, et pas seulement par le typeur :
    // c'est ce qui empêche la branche `: max` de renaître muette (§ 2.16 ter).
    expect(normaliserBornes({ min: 'strict', max: 'leger' })).toEqual({
      min: 'strict',
      max: 'strict',
    });
    expect(normaliserBornes({ min: 'strict', max: 'standard' })).toEqual({
      min: 'strict',
      max: 'strict',
    });
    expect(normaliserBornes({ min: 'standard', max: 'leger' })).toEqual({
      min: 'standard',
      max: 'standard',
    });
  });

  it('énumère les échelons permis dans l’ordre de l’échelle, et jamais vide', () => {
    expect(echelonsPermis(BORNES_DEFAUT)).toEqual(['leger', 'standard', 'strict']);
    expect(echelonsPermis({ min: 'leger', max: 'standard' })).toEqual(['leger', 'standard']);
    expect(echelonsPermis({ min: 'standard', max: 'standard' })).toEqual(['standard']);
    // Inversées → normalisées → un seul échelon, jamais zéro.
    expect(echelonsPermis({ min: 'strict', max: 'leger' })).toEqual(['strict']);
  });
});

describe("l'élection — UCB1, le même moteur que l'Aiguillage", () => {
  it('à froid, tout échelon est à explorer, et l’ex æquo tranche vers le STRICT', () => {
    // Aucun antécédent : les trois échelons valent +∞. Le départage déterministe
    // choisit le plus strict — « l'inconnu est une nourrice », on encadre.
    const rangs = classerEchelons(ECHELONS, new Map());
    expect(rangs.every((r) => r.score === Number.POSITIVE_INFINITY)).toBe(true);
    expect(elireEchelon(BORNES_DEFAUT, new Map())).toBe('strict');

    // ─── ET LA MOYENNE AFFICHÉE, QUE CE BANC NE REGARDAIT PAS ──────────────
    //
    // Il ne vérifiait que le SCORE. Or `classerEchelons` appelle `moyenne`
    // DIRECTEMENT sur un antécédent construit par défaut — `scoreUCB`, lui,
    // intercepte `essais === 0` avant. La garde `a.essais > 0` mutée en `>=`
    // rendait donc `0 / 0`, soit NaN, et les 50 cas d'`aiguillage` et de
    // `garde-fou` restaient VERTS : mesuré, verdict affiché.
    //
    // Ce tableau existe pour rendre le choix relisible — « strict : 0.71 sur
    // 12 ». Sur un projet neuf il n'y a AUCUN antécédent, donc chaque ligne
    // vaudrait NaN, et `JSON.stringify(NaN)` rend `null` : l'écran montrerait
    // des trous au moment précis où l'on cherche à comprendre.
    for (const r of rangs) {
      expect(
        Number.isNaN(r.moyenne),
        `${r.echelon} : moyenne NaN — l’API l’enverrait en null`,
      ).toBe(false);
      expect(r.moyenne, `${r.echelon} : sans vécu, la moyenne affichée est 0`).toBe(0);
    }
  });

  it('un échelon éprouvé et bon est préféré à un mauvais — une fois tous essayés', () => {
    // `leger` a beaucoup et bien servi ; `standard` et `strict` beaucoup et mal.
    // Tous ont des essais (plus de +∞), donc c'est la MOYENNE qui parle.
    const observations: ObservationGardeFou[] = [
      ...Array.from({ length: 20 }, () => obs('leger', 'clean', 'directe')), // moyenne ≈ 1
      ...Array.from({ length: 20 }, () => obs('standard', 'hollow', 'retenue_puis_relachee')), // ≈ 1/6
      ...Array.from({ length: 20 }, () => obs('strict', 'hollow', 'en_attente')), // 0
    ];
    const memoire = replierAntecedentsGardeFou(observations);
    expect(elireEchelon(BORNES_DEFAUT, memoire)).toBe('leger');
  });

  it("N'ÉLIT JAMAIS hors des bornes — même quand le hors-bornes serait le meilleur", () => {
    // `strict` a le meilleur vécu de loin, mais les bornes l'excluent. L'agent
    // reste DANS ce que l'humain a consenti : c'est le méta garde-fou.
    const observations: ObservationGardeFou[] = [
      ...Array.from({ length: 30 }, () => obs('strict', 'clean', 'directe')), // parfait
      ...Array.from({ length: 30 }, () => obs('standard', 'hollow', 'en_attente')), // nul
      ...Array.from({ length: 30 }, () => obs('leger', 'hollow', 'en_attente')), // nul
    ];
    const memoire = replierAntecedentsGardeFou(observations);
    // Bornes {leger, standard} : `strict` interdit. Entre deux nuls, l'ex æquo
    // penche vers le plus strict PERMIS → `standard`.
    const elu = elireEchelon({ min: 'leger', max: 'standard' }, memoire);
    expect(elu).toBe('standard');
    expect(elu).not.toBe('strict');
  });

  it('le classement est indépendant de l’ordre d’entrée', () => {
    const memoire = replierAntecedentsGardeFou([
      ...Array.from({ length: 10 }, () => obs('standard', 'clean', 'directe')),
      ...Array.from({ length: 10 }, () => obs('leger', 'hollow', 'en_attente')),
      ...Array.from({ length: 10 }, () => obs('strict', 'suspect', 'retenue_puis_relachee')),
    ]);
    const a = classerEchelons(['leger', 'standard', 'strict'], memoire).map((r) => r.echelon);
    const b = classerEchelons(['strict', 'leger', 'standard'], memoire).map((r) => r.echelon);
    expect(a).toEqual(b);
    expect(a[0]).toBe('standard'); // le seul qui a du clean sans péage
  });
});
