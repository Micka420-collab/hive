// L'HORLOGE DU CHANTIER — ce qu'on a le droit d'annoncer, et ce qu'on n'a pas
// le droit d'arrondir.
//
// Les deux bancs qui portent tout le fichier sont dans « le temps écoulé est
// une INFORMATION » : ils éprouvent les deux comportements qui séparent une
// vraie estimation d'un compte à rebours. Le reste défend les bornes.

import { describe, expect, it } from 'vitest';
import {
  MARGE_CALIBRATION,
  OBSERVATIONS_MIN,
  calibrer,
  direAnnonce,
  direDuree,
  estimerDuree,
  quantile,
  resteEstime,
} from '../src/shared/horloge-chantier.js';
import type { Observation } from '../src/shared/horloge-chantier.js';

const min = (n: number) => n * 60_000;
/** Un historique à la forme RÉELLE d'un chantier : traîne longue à droite. */
const CHANTIER: Observation[] = [
  min(2),
  min(3),
  min(4),
  min(5),
  min(6),
  min(8),
  min(11),
  min(15),
  min(25),
  min(60),
].map((dureeMs) => ({ dureeMs, caste: 'nourrice', genre: 'correctif', reussie: true }));

describe('quantile — ce qu’on a vu, sans rien supposer de la forme', () => {
  it('interpole entre les rangs', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 100], 0.25)).toBe(25);
  });

  it('les bords ne lèvent pas et ne mentent pas', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([42], 0.99)).toBe(42);
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
    // Un p hors bornes est ramené dedans, pas propagé en index négatif.
    expect(quantile([1, 2, 3], -5)).toBe(1);
    expect(quantile([1, 2, 3], 9)).toBe(3);
  });

  it('l’échantillon donné n’est PAS modifié — le tri se fait sur une copie', () => {
    const brut = [3, 1, 2];
    quantile(brut, 0.5);
    expect(brut, 'trier l’argument corromprait l’appelant').toEqual([3, 1, 2]);
  });

  // LE CAS QUI JUSTIFIE LE CHOIX DU QUANTILE. Sur une distribution qui traîne,
  // la moyenne décrit une tâche qui n'existe pas.
  it('résiste à la queue longue, là où une moyenne dérape', () => {
    const durees = CHANTIER.map((o) => o.dureeMs);
    const moyenne = durees.reduce((a, b) => a + b, 0) / durees.length;
    expect(quantile(durees, 0.5)).toBe(min(7));
    // La moyenne est tirée par le 60 min : elle dépasse SIX des dix observations.
    expect(moyenne).toBeGreaterThan(quantile(durees, 0.5));
    expect(durees.filter((d) => d < moyenne).length).toBeGreaterThan(durees.length / 2);
  });
});

describe('estimerDuree — le socle le plus spécifique qui tienne debout', () => {
  it('assez d’observations exactes ⇒ socle « exact »', () => {
    const a = estimerDuree(CHANTIER, { caste: 'nourrice', genre: 'correctif' });
    expect(a.socle).toBe('exact');
    expect(a.n).toBe(10);
    expect(a.p50Ms).toBeLessThan(a.p80Ms);
    expect(a.p80Ms).toBeLessThanOrEqual(a.p95Ms);
  });

  it('genre inconnu ⇒ on ÉLARGIT à la caste plutôt que d’inventer', () => {
    const a = estimerDuree(CHANTIER, { caste: 'nourrice', genre: 'jamais-vu' });
    expect(a.socle).toBe('caste');
    expect(a.n).toBe(10);
  });

  it('caste inconnue ⇒ on élargit encore, jusqu’au global', () => {
    expect(estimerDuree(CHANTIER, { caste: 'inconnue' }).socle).toBe('global');
  });

  // LA RÉPONSE JUSTE D'UNE HORLOGE NEUVE. Inventer un chiffre ici serait pire
  // que se taire : le chiffre serait cru.
  it('trop peu d’observations ⇒ « aucun », pas un chiffre inventé', () => {
    const maigre = CHANTIER.slice(0, OBSERVATIONS_MIN - 1);
    const a = estimerDuree(maigre, { caste: 'nourrice' });
    expect(a.socle).toBe('aucun');
    expect(a.p50Ms).toBe(0);
    expect(a.n, 'le compte reste dit, pour qu’on sache ce qui manque').toBe(OBSERVATIONS_MIN - 1);
  });

  // ─── LA BORNE, ÉPROUVÉE PILE ─────────────────────────────────────────────
  //
  // Le rejeu a montré le trou : je testais à 10 (bien au-dessus) et à 4 (bien
  // au-dessous), jamais à 5. Muté en `>`, le seuil montait d'un cran sans
  // qu'une seule assertion bouge — et l'horloge se serait tue une observation
  // plus tard que promis, pour toujours.
  it('EXACTEMENT le seuil suffit — la borne se lit dans les deux sens', () => {
    const pile = CHANTIER.slice(0, OBSERVATIONS_MIN);
    expect(estimerDuree(pile, { caste: 'nourrice', genre: 'correctif' }).socle).toBe('exact');
    const unDeMoins = CHANTIER.slice(0, OBSERVATIONS_MIN - 1);
    expect(estimerDuree(unDeMoins, { caste: 'nourrice', genre: 'correctif' }).socle).toBe('aucun');
  });

  // Les DEUX autres paliers portaient le même défaut, et le rejeu les a sortis
  // l'un après l'autre : je n'avais éprouvé leur escalade qu'à dix
  // observations. Un seuil qu'on ne touche jamais PILE peut monter d'un cran
  // sans qu'une assertion bouge.
  it('le palier CASTE bascule pile au seuil, lui aussi', () => {
    // Cinq observations de la caste, mais aucun genre n'en réunit cinq :
    // « exact » ne peut pas tenir, « caste » le doit — et exactement à cinq.
    const cinqCastes: Observation[] = Array.from({ length: OBSERVATIONS_MIN }, (_, i) => ({
      dureeMs: min(i + 1),
      caste: 'nourrice',
      genre: `genre-${i}`,
      reussie: true,
    }));
    expect(estimerDuree(cinqCastes, { caste: 'nourrice', genre: 'genre-0' }).socle).toBe('caste');
    expect(
      estimerDuree(cinqCastes.slice(0, OBSERVATIONS_MIN - 1), { caste: 'nourrice' }).socle,
    ).toBe('aucun');
  });

  it('le palier GLOBAL bascule pile au seuil', () => {
    const cinqAilleurs: Observation[] = Array.from({ length: OBSERVATIONS_MIN }, (_, i) => ({
      dureeMs: min(i + 1),
      caste: 'butineuse',
      genre: 'correctif',
      reussie: true,
    }));
    expect(estimerDuree(cinqAilleurs, { caste: 'nourrice' }).socle).toBe('global');
    expect(
      estimerDuree(cinqAilleurs.slice(0, OBSERVATIONS_MIN - 1), { caste: 'nourrice' }).socle,
    ).toBe('aucun');
  });

  it('une tâche ÉCHOUÉE ne compte pas — elle n’a pas la durée d’un succès', () => {
    const avecEchecs: Observation[] = [
      ...CHANTIER,
      ...Array.from({ length: 20 }, () => ({
        dureeMs: min(300),
        caste: 'nourrice',
        genre: 'correctif',
        reussie: false,
      })),
    ];
    const a = estimerDuree(avecEchecs, { caste: 'nourrice', genre: 'correctif' });
    expect(a.n, 'les vingt échecs ne doivent pas gonfler le socle').toBe(10);
    expect(a.p95Ms).toBeLessThan(min(300));
  });
});

describe('le temps écoulé est une INFORMATION, pas une déduction', () => {
  // ─── LE BANC QUI SÉPARE CE MODULE D'UN COMPTE À REBOURS ───────────────────
  //
  // Un compte à rebours soustrait. Ici, on RECONDITIONNE : une tâche qui dure
  // déjà depuis longtemps n'est plus une tâche moyenne, c'est une tâche
  // difficile — et il lui reste souvent PLUS, pas moins.
  it('l’estimation du reste peut AUGMENTER quand la tâche traîne', () => {
    const tot = resteEstime(CHANTIER, 0, { caste: 'nourrice', genre: 'correctif' });
    const apres = resteEstime(CHANTIER, min(20), { caste: 'nourrice', genre: 'correctif' });
    expect(tot.connu && apres.connu).toBe(true);
    if (tot.connu && apres.connu) {
      // À 20 min écoulées, seules les observations de 25 et 60 min survivent :
      // le reste médian passe de 5 min à 20 min. Un compte à rebours aurait
      // affiché « bientôt fini ».
      expect(apres.p50Ms).toBeGreaterThan(tot.p50Ms);
      expect(apres.n).toBeLessThan(tot.n);
    }
  });

  // ─── LE MENSONGE LE PLUS COÛTEUX DU MODULE, S'IL ÉTAIT COMMIS ─────────────
  //
  // Passé le record, il ne reste AUCUNE observation comparable. Rendre « 0 »
  // ferait croire à une fin imminente au moment précis où la tâche part en
  // vrille — l'instant où un humain a le plus besoin d'être alerté.
  it('au-delà de tout ce qu’on a vu, on refuse de chiffrer', () => {
    const r = resteEstime(CHANTIER, min(90), { caste: 'nourrice', genre: 'correctif' });
    expect(r.connu).toBe(false);
    if (!r.connu && r.motif === 'hors_domaine') {
      expect(r.recordMs).toBe(min(60));
    } else {
      expect.fail('hors_domaine attendu — c’est un signal, pas une estimation');
    }
  });

  it('exactement au record, on est déjà hors domaine', () => {
    // La borne se lit dans les deux sens : à 59 min il reste une observation,
    // à 60 min il n'en reste aucune.
    const avant = resteEstime(CHANTIER, min(59), { caste: 'nourrice' });
    const pile = resteEstime(CHANTIER, min(60), { caste: 'nourrice' });
    expect(avant.connu).toBe(true);
    expect(pile.connu).toBe(false);
  });

  it('sans socle, on dit « trop peu » — jamais un reste', () => {
    const r = resteEstime(CHANTIER.slice(0, 2), 0, { caste: 'nourrice' });
    expect(r.connu).toBe(false);
    if (!r.connu) expect(r.motif).toBe('trop_peu');
  });
});

describe('calibrer — l’horloge se note elle-même', () => {
  const annonces = (tenues: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({
      p80Ms: min(10),
      reelMs: i < tenues ? min(5) : min(30),
    }));

  it('8 sur 10 dedans ⇒ honnête', () => {
    const c = calibrer(annonces(8, 10));
    expect(c.partTenue).toBeCloseTo(0.8, 5);
    expect(c.verdict).toBe('honnete');
  });

  // L'ÉCART QUI COÛTE LE PLUS CHER : l'horloge promet plus court que la
  // réalité, et tout ce qui s'appuie dessus déborde.
  it('4 sur 10 ⇒ OPTIMISTE, et l’écart est négatif', () => {
    const c = calibrer(annonces(4, 10));
    expect(c.verdict).toBe('optimiste');
    expect(c.ecart).toBeLessThan(0);
  });

  it('10 sur 10 ⇒ pessimiste : des intervalles trop larges ne sont pas gratuits', () => {
    expect(calibrer(annonces(10, 10)).verdict).toBe('pessimiste');
  });

  it('sous le seuil d’observations, aucun verdict', () => {
    const c = calibrer(annonces(1, OBSERVATIONS_MIN - 1));
    expect(c.verdict).toBe('trop_peu');
    expect(c.n).toBe(OBSERVATIONS_MIN - 1);
  });

  // Même trou que pour le socle, trouvé par le même rejeu : le seuil n'était
  // éprouvé qu'à 4 et à 10, jamais à 5.
  it('EXACTEMENT le seuil suffit à rendre un verdict', () => {
    expect(calibrer(annonces(4, OBSERVATIONS_MIN)).verdict).not.toBe('trop_peu');
    expect(calibrer(annonces(4, OBSERVATIONS_MIN - 1)).verdict).toBe('trop_peu');
  });

  // La marge se lit dans les DEUX sens, sinon elle dériverait sans rien casser.
  it('la marge borne des deux côtés', () => {
    const dedans = calibrer(annonces(Math.round((0.8 + MARGE_CALIBRATION) * 100), 100));
    expect(dedans.verdict).toBe('honnete');
    const dehors = calibrer(annonces(Math.round((0.8 + MARGE_CALIBRATION) * 100) + 2, 100));
    expect(dehors.verdict).toBe('pessimiste');
  });

  it('le réel ÉGAL à l’annonce compte comme tenu', () => {
    const c = calibrer(Array.from({ length: 10 }, () => ({ p80Ms: min(10), reelMs: min(10) })));
    expect(c.partTenue).toBe(1);
  });
});

describe('ce que l’humain lit', () => {
  it('direDuree passe d’unité sans mentir', () => {
    expect(direDuree(500)).toContain('seconde');
    expect(direDuree(45_000)).toBe('45 s');
    expect(direDuree(min(5))).toBe('5 min');
    expect(direDuree(min(120))).toBe('2 h');
    expect(direDuree(min(125))).toBe('2 h 05');
  });

  // L'annonce porte TOUJOURS son incertitude ET son socle : un intervalle sans
  // son `n` invite à une confiance qu'il n'a pas méritée.
  it('l’annonce dit l’intervalle, la confiance ET le nombre d’observations', () => {
    const texte = direAnnonce(estimerDuree(CHANTIER, { caste: 'nourrice', genre: 'correctif' }));
    expect(texte).toContain('8 fois sur 10');
    expect(texte).toContain('10 obs.');
    expect(texte).toMatch(/\d+ min à \d+ min/);
  });

  it('sans socle, elle le DIT au lieu d’afficher un intervalle', () => {
    const texte = direAnnonce(estimerDuree(CHANTIER.slice(0, 2)));
    expect(texte).toContain('pas encore d’estimation');
    expect(texte).not.toMatch(/\d+ min à/);
  });

  it('chaque langue rend SA version — le sélecteur est éprouvé', () => {
    const a = estimerDuree(CHANTIER, { caste: 'nourrice' });
    expect(direAnnonce(a, 'fr')).toContain('8 fois sur 10');
    expect(direAnnonce(a, 'en')).toContain('8 times out of 10');
    expect(direAnnonce(a, 'en')).not.toContain('8 fois sur 10');
    expect(direAnnonce(a)).toBe(direAnnonce(a, 'fr'));
  });
});
