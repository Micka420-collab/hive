// LA PASTILLE D'ALERTES — ce qui l'allume, et ce qui doit la laisser éteinte.
//
// Une pastille de navigation est une promesse minuscule et coûteuse : allumée à
// tort, elle envoie chercher un problème qui n'existe pas ; éteinte à tort, elle
// laisse passer un `effacement_imminent` que rien ne rattrape.
//
// Les trois règles éprouvées ici sont exactement celles qu'un JSX aurait
// enfouies hors d'atteinte : `null` n'est pas « info », un serveur sans
// `graviteMax` n'allume rien, et la gravité vient du SERVEUR — jamais d'un
// classement refait dans l'écran.

import { describe, expect, it } from 'vitest';
import {
  compteAffiche,
  pastilleDesAlertes,
  phraseAlertes,
} from '../dashboard/src/views/pastille-alertes.js';
import type { Pastille } from '../dashboard/src/views/pastille-alertes.js';

/** Un tableau quelconque : seuls le nombre d'alertes et la gravité comptent. */
const source = (nb: number, graviteMax: Pastille['gravite'] | null) => ({
  alertes: Array.from({ length: nb }, (_, i) => ({ i })),
  graviteMax,
});

describe('la pastille s’allume — et sur la gravité du SERVEUR', () => {
  it('reprend le compte et la gravité tels quels', () => {
    expect(pastilleDesAlertes(source(3, 'critique'))).toEqual({ total: 3, gravite: 'critique' });
    expect(pastilleDesAlertes(source(1, 'attention'))).toEqual({ total: 1, gravite: 'attention' });
  });

  it('NE RECALCULE RIEN : elle transporte le verdict, elle ne le refait pas', () => {
    // Le serveur classe par nature d'abord ; sa `graviteMax` peut donc ne pas
    // être celle de la première alerte. Si ce module « corrigeait » quoi que ce
    // soit, il fabriquerait une seconde décision — celle que MonEspace
    // s'interdit. On lui donne une gravité que rien dans la liste ne justifie :
    // il doit la rendre telle quelle.
    expect(pastilleDesAlertes(source(2, 'critique'))?.gravite).toBe('critique');
    expect(pastilleDesAlertes(source(2, 'info'))?.gravite).toBe('info');
  });
});

describe('la pastille reste ÉTEINTE — les trois cas', () => {
  it('sans tableau (pas de session, ou pas encore chargé)', () => {
    expect(pastilleDesAlertes(null)).toBeNull();
  });

  it('SANS ALERTE : « aucune » n’est pas « info »', () => {
    // Le piège central. Une ruche saine ne doit porter AUCUNE pastille : une
    // pastille toujours allumée n'attire plus l'œil le jour où elle compte.
    expect(pastilleDesAlertes(source(0, null))).toBeNull();
    // Et même si un serveur rendait une gravité avec zéro alerte, on n'allume
    // pas : c'est le COMPTE qui décide de l'allumage.
    expect(pastilleDesAlertes(source(0, 'critique'))).toBeNull();
  });

  it('SANS GRAVITÉ : un serveur ancien n’invente pas une couleur', () => {
    // Le contrat porte un `version` : un client peut parler à une ruche d'avant
    // `graviteMax`. Peindre « info » par défaut mentirait sur l'urgence — mieux
    // vaut pas de pastille qu'une pastille fausse.
    expect(pastilleDesAlertes(source(5, null))).toBeNull();
  });
});

describe('ce que la pastille MONTRE et ce qu’elle DIT', () => {
  it('le compte affiché plafonne sans mentir sur le compte réel', () => {
    expect(compteAffiche(1)).toBe('1');
    expect(compteAffiche(99)).toBe('99');
    expect(compteAffiche(100)).toBe('99+');
    // Le plafond est un fait d'AFFICHAGE : la pastille garde le vrai total.
    expect(pastilleDesAlertes(source(150, 'attention'))?.total).toBe(150);
  });

  it('LA GRAVITÉ EST DITE EN TOUTES LETTRES, jamais laissée à la couleur', () => {
    // § 9 vicies : un état qui ne tient qu'à un pixel n'est vérifiable ni par un
    // banc, ni par un lecteur d'écran.
    const p: Pastille = { total: 3, gravite: 'critique' };
    expect(phraseAlertes(p, true)).toBe('3 alertes, la plus grave : critique');
    expect(phraseAlertes(p, false)).toBe('3 alerts, most severe: critical');
  });

  it('une seule alerte ne se dit pas « la plus grave »', () => {
    // « 1 alerte, la plus grave : critique » est du charabia : il n'y a pas de
    // hiérarchie à une seule.
    expect(phraseAlertes({ total: 1, gravite: 'critique' }, true)).toBe('1 alerte, critique');
    expect(phraseAlertes({ total: 1, gravite: 'attention' }, false)).toBe(
      '1 alert, needs attention',
    );
  });

  it('les trois gravités ont chacune leur mot, dans les deux langues', () => {
    const gravites = ['critique', 'attention', 'info'] as const;
    const dits = gravites.flatMap((g) => [
      phraseAlertes({ total: 2, gravite: g }, true),
      phraseAlertes({ total: 2, gravite: g }, false),
    ]);
    // Six phrases DISTINCTES : si deux gravités se disaient pareil, l'une
    // d'elles serait indiscernable à l'oreille.
    expect(new Set(dits).size).toBe(6);
    for (const d of dits) expect(d.length).toBeGreaterThan(10);
  });
});
