// Le tableau de bord d'une personne.
//
// Ce module n'invente aucune donnée : il classe. Les tests portent donc
// presque tous sur l'ORDRE et sur les cas où « rien » et « zéro » disent deux
// choses différentes — c'est là que ce genre d'écran ment le plus facilement.

import { describe, expect, it } from 'vitest';
import {
  JOURS_EFFACEMENT_PROCHE,
  JOURS_FIN_PROCHE,
  PART_QUOTA_ALERTE,
  alertesDe,
  composerTableau,
  rendreProjet,
  trier,
} from '../src/orchestrator/tableau.js';
import type { Alerte, ProjetVu } from '../src/orchestrator/tableau.js';

const NOW = 1_800_000_000_000;
const JOUR = 86_400_000;
const HEURE = 3_600_000;

const projet = (over: Partial<ProjetVu> = {}): ProjetVu => ({
  projectId: 'p1',
  nom: 'Boutique du miel',
  role: 'owner',
  plan: 'essaim',
  etatAbonnement: 'actif',
  finPeriode: null,
  actif: true,
  motifDroits: 'Essaim',
  heures: 50,
  plafondMs: 50 * HEURE,
  depenseMs: 0,
  serveurs: [],
  autonomie: 'off',
  ...over,
});

const rendu = (over: Partial<ProjetVu> = {}) => rendreProjet(projet(over), NOW);
const cles = (a: readonly Alerte[]): string[] => a.map((x) => x.cle);

describe('tableau — ce qui est calculé', () => {
  it('la part consommée est `null` SANS PLAFOND, pas zéro', () => {
    // « rien consommé » et « rien à consommer » sont deux affirmations
    // différentes ; une jauge à 0 % raconterait la première alors que c'est la
    // seconde qui est vraie.
    expect(rendu({ plafondMs: null }).partConsommee).toBeNull();
    expect(rendu({ plafondMs: 10 * HEURE, depenseMs: 0 }).partConsommee).toBe(0);
  });

  it('un plafond à ZÉRO est entièrement consommé, pas vide', () => {
    // Le cas se produit vraiment : poser un plafond de 0 est le geste qui
    // arrête un projet. Diviser rendrait l'infini, et 0 % l'inverse du vrai.
    expect(rendu({ plafondMs: 0, depenseMs: 0 }).partConsommee).toBe(1);
  });

  it('la part ne dépasse jamais 1, même en dépassement', () => {
    expect(rendu({ plafondMs: 10 * HEURE, depenseMs: 30 * HEURE }).partConsommee).toBe(1);
  });

  it('sans échéance, les jours restants valent -1 — surtout pas 0', () => {
    // 0 voudrait dire « ça se termine aujourd'hui ». Un plan sans période ne
    // se termine pas.
    expect(rendu({ finPeriode: null }).joursRestants).toBe(-1);
  });

  it('une période déjà passée rend 0, pas un nombre négatif', () => {
    expect(rendu({ finPeriode: NOW - 5 * JOUR }).joursRestants).toBe(0);
  });

  it('seules les machines qui COÛTENT comptent comme facturables', () => {
    const p = rendu({
      serveurs: [
        { id: 'a', etat: 'pret', joursAvantSuppression: -1 },
        { id: 'b', etat: 'provisionnement', joursAvantSuppression: -1 },
        { id: 'c', etat: 'arrete', joursAvantSuppression: 20 },
        { id: 'd', etat: 'supprime', joursAvantSuppression: -1 },
        { id: 'e', etat: 'echoue', joursAvantSuppression: -1 },
      ],
    });
    expect(p.serveursFacturables).toBe(2);
  });
});

describe('tableau — les alertes', () => {
  it('un projet sain n’alerte sur RIEN', () => {
    // Un tableau qui alerte tout le temps n'alerte sur rien.
    expect(alertesDe(rendu())).toEqual([]);
  });

  it('un plan gratuit sans plafond reste silencieux', () => {
    // Sans plafond il n'y a pas de quota à vider : dire « quota épuisé » à
    // chaque utilisateur du plan libre serait faux ET assourdissant.
    expect(alertesDe(rendu({ plan: 'libre', plafondMs: null, heures: 0 }))).toEqual([]);
  });

  it('le quota qui se vide prévient AVANT d’être vide', () => {
    const juste = rendu({ plafondMs: 100 * HEURE, depenseMs: PART_QUOTA_ALERTE * 100 * HEURE });
    expect(cles(alertesDe(juste))).toEqual(['quota_presque_epuise']);

    const avant = rendu({ plafondMs: 100 * HEURE, depenseMs: 80 * HEURE });
    expect(alertesDe(avant)).toEqual([]);
  });

  it('le quota épuisé le dit CRITIQUE, pas « presque »', () => {
    const a = alertesDe(rendu({ plafondMs: 10 * HEURE, depenseMs: 10 * HEURE }));
    expect(cles(a)).toEqual(['quota_epuise']);
    expect(a[0]?.gravite).toBe('critique');
  });

  it('un impayé DANS le délai de grâce n’est pas encore critique', () => {
    // Le projet tourne toujours : le crier en rouge vif ferait douter de la
    // couleur rouge le jour où il s'arrêtera vraiment.
    const a = alertesDe(rendu({ etatAbonnement: 'impaye', actif: true }));
    expect(a[0]?.cle).toBe('impaye');
    expect(a[0]?.gravite).toBe('attention');
  });

  it('un impayé HORS grâce devient critique', () => {
    const a = alertesDe(
      rendu({ etatAbonnement: 'impaye', actif: false, motifDroits: 'délai dépassé' }),
    );
    expect(a[0]?.gravite).toBe('critique');
  });

  it('un abonnement expiré explique POURQUOI', () => {
    const a = alertesDe(
      rendu({ etatAbonnement: 'expire', actif: false, motifDroits: 'abonnement expiré' }),
    );
    expect(cles(a)).toEqual(['periode_echue']);
    expect(a[0]?.message).toContain('abonnement expiré');
  });

  it('« aucun abonnement » n’est PAS une panne', () => {
    // C'est l'état de départ de tout le monde. L'annoncer comme une avarie
    // accueillerait chaque nouveau venu par une alerte rouge.
    expect(alertesDe(rendu({ etatAbonnement: 'aucun', actif: false, plafondMs: null }))).toEqual(
      [],
    );
  });

  it('la fin de période prévient dans la dernière semaine, pas avant', () => {
    const proche = rendu({ finPeriode: NOW + JOURS_FIN_PROCHE * JOUR });
    expect(cles(alertesDe(proche))).toEqual(['fin_de_periode']);

    const loin = rendu({ finPeriode: NOW + (JOURS_FIN_PROCHE + 3) * JOUR });
    expect(alertesDe(loin)).toEqual([]);
  });

  it('UNE ALERTE PAR MACHINE menacée d’effacement', () => {
    // Deux machines qui disparaissent, ce sont deux pertes distinctes : les
    // fondre en une phrase ferait croire qu'il n'y en a qu'une à sauver.
    const a = alertesDe(
      rendu({
        serveurs: [
          { id: 'srv-1', etat: 'arrete', joursAvantSuppression: 2 },
          { id: 'srv-2', etat: 'arrete', joursAvantSuppression: 5 },
          { id: 'srv-3', etat: 'arrete', joursAvantSuppression: 25 },
        ],
      }),
    );
    expect(cles(a)).toEqual(['effacement_imminent', 'effacement_imminent']);
    expect(a.map((x) => x.jours)).toEqual([2, 5]);
  });

  it('un effacement le JOUR MÊME se dit au présent', () => {
    const a = alertesDe(
      rendu({ serveurs: [{ id: 'srv-9', etat: 'arrete', joursAvantSuppression: 0 }] }),
    );
    expect(a[0]?.message).toMatch(/aujourd’hui/);
  });

  it('impayé ET quota épuisé donnent LES DEUX phrases', () => {
    // Payer ne rechargera pas le quota. N'en dire qu'une ferait croire le
    // contraire, et la personne paierait pour rien.
    const a = alertesDe(
      rendu({
        etatAbonnement: 'impaye',
        actif: true,
        plafondMs: 10 * HEURE,
        depenseMs: 10 * HEURE,
      }),
    );
    expect(cles(a).sort()).toEqual(['impaye', 'quota_epuise']);
  });
});

describe('tableau — la phrase est RECOMPOSABLE ailleurs', () => {
  // La ruche est bilingue ; le serveur ne sait pas dans quelle langue on
  // regarde. Chaque alerte doit donc porter de quoi la réécrire, sans quoi ces
  // trois phrases seraient les seules de tout l'écran à rester en français.

  it('chaque alerte porte un « details », même vide', () => {
    const toutes = [
      ...alertesDe(rendu({ serveurs: [{ id: 's', etat: 'arrete', joursAvantSuppression: 1 }] })),
      ...alertesDe(rendu({ etatAbonnement: 'impaye', actif: true })),
      ...alertesDe(rendu({ etatAbonnement: 'expire', actif: false, motifDroits: 'échu' })),
      ...alertesDe(rendu({ finPeriode: NOW + JOUR })),
      ...alertesDe(rendu({ plafondMs: 10 * HEURE, depenseMs: 10 * HEURE })),
      ...alertesDe(rendu({ plafondMs: 10 * HEURE, depenseMs: 9.5 * HEURE })),
    ];
    expect(toutes.length).toBeGreaterThan(0);
    for (const a of toutes) expect(a.details).toBeTypeOf('object');
  });

  it('l’effacement nomme SA machine', () => {
    const a = alertesDe(
      rendu({ serveurs: [{ id: 'srv-precise', etat: 'arrete', joursAvantSuppression: 2 }] }),
    );
    expect(a[0]?.details.serveur).toBe('srv-precise');
  });

  it('l’impayé dit s’il est encore dans la grâce', () => {
    // Les deux phrases sont opposées : « ça continue » et « c'est arrêté ». Un
    // client qui ne pourrait pas les distinguer en choisirait une au hasard.
    expect(alertesDe(rendu({ etatAbonnement: 'impaye', actif: true }))[0]?.details.enGrace).toBe(
      true,
    );
    expect(alertesDe(rendu({ etatAbonnement: 'impaye', actif: false }))[0]?.details.enGrace).toBe(
      false,
    );
  });

  it('le quota presque vide chiffre CE QU’IL RESTE', () => {
    const a = alertesDe(rendu({ plafondMs: 100 * HEURE, depenseMs: 95 * HEURE }));
    expect(a[0]?.details.heuresRestantes).toBeCloseTo(5, 5);
  });

  it('une période échue transmet son motif', () => {
    const a = alertesDe(
      rendu({ etatAbonnement: 'annule', actif: false, motifDroits: 'abonnement annulé' }),
    );
    expect(a[0]?.details.motif).toBe('abonnement annulé');
  });

  it('le message français de REPLI n’est jamais vide', () => {
    // C'est le filet d'un client plus ancien que le serveur : il rencontrera
    // une clé qu'il ne sait pas rendre, et une ligne vide serait pire qu'une
    // phrase dans la mauvaise langue.
    const a = alertesDe(
      rendu({ serveurs: [{ id: 's', etat: 'arrete', joursAvantSuppression: 1 }] }),
    );
    for (const x of a) expect(x.message.length).toBeGreaterThan(10);
  });
});

describe('tableau — l’ordre, qui est tout', () => {
  it('L’IRRÉVERSIBLE PASSE AVANT LE RÉVERSIBLE, MÊME MOINS URGENT', () => {
    // Le cœur de ce module. Un effacement à 7 jours prime un impayé qui coupe
    // le service aujourd'hui : la facture se règle après coup, les données
    // effacées ne reviennent pas.
    const t = composerTableau(
      [
        projet({
          projectId: 'p1',
          nom: 'A',
          etatAbonnement: 'impaye',
          actif: false,
          plafondMs: null,
        }),
        projet({
          projectId: 'p2',
          nom: 'B',
          serveurs: [
            { id: 'srv-b', etat: 'arrete', joursAvantSuppression: JOURS_EFFACEMENT_PROCHE },
          ],
        }),
      ],
      NOW,
    );
    expect(cles(t.alertes)[0]).toBe('effacement_imminent');
    expect(cles(t.alertes)[1]).toBe('impaye');
  });

  it('à nature égale, le plus urgent d’abord', () => {
    const a = trier([
      {
        cle: 'effacement_imminent',
        gravite: 'critique',
        projectId: 'p',
        projet: 'A',
        message: 'x',
        jours: 6,
        details: {},
      },
      {
        cle: 'effacement_imminent',
        gravite: 'critique',
        projectId: 'p',
        projet: 'A',
        message: 'y',
        jours: 1,
        details: {},
      },
    ]);
    expect(a.map((x) => x.jours)).toEqual([1, 6]);
  });

  it('une alerte SANS échéance passe après celles qui en ont une', () => {
    // `jours: -1` veut dire « pas de date », pas « il y a très longtemps » :
    // un tri naïf la placerait en tête et enterrerait ce qui expire demain.
    const a = trier([
      {
        cle: 'impaye',
        gravite: 'critique',
        projectId: 'p',
        projet: 'A',
        message: 'sans',
        jours: -1,
        details: {},
      },
      {
        cle: 'periode_echue',
        gravite: 'critique',
        projectId: 'p',
        projet: 'A',
        message: 'avec',
        jours: 3,
        details: {},
      },
    ]);
    expect(a[0]?.message).toBe('avec');
  });

  it('LE TRI EST TOTAL : deux relevés identiques rendent le MÊME ordre', () => {
    // Sans départage complet, l'écran se réordonne sous les yeux à chaque
    // rafraîchissement — et on croit que quelque chose a changé.
    const brut: Alerte[] = [
      {
        cle: 'impaye',
        gravite: 'critique',
        projectId: 'p2',
        projet: 'Zèbre',
        message: 'm',
        jours: -1,
        details: {},
      },
      {
        cle: 'impaye',
        gravite: 'critique',
        projectId: 'p1',
        projet: 'Abeille',
        message: 'm',
        jours: -1,
        details: {},
      },
      {
        cle: 'impaye',
        gravite: 'critique',
        projectId: 'p3',
        projet: 'Mouche',
        message: 'm',
        jours: -1,
        details: {},
      },
    ];
    const un = trier(brut).map((x) => x.projet);
    const deux = trier([...brut].reverse()).map((x) => x.projet);
    expect(un).toEqual(deux);
    expect(un).toEqual(['Abeille', 'Mouche', 'Zèbre']);
  });
});

describe('tableau — les totaux', () => {
  it('les heures d’un abonnement MORT ne sont pas comptées', () => {
    // Additionner les heures d'un plan expiré annoncerait un crédit qui
    // n'existe pas — la pire ligne à se tromper dans un tableau de bord.
    const t = composerTableau(
      [
        projet({ projectId: 'p1', heures: 50, actif: true }),
        projet({ projectId: 'p2', heures: 200, actif: false, etatAbonnement: 'expire' }),
      ],
      NOW,
    );
    expect(t.totaux.heuresIncluses).toBe(50);
  });

  it('les totaux comptent les machines facturables de tous les projets', () => {
    const t = composerTableau(
      [
        projet({
          projectId: 'p1',
          serveurs: [{ id: 'a', etat: 'pret', joursAvantSuppression: -1 }],
        }),
        projet({
          projectId: 'p2',
          serveurs: [
            { id: 'b', etat: 'pret', joursAvantSuppression: -1 },
            { id: 'c', etat: 'arrete', joursAvantSuppression: 20 },
          ],
        }),
      ],
      NOW,
    );
    expect(t.totaux.serveursActifs).toBe(2);
    expect(t.totaux.projets).toBe(2);
  });

  it('une personne sans projet obtient un tableau vide, pas une erreur', () => {
    const t = composerTableau([], NOW);
    expect(t.projets).toEqual([]);
    expect(t.alertes).toEqual([]);
    expect(t.totaux).toEqual({ projets: 0, serveursActifs: 0, heuresIncluses: 0, depenseMs: 0 });
  });
});
